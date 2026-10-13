<?php
declare(strict_types=1);

namespace OE\Admin;

use OE\Taxonomies\Registry;
use OE\PostTypes;

defined('ABSPATH') || exit;

/**
 * "Taxonomies & filters" admin screen (ADMIN-BUILD AD12).
 *
 * Define taxonomies, attach them to listing types, flag them as filters, and
 * manage their terms with colours. The registered taxonomies drive the
 * `[oe_listings]` facets (chips / dropdowns). Full editing of a single taxonomy
 * (adding terms) happens inline here; WordPress's own term screen remains
 * available too.
 */
final class TaxonomyScreen {

    public static function init(): void {
        add_action('admin_post_oe_tax_save', [self::class, 'save']);
        add_action('admin_post_oe_tax_delete', [self::class, 'delete']);
        add_action('admin_post_oe_term_add', [self::class, 'add_term']);
        add_action('admin_post_oe_term_delete', [self::class, 'delete_term']);
    }

    private static function require_cap(): void {
        if (! current_user_can('manage_options')) {
            wp_die(esc_html__('You do not have access to this section.', 'october-events'), '', ['response' => 403]);
        }
    }

    public static function render(): void {
        self::require_cap();
        $taxonomies = Registry::all();
        $types      = [];
        foreach (PostTypes::listing_types() as $t) {
            $types[$t] = (string) (PostTypes::TYPES[$t]['label'] ?? ucfirst($t));
        }
        require OE_DIR . 'admin/views/taxonomies.php';
    }

    public static function save(): void {
        self::require_cap();
        if (! check_admin_referer('oe_tax_save')) {
            wp_die(esc_html__('Not allowed.', 'october-events'), '', ['response' => 403]);
        }
        $existing = isset($_POST['existing_key']) ? sanitize_key((string) $_POST['existing_key']) : '';
        $def = [
            'key'          => (string) ($_POST['key'] ?? ''),
            'label'        => (string) wp_unslash($_POST['label'] ?? ''),
            'singular'     => (string) wp_unslash($_POST['singular'] ?? ''),
            'types'        => array_map('sanitize_key', (array) ($_POST['types'] ?? [])),
            'hierarchical' => ! empty($_POST['hierarchical']),
            'show_filter'  => ! empty($_POST['show_filter']),
            'filter_style' => (string) ($_POST['filter_style'] ?? 'chips'),
        ];
        $key = Registry::save($def, $existing);
        self::redirect($key !== '' ? 'tax_saved' : 'error', $key);
    }

    public static function delete(): void {
        self::require_cap();
        $key = isset($_GET['key']) ? sanitize_key((string) $_GET['key']) : '';
        if (! $key || ! check_admin_referer('oe_tax_delete_' . $key)) {
            wp_die(esc_html__('Not allowed.', 'october-events'), '', ['response' => 403]);
        }
        Registry::delete($key);
        self::redirect('tax_deleted');
    }

    public static function add_term(): void {
        self::require_cap();
        $tax = isset($_POST['taxonomy']) ? sanitize_key((string) $_POST['taxonomy']) : '';
        if (! $tax || ! check_admin_referer('oe_term_add_' . $tax)) {
            wp_die(esc_html__('Not allowed.', 'october-events'), '', ['response' => 403]);
        }
        $name  = trim(sanitize_text_field((string) wp_unslash($_POST['term_name'] ?? '')));
        $color = sanitize_hex_color((string) ($_POST['term_color'] ?? ''));
        if ($name !== '' && taxonomy_exists($tax)) {
            $res = wp_insert_term($name, $tax);
            if (! is_wp_error($res) && $color) {
                update_term_meta((int) $res['term_id'], Registry::COLOR_META, $color);
            }
        }
        self::redirect('term_added', $tax);
    }

    public static function delete_term(): void {
        self::require_cap();
        $tax  = isset($_GET['taxonomy']) ? sanitize_key((string) $_GET['taxonomy']) : '';
        $term = isset($_GET['term']) ? (int) $_GET['term'] : 0;
        if (! $tax || ! $term || ! check_admin_referer('oe_term_delete_' . $tax . '_' . $term)) {
            wp_die(esc_html__('Not allowed.', 'october-events'), '', ['response' => 403]);
        }
        if (taxonomy_exists($tax)) {
            wp_delete_term($term, $tax);
        }
        self::redirect('term_deleted', $tax);
    }

    private static function redirect(string $msg, string $open = ''): void {
        $args = ['page' => 'oe-taxonomies', 'oe_msg' => $msg];
        if ($open !== '') {
            $args['open'] = $open;
        }
        wp_safe_redirect(add_query_arg($args, admin_url('admin.php')));
        exit;
    }
}
