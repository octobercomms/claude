<?php
declare(strict_types=1);

namespace OE\Admin;

use OE\Settings as Config;
use OE\PostTypes;
use OE\Connectors\BrevoConnector;

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
        add_action('admin_post_oe_save_settings', [$this, 'save']);
        add_action('admin_post_oe_test_updater', [$this, 'test_updater']);
        add_action('admin_post_oe_test_voice', [$this, 'test_voice']);
    }

    /**
     * Live "test the voice" tool — run a pasted source article through the
     * trained editorial prompt and show the result so the voice can be tuned.
     */
    public function test_voice(): void {
        if (! current_user_can('manage_options')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        check_admin_referer('oe_test_voice');

        $source = trim((string) wp_unslash($_POST['oe_voice_sample'] ?? ''));
        if ($source === '') {
            set_transient('oe_voice_test', ['ok' => false, 'message' => __('Paste some source text to test.', 'october-events')], 120);
        } elseif (! \OE\Connectors\ClaudeConnector::is_ready()) {
            set_transient('oe_voice_test', ['ok' => false, 'message' => __('No Claude API key configured (OE_CLAUDE_API_KEY).', 'october-events')], 120);
        } else {
            $result = \OE\Connectors\ClaudeConnector::editorialize($source);
            if ($result === null) {
                set_transient('oe_voice_test', ['ok' => false, 'message' => __('Claude returned an error — check the debug log.', 'october-events')], 120);
            } elseif (! empty($result['skip'])) {
                set_transient('oe_voice_test', ['ok' => true, 'skip' => true, 'message' => __('The model judged this source as not relevant (SKIP).', 'october-events')], 120);
            } else {
                set_transient('oe_voice_test', ['ok' => true, 'headline' => $result['headline'], 'body' => $result['body']], 120);
            }
        }
        wp_safe_redirect(admin_url('admin.php?page=oe-settings#voice'));
        exit;
    }

    /**
     * Run the updater connection diagnosis and stash the result for display.
     */
    public function test_updater(): void {
        if (! current_user_can('manage_options')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        check_admin_referer('oe_test_updater');
        $updater = new \OE\Updater(OE_BASENAME, OE_VERSION, \OE\Updater::repo(), \OE\Updater::token());
        set_transient('oe_updater_diag', $updater->diagnose(), 60);
        wp_safe_redirect(admin_url('admin.php?page=oe-settings#updates'));
        exit;
    }

    public function render(): void {
        $cfg = Config::all();
        $secrets = [
            'stripe_secret_key'      => 'OE_STRIPE_SECRET_KEY',
            'stripe_publishable_key' => 'OE_STRIPE_PUBLISHABLE_KEY',
            'stripe_webhook_secret'  => 'OE_STRIPE_WEBHOOK_SECRET',
            'brevo_api_key'          => 'OE_BREVO_API_KEY',
            'claude_api_key'         => 'OE_CLAUDE_API_KEY',
            'google_maps_key'        => 'OE_GOOGLE_MAPS_KEY',
        ];
        require OE_DIR . 'admin/views/settings.php';
    }

    public function save(): void {
        if (! current_user_can('manage_options')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        check_admin_referer('oe_save_settings');

        $in = wp_unslash($_POST);

        // API keys: store any that aren't pinned by a wp-config.php constant.
        $secrets = [];
        foreach (array_keys(Config::secret_keys()) as $key) {
            if (Config::secret_is_constant($key)) {
                continue;
            }
            if (array_key_exists('secret_' . $key, $in)) {
                // ADF-05: encrypt at rest.
                $secrets[$key] = \OE\Crypto::encrypt(sanitize_text_field((string) $in['secret_' . $key]));
            }
        }
        if ($secrets) {
            Config::update($secrets);
        }

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

        $offsets = [];
        foreach (['week', '48h', 'morning'] as $key) {
            if (! empty($in['reminder_offsets'][$key])) {
                $offsets[] = $key;
            }
        }

        $req_candidates = ['name', 'start_datetime', 'end_datetime', 'price', 'location', 'description', 'organiser', 'image'];
        $event_required = array_values(array_intersect($req_candidates, array_map('sanitize_key', (array) ($in['event_required_fields'] ?? []))));

        Config::update([
            'brand_name'       => sanitize_text_field((string) ($in['brand_name'] ?? 'October Events')),
            'event_required_fields' => $event_required ?: ['name', 'start_datetime', 'price', 'location'],
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
            'github_token'     => \OE\Crypto::encrypt(trim((string) ($in['github_token'] ?? ''))),
        ]);

        wp_safe_redirect(add_query_arg('updated', '1', admin_url('admin.php?page=oe-settings')));
        exit;
    }
}
