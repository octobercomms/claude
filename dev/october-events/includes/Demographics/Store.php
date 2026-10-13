<?php
declare(strict_types=1);

namespace OE\Demographics;

defined('ABSPATH') || exit;

/**
 * Consent-gated demographic profile (ROADMAP R2, §11).
 *
 * Account-backed, never browser-stored: the profile lives in user meta keyed to
 * an authenticated user, so it only ever renders for the signed-in person
 * (satisfying "no PII leak on pre-fill" — there is no un-authenticated path that
 * can read someone else's data). Capture is optional with explicit consent; a
 * cleared consent erases the stored values. Reporting is aggregate only.
 */
final class Store {

    private const META    = 'oe_demographics';
    private const CONSENT = 'oe_demographics_consent';

    /** @return array<string,array{label:string,options:array<string,string>}> */
    public static function fields(): array {
        return [
            'gender' => [
                'label'   => __('Gender', 'october-events'),
                'options' => [
                    'female'      => __('Female', 'october-events'),
                    'male'        => __('Male', 'october-events'),
                    'nonbinary'   => __('Non-binary', 'october-events'),
                    'self'        => __('Prefer to self-describe', 'october-events'),
                    'undisclosed' => __('Prefer not to say', 'october-events'),
                ],
            ],
            'age_band' => [
                'label'   => __('Age', 'october-events'),
                'options' => [
                    'u25'   => '18–24',
                    '25_34' => '25–34',
                    '35_44' => '35–44',
                    '45_54' => '45–54',
                    '55_64' => '55–64',
                    '65p'   => '65+',
                    'na'    => __('Prefer not to say', 'october-events'),
                ],
            ],
            'industry' => [
                'label'   => __('Industry', 'october-events'),
                'options' => [
                    'architecture' => __('Architecture', 'october-events'),
                    'interiors'    => __('Interior design', 'october-events'),
                    'landscape'    => __('Landscape', 'october-events'),
                    'construction' => __('Construction / trades', 'october-events'),
                    'property'     => __('Property / development', 'october-events'),
                    'student'      => __('Student', 'october-events'),
                    'other'        => __('Other', 'october-events'),
                ],
            ],
        ];
    }

    public static function has_consent(int $user_id): bool {
        return (bool) get_user_meta($user_id, self::CONSENT, true);
    }

    /** @return array<string,string> field => value */
    public static function get(int $user_id): array {
        $raw = get_user_meta($user_id, self::META, true);
        return is_array($raw) ? $raw : [];
    }

    /**
     * Save with explicit consent. Without consent, any stored values are erased
     * (consent withdrawn), and nothing new is kept.
     *
     * @param array<string,string> $data
     */
    public static function save(int $user_id, array $data, bool $consent): void {
        if (! $consent) {
            delete_user_meta($user_id, self::META);
            delete_user_meta($user_id, self::CONSENT);
            return;
        }
        $clean  = [];
        foreach (self::fields() as $field => $spec) {
            $val = sanitize_key((string) ($data[$field] ?? ''));
            if ($val !== '' && isset($spec['options'][$val])) {
                $clean[$field] = $val;
            }
        }
        update_user_meta($user_id, self::META, $clean);
        update_user_meta($user_id, self::CONSENT, 1);
    }

    /**
     * Aggregate counts per field value across all consented profiles.
     *
     * @return array{profiles:int,fields:array<string,array<string,int>>}
     */
    public static function aggregate(): array {
        global $wpdb;
        $rows = $wpdb->get_col($wpdb->prepare(
            "SELECT meta_value FROM {$wpdb->usermeta} WHERE meta_key = %s",
            self::META
        )) ?: [];

        $out = ['profiles' => 0, 'fields' => []];
        foreach (self::fields() as $field => $spec) {
            $out['fields'][$field] = array_fill_keys(array_keys($spec['options']), 0);
        }
        foreach ($rows as $raw) {
            $data = maybe_unserialize($raw);
            if (! is_array($data)) {
                continue;
            }
            $out['profiles']++;
            foreach ($data as $field => $val) {
                if (isset($out['fields'][$field][$val])) {
                    $out['fields'][$field][$val]++;
                }
            }
        }
        return $out;
    }
}
