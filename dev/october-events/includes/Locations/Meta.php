<?php
declare(strict_types=1);

namespace OE\Locations;

use OE\PostTypes;

defined('ABSPATH') || exit;

/**
 * Tour location editor meta box (ROADMAP R1).
 *
 * The native `oe_location` CPT promotes the Tour pack's per-event locations
 * repeater to first-class records: the title is the location name, the body its
 * description, the featured image its hero, and these fields carry the day,
 * address, map link, design credits, availability note and a linked event.
 */
final class Meta {

    public const FIELDS = [
        'event_id'            => 'Linked event (ID)',
        'day'                 => 'Day',
        'address'             => 'Address',
        'maps_url'            => 'Map link',
        'availability'        => 'Availability note',
        'architect'           => 'Architect',
        'interior_designer'   => 'Interior designer',
        'landscape_architect' => 'Landscape architect',
        'developer'           => 'Developer',
        'photographer'        => 'Photographer',
        'realtor'             => 'Realtor',
    ];

    public static function init(): void {
        add_action('add_meta_boxes', [self::class, 'add']);
        add_action('save_post_' . PostTypes::slug('location'), [self::class, 'save']);
    }

    public static function key(string $field): string {
        return '_oe_loc_' . $field;
    }

    public static function add(): void {
        add_meta_box(
            'oe-location-details',
            __('Location details', 'october-events'),
            [self::class, 'render'],
            PostTypes::slug('location'),
            'normal',
            'high'
        );
    }

    public static function render(\WP_Post $post): void {
        wp_nonce_field('oe_location_save', 'oe_location_nonce');
        echo '<div class="oe-loc-meta" style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px 16px;">';
        foreach (self::FIELDS as $field => $label) {
            $val  = (string) get_post_meta($post->ID, self::key($field), true);
            $type = $field === 'maps_url' ? 'url' : ($field === 'event_id' ? 'number' : 'text');
            if ($field === 'availability') {
                echo '<label style="grid-column:1 / -1;display:flex;flex-direction:column;gap:4px;font-weight:600;font-size:12px;">'
                    . esc_html__($label, 'october-events')
                    . '<textarea name="oe_loc[' . esc_attr($field) . ']" rows="2" style="width:100%;">' . esc_textarea($val) . '</textarea></label>';
                continue;
            }
            echo '<label style="display:flex;flex-direction:column;gap:4px;font-weight:600;font-size:12px;">'
                . esc_html__($label, 'october-events')
                . '<input type="' . esc_attr($type) . '" name="oe_loc[' . esc_attr($field) . ']" value="' . esc_attr($val) . '" style="width:100%;"></label>';
        }
        // Gallery: comma-separated attachment IDs (kept simple; the media
        // library is the picker). The hero is the featured image.
        $gallery = (string) get_post_meta($post->ID, self::key('gallery'), true);
        echo '<label style="grid-column:1 / -1;display:flex;flex-direction:column;gap:4px;font-weight:600;font-size:12px;">'
            . esc_html__('Gallery image IDs (comma-separated)', 'october-events')
            . '<input type="text" name="oe_loc[gallery]" value="' . esc_attr($gallery) . '" style="width:100%;"></label>';
        echo '</div>';
    }

    public static function save(int $post_id): void {
        if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
            return;
        }
        $nonce = isset($_POST['oe_location_nonce']) ? sanitize_text_field(wp_unslash((string) $_POST['oe_location_nonce'])) : '';
        if ($nonce === '' || ! wp_verify_nonce($nonce, 'oe_location_save') || ! current_user_can('edit_post', $post_id)) {
            return;
        }
        $in = isset($_POST['oe_loc']) && is_array($_POST['oe_loc']) ? wp_unslash($_POST['oe_loc']) : [];
        foreach (self::FIELDS as $field => $label) {
            $raw = (string) ($in[$field] ?? '');
            if ($field === 'maps_url') {
                $val = esc_url_raw(trim($raw));
            } elseif ($field === 'event_id') {
                $val = (string) max(0, (int) $raw);
            } elseif ($field === 'availability') {
                $val = sanitize_textarea_field($raw);
            } else {
                $val = sanitize_text_field($raw);
            }
            update_post_meta($post_id, self::key($field), $val);
        }
        // Gallery: normalise to a clean CSV of positive ints.
        $ids = array_filter(array_map('intval', explode(',', (string) ($in['gallery'] ?? ''))));
        update_post_meta($post_id, self::key('gallery'), implode(',', $ids));
    }
}
