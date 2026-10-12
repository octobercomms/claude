<?php
declare(strict_types=1);

namespace OE\Packs;

defined('ABSPATH') || exit;

/**
 * Capabilities metabox (BUILD-PLAN M1.1): the per-event pack toggles on the
 * event edit screen. Switching a pack on reveals its fields (its own metabox)
 * and its section shortcodes on the public page. Saving writes
 * `_oe_pack_{id}_enabled` via the Registry.
 *
 * This is deliberately thin: it only owns the on/off switches. Each pack's
 * actual fields live in that pack's existing metabox (Tickets, Volunteers,
 * Guided tours, …), which already registers itself.
 */
final class Metabox {

    private const NONCE = 'oe_packs_save';

    public static function init(): void {
        add_action('add_meta_boxes', [self::class, 'add']);
        add_action('save_post', [self::class, 'save'], 10, 2);
    }

    public static function add(): void {
        $pt = Registry::post_type();
        if ($pt === '' || ! post_type_exists($pt)) {
            return;
        }
        add_meta_box(
            'oe-packs',
            __('Capabilities', 'october-events'),
            [self::class, 'render'],
            $pt,
            'side',
            'high'
        );
    }

    public static function render(\WP_Post $post): void {
        wp_nonce_field(self::NONCE, self::NONCE);
        $state = Registry::all_for((int) $post->ID);
        echo '<p class="description" style="margin:0 0 10px">'
            . esc_html__('Switch on what this event needs. Each one reveals its own fields below and its sections on the page.', 'october-events')
            . '</p>';
        foreach (Registry::PACKS as $id => $def) {
            $on = ! empty($state[$id]);
            printf(
                '<p style="margin:8px 0"><label><input type="checkbox" name="oe_packs[%1$s]" value="1"%2$s> <strong>%3$s %4$s</strong></label><br><span class="description" style="margin-left:24px">%5$s</span></p>',
                esc_attr($id),
                checked($on, true, false),
                esc_html($def['icon']),
                esc_html($def['label']),
                esc_html($def['desc'])
            );
        }
    }

    public static function save(int $post_id, \WP_Post $post): void {
        if ($post->post_type !== Registry::post_type()) {
            return;
        }
        if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
            return;
        }
        $nonce = isset($_POST[self::NONCE]) ? sanitize_text_field(wp_unslash((string) $_POST[self::NONCE])) : '';
        if ($nonce === '' || ! wp_verify_nonce($nonce, self::NONCE)) {
            return;
        }
        if (! current_user_can('edit_post', $post_id)) {
            return;
        }
        $posted = isset($_POST['oe_packs']) && is_array($_POST['oe_packs']) ? wp_unslash($_POST['oe_packs']) : [];
        foreach (Registry::ids() as $id) {
            Registry::set($post_id, $id, ! empty($posted[$id]));
        }
    }
}
