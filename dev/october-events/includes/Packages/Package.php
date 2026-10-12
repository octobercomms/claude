<?php
declare(strict_types=1);

namespace OE\Packages;

use OE\PostTypes;

defined('ABSPATH') || exit;

/**
 * Partner / sponsorship package entity (BUILD-PLAN Track F).
 *
 * A managed, admin-editable record so packages are content, not code. One editor
 * feeds both the comparison matrix and the multi-step purchase wizard, exactly
 * as ticket tiers already drive the checkout. Stored on the `oe_package` CPT:
 * the post title is the package name, the post content is the long description,
 * and the commercial fields live in `_oe_pkg_*` meta so nothing collides with
 * foreign plugins.
 *
 * Ties into the `entitlement_tier` gating primitive: a `tier_type` of
 * `subsidised` marks a Charities / Launch Pad / managed-free package that still
 * unlocks activities, distinct from a `standard` paid one. Paying for a package
 * unlocks the number of activities its `unlock_count` names, so packages and
 * gating share one mechanism.
 */
final class Package {

    public const PREFIX = '_oe_pkg_';

    /** Known package fields => sanitiser type (see sanitise()). */
    public const FIELDS = [
        'price'          => 'money',  // net price in major units (e.g. 1500.00)
        'vat'            => 'bool',   // true = price is shown/charged +VAT
        'display_order'  => 'int',    // ascending; ties break on title
        'unlock_count'   => 'int',    // how many activities/listings this unlocks (0 = none)
        'gated_sections' => 'csv',    // section keys this package unlocks (briefing, etc.)
        'tier_type'      => 'tier',   // standard | subsidised
        'handling_fee'   => 'money',  // for managed-free-with-handling-fee subsidised packs
        'stock'          => 'int',    // units available (0 or '' = unlimited)
        'opens_at'       => 'text',   // YYYY-MM-DD; before this the package is not on sale
        'closes_at'      => 'text',   // YYYY-MM-DD; after this the package is not on sale
        'visible'        => 'bool',   // false = hidden from the matrix/wizard even if on sale
        'stripe_price'   => 'text',   // Stripe price id (price_…) the wizard checks out with
        'max_qty'        => 'int',    // "buy more than one" ceiling (0/'' = single, 1 = single)
        'highlight'      => 'bool',   // feature this column in the comparison matrix
    ];

    /** tier_type => label. */
    public const TIER_TYPES = [
        'standard'   => 'Standard (paid)',
        'subsidised' => 'Subsidised (charity / launch pad / managed-free)',
    ];

    public static function slug(): string {
        return PostTypes::slug('package');
    }

    public static function key(string $field): string {
        return self::PREFIX . $field;
    }

    public static function get(int $id, string $field, $default = '') {
        if (! array_key_exists($field, self::FIELDS)) {
            return $default;
        }
        $v = get_post_meta($id, self::key($field), true);
        return ($v === '' || $v === false) ? $default : $v;
    }

    /**
     * Sanitise a value by its declared field type. Returns a storage-ready
     * string (or a list for `csv`).
     *
     * @return string|string[]
     */
    public static function sanitise(string $field, $value) {
        switch (self::FIELDS[$field] ?? 'text') {
            case 'money':
                $n = is_numeric($value) ? (float) $value : (float) preg_replace('/[^0-9.\-]/', '', (string) $value);
                return $n > 0 ? number_format($n, 2, '.', '') : '';
            case 'bool':
                return $value ? '1' : '';
            case 'int':
                return (string) $value === '' ? '' : (string) max(0, (int) $value);
            case 'tier':
                $v = sanitize_key((string) $value);
                return isset(self::TIER_TYPES[$v]) ? $v : 'standard';
            case 'csv':
                $items = is_array($value) ? $value : explode(',', (string) $value);
                $items = array_values(array_filter(array_map(static fn($s) => sanitize_key(trim((string) $s)), $items)));
                return array_values(array_unique($items));
            default:
                return sanitize_text_field((string) $value);
        }
    }

