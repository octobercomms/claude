<?php
declare(strict_types=1);

namespace OE\Reports;

use OE\Ticketing\Schema;

defined('ABSPATH') || exit;

/**
 * Dashboard analytics (ADMIN-BUILD AD1).
 *
 * Real figures behind the admin Dashboard's charts: a ranged sales-over-time
 * series, sales by event, and the price-paid distribution. Reads the plugin's
 * own ticketing tables (oe_tickets / oe_orders); every query guards on the table
 * existing, so a fresh install renders empty rather than erroring.
 *
 * A "ticket" is one admission (a row in oe_tickets with status active). Revenue
 * is the sum of paid order totals.
 */
final class DashboardStats {

    private static function has(string $table): bool {
        global $wpdb;
        return (string) $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table)) === $table;
    }

    /**
     * Ticket counts per range for the sales-over-time chart.
     *
     * @return array{series:array<string,array<int,int>>, labels:array<string,string>}
     */
    public static function chart_series(): array {
        global $wpdb;
        $t = Schema::tickets();
        $labels = [
            '7' => __('last 7 days', 'october-events'),
            '30' => __('last 30 days', 'october-events'),
            '90' => __('last 90 days', 'october-events'),
            'ytd' => __('year to date, by week', 'october-events'),
            'all' => __('all time, by week', 'october-events'),
        ];
        $empty = ['7' => [], '30' => [], '90' => [], 'ytd' => [], 'all' => []];
        if (! self::has($t)) {
            return ['series' => $empty, 'labels' => $labels];
        }

        // Daily counts for the last year, then slice/bin in PHP.
        $since = gmdate('Y-m-d', time() - 365 * DAY_IN_SECONDS);
        $rows  = $wpdb->get_results($wpdb->prepare(
            "SELECT DATE(created_at) d, COUNT(*) c FROM {$t} WHERE status='active' AND created_at >= %s GROUP BY DATE(created_at)",
            $since
        )) ?: [];
        $byDay = [];
        foreach ($rows as $r) {
            $byDay[(string) $r->d] = (int) $r->c;
        }

        $daily = static function (int $n) use ($byDay): array {
            $out = [];
            for ($i = $n - 1; $i >= 0; $i--) {
                $day = gmdate('Y-m-d', time() - $i * DAY_IN_SECONDS);
                $out[] = $byDay[$day] ?? 0;
            }
            return $out;
        };

        // Year to date, binned by ISO week.
        $jan1 = (int) current_time('Y') . '-01-01';
        $ytd  = [];
        foreach ($byDay as $day => $c) {
            if ($day >= $jan1) {
                $wk = (int) gmdate('W', (int) strtotime($day));
                $ytd[$wk] = ($ytd[$wk] ?? 0) + $c;
            }
        }
        ksort($ytd);
        $ytd = array_values($ytd);

        // All time by week (independent of the 1-year daily window).
        $all = [];
        if (self::has($t)) {
            $wkRows = $wpdb->get_results("SELECT YEARWEEK(created_at,3) yw, COUNT(*) c FROM {$t} WHERE status='active' GROUP BY YEARWEEK(created_at,3) ORDER BY yw") ?: [];
            foreach ($wkRows as $r) {
                $all[] = (int) $r->c;
            }
            $all = array_slice($all, -52);
        }

        return [
            'series' => [
                '7'   => $daily(7),
                '30'  => $daily(30),
                '90'  => $daily(90),
                'ytd' => $ytd,
                'all' => $all,
            ],
            'labels' => $labels,
        ];
    }

    /**
     * Tickets and revenue per event, highest revenue first.
     *
     * @return array<int,array{name:string,tickets:int,revenue:float}>
     */
    public static function sales_by_event(int $limit = 12): array {
        global $wpdb;
        $tickets = Schema::tickets();
        $orders  = Schema::orders();
        $rows    = [];
        if (self::has($tickets)) {
            foreach ($wpdb->get_results("SELECT event_id, COUNT(*) c FROM {$tickets} WHERE status='active' GROUP BY event_id") ?: [] as $r) {
                $rows[(int) $r->event_id]['tickets'] = (int) $r->c;
            }
        }
        if (self::has($orders)) {
            foreach ($wpdb->get_results("SELECT event_id, COALESCE(SUM(total),0) r FROM {$orders} WHERE status='paid' GROUP BY event_id") ?: [] as $r) {
                $rows[(int) $r->event_id]['revenue'] = (float) $r->r;
            }
        }
        $out = [];
        foreach ($rows as $event_id => $v) {
            $title = $event_id ? get_the_title($event_id) : '';
            $out[] = [
                'name'    => $title !== '' ? $title : sprintf(__('Event #%d', 'october-events'), $event_id),
                'tickets' => (int) ($v['tickets'] ?? 0),
                'revenue' => (float) ($v['revenue'] ?? 0),
            ];
        }
        usort($out, static function ($a, $b) {
            return ($b['revenue'] <=> $a['revenue']) ?: ($b['tickets'] <=> $a['tickets']);
        });
        return array_slice($out, 0, max(1, $limit));
    }

    /**
     * Price-paid distribution: buckets for the donut, plus summary mini-stats.
     *
     * @return array{buckets:array<int,array{label:string,count:int,pct:int,color:string}>,summary:array<int,array{0:string,1:string,2:string}>,donut:string,free_pct:int}
     */
    public static function price(): array {
        global $wpdb;
        $orders = Schema::orders();
        $defs = [
            ['label' => __('Free', 'october-events'),     'max' => 0.0,    'color' => '#e3e2db'],
            ['label' => '$0–10',   'max' => 10.0,   'color' => 'rgba(221,75,20,.25)'],
            ['label' => '$10–25',  'max' => 25.0,   'color' => 'rgba(221,75,20,.45)'],
            ['label' => '$25–50',  'max' => 50.0,   'color' => 'rgba(221,75,20,.65)'],
            ['label' => '$50–100', 'max' => 100.0,  'color' => 'rgba(221,75,20,.85)'],
            ['label' => '$100+',   'max' => INF,    'color' => '#dd4b14'],
        ];
        $counts  = array_fill(0, count($defs), 0);
        $total   = 0;
        $revenue = 0.0;

        if (self::has($orders)) {
            $rows = $wpdb->get_results("SELECT total, qty, status FROM {$orders} WHERE status IN ('paid','comp')") ?: [];
            foreach ($rows as $r) {
                $qty   = max(1, (int) $r->qty);
                $tot   = (float) $r->total;
                $per   = $tot / $qty;
                $total += $qty;
                if ((string) $r->status === 'paid') {
                    $revenue += $tot;
                }
                foreach ($defs as $i => $d) {
                    if (($i === 0 && $per <= 0.00001) || ($i > 0 && $per > $defs[$i - 1]['max'] && $per <= $d['max'])) {
                        $counts[$i] += $qty;
                        break;
                    }
                }
            }
        }

        $buckets = [];
        $segments = [];
        $acc = 0.0;
        foreach ($defs as $i => $d) {
            $c   = $counts[$i];
            if ($c === 0) {
                continue;
            }
            $pct = $total > 0 ? (int) round($c / $total * 100) : 0;
            $buckets[] = ['label' => $d['label'], 'count' => $c, 'pct' => $pct, 'color' => $d['color']];
        }
        // Donut as a conic-gradient from the real shares.
        $stops = '';
        $acc   = 0.0;
        foreach ($buckets as $b) {
            $start = $acc;
            $acc  += $total > 0 ? ($b['count'] / $total * 100) : 0;
            $stops .= sprintf('%s %.2f%% %.2f%%,', $b['color'], $start, $acc);
        }
        $donut = $stops !== '' ? 'conic-gradient(' . rtrim($stops, ',') . ')' : 'conic-gradient(#f3f3f3 0 100%)';

        $free    = $counts[0];
        $paid    = $total - $free;
        $free_pct = $total > 0 ? (int) round($free / $total * 100) : 0;
        $money = static fn(float $v): string => '$' . number_format($v, 2);
        $summary = [
            [__('Tickets', 'october-events'), number_format_i18n($total), __('admissions counted', 'october-events')],
            [__('Free', 'october-events'), number_format_i18n($free) . ' · ' . $free_pct . '%', __('given away', 'october-events')],
            [__('Paid', 'october-events'), number_format_i18n($paid), __('tickets paid for', 'october-events')],
            [__('Avg / ticket', 'october-events'), $total > 0 ? $money($revenue / $total) : '$0.00', __('across all', 'october-events')],
            [__('Avg paid', 'october-events'), $paid > 0 ? $money($revenue / $paid) : '$0.00', __('excludes free', 'october-events')],
            [__('Revenue', 'october-events'), $money($revenue), __('collected', 'october-events')],
        ];

        return ['buckets' => $buckets, 'summary' => $summary, 'donut' => $donut, 'free_pct' => $free_pct];
    }
}
