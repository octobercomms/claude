<?php
declare(strict_types=1);

namespace OE\Survey;

use OE\Settings;

defined('ABSPATH') || exit;

/**
 * Survey results: aggregates the stored responses per question and renders a
 * compact report (response counts, rating distributions, option bars, open-text
 * and testimonials) plus a CSV export.
 *
 * Anonymous to read: no name or email is ever shown next to an answer. Responses
 * can be split by `segment` (the ticket type snapshot) so feedback is read in
 * context, with a minimum-group guardrail so a one-person segment can't be
 * singled out.
 *
 * @see docs/october-events/POST-EVENT-SURVEY-SPEC.md §7a, §10
 */
final class Results {

    /** A segment must have at least this many responses to render on its own. */
    private const MIN_SEGMENT = 4;

    /** @return string[] distinct segments with enough responses to show */
    public static function segments(int $event_id): array {
        $counts = [];
        foreach (Responses::for_event($event_id, true) as $r) {
            $seg = (string) $r['segment'];
            if ($seg === '') {
                continue;
            }
            $counts[$seg] = ($counts[$seg] ?? 0) + 1;
        }
        $out = [];
        foreach ($counts as $seg => $n) {
            if ($n >= self::MIN_SEGMENT) {
                $out[] = $seg;
            }
        }
        sort($out);
        return $out;
    }

    /**
     * Render the results panel for the builder. Empty string when there is
     * nothing to show yet.
     */
    public static function render(int $event_id, string $segment = ''): string {
        $stats = Responses::stats($event_id);
        if ($stats['total'] === 0) {
            return '';
        }
        $rows = Responses::for_event($event_id, true);
        if ($segment !== '') {
            $rows = array_values(array_filter($rows, static fn(array $r): bool => (string) $r['segment'] === $segment));
        }
        $questions = Config::questions($event_id);
        $accent = sanitize_hex_color((string) Settings::get('theme_accent', '')) ?: '#E7CD41';

        ob_start();
        echo '<div class="oe-svy-results">';
        echo '<p class="oe-svy-results-head"><strong>' . (int) $stats['complete'] . '</strong> '
            . esc_html__('completed', 'october-events');
        if ($stats['partial'] > 0) {
            echo ' · <strong>' . (int) $stats['partial'] . '</strong> ' . esc_html__('started but not finished', 'october-events');
        }
        echo '</p>';

        foreach ($questions as $q) {
            echo '<div class="oe-svy-q">';
            echo '<div class="oe-svy-q-label">' . esc_html((string) $q['label']) . '</div>';
            self::render_question($q, $rows, $accent);
            echo '</div>';
        }
        echo '</div>';
        return (string) ob_get_clean();
    }

    /**
     * @param array<string,mixed> $q
     * @param array<int,array<string,mixed>> $rows
     */
    private static function render_question(array $q, array $rows, string $accent): void {
        $id   = (string) $q['id'];
        $type = (string) $q['type'];

        switch ($type) {
            case 'rating':
                $vals = [];
                foreach ($rows as $r) {
                    $v = (int) ($r['answers'][$id] ?? 0);
                    if ($v >= 1 && $v <= 5) {
                        $vals[] = $v;
                    }
                }
                self::rating_bars($vals, $accent);
                break;

            case 'choice':
            case 'multi':
                $tally = [];
                foreach ((array) ($q['options'] ?? []) as $opt) {
                    $tally[(string) $opt] = 0;
                }
                $answered = 0;
                foreach ($rows as $r) {
                    if (! isset($r['answers'][$id])) {
                        continue;
                    }
                    $answered++;
                    foreach ((array) $r['answers'][$id] as $picked) {
                        $picked = (string) $picked;
                        // Count every stored pick, including ones whose option text
                        // was later edited/removed, so results are never silently
                        // dropped when the question is changed after responses come in.
                        $tally[$picked] = ($tally[$picked] ?? 0) + 1;
                    }
                }
                self::option_bars($tally, $answered, $accent);
                break;

            case 'session_rating':
                $per = [];
                foreach ((array) ($q['sessions'] ?? []) as $s) {
                    $per[(string) $s] = [];
                }
                foreach ($rows as $r) {
                    foreach ((array) ($r['answers'][$id] ?? []) as $skey => $entry) {
                        $skey = (string) $skey;
                        if ($skey === '_comment') {
                            continue;
                        }
                        $rating = (int) (is_array($entry) ? ($entry['rating'] ?? 0) : $entry);
                        if (isset($per[$skey]) && $rating >= 1 && $rating <= 5) {
                            $per[$skey][] = $rating;
                        }
                    }
                }
                echo '<div class="oe-svy-sessions">';
                foreach ($per as $name => $vals) {
                    $avg = $vals ? array_sum($vals) / count($vals) : 0;
                    echo '<div class="oe-svy-srow"><span class="oe-svy-sname">' . esc_html($name) . '</span>'
                        . '<span class="oe-svy-savg">' . ($vals ? esc_html(number_format($avg, 1)) : '—')
                        . '</span><span class="oe-svy-sn">' . count($vals) . '</span></div>';
                }
                echo '</div>';
                break;

            case 'open':
                self::text_list(array_map(
                    static fn(array $r) => (string) ($r['answers'][$id] ?? ''),
                    $rows
                ));
                break;

            case 'testimonial':
                $items = [];
                foreach ($rows as $r) {
                    $a = $r['answers'][$id] ?? null;
                    if (is_array($a) && (string) ($a['text'] ?? '') !== '') {
                        $items[] = $a;
                    }
                }
                if ($items === []) {
                    echo '<p class="oe-svy-empty">' . esc_html__('No quotes yet.', 'october-events') . '</p>';
                    break;
                }
                echo '<ul class="oe-svy-quotes">';
                foreach ($items as $a) {
                    $consent = (string) ($a['consent'] ?? 'no');
                    $badge = $consent === 'named'
                        ? __('may use with name', 'october-events')
                        : ($consent === 'anon' ? __('may use anonymously', 'october-events') : __('internal only', 'october-events'));
                    echo '<li>“' . esc_html((string) $a['text']) . '” <span class="oe-svy-consent oe-svy-consent--' . esc_attr($consent) . '">' . esc_html($badge) . '</span></li>';
                }
                echo '</ul>';
                break;
        }
    }

