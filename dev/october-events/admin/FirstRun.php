<?php
declare(strict_types=1);

namespace OE\Admin;

use OE\PostTypes;
use OE\Settings;

defined('ABSPATH') || exit;

/**
 * First-run setup checklist (ADMIN-BUILD AD15).
 *
 * Computes a small list of setup steps with a done / not-done state, derived
 * live from existing data and settings (no new storage). The dashboard shows
 * the checklist until every step is done; a dismiss flag hides it for good.
 */
final class FirstRun {

    private const DISMISS = 'oe_firstrun_dismissed';

    public static function init(): void {
        add_action('admin_post_oe_firstrun_dismiss', [self::class, 'dismiss']);
    }

    public static function dismissed(): bool {
        return (bool) get_option(self::DISMISS, false);
    }

    public static function dismiss(): void {
        if (current_user_can('manage_options') && check_admin_referer('oe_firstrun_dismiss')) {
            update_option(self::DISMISS, 1, false);
        }
        wp_safe_redirect(admin_url('admin.php?page=october-events'));
        exit;
    }

    /**
     * @return array<int,array{label:string,desc:string,done:bool,url:string,cta:string}>
     */
    public static function steps(): array {
        $steps = [];

        // 1. Brand name set (not the default).
        $brand = (string) Settings::get('brand_name', 'October Events');
        $steps[] = [
            'label' => __('Name your festival', 'october-events'),
            'desc'  => __('Set the brand name shown across the admin and emails.', 'october-events'),
            'done'  => $brand !== '' && $brand !== 'October Events',
            'url'   => admin_url('admin.php?page=oe-settings#brand'),
            'cta'   => __('Set the name', 'october-events'),
        ];

        // 2. Payment OR email provider connected (sending/selling readiness).
        $stripe = (string) Settings::get('stripe_secret_key', '');
        $ses    = class_exists('\\OE\\Mail\\Mailer') && \OE\Mail\Mailer::ses_active();
        $steps[] = [
            'label' => __('Connect a service', 'october-events'),
            'desc'  => __('Add Stripe to sell tickets, and SES to send email reliably.', 'october-events'),
            'done'  => $stripe !== '' || $ses,
            'url'   => admin_url('admin.php?page=oe-settings'),
            'cta'   => __('Open settings', 'october-events'),
        ];

        // 3. First event created.
        $events = 0;
        $pt = PostTypes::slug('event');
        if ($pt !== '' && post_type_exists($pt)) {
            $counts = (array) wp_count_posts($pt);
            foreach ($counts as $n) { $events += (int) $n; }
        }
        $steps[] = [
            'label' => __('Create your first event', 'october-events'),
            'desc'  => __('Add an event, then turn on the capability packs it needs.', 'october-events'),
            'done'  => $events > 0,
            'url'   => admin_url('post-new.php?post_type=' . $pt),
            'cta'   => __('Add an event', 'october-events'),
        ];

        // 4. A ticket sold or comped (tickets in use).
        $tickets = 0;
        if (class_exists('\\OE\\Ticketing\\Schema') && class_exists('\\OE\\Ticketing\\Orders')) {
            global $wpdb;
            $t = \OE\Ticketing\Schema::orders();
            $exists = (string) $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $t)) === $t;
            if ($exists) {
                $tickets = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$t}");
            }
        }
        $steps[] = [
            'label' => __('Set up ticketing', 'october-events'),
            'desc'  => __('Add ticket types to an event, or record a comp order to test the flow.', 'october-events'),
            'done'  => $tickets > 0,
            'url'   => admin_url('admin.php?page=oe-tickets'),
            'cta'   => __('Open tickets', 'october-events'),
        ];

        // 5. Contacts built.
        $contacts = 0;
        if (class_exists('\\OE\\Mail\\Contacts')) {
            $c = \OE\Mail\Contacts::counts();
            $contacts = (int) ($c['total'] ?? 0);
        }
        $steps[] = [
            'label' => __('Build your audience', 'october-events'),
            'desc'  => __('Contacts build automatically from orders and signups — rebuild to seed from existing data.', 'october-events'),
            'done'  => $contacts > 0,
            'url'   => admin_url('admin.php?page=oe-people'),
            'cta'   => __('Open people', 'october-events'),
        ];

        return $steps;
    }

    /** @return array{done:int,total:int,complete:bool} */
    public static function progress(): array {
        $steps = self::steps();
        $done  = 0;
        foreach ($steps as $s) {
            if ($s['done']) { $done++; }
        }
        return ['done' => $done, 'total' => count($steps), 'complete' => $done === count($steps)];
    }

    /** Render the checklist card on the dashboard, or nothing when done/dismissed. */
    public static function render(): void {
        if (self::dismissed()) {
            return;
        }
        $steps = self::steps();
        $prog  = self::progress();
        if ($prog['complete']) {
            return;
        }
        $pct = $prog['total'] > 0 ? (int) round($prog['done'] / $prog['total'] * 100) : 0;
        $dismiss = wp_nonce_url(admin_url('admin-post.php?action=oe_firstrun_dismiss'), 'oe_firstrun_dismiss');
        ?>
        <div class="oe-ad-card oe-firstrun">
            <div class="oe-firstrun-head">
                <div>
                    <div class="oe-firstrun-kicker"><?php esc_html_e('Get set up', 'october-events'); ?></div>
                    <h2><?php echo esc_html(sprintf(__('%1$d of %2$d steps done', 'october-events'), $prog['done'], $prog['total'])); ?></h2>
                </div>
                <a class="oe-firstrun-dismiss" href="<?php echo esc_url($dismiss); ?>"><?php esc_html_e('Dismiss', 'october-events'); ?></a>
            </div>
            <div class="oe-firstrun-bar"><span style="width:<?php echo (int) $pct; ?>%"></span></div>
            <ul class="oe-firstrun-steps">
                <?php foreach ($steps as $s) : ?>
                    <li class="<?php echo $s['done'] ? 'is-done' : ''; ?>">
                        <span class="oe-firstrun-check" aria-hidden="true"><?php echo $s['done'] ? '✓' : ''; ?></span>
                        <span class="oe-firstrun-body">
                            <strong><?php echo esc_html($s['label']); ?></strong>
                            <span class="oe-firstrun-desc"><?php echo esc_html($s['desc']); ?></span>
                        </span>
                        <?php if (! $s['done']) : ?>
                            <a class="button button-small" href="<?php echo esc_url($s['url']); ?>"><?php echo esc_html($s['cta']); ?></a>
                        <?php endif; ?>
                    </li>
                <?php endforeach; ?>
            </ul>
        </div>
        <?php
    }
}
