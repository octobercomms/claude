<?php
declare(strict_types=1);

namespace OE\Ads;

use OE\Features;

defined('ABSPATH') || exit;

/**
 * Ads module loader (BUILD-PLAN Track G — fold oc-ad-manager in as a toggleable
 * module).
 *
 * The ad manager (campaigns, rotation, click/impression tracking, the booking
 * form + Stripe, the partner syndication feed and the `[oc_ad]` shortcodes) is
 * vendored verbatim under modules/ads/. This loader boots it inside October
 * Events when the `ads` feature is on, so the standalone plugin can eventually
 * be retired — but only when the standalone is NOT active, so the two never
 * double-load the same classes, hooks or tables on a site running both.
 *
 * Boot timing is equivalent to the standalone plugin's: October Events boots on
 * `plugins_loaded`, and the ad manager registers everything through later hooks
 * (`rest_api_init`, `wp_enqueue_scripts`, `template_redirect`, `init`), so
 * requiring its bootstrap here registers them at the same point they'd register
 * on a normal plugin load.
 *
 * Retiring the standalone plugin (deactivating it, then removing
 * dev/oc-ad-manager) is the staging follow-up once this module is verified.
 */
final class Module {

    public static function init(): void {
        if (! Features::enabled('ads')) {
            return;
        }
        // The standalone oc-ad-manager plugin defines OCAD_Campaign. If it is
        // active, stand down entirely so nothing double-registers.
        if (class_exists('OCAD_Campaign') || defined('OCAD_VERSION')) {
            return;
        }
        $bootstrap = OE_DIR . 'modules/ads/oc-ad-manager.php';
        if (! is_file($bootstrap)) {
            return;
        }
        require_once $bootstrap;

        // The standalone ensures its tables via a register_activation_hook and a
        // plugins_loaded version check; neither fires when the file is required
        // as a module, so ensure them here (idempotent dbDelta, gated on the
        // version option so it runs once per version).
        if (class_exists('OCAD_Activator') && get_option('ocad_version') !== (defined('OCAD_VERSION') ? OCAD_VERSION : '')) {
            \OCAD_Activator::activate();
        }

        // Folded in, ads belong under the October Events menu like every other
        // module, not as their own top-level item. The vendored module registers
        // a top-level "Ad Manager" menu (admin_menu @10); drop it here (@999) so
        // only the October-styled overview under October Events → Ad manager
        // shows. The module's own screens (ocad-add-campaign / ocad-report /
        // ocad-bookings) stay reachable by URL — removing a menu does not
        // unregister its pages — and the overview links to them.
        add_action('admin_menu', [self::class, 'dedupe_menu'], 999);
    }

    /** Remove the vendored module's own top-level menu when folded in. */
    public static function dedupe_menu(): void {
        remove_menu_page('oc-ad-manager');
    }
}
