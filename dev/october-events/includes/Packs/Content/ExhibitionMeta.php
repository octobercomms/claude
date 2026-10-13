<?php
declare(strict_types=1);

namespace OE\Packs\Content;

defined('ABSPATH') || exit;

/**
 * Exhibition pack entry UI (FRONTEND-BUILD slice C).
 *
 * One exhibitor repeater on the event editor, stored via Store
 * (`_oe_exhibition_exhibitors`). Mechanics live in RepeaterMetabox.
 */
final class ExhibitionMeta extends RepeaterMetabox {

    protected static function box_id(): string {
        return 'oe-exhibition';
    }

    protected static function box_title(): string {
        return __('Exhibition content', 'october-events');
    }

    protected static function pack(): string {
        return 'exhibition';
    }

    protected static function intro(bool $enabled): string {
        return $enabled
            ? (string) __('The Exhibition pack is on, so these exhibitors show on the event page.', 'october-events')
            : (string) __('Fill this in now; it shows once the Exhibition pack is switched on under Capabilities.', 'october-events');
    }

    protected static function repeaters(): array {
        return [
            'exhibitors' => [__('Exhibitors', 'october-events'), [
                'name'      => [__('Name', 'october-events'), 'text'],
                'image'     => [__('Image / logo', 'october-events'), 'image'],
                'desc'      => [__('Description', 'october-events'), 'textarea'],
                'linkedin'  => [__('LinkedIn URL', 'october-events'), 'url'],
                'instagram' => [__('Instagram URL', 'october-events'), 'url'],
                'website'   => [__('Website URL', 'october-events'), 'url'],
            ]],
        ];
    }
}
