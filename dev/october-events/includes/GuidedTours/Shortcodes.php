<?php
declare(strict_types=1);

namespace OE\GuidedTours;

defined('ABSPATH') || exit;

/**
 * Front-end shortcodes. October builds the page and the building layout; these
 * two just inject the booking logic:
 *
 *   [guided_gate city="atlanta-ga" year="2026"]   the ticket-email unlock
 *   [guided_slots location="123"]                 one building's time slots
 *
 * `[guided_slots]` with no location uses the current post, so it drops straight
 * into a JetEngine listing item. Both emit plain class-named HTML (oe-gt-*) to
 * style with your own CSS.
 */
final class Shortcodes {

    public static function init(): void {
        add_shortcode('guided_gate', [self::class, 'gate']);
        add_shortcode('guided_slots', [self::class, 'slots']);
        add_action('wp_enqueue_scripts', [self::class, 'register']);
    }

    public static function register(): void {
        wp_register_style('oe-guided', OE_URL . 'assets/css/guided.css', [], OE_VERSION);
        wp_register_script('oe-guided', OE_URL . 'assets/js/guided.js', [], OE_VERSION, true);
    }

    /** @param array<string,string>|string $atts */
    public static function gate($atts): string {
        $a    = shortcode_atts(['city' => '', 'year' => ''], (array) $atts, 'guided_gate');
        $tour = Rest::tour_key(sanitize_text_field($a['city']) . '|' . sanitize_text_field($a['year']));
        self::enqueue($tour);

        // Before the release date, the whole tour is closed: show a countdown in
        // place of the unlock form. The reserve endpoint enforces this too, so the
        // countdown is a courtesy, not the lock.
        $release_ts = Releases::release_ts($tour);
        if ($release_ts > time()) {
            ob_start(); ?>
            <div class="oe-gt-gate oe-gt-gate--pre" data-oe-gt-gate data-release-at="<?php echo esc_attr((string) ($release_ts * 1000)); ?>">
                <div class="oe-gt-release" data-oe-gt-release>
                    <p class="oe-gt-release__title"><?php esc_html_e('Booking opens soon', 'october-events'); ?></p>
                    <div class="oe-gt-countdown" data-oe-gt-countdown aria-live="polite"></div>
                    <p class="oe-gt-release__sub">
                        <?php printf(
                            /* translators: %s: release date and time */
                            esc_html__('Times open on %s. If you have a ticket, we’ll email you the moment booking is live.', 'october-events'),
                            '<strong>' . esc_html(wp_date('l F j, g:i A', $release_ts)) . '</strong>'
                        ); ?>
                    </p>
                </div>
            </div>
            <?php
            return (string) ob_get_clean();
        }

        $unlocked = Eligibility::unlocked_email($tour) !== '';

        ob_start(); ?>
        <div class="oe-gt-gate<?php echo $unlocked ? ' is-unlocked' : ''; ?>" data-oe-gt-gate>
            <div class="oe-gt-gate__locked" <?php echo $unlocked ? 'hidden' : ''; ?>>
                <form class="oe-gt-gate__form" data-oe-gt-form>
                    <input type="email" inputmode="email" autocomplete="email" required
                        class="oe-gt-gate__email" placeholder="<?php esc_attr_e('you@example.com', 'october-events'); ?>"
                        aria-label="<?php esc_attr_e('Ticket email', 'october-events'); ?>">
                    <button type="submit" class="oe-gt-btn oe-gt-btn--primary"><?php esc_html_e('Unlock booking', 'october-events'); ?></button>
                </form>
                <p class="oe-gt-gate__error" data-oe-gt-error hidden></p>
            </div>
            <p class="oe-gt-gate__ok" data-oe-gt-ok <?php echo $unlocked ? '' : 'hidden'; ?>>
                <?php esc_html_e('Booking unlocked. Choose your times below.', 'october-events'); ?>
            </p>
        </div>
        <?php
        return (string) ob_get_clean();
    }

