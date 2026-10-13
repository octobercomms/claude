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
                ['key' => 'currency', 'label' => 'Currency', 'type' => 'select', 'options' => ['usd' => 'USD ($)', 'gbp' => 'GBP (£)', 'eur' => 'EUR (€)']],
                ['key' => 'bnpl_enabled', 'label' => 'Offer Buy-now-pay-later / wallet checkout', 'type' => 'bool'],
            ],
        ],
        'volunteers' => [
            'heading' => 'Volunteer settings',
            'fields'  => [
                ['key' => 'volunteer_faq_url', 'label' => 'Volunteer FAQ link', 'type' => 'url', 'hint' => 'Linked in the footer of every volunteer email.'],
                ['key' => 'volunteer_code_reward_label', 'label' => 'Thank-you reward label', 'type' => 'text', 'hint' => 'e.g. "2 free tickets".'],
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
        echo '<div class="oe-acc-body" style="padding:12px 0">';
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
        $key  = (string) $f['key'];
        $type = (string) $f['type'];
        $val  = Settings::get($key, '');
        $label = esc_html((string) $f['label']);
        $hint  = isset($f['hint']) ? '<span style="display:block;color:#777;font-size:.85em;margin-top:2px">' . esc_html((string) $f['hint']) . '</span>' : '';

        if ($type === 'bool') {
            printf(
                '<p style="margin:0"><label><input type="checkbox" name="%s" value="1"%s> %s</label>%s</p>',
                esc_attr($key),
                checked((bool) $val, true, false),
                $label,
                $hint
            );
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
        if ($type === 'textarea') {
            echo '<p style="margin:0"><label style="font-weight:600;display:block;margin-bottom:4px">' . $label . '</label>';
            printf('<textarea name="%s" style="width:100%%;min-height:70px">%s</textarea>', esc_attr($key), esc_textarea((string) $val));
            echo $hint . '</p>';
            return;
        }
        // text / url
        printf(
            '<p style="margin:0"><label style="font-weight:600;display:block;margin-bottom:4px">%s</label><input type="%s" name="%s" value="%s" style="width:100%%">%s</p>',
            $label,
            $type === 'url' ? 'url' : 'text',
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
            $key  = (string) $f['key'];
            $type = (string) $f['type'];
            switch ($type) {
                case 'bool':
                    $clean[$key] = ! empty($_POST[$key]); // presence, scoped to this form's known fields
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
                default:
                    $clean[$key] = sanitize_text_field((string) wp_unslash($_POST[$key] ?? ''));
            }
        }
        Settings::update($clean); // merge-safe: only these keys change

        wp_safe_redirect(add_query_arg('oe_ctx_saved', $ctx, $return));
        exit;
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
