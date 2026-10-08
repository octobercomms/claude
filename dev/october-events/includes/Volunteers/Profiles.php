<?php
declare(strict_types=1);

namespace OE\Volunteers;

use OE\VolunteerSignups;

defined('ABSPATH') || exit;

/**
 * Volunteer profiles — a year-over-year picture of each volunteer, derived from
 * their signup history (keyed by email), plus a manual "abuse flag".
 *
 * Participation, no-shows and cancels are computed live from the
 * {@see VolunteerSignups} table, so no new storage is needed for them. The only
 * stored state is the manual flag an admin raises against someone who no-showed
 * (or cancelled) yet still used their free ticket — the "we saw you" marker that
 * follows them into future years. Flags live in one option keyed by normalised
 * email; there are only ever a handful.
 *
 * Identity is the email, lower-cased and trimmed. A determined abuser can sign
 * up with a fresh address to shed their history; that raises the bar without
 * sealing it. Fuzzy name matching is a later refinement, not v1.
 */
final class Profiles {

    private const FLAGS = 'oe_volunteer_flags';

    public static function norm(string $email): string {
        return strtolower(trim($email));
    }

    /* ---- manual abuse flag ------------------------------------------------ */

    private static function flags(): array {
        $f = get_option(self::FLAGS, []);
        return is_array($f) ? $f : [];
    }

    public static function is_flagged(string $email): bool {
        $f = self::flags();
        $k = self::norm($email);
        return ! empty($f[$k]['flagged']);
    }

    /** @return array{flagged:bool,note:string,year:string,at:string} */
    public static function flag(string $email): array {
        $rec = self::flags()[self::norm($email)] ?? [];
        return [
            'flagged' => ! empty($rec['flagged']),
            'note'    => (string) ($rec['note'] ?? ''),
            'year'    => (string) ($rec['year'] ?? ''),
            'at'      => (string) ($rec['at'] ?? ''),
        ];
    }

    public static function set_flag(string $email, bool $flagged, string $note = '', string $year = ''): void {
        $email = self::norm($email);
        if ($email === '') {
            return;
        }
        $f = self::flags();
        if (! $flagged) {
            unset($f[$email]);
        } else {
            $f[$email] = [
                'flagged' => true,
                'note'    => $note,
                'year'    => $year !== '' ? $year : gmdate('Y'),
                'at'      => current_time('mysql'),
            ];
        }
        update_option(self::FLAGS, $f, false);
    }

    /* ---- profiles --------------------------------------------------------- */

    /**
     * One profile per distinct volunteer email, aggregated across all signups.
     *
     * @return array<int,array<string,mixed>> sorted most-flagged / most-active first
     */
    public static function all(): array {
        global $wpdb;
        $rows = $wpdb->get_results(
            "SELECT name, email, phone, status, checked_in, shift_start, created_at
             FROM " . VolunteerSignups::table() . " ORDER BY created_at ASC"
        ) ?: [];

        $people = [];
        foreach ($rows as $r) {
            $key = self::norm((string) $r->email);
            if ($key === '') {
                continue;
            }
            if (! isset($people[$key])) {
                $people[$key] = [
                    'email'     => (string) $r->email,
                    'name'      => (string) $r->name,
                    'phone'     => (string) $r->phone,
                    'signups'   => 0,
                    'worked'    => 0,
                    'no_show'   => 0,
                    'cancelled' => 0,
                    'declined'  => 0,
                    'pending'   => 0,
                    'years'     => [],
                ];
            }
            $p = &$people[$key];
            // Latest name/phone win (rows are ordered oldest-first).
            if ((string) $r->name !== '')  { $p['name']  = (string) $r->name; }
            if ((string) $r->phone !== '') { $p['phone'] = (string) $r->phone; }
            $p['signups']++;
            switch ((string) $r->status) {
                case VolunteerSignups::STATUS_CONFIRMED: $p['worked']++;    break;
                case VolunteerSignups::STATUS_NO_SHOW:   $p['no_show']++;   break;
                case VolunteerSignups::STATUS_CANCELLED: $p['cancelled']++; break;
                case VolunteerSignups::STATUS_DECLINED:  $p['declined']++;  break;
                default:                                 $p['pending']++;   break;
            }
            $when = (string) ($r->shift_start ?: $r->created_at);
            $yr   = $when !== '' ? substr($when, 0, 4) : '';
            if ($yr !== '') { $p['years'][$yr] = true; }
            unset($p);
        }

        $out = [];
        foreach ($people as $p) {
            $yrs = array_keys($p['years']);
            sort($yrs);
            $p['years']       = $yrs;
            $p['years_count'] = count($yrs);
            $fl               = self::flag($p['email']);
            $p['flagged']     = $fl['flagged'];
            $p['flag_note']   = $fl['note'];
            $out[] = $p;
        }

        // Flagged first, then by worked count, then by signups.
        usort($out, static function ($a, $b) {
            if ($a['flagged'] !== $b['flagged']) { return $a['flagged'] ? -1 : 1; }
            if ($a['worked'] !== $b['worked'])   { return $b['worked'] <=> $a['worked']; }
            return $b['signups'] <=> $a['signups'];
        });
        return $out;
    }

    /**
     * Cancel / no-show rates for sizing over-subscription. Scoped to a year
     * (4-digit string) when given, else all time.
     *
     * @return array{total:int,worked:int,no_show:int,cancelled:int,no_show_rate:float,cancel_rate:float}
     */
    public static function rates(string $year = ''): array {
        global $wpdb;
        $sql    = "SELECT status, shift_start, created_at FROM " . VolunteerSignups::table();
        $rows   = $wpdb->get_results($sql) ?: [];
        $total = $worked = $no_show = $cancelled = 0;
        foreach ($rows as $r) {
            if ($year !== '') {
                $when = (string) ($r->shift_start ?: $r->created_at);
                if (substr($when, 0, 4) !== $year) {
                    continue;
                }
            }
            $total++;
            switch ((string) $r->status) {
                case VolunteerSignups::STATUS_CONFIRMED: $worked++;    break;
                case VolunteerSignups::STATUS_NO_SHOW:   $no_show++;   break;
                case VolunteerSignups::STATUS_CANCELLED: $cancelled++; break;
            }
        }
        // No-show rate is of those expected to show (worked + no_show).
        $expected = $worked + $no_show;
        return [
            'total'        => $total,
            'worked'       => $worked,
            'no_show'      => $no_show,
            'cancelled'    => $cancelled,
            'no_show_rate' => $expected > 0 ? round($no_show / $expected * 100, 1) : 0.0,
            'cancel_rate'  => $total > 0 ? round($cancelled / $total * 100, 1) : 0.0,
        ];
    }
}
