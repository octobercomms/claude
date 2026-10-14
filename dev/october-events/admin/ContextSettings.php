<?php
declare(strict_types=1);

namespace OE\Admin;

use OE\Settings;

defined('ABSPATH') || exit;

/**
 * Settings-in-context (BUILD-PLAN M5).
 *
 * A collapsible "Settings for this page" panel at the top of each module screen,
 * showing just the handful of settings that screen is about, editable in place.
 * The full Settings page stays the home for everything (and the only place for
 * the complex settings — pricing, tiers, access maps).
 *
 * Saving is merge-safe and typed: the panel posts only its own registered
 * fields to a dedicated handler that sanitises each by declared type and merges
 * via Settings::update() (never the wholesale main-settings save, which reads
 * every checkbox by presence and would blank an omitted one). Only simple-typed
 * settings are exposed here for that reason.
 */
final class ContextSettings {

    /**
     * section key (matches Admin::bento keys) => panel definition.
     * Each field: key, label, type (text|url|bool|select|textarea), options?, hint?.
     */
    private const REGISTRY = [
        'tickets' => [
            'heading' => 'Ticketing settings',
            'fields'  => [
                ['type' => 'heading', 'label' => 'Pricing & fees'],
                ['key' => 'currency', 'label' => 'Currency', 'type' => 'select', 'options' => ['usd' => 'USD ($)', 'gbp' => 'GBP (£)', 'eur' => 'EUR (€)']],
                ['key' => 'card_fee_percent', 'label' => 'Card fee %', 'type' => 'number', 'hint' => 'Used for the “after fees” figure in reports. Default 2.9.'],
                ['key' => 'card_fee_fixed', 'label' => '+ fixed fee per transaction', 'type' => 'number', 'hint' => 'Default 0.30.'],
                ['key' => 'bnpl_enabled', 'label' => 'Offer Buy-now-pay-later / wallet checkout', 'type' => 'bool'],

                ['type' => 'heading', 'label' => 'Checkout'],
                ['key' => 'checkout_terms_url', 'label' => 'Terms & conditions URL', 'type' => 'url', 'hint' => 'When set, checkout shows a required “I agree” checkbox linking here.'],
                ['key' => 'waitlist_offer_window', 'label' => 'Waitlist offer window (hours)', 'type' => 'number', 'hint' => 'How long each waitlist offer is held before the next person is notified. 0 = notify everyone at once.'],
                ['key' => 'paypal_enabled', 'label' => 'Offer PayPal at checkout', 'type' => 'bool01'],
                ['key' => 'paypal_env', 'label' => 'PayPal environment', 'type' => 'select', 'options' => ['sandbox' => 'Sandbox (testing)', 'live' => 'Live']],
                ['key' => 'paypal_client_id', 'label' => 'PayPal client ID', 'type' => 'text', 'hint' => 'The secret lives under Settings → Keys.'],

                ['type' => 'heading', 'label' => 'Pre-event reminder'],
                ['key' => 'attendee_reminder_enabled', 'label' => 'Email ticket-holders a reminder before the event', 'type' => 'bool01'],
                ['key' => 'attendee_reminder_hours', 'label' => 'Hours before the start time', 'type' => 'number', 'hint' => 'Default 24.'],

                ['type' => 'heading', 'label' => 'Invoicing'],
                ['key' => 'invoice_business_name', 'label' => 'Business name', 'type' => 'text', 'hint' => 'Falls back to the brand name.'],
                ['key' => 'invoice_business_email', 'label' => 'Billing email', 'type' => 'text'],
                ['key' => 'invoice_business_phone', 'label' => 'Phone', 'type' => 'text'],
                ['key' => 'invoice_business_address', 'label' => 'Business address', 'type' => 'textarea'],
                ['key' => 'invoice_tax_label', 'label' => 'Tax label', 'type' => 'text', 'hint' => 'e.g. VAT, Sales tax.'],
                ['key' => 'invoice_tax_number', 'label' => 'Tax / VAT number', 'type' => 'text'],
                ['key' => 'invoice_tax_rate', 'label' => 'Tax rate %', 'type' => 'number', 'hint' => 'Blank or 0 = no tax breakdown on invoices.'],
                ['key' => 'invoice_prefix', 'label' => 'Invoice number prefix', 'type' => 'text', 'hint' => 'Default INV.'],
                ['key' => 'paper_size', 'label' => 'Print paper size', 'type' => 'select', 'options' => ['letter' => 'US Letter', 'a4' => 'A4']],
                ['key' => 'invoice_notes', 'label' => 'Footer notes', 'type' => 'textarea', 'hint' => 'Payment terms shown on every invoice.'],

                ['type' => 'heading', 'label' => 'Timed tickets'],
                ['key' => 'guided_enabled', 'label' => 'Offer timed tickets (scheduled, limited-capacity slots)', 'type' => 'bool'],
                ['key' => 'guided_require_names', 'label' => 'Require every attendee’s name at booking', 'type' => 'bool'],
                ['key' => 'guided_names_note', 'label' => 'Note shown on the booking page', 'type' => 'textarea', 'hint' => 'Blank uses the built-in wording.'],
            ],
        ],
        'volunteers' => [
            'heading' => 'Volunteer settings',
            'fields'  => [
                ['type' => 'heading', 'label' => 'Signups & thank-you'],
                ['key' => 'volunteer_faq_url', 'label' => 'Volunteer FAQ link', 'type' => 'url', 'hint' => 'Linked in the footer of every volunteer email.'],
                ['key' => 'volunteer_code_reward_label', 'label' => 'Thank-you reward label', 'type' => 'text', 'hint' => 'e.g. “2 free tickets”.'],
                ['key' => 'volunteer_code_enabled', 'label' => 'Send volunteers a free-ticket code in the 48-hour reminder', 'type' => 'bool'],
                ['key' => 'volunteer_code_verify_enabled', 'label' => 'Only accept the code from a current volunteer', 'type' => 'bool'],

                ['type' => 'heading', 'label' => 'Staff alerts'],
                ['key' => 'volunteer_signup_alert_emails', 'label' => 'Notify these people on a new signup', 'type' => 'emails', 'hint' => 'One or more email addresses, comma-separated.'],
                ['key' => 'volunteer_cancel_alert_emails', 'label' => 'Notify these people on a cancellation', 'type' => 'emails'],

                ['type' => 'heading', 'label' => 'Daily roster email'],
                ['key' => 'volunteer_digest_enabled', 'label' => 'Send the daily roster email', 'type' => 'bool'],
                ['key' => 'volunteer_digest_hour', 'label' => 'Send at (hour, site time, 0–23)', 'type' => 'number', 'hint' => 'Default 6.'],
                ['key' => 'volunteer_digest_emails', 'label' => 'Send the roster to', 'type' => 'emails'],
            ],
        ],
        'contacts' => [
            'heading' => 'Signup settings',
            'fields'  => [
                ['key' => 'double_optin', 'label' => 'Require email confirmation on the public signup form (double opt-in)', 'type' => 'bool'],
            ],
        ],
        'team' => [
            'heading' => 'Planning-team settings',
            'fields'  => [
                ['key' => 'crew_renewal_enabled', 'label' => 'Send automatic renewal reminders before a term ends', 'type' => 'bool', 'hint' => 'When off, you can still send a renewal prompt by hand from the Team screen.'],
                ['key' => 'crew_renewal_days_first', 'label' => 'First reminder (days before term end)', 'type' => 'text', 'hint' => 'Default 60.'],
                ['key' => 'crew_renewal_days_second', 'label' => 'Second reminder (days before term end)', 'type' => 'text', 'hint' => 'Default 30.'],
            ],
        ],
        'email' => [
            'heading' => 'Email, SMS & chat settings',
            'fields'  => [
                ['type' => 'heading', 'label' => 'Sender'],
                ['key' => 'mail_from_name', 'label' => 'From name', 'type' => 'text', 'hint' => 'Shown as the sender on every email you send.'],
                ['key' => 'mail_from_email', 'label' => 'From email', 'type' => 'text', 'hint' => 'Use an address on a domain you have authenticated for sending.'],
                ['key' => 'mail_footer_address', 'label' => 'Footer postal address', 'type' => 'textarea', 'hint' => 'Shown in the footer of bulk emails; a postal address is required by anti-spam law.'],

                ['type' => 'heading', 'label' => 'Amazon SES'],
                ['key' => 'ses_enabled', 'label' => 'Route email through Amazon SES', 'type' => 'bool'],
                ['key' => 'ses_region', 'label' => 'AWS region', 'type' => 'text', 'hint' => 'e.g. us-east-1.'],
                ['key' => 'ses_smtp_user', 'label' => 'SMTP username', 'type' => 'text', 'hint' => 'The SMTP password lives under Settings → Email & SMS (it is stored encrypted).'],

                ['type' => 'heading', 'label' => 'Brevo (email)'],
                ['key' => 'brevo_email_enabled', 'label' => 'Route email through Brevo SMTP', 'type' => 'bool', 'hint' => 'SES wins if both are on.'],
                ['key' => 'brevo_smtp_login', 'label' => 'Brevo SMTP login', 'type' => 'text', 'hint' => 'The SMTP key lives under Settings → Email & SMS.'],

                ['type' => 'heading', 'label' => 'Reports & digest'],
                ['key' => 'digest_enabled', 'label' => 'Send the monthly digest automatically', 'type' => 'bool'],
                ['key' => 'report_email', 'label' => 'Email the daily sales report to', 'type' => 'text', 'hint' => 'Blank sends it to the site admin.'],

                ['type' => 'heading', 'label' => 'SMS'],
                ['key' => 'sms_enabled', 'label' => 'Send reminders by SMS', 'type' => 'bool'],
                ['key' => 'sms_provider', 'label' => 'Provider', 'type' => 'select', 'options' => ['aws' => 'AWS End User Messaging', 'brevo' => 'Brevo transactional SMS', 'quo' => 'Quo (OpenPhone)']],
                ['key' => 'sms_region', 'label' => 'AWS region', 'type' => 'text'],
                ['key' => 'aws_access_key_id', 'label' => 'AWS access key ID', 'type' => 'text', 'hint' => 'The secret access key lives under Settings → Email & SMS.'],
                ['key' => 'sms_origination', 'label' => 'Origination identity', 'type' => 'text', 'hint' => 'Phone number (E.164), sender ID or pool ARN.'],
                ['key' => 'brevo_sms_sender', 'label' => 'Brevo SMS sender', 'type' => 'text'],
                ['key' => 'quo_from_number', 'label' => 'Quo “from” number', 'type' => 'text'],

                ['type' => 'heading', 'label' => 'Marketing signup'],
                ['key' => 'double_optin', 'label' => 'Require email confirmation on the public signup form (double opt-in)', 'type' => 'bool'],

                ['type' => 'heading', 'label' => 'Live chat'],
                ['key' => 'support_chat_enabled', 'label' => 'Show the support chat widget on the front end', 'type' => 'bool01'],
                ['key' => 'chatwoot_base_url', 'label' => 'Chatwoot base URL', 'type' => 'url'],
                ['key' => 'chatwoot_token', 'label' => 'Chatwoot website token', 'type' => 'text'],
            ],
        ],
    ];

