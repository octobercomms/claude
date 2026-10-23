<?php
declare(strict_types=1);

namespace OE\Util;

defined('ABSPATH') || exit;

/**
 * Person-name display helpers.
 *
 * Attendee and buyer names arrive however people type them — "suzanne morris",
 * "NORRIS MAXEY", "michael f". {@see self::tc()} presents them in Title Case
 * for admin lists, tickets and the attendee sheet, WITHOUT mangling names that
 * are already correctly mixed-cased (McNamara, LilyKate, Goode-Bigelow, Jr.):
 * it only re-cases a value that is entirely lower- or entirely upper-case.
 */
final class Names {

    /** Title-case a name for display, leaving already-mixed-case names alone. */
    public static function tc(string $name): string {
        $t = trim($name);
        if ($t === '') {
            return '';
        }
        // Only re-case when the letters are all one case (clearly un-cased input).
        $letters = preg_replace('/[^\p{L}]/u', '', $t) ?? '';
        if ($letters === '') {
            return $t;
        }
        $lower = function_exists('mb_strtolower') ? mb_strtolower($letters, 'UTF-8') : strtolower($letters);
        $upper = function_exists('mb_strtoupper') ? mb_strtoupper($letters, 'UTF-8') : strtoupper($letters);
        if ($letters !== $lower && $letters !== $upper) {
            return $t; // already has deliberate mixed case — don't touch it
        }

        $t = function_exists('mb_strtolower') ? mb_strtolower($t, 'UTF-8') : strtolower($t);
        // Capitalise the first letter of each word, and after hyphens/apostrophes.
        $t = (string) preg_replace_callback('/(^|[\s\-\x27\x{2019}.])(\p{L})/u', static function (array $m): string {
            $up = function_exists('mb_strtoupper') ? mb_strtoupper($m[2], 'UTF-8') : strtoupper($m[2]);
            return $m[1] . $up;
        }, $t);
        return $t;
    }
}
