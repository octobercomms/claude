<?php
declare(strict_types=1);

namespace OE\Taxonomies;

use OE\PostTypes;

defined('ABSPATH') || exit;

/**
 * Custom taxonomies for listing types (ADMIN-BUILD AD12).
 *
 * Admins define taxonomies (stored in one option) and attach them to one or more
 * listing types. Each is registered on `init` against the mapped CPTs, so terms
 * can be managed and queried like any taxonomy. Terms carry an optional color
 * (term meta) and a taxonomy can be flagged "show as filter", which the
 * `[oe_listings]` archive picks up via `chips="auto"` / `filters="auto"`.
 *
 * Definition shape:
 *   key          taxonomy slug (<=32 chars, unique)
 *   label        plural label
 *   singular     singular label
 *   types        listing type keys it attaches to (directory/destination/...)
 *   hierarchical bool (category-like vs tag-like)
 *   show_filter  bool (appears in auto facets)
 *   filter_style 'chips' | 'dropdown'
 */
final class Registry {

    private const OPTION    = 'oe_taxonomies';
    public const COLOR_META = 'oe_term_color';

    public static function init(): void {
        // After PostTypes (priority 10) so the CPTs exist to attach to.
        add_action('init', [self::class, 'register'], 11);
    }

    /** @return array<string,array<string,mixed>> key => definition */
    public static function all(): array {
        $raw = get_option(self::OPTION, []);
        return is_array($raw) ? $raw : [];
    }

    public static function get(string $key): ?array {
        $all = self::all();
        return isset($all[$key]) ? $all[$key] : null;
    }

    /** Register every defined taxonomy against its listing CPTs. */
    public static function register(): void {
        foreach (self::all() as $key => $def) {
            $objects = [];
            foreach ((array) ($def['types'] ?? []) as $type) {
                $slug = PostTypes::slug((string) $type);
                if ($slug !== '') {
                    $objects[] = $slug;
                }
            }
            if (! $objects) {
                continue;
            }
            $label    = (string) ($def['label'] ?? $key);
            $singular = (string) ($def['singular'] ?? $label);
            register_taxonomy($key, $objects, [
                'label'             => $label,
                'labels'            => [
                    'name'          => $label,
                    'singular_name' => $singular,
                    'menu_name'     => $label,
                ],
                'hierarchical'      => ! empty($def['hierarchical']),
                'public'            => true,
                'show_ui'           => true,
                'show_admin_column' => true,
                'show_in_rest'      => true,
                'rewrite'           => ['slug' => $key],
            ]);
            register_term_meta($key, self::COLOR_META, [
                'type'         => 'string',
                'single'       => true,
                'show_in_rest' => true,
            ]);
        }
    }

    /**
     * Save (create or update) a taxonomy definition. Returns the stored key, or
     * '' on invalid input.
     *
     * @param array<string,mixed> $def
     */
    public static function save(array $def, string $existing_key = ''): string {
        $key = $existing_key !== '' ? $existing_key : sanitize_key((string) ($def['key'] ?? ''));
        $key = substr($key, 0, 32);
        $label = trim(sanitize_text_field((string) ($def['label'] ?? '')));
        if ($key === '' || $label === '') {
            return '';
        }
        $types = array_values(array_intersect(
            array_map('sanitize_key', (array) ($def['types'] ?? [])),
            PostTypes::listing_types()
        ));
        $all = self::all();
        $all[$key] = [
            'key'          => $key,
            'label'        => $label,
            'singular'     => trim(sanitize_text_field((string) ($def['singular'] ?? $label))) ?: $label,
            'types'        => $types,
            'hierarchical' => ! empty($def['hierarchical']),
            'show_filter'  => ! empty($def['show_filter']),
            'filter_style' => (($def['filter_style'] ?? 'chips') === 'dropdown') ? 'dropdown' : 'chips',
        ];
        update_option(self::OPTION, $all, false);
        return $key;
    }

    public static function delete(string $key): void {
        $all = self::all();
        unset($all[$key]);
        update_option(self::OPTION, $all, false);
    }

    /**
     * Taxonomy slugs flagged as filters for a listing type, split by style.
     *
     * @return array{chips:array<int,string>,dropdown:array<int,string>}
     */
    public static function filters_for(string $type): array {
        $out = ['chips' => [], 'dropdown' => []];
        foreach (self::all() as $key => $def) {
            if (empty($def['show_filter'])) {
                continue;
            }
            if (! in_array($type, (array) ($def['types'] ?? []), true)) {
                continue;
            }
            $style = ($def['filter_style'] ?? 'chips') === 'dropdown' ? 'dropdown' : 'chips';
            $out[$style][] = (string) $key;
        }
        return $out;
    }

    public static function term_color(int $term_id): string {
        return (string) get_term_meta($term_id, self::COLOR_META, true);
    }
}
