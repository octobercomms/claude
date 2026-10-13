<?php
declare(strict_types=1);

namespace OE\Admin;

defined('ABSPATH') || exit;

/**
 * Shared right-hand slide-in panel helper (ADMIN-BUILD AD16).
 *
 * One primitive for the many "open a panel to do one thing" flows (add order,
 * message attendees, new group, add a team member, location editor, …). A
 * screen renders a trigger button and a panel; the shared script
 * (assets/js/admin-slidein.js) handles open/close, backdrop and Escape. The
 * person-record slide-in on the CRM screen uses the same CSS vocabulary.
 *
 * Usage:
 *   SlideIn::enqueue();
 *   echo SlideIn::trigger('oe-team-add', '+ Add to the team', 'button button-primary');
 *   SlideIn::open('oe-team-add', 'Add to the team');   // echoes panel opening
 *   // ... form markup ...
 *   SlideIn::close();                                   // echoes panel closing
 */
final class SlideIn {

    private static bool $enqueued = false;

    /** Register + enqueue the shared controller script. Safe to call repeatedly. */
    public static function enqueue(): void {
        if (self::$enqueued) {
            return;
        }
        self::$enqueued = true;
        wp_enqueue_script(
            'oe-slidein',
            OE_URL . 'assets/js/admin-slidein.js',
            [],
            OE_VERSION,
            true
        );
    }

    /** A button that opens the panel with id $panel_id. */
    public static function trigger(string $panel_id, string $label, string $class = 'button'): string {
        return sprintf(
            '<button type="button" class="%s" data-oe-slide-open="%s">%s</button>',
            esc_attr($class),
            esc_attr($panel_id),
            esc_html($label)
        );
    }

    /**
     * Open the panel wrapper (echoes). Pass $open_now = true to have it open on
     * page load (e.g. when re-rendering after a validation error).
     */
    public static function open(string $panel_id, string $title, bool $open_now = false): void {
        self::enqueue();
        printf(
            '<aside class="oe-slide%s" id="%s" role="dialog" aria-label="%s"%s>',
            $open_now ? ' is-open' : '',
            esc_attr($panel_id),
            esc_attr($title),
            $open_now ? ' data-oe-open="1"' : ''
        );
        echo '<div class="oe-slide-head"><h2>' . esc_html($title) . '</h2>'
            . '<button type="button" class="oe-slide-x" data-oe-slide-close aria-label="' . esc_attr__('Close', 'october-events') . '">×</button></div>';
        echo '<div class="oe-slide-body">';
    }

    /** Close the panel wrapper (echoes). */
    public static function close(): void {
        echo '</div></aside>';
    }
}
