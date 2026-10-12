<?php
declare(strict_types=1);

namespace OE\Sections;

use OE\PostTypes;
use OE\Planning\Events;

defined('ABSPATH') || exit;

/**
 * Listing archive + filters (BUILD-PLAN M2, native filtering replacing
 * JetSmartFilters). A droppable shortcode scoped to one listing type:
 *
 *   [oe_listings type="event" show="upcoming" filters="event-category" per_page="12"]
 *
 * The archive is scoped to a single type (no "type" filter), so a site that has
 * only tours or only events never shows a type chooser. Filters are driven by
 * whichever taxonomies the `filters` attribute names; each becomes a dropdown of
 * its terms, applied server-side from the query string. `show` does a best-effort
 * upcoming/past split on the stored start date. Renders nothing when the type has
 * no posts.
 *
 * This is presentation-light (the native-not-embed contract): a cards grid and a
 * GET filter form that inherit the theme, with `oe-sec`/`oe-arch` classes to
 * target. Cards link to the permalink; the slide-in quick-view is a later JS
 * enhancement.
 */
final class Archive {

    public static function init(): void {
        add_shortcode('oe_listings', [self::class, 'render']);
    }

    public static function render($atts): string {
        $atts = shortcode_atts([
            'type'     => 'event',
            'show'     => 'all',      // all | upcoming | past
            'filters'  => '',         // comma-separated taxonomy slugs
            'per_page' => '12',
        ], is_array($atts) ? $atts : [], 'oe_listings');

        $pt = PostTypes::slug((string) $atts['type']);
        if ($pt === '' || ! post_type_exists($pt)) {
            return '';
        }

        $filters  = array_values(array_filter(array_map('trim', explode(',', (string) $atts['filters']))));
        $per_page = max(1, (int) $atts['per_page']);
        $paged    = max(1, (int) get_query_var('paged', 1));
        if ($paged === 1 && isset($_GET['oe_page'])) {
            $paged = max(1, (int) $_GET['oe_page']);
        }

        $query_args = [
            'post_type'      => $pt,
            'post_status'    => 'publish',
            'posts_per_page' => $per_page,
            'paged'          => $paged,
            'orderby'        => 'date',
            'order'          => 'DESC',
        ];

        // Upcoming / past: best-effort on the stored start date (native data).
        $show = (string) $atts['show'];
        if ($show === 'upcoming' || $show === 'past') {
            $query_args['meta_query'] = [[
                'key'     => Events::key('start_datetime'),
                'value'   => current_time('Y-m-d'),
                'compare' => $show === 'upcoming' ? '>=' : '<',
                'type'    => 'CHAR',
            ]];
            $query_args['orderby'] = 'meta_value';
            $query_args['meta_key'] = Events::key('start_datetime');
            $query_args['order']   = $show === 'upcoming' ? 'ASC' : 'DESC';
        }

        // Taxonomy filters from the query string.
        $tax_query = [];
        $selected  = [];
        foreach ($filters as $tax) {
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

        $q = new \WP_Query($query_args);
        if (! $q->have_posts() && empty($selected)) {
            return '';
        }

        $out  = '<section class="oe-sec oe-sec--archive oe-arch">';
        $out .= self::filter_form($filters, $selected);
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
            '<a class="oe-arch__card"%s href="%s">%s<span class="oe-arch__title">%s</span>%s</a>',
            $style,
            esc_url(get_permalink($id)),
            $img,
            esc_html(get_the_title($id)),
            $meta ? '<span class="oe-arch__meta">' . esc_html(implode(' · ', $meta)) . '</span>' : ''
        );
    }

    /**
     * @param string[] $filters
     * @param array<string,string> $selected
     */
    private static function filter_form(array $filters, array $selected): string {
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
        if ($controls === '') {
            return '';
        }
        return '<form class="oe-arch__filters" method="get">' . $controls
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
