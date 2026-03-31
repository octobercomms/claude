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

// Runs after the main query is set — reliably gets the correct page ID
// even when the shortcode is rendered inside an Elementor header template.
add_action('wp', function () {
    if ( ! wp_script_is('remind-form', 'enqueued') ) return;

    $page_id     = get_queried_object_id();
    $list_id     = get_post_meta($page_id, 'brevo_list_id', true);
    $template_id = get_post_meta($page_id, 'brevo_template_id', true);

    wp_localize_script('remind-form', 'remindFormPage', [
        'listId'     => $list_id     ? (int) $list_id     : null,
        'templateId' => $template_id ? (int) $template_id : null,
        'studioName' => get_the_title($page_id),
        'studioUrl'  => get_permalink($page_id),
    ]);
});

add_shortcode('remind_me_form', function ($atts) {
    $a = shortcode_atts([
        'list_id'     => '',   // fallback if not set via custom field
        'template_id' => '',
        'studio_name' => '',   // fallback if not using page title
        'studio_url'  => '',   // fallback if not using current URL
    ], $atts);

    // Use the queried page ID — works correctly when shortcode runs inside
    // an Elementor header/footer template rather than the page itself.
    $page_id = get_queried_object_id();

    // studio_name → page title (fallback to shortcode attr)
    $studio_name = $a['studio_name'] ?: get_the_title($page_id);

    // studio_url → current page URL (fallback to shortcode attr)
    $studio_url = $a['studio_url'] ?: get_permalink($page_id);

    // list_id → custom field 'brevo_list_id' on the page (fallback to shortcode attr)
    $list_id = get_post_meta($page_id, 'brevo_list_id', true) ?: $a['list_id'];

    // template_id → custom field 'brevo_template_id' on the page (fallback to shortcode attr)
    $template_id = get_post_meta($page_id, 'brevo_template_id', true) ?: $a['template_id'];

    $data  = ' data-list-id="'     . esc_attr($list_id)     . '"';
    $data .= ' data-template-id="' . esc_attr($template_id) . '"';
    $data .= ' data-studio-name="' . esc_attr($studio_name) . '"';
    $data .= ' data-studio-url="'  . esc_attr($studio_url)  . '"';

    return '<form class="remind-form"' . $data . '>'
         . '<input type="email" placeholder="your@email.com" autocomplete="email" required>'
         . '<button type="submit">&#8594;</button>'
         . '</form>';
});
