<?php
declare(strict_types=1);

namespace OE\Survey;

use OE\Ticketing\Promo;

defined('ABSPATH') || exit;

/**
 * The survey builder — a metabox on the event edit screen. Enable the survey,
 * write the questions (with an evidence-based advice panel beside them and a
 * "Suggest with Claude" helper), pick the incentive code and timing, and read
 * the results once they come in.
 *
 * Self-contained assets: the event CPT edit screen doesn't get the shared oe
 * admin stylesheet, so this enqueues its own CSS/JS scoped to that screen.
 *
 * @see docs/october-events/POST-EVENT-SURVEY-SPEC.md
 */
final class Metabox {

    public static function init(): void {
        add_action('add_meta_boxes', [self::class, 'add']);
        add_action('save_post', [self::class, 'save'], 10, 2);
        add_action('admin_enqueue_scripts', [self::class, 'assets']);
        add_action('wp_ajax_oe_survey_suggest', [self::class, 'ajax_suggest']);
        add_action('admin_post_oe_survey_send', [self::class, 'send_now']);
        add_action('admin_post_oe_survey_csv', [self::class, 'export_csv']);
    }

    private static function post_type(): string {
        return Config::post_type();
    }

    public static function add(): void {
        $pt = self::post_type();
        if ($pt === '' || ! post_type_exists($pt)) {
            return;
        }
        add_meta_box('oe-survey', __('Post-event survey', 'october-events'), [self::class, 'render'], $pt, 'normal', 'default');
    }

    public static function assets(string $hook): void {
        if ($hook !== 'post.php' && $hook !== 'post-new.php') {
            return;
        }
        $screen = get_current_screen();
        if (! $screen || $screen->post_type !== self::post_type()) {
            return;
        }
        wp_enqueue_style('oe-survey-admin', OE_URL . 'assets/css/survey-admin.css', [], OE_VERSION);
        wp_enqueue_script('oe-survey-admin', OE_URL . 'assets/js/survey-admin.js', [], OE_VERSION, true);
        wp_localize_script('oe-survey-admin', 'OE_SURVEY', [
            'ajax'    => admin_url('admin-ajax.php'),
            'nonce'   => wp_create_nonce('oe_survey_suggest'),
            'aiReady' => Config::ai_ready(),
            'starter' => Config::starter_questions(),
            'i18n'    => [
                'add'      => __('Add question', 'october-events'),
                'remove'   => __('Remove', 'october-events'),
                'label'    => __('Question', 'october-events'),
                'option'   => __('Option', 'october-events'),
                'session'  => __('Session', 'october-events'),
                'addOpt'   => __('Add option', 'october-events'),
                'addSess'  => __('Add session', 'october-events'),
                'thinking' => __('Asking Claude…', 'october-events'),
                'aiFail'   => __('Claude could not draft questions right now. Please write them below.', 'october-events'),
                'capHit'   => __('Four questions is the limit (the session-ratings and quote blocks don’t count).', 'october-events'),
                'firstRate'=> __('The first question is always an overall rating.', 'october-events'),
                'types'    => [
                    'rating'         => __('Rating (1–5)', 'october-events'),
                    'choice'         => __('Choice (pick one)', 'october-events'),
                    'multi'          => __('Choice (pick many)', 'october-events'),
                    'open'           => __('Open text', 'october-events'),
                    'session_rating' => __('Rate each session (off-cap)', 'october-events'),
                    'testimonial'    => __('Quote / testimonial (off-cap)', 'october-events'),
                ],
            ],
        ]);
    }

