<?php
declare(strict_types=1);

namespace OE\Reports;

use OE\Settings;
use OE\Ticketing\Orders;
use OE\Mail\Contacts;
use OE\Planning\Events;

defined('ABSPATH') || exit;

/**
 * Headline KPI feed for the dashboards (oe/v1/stats). The platform's Dashboard
 * and the plugin's admin Dashboard both show the same festival numbers — tickets
 * and revenue this year, email subscribers, and event readiness — so the figure
 * is computed once here and read from both surfaces.
 *
 * Staff-only (an authenticated user who can edit).
 */
final class Rest {

    private const NS = 'oe/v1';

    public static function init(): void {
        add_action('rest_api_init', [self::class, 'register_routes']);
    }

    public static function can(): bool {
        return \OE\Access::can_manage();
    }

    public static function register_routes(): void {
        register_rest_route(self::NS, '/stats', [
            'methods'             => 'GET',
            'callback'            => [self::class, 'stats'],
            'permission_callback' => [self::class, 'can'],
        ]);
    }

    public static function stats(\WP_REST_Request $req): \WP_REST_Response {
        return new \WP_REST_Response(self::data(), 200);
    }

    /** @return array<string,mixed> The shared KPI payload. */
    public static function data(): array {
        $sales = Orders::stats();
        $contacts = Contacts::counts();

        $confirmed = 0;
        $total = 0;
        $ids = Events::all_event_ids(500);
        // Prime the postmeta cache in one query so Events::status() (a per-event
        // get_post_meta) doesn't fire ~500 individual SELECTs on this KPI endpoint.
        if ($ids) {
            update_meta_cache('post', $ids);
        }
        foreach ($ids as $id) {
            $total++;
            if (Events::status($id) === 'confirmed') {
                $confirmed++;
            }
        }

        return [
            'currency'         => strtoupper((string) Settings::get('currency', 'usd')),
            'tickets_year'     => (int) ($sales['year_tickets'] ?? 0),
            'revenue_year'     => (float) ($sales['year_revenue'] ?? 0),
            'tickets_all'      => (int) ($sales['tickets'] ?? 0),
            'revenue_all'      => (float) ($sales['revenue'] ?? 0),
            'subscribers'      => (int) ($contacts['subscribed'] ?? 0),
            'contacts_total'   => (int) ($contacts['total'] ?? 0),
            'events_confirmed' => $confirmed,
            'events_total'     => $total,
            'year'             => (int) ($sales['year'] ?? (int) current_time('Y')),
        ];
    }
}