    /** @param int[] $vals */
    private static function rating_bars(array $vals, string $accent): void {
        $total = count($vals);
        $avg   = $total ? array_sum($vals) / $total : 0;
        echo '<div class="oe-svy-avg">' . esc_html(number_format($avg, 1)) . ' / 5 <span>('
            . (int) $total . ')</span></div>';
        for ($star = 5; $star >= 1; $star--) {
            $n   = count(array_filter($vals, static fn(int $v): bool => $v === $star));
            $pct = $total ? (int) round($n / $total * 100) : 0;
            echo '<div class="oe-svy-bar"><span class="oe-svy-bk">' . (int) $star . '</span>'
                . '<span class="oe-svy-track"><span class="oe-svy-fill" style="width:' . (int) $pct . '%;background:' . esc_attr($accent) . '"></span></span>'
                . '<span class="oe-svy-bn">' . (int) $n . '</span></div>';
        }
    }

    /**
     * @param array<string,int> $tally
     */
    private static function option_bars(array $tally, int $answered, string $accent): void {
        foreach ($tally as $label => $n) {
            $pct = $answered ? (int) round($n / $answered * 100) : 0;
            echo '<div class="oe-svy-bar"><span class="oe-svy-bk oe-svy-bk--wide">' . esc_html((string) $label) . '</span>'
                . '<span class="oe-svy-track"><span class="oe-svy-fill" style="width:' . (int) $pct . '%;background:' . esc_attr($accent) . '"></span></span>'
                . '<span class="oe-svy-bn">' . (int) $n . '</span></div>';
        }
    }

    /** @param string[] $texts */
    private static function text_list(array $texts): void {
        $texts = array_values(array_filter(array_map('trim', $texts), static fn(string $t): bool => $t !== ''));
        if ($texts === []) {
            echo '<p class="oe-svy-empty">' . esc_html__('No answers yet.', 'october-events') . '</p>';
            return;
        }
        echo '<ul class="oe-svy-open">';
        foreach ($texts as $t) {
            echo '<li>' . esc_html($t) . '</li>';
        }
        echo '</ul>';
    }

    /* ------------------------------------------------------------------ *
     * CSV export (de-identified: segment + answers, never name/email)
     * ------------------------------------------------------------------ */

    public static function csv(int $event_id): string {
        $questions = Config::questions($event_id);
        $header = ['response', 'status', 'segment', 'submitted_at'];
        foreach ($questions as $q) {
            $header[] = (string) $q['label'];
        }
        $lines = [self::csv_row($header)];

        $i = 0;
        foreach (Responses::for_event($event_id, false) as $r) {
            $i++;
            $row = [(string) $i, (string) $r['status'], (string) $r['segment'], (string) $r['submitted_at']];
            foreach ($questions as $q) {
                $row[] = self::flatten_answer($q, $r['answers'][(string) $q['id']] ?? null);
            }
            $lines[] = self::csv_row($row);
        }
        return implode("\r\n", $lines) . "\r\n";
    }

    /**
     * @param array<string,mixed> $q
     * @param mixed $value
     */
    private static function flatten_answer(array $q, $value): string {
        if ($value === null || $value === '') {
            return '';
        }
        $type = (string) $q['type'];
        if ($type === 'multi') {
            return implode('; ', array_map('strval', (array) $value));
        }
        if ($type === 'session_rating') {
            $parts = [];
            foreach ((array) $value as $s => $entry) {
                if ($s === '_comment') {
                    $parts[] = 'comment: ' . (string) $entry;
                    continue;
                }
                $rating = is_array($entry) ? ($entry['rating'] ?? '') : $entry;
                $parts[] = $s . '=' . $rating;
            }
            return implode('; ', $parts);
        }
        if ($type === 'testimonial') {
            $v = (array) $value;
            return (string) ($v['text'] ?? '') . ' [' . (string) ($v['consent'] ?? 'no') . ']';
        }
        return (string) $value;
    }

    /** @param array<int,string> $fields */
    private static function csv_row(array $fields): string {
        return implode(',', array_map(static function (string $f): string {
            // Neutralise spreadsheet formula injection: a cell that begins with
            // =, +, -, @ (or a leading tab/CR) is executed as a formula by Excel
            // and Sheets. Attendee-supplied open text and testimonials land in the
            // CSV, so prefix such cells with a single quote before quoting.
            if ($f !== '' && strpos("=+-@\t\r", $f[0]) !== false) {
                $f = "'" . $f;
            }
            $f = str_replace('"', '""', $f);
            return '"' . $f . '"';
        }, $fields));
    }
}
