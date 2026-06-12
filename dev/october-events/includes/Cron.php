<?php
declare(strict_types=1);

namespace OE;

use OE\Connectors\ClaudeConnector;

defined('ABSPATH') || exit;

/**
 * Scheduled jobs:
 *   - Monthly digest (§5) — first Monday of each month.
 *   - AI Stories connector (§6) — daily.
 *
 * We schedule a daily tick and gate the monthly digest internally so we do not
 * depend on a bespoke "first Monday" cron schedule.
 */
final class Cron {

    public const HOOK_DAILY    = 'oe_daily_cron';
    public const HOOK_DIGEST   = 'oe_monthly_digest';
    public const HOOK_HOURLY   = 'oe_hourly_cron';
    public const HOOK_DISPATCH = 'oe_mail_dispatch'; // campaign send queue (per minute)

    public static function schedule(): void {
        if (! wp_next_scheduled(self::HOOK_DAILY)) {
            wp_schedule_event(time() + HOUR_IN_SECONDS, 'daily', self::HOOK_DAILY);
        }
        if (! wp_next_scheduled(self::HOOK_HOURLY)) {
            wp_schedule_event(time() + MINUTE_IN_SECONDS * 5, 'hourly', self::HOOK_HOURLY);
        }
    }

    public static function unschedule(): void {
        foreach ([self::HOOK_DAILY, self::HOOK_DIGEST, self::HOOK_HOURLY, self::HOOK_DISPATCH] as $hook) {
            $ts = wp_next_scheduled($hook);
            if ($ts) {
                wp_unschedule_event($ts, $hook);
            }
        }
    }

    public function init(): void {
        add_filter('cron_schedules', [self::class, 'add_minute_schedule']);
        add_action(self::HOOK_DAILY, [$this, 'run_daily']);
        add_action(self::HOOK_DIGEST, [$this, 'run_digest']);
        add_action(self::HOOK_HOURLY, [$this, 'run_hourly']);
        add_action(self::HOOK_DISPATCH, [$this, 'run_dispatch']);
        // Traffic-driven fallback so campaigns still send on a low-traffic site.
        add_action('init', ['\OE\Mail\Campaigns', 'maybe_dispatch']);

        // Self-heal the per-minute dispatch event (so it appears on upgrade too,
        // not only on activation).
        if (! wp_next_scheduled(self::HOOK_DISPATCH)) {
            wp_schedule_event(time() + MINUTE_IN_SECONDS, 'oe_minute', self::HOOK_DISPATCH);
        }
    }

    /** @param array<string,mixed> $schedules */
    public static function add_minute_schedule(array $schedules): array {
        if (! isset($schedules['oe_minute'])) {
            $schedules['oe_minute'] = ['interval' => MINUTE_IN_SECONDS, 'display' => 'Every minute (October Events)'];
        }
        return $schedules;
    }

    /** Drain the campaign send queue (a batch per tick). */
    public function run_dispatch(): void {
        \OE\Mail\Campaigns::dispatch();
    }

    /**
     * Hourly tick — volunteer reminder scan (§reminders).
     */
    public function run_hourly(): void {
        Reminders::run_due();
    }

    public function run_daily(): void {
        // AI Stories connector runs every day.
        $this->run_ai_stories();

        // Daily ticket sales report (if any sold today).
        $this->run_sales_report();

        // Monthly digest: only on the first Monday of the month.
        if ((bool) Settings::get('digest_enabled', true) && self::is_first_monday()) {
            $this->run_digest();
        }
    }

    public static function is_first_monday(): bool {
        $now = current_time('timestamp');
        return (int) wp_date('N', $now) === 1 && (int) wp_date('j', $now) <= 7;
    }

    /* ----------------------------------------------------------------------
     * Monthly digest (§5)
     * ------------------------------------------------------------------- */

