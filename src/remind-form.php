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
        'list_id'     => '',
        'template_id' => '',
        'studio_name' => '',
        'studio_url'  => '',
    ], $atts);

    $data  = ' data-list-id="'     . esc_attr($a['list_id'])     . '"';
    $data .= ' data-template-id="' . esc_attr($a['template_id']) . '"';
    $data .= ' data-studio-name="' . esc_attr($a['studio_name']) . '"';
    $data .= ' data-studio-url="'  . esc_attr($a['studio_url'])  . '"';

    return '<form class="remind-form"' . $data . '>'
         . '<input type="email" placeholder="your@email.com" autocomplete="email" required>'
         . '<button type="submit">&#8594;</button>'
         . '</form>';
});
