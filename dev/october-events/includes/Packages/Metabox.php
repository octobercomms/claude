<?php
declare(strict_types=1);

namespace OE\Packages;

defined('ABSPATH') || exit;

/**
 * Package editor metabox (BUILD-PLAN Track F).
 *
 * The admin CRUD for a partner package: the WordPress title is the package
 * name, the editor its long description, and this metabox carries the
 * commercial detail — price (+VAT), display order, what it unlocks
 * (entitlements), tier type, availability (stock / dated window / visibility),
 * the Stripe price link and the "buy more than one" ceiling. One editor feeds
 * both the comparison matrix and the purchase wizard.
 *
 * Writes only `_oe_pkg_*` meta via Packages\Package, so it never touches foreign
 * meta and is safe to run additively.
 */
final class Metabox {

    private const NONCE = 'oe_package_save';

    /** Gated sections a package can unlock (keys match the entitlement layer). */
    private const SECTIONS = [
        'briefing'   => 'Partner briefing',
        'activities' => 'Activity booking',
        'assets'     => 'Downloadable assets',
        'directory'  => 'Directory listing',
    ];

    public static function init(): void {
        add_action('add_meta_boxes', [self::class, 'add']);
        add_action('save_post', [self::class, 'save'], 10, 2);
    }

    public static function add(): void {
        $pt = Package::slug();
        if ($pt === '' || ! post_type_exists($pt)) {
            return;
        }
        add_meta_box('oe-package-details', __('Package details', 'october-events'), [self::class, 'render'], $pt, 'normal', 'high');
    }