    public function run_digest(): void {
        $stories  = $this->recent_stories();
        $events   = $this->upcoming_events();
        $featured = $this->featured_listings();

        $html = $this->render_digest_html(
            array_map([$this, 'summarise_post'], $stories),
            array_map([$this, 'summarise_post'], $events),
            array_map([$this, 'summarise_post'], $featured)
        );

        // Send as a native campaign to all subscribers — reuses the throttled
        // sender, open/click tracking and one-click unsubscribe.
        $id = \OE\Mail\Campaigns::save([
            'name'      => 'Monthly digest — ' . wp_date('F Y'),
            'subject'   => sprintf(__('%s — this month', 'october-events'), (string) Settings::get('brand_name', 'October Events')),
            'body_html' => $html,
            'audience'  => 'subscribed',
        ]);
        $queued = \OE\Mail\Campaigns::send($id);
        AuditLog::record('monthly_digest_sent', 0, 'digest', (string) $queued);

        // Reset the featured-in-email flag on included listings (§5).
        foreach ($featured as $post) {
            Fields::set($post->ID, 'featured_in_email', false);
        }
    }

    /**
     * @param array<int,array<string,mixed>> $stories
     * @param array<int,array<string,mixed>> $events
     * @param array<int,array<string,mixed>> $featured
     */
    private function render_digest_html(array $stories, array $events, array $featured): string {
        $section = static function (string $title, array $items): string {
            if (! $items) { return ''; }
            $rows = '';
            foreach ($items as $it) {
                $img = ! empty($it['image']) ? '<img src="' . esc_url((string) $it['image']) . '" alt="" style="max-width:100%;border-radius:8px;margin-bottom:6px">' : '';
                $rows .= '<div style="margin-bottom:18px">' . $img
                    . '<div style="font-weight:bold;font-size:16px"><a href="' . esc_url((string) $it['url']) . '" style="color:#1a1a1a;text-decoration:none">' . esc_html((string) $it['title']) . '</a></div>'
                    . '<div style="color:#555;font-size:14px">' . esc_html((string) ($it['excerpt'] ?? '')) . '</div></div>';
            }
            return '<h2 style="font-size:18px;margin:24px 0 10px">' . esc_html($title) . '</h2>' . $rows;
        };
        return $section(__('Upcoming events', 'october-events'), $events)
            . $section(__('Featured', 'october-events'), $featured)
            . $section(__('Latest stories', 'october-events'), $stories);
    }

    /** @return \WP_Post[] */
    private function recent_stories(): array {
        return get_posts([
            'post_type'      => PostTypes::slug('story'),
            'post_status'    => 'publish',
            'posts_per_page' => 20,
            'date_query'     => [['after' => '30 days ago']],
            'meta_query'     => [['key' => Fields::key('status'), 'value' => Fields::STATUS_APPROVED]],
        ]);
    }

    /** @return \WP_Post[] */
    private function upcoming_events(): array {
        return get_posts([
            'post_type'      => PostTypes::slug('event'),
            'post_status'    => 'publish',
            'posts_per_page' => 20,
            'meta_query'     => [
                [
                    'key'     => '_oe_start_datetime',
                    'value'   => [current_time('mysql'), gmdate('Y-m-d H:i:s', strtotime('+30 days'))],
                    'compare' => 'BETWEEN',
                    'type'    => 'DATETIME',
                ],
            ],
        ]);
    }

    /** @return \WP_Post[] */
    private function featured_listings(): array {
        return get_posts([
            'post_type'      => PostTypes::listing_slugs(),
            'post_status'    => 'publish',
            'posts_per_page' => 50,
            'meta_query'     => [['key' => Fields::key('featured_in_email'), 'value' => '1']],
        ]);
    }

    private function summarise_post(\WP_Post $post): array {
        return [
            'id'      => $post->ID,
            'title'   => get_the_title($post),
            'url'     => get_permalink($post),
            'excerpt' => wp_trim_words(wp_strip_all_tags($post->post_content), 30),
            'image'   => get_the_post_thumbnail_url($post, 'medium') ?: '',
        ];
    }

    /* ----------------------------------------------------------------------
     * Daily ticket sales report
     * ------------------------------------------------------------------- */

