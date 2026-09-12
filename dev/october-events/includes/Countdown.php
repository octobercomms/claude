<?php
declare(strict_types=1);

namespace OE;

defined('ABSPATH') || exit;

/**
 * Live-ish countdown image for emails.
 *
 * Renders a GIF of the time remaining until a deadline, so it can be embedded as
 * a plain <img> in an email (email clients can't run JS). Served at
 *   /?oe_countdown=1&deadline=2026-09-17T10:00:00-04:00&label=OFFER%20EXPIRES%20IN
 * with hard no-cache headers so each fetch renders the current state.
 *
 * Honest limitation: Gmail's image proxy and Apple Mail Privacy Protection fetch
 * and cache the image near delivery, then serve their cached copy — so for many
 * recipients this shows the time *at delivery*, not at open, and won't change on
 * reopen. Days/hours read fine that way; seconds are effectively frozen (hence
 * the `units` option — prefer `dh` for real sends).
 *
 * Palette + layout match the ADF newsletter mockup. Needs GD with GIF support.
 */
final class Countdown {

    private const W  = 560;
    private const H  = 130;
    private const BG = '#17140F';
    private const LABEL  = '#6E6A5F';
    private const NUMBER = '#F2ECE0';
    private const ACCENT = '#C15A2C';

    /** Handle /?oe_countdown=1 — render the GIF and exit. Never returns. */
    public static function render(array $q): void {
        // Kill every caching layer we can, so each fetch re-renders.
        nocache_headers();
        header('Content-Type: image/gif');
        header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
        header('Pragma: no-cache');
        header('Expires: 0');

        if (! function_exists('imagecreatetruecolor') || ! function_exists('imagegif')) {
            // GD (or GIF support) missing — send a 1x1 transparent gif so the
            // email isn't left with a broken-image icon.
            echo base64_decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
            exit;
        }

        $deadline = isset($q['deadline']) ? self::parse_ts((string) $q['deadline']) : 0;
        // No label by default — the email supplies its own heading if it wants one.
        $label    = isset($q['label']) ? strtoupper(sanitize_text_field((string) $q['label'])) : '';
        $accent   = isset($q['accent']) ? self::sanitize_hex((string) $q['accent']) : self::ACCENT;
        // Days + hours by default: in email the image is proxy-cached at delivery,
        // so seconds never tick for the recipient — showing them reads as broken.
        $units    = isset($q['units']) ? preg_replace('/[^dhms]/', '', strtolower((string) $q['units'])) : 'dh';
        if ($units === '') { $units = 'dh'; }

        $img  = imagecreatetruecolor(self::W, self::H);
        $bg   = self::color($img, self::BG);
        imagefilledrectangle($img, 0, 0, self::W, self::H, $bg);
        $font = self::font_path();

        if (! $deadline || $deadline <= time()) {
            self::draw_ended($img, $font, $accent);
        } else {
            self::draw_countdown($img, $font, $accent, $label, $deadline - time(), $units);
        }

        imagegif($img);
        imagedestroy($img);
        exit;
    }

    private static function draw_countdown($img, ?string $font, string $accent, string $label, int $secs, string $units): void {
        $cNumber = self::color($img, self::NUMBER);
        $cAccent = self::color($img, $accent);

        $has_label = $label !== '';
        if ($has_label) {
            self::text($img, $font, 11, 28, 34, self::color($img, self::LABEL), $label, 3.0);
        }
        // Sit lower when a label is present; otherwise centre the blocks vertically.
        $num_y  = $has_label ? 92 : 82;
        $unit_y = $has_label ? 112 : 104;

        $days = intdiv($secs, 86400);
        $hrs  = intdiv($secs % 86400, 3600);
        $mins = intdiv($secs % 3600, 60);
        $sec  = $secs % 60;
        $all  = [
            'd' => [$days, __('DAYS', 'october-events')],
            'h' => [$hrs,  __('HRS', 'october-events')],
            'm' => [$mins, __('MIN', 'october-events')],
            's' => [$sec,  __('SEC', 'october-events')],
        ];
        $blocks = [];
        foreach (str_split($units) as $u) {
            if (isset($all[$u])) { $blocks[] = $all[$u]; }
        }
        if (! $blocks) { $blocks = array_values($all); }

        $pad = 28;
        $col = (int) ((self::W - $pad * 2) / max(1, count($blocks)));
        foreach ($blocks as $i => $b) {
            $x = $pad + $i * $col;
            self::text($img, $font, 34, $x, $num_y, $cNumber, str_pad((string) $b[0], 2, '0', STR_PAD_LEFT), 0.0);
            self::text($img, $font, 9, $x + 2, $unit_y, $cAccent, (string) $b[1], 1.5);
        }
    }

