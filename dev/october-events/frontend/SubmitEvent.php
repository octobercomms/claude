<?php
declare(strict_types=1);

namespace OE\Frontend;

use OE\Account;
use OE\Fields;
use OE\Submission;
use OE\Planning\Events;

defined('ABSPATH') || exit;

/**
 * Front-end self-serve event submission (self-serve platform, Phase 1 slice 1).
 *
 * A branded `[oe_submit_event]` page where a logged-in organiser posts an event.
 * It runs through the existing Submission engine, so the event is saved as a
 * DRAFT and lands in October's approval queue — nothing publishes until it is
 * approved. Public organiser signup, the "approve the user once then trust"
 * loop, and image upload with the quality gate are later slices; here the form
 * requires a logged-in user and captures the core event fields only.
 *
 * @see docs/october-events/SELF-SERVE-PLATFORM-2027.md
 */
final class SubmitEvent {

    private static ?SubmitEvent $instance = null;

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public function init(): void {
        add_shortcode('oe_submit_event', [$this, 'render']);
        add_action('wp_enqueue_scripts', [$this, 'register_assets']);
        add_action('admin_post_oe_submit_event', [$this, 'handle']);
        add_action('admin_post_nopriv_oe_submit_event', [$this, 'handle']);
    }

    public function register_assets(): void {
        wp_register_style('oe-submit-event', OE_URL . 'assets/css/submit-event.css', [], OE_VERSION);
    }

    /** Render the shortcode: a sign-in prompt for guests, else the event form. */
    public function render(array $atts = []): string {
        wp_enqueue_style('oe-submit-event');
        $notice = isset($_GET['oe_submit']) ? sanitize_key((string) $_GET['oe_submit']) : '';

        ob_start();
        if (! is_user_logged_in()) {
            require OE_DIR . 'frontend/templates/submit-event-signin.php';
            return (string) ob_get_clean();
        }

        $action = esc_url(admin_url('admin-post.php'));
        $nonce  = wp_nonce_field('oe_submit_event', '_wpnonce', true, false);
        require OE_DIR . 'frontend/templates/submit-event.php';
        return (string) ob_get_clean();
    }

    /** Process a submitted event. Logged-in only; lands in the approval queue. */
    public function handle(): void {
        if (! is_user_logged_in()) {
            auth_redirect(); // bounce guests to log in, then back
        }
        check_admin_referer('oe_submit_event');

        $back  = wp_get_referer() ?: home_url('/');
        $title = sanitize_text_field((string) wp_unslash($_POST['oe_title'] ?? ''));
        $desc  = wp_kses_post((string) wp_unslash($_POST['oe_description'] ?? ''));
        $start = sanitize_text_field((string) wp_unslash($_POST['oe_start'] ?? ''));
        $loc   = sanitize_text_field((string) wp_unslash($_POST['oe_location'] ?? ''));
        $url   = esc_url_raw((string) wp_unslash($_POST['oe_url'] ?? ''));

        if ($title === '' || $desc === '' || $start === '') {
            $this->bounce($back, 'missing');
        }
        if (! strtotime($start)) {
            $this->bounce($back, 'baddate');
        }

        $uid        = get_current_user_id();
        $account_id = Account::ensure($uid);
        if (! $account_id) {
            $this->bounce($back, 'error');
        }

        // Anti-abuse: cap how many still-unreviewed events one organiser can queue,
        // so a logged-in user can't flood the review queue. Approved (published)
        // events don't count. Managers are exempt.
        if (! current_user_can('manage_options')) {
            $pending = (int) count(get_posts([
                'post_type'      => \OE\PostTypes::slug('event'),
                'post_status'    => ['draft', 'pending'],
                'author'         => $uid,
                'posts_per_page' => 26,
                'fields'         => 'ids',
                'no_found_rows'  => true,
                // Only genuinely-unreviewed events count. Rejected and
                // pending-payment listings are also WP drafts, so scope by the
                // submission status meta or an organiser whose events keep being
                // rejected would be permanently locked out of the form.
                'meta_key'       => Fields::key('status'),
                'meta_value'     => Fields::STATUS_PENDING_REVIEW,
            ]));
            if ($pending >= 25) {
                $this->bounce($back, 'toomany');
            }
        }

        // Fold the tickets/info link into the body so it always surfaces — to the
        // reviewer and, once published, on the public page — regardless of whether
        // the theme has a dedicated URL field. Also kept as structured meta.
        $content = $desc;
        if ($url !== '') {
            $content .= "\n\n" . '<p class="oe-event-link"><a href="' . esc_url($url) . '" rel="noopener">'
                . esc_html__('Tickets & info', 'october-events') . '</a></p>';
        }

        $result = Submission::create('event', ['title' => $title, 'content' => $content], $account_id, Fields::TIER_FREE);
        if (is_wp_error($result) || empty($result['post_id'])) {
            $this->bounce($back, 'error');
        }
        $post_id = (int) $result['post_id'];

        // Event display fields, written through the configurable event field map so
        // they land on the meta the public listing template reads. Normally the
        // event is a draft pending review, so a mis-mapped field is caught in
        // approval. (An account with the auto-approve flag set publishes inside
        // create() above; the live page still reads these once written here, but
        // wiring display fields into the pre-publish path is a job for the
        // trust-loop slice — new organiser accounts are not auto-approve.)
        update_post_meta($post_id, Events::key('start_datetime'), $start);
        if ($loc !== '') {
            update_post_meta($post_id, Events::key('location'), $loc);
        }
        if ($url !== '') {
            update_post_meta($post_id, '_oe_external_url', $url);
        }

        $this->bounce($back, 'ok');
    }

    /** Redirect back to the form with a status flag, then stop. */
    private function bounce(string $back, string $status): void {
        wp_safe_redirect(add_query_arg('oe_submit', $status, remove_query_arg('oe_submit', $back)));
        exit;
    }
}
