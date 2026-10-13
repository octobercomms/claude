<?php
declare(strict_types=1);

namespace OE\Packs\Content;

defined('ABSPATH') || exit;

/**
 * Conference pack entry UI (FRONTEND-BUILD slice B).
 *
 * Speakers, past speakers, schedule sessions and accommodation, entered as
 * repeaters on the event editor and stored via Store (`_oe_conference_*`). All
 * mechanics are in RepeaterMetabox; this only declares the fields.
 */
final class ConferenceMeta extends RepeaterMetabox {

    protected static function box_id(): string {
        return 'oe-conference';
    }

    protected static function box_title(): string {
        return __('Conference content', 'october-events');
    }

    protected static function pack(): string {
        return 'conference';
    }

    protected static function intro(bool $enabled): string {
        return $enabled
            ? (string) __('The Conference pack is on, so this content shows on the event page.', 'october-events')
            : (string) __('Fill this in now; it shows once the Conference pack is switched on under Capabilities.', 'october-events');
    }

    protected static function repeaters(): array {
        return [
            'speakers' => [__('Speakers', 'october-events'), [
                'name'      => [__('Name', 'october-events'), 'text'],
                'title'     => [__('Title / role', 'october-events'), 'text'],
                'photo'     => [__('Photo', 'october-events'), 'image'],
                'linkedin'  => [__('LinkedIn URL', 'october-events'), 'url'],
                'instagram' => [__('Instagram URL', 'october-events'), 'url'],
                'website'   => [__('Website URL', 'october-events'), 'url'],
            ]],
            'past_speakers' => [__('Past speakers', 'october-events'), [
                'name'  => [__('Name', 'october-events'), 'text'],
                'title' => [__('Title / role', 'october-events'), 'text'],
                'photo' => [__('Photo', 'october-events'), 'image'],
            ]],
            'sessions' => [__('Schedule', 'october-events'), [
                'day'   => [__('Day label (e.g. Sat 10 Oct)', 'october-events'), 'text'],
                'time'  => [__('Time', 'october-events'), 'text'],
                'title' => [__('Session', 'october-events'), 'text'],
                'desc'  => [__('Description', 'october-events'), 'textarea'],
            ]],
            'accommodation' => [__('Accommodation', 'october-events'), [
                'name'  => [__('Name', 'october-events'), 'text'],
                'image' => [__('Image', 'october-events'), 'image'],
                'desc'  => [__('Description', 'october-events'), 'textarea'],
                'link'  => [__('Link', 'october-events'), 'url'],
            ]],
        ];
    }
}
