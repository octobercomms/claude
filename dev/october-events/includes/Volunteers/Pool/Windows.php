<?php
declare(strict_types=1);

namespace OE\Volunteers\Pool;

use OE\Settings;

defined('ABSPATH') || exit;

/**
 * Recruitment windows (volunteer-pool.md step 1): date × time × role, each with
 * a target headcount (need + contingency). Stored as a settings option so the
 * admin defines the year's windows up front, before the homes/events exist.
 *
 * A window's id is a stable hash of date|time|role, so a pool registration can
 * reference windows by id and the board can count against them.
 */
final class Windows {

    /**
     * All configured windows, each: id, label, date, time, role, target, active.
     *
     * @return array<int,array<string,mixed>>
     */
    public static function all(): array {
        $raw = Settings::get('volunteer_windows', []);
        $out = [];
        foreach ((is_array($raw) ? $raw : []) as $w) {
            if (! is_array($w)) {
                continue;
            }
            $date = (string) ($w['date'] ?? '');
            $time = (string) ($w['time'] ?? '');
            $role = (string) ($w['role'] ?? '');
            if ($date === '' && $time === '' && $role === '') {
                continue;
            }
            $out[] = [
                'id'     => self::id($date, $time, $role),
                'date'   => $date,
                'time'   => $time,
                'role'   => $role,
                'target' => max(0, (int) ($w['target'] ?? 0)),
                'active' => ($w['active'] ?? '1') !== '0',
                'label'  => trim(trim($date . ' ' . $time) . ($role !== '' ? ' · ' . $role : '')),
            ];
        }
        return $out;
    }

    /** Only the windows still open for registration. */
    public static function active(): array {
        return array_values(array_filter(self::all(), static fn(array $w): bool => (bool) $w['active']));
    }

    /** A stable window id from its date/time/role. */
    public static function id(string $date, string $time, string $role): string {
        return substr(md5($date . '|' . $time . '|' . $role), 0, 12);
    }

    /** True when a window id is one of the configured windows. */
    public static function exists(string $id): bool {
        foreach (self::all() as $w) {
            if ($w['id'] === $id) {
                return true;
            }
        }
        return false;
    }

    /**
     * Parse the admin textarea (one window per line: date | time | role | target)
     * into the stored option shape.
     *
     * @return array<int,array<string,string>>
     */
    public static function parse(string $raw): array {
        $out = [];
        foreach (preg_split('/[\r\n]+/', $raw) ?: [] as $line) {
            $line = trim((string) $line);
            if ($line === '') {
                continue;
            }
            $p = array_map('trim', explode('|', $line));
            $date = sanitize_text_field((string) ($p[0] ?? ''));
            $time = sanitize_text_field((string) ($p[1] ?? ''));
            $role = sanitize_text_field((string) ($p[2] ?? ''));
            if ($date === '' && $time === '' && $role === '') {
                continue;
            }
            $out[] = [
                'date'   => $date,
                'time'   => $time,
                'role'   => $role,
                'target' => (string) max(0, (int) ($p[3] ?? 0)),
                'active' => '1',
            ];
        }
        return $out;
    }

    /** Render the stored windows back to the textarea form. */
    public static function to_text(array $windows): string {
        $lines = [];
        foreach ($windows as $w) {
            if (! is_array($w)) {
                continue;
            }
            $lines[] = implode(' | ', [
                (string) ($w['date'] ?? ''),
                (string) ($w['time'] ?? ''),
                (string) ($w['role'] ?? ''),
                (string) ($w['target'] ?? ''),
            ]);
        }
        return implode("\n", $lines);
    }
}
