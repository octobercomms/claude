<?php

// Include Jupiter X.
require_once( get_template_directory() . '/lib/init.php' );

/**
 * Enqueue assets.
 */
jupiterx_add_smart_action( 'wp_enqueue_scripts', 'jupiterx_child_enqueue_scripts', 8 );

function jupiterx_child_enqueue_scripts() {

	wp_enqueue_style(
		'jupiterx-child',
		get_stylesheet_directory_uri() . '/assets/css/style.css'
	);

	wp_enqueue_script(
		'jupiterx-child',
		get_stylesheet_directory_uri() . '/assets/js/script.js',
		array( 'jquery' ),
		false,
		true
	);
}

/* TRACKING CLICKS */
add_action('wp_enqueue_scripts', function() {
    wp_enqueue_script(
        'nvelope-tracking',
        get_stylesheet_directory_uri() . '/assets/tracking.js',
        [],
        '1.0.1',
        true
    );
});

/**
 * Example 1 (unused)
 */
// jupiterx_add_smart_action( 'wp', 'jupiterx_setup_document' );

function jupiterx_setup_document() {

	jupiterx_add_attribute( 'jupiterx_header', 'class', 'jupiterx-child-header' );
	jupiterx_remove_action( 'jupiterx_breadcrumb' );
	jupiterx_modify_action_hook( 'jupiterx_post_image', 'jupiterx_post_header_before_markup' );
	jupiterx_replace_attribute( 'jupiterx_post_more_link', 'class' , 'btn-outline-secondary', 'btn-danger' );
	jupiterx_modify_action_priority( 'jupiterx_post_related', 11 );
}







/**
 * SAFE: If we're on a Learn post, try to return the parent Studio ID using JetEngine relation ID 6.
 * This will NEVER fatal if JetEngine changes methods.
 */
function nvelope_get_parent_studio_id_for_learn( $learn_id ) {

	$learn_id = (int) $learn_id;
	if ( ! $learn_id ) {
		return 0;
	}

	if ( ! function_exists( 'jet_engine' ) ) {
		return 0;
	}

	$je = jet_engine();
	if ( ! $je || ! isset( $je->relations ) || ! method_exists( $je->relations, 'get_relation' ) ) {
		return 0;
	}

	$relation_id = 6;
	$relation    = $je->relations->get_relation( $relation_id );

	if ( ! $relation ) {
		return 0;
	}

	// Try the most likely method names across versions/setups.
	$candidates = array();

	if ( method_exists( $relation, 'get_parents' ) ) {
		$candidates[] = $relation->get_parents( $learn_id );
	}

	if ( method_exists( $relation, 'get_related_items' ) ) {
		$candidates[] = $relation->get_related_items( $learn_id );
	}

	// Some setups may store relation meta on the child post; try that as a last resort.
	// (If this yields nothing, it just returns 0 safely.)
	foreach ( $candidates as $result ) {
		if ( is_array( $result ) && ! empty( $result ) ) {
			return (int) $result[0];
		}
	}

	return 0;
}


/**
 * Get the Studio post ID that should supply brand settings.
 * - On Studio: current post ID
 * - On Learn: parent Studio via JetEngine relation ID 6
 */
function nvelope_get_brand_studio_id() {

    // Studio page → use itself
    if ( is_singular( 'studio' ) ) {
        return (int) get_queried_object_id();
    }

    // Learn page → get parent Studio via relation ID 6
    if ( is_singular( 'learn' ) && function_exists( 'jet_engine' ) ) {

        $learn_id = (int) get_queried_object_id();
        if ( ! $learn_id ) return 0;

        $relation = jet_engine()->relations->get_relation( 6 );
        if ( ! $relation ) return 0;

        $parents = $relation->get_parents( $learn_id );
        if ( is_array( $parents ) && ! empty( $parents ) ) {
            return (int) $parents[0];
        }
    }

    return 0;
}







/**
 * Load per-post Google Fonts + CSS variables on Studio + Learn single pages
 * - Studio: reads meta from current Studio post
 * - Learn: reads meta from parent Studio via JetEngine relation ID 6
 */