    private static function draw_ended($img, ?string $font, string $accent): void {
        $cNumber = self::color($img, self::NUMBER);
        $cAccent = self::color($img, $accent);
        self::text($img, $font, 12, 28, 55, $cAccent, __('OFFER HAS ENDED', 'october-events'), 3.0);
        self::text($img, $font, 20, 28, 95, $cNumber, __('Thanks for looking', 'october-events'), 0.0);
    }

    /**
     * Draw text with a TTF when one is available (crisp, on-brand), else fall
     * back to GD's built-in bitmap font (functional, not pretty — provide a TTF
     * via OE_COUNTDOWN_FONT or assets/fonts/countdown.ttf for the real look).
     * $y is the text baseline for TTF; letter-spacing approximated via $tracking.
     */
    private static function text($img, ?string $font, float $size, int $x, int $y, int $color, string $text, float $tracking): void {
        if ($font) {
            if ($tracking > 0.0) {
                $cx = $x;
                foreach (preg_split('//u', $text, -1, PREG_SPLIT_NO_EMPTY) as $ch) {
                    imagettftext($img, $size, 0, $cx, $y, $color, $font, $ch);
                    $bb  = imagettfbbox($size, 0, $font, $ch);
                    $cx += ($bb[2] - $bb[0]) + (int) round($tracking);
                }
            } else {
                imagettftext($img, $size, 0, $x, $y, $color, $font, $text);
            }
            return;
        }
        // Bitmap fallback: GD built-in font 5 (~15px), placed near the baseline.
        imagestring($img, 5, $x, (int) ($y - 14), $text, $color);
    }

    /** Locate a usable bold TTF, or null for the bitmap fallback. */
    private static function font_path(): ?string {
        $candidates = [];
        if (defined('OE_COUNTDOWN_FONT') && OE_COUNTDOWN_FONT) {
            $candidates[] = (string) OE_COUNTDOWN_FONT;
        }
        $candidates[] = OE_DIR . 'assets/fonts/countdown.ttf';
        $candidates[] = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
        $candidates[] = '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf';
        $candidates[] = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf';
        $candidates[] = '/usr/share/fonts/liberation/LiberationSans-Bold.ttf';
        $candidates[] = '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf';
        foreach ($candidates as $f) {
            if ($f && is_readable($f) && function_exists('imagettftext')) {
                return $f;
            }
        }
        return null;
    }

    /** Parse an ISO-8601 timestamp (with explicit offset) to a UTC epoch, 0 if bad. */
    private static function parse_ts(string $val): int {
        $val = trim($val);
        if ($val === '') { return 0; }
        try {
            // If no offset is present, interpret in the site timezone.
            $tz = preg_match('/[zZ]|[+-]\d{2}:?\d{2}$/', $val) ? new \DateTimeZone('UTC') : wp_timezone();
            return (new \DateTime($val, $tz))->getTimestamp();
        } catch (\Exception $e) {
            $t = strtotime($val);
            return $t ?: 0;
        }
    }

    private static function sanitize_hex(string $h): string {
        $h = ltrim(trim($h), '#');
        return preg_match('/^[0-9a-fA-F]{6}$/', $h) ? '#' . $h : self::ACCENT;
    }

    /** Allocate a colour from #rrggbb on the image. */
    private static function color($img, string $hex) {
        $hex = ltrim($hex, '#');
        return imagecolorallocate(
            $img,
            (int) hexdec(substr($hex, 0, 2)),
            (int) hexdec(substr($hex, 2, 2)),
            (int) hexdec(substr($hex, 4, 2))
        );
    }
}