    /** @param array<string,string>|string $atts */
    public static function slots($atts): string {
        $a  = shortcode_atts(['location' => ''], (array) $atts, 'guided_slots');
        $id = (int) ($a['location'] !== '' ? $a['location'] : get_the_ID());
        if ($id <= 0) {
            return '';
        }
        self::enqueue('');
        $slots = Slots::all($id);
        if (! $slots) {
            return '<div class="oe-gt-slots oe-gt-slots--empty" data-oe-gt-slots="' . esc_attr((string) $id) . '"></div>';
        }

        // Group by day, in order.
        $by_day = [];
        foreach ($slots as $s) {
            if (! $s['active']) {
                continue;
            }
            $by_day[$s['date']][] = $s;
        }
        // Seats held per slot in one query, rather than a SUM() per slot below.
        $held_map = Reservations::held_map($id);

        ob_start(); ?>
        <div class="oe-gt-slots" data-oe-gt-slots="<?php echo esc_attr((string) $id); ?>">
            <?php foreach ($by_day as $date => $day_slots) :
                $day_label = $date ? wp_date('l F j', (int) (strtotime($date . ' 12:00') ?: time())) : ''; ?>
                <div class="oe-gt-day">
                    <?php if ($day_label !== '') : ?><h4 class="oe-gt-day__label"><?php echo esc_html($day_label); ?></h4><?php endif; ?>
                    <div class="oe-gt-pills">
                        <?php foreach ($day_slots as $s) :
                            $held = $held_map[$s['uid']] ?? 0;
                            $left = max(0, $s['capacity'] - $held);
                            $full = $left <= 0;
                            $time = gmdate('g:i A', (int) strtotime('2000-01-01 ' . $s['start']));
                            $cls  = $full ? 'is-full' : ($left <= 5 ? 'is-almost' : 'is-open');
                            ?>
                            <button type="button"
                                class="oe-gt-pill <?php echo esc_attr($cls); ?>"
                                data-oe-gt-pill
                                data-slot="<?php echo esc_attr($s['uid']); ?>"
                                data-left="<?php echo esc_attr((string) $left); ?>"
                                <?php echo $full ? 'data-full="1"' : ''; ?>>
                                <span class="oe-gt-pill__time"><?php echo esc_html($time); ?></span>
                                <span class="oe-gt-pill__count">
                                    <?php echo $full
                                        ? esc_html__('Full', 'october-events')
                                        : esc_html(sprintf(_n('%d left', '%d left', $left, 'october-events'), $left)); ?>
                                </span>
                            </button>
                        <?php endforeach; ?>
                    </div>
                </div>
            <?php endforeach; ?>
            <div class="oe-gt-mine" data-oe-gt-mine hidden></div>
            <div class="oe-gt-slots__action">
                <label class="oe-gt-party" data-oe-gt-party-wrap hidden>
                    <span class="oe-gt-party__label"><?php esc_html_e('People', 'october-events'); ?></span>
                    <select class="oe-gt-party__select" data-oe-gt-party aria-label="<?php esc_attr_e('How many people', 'october-events'); ?>"></select>
                </label>
                <button type="button" class="oe-gt-btn oe-gt-btn--primary" data-oe-gt-reserve disabled><?php esc_html_e('Select a time', 'october-events'); ?></button>
                <span class="oe-gt-slots__msg" data-oe-gt-msg><?php esc_html_e('Enter your ticket email above to reserve.', 'october-events'); ?></span>
            </div>
        </div>
        <?php
        return (string) ob_get_clean();
    }

    private static function enqueue(string $tour): void {
        wp_enqueue_style('oe-guided');
        wp_enqueue_script('oe-guided');
        // Print the shared config once (the gate defines the tour for the page).
        if ($tour !== '') {
            $release_ts = Releases::release_ts($tour);
            wp_localize_script('oe-guided', 'OE_GT', [
                'rest'      => esc_url_raw(rest_url('oe/v1/guided/')),
                'nonce'     => wp_create_nonce('oe_gt'),
                'tour'      => $tour,
                // Milliseconds so the browser can drive the countdown / lock the
                // slot buttons until booking opens. 0 = open now.
                'releaseAt' => $release_ts > time() ? $release_ts * 1000 : 0,
            ]);
        }
    }
}
