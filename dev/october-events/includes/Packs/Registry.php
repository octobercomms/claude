<?php
declare(strict_types=1);

namespace OE\Packs;

use OE\PostTypes;

defined('ABSPATH') || exit;

/**
 * Capability-pack registry (BUILD-PLAN M1.1 / EVENT-MODEL).
 *
 * One `event` type; everything beyond the base event is a *pack* switched on
 * per event. A pack reveals extra fields/metaboxes, behavior and public
 * output (its section shortcodes). Adding a pack never adds a CPT — it is one
 * entry here plus the metabox(es) that already exist for it.
 *
 * Enable state is a per-event meta flag `_oe_pack_{id}_enabled` ('1' / absent).
 * Nothing here enforces anything destructively; the registry is the single
 * place that answers "is pack X on for event Y?", with an
 * `oe_pack_enabled` filter so adoption-mode migration can map a site's legacy
 * switchers (e.g. ADF's `conference-page-switcher`) onto packs without the
 * registry knowing about any one tenant.
 *
 * @see docs/october-events/EVENT-MODEL.md
 * @see docs/october-events/BUILD-PLAN.md  (M1.1)
 */
final class Registry {

    /** Per-event meta flag: _oe_pack_{id}_enabled. */
    public const ENABLE_PREFIX = '_oe_pack_';
    public const ENABLE_SUFFIX = '_enabled';

    /**
     * Pack id => definition. `sections` are the section shortcodes a pack
     * contributes (also Gutenberg blocks / Elementor widgets); `builtin` marks
     * a pack whose engine already ships (so M1 is wiring the toggle, not the
     * feature). Order here is the order shown in the editor.
     *
     * @var array<string,array{label:string,icon:string,desc:string,sections:array<int,string>,builtin:bool}>
     */
    public const PACKS = [
        'tickets' => [
            'label'    => 'Tickets & check-in',
            'icon'     => '🎟',
            'desc'     => 'Sell or issue tickets, promo codes, waitlist and QR check-in.',
            'sections' => ['[oe_event_tickets]'],
            'builtin'  => true,
        ],
        'conference' => [
            'label'    => 'Conference',
            'icon'     => '🎤',
            'desc'     => 'Speakers, past speakers, a session agenda and accommodation.',
            'sections' => ['[oe_event_about]', '[oe_event_speakers]', '[oe_event_past_speakers]', '[oe_event_schedule]', '[oe_event_accommodation]'],
            'builtin'  => false,
        ],
        'exhibition' => [
            'label'    => 'Exhibition',
            'icon'     => '🖼',
            'desc'     => 'An exhibitor list.',
            'sections' => ['[oe_event_exhibitors]'],
            'builtin'  => false,
        ],
        'tour' => [
            'label'    => 'Multiple locations',
            'icon'     => '🗺',
            'desc'     => 'One or more locations with a map and optional timed-slot bookings.',
            'sections' => ['[oe_tour_locations]', '[oe_event_map]'],
            'builtin'  => true,
        ],
        'volunteers' => [
            'label'    => 'Volunteers',
            'icon'     => '🙋',
            'desc'     => 'Shifts and sign-ups for this event.',
            'sections' => ['[oe_event_volunteers]'],
            'builtin'  => true,
        ],
        'staff' => [
            'label'    => 'Staff / non-shift roles',
            'icon'     => '🧑‍💼',
            'desc'     => 'A role page with an apply-by-email form.',
            'sections' => ['[oe_event_staff]'],
            'builtin'  => false,
        ],
    ];

    /**
     * Base sections present on every event regardless of packs (the shared
     * hero / gallery / CTA). These never toggle; they short-circuit when empty.
     *
     * @var array<int,string>
     */
    public const BASE_SECTIONS = ['[oe_event_header]', '[oe_event_gallery]', '[oe_event_register]'];

    /** @return array<int,string> the known pack ids, in display order. */
    public static function ids(): array {
        return array_keys(self::PACKS);
    }

    public static function exists(string $id): bool {
        return isset(self::PACKS[$id]);
    }

    /** The per-event meta key that stores a pack's enable flag. */
    public static function enable_key(string $id): string {
        return self::ENABLE_PREFIX . $id . self::ENABLE_SUFFIX;
    }

    /**
     * Whether a pack is switched on for an event. Reads the per-event flag,
     * then runs the `oe_pack_enabled` filter so adoption-mode migration can
     * map a legacy switcher onto the pack without changing stored data.
     */
    public static function enabled(int $event_id, string $id): bool {
        if (! self::exists($id)) {
            return false;
        }
        $raw = get_post_meta($event_id, self::enable_key($id), true) === '1';
        return (bool) apply_filters('oe_pack_enabled', $raw, $event_id, $id);
    }

    /**
     * Set (or clear) a pack's enable flag for an event. Stored as '1' or
     * removed, so an unset pack leaves no row behind.
     */
    public static function set(int $event_id, string $id, bool $on): void {
        if (! self::exists($id)) {
            return;
        }
        if ($on) {
            update_post_meta($event_id, self::enable_key($id), '1');
        } else {
            delete_post_meta($event_id, self::enable_key($id));
        }
    }

    /**
     * Every pack's on/off state for an event.
     *
     * @return array<string,bool> pack id => enabled
     */
    public static function all_for(int $event_id): array {
        $out = [];
        foreach (self::ids() as $id) {
            $out[$id] = self::enabled($event_id, $id);
        }
        return $out;
    }

    /**
     * Section shortcodes that should render for an event: the always-on base
     * sections plus the sections of every pack that is on.
     *
     * @return array<int,string>
     */
    public static function active_sections(int $event_id): array {
        $sections = self::BASE_SECTIONS;
        foreach (self::PACKS as $id => $def) {
            if (self::enabled($event_id, $id)) {
                $sections = array_merge($sections, $def['sections']);
            }
        }
        return array_values(array_unique($sections));
    }

    /** The event post-type slug the packs attach to. */
    public static function post_type(): string {
        return PostTypes::slug('event');
    }
}
