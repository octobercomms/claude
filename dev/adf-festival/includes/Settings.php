<?php
declare(strict_types=1);

namespace ADF;

defined('ABSPATH') || exit;

/**
 * Typed access to plugin settings.
 *
 * API keys are read from wp-config.php constants first (never persisted to the
 * database, per §4/§5/§10), falling back to the options row for non-secret
 * configuration such as tier pricing, the rejection-email copy, AI source URLs
 * and the digest schedule.
 *
 * All option data lives under a single `adf_settings` row to keep wp_options
 * tidy; everything is `adf_`-prefixed as required by §10.
 */
final class Settings {

    public const OPTION = 'adf_settings';

    /** Map of logical key => wp-config.php constant for secrets. */
    private const SECRET_CONSTANTS = [
        'stripe_secret_key'      => 'ADF_STRIPE_SECRET_KEY',
        'stripe_publishable_key' => 'ADF_STRIPE_PUBLISHABLE_KEY',
        'stripe_webhook_secret'  => 'ADF_STRIPE_WEBHOOK_SECRET',
        'brevo_api_key'          => 'ADF_BREVO_API_KEY',
        'claude_api_key'         => 'ADF_CLAUDE_API_KEY',
        'google_maps_key'        => 'ADF_GOOGLE_MAPS_KEY',
    ];

    public static function defaults(): array {
        return [
            // Per-listing-type, per-tier pricing in cents. Admin-editable (§4).
            'pricing' => [
                'directory'   => ['featured' => 9900,  'premium' => 19900],
                'destination' => ['featured' => 9900,  'premium' => 19900],
                'product'     => ['featured' => 7900,  'premium' => 14900],
                'event'       => ['featured' => 4900,  'premium' => 9900],
                'story'       => ['featured' => 0,     'premium' => 0],
                'ad'          => ['featured' => 29900, 'premium' => 49900],
            ],
            'currency'        => 'usd',
            // Rejection email copy per listing type (§3.3). Empty => default.
            'rejection_copy'  => [],
            // AI Stories connector source URLs (RSS preferred) (§6).
            'ai_source_urls'  => [],
            'ai_model'        => 'claude-sonnet-4-20250514',
            // Editable "tone of voice" training for the AI Stories layer.
            'ai_voice_guide'  => '',
            'ai_examples'     => [],
            // Brevo transactional template IDs keyed by trigger name (§5).
            'brevo_templates' => [],
            'brevo_lists'     => [],
            // Digest: first Monday each month (§5).
            'digest_enabled'  => true,
            // Daily ticket sales report recipient (blank = site admin email).
            'report_email'    => '',
            // Volunteer reminders (email always; SMS via Brevo when enabled).
            'sms_enabled'      => false,
            'sms_sender'       => 'ADF',
            'reminder_offsets' => ['week', '48h', 'morning'],
            // GitHub self-updater (token may also be a wp-config constant).
            'github_repo'      => 'octobercomms/claude',
            'github_token'     => '',
            // Ad booking packages + promo codes.
            'ad_packages'      => [],
            'ad_promo_codes'   => [],
            // Ad syndication (hub/partner).
            'ad_site_mode'     => 'hub',
            'ad_api_key'       => '',
            'ad_hub_url'       => '',
            'ad_hub_api_key'   => '',
            'ad_known_partners' => [],
        ];
    }

    /**
     * Read a secret (wp-config.php constant first for security, then the value
     * entered in admin settings), or a non-secret config value.
     */
    public static function get(string $key, $default = null) {
        if (isset(self::SECRET_CONSTANTS[$key])) {
            $const = self::SECRET_CONSTANTS[$key];
            if (defined($const) && (string) constant($const) !== '') {
                return constant($const);
            }
            $all = wp_parse_args(get_option(self::OPTION, []), self::defaults());
            // Secrets are stored encrypted at rest (ADF-05); decrypt transparently.
            return Crypto::decrypt((string) ($all[$key] ?? ($default ?? '')));
        }
        $all = wp_parse_args(get_option(self::OPTION, []), self::defaults());
        return $all[$key] ?? $default;
    }

    /**
     * True when a secret is pinned by a wp-config.php constant (so the admin
     * field should be locked).
     */
    public static function secret_is_constant(string $key): bool {
        $const = self::SECRET_CONSTANTS[$key] ?? '';
        return $const !== '' && defined($const) && (string) constant($const) !== '';
    }

    /** Map of secret key => constant name (for the settings UI). */
    public static function secret_keys(): array {
        return self::SECRET_CONSTANTS;
    }

    public static function all(): array {
        return wp_parse_args(get_option(self::OPTION, []), self::defaults());
    }

    public static function update(array $values): void {
        $current = self::all();
        update_option(self::OPTION, array_merge($current, $values));
    }

    /**
     * Price in the smallest currency unit for a type/tier, 0 if free/unknown.
     */
    public static function price(string $type, string $tier): int {
        if ($tier === Fields::TIER_FREE) {
            return 0;
        }
        $pricing = self::get('pricing', []);
        return (int) ($pricing[$type][$tier] ?? 0);
    }

    public static function has_secret(string $key): bool {
        return (string) self::get($key, '') !== '';
    }
}
