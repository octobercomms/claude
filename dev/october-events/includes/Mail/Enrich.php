<?php
declare(strict_types=1);

namespace OE\Mail;

defined('ABSPATH') || exit;

/**
 * Contact "CleanUp": tidy display names and derive a company from the email
 * domain. Deterministic and cheap (no API) — it runs as a background backfill
 * and on demand, and gives the AI classifier (next phase) much better signal.
 */
final class Enrich {

    /** Domains that are personal inboxes, not companies. */
    private const FREEMAIL = [
        'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com', 'hotmail.com', 'hotmail.co.uk',
        'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'protonmail.com',
        'proton.me', 'gmx.com', 'gmx.net', 'mail.com', 'zoho.com', 'yandex.com', 'comcast.net', 'att.net',
        'sbcglobal.net', 'verizon.net', 'bellsouth.net', 'cox.net', 'pm.me',
    ];

    /** Multi-part second-level domains (so foo.co.uk → "foo", not "co"). */
    private const SLD = ['co', 'com', 'org', 'net', 'gov', 'ac', 'edu', 'sch'];

    /** Derive a company name from an email's domain, or '' for personal inboxes. */
    public static function company_from_email(string $email): string {
        $email = strtolower(trim($email));
        $at = strrpos($email, '@');
        if ($at === false) {
            return '';
        }
        $domain = preg_replace('/^www\./', '', substr($email, $at + 1));
        if ($domain === '' || in_array($domain, self::FREEMAIL, true)) {
            return '';
        }
        $parts = explode('.', $domain);
        $n = count($parts);
        if ($n < 2) {
            return '';
        }
        // Pick the registrable label: handle foo.co.uk style.
        $root = $parts[$n - 2];
        if ($n >= 3 && strlen($parts[$n - 1]) === 2 && in_array($parts[$n - 2], self::SLD, true)) {
            $root = $parts[$n - 3];
        }
        $root = str_replace(['-', '_'], ' ', $root);
        return self::titleize($root);
    }

    /**
     * Tidy a display name: fix ALL-CAPS / all-lowercase to title case, but leave
     * deliberately mixed-case names (e.g. "DeLeo", "McKinsey") alone.
     */
    public static function tidy_name(string $name): string {
        $name = trim(preg_replace('/\s+/', ' ', $name) ?? '');
        if ($name === '') {
            return '';
        }
        $words = explode(' ', $name);
        foreach ($words as $i => $w) {
            if ($w === '' || preg_match('/[0-9@]/', $w)) {
                continue;
            }
            $isUpper = $w === mb_strtoupper($w);
            $isLower = $w === mb_strtolower($w);
            if ($isUpper || $isLower) {
                $words[$i] = self::titleize($w);
            }
        }
        return implode(' ', $words);
    }

    /** Title-case a token, handling hyphens, apostrophes and the "Mc" prefix. */
    private static function titleize(string $s): string {
        $s = mb_strtolower(trim($s));
        if ($s === '') {
            return '';
        }
        // Split on hyphen / apostrophe, capitalise each piece, rejoin with the
        // same separators.
        $out = preg_replace_callback("/[^-' ]+/u", static function ($m) {
            $word = $m[0];
            $word = mb_strtoupper(mb_substr($word, 0, 1)) . mb_substr($word, 1);
            if (preg_match('/^Mc(.+)/u', $word, $mm)) {
                $word = 'Mc' . mb_strtoupper(mb_substr($mm[1], 0, 1)) . mb_substr($mm[1], 1);
            }
            return $word;
        }, $s);
        return (string) $out;
    }

    /** Enrich a single contact row (company + tidy name), marking it done. */
    public static function enrich_row(object $c): void {
        global $wpdb;
        $update = ['enriched' => 1, 'updated_at' => current_time('mysql', true)];
        if ((string) ($c->company ?? '') === '') {
            $update['company'] = self::company_from_email((string) $c->email);
        }
        $tidy = self::tidy_name((string) $c->name);
        if ($tidy !== (string) $c->name) {
            $update['name'] = $tidy;
        }
        $wpdb->update(Contacts::table(), $update, ['id' => (int) $c->id]);
    }

    /** Process up to $limit not-yet-enriched contacts. Returns how many it did. */
    public static function backfill(int $limit = 1000): int {
        global $wpdb;
        $t = Contacts::table();
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT id, email, name, company FROM {$t} WHERE enriched = 0 LIMIT %d",
            max(1, $limit)
        )) ?: [];
        foreach ($rows as $c) {
            self::enrich_row($c);
        }
        return count($rows);
    }

    /** How many contacts still need cleaning up. */
    public static function remaining(): int {
        global $wpdb;
        return (int) $wpdb->get_var('SELECT COUNT(*) FROM ' . Contacts::table() . ' WHERE enriched = 0');
    }
}