add_action( 'wp_head', 'nvelope_studio_typography_head', 20 );
function nvelope_studio_typography_head() {

	if ( ! is_singular( array( 'studio', 'learn' ) ) ) {
		return;
	}

	$post_id = (int) get_queried_object_id();
	if ( ! $post_id ) {
		return;
		
		// If we're on a Learn post, pull brand settings from parent Studio via JetEngine relation (ID 6)
if ( is_singular( 'learn' ) && function_exists( 'jet_engine' ) && isset( jet_engine()->relations ) ) {

    $relation = jet_engine()->relations->get_relation( 6 );

    if ( $relation && method_exists( $relation, 'get_parents' ) ) {

        $parents = $relation->get_parents( (int) $post_id );

        if ( is_array( $parents ) && ! empty( $parents ) ) {
            $first = $parents[0];

            // JetEngine can return IDs or objects depending on version
            if ( is_object( $first ) && isset( $first->ID ) ) {
                $post_id = (int) $first->ID;
            } else {
                $post_id = (int) $first;
            }
        }
    }
}
		
		
	}

	// KEY FIX: if Learn, swap to parent Studio for meta reads
	if ( is_singular( 'learn' ) ) {
		$studio_id = nvelope_get_parent_studio_id_for_learn( $post_id );
		if ( $studio_id ) {
			$post_id = (int) $studio_id;
		}
	}

	$body_family     = trim( (string) get_post_meta( $post_id, 'studio_body_font_family', true ) );
	$heading_family  = trim( (string) get_post_meta( $post_id, 'studio_heading_font_family', true ) );
	$body_weights    = trim( (string) get_post_meta( $post_id, 'studio_body_font_weights', true ) );
	$heading_weights = trim( (string) get_post_meta( $post_id, 'studio_heading_font_weights', true ) );

	$base_size    = (int) get_post_meta( $post_id, 'studio_font_size_base', true );
	$font_color   = trim( (string) get_post_meta( $post_id, 'studio_font_color', true ) );
	$accent_color = trim( (string) get_post_meta( $post_id, 'studio_accent_color', true ) );
	$hover_color  = trim( (string) get_post_meta( $post_id, 'studio_hover_color', true ) );
	$bg_color     = trim( (string) get_post_meta( $post_id, 'studio_background_color', true ) );
	$panel_color  = trim( (string) get_post_meta( $post_id, 'studio_panel_color', true ) );

	if ( $body_family === '' ) { $body_family = 'Inter'; }
	if ( $heading_family === '' ) { $heading_family = $body_family; }
	if ( $body_weights === '' ) { $body_weights = '400'; }
	if ( $heading_weights === '' ) { $heading_weights = '600,700'; }
	if ( $base_size <= 0 ) { $base_size = 18; }

	if ( $font_color === '' ) { $font_color = '#111111'; }
	if ( $accent_color === '' ) { $accent_color = '#444444'; }
	if ( $hover_color === '' ) { $hover_color = '#000000'; }
	if ( $bg_color === '' ) { $bg_color = '#f5f5f5'; }
	if ( $panel_color === '' ) { $panel_color = '#ffffff'; }

	$families = array();

	$gf_body_family  = str_replace( ' ', '+', $body_family );
	$gf_body_weights = implode( ';', array_filter( array_map( 'trim', explode( ',', $body_weights ) ) ) );
	if ( $gf_body_family && $gf_body_weights ) {
		$families[] = "family={$gf_body_family}:wght@{$gf_body_weights}";
	}

	if ( $heading_family !== $body_family ) {
		$gf_heading_family  = str_replace( ' ', '+', $heading_family );
		$gf_heading_weights = implode( ';', array_filter( array_map( 'trim', explode( ',', $heading_weights ) ) ) );
		if ( $gf_heading_family && $gf_heading_weights ) {
			$families[] = "family={$gf_heading_family}:wght@{$gf_heading_weights}";
		}
	}

	if ( ! empty( $families ) ) {
		$google_fonts_url = 'https://fonts.googleapis.com/css2?' . implode( '&', $families ) . '&display=swap';
		echo "\n<!-- nvelope per-post Google Fonts -->\n";
		echo '<link rel="stylesheet" href="' . esc_url( $google_fonts_url ) . '">' . "\n";
	}

	$heading_weight_default = 600;
	$hw_parts = array_filter( array_map( 'trim', explode( ',', $heading_weights ) ) );
	if ( ! empty( $hw_parts ) && is_numeric( $hw_parts[0] ) ) {
		$heading_weight_default = (int) $hw_parts[0];
	}

	$scope = 'body.single-studio, body.single-learn';
	?>
	<style id="nvelope-studio-typography">
		<?php echo $scope; ?>{
			--studio-font-body: '<?php echo esc_attr( $body_family ); ?>', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
			--studio-font-heading: '<?php echo esc_attr( $heading_family ); ?>', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
			--studio-font-size-base: <?php echo (int) $base_size; ?>px;
			--studio-font-color: <?php echo esc_html( $font_color ); ?>;
			--studio-accent-color: <?php echo esc_html( $accent_color ); ?>;
			--studio-hover-color: <?php echo esc_html( $hover_color ); ?>;
			--studio-bg-color: <?php echo esc_html( $bg_color ); ?>;
			--studio-panel-color: <?php echo esc_html( $panel_color ); ?>;
			--studio-heading-weight: <?php echo (int) $heading_weight_default; ?>;
		}
	</style>
	<?php
}

