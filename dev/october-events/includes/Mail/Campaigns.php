<?php
declare(strict_types=1);

namespace OE\Mail;

use OE\Settings;

defined('ABSPATH') || exit;

/**
 * Email campaigns — store, audience resolution, throttled bulk send, and
 * open/click tracking. Phase 4 of the email platform.
 *
 * A campaign holds the builder's block JSON + the rendered HTML. Sending
 * resolves the audience to native {@see Contacts}, queues one {@see oe_messages}
 * row per recipient (skipping suppressed addresses), and a per-minute cron tick
 * drains the queue in batches through the site Mailer (SES), injecting the
 * open pixel, click-tracking links and the List-Unsubscribe footer/headers.
 */
final class Campaigns {

    private const BATCH = 100; // messages per cron tick (well within SES rates)

    /** @var array<int,string> */
    public const STATUSES = ['draft', 'scheduled', 'sending', 'sent', 'paused'];

    public static function campaigns_table(): string {
        global $wpdb;
        return $wpdb->prefix . 'oe_campaigns';
    }

    public static function messages_table(): string {
        global $wpdb;
        return $wpdb->prefix . 'oe_messages';
    }

    public static function install(): void {
        global $wpdb;
        $charset = $wpdb->get_charset_collate();
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $c = self::campaigns_table();
        $m = self::messages_table();
        dbDelta("CREATE TABLE {$c} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            name VARCHAR(190) NOT NULL DEFAULT '',
            subject VARCHAR(255) NOT NULL DEFAULT '',
            preheader VARCHAR(255) NOT NULL DEFAULT '',
            body_html LONGTEXT NULL,
            body_json LONGTEXT NULL,
            audience VARCHAR(255) NOT NULL DEFAULT 'subscribed',
            status VARCHAR(20) NOT NULL DEFAULT 'draft',
            scheduled_at DATETIME NULL,
            sent_at DATETIME NULL,
            total INT NOT NULL DEFAULT 0,
            sent INT NOT NULL DEFAULT 0,
            failed INT NOT NULL DEFAULT 0,
            opened INT NOT NULL DEFAULT 0,
            clicked INT NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY status (status)
        ) {$charset};");
        dbDelta("CREATE TABLE {$m} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            campaign_id BIGINT UNSIGNED NOT NULL,
            email VARCHAR(190) NOT NULL,
            name VARCHAR(190) NOT NULL DEFAULT '',
            token VARCHAR(32) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'queued',
            opened TINYINT(1) NOT NULL DEFAULT 0,
            clicked TINYINT(1) NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL,
            sent_at DATETIME NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY token (token),
            KEY campaign_id (campaign_id),
            KEY status (status)
        ) {$charset};");
    }

    /* ------------------------------------------------------------------ *
     * CRUD
     * ------------------------------------------------------------------ */

