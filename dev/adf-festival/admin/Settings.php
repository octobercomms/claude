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
        add_action('admin_post_adf_test_updater', [$this, 'test_updater']);
        add_action('admin_post_adf_test_voice', [$this, 'test_voice']);
    }

    /**
     * Live "test the voice" tool — run a pasted source article through the
     * trained editorial prompt and show the result so the voice can be tuned.
     */
    public function test_voice(): void {
        if (! current_user_can('manage_options')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        check_admin_referer('adf_test_voice');

        $source = trim((string) wp_unslash($_POST['adf_voice_sample'] ?? ''));
        if ($source === '') {
            set_transient('adf_voice_test', ['ok' => false, 'message' => __('Paste some source text to test.', 'adf-festival')], 120);
        } elseif (! \ADF\Connectors\ClaudeConnector::is_ready()) {
            set_transient('adf_voice_test', ['ok' => false, 'message' => __('No Claude API key configured (ADF_CLAUDE_API_KEY).', 'adf-festival')], 120);
        } else {
            $result = \ADF\Connectors\ClaudeConnector::editorialize($source);
            if ($result === null) {
                set_transient('adf_voice_test', ['ok' => false, 'message' => __('Claude returned an error — check the debug log.', 'adf-festival')], 120);
            } elseif (! empty($result['skip'])) {
                set_transient('adf_voice_test', ['ok' => true, 'skip' => true, 'message' => __('The model judged this source as not relevant (SKIP).', 'adf-festival')], 120);
            } else {
                set_transient('adf_voice_test', ['ok' => true, 'headline' => $result['headline'], 'body' => $result['body']], 120);
            }
        }
        wp_safe_redirect(admin_url('admin.php?page=adf-settings#voice'));
        exit;
    }

    /**
     * Run the updater connection diagnosis and stash the result for display.
     */
    public function test_updater(): void {
        if (! current_user_can('manage_options')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        check_admin_referer('adf_test_updater');
        $updater = new \ADF\Updater(ADF_BASENAME, ADF_VERSION, \ADF\Updater::repo(), \ADF\Updater::token());
        set_transient('adf_updater_diag', $updater->diagnose(), 60);
        wp_safe_redirect(admin_url('admin.php?page=adf-settings#updates'));
        exit;
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

        // Voice examples: one per block, separated by a line of "---".
        $examples = array_filter(array_map('trim', preg_split('/^\s*---\s*$/m', (string) ($in['ai_examples'] ?? ''))));

        $brevo_templates = [];
        foreach (BrevoConnector::TRIGGERS as $trigger) {
            $brevo_templates[$trigger] = (int) ($in['brevo_templates'][$trigger] ?? 0);
        }
        $brevo_lists = [];
        foreach ((array) ($in['brevo_lists'] ?? []) as $list => $id) {
            $brevo_lists[sanitize_key($list)] = (int) $id;
        }

        // Ad packages: "Name | impressions|clicks | quantity | price" per line.
        $ad_packages = [];
        foreach (preg_split('/\r\n|\r|\n/', (string) ($in['ad_packages'] ?? '')) as $line) {
            $p = array_map('trim', explode('|', $line));
            if (count($p) < 4 || $p[0] === '') {
                continue;
            }
            $ad_packages[] = [
                'name'     => sanitize_text_field($p[0]),
                'type'     => in_array($p[1], ['impressions', 'clicks'], true) ? $p[1] : 'impressions',
                'quantity' => (int) $p[2],
                'price'    => round((float) $p[3], 2),
            ];
        }
        // Ad promo codes: "CODE | pct" per line.
        $ad_promos = [];
        foreach (preg_split('/\r\n|\r|\n/', (string) ($in['ad_promo_codes'] ?? '')) as $line) {
            $p = array_map('trim', explode('|', $line));
            if (count($p) < 2 || $p[0] === '') {
                continue;
            }
            $ad_promos[strtoupper(sanitize_text_field($p[0]))] = max(0, min(100, (int) $p[1]));
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
            'ai_voice_guide'   => sanitize_textarea_field((string) ($in['ai_voice_guide'] ?? '')),
            'ai_examples'      => array_map('sanitize_textarea_field', array_values($examples)),
            'brevo_templates'  => $brevo_templates,
            'brevo_lists'      => $brevo_lists,
            'digest_enabled'   => ! empty($in['digest_enabled']),
            'report_email'     => sanitize_email((string) ($in['report_email'] ?? '')),
            'sms_enabled'      => ! empty($in['sms_enabled']),
            'sms_sender'       => sanitize_text_field((string) ($in['sms_sender'] ?? 'ADF')),
            'reminder_offsets' => $offsets,
            'github_repo'      => sanitize_text_field((string) ($in['github_repo'] ?? 'octobercomms/claude')),
            'github_token'     => trim((string) ($in['github_token'] ?? '')),
            'ad_packages'      => $ad_packages,
            'ad_promo_codes'   => $ad_promos,
        ]);

        wp_safe_redirect(add_query_arg('updated', '1', admin_url('admin.php?page=adf-settings')));
        exit;
    }
}