    public static function render(\WP_Post $post): void {
        $id = (int) $post->ID;
        wp_nonce_field('oe_survey_' . $id, 'oe_survey_nonce');

        $enabled   = Config::enabled($id);
        $questions  = Config::questions($id);
        $code       = Config::incentive_code($id);
        $days_after = Config::send_days_after($id);
        $window     = Config::window_days($id);
        $sent_at    = Config::sent_at($id);
        ?>
        <div class="oe-svy">
            <label class="oe-svy-enable">
                <input type="checkbox" name="oe_survey_enabled" value="1" <?php checked($enabled); ?>>
                <strong><?php esc_html_e('Send a survey for this event', 'october-events'); ?></strong>
            </label>

            <div class="oe-svy-cols">
                <div class="oe-svy-build">
                    <div class="oe-svy-toolbar">
                        <button type="button" class="button" id="oe-svy-add"><?php esc_html_e('Add question', 'october-events'); ?></button>
                        <button type="button" class="button" id="oe-svy-starter"><?php esc_html_e('Use a starter survey', 'october-events'); ?></button>
                        <?php if (Config::ai_ready()) : ?>
                            <button type="button" class="button button-primary" id="oe-svy-ai" data-event="<?php echo (int) $id; ?>"><?php esc_html_e('Suggest with Claude', 'october-events'); ?></button>
                        <?php endif; ?>
                        <span class="oe-svy-count" id="oe-svy-count"></span>
                    </div>
                    <div id="oe-svy-list" class="oe-svy-list"></div>
                    <textarea name="oe_survey_questions" id="oe-svy-json" class="oe-svy-json" hidden><?php echo esc_textarea(wp_json_encode($questions) ?: '[]'); ?></textarea>
                    <p class="oe-svy-note"><?php esc_html_e('The first question is always a 1–5 rating. Up to four questions; the “rate each session” and “quote” blocks don’t count toward the four.', 'october-events'); ?></p>
                </div>

                <aside class="oe-svy-advice">
                    <h4><?php esc_html_e('What makes people finish', 'october-events'); ?></h4>
                    <?php foreach (Config::advice() as $tip) : ?>
                        <div class="oe-svy-tip">
                            <p class="oe-svy-tip-p"><?php echo esc_html($tip['principle']); ?></p>
                            <blockquote class="oe-svy-tip-q">“<?php echo esc_html($tip['quote']); ?>”</blockquote>
                            <cite><a href="<?php echo esc_url($tip['url']); ?>" target="_blank" rel="noopener"><?php echo esc_html($tip['source']); ?></a></cite>
                        </div>
                    <?php endforeach; ?>
                </aside>
            </div>

            <div class="oe-svy-settings">
                <label>
                    <span><?php esc_html_e('Reward code on completion', 'october-events'); ?></span>
                    <?php self::code_dropdown($code); ?>
                </label>
                <label>
                    <span><?php esc_html_e('Send this many days after the event', 'october-events'); ?></span>
                    <input type="number" name="oe_survey_send_days_after" min="1" max="30" value="<?php echo (int) $days_after; ?>">
                </label>
                <label>
                    <span><?php esc_html_e('Keep the survey open for (days)', 'october-events'); ?></span>
                    <input type="number" name="oe_survey_window_days" min="1" max="90" value="<?php echo (int) $window; ?>">
                </label>
            </div>

            <?php if ($sent_at !== '') : ?>
                <p class="oe-svy-sent"><?php echo esc_html(sprintf(
                    /* translators: %s: date/time */
                    __('Invites went out %s.', 'october-events'),
                    $sent_at
                )); ?></p>
            <?php endif; ?>

            <?php if (Config::is_ready($id)) : ?>
                <div class="oe-svy-actions">
                    <?php
                    $send_url = wp_nonce_url(
                        admin_url('admin-post.php?action=oe_survey_send&event=' . $id),
                        'oe_survey_send_' . $id
                    );
                    ?>
                    <a href="<?php echo esc_url($send_url); ?>" class="button" onclick="return confirm('<?php echo esc_js(__('Email the survey to this event’s attendees now?', 'october-events')); ?>')">
                        <?php echo $sent_at === '' ? esc_html__('Send now', 'october-events') : esc_html__('Send again', 'october-events'); ?>
                    </a>
                    <span class="oe-svy-hint"><?php esc_html_e('Save the event first so your latest questions go out.', 'october-events'); ?></span>
                </div>
            <?php endif; ?>

            <?php
            $results = Results::render($id);
            if ($results !== '') :
                $csv_url = wp_nonce_url(
                    admin_url('admin-post.php?action=oe_survey_csv&event=' . $id),
                    'oe_survey_csv_' . $id
                );
                ?>
                <details class="oe-svy-report" open>
                    <summary><?php esc_html_e('Results', 'october-events'); ?></summary>
                    <?php echo $results; // phpcs:ignore WordPress.Security.EscapeOutput -- built from esc_html/esc_attr in Results ?>
                    <p><a href="<?php echo esc_url($csv_url); ?>" class="button"><?php esc_html_e('Download CSV', 'october-events'); ?></a></p>
                    <?php $segments = Results::segments($id); ?>
                    <?php if ($segments) : ?>
                        <p class="oe-svy-seg-note"><?php echo esc_html(sprintf(
                            /* translators: %s: comma-separated ticket types */
                            __('Enough responses to split by: %s (use the CSV to break them down).', 'october-events'),
                            implode(', ', $segments)
                        )); ?></p>
                    <?php endif; ?>
                </details>
            <?php endif; ?>
        </div>
        <?php
    }

