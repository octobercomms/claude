<?php
declare(strict_types=1);

namespace OE\Packs\Content;

use OE\Packs\Registry;
use OE\Sections\Renderer;
use OE\Sections\Theme;

defined('ABSPATH') || exit;

/**
 * Staff pack public output (FRONTEND-BUILD slice E).
 *
 * Replaces the `[oe_event_staff]` stub: each non-shift role with its description
 * and an apply-by-email form. Submissions are handled by StaffApply. Gated on the
 * Staff pack; short-circuits to '' when empty.
 */
final class StaffRender {

    private const PACK = 'staff';

    public static function staff(array $atts = []): string {
        $id = Renderer::event_id($atts, 'oe_event_staff');
        if (! $id || ! Registry::enabled($id, self::PACK)) {
            return '';
        }
        $rows = Store::get($id, self::PACK, 'roles');
        if (! $rows) {
            return '';
        }

        $blocks = '';
        $i = 0;
        foreach ($rows as $r) {
            $role = trim((string) ($r['role'] ?? ''));
            if ($role === '') {
                $i++;
                continue;
            }
            $desc = trim((string) ($r['description'] ?? ''));
            $blocks .= '<div class="oe-staff__role">'
                . '<div class="oe-staff__name">' . esc_html($role) . '</div>'
                . ($desc !== '' ? '<div class="oe-staff__desc">' . esc_html($desc) . '</div>' : '')
                . StaffApply::form($id, $i, $role)
                . '</div>';
            $i++;
        }
        if ($blocks === '') {
            return '';
        }

        Theme::enqueue();
        $flash = '';
        if (isset($_GET['oe_staff']) && $_GET['oe_staff'] === 'sent') {
            $flash = '<p class="oe-staff__msg oe-staff__msg--ok">'
                . esc_html__('Thanks — your application has been sent.', 'october-events') . '</p>';
        } elseif (isset($_GET['oe_staff']) && $_GET['oe_staff'] === 'error') {
            $flash = '<p class="oe-staff__msg oe-staff__msg--err">'
                . esc_html__('Sorry, that could not be sent. Please check your email and try again.', 'october-events') . '</p>';
        }

        return '<section class="oe-sec oe-sec--staff" id="staff"><h2>' . esc_html__('Join the team', 'october-events') . '</h2>'
            . $flash . $blocks . '</section>';
    }
}