/**
 * Per-studio logo width on Studio + Learn single pages.
 * Learn inherits from parent Studio (relation ID 6).
 */
function nvelope_studio_logo_width_css() {

	if ( ! ( is_singular( 'studio' ) || is_singular( 'learn' ) ) ) {
		return;
	}

	$post_id = (int) get_queried_object_id();
	if ( ! $post_id ) {
		return;
	}

	if ( is_singular( 'learn' ) ) {
		$studio_id = nvelope_get_parent_studio_id_for_learn( $post_id );
		if ( $studio_id ) {
			$post_id = (int) $studio_id;
		}
	}

	$width = get_post_meta( $post_id, 'studio_logo_width_px', true );

	if ( empty( $width ) || ! is_numeric( $width ) ) {
		return;
	}

	$width = (int) $width;

	echo "\n<style id=\"studio-logo-width\">\n";
	echo ".single-studio .logo img, .single-learn .logo img {";
	echo " width: {$width}px !important;";
	echo " max-width: 100%;";
	echo " height: auto !important;";
	echo " display: block;";
	echo " }\n";
	echo "</style>\n";
}
add_action( 'wp_head', 'nvelope_studio_logo_width_css', 40 );

/**
 * Override the site icon (favicon) URL on Studio + Learn single pages.
 * Learn inherits from parent Studio (relation ID 6).
 */
function nvelope_studio_override_site_icon( $url, $size, $blog_id ) {

	if ( ! ( is_singular( 'studio' ) || is_singular( 'learn' ) ) ) {
		return $url;
	}

	$post_id = (int) get_queried_object_id();
	if ( ! $post_id ) {
		return $url;
	}

	if ( is_singular( 'learn' ) ) {
		$studio_id = nvelope_get_parent_studio_id_for_learn( $post_id );
		if ( $studio_id ) {
			$post_id = (int) $studio_id;
		}
	}

	$favicon = get_post_meta( $post_id, 'studio_favicon', true );

	if ( $favicon && is_numeric( $favicon ) ) {
		$favicon = wp_get_attachment_url( (int) $favicon );
	}

	if ( empty( $favicon ) ) {
		return $url;
	}

	$favicon = add_query_arg( 'v', time(), $favicon );

	return $favicon;
}
add_filter( 'get_site_icon_url', 'nvelope_studio_override_site_icon', 10, 3 );

/**
 * Allow <iframe> tags from meta fields
 */
add_filter( 'wp_kses_allowed_html', function( $tags, $context ) {

	if ( 'post' === $context ) {
		$tags['iframe'] = array(
			'src'             => true,
			'width'           => true,
			'height'          => true,
			'style'           => true,
			'frameborder'     => true,
			'allow'           => true,
			'allowfullscreen' => true,
			'loading'         => true,
			'referrerpolicy'  => true,
		);
	}

	return $tags;
}, 10, 2 );

/**
 * Fillout shortcode
 */
function nvelope_studio_fillout_shortcode( $atts ) {

	$atts = shortcode_atts(
		array(
			'field' => 'studio_form_embed',
		),
		$atts,
		'studio_fillout'
	);

	$code = get_post_meta( get_the_ID(), $atts['field'], true );

	if ( ! $code ) {
		return '';
	}

	return $code;
}
add_shortcode( 'studio_fillout', 'nvelope_studio_fillout_shortcode' );









