<?php
declare(strict_types=1);

namespace OE\Sections;

use OE\Settings;
use OE\Planning\Events;
use OE\Packs\Registry;

defined('ABSPATH') || exit;

/**
 * Default single-listing output (BUILD-PLAN M2 — "a fresh install looks good
 * with zero design", Option A turnkey).
 *
 * Composes a single event from its active sections when the event has no body
 * content of its own. Deliberately conservative:
 *   - only on the main single-event view, in the loop;
 *   - only in native (non-adoption) mode — never where JetEngine/Elementor is
 *     rendering;
 *   - only when the owner hasn't turned it off;
 *   - only when the post body is empty, so author-written content is never
 *     clobbered (that is the Option B / bespoke path).
 *
 * This is the turnkey fallback; Option B (dropping the section shortcodes into a
 * built layout) is unaffected.
 */
final class SingleTemplate {

    public static function init(): void {
        add_filter('the_content', [self::class, 'filter'], 9);
    }

    public static function filter(string $content): string {
        if (! is_singular(Events::slug()) || ! in_the_loop() || ! is_main_query()) {
            return $content;
        }
        if (Settings::adoption_mode()) {
            return $content; // a legacy stack owns the template
        }
        if (! Settings::get('native_single_template', true)) {
            return $content;
        }
        $id = (int) get_the_ID();
        // Only fill a genuinely empty body; never replace author-written content.
        if (trim((string) get_post_field('post_content', $id)) !== '') {
            return $content;
        }
        $out = '';
        foreach (Registry::active_sections($id) as $shortcode) {
            $out .= do_shortcode($shortcode);
        }
        return trim($out) !== '' ? $out : $content;
    }
}