    public function run_sales_report(): void {
        $stats = \OE\Ticketing\Orders::stats();
        if ($stats['today_tickets'] <= 0) {
            return;
        }
        $to = (string) (Settings::get('report_email', '') ?: get_option('admin_email'));
        if ($to === '') {
            return;
        }
        $currency = strtoupper((string) Settings::get('currency', 'usd'));
        $rows = '';
        foreach (\OE\Ticketing\Orders::event_summary() as $row) {
            $rows .= '<tr><td>' . esc_html(get_the_title((int) $row->event_id)) . '</td><td>' . (int) $row->tickets . '</td><td>' . esc_html($currency . ' ' . number_format((float) $row->revenue, 2)) . '</td></tr>';
        }
        $html = '<h2>' . esc_html__('ADF ticket sales — today', 'october-events') . '</h2>'
            . '<p>' . sprintf(/* translators: 1: tickets 2: revenue */ esc_html__('Today: %1$d tickets, %2$s.', 'october-events'), $stats['today_tickets'], esc_html($currency . ' ' . number_format($stats['today_revenue'], 2))) . '</p>'
            . '<p>' . sprintf(/* translators: 1: tickets 2: revenue */ esc_html__('All time: %1$d tickets, %2$s.', 'october-events'), $stats['tickets'], esc_html($currency . ' ' . number_format($stats['revenue'], 2))) . '</p>'
            . '<table border="1" cellpadding="6" cellspacing="0"><tr><th>Event</th><th>Tickets</th><th>Revenue</th></tr>' . $rows . '</table>';

        \OE\Mail\Transactional::send('sales_report', ['email' => $to], [], __('Daily ticket sales', 'october-events'), $html);
        AuditLog::record('sales_report_sent', 0, 'report', (string) $stats['today_tickets']);
    }

    /* ----------------------------------------------------------------------
     * AI Stories connector (§6)
     * ------------------------------------------------------------------- */

    public function run_ai_stories(): void {
        if (! ClaudeConnector::is_ready()) {
            return;
        }
        $sources = (array) Settings::get('ai_source_urls', []);
        foreach ($sources as $url) {
            $this->process_source((string) $url);
        }
    }

    private function process_source(string $url): void {
        $items = $this->fetch_feed_items($url);
        $seen  = (array) get_option('oe_ai_seen_guids', []);

        foreach ($items as $item) {
            $guid = $item['guid'];
            if (in_array($guid, $seen, true)) {
                continue;
            }
            $seen[] = $guid;

            $result = ClaudeConnector::editorialize($item['content']);
            if ($result === null) {
                continue; // transient error — retry next run (not marked seen permanently)
            }
            if (! empty($result['skip'])) {
                AuditLog::record('ai_story_skipped', 0, 'story', $guid);
                continue;
            }

            $post_id = wp_insert_post([
                'post_type'    => PostTypes::slug('story'),
                'post_status'  => 'draft',
                'post_title'   => $result['headline'],
                'post_content' => $result['body'],
            ], true);
            if (is_wp_error($post_id)) {
                continue;
            }
            $post_id = (int) $post_id;

            Fields::set($post_id, 'listing_type', 'story');
            Fields::set($post_id, 'status', Fields::STATUS_PENDING_REVIEW);
            Fields::set($post_id, 'paid_tier', Fields::TIER_FREE);
            Fields::set($post_id, 'submission_date', current_time('mysql'));
            update_post_meta($post_id, '_oe_author_type', 'ai_generated');
            update_post_meta($post_id, '_oe_ai_source_url', $item['link']);
            update_post_meta($post_id, '_oe_ai_generated_date', current_time('mysql'));

            AuditLog::record('ai_story_created', $post_id, 'story', $item['link']);
        }

        // Keep the seen list bounded.
        update_option('oe_ai_seen_guids', array_slice(array_unique($seen), -500));
    }

    /**
     * Fetch RSS items (preferred) using WordPress' bundled SimplePie.
     *
     * @return array<int,array{guid:string,link:string,content:string}>
     */
    private function fetch_feed_items(string $url): array {
        if (! function_exists('fetch_feed')) {
            include_once ABSPATH . WPINC . '/feed.php';
        }
        $feed = fetch_feed($url);
        if (is_wp_error($feed)) {
            Logger::log('AI source feed error', ['url' => $url, 'error' => $feed->get_error_message()]);
            return [];
        }
        $items = $feed->get_items(0, 10);
        $out = [];
        foreach ($items as $item) {
            $out[] = [
                'guid'    => (string) $item->get_id(),
                'link'    => (string) $item->get_permalink(),
                'content' => wp_strip_all_tags((string) ($item->get_content() ?: $item->get_description())),
            ];
        }
        return $out;
    }
}