// BREVO (robust + works with either full URL or UID)
function nvelope_brevo_iframe_shortcode( $atts ) {

	$atts = shortcode_atts( [
		'field' => 'studio_brevo_form_uid', // meta field name on the Learn post
	], $atts, 'nvelope_brevo_iframe' );

	$value = trim( (string) get_post_meta( get_the_ID(), $atts['field'], true ) );
	if ( $value === '' ) {
		return '';
	}

	// If they've stored the full URL, use it.
	if ( preg_match( '#^https?://#i', $value ) ) {
		$src = $value;
	} else {
		// If they've stored only the UID, force the correct Brevo host.
		$uid = $value;

		// If someone pasted "sibforms.com/serve/..." into the field, strip it down.
		$uid = preg_replace( '#^https?://(www\.)?sibforms\.com/serve/#i', '', $uid );
		$uid = preg_replace( '#^https?://[a-z0-9]+\.sibforms\.com/serve/#i', '', $uid );

		$src = 'https://83f71eb9.sibforms.com/serve/' . $uid;
	}

	return sprintf(
		'<div class="brevo-embed"> <iframe src="%s" frameborder="0" scrolling="no" allowfullscreen loading="lazy"> </iframe> </div>',
		esc_url( $src )
	);
}
add_shortcode( 'nvelope_brevo_iframe', 'nvelope_brevo_iframe_shortcode' );








// LEARN  GATED POPUPS
add_action('wp_enqueue_scripts', function () {
  wp_enqueue_script(
    'nvelope-asset-drawer',
    get_stylesheet_directory_uri() . '/assets/js/script.js',
    array(),
    '1.0.0',
    true
  );
}, 20);







// CSS
add_action('wp_enqueue_scripts', function () {

    // CSS
    $css_path = get_stylesheet_directory() . '/style.css';
    if (file_exists($css_path)) {
        wp_enqueue_style(
            'nvelope-css',
            get_stylesheet_directory_uri() . '/style.css',
            array(),
            filemtime($css_path)
        );
    }

    // JS (if you want same treatment)
    $js_path = get_stylesheet_directory() . '/assets/js/script.js';
    if (file_exists($js_path)) {
        wp_enqueue_script(
            'nvelope-js',
            get_stylesheet_directory_uri() . '/assets/js/script.js',
            array('jquery'),
            filemtime($js_path),
            true
        );
    }

}, 999);











/**
 * nvelope: Per-studio tracking tags for:
 * - /studio/{slug}/  (Studio single)
 * - /learn/{slug}/   (Advice Hub page mapped to a Studio by slug)
 *
 * Store ONLY IDs in Studio post meta:
 * - x_pixel_id
 * - meta_pixel_id
 * - pinterest_tag_id
 * - ga4_id
 * - google_ads_id
 *
 * Outputs base tags + a small set of standard events.
 * You can expand events later, but this gets clean retargeting working first.
 */

/**
 * Resolve the Studio post ID for the current request.
 */
function nvelope_get_studio_id_for_tracking() {

	// 1) Direct Studio single.
	if ( is_singular( 'studio' ) ) {
		return (int) get_queried_object_id();
	}

	// 2) Map /learn/{studio-slug}/ to the Studio CPT by slug.
	$path = parse_url( $_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH );
	$path = is_string( $path ) ? trim( $path, '/' ) : '';

	if ( $path === '' ) {
		return 0;
	}

	$parts = explode( '/', $path );
	if ( count( $parts ) < 2 ) {
		return 0;
	}

	$prefix = $parts[0];
	$slug   = $parts[1];

	if ( $prefix !== 'learn' && $prefix !== 'studio' ) {
		return 0;
	}

	$slug = sanitize_title( $slug );
	if ( $slug === '' ) {
		return 0;
	}

	$studio_post = get_page_by_path( $slug, OBJECT, 'studio' );
	if ( ! $studio_post || is_wp_error( $studio_post ) ) {
		return 0;
	}

	return (int) $studio_post->ID;
}

/**
 * Helper: work out which step the user is on, based on ?step=...
 * Example: /studio/manolo-design-studio/?step=quiz
 */
function nvelope_get_step_for_tracking() {
	$step = isset( $_GET['step'] ) ? sanitize_key( wp_unslash( $_GET['step'] ) ) : '';
	return $step ?: 'landing';
}

/**
 * Output tags (X, Meta, Pinterest, GA4, Google Ads) per Studio.
 * Hooked into wp_head so it works on both /studio/ and /learn/.
 */