    private const NONCE = 'oe_ctx_settings';

    public static function init(): void {
        add_action('admin_post_oe_ctx_settings', [self::class, 'handle']);
    }

    /** Render the panel for a module screen, or nothing when none is registered. */
    public static function panel(string $key): void {
        $def = self::REGISTRY[$key] ?? null;
        if (! $def || ! current_user_can('manage_options')) {
            return;
        }
        $saved = isset($_GET['oe_ctx_saved']) && $_GET['oe_ctx_saved'] === $key;

        echo '<details class="oe-acc oe-ctx-settings"' . ($saved ? ' open' : '') . ' style="margin:0 0 16px">';
        echo '<summary style="cursor:pointer;font-weight:600">' . esc_html__('Settings for this page', 'october-events') . '</summary>';
        echo '<div class="oe-acc-body">';
        if ($saved) {
            echo '<div class="notice notice-success inline" style="margin:0 0 10px"><p>' . esc_html__('Saved.', 'october-events') . '</p></div>';
        }
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" style="display:grid;gap:12px;max-width:560px">';
        echo '<input type="hidden" name="action" value="oe_ctx_settings">';
        echo '<input type="hidden" name="ctx" value="' . esc_attr($key) . '">';
        echo '<input type="hidden" name="return" value="' . esc_attr((string) self::current_url()) . '">';
        wp_nonce_field(self::NONCE, self::NONCE);

        foreach ($def['fields'] as $f) {
            self::field($f);
        }

        echo '<p style="margin:0"><button type="submit" class="button button-primary">' . esc_html__('Save these settings', 'october-events') . '</button> ';
        echo '<a href="' . esc_url(admin_url('admin.php?page=oe-settings')) . '" class="button-link" style="margin-left:8px">' . esc_html__('All settings', 'october-events') . '</a></p>';
        echo '</form></div></details>';
    }

