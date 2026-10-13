<?php
declare(strict_types=1);

namespace OE\Sections;

use OE\PostTypes;
use OE\Planning\Events;

defined('ABSPATH') || exit;

/**
 * Listing archive + filters (BUILD-PLAN M2 / FRONTEND-BUILD slice F).
 *
 * A droppable shortcode scoped to one listing type:
 *
 *   [oe_listings type="event" show="upcoming" chips="building-type"
 *                filters="tour-cities,tour-years" search="1" per_page="12"]
 *
 * The archive is scoped to one type (no "type" chooser). `chips` names one
 * taxonomy rendered as a chip row (e.g. building type); `filters` names taxonomies
 * rendered as dropdowns (e.g. city, year); `search` adds a free-text box. All
 * three apply server-side from the query string and compose together, preserving
 * each other's state. `show` does a best-effort upcoming/past split on the stored
 * start date. Designed by assets/css/sections.css via the oe-sec/oe-arch classes.
 */
final class Archive {

    public static function init(): void {
        add_shortcode('oe_listings', [self::class, 'render']);
    }

    public static function render($atts): string {
        $atts = shortcode_atts([
            'type'     => 'event',
            'show'     => 'all',      // all | upcoming | past
            'chips'    => '',         // one taxonomy slug, rendered as a chip row
            'filters'  => '',         // comma-separated taxonomy slugs, as dropdowns
            'search'   => '1',        // 1 to show a free-text search box
            'per_page' => '12',
        ], is_array($atts) ? $atts : [], 'oe_listings');

        $pt = PostTypes::slug((string) $atts['type']);
        if ($pt === '' || ! post_type_exists($pt)) {
            return '';
        }

        $selects  = array_values(array_filter(array_map('trim', explode(',', (string) $atts['filters']))));
        $chips_tax = trim((string) $atts['chips']);
        $per_page = max(1, (int) $atts['per_page']);
        $paged    = max(1, (int) get_query_var('paged', 1));
        if ($paged === 1 && isset($_GET['oe_page'])) {
            $paged = max(1, (int) $_GET['oe_page']);
        }
        $search = ((string) $atts['search'] === '1' && isset($_GET['oe_q']))
            ? sanitize_text_field(wp_unslash((string) $_GET['oe_q']))
            : '';

        $query_args = [
            'post_type'      => $pt,
            'post_status'    => 'publish',
            'posts_per_page' => $per_page,
            'paged'          => $paged,
            'orderby'        => 'date',
            'order'          => 'DESC',
        ];
        if ($search !== '') {
            $query_args['s'] = $search;
        }

        $show = (string) $atts['show'];
        if ($show === 'upcoming' || $show === 'past') {
            $query_args['meta_query'] = [[
                'key'     => Events::key('start_datetime'),
                'value'   => current_time('Y-m-d'),
                'compare' => $show === 'upcoming' ? '>=' : '<',
                'type'    => 'CHAR',
            ]];
            $query_args['orderby']  = 'meta_value';
            $query_args['meta_key'] = Events::key('start_datetime');
            $query_args['order']    = $show === 'upcoming' ? 'ASC' : 'DESC';
        }

        // Taxonomy filters (chips + selects) from the query string.
        $tax_query = [];
        $selected  = [];
        foreach (array_filter(array_merge($selects, [$chips_tax])) as $tax) {
            if (! taxonomy_exists($tax)) {
                continue;
            }
            $val = isset($_GET['oe_' . $tax]) ? sanitize_title(wp_unslash((string) $_GET['oe_' . $tax])) : '';
            $selected[$tax] = $val;
            if ($val !== '') {
                $tax_query[] = ['taxonomy' => $tax, 'field' => 'slug', 'terms' => [$val]];
            }
        }
        if ($tax_query) {
            $query_args['tax_query'] = $tax_query;
        }

        $has_filter = $search !== '' || (bool) array_filter($selected);

        $q = new \WP_Query($query_args);
        if (! $q->have_posts() && ! $has_filter) {
            return '';
        }

        Theme::enqueue();
        $out  = '<section class="oe-sec oe-sec--archive oe-arch">';
        if ($chips_tax !== '' && taxonomy_exists($chips_tax)) {
            $out .= self::chips_row($chips_tax, $selected[$chips_tax] ?? '');
        }
        $out .= self::filter_form($selects, $selected, $search, (string) $atts['search'] === '1', $chips_tax);
        $out .= '<div class="oe-arch__grid">';
        if ($q->have_posts()) {
            while ($q->have_posts()) {
                $q->the_post();
                $out .= self::card((int) get_the_ID());
            }
        } else {
            $out .= '<p class="oe-arch__empty">' . esc_html__('Nothing matches that filter.', 'october-events') . '</p>';
        }
        $out .= '</div>';
        $out .= self::pager($q, $paged);
        $out .= '</section>';

        wp_reset_postdata();
        return $out;
    }

