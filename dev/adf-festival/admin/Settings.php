<?php
declare(strict_types=1);

namespace ADF\Admin;

use ADF\Settings as Config;
use ADF\PostTypes;
use ADF\Connectors\BrevoConnector;

defined('ABSPATH') || exit;

/**
 * Settings screen (§8 Settings).
 *
 * API keys are NOT editable here — they live in wp-config.php constants. This
 * screen surfaces their configured/missing state and edits the non-secret
 * configuration: tier pricing, rejection copy, AI source URLs, Brevo template /
 * list mappings and the digest toggle.
 */
final class Settings {

    private static ?Settings $instance = null;

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public function init(): void {
        add_action('admin_post_adf_save_settings', [$this, 'save']);
    }

    public function render(): void {
        $cfg = Config::all();
        $secrets = [
            'stripe_secret_key'      => 'ADF_STRIPE_SECRET_KEY',
            'stripe_publishable_key' => 'ADF_STRIPE_PUBLISHABLE_KEY',
            'stripe_webhook_secret'  => 'ADF_STRIPE_WEBHOOK_SECRET',
            'brevo_api_key'          => 'ADF_BREVO_API_KEY',
            'claude_api_key'         => 'ADF_CLAUDE_API_KEY',
            'google_maps_key'        => 'ADF_GOOGLE_MAPS_KEY',
        ];
        require ADF_DIR . 'admin/views/settings.php';
    }

    public function save(): void {
        if (! current_user_can('manage_options')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        check_admin_referer('adf_save_settings');

        $in = wp_unslash($_POST);

        // Pricing (dollars in the form -> cents stored).
        $pricing = [];
        foreach (PostTypes::listing_types() as $type) {
            foreach (['featured', 'premium'] as $tier) {
                $val = isset($in['pricing'][$type][$tier]) ? (float) $in['pricing'][$type][$tier] : 0;
                $pricing[$type][$tier] = (int) round($val * 100);
            }
        }

        $rejection = [];
        foreach ((array) ($in['rejection_copy'] ?? []) as $type => $copy) {
            $rejection[sanitize_key($type)] = sanitize_textarea_field((string) $copy);
        }

        $sources = array_filter(array_map('esc_url_raw', preg_split('/\r\n|\r|\n/', (string) ($in['ai_source_urls'] ?? ''))));

        $brevo_templates = [];
        foreach (BrevoConnector::TRIGGERS as $trigger) {
            $brevo_templates[$trigger] = (int) ($in['brevo_templates'][$trigger] ?? 0);
        }
        $brevo_lists = [];
        foreach ((array) ($in['brevo_lists'] ?? []) as $list => $id) {
            $brevo_lists[sanitize_key($list)] = (int) $id;
        }

        $offsets = [];
        foreach (['week', '48h', 'morning'] as $key) {
            if (! empty($in['reminder_offsets'][$key])) {
                $offsets[] = $key;
            }
        }

        Config::update([
            'pricing'          => $pricing,
            'currency'         => sanitize_text_field((string) ($in['currency'] ?? 'usd')),
            'rejection_copy'   => $rejection,
            'ai_source_urls'   => array_values($sources),
            'ai_model'         => sanitize_text_field((string) ($in['ai_model'] ?? 'claude-sonnet-4-20250514')),
            'brevo_templates'  => $brevo_templates,
            'brevo_lists'      => $brevo_lists,
            'digest_enabled'   => ! empty($in['digest_enabled']),
            'sms_enabled'      => ! empty($in['sms_enabled']),
            'sms_sender'       => sanitize_text_field((string) ($in['sms_sender'] ?? 'ADF')),
            'reminder_offsets' => $offsets,
        ]);

        wp_safe_redirect(add_query_arg('updated', '1', admin_url('admin.php?page=adf-settings')));
        exit;
    }
}
