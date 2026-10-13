<?php
declare(strict_types=1);

namespace OE\Packs;

use OE\PostTypes;

defined('ABSPATH') || exit;

/**
 * Section & shortcode reference (ADMIN-BUILD AD3).
 *
 * Lists every public section an event can show: the always-on base sections
 * plus each pack's sections, with their on/off state (from the capability
 * switches) and a copy button. Shown both as a metabox on the classic event
 * editor and as a card in the Event Studio. Each section auto-hides when empty,
 * so one layout can hold them all.
 */
final class SectionReference {

    /** Shortcode => human label, for the sections the packs expose. */
    private const LABELS = [
        '[oe_event_header]'        => 'Header / title',
        '[oe_event_gallery]'       => 'Gallery',
        '[oe_event_register]'      => 'Register button',
        '[oe_event_tickets]'       => 'Tickets',
        '[oe_event_about]'         => 'About',
        '[oe_event_speakers]'      => 'Speakers',
        '[oe_event_past_speakers]' => 'Past speakers',
        '[oe_event_schedule]'      => 'Schedule',
        '[oe_event_accommodation]' => 'Accommodation',
        '[oe_event_exhibitors]'    => 'Exhibitors',
        '[oe_tour_locations]'      => 'Tour locations',
        '[oe_event_map]'           => 'Map',
        '[oe_event_volunteers]'    => 'Volunteer signup',
        '[oe_event_staff]'         => 'Staff roles',
    ];

    public static function init(): void {
        add_action('add_meta_boxes', [self::class, 'add']);
    }

    public static function add(): void {
        $pt = PostTypes::slug('event');
        if ($pt === '' || ! post_type_exists($pt)) {
            return;
        }
        add_meta_box('oe-section-reference', __('Page sections & shortcodes', 'october-events'), [self::class, 'render'], $pt, 'normal', 'default');
    }

    /** Metabox callback on the classic editor. */
    public static function render(\WP_Post $post): void {
        echo self::card((int) $post->ID, 'oe-section-reference'); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
    }

    /**
     * The rows for an event: [shortcode, group label, on?, pack id ('' = base)].
     *
     * @return array<int,array{0:string,1:string,2:bool,3:string}>
     */
    public static function rows(int $id): array {
        $rows = [];
        foreach (Registry::BASE_SECTIONS as $sc) {
            $rows[] = [$sc, __('Base', 'october-events'), true, ''];
        }
        foreach (Registry::PACKS as $pid => $def) {
            $on = Registry::enabled($id, $pid);
            foreach ($def['sections'] as $sc) {
                $rows[] = [$sc, (string) $def['label'], $on, (string) $pid];
            }
        }
        return $rows;
    }

    /**
     * The full reference card (note + table + copy script), scoped to a
     * container id so it can appear more than once on a screen. Rows carry
     * data-pack so the Event Studio can live-toggle their state as the
     * capability checkboxes change. The preview link is shown only when the
     * event already has a permalink.
     */
    public static function card(int $id, string $container_id): string {
        $cid = $container_id;
        $h = '<div id="' . esc_attr($cid) . '" class="oe-secref-box">';
        $h .= '<p class="description" style="margin:0 0 10px">'
            . esc_html__('Drop any of these into an Elementor or Gutenberg page — one renderer sits behind the shortcode, the Gutenberg block and the Elementor widget. Base sections are always available; pack sections turn on with their pack. Every section auto-hides when it has no content.', 'october-events')
            . '</p>';

        $h .= '<style>'
            . '.oe-secref{width:100%;border-collapse:collapse}'
            . '.oe-secref th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#555;border-bottom:2px solid #1a1a1a;padding:8px 10px}'
            . '.oe-secref td{padding:8px 10px;border-bottom:1px solid #e3e2db;font-size:13px;vertical-align:middle}'
            . '.oe-secref code{background:rgba(221,75,20,.08);border:1px solid #dd4b14;color:#c2410c;border-radius:4px;padding:1px 6px;font-size:12px}'
            . '.oe-secref .st{font-size:11px;font-weight:700;border-radius:999px;padding:2px 9px}'
            . '.oe-secref .st.on{background:rgba(56,142,60,.12);color:#2e7d32}'
            . '.oe-secref .st.off{background:#f3f3f3;color:#888}'
            . '.oe-secref tr.off{opacity:.55}'
            . '</style>';

        $h .= '<table class="oe-secref"><thead><tr>'
            . '<th>' . esc_html__('Section', 'october-events') . '</th>'
            . '<th>' . esc_html__('Shortcode', 'october-events') . '</th>'
            . '<th>' . esc_html__('Pack', 'october-events') . '</th>'
            . '<th>' . esc_html__('State', 'october-events') . '</th>'
            . '<th></th></tr></thead><tbody>';
        foreach (self::rows($id) as [$sc, $group, $on, $pid]) {
            $label = self::LABELS[$sc] ?? $sc;
            $h .= '<tr class="' . ($on ? 'onrow' : 'off') . '"' . ($pid !== '' ? ' data-pack="' . esc_attr($pid) . '"' : '') . '>';
            $h .= '<td>' . esc_html($label) . '</td>';
            $h .= '<td><code>' . esc_html($sc) . '</code></td>';
            $h .= '<td>' . esc_html($group) . '</td>';
            $h .= '<td class="oe-secref-state"><span class="st ' . ($on ? 'on' : 'off') . '">' . ($on ? esc_html__('on', 'october-events') : esc_html__('off', 'october-events')) . '</span></td>';
            $h .= '<td><button type="button" class="button button-small oe-secref-copy" data-sc="' . esc_attr($sc) . '">' . esc_html__('Copy', 'october-events') . '</button></td>';
            $h .= '</tr>';
        }
        $h .= '</tbody></table>';

        if ($id) {
            $view = get_permalink($id);
            if ($view) {
                $h .= '<p style="margin-top:12px"><a class="button" href="' . esc_url((string) $view) . '" target="_blank" rel="noopener">' . esc_html__('Preview the event page ↗', 'october-events') . '</a> <span class="description">' . esc_html__('Opens the public page with the sections that have content.', 'october-events') . '</span></p>';
            }
        }

        $copied = esc_js(__('Copied', 'october-events'));
        $h .= "<script>(function(){var box=document.getElementById(" . wp_json_encode($cid) . ");"
            . "if(!box||box.__oeBound)return;box.__oeBound=true;"
            . "box.addEventListener('click',function(e){var b=e.target.closest('.oe-secref-copy');if(!b)return;e.preventDefault();"
            . "var sc=b.getAttribute('data-sc')||'';if(navigator.clipboard){navigator.clipboard.writeText(sc);}"
            . "var t=b.textContent;b.textContent='" . $copied . "';setTimeout(function(){b.textContent=t;},1200);});})();</script>";

        $h .= '</div>';
        return $h;
    }
}
