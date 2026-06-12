<?php
declare(strict_types=1);

namespace OE\Planning;

use OE\Settings;

defined('ABSPATH') || exit;

/**
 * The confirm → green gating engine.
 *
 * A record only goes "confirmed" (green) once every required field is complete.
 * The required set is admin-configurable so it can be refined, but the default
 * is Elayne's four essentials for an event to be ready: title, dates/times,
 * price, location. The rule is enforced server-side, so "confirmed" is a fact
 * about the data, not just a button click.
 */
final class Gating {

    public const STATUS_DRAFT       = 'draft';
    public const STATUS_IN_PROGRESS = 'in_progress';
    public const STATUS_CONFIRMED   = 'confirmed';

    /**
     * Default required fields for an event to go green (Elayne's essentials).
     * Overridable via the `event_required_fields` setting.
     *
     * @return string[]
     */
    public static function event_required(): array {
        $default = ['name', 'start_datetime', 'price', 'location'];
        $set = (array) Settings::get('event_required_fields', []);
        $set = array_values(array_filter(array_map('sanitize_key', $set)));
        return $set ?: $default;
    }

    public static function field_label(string $key): string {
        $labels = [
            'name'           => __('Event title', 'october-events'),
            'start_datetime' => __('Dates & times', 'october-events'),
            'end_datetime'   => __('End date & time', 'october-events'),
            'price'          => __('Price', 'october-events'),
            'location'       => __('Location', 'october-events'),
            'description'    => __('Description', 'october-events'),
            'organiser'      => __('Organiser', 'october-events'),
            'image'          => __('Image', 'october-events'),
        ];
        return $labels[$key] ?? ucwords(str_replace('_', ' ', $key));
    }

    /**
     * Evaluate completeness of a flat field => value map against the required set.
     *
     * @param string[] $required
     * @param array<string,mixed> $values
     * @return array{required:string[],missing:string[],done:string[],complete:bool,percent:int}
     */
    public static function evaluate(array $required, array $values): array {
        $missing = [];
        $done    = [];
        foreach ($required as $key) {
            $v = $values[$key] ?? '';
            $filled = is_array($v) ? ! empty($v) : (trim((string) $v) !== '');
            if ($filled) {
                $done[] = $key;
            } else {
                $missing[] = $key;
            }
        }
        $total = count($required);
        return [
            'required' => $required,
            'missing'  => $missing,
            'done'     => $done,
            'complete' => $missing === [],
            'percent'  => $total ? (int) round(count($done) / $total * 100) : 100,
        ];
    }
}