    public static function render(\WP_Post $post): void {
        $id = (int) $post->ID;
        wp_nonce_field(self::NONCE, self::NONCE);
        $v = static fn(string $f, $d = ''): string => (string) Package::get($id, $f, $d);
        $gated = Package::get($id, 'gated_sections', []);
        $gated = is_array($gated) ? $gated : [];
        $cur   = strtoupper((string) \OE\Settings::get('currency', 'usd'));
        $sym   = $cur === 'GBP' ? '£' : ($cur === 'EUR' ? '€' : '$');

        echo '<style>.oe-pkg-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 18px}.oe-pkg label{display:block;font-weight:600;margin:0 0 4px}.oe-pkg input[type=text],.oe-pkg input[type=number],.oe-pkg input[type=date],.oe-pkg select{width:100%}.oe-pkg .hint{font-weight:400;color:#777}.oe-pkg fieldset{border:1px solid #e0e0e0;border-radius:6px;padding:10px 12px;margin:0}.oe-pkg .check{display:block;font-weight:400;margin:2px 0}.oe-pkg .inline{display:flex;align-items:center;gap:8px}</style>';
        echo '<div class="oe-pkg">';

        // Commercial.
        echo '<div class="oe-pkg-grid">';
        printf(
            '<p><label>%s <span class="hint">(%s)</span></label><input type="number" step="0.01" min="0" name="oe_pkg[price]" value="%s"></p>',
            esc_html__('Price', 'october-events'),
            esc_html($sym . ' net'),
            esc_attr($v('price'))
        );
        printf(
            '<p><label>%s</label><span class="inline"><label class="check"><input type="checkbox" name="oe_pkg[vat]" value="1"%s> %s</label></span></p>',
            esc_html__('VAT', 'october-events'),
            checked($v('vat') === '1', true, false),
            esc_html__('Price is shown and charged +VAT', 'october-events')
        );
        printf(
            '<p><label>%s</label><input type="number" min="0" name="oe_pkg[display_order]" value="%s"></p>',
            esc_html__('Display order', 'october-events'),
            esc_attr($v('display_order'))
        );
        echo '<p><label>' . esc_html__('Tier type', 'october-events') . '</label><select name="oe_pkg[tier_type]">';
        foreach (Package::TIER_TYPES as $k => $lbl) {
            printf('<option value="%s"%s>%s</option>', esc_attr($k), selected($v('tier_type', 'standard'), $k, false), esc_html($lbl));
        }
        echo '</select></p>';
        echo '</div>';

        // Subsidised handling fee (shown always; relevant to managed-free packs).
        printf(
            '<p><label>%s <span class="hint">%s</span></label><input type="number" step="0.01" min="0" style="max-width:160px" name="oe_pkg[handling_fee]" value="%s"></p>',
            esc_html__('Handling fee', 'october-events'),
            esc_html__('(subsidised / managed-free packages that still take a handling fee)', 'october-events'),
            esc_attr($v('handling_fee'))
        );

        // Entitlements.
        echo '<hr style="margin:14px 0"><p style="font-weight:700;margin:0 0 8px">' . esc_html__('What it unlocks', 'october-events') . '</p>';
        echo '<div class="oe-pkg-grid">';
        printf(
            '<p><label>%s</label><input type="number" min="0" name="oe_pkg[unlock_count]" value="%s"><span class="hint">%s</span></p>',
            esc_html__('Activities / listings unlocked', 'october-events'),
            esc_attr($v('unlock_count')),
            esc_html__('0 = none; a number = how many this package pays for', 'october-events')
        );
        echo '<fieldset><legend style="font-weight:600">' . esc_html__('Gated sections', 'october-events') . '</legend>';
        foreach (self::SECTIONS as $k => $lbl) {
            printf(
                '<label class="check"><input type="checkbox" name="oe_pkg[gated_sections][]" value="%s"%s> %s</label>',
                esc_attr($k),
                in_array($k, $gated, true) ? ' checked' : '',
                esc_html($lbl)
            );
        }
        echo '</fieldset>';
        echo '</div>';

        // Availability.
        echo '<hr style="margin:14px 0"><p style="font-weight:700;margin:0 0 8px">' . esc_html__('Availability', 'october-events') . '</p>';
        echo '<div class="oe-pkg-grid">';
        printf(
            '<p><label>%s</label><input type="number" min="0" name="oe_pkg[stock]" value="%s"><span class="hint">%s</span></p>',
            esc_html__('Stock / limit', 'october-events'),
            esc_attr($v('stock')),
            esc_html__('blank or 0 = unlimited', 'october-events')
        );
        printf(
            '<p><label>%s</label><input type="number" min="0" name="oe_pkg[max_qty]" value="%s"><span class="hint">%s</span></p>',
            esc_html__('Buy-more ceiling', 'october-events'),
            esc_attr($v('max_qty')),
            esc_html__('max per order; blank or 1 = single', 'october-events')
        );
        printf(
            '<p><label>%s</label><input type="date" name="oe_pkg[opens_at]" value="%s"></p>',
            esc_html__('On sale from', 'october-events'),
            esc_attr($v('opens_at'))
        );
        printf(
            '<p><label>%s</label><input type="date" name="oe_pkg[closes_at]" value="%s"></p>',
            esc_html__('On sale until', 'october-events'),
            esc_attr($v('closes_at'))
        );
        echo '</div>';
        printf(
            '<p class="inline" style="margin-top:8px"><label class="check"><input type="checkbox" name="oe_pkg[visible]" value="1"%s> %s</label></p>',
            checked($v('visible', '1') === '1', true, false),
            esc_html__('Visible in the comparison matrix and wizard', 'october-events')
        );
        printf(
            '<p class="inline"><label class="check"><input type="checkbox" name="oe_pkg[highlight]" value="1"%s> %s</label></p>',
            checked($v('highlight') === '1', true, false),
            esc_html__('Highlight this column (recommended / most popular)', 'october-events')
        );

        // Payment link.
        echo '<hr style="margin:14px 0">';
        printf(
            '<p><label>%s</label><input type="text" name="oe_pkg[stripe_price]" value="%s" placeholder="price_…"><span class="hint">%s</span></p>',
            esc_html__('Stripe price ID', 'october-events'),
            esc_attr($v('stripe_price')),
            esc_html__('The wizard checks out against this price. Leave blank for a free / handling-fee-only package.', 'october-events')
        );

        echo '</div>'; // .oe-pkg
    }

    public static function save(int $post_id, \WP_Post $post): void {
        if ($post->post_type !== Package::slug()) {
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
        $input = isset($_POST['oe_pkg']) && is_array($_POST['oe_pkg']) ? wp_unslash($_POST['oe_pkg']) : [];
        Package::save_fields($post_id, $input);
    }
}