    /** @param array<string,mixed> $f */
    private static function field(array $f): void {
        $type = (string) $f['type'];

        // A group divider — no stored key, just a sub-heading inside the panel.
        if ($type === 'heading') {
            echo '<p style="margin:14px 0 0;font-weight:700;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#555;border-top:1px solid #e3e2db;padding-top:12px">'
                . esc_html((string) $f['label']) . '</p>';
            return;
        }

        $key  = (string) $f['key'];
        $val  = Settings::get($key, '');
        $label = esc_html((string) $f['label']);
        $hint  = isset($f['hint']) ? '<span style="display:block;color:#777;font-size:.85em;margin-top:2px">' . esc_html((string) $f['hint']) . '</span>' : '';

        if ($type === 'bool' || $type === 'bool01') {
            $on = $type === 'bool01' ? ((string) $val === '1') : (bool) $val;
            printf(
                '<p style="margin:0"><label><input type="checkbox" name="%s" value="1"%s> %s</label>%s</p>',
                esc_attr($key),
                checked($on, true, false),
                $label,
                $hint
            );
            return;
        }
        if ($type === 'emails' || $type === 'textarea') {
            echo '<p style="margin:0"><label style="font-weight:600;display:block;margin-bottom:4px">' . $label . '</label>';
            printf('<textarea name="%s" style="width:100%%;min-height:%s">%s</textarea>', esc_attr($key), $type === 'emails' ? '48px' : '70px', esc_textarea((string) $val));
            echo $hint . '</p>';
            return;
        }
        if ($type === 'select') {
            $opts = (array) ($f['options'] ?? []);
            echo '<p style="margin:0"><label style="font-weight:600;display:block;margin-bottom:4px">' . $label . '</label>';
            echo '<select name="' . esc_attr($key) . '">';
            foreach ($opts as $ov => $ol) {
                printf('<option value="%s"%s>%s</option>', esc_attr((string) $ov), selected((string) $val, (string) $ov, false), esc_html((string) $ol));
            }
            echo '</select>' . $hint . '</p>';
            return;
        }
        // text / url / number
        $input_type = $type === 'url' ? 'url' : ($type === 'number' ? 'number' : 'text');
        $extra = $type === 'number' ? ' step="any"' : '';
        printf(
            '<p style="margin:0"><label style="font-weight:600;display:block;margin-bottom:4px">%s</label><input type="%s"%s name="%s" value="%s" style="width:100%%">%s</p>',
            $label,
            $input_type,
            $extra,
            esc_attr($key),
            esc_attr((string) $val),
            $hint
        );
    }