    public static function get(int $id): ?object {
        global $wpdb;
        return $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::campaigns_table() . ' WHERE id = %d', $id)) ?: null;
    }

    /** @return array<int,object> */
    public static function all(): array {
        global $wpdb;
        return $wpdb->get_results('SELECT * FROM ' . self::campaigns_table() . ' ORDER BY id DESC LIMIT 200') ?: [];
    }

    /** @param array<string,mixed> $data */
    public static function save(array $data, int $id = 0): int {
        global $wpdb;
        $now = current_time('mysql', true);
        $row = [
            'name'      => sanitize_text_field((string) ($data['name'] ?? '')),
            'subject'   => sanitize_text_field((string) ($data['subject'] ?? '')),
            'preheader' => sanitize_text_field((string) ($data['preheader'] ?? '')),
            'body_html' => (string) ($data['body_html'] ?? ''),
            'body_json' => is_string($data['body_json'] ?? null) ? $data['body_json'] : wp_json_encode($data['body_json'] ?? null),
            'audience'  => self::clean_audience((string) ($data['audience'] ?? 'subscribed')),
            'updated_at' => $now,
        ];
        if (isset($data['scheduled_at'])) {
            $row['scheduled_at'] = $data['scheduled_at'] ? gmdate('Y-m-d H:i:s', (int) strtotime((string) $data['scheduled_at'])) : null;
        }
        if ($id) {
            $wpdb->update(self::campaigns_table(), $row, ['id' => $id]);
            return $id;
        }
        $row['status']     = 'draft';
        $row['created_at'] = $now;
        $wpdb->insert(self::campaigns_table(), $row);
        return (int) $wpdb->insert_id;
    }

    public static function delete(int $id): void {
        global $wpdb;
        $wpdb->delete(self::campaigns_table(), ['id' => $id]);
        $wpdb->delete(self::messages_table(), ['campaign_id' => $id]);
    }

    /** @return array<string,mixed> */
    public static function dto(object $c): array {
        return [
            'id'        => (int) $c->id,
            'name'      => $c->name,
            'subject'   => $c->subject,
            'preheader' => $c->preheader,
            'body_html' => $c->body_html,
            'body_json' => $c->body_json,
            'audience'  => $c->audience,
            'status'    => $c->status,
            'scheduled_at' => $c->scheduled_at,
            'sent_at'   => $c->sent_at,
            'stats'     => [
                'total'   => (int) $c->total,
                'sent'    => (int) $c->sent,
                'failed'  => (int) $c->failed,
                'opened'  => (int) $c->opened,
                'clicked' => (int) $c->clicked,
            ],
        ];
    }

    /* ------------------------------------------------------------------ *
     * Audiences
     * ------------------------------------------------------------------ */

    /** A campaign can target several audiences at once (comma-separated keys). */
    private static function clean_audience(string $a): string {
        $clean = [];
        foreach (array_map('trim', explode(',', $a)) as $key) {
            $v = self::clean_audience_key($key);
            if ($v !== '' && ! in_array($v, $clean, true)) {
                $clean[] = $v;
            }
        }
        return $clean ? implode(',', $clean) : 'subscribed';
    }

    private static function clean_audience_key(string $a): string {
        $a = sanitize_text_field($a);
        if ($a === 'subscribed' || $a === 'sms') {
            return $a;
        }
        if (strpos($a, 'source:') === 0) {
            return 'source:' . sanitize_key(substr($a, 7));
        }
        if (strpos($a, 'list:') === 0) {
            return 'list:' . (int) substr($a, 5);
        }
        return '';
    }

    /** @return array<int,array{key:string,label:string,count:int}> */
    public static function audiences(): array {
        global $wpdb;
        $t = Contacts::table();
        $out = [
            ['key' => 'subscribed', 'label' => 'All subscribers', 'count' => (int) $wpdb->get_var("SELECT COUNT(*) FROM {$t} WHERE status='subscribed'")],
            ['key' => 'sms', 'label' => 'SMS opt-in', 'count' => (int) $wpdb->get_var("SELECT COUNT(*) FROM {$t} WHERE status='subscribed' AND sms_opt_in=1")],
        ];
        // Lists (only those with at least one member).
        foreach (Lists::all() as $l) {
            if ((int) $l->member_count > 0) {
                $out[] = ['key' => 'list:' . (int) $l->id, 'label' => 'List: ' . $l->name, 'count' => (int) $l->member_count];
            }
        }
        $sources = $wpdb->get_results("SELECT source, COUNT(*) AS n FROM {$t} WHERE status='subscribed' AND source<>'' GROUP BY source") ?: [];
        foreach ($sources as $s) {
            $out[] = ['key' => 'source:' . $s->source, 'label' => 'Source: ' . ucfirst((string) $s->source), 'count' => (int) $s->n];
        }
        return $out;
    }

    /** Resolve one or more comma-separated audiences, de-duplicated by email. */
    private static function resolve(string $audience): array {
        $keys = array_filter(array_map('trim', explode(',', $audience)));
        if (! $keys) {
            $keys = ['subscribed'];
        }
        $by_email = [];
        foreach ($keys as $key) {
            foreach (self::resolve_one($key) as $r) {
                $email = strtolower(trim((string) $r->email));
                if ($email !== '' && ! isset($by_email[$email])) {
                    $by_email[$email] = $r;
                }
            }
        }
        return array_values($by_email);
    }

    /** @return array<int,object> resolved recipients (email, name) for a single key */
    private static function resolve_one(string $audience): array {
        global $wpdb;
        $t = Contacts::table();
        if ($audience === 'sms') {
            return $wpdb->get_results("SELECT email, name FROM {$t} WHERE status='subscribed' AND sms_opt_in=1") ?: [];
        }
        if (strpos($audience, 'source:') === 0) {
            return $wpdb->get_results($wpdb->prepare("SELECT email, name FROM {$t} WHERE status='subscribed' AND source=%s", substr($audience, 7))) ?: [];
        }
        if (strpos($audience, 'list:') === 0) {
            return Lists::member_recipients((int) substr($audience, 5));
        }
        return $wpdb->get_results("SELECT email, name FROM {$t} WHERE status='subscribed'") ?: [];
    }

    /* ------------------------------------------------------------------ *
     * Send
     * ------------------------------------------------------------------ */

    /** Queue a campaign for sending (or schedule it). Returns recipients queued. */
    public static function send(int $id): int {
        $c = self::get($id);
        if (! $c || in_array($c->status, ['sending', 'sent'], true)) {
            return 0;
        }
        global $wpdb;
        $now = current_time('mysql', true);
        $queued = 0;
        foreach (self::resolve($c->audience) as $r) {
            $email = strtolower(trim((string) $r->email));
            if (! is_email($email) || Suppression::is_suppressed($email)) {
                continue;
            }
            $ok = $wpdb->query($wpdb->prepare(
                'INSERT IGNORE INTO ' . self::messages_table() . ' (campaign_id, email, name, token, status, created_at) VALUES (%d, %s, %s, %s, %s, %s)',
                $id, $email, (string) $r->name, self::token(), 'queued', $now
            ));
            if ($ok) { $queued++; }
        }
        $future = $c->scheduled_at && strtotime((string) $c->scheduled_at) > time();
        $wpdb->update(self::campaigns_table(), [
            'status'     => $future ? 'scheduled' : 'sending',
            'total'      => $queued,
            'updated_at' => $now,
        ], ['id' => $id]);
        // Flag active work + kick an immediate run (the per-minute cron and the
        // traffic-driven fallback drain the rest).
        update_option('oe_campaigns_active', 1);
        if (! $future) {
            wp_schedule_single_event(time() + 1, \OE\Cron::HOOK_DISPATCH);
            if (function_exists('spawn_cron')) { spawn_cron(); }
        }
        return $queued;
    }

    /**
     * Traffic-driven fallback (hooked on `init`): if there are campaigns to send
     * and WP-cron hasn't drained them, do a batch now — throttled to once a
     * minute so a quiet site still sends. Cheap when idle: the active flag is an
     * autoloaded option.
     */
    public static function maybe_dispatch(): void {
        if (! get_option('oe_campaigns_active')) {
            return;
        }
        if (get_transient('oe_dispatch_lock')) {
            return;
        }
        set_transient('oe_dispatch_lock', 1, 55);
        self::dispatch();
    }

    /** Cron tick: promote due scheduled campaigns and drain a batch of the queue. */
    public static function dispatch(): void {
        global $wpdb;
        $now = current_time('mysql', true);

        // Promote scheduled → sending when due.
        $wpdb->query($wpdb->prepare(
            'UPDATE ' . self::campaigns_table() . " SET status='sending', updated_at=%s WHERE status='scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= %s",
            $now, $now
        ));

        $messages = $wpdb->get_results($wpdb->prepare(
            'SELECT * FROM ' . self::messages_table() . " WHERE status='queued' AND campaign_id IN (SELECT id FROM " . self::campaigns_table() . " WHERE status='sending') ORDER BY id ASC LIMIT %d",
            self::BATCH
        )) ?: [];

        foreach ($messages as $msg) {
            $c = self::get((int) $msg->campaign_id);
            if (! $c) { continue; }
            self::send_one($c, $msg);
        }

        // Mark fully-drained campaigns as sent.
        $wpdb->query(
            'UPDATE ' . self::campaigns_table() . " c SET c.status='sent', c.sent_at=NOW()
             WHERE c.status='sending'
               AND NOT EXISTS (SELECT 1 FROM " . self::messages_table() . " m WHERE m.campaign_id=c.id AND m.status='queued')"
        );

        // Clear the active flag when nothing is left to send.
        $pending = (int) $wpdb->get_var(
            'SELECT COUNT(*) FROM ' . self::campaigns_table() . " WHERE status IN ('sending','scheduled')"
        );
        if ($pending === 0) {
            update_option('oe_campaigns_active', 0);
        }
    }

    private static function send_one(object $c, object $msg): void {
        global $wpdb;
        $html    = self::render($c, $msg);
        $headers = ['Content-Type: text/html; charset=UTF-8'];
        foreach (Unsubscribe::headers((string) $msg->email) as $k => $v) {
            $headers[] = $k . ': ' . $v;
        }
        $ok = wp_mail((string) $msg->email, (string) $c->subject, $html, $headers);
        $wpdb->update(self::messages_table(), [
            'status'  => $ok ? 'sent' : 'failed',
            'sent_at' => current_time('mysql', true),
        ], ['id' => (int) $msg->id]);
        $field = $ok ? 'sent' : 'failed';
        $wpdb->query($wpdb->prepare(
            'UPDATE ' . self::campaigns_table() . " SET {$field}={$field}+1 WHERE id=%d",
            (int) $c->id
        ));
    }

    /** Build the per-recipient HTML: open pixel + click tracking + unsub footer. */
    private static function render(object $c, object $msg): string {
        $token = (string) $msg->token;
        $html  = (string) $c->body_html;

        // Rewrite http(s) links to the click-tracking redirect (URL is signed).
        $html = preg_replace_callback('/href="(https?:\/\/[^"]+)"/i', static function ($m) use ($token) {
            return 'href="' . esc_url_raw(add_query_arg([
                'oe_c' => $token,
                'u'    => rawurlencode($m[1]),
                's'    => self::sign_link($m[1]),
            ], home_url('/'))) . '"';
        }, $html) ?? $html;

        // Unsubscribe footer (CAN-SPAM) + optional physical address.
        $unsub   = esc_url(Unsubscribe::url((string) $msg->email));
        $address = trim((string) Settings::get('mail_footer_address', ''));
        $footer  = '<div style="margin-top:28px;padding-top:16px;border-top:1px solid #e3e2db;font-size:12px;color:#888;font-family:sans-serif">'
            . ($address !== '' ? '<div>' . esc_html($address) . '</div>' : '')
            . '<div style="margin-top:6px"><a href="' . $unsub . '" style="color:#888">Unsubscribe</a></div></div>';

        // Open pixel.
        $pixel = '<img src="' . esc_url(add_query_arg('oe_o', $token, home_url('/'))) . '" width="1" height="1" alt="" style="display:none">';

        return $html . $footer . $pixel;
    }

    /** Send a one-off test (no queueing, no tracking). */
    public static function send_test(int $id, string $email): bool {
        $c = self::get($id);
        if (! $c || ! is_email($email)) {
            return false;
        }
        $headers = ['Content-Type: text/html; charset=UTF-8'];
        return wp_mail($email, '[TEST] ' . (string) $c->subject, (string) $c->body_html, $headers);
    }

    /* ------------------------------------------------------------------ *
     * Tracking (called from the public front controller)
     * ------------------------------------------------------------------ */

    public static function track_open(string $token): void {
        global $wpdb;
        $m = $wpdb->get_row($wpdb->prepare('SELECT id, campaign_id, opened FROM ' . self::messages_table() . ' WHERE token=%s', $token));
        if (! $m) { return; }
        if (! (int) $m->opened) {
            $wpdb->update(self::messages_table(), ['opened' => 1], ['id' => (int) $m->id]);
            $wpdb->query($wpdb->prepare('UPDATE ' . self::campaigns_table() . ' SET opened=opened+1 WHERE id=%d', (int) $m->campaign_id));
        }
    }

    public static function track_click(string $token): void {
        global $wpdb;
        $m = $wpdb->get_row($wpdb->prepare('SELECT id, campaign_id, opened, clicked FROM ' . self::messages_table() . ' WHERE token=%s', $token));
        if (! $m) { return; }
        $set = [];
        if (! (int) $m->clicked) {
            $set['clicked'] = 1;
            $wpdb->query($wpdb->prepare('UPDATE ' . self::campaigns_table() . ' SET clicked=clicked+1 WHERE id=%d', (int) $m->campaign_id));
        }
        if (! (int) $m->opened) {
            $set['opened'] = 1;
            $wpdb->query($wpdb->prepare('UPDATE ' . self::campaigns_table() . ' SET opened=opened+1 WHERE id=%d', (int) $m->campaign_id));
        }
        if ($set) {
            $wpdb->update(self::messages_table(), $set, ['id' => (int) $m->id]);
        }
    }

    private static function token(): string {
        return wp_generate_password(32, false, false);
    }

    /** Sign a click-tracking target so the redirect can't be abused as an open redirect. */
    public static function sign_link(string $url): string {
        return substr(hash_hmac('sha256', $url, hash('sha256', 'oe-click|' . wp_salt('auth'))), 0, 20);
    }

    public static function verify_link(string $url, string $sig): bool {
        return $sig !== '' && hash_equals(self::sign_link($url), $sig);
    }
}
