<?php
declare(strict_types=1);

namespace OE\Packs\Content;

defined('ABSPATH') || exit;

/**
 * Tour pack location entry UI (FRONTEND-BUILD slice D).
 *
 * A locations repeater on the event editor, stored via Store
 * (`_oe_tour_locations`). Each location carries its image, day label, address,
 * map link and the design credits (architect, interior/landscape designer,
 * developer, photographer, realtor). Mechanics live in RepeaterMetabox.
 */
final class TourMeta extends RepeaterMetabox {

    protected static function box_id(): string {
        return 'oe-tour-locations';
    }

    protected static function box_title(): string {
        return __('Tour locations', 'october-events');
    }

    protected static function pack(): string {
        return 'tour';
    }

    protected static function intro(bool $enabled): string {
        return $enabled
            ? (string) __('The Tour pack is on, so these locations show on the event page with a day filter.', 'october-events')
            : (string) __('Fill this in now; it shows once the Tour pack is switched on under Capabilities.', 'october-events');
    }

    protected static function repeaters(): array {
        return [
            'locations' => [__('Locations', 'october-events'), [
                'name'                => [__('Name', 'october-events'), 'text'],
                'image'               => [__('Image', 'october-events'), 'image'],
                'day'                 => [__('Day (e.g. Saturday)', 'october-events'), 'text'],
                'address'             => [__('Address', 'october-events'), 'text'],
                'maps_url'            => [__('Map link', 'october-events'), 'url'],
                'architect'           => [__('Architect', 'october-events'), 'text'],
                'interior_designer'   => [__('Interior designer', 'october-events'), 'text'],
                'landscape_architect' => [__('Landscape architect', 'october-events'), 'text'],
                'developer'           => [__('Developer', 'october-events'), 'text'],
                'photographer'        => [__('Photographer', 'october-events'), 'text'],
                'realtor'             => [__('Realtor', 'october-events'), 'text'],
            ]],
        ];
    }
}
