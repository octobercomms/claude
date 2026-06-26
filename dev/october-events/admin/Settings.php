<?php
declare(strict_types=1);

namespace OE\Admin;

use OE\Settings as Config;
use OE\PostTypes;

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
        add_action('admin_post_oe_send_test_email', [$this, 'send_test_email']);
        // Allow brand font files (.woff2/.woff/.ttf/.otf) to be uploaded to the
        // media library (WordPress blocks these MIME types by default).
        add_filter('upload_mimes', [$this, 'allow_font_mimes']);
        add_filter('wp_check_filetype_and_ext', [$this, 'fix_font_filetype'], 10, 4);
    }

    /** @param array<string,string> $mimes */
    public function allow_font_mimes(array $mimes): array {
        if (current_user_can('manage_options')) {
            $mimes['woff']  = 'font/woff';
            $mimes['woff2'] = 'font/woff2';
            $mimes['ttf']   = 'font/ttf';
            $mimes['otf']   = 'font/otf';
        }
        return $mimes;
    }

    /**
     * @param array<string,mixed> $data
     * @param array<string,string> $mimes
     * @return array<string,mixed>
     */
    public function fix_font_filetype($data, $file, $filename, $mimes) {
        if (empty($data['type'])) {
            $check = wp_check_filetype($filename, ['woff' => 'font/woff', 'woff2' => 'font/woff2', 'ttf' => 'font/ttf', 'otf' => 'font/otf']);
            if (! empty($check['ext'])) {
                $data['ext']  = $check['ext'];
                $data['type'] = $check['type'];
            }
        }
        return $data;
    }

    /** Send a test email through the current transport (SES or site default). */
    public function send_test_email(): void {
        if (! current_user_can('manage_options')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        check_admin_referer('oe_send_test_email');
        $to = sanitize_email((string) wp_unslash($_POST['oe_test_to'] ?? ''));
        $to = $to ?: (string) get_option('admin_email');
        $ok = \OE\Mail\Mailer::send_test($to);
        set_transient('oe_mail_test', [
            'ok' => $ok,
            'to' => $to,
        ], 120);
        wp_safe_redirect(admin_url('admin.php?page=oe-settings#email-tools'));
        exit;
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
            'paypal_client_secret'   => 'OE_PAYPAL_SECRET',
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

        $offsets = [];
        foreach (['week', '48h', 'morning'] as $key) {
            if (! empty($in['reminder_offsets'][$key])) {
                $offsets[] = $key;
            }
        }

        $req_candidates = ['name', 'start_datetime', 'end_datetime', 'price', 'location', 'description', 'organiser', 'image'];
        $event_required = array_values(array_intersect($req_candidates, array_map('sanitize_key', (array) ($in['event_required_fields'] ?? []))));

        // Map of planning field => existing meta key to read as a fallback.
        $event_field_map = [];
        foreach ((array) ($in['event_field_map'] ?? []) as $field => $src) {
            $field = sanitize_key((string) $field);
            $src   = sanitize_text_field((string) $src);
            if ($field !== '' && $src !== '') {
                $event_field_map[$field] = $src;
            }
        }

        Config::update([
            'brand_name'       => sanitize_text_field((string) ($in['brand_name'] ?? 'October Events')),
            'event_required_fields' => $event_required ?: ['name', 'start_datetime', 'price', 'location'],
            'event_field_map'  => $event_field_map,
            'pricing'          => $pricing,
            'currency'         => sanitize_text_field((string) ($in['currency'] ?? 'usd')),
            'rejection_copy'   => $rejection,
            'ai_source_urls'   => array_values($sources),
            'ai_model'         => sanitize_text_field((string) ($in['ai_model'] ?? 'claude-sonnet-4-20250514')),
            'ai_voice_guide'   => sanitize_textarea_field((string) ($in['ai_voice_guide'] ?? '')),
            'ai_examples'      => array_map('sanitize_textarea_field', array_values($examples)),
            'digest_enabled'   => ! empty($in['digest_enabled']),
            'report_email'     => sanitize_email((string) ($in['report_email'] ?? '')),
            'sms_enabled'      => ! empty($in['sms_enabled']),
            // Legacy sender name (no longer shown in the UI) — preserve what's stored.
            'sms_sender'       => sanitize_text_field((string) ($in['sms_sender'] ?? (Config::all()['sms_sender'] ?? 'ADF'))),
            'reminder_offsets' => $offsets,
            'github_repo'      => sanitize_text_field((string) ($in['github_repo'] ?? 'octobercomms/claude')),
            'github_token'     => \OE\Crypto::encrypt(trim((string) ($in['github_token'] ?? ''))),
            'platform_origins' => self::parse_origins((string) ($in['platform_origins'] ?? '')),
            'theme_accent'      => self::clean_color((string) ($in['theme_accent'] ?? '')),
            'theme_accent_on'   => self::clean_color((string) ($in['theme_accent_on'] ?? '')),
            'theme_sidebar_bg'  => self::clean_color((string) ($in['theme_sidebar_bg'] ?? '')),
            'theme_page_bg'     => self::clean_color((string) ($in['theme_page_bg'] ?? '')),
            'theme_logo_light'  => esc_url_raw(trim((string) ($in['theme_logo_light'] ?? ''))),
            'theme_logo_dark'   => esc_url_raw(trim((string) ($in['theme_logo_dark'] ?? ''))),
            'theme_font_family' => sanitize_text_field((string) ($in['theme_font_family'] ?? '')),
            'theme_font_css'    => esc_url_raw(trim((string) ($in['theme_font_css'] ?? ''))),
            'theme_font_url'    => esc_url_raw(trim((string) ($in['theme_font_url'] ?? ''))),
            'theme_font_url_bold' => esc_url_raw(trim((string) ($in['theme_font_url_bold'] ?? ''))),
            'ses_enabled'       => ! empty($in['ses_enabled']),
            'ses_region'        => sanitize_text_field((string) ($in['ses_region'] ?? 'us-east-1')),
            'ses_smtp_user'     => sanitize_text_field((string) ($in['ses_smtp_user'] ?? '')),
            'ses_smtp_password' => \OE\Crypto::encrypt(trim((string) ($in['ses_smtp_password'] ?? ''))),
            'mail_from_email'   => sanitize_email((string) ($in['mail_from_email'] ?? '')),
            'mail_from_name'    => sanitize_text_field((string) ($in['mail_from_name'] ?? '')),
            'mail_footer_address' => sanitize_textarea_field((string) ($in['mail_footer_address'] ?? '')),
            // SMS (AWS End User Messaging).
            'aws_access_key_id'     => sanitize_text_field((string) ($in['aws_access_key_id'] ?? '')),
            'aws_secret_access_key' => \OE\Crypto::encrypt(trim((string) ($in['aws_secret_access_key'] ?? ''))),
            'sms_region'            => sanitize_text_field((string) ($in['sms_region'] ?? 'us-east-1')),
            'sms_origination'       => sanitize_text_field((string) ($in['sms_origination'] ?? '')),
            // Platform + check-in links surfaced in wp-admin.
            'platform_url'      => esc_url_raw(trim((string) ($in['platform_url'] ?? ''))),
            'checkin_page_url'  => esc_url_raw(trim((string) ($in['checkin_page_url'] ?? ''))),
            'checkout_terms_url' => esc_url_raw(trim((string) ($in['checkout_terms_url'] ?? ''))),
            // PayPal gateway (secret handled in the secrets loop above).
            'paypal_enabled'   => empty($in['paypal_enabled']) ? '0' : '1',
            'paypal_env'       => (($in['paypal_env'] ?? 'sandbox') === 'live') ? 'live' : 'sandbox',
            'paypal_client_id' => sanitize_text_field((string) ($in['paypal_client_id'] ?? '')),
            // Pre-event reminder to ticket-holders.
            'attendee_reminder_enabled' => empty($in['attendee_reminder_enabled']) ? '0' : '1',
            'attendee_reminder_hours'   => max(1, min(168, (int) ($in['attendee_reminder_hours'] ?? 24))),
            // Public AI support chat.
            'support_chat_enabled'  => empty($in['support_chat_enabled']) ? '0' : '1',
            // Live chat (Chatwoot).
            'chatwoot_base_url'     => esc_url_raw(trim((string) ($in['chatwoot_base_url'] ?? ''))),
            'chatwoot_token'        => sanitize_text_field((string) ($in['chatwoot_token'] ?? '')),
        ]);

        wp_safe_redirect(add_query_arg('updated', '1', admin_url('admin.php?page=oe-settings')));
        exit;
    }

    /**
     * Parse the platform-origins textarea (one per line) into a clean list of
     * scheme+host origins (no trailing slash, no path).
     *
     * @return array<int,string>
     */
    /** Accept a #rrggbb hex colour, or '' to fall back to the platform default. */
    private static function clean_color(string $raw): string {
        $raw = trim($raw);
        if ($raw === '') {
            return '';
        }
        $hex = sanitize_hex_color($raw);
        return is_string($hex) ? $hex : '';
    }

    private static function parse_origins(string $raw): array {
        $out = [];
        foreach (preg_split('/[\r\n,]+/', $raw) ?: [] as $line) {
            $line = trim($line);
            if ($line === '') {
                continue;
            }
            $parts = wp_parse_url($line);
            if (empty($parts['scheme']) || empty($parts['host'])) {
                continue;
            }
            $origin = $parts['scheme'] . '://' . $parts['host'];
            if (! empty($parts['port'])) {
                $origin .= ':' . $parts['port'];
            }
            $out[] = $origin;
        }
        return array_values(array_unique($out));
    }
}
