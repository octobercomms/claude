<?php
declare(strict_types=1);

namespace OE\Social;

use OE\Connectors\MetaConnector;
use OE\Connectors\LinkedInConnector;

defined('ABSPATH') || exit;

/**
 * Social post scheduler: queue a caption + image to publish to Meta (Facebook
 * Page / Instagram) and LinkedIn at a chosen time, and publish it when due.
 *
 * A queued post is a private `oe_social_post` CPT row. Publishing fires from a
 * per-post one-off cron at its scheduled time, with an hourly sweep as a
 * safety net. Everything is inert until the relevant network is connected
 * (Settings → Social publishing); an unconnected network is simply skipped.
 */
final class Scheduler {

    public const CPT = 'oe_social_post';

    private static ?Scheduler $instance = null;

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public function init(): void {
        add_action('init', [$this, 'register_cpt']);
        add_action('oe_social_publish', [$this, 'publish_one']);
        // Hourly safety net for a per-post cron that never fired (own schedule, so
        // it doesn't depend on any other feature's cron being registered).
        add_action('oe_social_sweep', [$this, 'sweep']);
        if (! wp_next_scheduled('oe_social_sweep')) {
            wp_schedule_event(time() + HOUR_IN_SECONDS, 'hourly', 'oe_social_sweep');
        }
        // Admin actions.
        add_action('admin_post_oe_social_connect', [$this, 'handle_connect']);
        add_action('admin_post_oe_social_meta_cb', [$this, 'handle_meta_callback']);
        add_action('admin_post_oe_social_li_cb', [$this, 'handle_linkedin_callback']);
        add_action('admin_post_oe_social_disconnect', [$this, 'handle_disconnect']);
        // Scheduling happens from inside the event editor (no nested form), so AJAX.
        add_action('wp_ajax_oe_social_schedule', [$this, 'ajax_schedule']);
        add_action('wp_ajax_oe_social_cancel', [$this, 'ajax_cancel']);
    }

    public function register_cpt(): void {
        register_post_type(self::CPT, [
            'public'              => false,
            'show_ui'             => false,
            'show_in_menu'        => false,
            'exclude_from_search' => true,
            'publicly_queryable'  => false,
            'supports'            => ['title'],
        ]);
    }

    /* ---- redirect URIs (register these in the Meta / LinkedIn apps) ---- */

    public static function meta_redirect_uri(): string {
        return admin_url('admin-post.php?action=oe_social_meta_cb');
    }

    public static function linkedin_redirect_uri(): string {
        return admin_url('admin-post.php?action=oe_social_li_cb');
    }

    /* ---- queue ---- */

    /**
     * @param array<int,string> $networks any of instagram|facebook|linkedin
     * @return int the queued post id, or 0 on failure
     */
    public static function queue(int $event_id, array $networks, string $caption, string $image_url, int $image_id, int $when_ts): int {
        $networks = array_values(array_intersect($networks, ['instagram', 'facebook', 'linkedin']));
        if (! $networks || $caption === '' || $when_ts <= 0) {
            return 0;
        }
        $id = wp_insert_post([
            'post_type'   => self::CPT,
            'post_status' => 'publish',
            'post_title'  => sprintf('Social · %s · %s', get_the_title($event_id) ?: ('#' . $event_id), wp_date('Y-m-d H:i', $when_ts)),
        ], true);
        if (is_wp_error($id) || ! $id) {
            return 0;
        }
        update_post_meta($id, '_event_id', $event_id);
        update_post_meta($id, '_networks', $networks);
        update_post_meta($id, '_caption', $caption);
        update_post_meta($id, '_image_url', esc_url_raw($image_url));
        update_post_meta($id, '_image_id', $image_id);
        update_post_meta($id, '_scheduled_at', $when_ts);
        update_post_meta($id, '_status', 'scheduled');
        // Publish punctually; the hourly sweep covers a missed single event.
        wp_schedule_single_event(max(time() + 5, $when_ts), 'oe_social_publish', [(int) $id]);
        return (int) $id;
    }

    /** @return array<int,\WP_Post> the scheduled/sent posts for an event, newest first */
    public static function for_event(int $event_id): array {
        return get_posts([
            'post_type'      => self::CPT,
            'post_status'    => 'publish',
            'posts_per_page' => 50,
            'orderby'        => 'meta_value_num',
            'meta_key'       => '_scheduled_at',
            'order'          => 'DESC',
            'meta_query'     => [['key' => '_event_id', 'value' => $event_id]],
        ]);
    }

    public static function status(int $id): string {
        return (string) get_post_meta($id, '_status', true);
    }

    /* ---- publish ---- */

    /** Hourly: publish anything still scheduled whose time has passed (missed cron). */
    public function sweep(): void {
        $due = get_posts([
            'post_type'      => self::CPT,
            'post_status'    => 'publish',
            'posts_per_page' => 20,
            'meta_query'     => [
                ['key' => '_status', 'value' => 'scheduled'],
                ['key' => '_scheduled_at', 'value' => time(), 'compare' => '<=', 'type' => 'NUMERIC'],
            ],
        ]);
        foreach ($due as $p) {
            $this->publish_one((int) $p->ID);
        }
    }

