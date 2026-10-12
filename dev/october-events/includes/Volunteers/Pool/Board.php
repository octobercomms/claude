<?php
declare(strict_types=1);

namespace OE\Volunteers\Pool;

defined('ABSPATH') || exit;

/**
 * Volunteer-pool recruitment board (volunteer-pool.md step 2, admin side).
 * A read-only screen: each window×role against its target with a live signed-up
 * count and a status cue, so the organiser sees exactly where to keep recruiting
 * and when to stop. Below it, the list of registered volunteers.
 *
 * Counts come from the pool table: a registration counts toward a window when
 * its stored window-id list contains that window's id.
 */
final class Board {

    public static function render(): void {
        $windows = Windows::all();
        $counts  = self::counts();
        $total   = self::total();

        echo '<div class="wrap"><h1>' . esc_html__('Volunteer pool', 'october-events') . '</h1>';
        echo '<p class="description">' . esc_html(sprintf(
            /* translators: %d: registered volunteer count */
            _n('%d volunteer registered so far.', '%d volunteers registered so far.', $total, 'october-events'),
            $total
        )) . ' ' . esc_html__('Add the [oe_volunteer_pool_signup] shortcode to a page to collect registrations; set the windows under Settings → Volunteer pool.', 'october-events') . '</p>';

        if (! $windows) {
            echo '<p>' . esc_html__('No recruitment windows set yet.', 'october-events') . '</p></div>';
            return;
        }

        echo '<table class="widefat striped" style="max-width:760px;margin-top:12px"><thead><tr>';
        echo '<th>' . esc_html__('Window', 'october-events') . '</th>';
        echo '<th>' . esc_html__('Role', 'october-events') . '</th>';
        echo '<th>' . esc_html__('Target', 'october-events') . '</th>';
        echo '<th>' . esc_html__('Signed up', 'october-events') . '</th>';
        echo '<th>' . esc_html__('Status', 'october-events') . '</th>';
        echo '</tr></thead><tbody>';
        foreach ($windows as $w) {
            $n      = (int) ($counts[$w['id']] ?? 0);
            $target = (int) $w['target'];
            [$label, $colour] = self::status($n, $target, (bool) $w['active']);
            printf(
                '<tr><td>%s</td><td>%s</td><td>%s</td><td><strong>%d</strong></td><td style="color:%s;font-weight:600">%s</td></tr>',
                esc_html(trim((string) $w['date'] . ' ' . (string) $w['time'])),
                esc_html((string) $w['role']),
                $target > 0 ? esc_html((string) $target) : '—',
                $n,
                esc_attr($colour),
                esc_html($label)
            );
        }
        echo '</tbody></table>';

        self::registrants();
        echo '</div>';
    }

    /** @return array{0:string,1:string} [label, colour] for a window's progress */
    private static function status(int $n, int $target, bool $active): array {
        if (! $active) {
            return [__('Closed', 'october-events'), '#777'];
        }
        if ($target <= 0) {
            return [__('Open', 'october-events'), '#555'];
        }
        $pct = $n / $target;
        if ($pct >= 1.0) {
            return [__('Full', 'october-events'), '#2e7d32'];
        }
        if ($pct >= 0.75) {
            return [__('Nearly there', 'october-events'), '#b86e00'];
        }
        return [__('Keep recruiting', 'october-events'), '#c62828'];
    }

    /** Signed-up count per window id. */
    private static function counts(): array {
        global $wpdb;
        $rows = $wpdb->get_col('SELECT windows FROM ' . Schema::table() . " WHERE status <> 'withdrawn'") ?: [];
        $out  = [];
        foreach ($rows as $json) {
            $ids = json_decode((string) $json, true);
            if (! is_array($ids)) {
                continue;
            }
            foreach ($ids as $id) {
                $id = (string) $id;
                $out[$id] = ($out[$id] ?? 0) + 1;
            }
        }
        return $out;
    }

    private static function total(): int {
        global $wpdb;
        return (int) $wpdb->get_var('SELECT COUNT(*) FROM ' . Schema::table() . " WHERE status <> 'withdrawn'");
    }

    /** A compact list of the most recent registrants. */
    private static function registrants(): void {
        global $wpdb;
        $rows = $wpdb->get_results('SELECT name, email, zip, created_at FROM ' . Schema::table() . " WHERE status <> 'withdrawn' ORDER BY id DESC LIMIT 200") ?: [];
        if (! $rows) {
            return;
        }
        echo '<h2 style="margin-top:24px">' . esc_html__('Registered volunteers', 'october-events') . '</h2>';
        echo '<table class="widefat striped" style="max-width:760px"><thead><tr>';
        echo '<th>' . esc_html__('Name', 'october-events') . '</th><th>' . esc_html__('Email', 'october-events') . '</th><th>' . esc_html__('ZIP', 'october-events') . '</th><th>' . esc_html__('Registered', 'october-events') . '</th>';
        echo '</tr></thead><tbody>';
        foreach ($rows as $r) {
            printf(
                '<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>',
                esc_html((string) $r->name),
                esc_html((string) $r->email),
                esc_html((string) $r->zip),
                esc_html((string) $r->created_at)
            );
        }
        echo '</tbody></table>';
    }
}