function nvelope_output_studio_tracking_tags() {

	$studio_id = nvelope_get_studio_id_for_tracking();
	if ( ! $studio_id ) {
		return;
	}

	$step = nvelope_get_step_for_tracking();

	// Pull IDs from Studio meta.
	$x_pixel_id        = trim( (string) get_post_meta( $studio_id, 'x_pixel_id', true ) );
	$meta_pixel_id     = trim( (string) get_post_meta( $studio_id, 'meta_pixel_id', true ) );
	$pinterest_tag_id  = trim( (string) get_post_meta( $studio_id, 'pinterest_tag_id', true ) );
	$ga4_id            = trim( (string) get_post_meta( $studio_id, 'ga4_id', true ) );
	$google_ads_id     = trim( (string) get_post_meta( $studio_id, 'google_ads_id', true ) );

	// Debug marker so you can view-source and confirm it’s firing.
	echo "\n<!-- nvelope tracking: studio_id={$studio_id} step={$step} -->\n";

	/**
	 * X (Twitter) Pixel
	 */
	if ( $x_pixel_id !== '' ) {
		$x_pixel_id_js = esc_js( $x_pixel_id );
		$event_name    = esc_js( 'sbm_' . $step );

		echo "<script>
!function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments);},
s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',
a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');
twq('config','{$x_pixel_id_js}');
twq('track','PageView');
// Step event for retargeting segmentation
twq('track','{$event_name}');
</script>\n";
	}

	/**
	 * Meta (Facebook) Pixel
	 */
	if ( $meta_pixel_id !== '' ) {
		$meta_pixel_id_js = esc_js( $meta_pixel_id );
		$event_name       = esc_js( 'sbm_' . $step );

		echo "<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init','{$meta_pixel_id_js}');
fbq('track','PageView');
// Step event for retargeting segmentation
fbq('trackCustom','{$event_name}');
</script>
<noscript><img height=\"1\" width=\"1\" style=\"display:none\"
src=\"https://www.facebook.com/tr?id={$meta_pixel_id_js}&ev=PageView&noscript=1\" /></noscript>\n";
	}

	/**
	 * Pinterest Tag
	 */
	if ( $pinterest_tag_id !== '' ) {
		$pinterest_tag_id_js = esc_js( $pinterest_tag_id );
		$event_name          = esc_js( 'sbm_' . $step );

		echo "<script>
!function(e){if(!window.pintrk){window.pintrk=function(){window.pintrk.queue.push(Array.prototype.slice.call(arguments))};
var n=window.pintrk;n.queue=[],n.version='3.0';var t=document.createElement('script');t.async=!0;t.src=e;
var r=document.getElementsByTagName('script')[0];r.parentNode.insertBefore(t,r)}}('https://s.pinimg.com/ct/core.js');
pintrk('load','{$pinterest_tag_id_js}',{em:''});
pintrk('page');
// Step event for retargeting segmentation
pintrk('track','custom',{event:'{$event_name}'});
</script>
<noscript><img height=\"1\" width=\"1\" style=\"display:none\" alt=\"\"
src=\"https://ct.pinterest.com/v3/?event=pagevisit&tid={$pinterest_tag_id_js}&noscript=1\" /></noscript>\n";
	}

	/**
	 * GA4 (gtag)
	 */
	if ( $ga4_id !== '' ) {
		$ga4_id_js = esc_js( $ga4_id );
		$event     = esc_js( 'sbm_' . $step );

		echo "<script async src=\"https://www.googletagmanager.com/gtag/js?id={$ga4_id_js}\"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config','{$ga4_id_js}');
gtag('event','{$event}');
</script>\n";
	}

	/**
	 * Google Ads (gtag). Note: this is the AW-XXXX ID.
	 * This does NOT create conversions on its own. It enables remarketing.
	 */
	if ( $google_ads_id !== '' ) {
		$google_ads_id_js = esc_js( $google_ads_id );
		$event            = esc_js( 'sbm_' . $step );

		echo "<script async src=\"https://www.googletagmanager.com/gtag/js?id={$google_ads_id_js}\"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config','{$google_ads_id_js}');
gtag('event','{$event}');
</script>\n";
	}

	echo "<!-- /nvelope tracking -->\n";
}
add_action( 'wp_head', 'nvelope_output_studio_tracking_tags', 20 );






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







/**
 * Example 2 (unused)
 */
// jupiterx_add_smart_action( 'jupiterx_subfooter_credit_text_output', 'jupiterx_child_modify_subfooter_credit' );

function jupiterx_child_modify_subfooter_credit() { ?>

	<a href="https//jupiterx.com" target="_blank">Jupiter X Child</a> theme for <a href="http://wordpress.org" target="_blank">WordPress</a>

<?php }