    /** Write one field; an empty value deletes the row. */
    public static function set(int $id, string $field, $value): void {
        if (! array_key_exists($field, self::FIELDS)) {
            return;
        }
        $clean = self::sanitise($field, $value);
        if ($clean === '' || $clean === []) {
            delete_post_meta($id, self::key($field));
        } else {
            update_post_meta($id, self::key($field), $clean);
        }
    }

    /**
     * Save a posted field map. Bool fields read by presence; everything else by
     * key presence, so an untouched field keeps its stored value.
     *
     * @param array<string,mixed> $input
     */
    public static function save_fields(int $id, array $input): void {
        foreach (self::FIELDS as $field => $type) {
            if ($type === 'bool') {
                self::set($id, $field, ! empty($input[$field]));
                continue;
            }
            if (array_key_exists($field, $input)) {
                self::set($id, $field, $input[$field]);
            }
        }
    }

    /**
     * All field values for one package, plus the title (name) and content
     * (description), normalised for the matrix / wizard.
     *
     * @return array<string,mixed>
     */
    public static function values(int $id): array {
        $v = [];
        foreach (array_keys(self::FIELDS) as $f) {
            $v[$f] = self::get($id, $f, '');
        }
        $post = get_post($id);
        $v['id']          = $id;
        $v['name']        = $post ? get_the_title($post) : '';
        $v['description'] = $post ? (string) $post->post_content : '';
        $v['tier_type']   = $v['tier_type'] !== '' ? $v['tier_type'] : 'standard';
        return $v;
    }

    /** True when a package is on sale right now (visible, dated window, in stock). */
    public static function on_sale(int $id): bool {
        if (get_post_status($id) !== 'publish') {
            return false;
        }
        if (self::get($id, 'visible', '1') === '') {
            return false;
        }
        $today = current_time('Y-m-d');
        $opens = (string) self::get($id, 'opens_at', '');
        $closes = (string) self::get($id, 'closes_at', '');
        if ($opens !== '' && $today < $opens) {
            return false;
        }
        if ($closes !== '' && $today > $closes) {
            return false;
        }
        return self::remaining($id) !== 0;
    }

    /**
     * Units still available. Returns -1 for unlimited (no stock set), else the
     * stock less the paid-order count for this package.
     */
    public static function remaining(int $id): int {
        $stock = (int) self::get($id, 'stock', 0);
        if ($stock <= 0) {
            return -1; // unlimited
        }
        return max(0, $stock - self::sold($id));
    }

    /**
     * Count of paid package orders (reuses the ticketing orders table via its
     * `package_id` column). Returns 0 until the column exists (a site between
     * the plugin update and the db-version upgrade that adds it), so stock maths
     * never fatals on a half-upgraded install.
     */
    public static function sold(int $id): int {
        global $wpdb;
        $orders = \OE\Ticketing\Schema::orders();
        $has_col = $wpdb->get_var($wpdb->prepare("SHOW COLUMNS FROM {$orders} LIKE %s", 'package_id'));
        if (! $has_col) {
            return 0;
        }
        return (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COALESCE(SUM(qty),0) FROM {$orders} WHERE package_id = %d AND status = 'paid'",
            $id
        ));
    }

    /**
     * Published packages ordered for display (display_order asc, then title).
     * `$sale_only` restricts to packages currently on sale.
     *
     * @return int[]
     */
    public static function all(bool $sale_only = false): array {
        $pt = self::slug();
        if ($pt === '' || ! post_type_exists($pt)) {
            return [];
        }
        $ids = get_posts([
            'post_type'      => $pt,
            'post_status'    => 'publish',
            'posts_per_page' => 200,
            'fields'         => 'ids',
            'orderby'        => 'title',
            'order'          => 'ASC',
        ]);
        usort($ids, static function (int $a, int $b): int {
            $oa = (int) self::get($a, 'display_order', 0);
            $ob = (int) self::get($b, 'display_order', 0);
            if ($oa === $ob) {
                return strcasecmp(get_the_title($a), get_the_title($b));
            }
            return $oa <=> $ob;
        });
        if ($sale_only) {
            $ids = array_values(array_filter($ids, [self::class, 'on_sale']));
        }
        return $ids;
    }
}
