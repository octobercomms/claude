<?php
declare(strict_types=1);

namespace OE\Mail;

defined('ABSPATH') || exit;

/**
 * One-click unsubscribe (CAN-SPAM / RFC 8058).
 *
 * Provides a signed, no-login unsubscribe link + the `List-Unsubscribe` /
 * `List-Unsubscribe-Post` headers email clients use for their built-in
 * "unsubscribe" button. Hitting the link adds the address to the
 * {@see Suppression} list and marks the {@see Contacts} record unsubscribed, so
 * every later send honours it.
 */
final class Unsubscribe {

    private static function key(): string {
        return hash('sha256', 'oe-unsub|' . wp_salt('auth'));
    }

    public static function token(string $email): string {
        return substr(hash_hmac('sha256', strtolower(trim($email)), self::key()), 0, 32);
    }

    private static function encode(string $email): string {
        return rtrim(strtr(base64_encode($email), '+/', '-_'), '=');
    }

    private static function decode(string $s): string {
        $s = strtr($s, '-_', '+/');
        $pad = strlen($s) % 4;
        if ($pad) { $s .= str_repeat('=', 4 - $pad); }
        $out = base64_decode($s, true);
        return is_string($out) ? $out : '';
    }

    public static function url(string $email): string {
        return add_query_arg([
            'oe_unsub' => self::encode($email),
            'k'        => self::token($email),
        ], home_url('/'));
    }

    /**
     * List-Unsubscribe headers for a single-recipient bulk message.
     *
     * @return array<string,string>
     */
    public static function headers(string $email): array {
        $host = (string) wp_parse_url(home_url(), PHP_URL_HOST);
        return [
            'List-Unsubscribe'      => '<' . self::url($email) . '>, <mailto:unsubscribe@' . $host . '?subject=unsubscribe>',
            'List-Unsubscribe-Post' => 'List-Unsubscribe=One-Click',
        ];
    }

    /**
     * Front-controller hook (template_redirect). Processes ?oe_unsub=…&k=…,
     * handling both the GET link and the RFC 8058 one-click POST.
     */
    public static function handle(): void {
        if (! isset($_GET['oe_unsub'])) {
            return;
        }
        $email = self::decode(sanitize_text_field(wp_unslash((string) $_GET['oe_unsub'])));
        $k     = isset($_GET['k']) ? sanitize_text_field(wp_unslash((string) $_GET['k'])) : '';
        $ok    = $email !== '' && is_email($email) && hash_equals(self::token($email), $k);

        if ($ok) {
            Contacts::unsubscribe($email);
        }

        // One-click (RFC 8058): the client POSTs and expects a bare 200.
        if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) === 'POST') {
            status_header($ok ? 200 : 400);
            exit;
        }

        self::render_page($ok, $email);
        exit;
    }

    private static function render_page(bool $ok, string $email): void {
        $brand = (string) \OE\Settings::get('brand_name', 'October Events');
        nocache_headers();
        status_header($ok ? 200 : 400);
        header('Content-Type: text/html; charset=utf-8');
        $msg = $ok
            ? sprintf(esc_html__('%s has been unsubscribed. You won\'t receive further marketing emails.', 'october-events'), esc_html($email))
            : esc_html__('This unsubscribe link is invalid or has expired.', 'october-events');
        echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' . esc_html__('Unsubscribe', 'october-events') . '</title>';
        echo '<style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#faf9f5;color:#1a1a1a;display:flex;min-height:100vh;align-items:center;justify-content:center}.c{background:#fff;border:2px solid #e3e2db;border-radius:14px;padding:36px 40px;max-width:440px;text-align:center}h1{font-size:20px;margin:0 0 10px}p{color:#555;line-height:1.5;margin:0}</style></head><body>';
        echo '<div class="c"><h1>' . esc_html($brand) . '</h1><p>' . $msg . '</p></div></body></html>';
    }
}
