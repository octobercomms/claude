<?php
declare(strict_types=1);

namespace OE\GuidedTours;

use OE\Settings;

defined('ABSPATH') || exit;

/**
 * Guided-tour time slots, stored as post meta on a tour Location post. A location
 * can carry many slots (e.g. every 30 minutes over two days), each with its own
 * capacity. Internal time is 24-hour "H:i"; the front end always renders 12-hour.
 *
 * @phpstan-type Slot array{uid:string,date:string,start:string,capacity:int,active:bool}
 */
final class Slots {

    private const META = '_oe_gt_slots';

    /** @return array<int,array{uid:string,date:string,start:string,capacity:int,active:bool}> ordered */
    public static function all(int $location_id): array {
        $raw = get_post_meta($location_id, self::META, true);
        if (! is_array($raw)) {
            return [];
        }
        $default = self::default_capacity($location_id);
        $out = [];
        foreach ($raw as $s) {
            if (! is_array($s) || empty($s['uid'])) {
                continue;
            }
            $out[] = [
                'uid'      => (string) $s['uid'],
                'date'     => (string) ($s['date'] ?? ''),
                'start'    => (string) ($s['start'] ?? ''),
                'capacity' => max(1, (int) ($s['capacity'] ?? $default)),
                'active'   => ! empty($s['active']),
            ];
        }
        usort($out, static fn($a, $b) => strcmp($a['date'] . $a['start'], $b['date'] . $b['start']));
        return $out;
    }

    /** @return array{uid:string,date:string,start:string,capacity:int,active:bool}|null */
    public static function get(int $location_id, string $uid): ?array {
        foreach (self::all($location_id) as $s) {
            if ($s['uid'] === $uid) {
                return $s;
            }
        }
        return null;
    }

    /** A slot's start as a UTC timestamp (site timezone → UTC), 0 if unparseable. */
    public static function start_ts(int $location_id, string $uid): int {
        $s = self::get($location_id, $uid);
        if (! $s || $s['date'] === '' || $s['start'] === '') {
            return 0;
        }
        try {
            return (new \DateTime($s['date'] . ' ' . $s['start'], wp_timezone()))->getTimestamp();
        } catch (\Exception $e) {
            return 0;
        }
    }

    /**
     * Persist a cleaned slot list (from the metabox). Each incoming row is
     * {uid?, date, start, capacity, inactive?}. Rows without a date+time drop.
     *
     * @param array<int,array<string,mixed>> $rows
     */
    public static function save(int $location_id, array $rows): void {
        $default = self::default_capacity($location_id);
        $clean   = [];
        foreach ($rows as $r) {
            $date  = self::clean_date((string) ($r['date'] ?? ''));
            $start = self::clean_time((string) ($r['start'] ?? ''));
            if ($date === '' || $start === '') {
                continue;
            }
            $uid = isset($r['uid']) ? preg_replace('/[^a-z0-9]/', '', strtolower((string) $r['uid'])) : '';
            if ($uid === '') {
                $uid = substr(md5($date . $start . wp_generate_password(8, false)), 0, 10);
            }
            $clean[$uid] = [
                'uid'      => $uid,
                'date'     => $date,
                'start'    => $start,
                'capacity' => max(1, (int) ($r['capacity'] ?? $default)),
                'active'   => empty($r['inactive']),
            ];
        }
        update_post_meta($location_id, self::META, array_values($clean));
    }

    /**
     * Add a run of slots at a fixed interval across a date range, merging into
     * any existing slots (skips a date+time already present). Returns how many
     * were added.
     */
    public static function generate(int $location_id, string $from_date, string $to_date, string $start_time, string $end_time, int $interval_mins, int $capacity): int {
        $interval_mins = max(5, $interval_mins);
        $from = self::clean_date($from_date);
        $to   = self::clean_date($to_date);
        $s    = self::clean_time($start_time);
        $e    = self::clean_time($end_time);
        if ($from === '' || $to === '' || $s === '' || $e === '') {
            return 0;
        }
        $startMin = self::mins($s);
        $endMin   = self::mins($e);
        if ($endMin <= $startMin) {
            return 0;
        }
        $existing = self::all($location_id);
        $seen     = [];
        foreach ($existing as $slot) {
            $seen[$slot['date'] . ' ' . $slot['start']] = true;
        }
        $cap = max(1, $capacity ?: self::default_capacity($location_id));
        try {
            $d0 = new \DateTimeImmutable($from);
            $d1 = new \DateTimeImmutable($to);
        } catch (\Exception $ex) {
            return 0;
        }
        $added = 0;
        for ($d = $d0; $d <= $d1; $d = $d->modify('+1 day')) {
            $day = $d->format('Y-m-d');
            for ($m = $startMin; $m < $endMin; $m += $interval_mins) {
                $hm  = sprintf('%02d:%02d', intdiv($m, 60), $m % 60);
                $key = $day . ' ' . $hm;
                if (isset($seen[$key])) {
                    continue;
                }
                $seen[$key]  = true;
                $existing[]  = [
                    'uid'      => substr(md5($key . wp_generate_password(8, false)), 0, 10),
                    'date'     => $day,
                    'start'    => $hm,
                    'capacity' => $cap,
                    'active'   => true,
                ];
                $added++;
            }
        }
        if ($added > 0) {
            self::save($location_id, $existing);
        }
        return $added;
    }

    /** The location's default per-slot capacity (its own override, else the global setting). */
    public static function default_capacity(int $location_id): int {
        // The location CPT is a JetEngine type, so a per-building override is a
        // raw `slot_capacity` meta value (blank on most buildings).
        $own = (int) get_post_meta($location_id, 'slot_capacity', true);
        if ($own > 0) {
            return $own;
        }
        $global = (int) Settings::get('guided_default_capacity', 30);
        return $global > 0 ? $global : 30;
    }

    private static function mins(string $hm): int {
        $p = explode(':', $hm);
        return ((int) ($p[0] ?? 0)) * 60 + (int) ($p[1] ?? 0);
    }

    private static function clean_date(string $v): string {
        $v = trim($v);
        return preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) ? $v : '';
    }

    private static function clean_time(string $v): string {
        $v = trim($v);
        if (preg_match('/^(\d{1,2}):(\d{2})/', $v, $m)) {
            $h = min(23, max(0, (int) $m[1]));
            $i = min(59, max(0, (int) $m[2]));
            return sprintf('%02d:%02d', $h, $i);
        }
        return '';
    }
}
