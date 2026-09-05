<?php
declare(strict_types=1);

namespace OE\Volunteers;

use OE\VolunteerSignups;
use OE\Volunteers;

defined('ABSPATH') || exit;

/**
 * Self-service volunteer shift cancellation — the "Cancel this shift" link in
 * the volunteer confirmation/reminder email.
 *
 * No login required: the link carries the signup id plus a secret per-row
 * cancel token. To avoid email clients / link-scanners silently cancelling a
 * shift by pre-fetching the URL, the GET link only shows a confirmation page;
 * the cancellation happens on the POST from that page's button (the same model
 * as the one-click unsubscribe link).
 */
final class Cancel {

    /**
     * Front-controller hook (template_redirect). Processes ?oe_vcancel=<id>&k=<token>.
     */
    public static function handle(): void {
        if (! isset($_GET['oe_vcancel'])) {
            return;
        }
        $id     = absint($_GET['oe_vcancel']);
        $token  = isset($_GET['k']) ? sanitize_text_field(wp_unslash((string) $_GET['k'])) : '';
        $signup = $id ? VolunteerSignups::get($id) : null;

        $valid = $signup
            && ! empty($signup->cancel_token)
            && $token !== ''
            && hash_equals((string) $signup->cancel_token, $token);

        if (! $valid) {
            self::render(self::STATE_INVALID, null);
            exit;
        }

        $already = in_array($signup->status, [VolunteerSignups::STATUS_CANCELLED, VolunteerSignups::STATUS_DECLINED], true);

        // Only the POST (the confirm button) mutates — a prefetch of the GET link
        // must never cancel a shift.
        if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) === 'POST') {
            if (! $already) {
                Volunteers::cancel((int) $signup->id);
            }
            self::render(self::STATE_DONE, $signup);
            exit;
        }

        self::render($already ? self::STATE_DONE : self::STATE_CONFIRM, $signup);
        exit;
    }

    private const STATE_CONFIRM = 'confirm';
    private const STATE_DONE    = 'done';
    private const STATE_INVALID = 'invalid';

    private static function render(string $state, ?object $signup): void {
        $brand = (string) \OE\Settings::get('brand_name', 'October Events');
        nocache_headers();
        status_header($state === self::STATE_INVALID ? 400 : 200);
        header('Content-Type: text/html; charset=utf-8');

        $opp = $shift = '';
        if ($signup) {
            $p     = Volunteers::email_params($signup);
            $opp   = (string) ($p['opportunity'] ?? '');
            $shift = (string) ($p['shift'] ?? '');
        }

        echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'
            . esc_html__('Cancel volunteer shift', 'october-events') . '</title>';
        echo '<style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#faf9f5;color:#1a1a1a;display:flex;min-height:100vh;align-items:center;justify-content:center}'
            . '.c{background:#fff;border:2px solid #e3e2db;border-radius:14px;padding:36px 40px;max-width:460px;text-align:center}'
            . 'h1{font-size:20px;margin:0 0 10px}p{color:#555;line-height:1.55;margin:0 0 14px}'
            . '.d{font-weight:700;color:#1a1a1a}'
            . 'button{background:#111;color:#fff;border:0;border-radius:8px;font-size:14px;font-weight:700;padding:12px 20px;cursor:pointer}'
            . '.k{color:#777;font-size:13px}</style></head><body><div class="c">';
        echo '<h1>' . esc_html($brand) . '</h1>';

        if ($state === self::STATE_INVALID) {
            echo '<p>' . esc_html__('This cancellation link is invalid or has expired. If you need to cancel a shift, just reply to your confirmation email.', 'october-events') . '</p>';
        } elseif ($state === self::STATE_DONE) {
            echo '<p>' . esc_html__('Your shift has been cancelled. Thanks for letting us know — we hope to see you at another tour.', 'october-events') . '</p>';
            if ($opp !== '') {
                echo '<p class="k">' . esc_html($opp) . ($shift !== '' ? ' · ' . esc_html($shift) : '') . '</p>';
            }
        } else { // confirm
            echo '<p>' . esc_html__('Cancel your volunteer shift?', 'october-events') . '</p>';
            if ($opp !== '') {
                echo '<p class="d">' . esc_html($opp) . '</p>';
                if ($shift !== '') {
                    echo '<p class="d">' . esc_html($shift) . '</p>';
                }
            }
            echo '<form method="post" action="' . esc_url(Volunteers::cancel_url($signup)) . '">';
            echo '<button type="submit">' . esc_html__('Yes, cancel my shift', 'october-events') . '</button>';
            echo '</form>';
        }

        echo '</div></body></html>';
    }
}
