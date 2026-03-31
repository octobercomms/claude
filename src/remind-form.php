<?php
/**
 * Shortcode: [remind_me_form]
 *
 * Usage:
 *   [remind_me_form list_id="5" template_id="12" studio_name="Manolo Design Studio" studio_url="https://example.com/studios/manolo"]
 *
 * All attributes are optional if you set fallbacks in remind-form.js.
 *
 * Drop this file in your child theme and require it from functions.php:
 *   require_once get_stylesheet_directory() . '/remind-form.php';
 */

add_action('wp_enqueue_scripts', function () {
    wp_enqueue_script(
        'remind-form',
        get_stylesheet_directory_uri() . '/assets/remind-form.js',
        [],
        '1.0.0',
        true
    );
});

add_shortcode('remind_me_form', function ($atts) {
    $a = shortcode_atts([
        'list_id'     => '',   // fallback if not set via custom field
        'template_id' => '',
        'studio_name' => '',   // fallback if not using page title
        'studio_url'  => '',   // fallback if not using current URL
    ], $atts);

    // studio_name → page title (fallback to shortcode attr)
    $studio_name = $a['studio_name'] ?: get_the_title();

    // studio_url → current page URL (fallback to shortcode attr)
    $studio_url = $a['studio_url'] ?: get_permalink();

    // list_id → custom field 'brevo_list_id' on the page (fallback to shortcode attr)
    $list_id = get_post_meta(get_the_ID(), 'brevo_list_id', true) ?: $a['list_id'];

    // template_id → custom field 'brevo_template_id' on the page (fallback to shortcode attr)
    $template_id = get_post_meta(get_the_ID(), 'brevo_template_id', true) ?: $a['template_id'];

    $data  = ' data-list-id="'     . esc_attr($list_id)     . '"';
    $data .= ' data-template-id="' . esc_attr($template_id) . '"';
    $data .= ' data-studio-name="' . esc_attr($studio_name) . '"';
    $data .= ' data-studio-url="'  . esc_attr($studio_url)  . '"';

    return '<form class="remind-form"' . $data . '>'
         . '<input type="email" placeholder="your@email.com" autocomplete="email" required>'
         . '<button type="submit">&#8594;</button>'
         . '</form>';
});