    public function publish_one(int $id): void {
        if (get_post_type($id) !== self::CPT || self::status($id) !== 'scheduled') {
            return; // gone, already handled, or cancelled
        }
        update_post_meta($id, '_status', 'publishing');
        $networks = (array) get_post_meta($id, '_networks', true);
        $caption  = (string) get_post_meta($id, '_caption', true);
        $image    = (string) get_post_meta($id, '_image_url', true);

        $results   = [];
        $meta_tgts = array_values(array_intersect($networks, ['instagram', 'facebook']));
        if ($meta_tgts) {
            $results += MetaConnector::is_ready()
                ? MetaConnector::publish_image($image, $caption, $meta_tgts)
                : array_fill_keys($meta_tgts, ['ok' => false, 'permalink' => '', 'error' => 'meta_not_connected']);
        }
        if (in_array('linkedin', $networks, true)) {
            $results['linkedin'] = LinkedInConnector::is_ready()
                ? LinkedInConnector::publish_image($image, $caption)
                : ['ok' => false, 'permalink' => '', 'error' => 'linkedin_not_connected'];
        }

        $oks = array_filter($results, static fn($r) => ! empty($r['ok']));
        $status = ! $results ? 'failed' : (count($oks) === count($results) ? 'published' : (count($oks) ? 'partial' : 'failed'));
        update_post_meta($id, '_results', $results);
        update_post_meta($id, '_status', $status);
        update_post_meta($id, '_published_at', time());
    }

    /* ---- OAuth connect / disconnect ---- */

    public function handle_connect(): void {
        $this->guard();
        $net = sanitize_key((string) ($_GET['net'] ?? ''));
        check_admin_referer('oe_social_connect_' . $net);
        $state = wp_create_nonce('oe_social_oauth_' . $net);
        if ($net === 'meta' && MetaConnector::configured()) {
            wp_redirect(MetaConnector::oauth_url(self::meta_redirect_uri(), $state));
            exit;
        }
        if ($net === 'linkedin' && LinkedInConnector::configured()) {
            wp_redirect(LinkedInConnector::oauth_url(self::linkedin_redirect_uri(), $state));
            exit;
        }
        $this->back_to_settings('social_error', 'not_configured');
    }

    public function handle_meta_callback(): void {
        $this->guard();
        if (! wp_verify_nonce((string) ($_GET['state'] ?? ''), 'oe_social_oauth_meta')) {
            $this->back_to_settings('social_error', 'bad_state');
        }
        $code = sanitize_text_field((string) ($_GET['code'] ?? ''));
        $err  = $code !== '' ? MetaConnector::complete_oauth($code, self::meta_redirect_uri()) : 'no_code';
        $this->back_to_settings($err === '' ? 'social_ok' : 'social_error', $err === '' ? 'meta' : $err);
    }

    public function handle_linkedin_callback(): void {
        $this->guard();
        if (! wp_verify_nonce((string) ($_GET['state'] ?? ''), 'oe_social_oauth_linkedin')) {
            $this->back_to_settings('social_error', 'bad_state');
        }
        $code = sanitize_text_field((string) ($_GET['code'] ?? ''));
        $err  = $code !== '' ? LinkedInConnector::complete_oauth($code, self::linkedin_redirect_uri()) : 'no_code';
        $this->back_to_settings($err === '' ? 'social_ok' : 'social_error', $err === '' ? 'linkedin' : $err);
    }

    public function handle_disconnect(): void {
        $this->guard();
        $net = sanitize_key((string) ($_REQUEST['net'] ?? ''));
        check_admin_referer('oe_social_disconnect_' . $net);
        if ($net === 'meta') {
            MetaConnector::disconnect();
        } elseif ($net === 'linkedin') {
            LinkedInConnector::disconnect();
        }
        $this->back_to_settings('social_ok', 'disconnected');
    }

    /* ---- schedule / cancel (AJAX, from the event Social metabox) ---- */