    public static function handle(): void {
        if (! current_user_can('manage_options')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        $nonce = isset($_POST[self::NONCE]) ? sanitize_text_field(wp_unslash((string) $_POST[self::NONCE])) : '';
        if ($nonce === '' || ! wp_verify_nonce($nonce, self::NONCE)) {
            wp_die('Expired', '', ['response' => 403]);
        }
        $ctx = sanitize_key((string) wp_unslash($_POST['ctx'] ?? ''));
        $def = self::REGISTRY[$ctx] ?? null;
        $return = self::safe_return((string) wp_unslash($_POST['return'] ?? ''));
        if (! $def) {
            wp_safe_redirect($return);
            exit;
        }

        $clean = [];
        foreach ($def['fields'] as $f) {
            $type = (string) $f['type'];
            if ($type === 'heading') {
                continue; // a divider, nothing to save
            }
            $key  = (string) $f['key'];
            switch ($type) {
                case 'bool':
                    $clean[$key] = ! empty($_POST[$key]); // presence, scoped to this form's known fields
                    break;
                case 'bool01':
                    // Keys read with a strict === '1' comparison (e.g. support_chat_enabled).
                    $clean[$key] = ! empty($_POST[$key]) ? '1' : '0';
                    break;
                case 'url':
                    $clean[$key] = esc_url_raw(trim((string) wp_unslash($_POST[$key] ?? '')));
                    break;
                case 'select':
                    $v = sanitize_text_field((string) wp_unslash($_POST[$key] ?? ''));
                    $opts = array_map('strval', array_keys((array) ($f['options'] ?? [])));
                    $clean[$key] = in_array($v, $opts, true) ? $v : (string) Settings::get($key, '');
                    break;
                case 'textarea':
                    $clean[$key] = sanitize_textarea_field((string) wp_unslash($_POST[$key] ?? ''));
                    break;
                case 'emails':
                    $clean[$key] = self::clean_emails((string) wp_unslash($_POST[$key] ?? ''));
                    break;
                case 'number':
                    $raw = sanitize_text_field((string) wp_unslash($_POST[$key] ?? ''));
                    $clean[$key] = $raw === '' ? '' : (string) ($raw + 0); // keep as numeric string
                    break;
                default:
                    $clean[$key] = sanitize_text_field((string) wp_unslash($_POST[$key] ?? ''));
            }
        }
        Settings::update($clean); // merge-safe: only these keys change

        wp_safe_redirect(add_query_arg('oe_ctx_saved', $ctx, $return));
        exit;
    }

    /** Normalise a free-text list of addresses to a clean, comma-separated string. */
    private static function clean_emails(string $raw): string {
        $parts = preg_split('/[\s,;]+/', $raw) ?: [];
        $out = [];
        foreach ($parts as $p) {
            $e = sanitize_email(trim((string) $p));
            if ($e !== '' && is_email($e)) {
                $out[$e] = $e;
            }
        }
        return implode(', ', $out);
    }

    private static function safe_return(string $url): string {
        $url = esc_url_raw($url);
        if ($url === '' || wp_parse_url($url, PHP_URL_HOST) !== wp_parse_url(admin_url(), PHP_URL_HOST)) {
            return admin_url('admin.php?page=october-events');
        }
        return $url;
    }

    private static function current_url(): string {
        $host = (string) ($_SERVER['HTTP_HOST'] ?? '');
        $uri  = (string) ($_SERVER['REQUEST_URI'] ?? '');
        if ($host === '' || $uri === '') {
            return admin_url('admin.php?page=october-events');
        }
        return (is_ssl() ? 'https://' : 'http://') . $host . $uri;
    }
}
