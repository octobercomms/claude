<?php
declare(strict_types=1);

namespace OE\Packs\Content;

use OE\Packs\Registry;
use OE\Sections\Renderer;
use OE\Sections\Theme;

defined('ABSPATH') || exit;

/**
 * Conference pack public output (FRONTEND-BUILD slice B).
 *
 * Replaces the `pack_pending()` stubs for speakers, past speakers, schedule and
 * accommodation. Each renderer binds to the current event (or an `id` att), is
 * gated on the Conference pack being on, and short-circuits to '' when the pack
 * has no content — so dropping the shortcode is always safe. Markup carries the
 * `oe-sec oe-sec--*` classes the section stylesheet designs.
 */
final class ConferenceRender {

    private const PACK = 'conference';

    /** Resolve an event id for a conference section, or 0 when not applicable. */
    private static function id(array $atts, string $tag): int {
        $id = Renderer::event_id($atts, $tag);
        if (! $id || ! Registry::enabled($id, self::PACK)) {
            return 0;
        }
        return $id;
    }

    /** Wrap rendered inner markup in a designed section (and load the sheet). */
    private static function section(string $modifier, string $inner): string {
        if (trim($inner) === '') {
            return '';
        }
        Theme::enqueue();
        return sprintf('<section class="oe-sec oe-sec--%s">%s</section>', esc_attr($modifier), $inner);
    }

    /** An attachment id => <img>, or a styled placeholder span, for a given class. */
    private static function photo(int $att_id, string $class, string $size = 'medium'): string {
        if ($att_id > 0) {
            $img = wp_get_attachment_image($att_id, $size, false, ['class' => $class, 'loading' => 'lazy']);
            if ($img) {
                return $img;
            }
        }
        return '<span class="' . esc_attr($class) . '" aria-hidden="true"></span>';
    }

    /** External social / site links for a person row. */
    private static function links(array $row): string {
        $out = '';
        foreach (['linkedin' => 'LinkedIn', 'instagram' => 'Instagram', 'website' => 'Website'] as $k => $label) {
            $url = trim((string) ($row[$k] ?? ''));
            if ($url !== '') {
                $out .= sprintf(
                    '<a href="%s" target="_blank" rel="noopener nofollow">%s</a>',
                    esc_url($url),
                    esc_html__($label, 'october-events')
                );
            }
        }
        return $out !== '' ? '<span class="oe-speaker__links">' . $out . '</span>' : '';
    }

    public static function speakers(array $atts = []): string {
        $id = self::id($atts, 'oe_event_speakers');
        if (! $id) {
            return '';
        }
        $rows = Store::get($id, self::PACK, 'speakers');
        if (! $rows) {
            return '';
        }
        $cards = '';
        foreach ($rows as $r) {
            $name = trim((string) ($r['name'] ?? ''));
            if ($name === '') {
                continue;
            }
            $cards .= '<div class="oe-speaker">'
                . self::photo((int) ($r['photo'] ?? 0), 'oe-speaker__photo')
                . '<span class="oe-speaker__name">' . esc_html($name) . '</span>'
                . (($t = trim((string) ($r['title'] ?? ''))) !== '' ? '<span class="oe-speaker__title">' . esc_html($t) . '</span>' : '')
                . self::links($r)
                . '</div>';
        }
        if ($cards === '') {
            return '';
        }
        $inner = '<h2>' . esc_html__('Speakers', 'october-events') . '</h2><div class="oe-speakers">' . $cards . '</div>';
        return self::section('speakers', $inner);
    }

    public static function past_speakers(array $atts = []): string {
        $id = self::id($atts, 'oe_event_past_speakers');
        if (! $id) {
            return '';
        }
        $rows = Store::get($id, self::PACK, 'past_speakers');
        if (! $rows) {
            return '';
        }
        $cards = '';
        foreach ($rows as $r) {
            $name = trim((string) ($r['name'] ?? ''));
            if ($name === '') {
                continue;
            }
            $cards .= '<div class="oe-speaker">'
                . self::photo((int) ($r['photo'] ?? 0), 'oe-speaker__photo')
                . '<span class="oe-speaker__name">' . esc_html($name) . '</span>'
                . (($t = trim((string) ($r['title'] ?? ''))) !== '' ? '<span class="oe-speaker__title">' . esc_html($t) . '</span>' : '')
                . '</div>';
        }
        if ($cards === '') {
            return '';
        }
        $inner = '<h2>' . esc_html__('Past speakers', 'october-events') . '</h2><div class="oe-speakers">' . $cards . '</div>';
        return self::section('past-speakers', $inner);
    }

    public static function schedule(array $atts = []): string {
        $id = self::id($atts, 'oe_event_schedule');
        if (! $id) {
            return '';
        }
        $rows = Store::get($id, self::PACK, 'sessions');
        if (! $rows) {
            return '';
        }
        // Group sessions by day label, preserving first-seen order.
        $days = [];
        foreach ($rows as $r) {
            $title = trim((string) ($r['title'] ?? ''));
            if ($title === '') {
                continue;
            }
            $day = trim((string) ($r['day'] ?? ''));
            $days[$day][] = $r;
        }
        if (! $days) {
            return '';
        }
        $blocks = '';
        foreach ($days as $day => $sessions) {
            $head = $day !== ''
                ? '<div class="oe-sched-day__head"><span class="oe-sched-day__date">' . esc_html($day) . '</span></div>'
                : '';
            $items = '';
            foreach ($sessions as $s) {
                $time = trim((string) ($s['time'] ?? ''));
                $desc = trim((string) ($s['desc'] ?? ''));
                $items .= '<div class="oe-session">'
                    . ($time !== '' ? '<span class="oe-session__time">' . esc_html($time) . '</span>' : '')
                    . '<div><span class="oe-session__title">' . esc_html(trim((string) $s['title'])) . '</span>'
                    . ($desc !== '' ? '<div class="oe-session__desc">' . esc_html($desc) . '</div>' : '')
                    . '</div></div>';
            }
            $blocks .= '<div class="oe-sched-day">' . $head . $items . '</div>';
        }
        $inner = '<h2>' . esc_html__('Schedule', 'october-events') . '</h2>' . $blocks;
        return self::section('schedule', $inner);
    }

    public static function accommodation(array $atts = []): string {
        $id = self::id($atts, 'oe_event_accommodation');
        if (! $id) {
            return '';
        }
        $rows = Store::get($id, self::PACK, 'accommodation');
        if (! $rows) {
            return '';
        }
        $items = '';
        foreach ($rows as $r) {
            $name = trim((string) ($r['name'] ?? ''));
            if ($name === '') {
                continue;
            }
            $desc = trim((string) ($r['desc'] ?? ''));
            $link = trim((string) ($r['link'] ?? ''));
            $title = $link !== ''
                ? '<a href="' . esc_url($link) . '" target="_blank" rel="noopener">' . esc_html($name) . '</a>'
                : esc_html($name);
            $items .= '<div class="oe-accom__item">'
                . self::photo((int) ($r['image'] ?? 0), 'oe-accom__img', 'thumbnail')
                . '<div><div class="oe-accom__name">' . $title . '</div>'
                . ($desc !== '' ? '<div class="oe-accom__desc">' . esc_html($desc) . '</div>' : '')
                . '</div></div>';
        }
        if ($items === '') {
            return '';
        }
        $inner = '<h2>' . esc_html__('Accommodation', 'october-events') . '</h2><div class="oe-accom">' . $items . '</div>';
        return self::section('accommodation', $inner);
    }
}