    /** Redeemable promo codes for the reward dropdown (mirrors the recovery picker). */
    private static function code_dropdown(string $selected): void {
        $now = current_time('timestamp');
        echo '<select name="oe_survey_incentive_code">';
        echo '<option value="">' . esc_html__('No reward code', 'october-events') . '</option>';
        foreach (Promo::all() as $p) {
            if ((int) $p->active !== 1) {
                continue;
            }
            if (! empty($p->expires_at) && (strtotime((string) $p->expires_at) ?: PHP_INT_MAX) < $now) {
                continue;
            }
            if ($p->max_uses !== null && (int) $p->used_count >= (int) $p->max_uses) {
                continue;
            }
            $c = strtoupper((string) $p->code);
            echo '<option value="' . esc_attr($c) . '" ' . selected($selected, $c, false) . '>' . esc_html($c) . '</option>';
        }
        echo '</select>';
    }

    public static function save(int $post_id, \WP_Post $post): void {
        if ($post->post_type !== self::post_type()) {
            return;
        }
        if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
            return;
        }
        $nonce = isset($_POST['oe_survey_nonce']) ? sanitize_text_field(wp_unslash((string) $_POST['oe_survey_nonce'])) : '';
        if (! wp_verify_nonce($nonce, 'oe_survey_' . $post_id) || ! current_user_can('edit_post', $post_id)) {
            return;
        }

        update_post_meta($post_id, '_oe_survey_enabled', empty($_POST['oe_survey_enabled']) ? '' : '1');

        $raw = isset($_POST['oe_survey_questions']) ? (string) wp_unslash($_POST['oe_survey_questions']) : '';
        $decoded = json_decode($raw, true);
        $questions = Config::sanitize_questions(is_array($decoded) ? $decoded : []);
        update_post_meta($post_id, '_oe_survey_questions', wp_json_encode($questions));

        $code = isset($_POST['oe_survey_incentive_code']) ? strtoupper(sanitize_text_field(wp_unslash((string) $_POST['oe_survey_incentive_code']))) : '';
        update_post_meta($post_id, '_oe_survey_incentive_code', $code);

        $days = isset($_POST['oe_survey_send_days_after']) ? (int) $_POST['oe_survey_send_days_after'] : 1;
        update_post_meta($post_id, '_oe_survey_send_days_after', max(1, min(30, $days)));

        $window = isset($_POST['oe_survey_window_days']) ? (int) $_POST['oe_survey_window_days'] : 14;
        update_post_meta($post_id, '_oe_survey_window_days', max(1, min(90, $window)));
    }

    public static function ajax_suggest(): void {
        check_ajax_referer('oe_survey_suggest', 'nonce');
        $event_id = isset($_POST['event']) ? absint($_POST['event']) : 0;
        if (! $event_id || ! current_user_can('edit_post', $event_id)) {
            wp_send_json_error(['message' => __('Not allowed.', 'october-events')], 403);
        }
        $questions = Config::suggest_questions($event_id);
        if ($questions === []) {
            wp_send_json_error(['message' => __('No draft returned.', 'october-events')]);
        }
        wp_send_json_success(['questions' => $questions]);
    }

    public static function send_now(): void {
        $event_id = isset($_GET['event']) ? absint($_GET['event']) : 0;
        check_admin_referer('oe_survey_send_' . $event_id);
        if (! $event_id || ! current_user_can('edit_post', $event_id)) {
            wp_die(esc_html__('Not allowed.', 'october-events'), '', ['response' => 403]);
        }
        $sent = Sender::send_event($event_id, true);
        wp_safe_redirect(add_query_arg('oe_survey_sent', (int) $sent, get_edit_post_link($event_id, 'url')));
        exit;
    }

    public static function export_csv(): void {
        $event_id = isset($_GET['event']) ? absint($_GET['event']) : 0;
        check_admin_referer('oe_survey_csv_' . $event_id);
        if (! $event_id || ! current_user_can('edit_post', $event_id)) {
            wp_die(esc_html__('Not allowed.', 'october-events'), '', ['response' => 403]);
        }
        $csv = Results::csv($event_id);
        nocache_headers();
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="survey-' . $event_id . '.csv"');
        echo $csv; // phpcs:ignore WordPress.Security.EscapeOutput -- CSV, quoted in Results::csv_row
        exit;
    }
}
