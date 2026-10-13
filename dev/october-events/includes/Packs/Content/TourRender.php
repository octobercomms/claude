<?php
declare(strict_types=1);

namespace OE\Packs\Content;

use OE\Packs\Registry;
use OE\Sections\Renderer;
use OE\Sections\Theme;

defined('ABSPATH') || exit;

/**
 * Tour pack public output (FRONTEND-BUILD slice D).
 *
 * Replaces the `[oe_tour_locations]` stub with a designed locations grid: a day
 * filter built from the days present, and a card per location with its image,
 * credits, day badge, address and map link. Gated on the Tour pack, short-
 * circuits to '' when empty. The map section itself stays `[oe_event_map]`.
 */
final class TourRender {

    private const PACK = 'tour';
    private static bool $filter_js = false;

    /** Credit column => label, in display order. */
    private const CREDITS = [
        'architect'           => 'Architect',
        'interior_designer'   => 'Interior designer',
        'landscape_architect' => 'Landscape architect',
        'developer'           => 'Developer',
        'photographer'        => 'Photographer',
        'realtor'             => 'Realtor',
    ];

    public static function locations(array $atts = []): string {
        $id = Renderer::event_id($atts, 'oe_tour_locations');
        if (! $id || ! Registry::enabled($id, self::PACK)) {
            return '';
        }
        $rows = Store::get($id, self::PACK, 'locations');
        if (! $rows) {
            return '';
        }

        $days  = [];
        $cards = '';
        foreach ($rows as $r) {
            $name = trim((string) ($r['name'] ?? ''));
            if ($name === '') {
                continue;
            }
            $day = trim((string) ($r['day'] ?? ''));
            if ($day !== '') {
                $days[$day] = true;
            }
            $cards .= self::card($r, $name, $day);
        }
        if ($cards === '') {
            return '';
        }

        $filters = '';
        if (count($days) > 1) {
            $chips = '<button type="button" class="oe-loc-filter is-active" data-day="">' . esc_html__('All', 'october-events') . '</button>';
            foreach (array_keys($days) as $day) {
                $chips .= '<button type="button" class="oe-loc-filter" data-day="' . esc_attr($day) . '">' . esc_html($day) . '</button>';
            }
            $filters = '<div class="oe-loc-filters">' . $chips . '</div>';
        }

        Theme::enqueue();
        return '<section class="oe-sec oe-sec--tour-locations"><h2>' . esc_html__('Locations', 'october-events') . '</h2>'
            . $filters
            . '<div class="oe-locations">' . $cards . '</div>'
            . self::filter_js()
            . '</section>';
    }

    private static function card(array $r, string $name, string $day): string {
        $att = (int) ($r['image'] ?? 0);
        $img = $att ? wp_get_attachment_image($att, 'medium', false, ['class' => 'oe-location__img', 'loading' => 'lazy']) : '';
        if ($img === '') {
            $img = '<span class="oe-location__img" aria-hidden="true"></span>';
        }

        $credits = '';
        foreach (self::CREDITS as $col => $label) {
            $val = trim((string) ($r[$col] ?? ''));
            if ($val !== '') {
                $credits .= '<div><strong>' . esc_html__($label, 'october-events') . ':</strong> ' . esc_html($val) . '</div>';
            }
        }

        $addr    = trim((string) ($r['address'] ?? ''));
        $maps    = trim((string) ($r['maps_url'] ?? ''));
        $addr_html = '';
        if ($addr !== '') {
            $addr_html = $maps !== ''
                ? '<a class="oe-location__addr" href="' . esc_url($maps) . '" target="_blank" rel="noopener">' . esc_html($addr) . '</a>'
                : '<div class="oe-location__addr">' . esc_html($addr) . '</div>';
        } elseif ($maps !== '') {
            $addr_html = '<a class="oe-location__addr" href="' . esc_url($maps) . '" target="_blank" rel="noopener">' . esc_html__('View on map', 'october-events') . '</a>';
        }

        $badge = $day !== '' ? '<span class="oe-chip oe-location__badge">' . esc_html($day) . '</span>' : '';

        return '<div class="oe-location" data-day="' . esc_attr($day) . '">'
            . $img
            . '<div class="oe-location__body">'
            . '<div class="oe-location__name">' . esc_html($name) . '</div>'
            . ($credits !== '' ? '<div class="oe-location__credits">' . $credits . '</div>' : '')
            . $badge
            . $addr_html
            . '</div></div>';
    }

    /** One-time inline script: the day-filter chips show/hide cards by data-day. */
    private static function filter_js(): string {
        if (self::$filter_js) {
            return '';
        }
        self::$filter_js = true;
        return '<script>(function(){if(window.__oeLocFilter)return;window.__oeLocFilter=1;'
            . 'document.addEventListener("click",function(e){var b=e.target;'
            . 'if(!b.classList||!b.classList.contains("oe-loc-filter"))return;'
            . 'var sec=b.closest(".oe-sec--tour-locations");if(!sec)return;'
            . 'var day=b.getAttribute("data-day")||"";'
            . 'sec.querySelectorAll(".oe-loc-filter").forEach(function(x){x.classList.toggle("is-active",x===b);});'
            . 'sec.querySelectorAll(".oe-location").forEach(function(c){'
            . 'c.style.display=(day===""||c.getAttribute("data-day")===day)?"":"none";});'
            . '});})();</script>';
    }
}