    private static function card(int $id): string {
        $img  = get_the_post_thumbnail($id, 'medium', ['class' => 'oe-arch__img', 'loading' => 'lazy']);
        $meta = array_filter([
            trim((string) Events::get($id, 'start_datetime', '')),
            trim((string) Events::get($id, 'location', '')),
        ]);
        $brand = trim((string) Events::get($id, 'brand_colour', ''));
        $style = $brand !== '' ? ' style="--oe-brand:' . esc_attr($brand) . '"' : '';
        return sprintf(
            '<a class="oe-arch__card"%s href="%s">%s<span class="oe-arch__body"><span class="oe-arch__title">%s</span>%s</span></a>',
            $style,
            esc_url(get_permalink($id)),
            $img,
            esc_html(get_the_title($id)),
            $meta ? '<span class="oe-arch__meta">' . esc_html(implode(' · ', $meta)) . '</span>' : ''
        );
    }

    /** A chip row for one taxonomy: All + each term, as links that preserve state. */
    private static function chips_row(string $tax, string $active): string {
        $terms = get_terms(['taxonomy' => $tax, 'hide_empty' => true]);
        if (is_wp_error($terms) || ! $terms) {
            return '';
        }
        $key  = 'oe_' . $tax;
        $base = remove_query_arg([$key, 'oe_page']);
        $all  = '<a class="oe-loc-filter' . ($active === '' ? ' is-active' : '') . '" href="' . esc_url($base) . '">'
            . esc_html__('All', 'october-events') . '</a>';
        $chips = $all;
        foreach ($terms as $term) {
            $url = add_query_arg($key, $term->slug, $base);
            $chips .= '<a class="oe-loc-filter' . ($active === $term->slug ? ' is-active' : '') . '" href="' . esc_url($url) . '">'
                . esc_html($term->name) . '</a>';
        }
        return '<div class="oe-arch__chips">' . $chips . '</div>';
    }

    /**
     * @param string[]             $filters  select taxonomies
     * @param array<string,string> $selected tax => slug
     */
    private static function filter_form(array $filters, array $selected, string $search, bool $show_search, string $chips_tax): string {
        $controls = '';
        foreach ($filters as $tax) {
            if (! taxonomy_exists($tax)) {
                continue;
            }
            $terms = get_terms(['taxonomy' => $tax, 'hide_empty' => true]);
            if (is_wp_error($terms) || ! $terms) {
                continue;
            }
            $obj   = get_taxonomy($tax);
            $label = $obj ? $obj->labels->singular_name : $tax;
            $opts  = '<option value="">' . esc_html(sprintf(__('All %s', 'october-events'), $label)) . '</option>';
            foreach ($terms as $term) {
                $opts .= sprintf(
                    '<option value="%s"%s>%s</option>',
                    esc_attr($term->slug),
                    selected($selected[$tax] ?? '', $term->slug, false),
                    esc_html($term->name)
                );
            }
            $controls .= sprintf(
                '<label class="oe-arch__filter"><span>%s</span><select name="oe_%s">%s</select></label>',
                esc_html($label),
                esc_attr($tax),
                $opts
            );
        }
        if ($show_search) {
            $controls .= '<label class="oe-arch__filter"><span>' . esc_html__('Search', 'october-events') . '</span>'
                . '<input type="search" class="oe-arch__search" name="oe_q" value="' . esc_attr($search) . '" placeholder="'
                . esc_attr__('Search…', 'october-events') . '"></label>';
        }
        if ($controls === '') {
            return '';
        }
        // Keep the active chip selection across a filter submit.
        $hidden = '';
        if ($chips_tax !== '' && ! empty($selected[$chips_tax])) {
            $hidden = '<input type="hidden" name="oe_' . esc_attr($chips_tax) . '" value="' . esc_attr($selected[$chips_tax]) . '">';
        }
        return '<form class="oe-arch__filters" method="get">' . $controls . $hidden
            . '<button type="submit" class="oe-btn oe-arch__apply">' . esc_html__('Filter', 'october-events') . '</button></form>';
    }

    private static function pager(\WP_Query $q, int $paged): string {
        $total = (int) $q->max_num_pages;
        if ($total < 2) {
            return '';
        }
        $base = remove_query_arg('oe_page');
        $out  = '<nav class="oe-arch__pager">';
        for ($i = 1; $i <= $total; $i++) {
            $url = esc_url(add_query_arg('oe_page', $i, $base));
            $out .= $i === $paged
                ? '<span class="oe-arch__page is-current">' . $i . '</span>'
                : '<a class="oe-arch__page" href="' . $url . '">' . $i . '</a>';
        }
        return $out . '</nav>';
    }
}
