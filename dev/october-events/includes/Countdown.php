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

        $deadline = isset($q['deadline'])
            ? self::parse_ts((string) $q['deadline'], isset($q['tz']) ? (string) $q['tz'] : '')
            : 0;
        // No label by default — the email supplies its own heading if it wants one.
        $label    = isset($q['label']) ? strtoupper(sanitize_text_field((string) $q['label'])) : '';
        $accent   = isset($q['accent']) ? self::sanitize_hex((string) $q['accent']) : self::ACCENT;
        // Days + hours by default: in email the image is proxy-cached at delivery,
        // so seconds never tick for the recipient — showing them reads as broken.
        $units    = isset($q['units']) ? preg_replace('/[^dhms]/', '', strtolower((string) $q['units'])) : 'dh';
        if ($units === '') { $units = 'dh'; }

        // Animated variant (&anim=1): an illustrative analog clock on the left with
        // the countdown on one line beside it. GD can't write animated GIFs, so we
        // render each frame with GD and stitch them (self::assemble_gif). Falls
        // through to the static image if it can't build one.
        if (! empty($q['anim']) && $deadline && $deadline > time()) {
            $gif = self::build_animated($accent, $deadline - time(), $units);
            if ($gif !== '') {
                echo $gif;
                exit;
            }
        }

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
            self::text($img, $font, 46, $x, $num_y, $cNumber, str_pad((string) $b[0], 2, '0', STR_PAD_LEFT), 0.0);
            self::text($img, $font, 11, $x + 2, $unit_y, $cAccent, (string) $b[1], 1.5);
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
        if (! function_exists('imagettftext')) {
            return null; // no FreeType — GD can't render TTF; caller uses the bitmap fallback
        }
        $candidates = [];
        if (defined('OE_COUNTDOWN_FONT') && OE_COUNTDOWN_FONT) {
            $candidates[] = (string) OE_COUNTDOWN_FONT;
        }
        // The site's own brand font (Settings → Branding), bold preferred. GD can
        // only use a local .ttf/.otf — not .woff/.woff2 or a remote URL.
        foreach (['theme_font_url_bold', 'theme_font_url'] as $key) {
            $p = self::local_font_file((string) \OE\Settings::get($key, ''));
            if ($p !== null) { $candidates[] = $p; }
        }
        $candidates[] = OE_DIR . 'assets/fonts/countdown.ttf'; // bundled fallback (always present)
        $candidates[] = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
        $candidates[] = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf';
        foreach ($candidates as $f) {
            if ($f && is_readable($f)) {
                return $f;
            }
        }
        return null;
    }

    /** Map an uploaded-font URL to a local .ttf/.otf path GD can read, or null. */
    private static function local_font_file(string $url): ?string {
        $url = trim($url);
        if ($url === '') {
            return null;
        }
        $pathpart = (string) (wp_parse_url($url, PHP_URL_PATH) ?: $url);
        if (! preg_match('/\.(ttf|otf)$/i', $pathpart)) {
            return null; // woff/woff2 or other — not usable by GD
        }
        $up   = wp_upload_dir();
        $file = '';
        if (! empty($up['baseurl']) && strpos($url, $up['baseurl']) === 0) {
            $file = $up['basedir'] . substr($url, strlen($up['baseurl']));
        } elseif (function_exists('content_url') && strpos($url, content_url()) === 0) {
            $file = WP_CONTENT_DIR . substr($url, strlen(content_url()));
        } elseif ($url[0] === '/') {
            $file = ABSPATH . ltrim($url, '/');
        }
        return ($file !== '' && is_readable($file)) ? $file : null;
    }

    /**
     * Parse an ISO-8601 timestamp to a UTC epoch, 0 if bad. An explicit offset in
     * the string wins; otherwise a caller-supplied IANA `$tzname` is used; failing
     * that, the site timezone. (DST is resolved for the target date either way.)
     */
    private static function parse_ts(string $val, string $tzname = ''): int {
        $val = trim($val);
        if ($val === '') { return 0; }
        try {
            if (preg_match('/[zZ]|[+-]\d{2}:?\d{2}$/', $val)) {
                $tz = new \DateTimeZone('UTC');
            } elseif ($tzname !== '') {
                $tz = new \DateTimeZone($tzname);
            } else {
                $tz = wp_timezone();
            }
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

    /* ---------------------------------------------------------------- *
     * Animated variant: an original analog clock (not any branded clock
     * face) with hands sweeping at illustrative — not real — speeds, plus
     * the countdown on one line. Rendered per-frame with GD and stitched
     * into a looping GIF89a by self::assemble_gif().
     * ---------------------------------------------------------------- */

    private const ANIM_FRAMES = 16;
    private const ANIM_DELAY  = 9; // centiseconds per frame (~0.09s)

    /** Build the looping GIF, or '' if it can't (GD/GIF missing, no font). */
    private static function build_animated(string $accent, int $secs, string $units): string {
        if (! function_exists('imagegif') || ! function_exists('imagettftext') || ! self::font_path()) {
            return '';
        }
        $blocks = self::blocks_for($secs, $units);
        $parts  = [];
        for ($i = 0; $i < self::ANIM_FRAMES; $i++) {
            $frame = self::draw_anim_frame($accent, $blocks, $i);
            ob_start();
            imagegif($frame);
            $parts[] = ob_get_clean();
            imagedestroy($frame);
        }
        return self::assemble_gif($parts, self::ANIM_DELAY);
    }

    /** @return array<array{0:string,1:string}> [[number, unit-label], …] for the given units. */
    private static function blocks_for(int $secs, string $units): array {
        $all = [
            'd' => [intdiv($secs, 86400),        __('DAYS', 'october-events')],
            'h' => [intdiv($secs % 86400, 3600), __('HRS', 'october-events')],
            'm' => [intdiv($secs % 3600, 60),    __('MIN', 'october-events')],
            's' => [$secs % 60,                  __('SEC', 'october-events')],
        ];
        $out = [];
        foreach (str_split($units) as $u) {
            if (isset($all[$u])) {
                $out[] = [str_pad((string) $all[$u][0], 2, '0', STR_PAD_LEFT), (string) $all[$u][1]];
            }
        }
        return $out ?: [['00', __('DAYS', 'october-events')]];
    }

    /** Draw one frame at 2× and downscale for smooth edges; returns a GD image. */
    private static function draw_anim_frame(string $accent, array $blocks, int $i) {
        $s   = 2;
        $w   = self::W * $s;
        $h   = self::H * $s;
        $big = imagecreatetruecolor($w, $h);
        imagefilledrectangle($big, 0, 0, $w, $h, self::color($big, self::BG));
        $num   = self::color($big, self::NUMBER);
        $acc   = self::color($big, $accent);
        $faint = self::color($big, '#5A5444');
        $font  = self::font_path();

        $cx = 66 * $s;
        $cy = 65 * $s;
        $r  = 50 * $s;

        // Clock face: uniform tick marks, bold every five (an original face).
        for ($m = 0; $m < 60; $m++) {
            $a    = deg2rad($m * 6);
            $bold = ($m % 5 === 0);
            $r1   = $r - ($bold ? 11 * $s : 5 * $s);
            imagesetthickness($big, $bold ? 3 * $s : 1 * $s);
            imageline(
                $big,
                (int) ($cx + $r1 * sin($a)), (int) ($cy - $r1 * cos($a)),
                (int) ($cx + $r * sin($a)),  (int) ($cy - $r * cos($a)),
                $bold ? $num : $faint
            );
        }

        // Hands — illustrative speeds, all visibly moving over the loop.
        $step = 360 / self::ANIM_FRAMES;
        self::hand($big, $cx, $cy, $i * $step * 0.25, $r * 0.50, 6 * $s, $num); // hour
        self::hand($big, $cx, $cy, $i * $step * 0.60, $r * 0.72, 4 * $s, $num); // minute
        self::hand($big, $cx, $cy, $i * $step,        $r * 0.82, 2 * $s, $acc); // second
        imagefilledellipse($big, $cx, $cy, 8 * $s, 8 * $s, $num);
        imagesetthickness($big, 1);

        // One-line countdown to the right of the clock.
        $x = 130 * $s;
        foreach ($blocks as $b) {
            $x += self::ttf_center($big, $font, 40 * $s, $x, $cy, $num, $b[0]) + 8 * $s;
            $x += self::ttf_center($big, $font, 13 * $s, $x, $cy + 4 * $s, $acc, $b[1]) + 22 * $s;
        }

        $out = imagecreatetruecolor(self::W, self::H);
        imagecopyresampled($out, $big, 0, 0, 0, 0, self::W, self::H, $w, $h);
        imagedestroy($big);
        imagetruecolortopalette($out, false, 64); // smaller frames
        return $out;
    }

    private static function hand($img, int $cx, int $cy, float $deg, float $len, int $width, int $color): void {
        $a = deg2rad($deg);
        imagesetthickness($img, $width);
        imageline($img, $cx, $cy, (int) ($cx + $len * sin($a)), (int) ($cy - $len * cos($a)), $color);
    }

    /** Draw left-aligned text vertically centred on $cy; returns its advance width. */
    private static function ttf_center($img, string $font, int $size, int $x, int $cy, int $color, string $text): int {
        $bb = imagettfbbox($size, 0, $font, $text);
        $y  = (int) round($cy - ($bb[7] + $bb[1]) / 2);
        imagettftext($img, $size, 0, $x, $y, $color, $font, $text);
        return $bb[2] - $bb[0];
    }

    /**
     * Stitch single-frame GIFs (from imagegif) into one looping GIF89a. Each
     * frame keeps its own colour table as a local table; a Netscape 2.0 block
     * sets the infinite loop. Minimal by design — inputs are our own GD frames.
     */
    private static function assemble_gif(array $frames, int $delay_cs): string {
        if (! $frames) { return ''; }
        [$w, $h] = self::gif_size($frames[0]);
        // Header + logical screen descriptor (no global colour table — per-frame).
        $out  = 'GIF89a';
        $out .= pack('v', $w) . pack('v', $h) . chr(0x00) . chr(0x00) . chr(0x00);
        // Netscape looping extension (0 = forever).
        $out .= "\x21\xFF\x0BNETSCAPE2.0\x03\x01\x00\x00\x00";
        foreach ($frames as $f) {
            $p = self::frame_parts($f);
            if ($p === null) { continue; }
            // Graphic Control Extension: delay + disposal "do not dispose".
            $out .= "\x21\xF9\x04" . chr(0x04) . pack('v', $delay_cs) . chr(0x00) . chr(0x00);
            // Image descriptor with a local colour table flag/size.
            $out .= "\x2C" . pack('v', 0) . pack('v', 0) . pack('v', $p['w']) . pack('v', $p['h'])
                 . chr(0x80 | ($p['ctbits'] & 0x07));
            $out .= $p['ct'];   // local colour table
            $out .= $p['data']; // LZW min-code-size byte + image sub-blocks
        }
        return $out . "\x3B";
    }

    /** Width/height from a GIF's logical screen descriptor. */
    private static function gif_size(string $gif): array {
        return [ord($gif[6]) | (ord($gif[7]) << 8), ord($gif[8]) | (ord($gif[9]) << 8)];
    }

    /** Pull the colour table + image data out of a single-frame GIF, or null. */
    private static function frame_parts(string $gif): ?array {
        $len = strlen($gif);
        if ($len < 14 || substr($gif, 0, 3) !== 'GIF') { return null; }
        $p      = 10;
        $packed = ord($gif[10]);
        $p      = 13;
        $gct    = '';
        $gbits  = 0;
        if ($packed & 0x80) {
            $gbits = $packed & 0x07;
            $sz    = 3 * (1 << ($gbits + 1));
            $gct   = substr($gif, $p, $sz);
            $p    += $sz;
        }
        // Walk to the image descriptor (0x2C), skipping any extension blocks.
        while ($p < $len) {
            $b = ord($gif[$p]);
            if ($b === 0x21) {
                $p += 2;
                while ($p < $len && ($sub = ord($gif[$p])) !== 0) { $p += 1 + $sub; }
                $p += 1;
            } elseif ($b === 0x2C) {
                break;
            } else {
                return null;
            }
        }
        if ($p >= $len || ord($gif[$p]) !== 0x2C) { return null; }
        $idpacked = ord($gif[$p + 9]);
        $iw       = ord($gif[$p + 5]) | (ord($gif[$p + 6]) << 8);
        $ih       = ord($gif[$p + 7]) | (ord($gif[$p + 8]) << 8);
        $p       += 10;
        $ct       = $gct;
        $ctbits   = $gbits;
        if ($idpacked & 0x80) { // frame carries its own local table
            $ctbits = $idpacked & 0x07;
            $sz     = 3 * (1 << ($ctbits + 1));
            $ct     = substr($gif, $p, $sz);
            $p     += $sz;
        }
        $end  = strrpos($gif, "\x3B");
        $data = substr($gif, $p, ($end === false ? $len : $end) - $p);
        if ($ct === '' || $data === '') { return null; }
        return ['w' => $iw, 'h' => $ih, 'ct' => $ct, 'ctbits' => $ctbits, 'data' => $data];
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
