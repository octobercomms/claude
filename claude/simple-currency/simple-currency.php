<?php
/**
 * Plugin Name: Simple Currency
 * Description: Lightweight GBP-based currency conversion with Cloudflare auto-detect and manual override. No WooCommerce.
 * Version: 2.0.0
 * Author: October
 */

if (!defined('ABSPATH')) {
    exit;
}

/* -----------------------------------------------------------
 * Activation: fetch rates immediately
 * ----------------------------------------------------------- */

register_activation_hook(__FILE__, function () {
    osc_update_currency_rates();
});

/* -----------------------------------------------------------
 * Exchange rates (weekly only – never on page load)
 * ----------------------------------------------------------- */

function osc_update_currency_rates() {

    $response = wp_remote_get(
        'https://open.er-api.com/v6/latest/GBP',
        ['timeout' => 10]
    );

    if (is_wp_error($response)) {
        return;
    }

    $data = json_decode(wp_remote_retrieve_body($response), true);

    if (empty($data['rates']['USD']) || empty($data['rates']['EUR'])) {
        return;
    }

    update_option('osc_currency_rates', [
        'USD'     => (float) $data['rates']['USD'],
        'EUR'     => (float) $data['rates']['EUR'],
        'updated' => time(),
    ]);
}

function osc_schedule_currency_updates() {
    if (!wp_next_scheduled('osc_weekly_currency_update')) {
        wp_schedule_event(time(), 'weekly', 'osc_weekly_currency_update');
    }
}

add_action('wp', 'osc_schedule_currency_updates');
add_action('osc_weekly_currency_update', 'osc_update_currency_rates');

/* -----------------------------------------------------------
 * Manual override (cache-safe)
 * Example: ?currency=USD
 * ----------------------------------------------------------- */

function osc_handle_currency_override() {
    if (!empty($_GET['currency']) && in_array($_GET['currency'], ['GBP','USD','EUR'], true)) {

        setcookie(
            'osc_currency',
            $_GET['currency'],
            time() + 30 * DAY_IN_SECONDS,
            '/',
            '',
            is_ssl(),
            true
        );

        wp_redirect(remove_query_arg('currency'));
        exit;
    }
}
add_action('plugins_loaded', 'osc_handle_currency_override');

/* -----------------------------------------------------------
 * Currency detection
 * Cloudflare ONLY. No IP APIs. No guessing.
 * ----------------------------------------------------------- */

function osc_detect_currency() {

    // Respect existing choice
    if (!empty($_COOKIE['osc_currency']) && in_array($_COOKIE['osc_currency'], ['GBP','USD','EUR'], true)) {
        return $_COOKIE['osc_currency'];
    }

    // Cloudflare country header
    if (!empty($_SERVER['HTTP_CF_IPCOUNTRY'])) {
        $country = $_SERVER['HTTP_CF_IPCOUNTRY'];

        if (in_array($country, ['US', 'CA'], true)) {
            $currency = 'USD';
        } elseif (in_array($country, [
            'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU',
            'IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'
        ], true)) {
            $currency = 'EUR';
        } else {
            $currency = 'GBP';
        }

        setcookie(
            'osc_currency',
            $currency,
            time() + 30 * DAY_IN_SECONDS,
            '/',
            '',
            is_ssl(),
            true
        );

        return $currency;
    }

    // Safe default
    return 'GBP';
}

/* -----------------------------------------------------------
 * Helpers
 * ----------------------------------------------------------- */

function osc_round_up($value, $step) {
    return ceil($value / $step) * $step;
}

function osc_format_money($currency, $amount, $decimals = 0) {
    switch ($currency) {
        case 'USD':
            return '$' . number_format($amount, $decimals);
        case 'EUR':
            return '€' . number_format($amount, $decimals);
        default:
            return '£' . number_format($amount, $decimals);
    }
}

/* -----------------------------------------------------------
 * Shortcode: [currency price="600"] or show="all"
 * Rounds up to nearest 5 (USD) or 1 (EUR), no decimals.
 * ----------------------------------------------------------- */

