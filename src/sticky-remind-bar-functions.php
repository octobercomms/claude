<?php
/**
 * Enqueue the sticky "Remind me on desktop" bar assets.
 *
 * Add this snippet to your child theme's functions.php.
 *
 * The bar reads two hidden fields that you must output somewhere on the page:
 *
 *   <!-- Option A: plain HTML hidden inputs (e.g. via Elementor HTML widget) -->
 *   <input type="hidden" id="nvelope-studio-name" value="Manolo Design Studio">
 *   <input type="hidden" id="nvelope-studio-url"  value="https://example.com/studios/manolo">
 *
 *   <!-- Option B: use the wp_localize_script data below and skip the hidden inputs -->
 *   (See nvelope_remind_bar_meta() below for a dynamic approach.)
 */

add_action( 'wp_enqueue_scripts', 'nvelope_enqueue_remind_bar' );

function nvelope_enqueue_remind_bar() {
    $base = get_stylesheet_directory_uri() . '/assets/remind-bar/';

    wp_enqueue_style(
        'nvelope-remind-bar',
        $base . 'sticky-remind-bar.css',
        [],
        '1.0.0'
    );

    wp_enqueue_script(
        'nvelope-remind-bar',
        $base . 'sticky-remind-bar.js',
        [],          // no jQuery dependency
        '1.0.0',
        true         // load in footer
    );
}


/**
 * (Optional) If you want to pass studio_name / studio_url from PHP
 * instead of using hidden HTML inputs, uncomment the block below.
 *
 * This is useful when the values come from a custom field on the page/post.
 * The JS will fall back to window.nvelopeRemindBarMeta if the hidden inputs
 * are not found in the DOM.
 *
 * You will also need to add a small JS snippet at the top of sticky-remind-bar.js
 * to read window.nvelopeRemindBarMeta before falling back to querySelector.
 */

/*
add_action( 'wp_enqueue_scripts', 'nvelope_remind_bar_meta', 20 );

function nvelope_remind_bar_meta() {
    if ( ! wp_script_is( 'nvelope-remind-bar', 'enqueued' ) ) {
        return;
    }

    // Replace these with your actual field logic
    $studio_name = get_post_meta( get_the_ID(), 'studio_name', true ) ?: get_bloginfo( 'name' );
    $studio_url  = get_permalink();

    wp_localize_script(
        'nvelope-remind-bar',
        'nvelopeRemindBarMeta',
        [
            'studioName' => esc_js( $studio_name ),
            'studioUrl'  => esc_url( $studio_url ),
        ]
    );
}
*/
