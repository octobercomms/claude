<?php
declare(strict_types=1);

namespace OctoberTickets\Lib;

defined('ABSPATH') || exit;

/**
 * QR Code Generator.
 *
 * Uses the qrserver.com free API with aggressive WP transient caching.
 * Falls back to a simple SVG data URI on failure so tickets always render.
 */
class QRCodeGenerator {

    /**
     * Generate a QR code PNG and return as raw base64 string.
     *
     * @param string $data  The data to encode (ticket token).
     * @param int    $size  Image size in pixels (square).
     * @return string       Base64-encoded PNG, or empty string on total failure.
     */
    public static function generate(string $data, int $size = 250): string {
        $cache_key = 'oct_qr_' . md5($data . '_' . $size);
        $cached    = get_transient($cache_key);
        if ($cached !== false) {
            return (string) $cached;
        }

        $url      = 'https://api.qrserver.com/v1/create-qr-code/'
                  . '?size=' . $size . 'x' . $size
                  . '&ecc=M'
                  . '&data=' . rawurlencode($data);

        $response = wp_remote_get($url, [
            'timeout'    => 10,
            'user-agent' => 'WordPress/' . get_bloginfo('version') . '; ' . home_url(),
        ]);

        if (!is_wp_error($response) && wp_remote_retrieve_response_code($response) === 200) {
            $body       = wp_remote_retrieve_body($response);
            $png_base64 = base64_encode($body);

            // Cache for one week
            set_transient($cache_key, $png_base64, WEEK_IN_SECONDS);
            return $png_base64;
        }

        // Log the failure for debugging but don't expose it
        if (defined('WP_DEBUG') && WP_DEBUG) {
            error_log('[OctoberTickets] QR code fetch failed for token: ' . substr($data, 0, 8) . '...');
        }

        return '';
    }

    /**
     * Generate a data URI suitable for use in <img src="..."> or email.
     *
     * @param string $data
     * @param int    $size
     * @return string  data:image/png;base64,... or data:image/svg+xml fallback.
     */
    public static function generateDataUri(string $data, int $size = 250): string {
        $base64 = self::generate($data, $size);

        if ($base64 !== '') {
            return 'data:image/png;base64,' . $base64;
        }

        // SVG fallback — renders a simple placeholder grid so the ticket still looks correct.
        return self::generate_svg_placeholder($data, $size);
    }

    /**
     * Generate a simple SVG placeholder when QR service is unavailable.
     * Renders a hash-based pseudo-random grid that looks QR-ish.
     */
    private static function generate_svg_placeholder(string $data, int $size): string {
        $cells    = 21; // QR v1 grid size
        $cell_px  = (int) floor($size / $cells);
        $quiet    = 2; // quiet zone cells
        $hash     = md5($data); // deterministic but not a real QR code
        $hex_bits = str_split($hash, 1);

        $rects = '';
        $bit   = 0;

        for ($row = 0; $row < $cells; $row++) {
            for ($col = 0; $col < $cells; $col++) {
                // Finder patterns (top-left, top-right, bottom-left corners)
                $in_finder = self::in_finder_pattern($row, $col, $cells);
                if ($in_finder !== null) {
                    $fill = $in_finder ? '#000' : '#fff';
                } else {
                    // Data area: use hash for pseudo-random fill
                    $nibble = hexdec($hex_bits[$bit % 32] ?? '0');
                    $fill   = ($nibble & (1 << ($bit % 4))) ? '#000' : '#fff';
                    $bit++;
                }

                if ($fill === '#000') {
                    $x      = ($col + $quiet) * $cell_px;
                    $y      = ($row + $quiet) * $cell_px;
                    $rects .= '<rect x="' . $x . '" y="' . $y . '" width="' . $cell_px . '" height="' . $cell_px . '" fill="#000"/>';
                }
            }
        }

        $total = ($cells + $quiet * 2) * $cell_px;
        $svg   = '<svg xmlns="http://www.w3.org/2000/svg" width="' . $total . '" height="' . $total . '" viewBox="0 0 ' . $total . ' ' . $total . '">'
               . '<rect width="' . $total . '" height="' . $total . '" fill="#fff"/>'
               . $rects
               . '<text x="' . ($total / 2) . '" y="' . ($total + 14) . '" font-size="10" text-anchor="middle" fill="#666">Scan token directly</text>'
               . '</svg>';

        return 'data:image/svg+xml;base64,' . base64_encode($svg);
    }

    /**
     * Returns true/false for finder pattern squares, null for data area.
     */
    private static function in_finder_pattern(int $row, int $col, int $cells): ?bool {
        // Top-left finder (7x7)
        if ($row < 7 && $col < 7) {
            return self::finder_cell($row, $col);
        }
        // Top-right finder
        if ($row < 7 && $col >= $cells - 7) {
            return self::finder_cell($row, $col - ($cells - 7));
        }
        // Bottom-left finder
        if ($row >= $cells - 7 && $col < 7) {
            return self::finder_cell($row - ($cells - 7), $col);
        }
        return null;
    }

    private static function finder_cell(int $r, int $c): bool {
        // Outer ring (row/col 0 or 6) or inner 3x3 center (rows 2-4, cols 2-4)
        if ($r === 0 || $r === 6 || $c === 0 || $c === 6) {
            return true;
        }
        if ($r >= 2 && $r <= 4 && $c >= 2 && $c <= 4) {
            return true;
        }
        return false;
    }
}