function osc_currency_shortcode($atts) {

    $atts = shortcode_atts([
        'price' => 0,
        'show'  => 'auto', // auto | all
    ], $atts);

    $gbp   = (float) $atts['price'];
    $rates = get_option('osc_currency_rates');

    if (!$rates || empty($rates['USD']) || empty($rates['EUR'])) {
        return osc_format_money('GBP', $gbp);
    }

    $usd = osc_round_up($gbp * $rates['USD'], 5);
    $eur = osc_round_up($gbp * $rates['EUR'], 1);

    if ($atts['show'] === 'all') {
        return sprintf(
            '%s / %s / %s',
            osc_format_money('GBP', $gbp),
            osc_format_money('USD', $usd),
            osc_format_money('EUR', $eur)
        );
    }

    $currency = osc_detect_currency();

    if ($currency === 'USD') {
        return osc_format_money('USD', $usd);
    }

    if ($currency === 'EUR') {
        return osc_format_money('EUR', $eur);
    }

    return osc_format_money('GBP', $gbp);
}
add_shortcode('currency', 'osc_currency_shortcode');

/* -----------------------------------------------------------
 * Shortcode: [currency_exact price="129.93"] or show="all"
 * Exact conversion, no rounding, 2 decimal places.
 * ----------------------------------------------------------- */

function osc_currency_exact_shortcode($atts) {

    $atts = shortcode_atts([
        'price' => 0,
        'show'  => 'auto', // auto | all
    ], $atts);

    $gbp   = (float) $atts['price'];
    $rates = get_option('osc_currency_rates');

    if (!$rates || empty($rates['USD']) || empty($rates['EUR'])) {
        return osc_format_money('GBP', $gbp, 2);
    }

    $usd = $gbp * $rates['USD'];
    $eur = $gbp * $rates['EUR'];

    if ($atts['show'] === 'all') {
        return sprintf(
            '%s / %s / %s',
            osc_format_money('GBP', $gbp, 2),
            osc_format_money('USD', $usd, 2),
            osc_format_money('EUR', $eur, 2)
        );
    }

    $currency = osc_detect_currency();

    if ($currency === 'USD') {
        return osc_format_money('USD', $usd, 2);
    }

    if ($currency === 'EUR') {
        return osc_format_money('EUR', $eur, 2);
    }

    return osc_format_money('GBP', $gbp, 2);
}
add_shortcode('currency_exact', 'osc_currency_exact_shortcode');

/* -----------------------------------------------------------
 * Optional switcher: [currency_switcher]
 * ----------------------------------------------------------- */

function osc_currency_switcher_shortcode() {
    return '<span class="osc-currency-switcher">'
        . '<a class="currency-symbol" href="' . esc_url(add_query_arg('currency', 'USD')) . '">$</a> '
        . '<a class="currency-symbol" href="' . esc_url(add_query_arg('currency', 'GBP')) . '">£</a> '
        . '<a class="currency-symbol" href="' . esc_url(add_query_arg('currency', 'EUR')) . '">€</a>'
        . '</span>';
}
add_shortcode('currency_switcher', 'osc_currency_switcher_shortcode');

/* -----------------------------------------------------------
 * Admin page (read-only)
 * ----------------------------------------------------------- */

function osc_register_admin_page() {
    add_options_page(
        'Currency Rates',
        'Currency Rates',
        'manage_options',
        'osc-currency-rates',
        'osc_render_admin_page'
    );
}
add_action('admin_menu', 'osc_register_admin_page');

function osc_render_admin_page() {

    if (
        !empty($_POST['osc_refresh_rates']) &&
        !empty($_POST['osc_refresh_rates_nonce']) &&
        wp_verify_nonce($_POST['osc_refresh_rates_nonce'], 'osc_refresh_rates')
    ) {
        osc_update_currency_rates();
    }

    $rates = get_option('osc_currency_rates');
    ?>
    <div class="wrap">
        <h1>Currency Rates</h1>

        <?php if (!$rates): ?>
            <p>No rates stored yet.</p>
        <?php else: ?>
            <table class="widefat striped">
                <tbody>
                    <tr><th>Base</th><td>GBP</td></tr>
                    <tr><th>USD</th><td><?php echo esc_html($rates['USD']); ?></td></tr>
                    <tr><th>EUR</th><td><?php echo esc_html($rates['EUR']); ?></td></tr>
                    <tr><th>Updated</th><td><?php echo esc_html(date('l j F Y, H:i', $rates['updated'])); ?></td></tr>
                </tbody>
            </table>
        <?php endif; ?>

        <form method="post" style="margin-top:16px;">
            <?php wp_nonce_field('osc_refresh_rates', 'osc_refresh_rates_nonce'); ?>
            <input type="submit" class="button button-secondary" name="osc_refresh_rates" value="Refresh rates now">
        </form>

        <p style="margin-top:16px;color:#555;">
            Rates update automatically once per week. No geo IP lookups are used.
        </p>
    </div>
    <?php
}