    public function ajax_schedule(): void {
        check_ajax_referer('oe_social_schedule', 'nonce');
        $event_id = absint($_POST['event_id'] ?? 0);
        if (! $event_id || ! current_user_can('edit_post', $event_id)) {
            wp_send_json_error(['message' => __('You can’t schedule for this event.', 'october-events')], 403);
        }
        $networks = array_map('sanitize_key', (array) ($_POST['networks'] ?? []));
        $caption  = sanitize_textarea_field(wp_unslash((string) ($_POST['caption'] ?? '')));
        $image_id = absint($_POST['image_id'] ?? 0);
        $image    = $image_id ? (string) wp_get_attachment_image_url($image_id, 'full') : (string) get_the_post_thumbnail_url($event_id, 'full');
        $local    = sanitize_text_field((string) ($_POST['when'] ?? ''));
        $when_ts  = 0;
        if ($local !== '') {
            try { $when_ts = (new \DateTime($local, wp_timezone()))->getTimestamp(); } catch (\Throwable $e) { $when_ts = 0; }
        }
        if (! $networks) {
            wp_send_json_error(['message' => __('Pick at least one network.', 'october-events')]);
        }
        if ($caption === '') {
            wp_send_json_error(['message' => __('Add a caption.', 'october-events')]);
        }
        if ($image === '') {
            wp_send_json_error(['message' => __('This event has no image to post — set a featured image first.', 'october-events')]);
        }
        if ($when_ts <= time()) {
            wp_send_json_error(['message' => __('Pick a time in the future.', 'october-events')]);
        }
        $id = self::queue($event_id, $networks, $caption, $image, $image_id, $when_ts);
        if (! $id) {
            wp_send_json_error(['message' => __('Couldn’t schedule that. Try again.', 'october-events')]);
        }
        wp_send_json_success(['rows' => self::rows_html($event_id)]);
    }

    public function ajax_cancel(): void {
        check_ajax_referer('oe_social_schedule', 'nonce');
        $id       = absint($_POST['id'] ?? 0);
        $event_id = (int) get_post_meta($id, '_event_id', true);
        if (! $id || get_post_type($id) !== self::CPT || ! current_user_can('edit_post', $event_id)) {
            wp_send_json_error(['message' => 'forbidden'], 403);
        }
        if (in_array(self::status($id), ['scheduled', 'publishing'], true)) {
            wp_clear_scheduled_hook('oe_social_publish', [$id]);
            update_post_meta($id, '_status', 'cancelled');
        }
        wp_send_json_success(['rows' => self::rows_html($event_id)]);
    }

    /** Rendered list of an event's scheduled/sent posts (for the metabox + AJAX). */
    public static function rows_html(int $event_id): string {
        $posts = self::for_event($event_id);
        if (! $posts) {
            return '<p class="description" style="margin:6px 0 0">' . esc_html__('Nothing scheduled yet.', 'october-events') . '</p>';
        }
        $labels = [
            'scheduled' => __('Scheduled', 'october-events'),
            'publishing' => __('Publishing…', 'october-events'),
            'published' => __('Published', 'october-events'),
            'partial'   => __('Partly published', 'october-events'),
            'failed'    => __('Failed', 'october-events'),
            'cancelled' => __('Cancelled', 'october-events'),
        ];
        $colors = ['published' => '#1a7f37', 'scheduled' => '#2271b1', 'partial' => '#8a6d3b', 'failed' => '#b32d2e', 'cancelled' => '#787c82', 'publishing' => '#2271b1'];
        $nonce  = wp_create_nonce('oe_social_schedule');
        $out = '<table class="widefat striped" style="margin-top:8px"><tbody>';
        foreach ($posts as $p) {
            $id    = (int) $p->ID;
            $st    = self::status($id);
            $when  = (int) get_post_meta($id, '_scheduled_at', true);
            $nets  = (array) get_post_meta($id, '_networks', true);
            $res   = (array) get_post_meta($id, '_results', true);
            $links = [];
            foreach ($res as $net => $r) {
                if (! empty($r['permalink'])) {
                    $links[] = '<a href="' . esc_url((string) $r['permalink']) . '" target="_blank" rel="noopener">' . esc_html(ucfirst((string) $net)) . '</a>';
                } elseif (! empty($r['error'])) {
                    $links[] = '<span title="' . esc_attr((string) $r['error']) . '" style="color:#b32d2e">' . esc_html(ucfirst((string) $net)) . ' ✗</span>';
                }
            }
            $out .= '<tr>'
                . '<td><strong style="color:' . esc_attr($colors[$st] ?? '#333') . '">' . esc_html($labels[$st] ?? $st) . '</strong><br>'
                . '<span class="description">' . esc_html(implode(', ', array_map('ucfirst', $nets))) . '</span></td>'
                . '<td>' . esc_html($when ? wp_date('j M · g:i A', $when) : '') . ($links ? '<br><span class="description">' . implode(' · ', $links) . '</span>' : '') . '</td>'
                . '<td style="text-align:right">' . (in_array($st, ['scheduled', 'publishing'], true)
                    ? '<button type="button" class="button-link oe-social-cancel" data-id="' . $id . '" data-nonce="' . esc_attr($nonce) . '" style="color:#b32d2e">' . esc_html__('Cancel', 'october-events') . '</button>'
                    : '') . '</td>'
                . '</tr>';
        }
        return $out . '</tbody></table>';
    }

    /* ---- helpers ---- */

    private function guard(): void {
        if (! current_user_can('edit_posts')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
    }

    private function back_to_settings(string $key, string $val): void {
        wp_safe_redirect(add_query_arg($key, rawurlencode($val), admin_url('admin.php?page=oe-settings#social')));
        exit;
    }
}
