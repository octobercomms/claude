<?php
declare(strict_types=1);

namespace OE\Crew;

use OE\Sections\Theme;

defined('ABSPATH') || exit;

/**
 * Public "our team" directory (CREW-MODULE §1 — one template, all tiers).
 *
 * `[oe_team]` renders the team grouped by tier (Planning team, Council, Board
 * by default). Festival volunteers are excluded unless asked for, since they
 * are the day-of shift system, not named year-long roles. Only people with a
 * name are shown; open/offboarded rows are hidden.
 *
 * Attributes:
 *   tiers="planning,council,board"  which tiers to show, in order
 *   heading="Our team"              optional section heading ("" for none)
 */
final class Render {

    public static function init(): void {
        add_shortcode('oe_team', [self::class, 'render']);
    }

    /** @param array<string,mixed>|string $atts */
    public static function render($atts): string {
        $atts = shortcode_atts([
            'tiers'   => 'planning,council,board',
            'heading' => __('Our team', 'october-events'),
        ], is_array($atts) ? $atts : [], 'oe_team');

        $want = array_filter(array_map('sanitize_key', explode(',', (string) $atts['tiers'])));
        if (! $want) {
            return '';
        }

        $grouped = Crew::by_tier();
        $hidden  = [Crew::STATUS_OPEN, Crew::STATUS_OFFBOARDED, Crew::STATUS_INVITED];

        $blocks = '';
        foreach ($want as $tier) {
            $rows = array_filter(
                $grouped[$tier] ?? [],
                static fn($r): bool => (string) $r->name !== '' && ! in_array((string) $r->status, $hidden, true)
            );
            if (! $rows) {
                continue;
            }
            $cards = '';
            foreach ($rows as $r) {
                $cards .= self::card($r);
            }
            $blocks .= '<div class="oe-team__group">'
                . '<h3 class="oe-team__tier">' . esc_html(Crew::tier_label($tier)) . '</h3>'
                . '<div class="oe-team__grid">' . $cards . '</div>'
                . '</div>';
        }

        if ($blocks === '') {
            return '';
        }

        Theme::enqueue();
        $heading = (string) $atts['heading'] !== ''
            ? '<h2 class="oe-team__heading">' . esc_html((string) $atts['heading']) . '</h2>'
            : '';

        return '<div class="oe-sec oe-team">' . $heading . $blocks . '</div>';
    }

    private static function card(object $r): string {
        $img = '';
        if ($r->photo_id) {
            $src = wp_get_attachment_image_url((int) $r->photo_id, 'medium');
            if ($src) {
                $img = '<div class="oe-team__photo"><img src="' . esc_url($src) . '" alt="' . esc_attr((string) $r->name) . '" loading="lazy"></div>';
            }
        }
        $role = (string) $r->role_title !== ''
            ? '<div class="oe-team__role">' . esc_html((string) $r->role_title) . '</div>'
            : '';
        $bio = (string) $r->bio !== ''
            ? '<p class="oe-team__bio">' . esc_html((string) $r->bio) . '</p>'
            : '';
        return '<div class="oe-team__card">'
            . $img
            . '<div class="oe-team__name">' . esc_html((string) $r->name) . '</div>'
            . $role . $bio
            . '</div>';
    }
}
