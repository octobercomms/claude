<?php
declare(strict_types=1);

namespace OE\Packs\Content;

use OE\Packs\Registry;
use OE\Sections\Renderer;
use OE\Sections\Theme;

defined('ABSPATH') || exit;

/**
 * Exhibition pack public output (FRONTEND-BUILD slice C).
 *
 * Replaces the `[oe_event_exhibitors]` stub. Gated on the Exhibition pack,
 * short-circuits to '' when empty, emits the oe-sec classes the stylesheet designs.
 */
final class ExhibitionRender {

    private const PACK = 'exhibition';

    public static function exhibitors(array $atts = []): string {
        $id = Renderer::event_id($atts, 'oe_event_exhibitors');
        if (! $id || ! Registry::enabled($id, self::PACK)) {
            return '';
        }
        $rows = Store::get($id, self::PACK, 'exhibitors');
        if (! $rows) {
            return '';
        }
        $cards = '';
        foreach ($rows as $r) {
            $name = trim((string) ($r['name'] ?? ''));
            if ($name === '') {
                continue;
            }
            $att = (int) ($r['image'] ?? 0);
            $img = $att ? wp_get_attachment_image($att, 'medium', false, ['class' => 'oe-exhibitor__img', 'loading' => 'lazy']) : '';
            if ($img === '') {
                $img = '<span class="oe-exhibitor__img" aria-hidden="true"></span>';
            }
            $desc  = trim((string) ($r['desc'] ?? ''));
            $links = '';
            foreach (['linkedin' => 'LinkedIn', 'instagram' => 'Instagram', 'website' => 'Website'] as $k => $label) {
                $url = trim((string) ($r[$k] ?? ''));
                if ($url !== '') {
                    $links .= sprintf('<a href="%s" target="_blank" rel="noopener nofollow">%s</a>', esc_url($url), esc_html__($label, 'october-events'));
                }
            }
            $cards .= '<div class="oe-exhibitor">' . $img . '<div class="oe-exhibitor__body">'
                . '<div class="oe-exhibitor__name">' . esc_html($name) . '</div>'
                . ($desc !== '' ? '<div class="oe-exhibitor__desc">' . esc_html($desc) . '</div>' : '')
                . ($links !== '' ? '<div class="oe-exhibitor__links">' . $links . '</div>' : '')
                . '</div></div>';
        }
        if ($cards === '') {
            return '';
        }
        Theme::enqueue();
        return '<section class="oe-sec oe-sec--exhibitors"><h2>' . esc_html__('Exhibitors', 'october-events')
            . '</h2><div class="oe-exhibitors">' . $cards . '</div></section>';
    }
}
