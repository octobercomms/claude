<?php
foreach ( array( 'pre_term_description' ) as $filter ) {
    remove_filter( $filter, 'wp_filter_kses' );
}
foreach ( array( 'term_description' ) as $filter ) {
    remove_filter( $filter, 'wp_kses_data' );
}
add_filter( 'term_description', 'do_shortcode' );
add_filter( 'category_description', 'do_shortcode' );
add_action('admin_head', 'custom_code');
function custom_code() {
  echo '<style>
    .acf-image-uploader .image-wrap img{width: 100px !important;}
  </style>';
}
function child_theme_scripts(){
    // Enqueue noUiSlider JS
    wp_enqueue_style('nouislider-css', 'https://cdnjs.cloudflare.com/ajax/libs/noUiSlider/14.6.0/nouislider.min.css');
    wp_enqueue_script('nouislider-js', 'https://cdnjs.cloudflare.com/ajax/libs/noUiSlider/14.6.0/nouislider.min.js', array('jquery'), null, true);

  wp_enqueue_style( 'slick-slider-style', get_stylesheet_directory_uri() . '/js/slick/slick.css', array());
  wp_enqueue_style( 'slick-slider-style_default', get_stylesheet_directory_uri() . '/js/slick/slick-theme.css', array());
  wp_enqueue_script( 'js-cookie', 'https://cdn.jsdelivr.net/npm/js-cookie@3.0.1/dist/js.cookie.min.js', array('jquery'));
  wp_enqueue_script( 'sick-slider-script', get_stylesheet_directory_uri() . '/js/slick/slick.min.js', array('jquery'));

//Update 09/06/2023
//wp_enqueue_script( 'custom-js', get_stylesheet_directory_uri() . '/js/custom.min.js', array('jquery'), null, true);
wp_enqueue_script( 'custom-js', get_stylesheet_directory_uri() . '/js/custom.js', array('jquery'), null, true);
  // Asset version helper: filemtime() is stable across requests (it only changes
  // when the file changes), so browser/CDN/page caches keep working. Using time()
  // here previously cache-busted every CSS/JS on EVERY page load, sitewide.
  $ac_ver = function( $rel ) {
    $f = get_stylesheet_directory() . $rel;
    return file_exists( $f ) ? filemtime( $f ) : null;
  };
  wp_enqueue_style( 'scss', get_stylesheet_directory_uri() . '/css/style.css', array(), $ac_ver( '/css/style.css' ) );
  wp_enqueue_style( 'scss-2022', get_stylesheet_directory_uri() . '/css-2022/style.css', array(), $ac_ver( '/css-2022/style.css' ) );
    wp_enqueue_script( 'ls_custom', get_stylesheet_directory_uri() . '/js/lscustom.js', array("jquery"), $ac_ver( '/js/lscustom.js' ) , true);
    wp_enqueue_style( 'ac-fabric-drawer', get_stylesheet_directory_uri() . '/css/fabric-drawer.css', array(), $ac_ver( '/css/fabric-drawer.css' ) );
    wp_enqueue_script( 'ac-fabric-drawer', get_stylesheet_directory_uri() . '/js/fabric-drawer.js', array("jquery"), $ac_ver( '/js/fabric-drawer.js' ) , true);
   global $wp_query;
      // Capture all query variables
      $original_query_params = $wp_query->query_vars;
      $product_ids = wp_list_pluck($wp_query->posts, 'ID'); // Plucks the IDs from the posts
     wp_localize_script(
            'ls_custom',
            'ls_custom_obj',
            array(
              'ajaxurl' => admin_url( 'admin-ajax.php' ),
              'nonce' => wp_create_nonce('filter_nonce'),
              'orderby' => isset($original_query_params['orderby']) ? $original_query_params['orderby'] : 'menu_order',
                 'order' => isset($original_query_params['order']) ? $original_query_params['order'] : 'ASC',
                 'meta_query' => isset($original_query_params['meta_query']) ? $original_query_params['meta_query'] : [],
                 'tax_query' => isset($original_query_params['tax_query']) ? $original_query_params['tax_query'] : [],
                 'posts_per_page' => isset($original_query_params['posts_per_page']) ? $original_query_params['posts_per_page'] : 45,
                 'category' => get_queried_object_id(), // Current category ID
                 'paged' => get_query_var('paged', 1),  // Current page number
                 's' => get_query_var('s', ''),  // Search query
                 'post__in' => isset($original_query_params['post__in']) ? $original_query_params['post__in'] : [],
                 'ignore_sticky_posts' => isset($original_query_params['ignore_sticky_posts']) ? $original_query_params['ignore_sticky_posts'] : true,
                 'product_ids' => $product_ids, // Pass the list of product IDs to JavaScript
                 'full_query'=>$wp_query,
          )
        );
   //Update 09/06/2023
    //if(is_product()){
      // Use the real library versions, not time() — these are versioned CDN URLs
      // that never change, so cache-busting them on every load just forced an
      // uncached re-fetch of both external files every page view.
      wp_enqueue_style( 'select2-stylesheet', 'https://cdn.jsdelivr.net/npm/select2@4.0.13/dist/css/select2.min.css', array(), '4.0.13' );
      wp_enqueue_script( 'select2',  'https://cdnjs.cloudflare.com/ajax/libs/select2/4.0.12/js/select2.full.min.js', array('jquery'), '4.0.12' );
    //}
}
add_action( 'wp_enqueue_scripts', 'child_theme_scripts',20);
function ls_admin_enqueue($hook) {

    wp_enqueue_script('admin_scripts', get_stylesheet_directory_uri() . '/js/adminscript.js',array("jquery") );
}
add_action('admin_enqueue_scripts', 'ls_admin_enqueue');
add_filter( 'pre_get_posts', 'tgm_io_cpt_search' );
/**
 * This function modifies the main WordPress query to include an array of
 * post types instead of the default 'post' post type.
 *
 * @param object $query  The original query.
 * @return object $query The amended query.
 */
function tgm_io_cpt_search( $query ) {
    if ( !is_admin() && $query->is_search ) {
		$query->set( 'post_type', array(  'product') );
	}

  //Exlcude US Products from shop pages
  if(!is_admin() && $query->is_main_query() && ( $query->is_search OR is_shop() OR is_product_category()) ){
	$location = WC_Geolocation::geolocate_ip();
	$country = $location['country'];
	if($country=='US'){
    $meta_query = array(
        'relation' => 'AND',
      /*  array(
          'key' => '_fz_country_restriction_type',
          'value' => 'excluded',
          'compare' => '!='
        )*/
        array(
          'key' => '_fz_restricted_countries',
          'value' => 'US";',
          'compare' => 'NOT LIKE'
        )
      );
      $query->set('meta_query', array($meta_query));
		}//if us
  }//if product pageå
	return $query;
}
/* ADDED BY OCTOBERCOMMS */
// Shortcode for page title [pagetitle]
function ac_page_title_text_shortcode() {
    $qid = get_queried_object_id();
    $title = $qid ? get_the_title( $qid ) : '';
    if ( '' === trim( $title ) ) {
        $title = get_bloginfo( 'name' );
    }
    return esc_html( $title );
}
add_shortcode( 'pagetitle', 'ac_page_title_text_shortcode' );
add_filter( 'gform_field_value_pagetitle', function() {
    $qid = get_queried_object_id();
    $title = $qid ? get_the_title( $qid ) : '';
    if ( '' === trim( $title ) ) {
        $title = get_bloginfo( 'name' );
    }
    return esc_html( $title );
} );
/**
 * Append “(x seater)” to Dining-Table product titles
 * everywhere except Checkout and Admin.
 */
add_filter( 'the_title',                    'ac_append_seats_to_title', 10, 2 );
add_filter( 'woocommerce_product_get_name', 'ac_append_seats_to_title', 10, 2 );
function ac_append_seats_to_title( $title, $maybe_product_or_id ) {
    /* ---- don’t touch Admin or Checkout ---- */
    if ( is_admin() || is_checkout() ) {
        return $title;
    }
    /* ---- get a WC_Product object either way ---- */
    $product = is_a( $maybe_product_or_id, 'WC_Product' )
             ? $maybe_product_or_id
             : wc_get_product( $maybe_product_or_id );
    if ( ! $product ) {
        return $title;
    }
    /* ---- scope strictly to Dining-Table category ----
       (adjust slugs if yours differ)                      */
    if ( ! has_term( [ 'dining-table', 'dining-tables' ], 'product_cat', $product->get_id() ) ) {
        return $title;
    }
    /* ---- avoid double-adding ---- */
    if ( stripos( $title, 'seater' ) !== false ) {
        return $title;
    }
    /* ---- find the first occurrence of something like
            2.0m | 2M | 1,5 m |  1 m  (dot/comma/space/case-insensitive) ---- */
    $pattern = '/(\d+(?:[.,]\d+)?)\s*[mM]\b/';
    if ( ! preg_match( $pattern, $title, $match ) ) {
        return $title;                // no length found → leave untouched
    }
    /* ---- normalise the length → float ---- */
    $length_metres = floatval( str_replace( ',', '.', $match[1] ) );
    /* ---- calculate seating capacity
       Rule of thumb: 600 mm per diner along each long side + 1 per end ---- */
    $seats_per_side = max( 1, floor( $length_metres / 0.6 ) );   // never less than one per side
    $total_seats    = $seats_per_side * 2 + 2;
    /* ---- append to the matched bit & splice back in ---- */
    $replacement = $match[0] . ' (' . $total_seats . ' seater)';
    $title       = preg_replace( $pattern, $replacement, $title, 1 );
    return $title;
}
// WooCommerce Shipping Calculated after Coupon
add_filter( 'woocommerce_shipping_free_shipping_is_available', 'filter_shipping', 10, 2 );
function filter_shipping( $is_available, $package ) {
	if ( WC()->cart->prices_include_tax )
		$total = WC()->cart->cart_contents_total + array_sum( WC()->cart->taxes );
	else
		$total = WC()->cart->cart_contents_total;
	$total = $total - ( WC()->cart->get_order_discount_total() + WC()->cart->get_cart_discount_total() );
	// You can hardcode the number or get the setting from the shipping method
	$shipping_settings = get_option('woocommerce_free_shipping_settings');
	$min_total = $shipping_settings['min_amount'] > 0 ? $shipping_settings['min_amount'] : 0;
	if ( 50 > $total ) {
		$is_available = false;
	}
	return $is_available;
}
// This basically recalculates totals after the discount has been added
add_action( 'woocommerce_calculate_totals', 'change_shipping_calc' );
function change_shipping_calc( $cart ) {
	$packages = WC()->cart->get_shipping_packages();
	// Calculate costs for passed packages
	$package_keys 		= array_keys( $packages );
	$package_keys_size 	= sizeof( $package_keys );
	for ( $i = 0; $i < $package_keys_size; $i ++ ) {
		unset( $packages[ $package_keys[ $i ] ]['rates'] );
		$package_hash   = 'wc_ship_' . md5( json_encode( $packages[ $package_keys[ $i ] ] ) );
		delete_transient( $package_hash );
	}
	// Calculate the Shipping
	$cart->calculate_shipping();
	// Trigger the fees API where developers can add fees to the cart
	$cart->calculate_fees();
	// Total up/round taxes and shipping taxes
	if ( $cart->round_at_subtotal ) {
		$cart->tax_total          = $cart->tax->get_tax_total( $cart->taxes );
		$cart->shipping_tax_total = $cart->tax->get_tax_total( $cart->shipping_taxes );
		$cart->taxes              = array_map( array( $cart->tax, 'round' ), $cart->taxes );
		$cart->shipping_taxes     = array_map( array( $cart->tax, 'round' ), $cart->shipping_taxes );
	} else {
		$cart->tax_total          = array_sum( $cart->taxes );
		$cart->shipping_tax_total = array_sum( $cart->shipping_taxes );
	}
	// VAT exemption done at this point - so all totals are correct before exemption
	if ( WC()->customer->is_vat_exempt() ) {
		$cart->remove_taxes();
	}
}
add_filter( 'woocommerce_table_rate_query_rates_args', 'filter_shipping_2', 10 );
function filter_shipping_2( $arguments ) {
	if ( WC()->cart->prices_include_tax )
		$total = WC()->cart->cart_contents_total + array_sum( WC()->cart->taxes );
	else
		$total = WC()->cart->cart_contents_total;
	$total = $total - ( WC()->cart->get_order_discount_total() + WC()->cart->get_cart_discount_total() );
	$arguments['price'] = $total;
	return $arguments;
}
if( function_exists('acf_add_options_page') ) {
	acf_add_options_page();
}
//add variation sale strikethrough with original price on shop and category pages
function wc_wc20_variation_price_format( $price, $product ) {
// Main Price
	$prices = array( $product->get_variation_price( 'min', true ), $product->get_variation_price( 'max', true ) );
	$price_min = $prices[0] !== $prices[1] ? sprintf( __( '%1$s', 'woocommerce' ), wc_price( $prices[0] ) ) : wc_price( $prices[0] );
	$price_max = $prices[0] !== $prices[1] ? sprintf( __( '%1$s', 'woocommerce' ), wc_price( $prices[1] ) ) : wc_price( $prices[1] );
// Sale Price
	$prices = array( $product->get_variation_regular_price( 'min', true ), $product->get_variation_regular_price( 'max', true ) );
	sort( $prices );
	$saleprice_min = $prices[0] !== $prices[1] ? sprintf( __( '%1$s', 'woocommerce' ), wc_price( $prices[0] ) ) : wc_price( $prices[0] );
	$saleprice_max = $prices[0] !== $prices[1] ? sprintf( __( '%1$s', 'woocommerce' ), wc_price( $prices[1] ) ) : wc_price( $prices[1] );
	if ( $price_min !== $saleprice_min ) {
    if($saleprice_min !=$saleprice_max){
		$price = '<del>' . $saleprice_min . ' - '. $saleprice_max . '</del><br><ins>' . $price_min . ' - '. $price_max . '</ins>';
  }else{
    	$price = '<del>' . $saleprice_min . '</del> <ins>' . $price_min . '</ins>';
  }
	}
	return $price;
}
add_filter( 'woocommerce_variable_sale_price_html', 'wc_wc20_variation_price_format', 10, 2 );
add_filter( 'woocommerce_variable_price_html', 'wc_wc20_variation_price_format', 10, 2 );
/***
REDIRECT USERS TO DIFFERENT HOMEPAGE FOR THEIR CONUTRY
***/
function ls_geo_locate_redirects(){
$location = WC_Geolocation::geolocate_ip();
$country = $location['country'];
$eu_countries = array(
    'AL', 'AD', 'AM', 'AT', 'BY', 'BE', 'BA', 'BG', 'CH', 'CY', 'CZ', 'DE',
    'DK', 'EE', 'ES', 'FO', 'FI', 'FR', 'GE', 'GI', 'GR', 'HU', 'HR',
    'IE', 'IS', 'IT', 'LI', 'LT', 'LU', 'LV', 'MC', 'MK', 'MT', 'NO', 'NL', 'PL',
    'PT', 'RO', 'RU', 'SE', 'SI', 'SK', 'SM', 'TR', 'UA', 'VA',
);
if( in_array($country,$eu_countries)){
  $country = 'EUR';
}
    if($country =="US"){
    $us_page=get_field('us_version_page');
        if($us_page !='' && !current_user_can('administrator')){
            $redirect=get_permalink($us_page);
            wp_redirect(get_permalink( $us_page[0]->ID ));
            exit;
        }
    }
    if(is_page('clearance')){
        if($country =="US" || $country =="EUR"){
            wp_redirect('/');
            exit;
        }
    }
}//ls_geo_locate_redirects
add_action( 'template_redirect', 'ls_geo_locate_redirects' );
add_action( 'wp', 'my_project_wc_change_hooks' );
function my_project_wc_change_hooks() {
  remove_action( 'woocommerce_checkout_terms_and_conditions', 'wc_checkout_privacy_policy_text', 20 );
  remove_action( 'woocommerce_checkout_terms_and_conditions', 'wc_terms_and_conditions_page_content', 30 );
}
/******************************************************************************/
/* Post Navigation Single *****************************************************/
/******************************************************************************/
if ( ! function_exists( 'ls_navigation_between_posts' ) ) :
function ls_navigation_between_posts() {
    // Don't print empty markup if there's nowhere to navigate.
	$previous = ( is_attachment() ) ? get_post( get_post()->post_parent ) : get_adjacent_post( true, '', true,'category' );
	$next     = get_adjacent_post( true, '', false,'category' );
	if ( ! $next && ! $previous ) return;
    ?>
    <div class="row">
        <div class="large-12 columns">
            <nav class="navigation_between_posts" >
                <?php $prevPost = get_previous_post(true);
                    if (!empty($prevPost->ID)) {
                        $prevthumbnail = get_the_post_thumbnail($prevPost->ID, array(150,150) );
                        previous_post_link( '<div class="nav-previous">%link'.$prevthumbnail.'</div>', '',true );
                    } ?>
                <?php
                    $nextPost = get_next_post(true);
                    if (!empty($nextPost->ID)) {
                        $nextthumbnail = get_the_post_thumbnail($nextPost->ID, array(150,150) );
                        next_post_link( '<div class="nav-next">%link '.$nextthumbnail.'</div>', '',true );
                    } ?>
                <?php previous_post_link( '<div class="nav-previous-mobile">%link</div>', '&laquo; prev',true ); ?>
                <?php next_post_link( '<div class="nav-next-mobile">%link</div>', 'next &raquo;',true ); ?>
            </nav>
        </div>
    </div>
<?php
}//ls_navigation_between_posts
endif;
/****
ADD Custom fields to menus
****/
add_image_size( 'menu-image', 175,220, true ); // 220 pixels wide by 180 pixels tall, soft proportional crop mode
add_filter('wp_nav_menu_objects', 'my_wp_nav_menu_objects', 10, 2);
function my_wp_nav_menu_objects( $items, $args ) {
    // loop
    foreach( $items as $item ) {
       // print_r($item);
        // vars
        $image = get_field('dropdown_image', $item);
        // append icon
        if( $image ) {
            $item->title = '<img src="'.$image['sizes']['menu-image'].'"/>';
        }
    }
    // return
    return $items;
}
/***
ADD WIDGET AREAS
****/
if ( function_exists('register_sidebar') ){
    register_sidebar(array(
        'name' => 'Footer Widget Area 2',
        'id'            => 'footer-2',
        'before_widget' => '<li class = "widget">',
        'after_widget' => '</li>',
        'before_title' => '<h4 class="widget-title
        ">',
        'after_title' => '</h4>',
        )
    );
    register_sidebar(array(
        'name' => 'Footer Widget Area 3',
        'id'            => 'footer-3',
        'before_widget' => '<li class = "widget">',
        'after_widget' => '</li>',
        'before_title' => '<h4 class="widget-title
        ">',
        'after_title' => '</h4>',
      )
    );
    register_sidebar(array(
        'name' => 'Footer Widget Area 4',
        'id'            => 'footer-4',
        'before_widget' => '<li class = "widget">',
        'after_widget' => '</li>',
        'before_title' => '<h4 class="widget-title
        ">',
        'after_title' => '</h4>',
      )
    );
    register_sidebar(array(
        'name' => 'Footer Widget Area 5',
        'id'            => 'footer-5',
        'before_widget' => '<li class = "widget">',
        'after_widget' => '</li>',
        'before_title' => '<h4 class="widget-title
        ">',
        'after_title' => '</h4>',
      )
    );
    register_sidebar(array(
        'name' => 'Trade Footer 1',
        'id'            => 'trade-footer-1',
        'before_widget' => '<li class = "widget">',
        'after_widget' => '</li>',
        'before_title' => '<h4 class="widget-title
        ">',
        'after_title' => '</h4>',
      )
    );
    register_sidebar(array(
        'name' => 'Trade Footer 2',
        'id'            => 'trade-footer-2',
        'before_widget' => '<li class = "widget">',
        'after_widget' => '</li>',
        'before_title' => '<h4 class="widget-title
        ">',
        'after_title' => '</h4>',
      )
    );
    register_sidebar(array(
        'name' => 'Trade Footer 3',
        'id'            => 'trade-footer-3',
        'before_widget' => '<li class = "widget">',
        'after_widget' => '</li>',
        'before_title' => '<h4 class="widget-title
        ">',
        'after_title' => '</h4>',
      )
    );
    register_sidebar(array(
        'name' => 'Trade Footer 4',
        'id'            => 'trade-footer-4',
        'before_widget' => '<li class = "widget">',
        'after_widget' => '</li>',
        'before_title' => '<h4 class="widget-title
        ">',
        'after_title' => '</h4>',
      )
    );
}
/****
SINGLE PRODUCT PAGE
*****/
//add_action('woocommerce_before_add_to_cart_form','ls_next_batch',20);
function ls_next_batch(){
    global $product;
    if ( $product->get_id() == 175449 ) {
        echo'<div class="next-batch">';
            echo'<p class="next-toggle">Next batch coming in January</p>';
            echo'<div>';
                echo'<a href="#" id="reserve-toggle" class="another_btn">Reserve Now</a>';
            echo'</div>';
            echo'<div class="reserve-popup" style="display:none;">';
                echo'<div class="inner">';
                    echo do_shortcode('[gravityform id="7" title="false" description="false" ajax="true"]');
                echo'</div>';
            echo'</div>';
        echo'</div>';
    }
}
/**
 * Trim zeros in price decimals
 **/
add_filter( 'woocommerce_price_trim_zeros', '__return_true' );
/**
 * Limit WooCommerce Short Description Field
 */
add_filter( 'woocommerce_short_description', 'prefix_filter_woocommerce_short_description' );
function prefix_filter_woocommerce_short_description( $post_post_excerpt ) {
    // make filter magic happen here...
    if(is_product() ) { // add in conditionals
        $text = $post_post_excerpt;
        $words = 30; // change word length
        $more = '…  <a class="product-read-more" href="#description">Read More</a>'; // add a more cta
        $post_post_excerpt = wp_trim_words( $text, $words, $more );
    }
    return $post_post_excerpt;
};
//==============================================================================
// WooCommerce Breadcrumb
//==============================================================================
function ls_custom_breadcrumb($defaults) {
    $defaults['delimiter'] = '<span> > </span>';
    $defaults['wrap_before'] = '<nav class="woocommerce-breadcrumb">';
    return $defaults;
}
add_filter( 'woocommerce_breadcrumb_defaults', 'ls_custom_breadcrumb',100 );
//Yoast Breadcrumbs
add_filter( 'wpseo_breadcrumb_single_link' ,'wpseo_remove_breadcrumb_link', 10 ,2);
function wpseo_remove_breadcrumb_link( $link_output , $link ){
    if( $link['text'] == 'Products' ) {
      $link_output = '';
    }
    if( $link['text'] == 'Home' ) {
      $link_output = '';
    }
    return $link_output;
}
//add_filter( 'wpseo_breadcrumb_links', 'jj_wpseo_breadcrumb_links' );
function jj_wpseo_breadcrumb_links( $links ) {
	//pk_print( sizeof($links) );
	if( sizeof($links) > 1 ){
		array_pop($links);
	}
	return $links;
}
//Add Body Classes
function ls_body_classes( $classes ) {
    if(  current_user_can('administrator') ) {
        $classes[] = 'admin-login';
    }
    if ( get_current_user_id() === 96 ) {
        $classes[] = 'dev-visible';
    }
  $location = WC_Geolocation::geolocate_ip();
  $country = $location['country'];
  if($country !='GB'){
    $classes[] = 'notUK';
  }
  if($country =='US'){
    $classes[] = 'US_user';
  }
  if(isset($_COOKIE['aelia_customer_country'])){
    $country = $_COOKIE['aelia_customer_country'];
    if($country =='US'){
      $classes[] = 'US_user';
    }
  }
  $eu_countries = array(
      'AL', 'AD', 'AM', 'AT', 'BY', 'BE', 'BA', 'BG', 'CH', 'CY', 'CZ', 'DE',
      'DK', 'EE', 'ES', 'FO', 'FI', 'FR', 'GE', 'GI', 'GR', 'HU', 'HR',
      'IE', 'IS', 'IT', 'LI', 'LT', 'LU', 'LV', 'MC', 'MK', 'MT', 'NO', 'NL', 'PL',
      'PT', 'RO', 'RU', 'SE', 'SI', 'SK', 'SM', 'TR', 'UA', 'VA',
  );
  if( in_array($country,$eu_countries)){
    $classes[] = 'EU_user';
  }
$trade=get_field('is_this_a_trade_page');
  $banner=get_field('make_banner_visible','option');
  $bannerUK=get_field('show_in_uk','option');
  $bannerUS=get_field('show_in_us','option');
  $bannerEU=get_field('show_in_eu','option');

  if($banner !=0  AND  $trade !=true   AND !is_post_type_archive('trade_collection') AND !is_singular('trade_collection') AND !is_tax('trade_product_category') AND !is_category() AND !is_singular('post')) {
    if( $bannerUK ==1  && $country ='GB'){
        $classes[] = 'show_banner';
    }
    if( $bannerUS ==1  && $country ='US'){
        $classes[] = 'show_banner';
    }
    if( $bannerEU ==1  && in_array($country,$eu_countries)){
        $classes[] = 'show_banner';
    }
  }
  if($trade ==true   OR is_post_type_archive('trade_collection') OR is_singular('trade_collection') OR is_tax('trade_product_category') OR is_category() OR is_singular('post')){
    $classes[] = 'tradepage';
  }
  if( is_singular( 'product' ) )
  {
    $custom_terms = get_the_terms(0, 'product_cat');
    if ($custom_terms) {
      foreach ($custom_terms as $custom_term) {
        $classes[] = 'product_cat_' . $custom_term->slug;
      }
    }
  }
    return $classes;
}
add_filter( 'body_class','ls_body_classes' );
//Disable the cart and replace with message for products not available in US / EU
add_filter( 'woocommerce_get_price_html', 'ls_hide_price_if_product_disabled', 9999, 2 );

function ls_hide_price_if_product_disabled( $price, $product ) {
  $hide=0;

  if(isset($_COOKIE['aelia_cs_selected_currency'])){
    $country = $_COOKIE['aelia_cs_selected_currency'];
    if($country =='USD'){
        if($product->get_meta('hide_usa') ==1){
            $hide=1;
        }
        $parent_product = wc_get_product($product->get_parent_id());
        if($parent_product){
            if($parent_product->get_meta('hide_usa') ==1){
                $hide=1;
            }
        }
    }//if usa
    if($country =='EUR'){
           if($product->get_meta('hide_eu') ==1){
               $hide=1;
           }
           $parent_product = wc_get_product($product->get_parent_id());
           if($parent_product){
               if($parent_product->get_meta('hide_eu') ==1){
                   $hide=1;
               }
           }
       }//if eu
    if($hide==1){
        $price = '<p class="not-available-product-text">Sorry, this product is not available in your region</p>';
        remove_action( 'woocommerce_after_shop_loop_item', 'woocommerce_template_loop_add_to_cart', 10 );
        remove_action( 'woocommerce_single_product_summary', 'woocommerce_template_single_add_to_cart', 30 );
        add_filter( 'woocommerce_is_purchasable', '__return_false' );
    }
  }//if cookie set
    return $price;
}//ls_hide_price_if_product_disabled
//Hide products from archive / search if not available in the US/EU
add_action( 'pre_get_posts', 'ls_overseas_product_query' );
function ls_overseas_product_query( $q ) {
    if ( (! is_admin() && $q->is_main_query()) && (is_shop() || is_product_category()  ||  is_product_tag()
 || is_search()) ) {
         // Do your cart logic here
        if(isset($_COOKIE['aelia_cs_selected_currency'])){
          $country = $_COOKIE['aelia_cs_selected_currency'];

          if($country =='USD'){
            $meta_query = array(
                     'relation' => 'OR',
                      array(
                        'key'     => 'hide_usa',
                        'value'   => 1,
                        'compare' => '!=',
                      ),
                      array(
                        'key'     => 'hide_usa',
                        'compare' => 'NOT EXISTS',
                      ),
                    );
            $q->set( 'meta_query', $meta_query      );
          }
          if($country =='EUR'){
           $meta_query = array(
                                'relation' => 'OR',
                                 array(
                                   'key'     => 'hide_eu',
                                   'value'   => 1,
                                   'compare' => '!=',
                                 ),
                                 array(
                                   'key'     => 'hide_eu',
                                   'compare' => 'NOT EXISTS',
                                 ),
                               );
            $q->set( 'meta_query', $meta_query      );
          }
        }//if cookie set
    }//if not admin
 }//ls_overseas_product_query
//Redirect product archives if hidden in US/EU
 add_action( 'template_redirect', 'hidden_archives_redirect' );
function hidden_archives_redirect(){
    if(is_product_category()){
    if(isset($_COOKIE['aelia_cs_selected_currency'])){
       $country = $_COOKIE['aelia_cs_selected_currency'];
            $queried_object = get_queried_object();
             if($country =='USD'){
                $hide = get_field('hide_usa',$queried_object);
                if($hide==1){
                    wp_redirect( '/' );
                    exit;
                }
             }//USA
             if($country =='EUR'){
                $hide = get_field('hide_eu',$queried_object);
                if($hide==1){
                    wp_redirect( '/' );
                    exit;
                }
             }//USA
         }//if cookie set
    }//if category
}//hidden_archives_redirect
 function stockist_func( $atts ) {
   $r='';
   $args_query = array(
   	'post_type' => array('wpsl_stores'),
   	'posts_per_page' => -1,
   	'nopaging' => true,
   	'order' => 'ASC',
   	'orderby' => array('meta_value' =>'ASC', 'menu_order' => 'ASC'),
   	'meta_key' => 'wpsl_country',
   );
   $query = new WP_Query( $args_query );
   if ( $query->have_posts() ) {
     $r.='<div class="stockist-wrap">';
     $count=1;
   	while ( $query->have_posts() ) {
   		$query->the_post();
      $terms = get_the_terms( get_the_ID(), 'wpsl_store_category' );
      if ( $terms && ! is_wp_error( $terms ) ) :
          $cats = array();
          foreach ( $terms as $term ) {
              $cats[] = $term->name;
          }
          $catstring = join( ", ", $cats );
        endif;
      if($count==1){
        $currentc=get_post_meta( get_the_id(), 'wpsl_country', true );
        $r.='<div class="country-wrap">';
        $r.='<h4><strong>'.$currentc.'</strong></h4>';
      }
      $thisc=get_post_meta( get_the_id(), 'wpsl_country', true );
      if($thisc !=$currentc){
        $r.='</div>';
        $r.='<div class="country-wrap">';
        $r.='<h4><strong>'.$thisc.'</strong></h4>';
        $currentc=$thisc;
      }
      $add=get_post_meta( get_the_id(), 'wpsl_address', true );
      $city=get_post_meta( get_the_id(), 'wpsl_city', true );
      $zip=get_post_meta( get_the_id(), 'wpsl_zip', true );
      $r.='<p><strong>'.get_the_title().'</strong><br>';
      if($add !=''){ $r.=$add.'<br>'; }
      if($city !=''){ $r.=$city.'<br>'; }
      if($zip !=''){ $r.=$zip.'<br>'; }
      $r.='T: <a href="tel:'.get_post_meta( get_the_id(), 'wpsl_phone', true ).'">'.get_post_meta( get_the_id(), 'wpsl_phone', true ).'</a><br>';
      $r.='W: <a target="_blank" href="//'.get_post_meta( get_the_id(), 'wpsl_url', true ).'">'.get_post_meta( get_the_id(), 'wpsl_url', true ).'</a><br>';
      $r.='<span class="catlist">'.$catstring.'</span></p>';
      $count++;
   	}
    $r.='</div>';
    $r.='</div>';
   }
   wp_reset_postdata();
 	return $r;
 }
 add_shortcode( 'stockists', 'stockist_func' );
  //Change the trade collection url to include the category of the product.
  function change_link( $post_link, $id = 0 ) {
      $post = get_post( $id );
      if( $post->post_type == 'trade_collection' )
      {
         if ( is_object( $post ) ) {
            $terms = wp_get_object_terms( $post->ID, array('trade_product_category') );
            if ( $terms ) {
               return str_replace( '%cat%', $terms[0]->slug, $post_link );
           }else{
             return str_replace( '%cat%', 'product',$post_link  );
           }
        }
      }
      return   $post_link ;
  }
  add_filter( 'post_type_link', 'change_link', 1, 3 );
  //load the template on the new generated URL otherwise you will get 404's the page
  function generated_rewrite_rules() {
     add_rewrite_rule(
         '^trade-services/trade_collection/(.*)/(.*)/?$',
         'index.php?post_type=trade_collection&name=$matches[2]',
         'top'
     );
  }
  add_action( 'init', 'generated_rewrite_rules', 10, 0);
  //Remove the need for pagination on trade-collection
  function trade_collection_posts_per_page( $query ) {
    if ( ! is_admin() && $query->is_main_query()){
      if(is_post_type_archive( 'trade_collection' ) OR is_tax( 'trade_product_category' ) ) {
        // Display 50 posts for a custom post type called 'movie'
        $query->set( 'posts_per_page', -1 );
        return;
    }
  }
}
add_action( 'pre_get_posts', 'trade_collection_posts_per_page', 1 );
function new_user_role() {
    //add the new user role
    add_role(
        'trade_user',
        'Trade',
        array(
            'read'         => true,
            'delete_posts' => false
        )
    );
}
add_action('admin_init', 'new_user_role');
function ls_trade_login_redirect( $redirect_to, $request, $user ) {
    //is there a user to check?
    if (isset($user->roles) && is_array($user->roles)) {
        //check for subscribers
        if (in_array('trade_user', $user->roles)) {
            // redirect them to another URL, in this case, the homepage
            $redirect_to =  '/trade-services/trade-account/';
        }
    }
    return $redirect_to;
}
add_filter('login_redirect', 'ls_trade_login_redirect',10,3);
function trade_sections_redirect(){
$tradeuser=0;
$uid =get_current_user_id();
$user = new WP_User( $uid );
if ( ! empty( $user->roles ) && is_array( $user->roles ) && in_array( 'trade_user', $user->roles ) ) {
    $tradeuser=1;
}
if((is_page(160812) OR is_page(161180) OR get_field('user_must_be_logged_in')==1) && ($tradeuser !=1 && !current_user_can('administrator'))) {
  wp_redirect( '/trade-users-only/' );
  exit;
}
//redirect from main trade page to logged in trade page if user logged in.
if(is_user_logged_in() && $tradeuser==1 && !current_user_can('administrator') && is_page('trade-services')  ){
    wp_redirect( '/trade-services/download-3d-files/' );
      exit;
}
}//trade_sections_redirect
add_action( 'template_redirect', 'trade_sections_redirect' );
function my_custom_login() {
    echo '<link rel="stylesheet" type="text/css" href="' . get_bloginfo('stylesheet_directory') . '/login.css" />';
}
add_action('login_head', 'my_custom_login');
function my_login_logo_url() {
    return get_bloginfo( 'url' );
}
add_filter( 'login_headerurl', 'my_login_logo_url' );
function my_login_logo_url_title() {
    return 'Another Country';
}
add_filter( 'login_headertitle', 'my_login_logo_url_title' );
add_shortcode('pro_login','pro_login_func');
function pro_login_func(){
$r='';
if(is_user_logged_in()){
  $r.='<a id="trade-login-link" href="/trade-services/trade-account/">Your Trade Account</a>';
}else{
  $r.='<a id="trade-login-link" href="/wp-login.php">Login</a>';
}
  return $r;
}
add_action('woocommerce_after_cart','mobile_help',10);
function mobile_help(){
    echo '<div class="cart-questions-wrap mobile">';
        echo'<h3>Do you have a question or need help with this order?</h3>';
        echo'<a class="another_btn transparent" href="mailto:sales@anothercountry.com">Email Our Team</a>';
    echo'</div>';
}
add_action('woocommerce_after_cart_table','heal_text_basket',10);
function heal_text_basket(){
    echo '<div class="cart-questions-wrap">';
        echo'<h3>Do you have a question or need help with this order?</h3>';
        echo'<a class="another_btn transparent" href="mailto:sales@anothercountry.com">Email Our Team</a>';
    echo'</div>';
  //AC
     $ac_product_id = 164943; //cteals donation produx
     $ac_product_cart_id = WC()->cart->generate_cart_id( $ac_product_id );
     $ac_in_cart = WC()->cart->find_product_in_cart( $ac_product_cart_id );
  //CUST
     $cust_product_id = 164941; //cteals donation produx
     $cust_product_cart_id = WC()->cart->generate_cart_id( $cust_product_id );
     $cust_in_cart = WC()->cart->find_product_in_cart( $cust_product_cart_id );
     if ( $ac_in_cart ) {
       $ac_checked = 'checked';
     }
     else{
       $ac_checked = '';
     }
     if ( $cust_in_cart ) {
       $cust_checked = 'checked';
     }
     else{
       $cust_checked = '';
     }
  echo '<div class="heal-wrap">';
  echo'<img src="/wp-content/themes/merchandiser-child/images/Heal_logo.png" alt="Heal Rewilding" title="Heal Rewilding"/>';
  echo'<h3>Support Heal Rewilding for £10 and we\'ll match your donation</h3>';
  echo'<p class="read-more">Read more</p>';
      echo'<div class="read-more-wrap">';
          echo'<p>Heal is a UK charity taking action in response to the climate and biodiversity emergency by buying land in the English lowlands and giving it back to nature. You can support their acquisition of land for rewilding by sponsoring a 3m x 3m plot. These cost £20 to sponsor, so if you donate £10, we\'ll match your donation to cover the cost. </p>';
          echo'<p class="heal-check-wrap"><input type="checkbox" '.$cust_checked.' id="support-heal-cust" class="heal-checkbox" name="Support Heal"/> Sponsor a Heal 3x3 plot <strong>in your name</strong>. We will share your name & email address with Heal so they can update you about your plot.</p>';
          echo'<p class="heal-check-wrap"><input type="checkbox" '.$ac_checked.' id="support-heal-ac" class="heal-checkbox" name="Support Heal"/>Sponsor a Heal 3x3 plot <strong>anonymously</strong>. Your details will not be shared with Heal and you will not be contacted about your donation.</p>';
          echo'<p><a href="/heal-rewilding/" class="another_btn" target="_blank">More info</a></p>';
      echo'</div>';
  echo'</div>';
}
function ajax_heals_func(){
  $val=$_POST['checkval'];
  $healtype=$_POST['healtype'];
//if already in cart, set var.
//AC
   $ac_product_id = 164943; //cteals donation produx
   $ac_product_cart_id = WC()->cart->generate_cart_id( $ac_product_id );
   $ac_in_cart = WC()->cart->find_product_in_cart( $ac_product_cart_id );
//CUST
   $cust_product_id = 164941; //cteals donation produx
   $cust_product_cart_id = WC()->cart->generate_cart_id( $cust_product_id );
   $cust_in_cart = WC()->cart->find_product_in_cart( $cust_product_cart_id );
  if($val ==1){//add prouct
    if($healtype =='support-heal-ac'){
      WC()->cart->add_to_cart( $ac_product_id );
      WC()->cart->remove_cart_item( $cust_in_cart );
    }
    if($healtype =='support-heal-cust'){
      WC()->cart->add_to_cart( $cust_product_id );
      WC()->cart->remove_cart_item( $ac_in_cart );
    }
  }//if we are adding a product
  if($val ==0 ){// if we are removing proucts
    if ( $ac_in_cart ) {
    WC()->cart->remove_cart_item( $ac_in_cart );
    }
    if ( $cust_in_cart ) {
    WC()->cart->remove_cart_item( $cust_in_cart );
    }
  }
  die;
}//ajax_heals_func
add_action( 'wp_ajax_ajax_heals', 'ajax_heals_func' );
 add_action( 'wp_ajax_nopriv_ajax_heals', 'ajax_heals_func' );
//first check if its the right archive.  if so then add the action to show the stock.
 add_action( 'woocommerce_before_main_content', 'check_the_taxonomy', 10 );
 function check_the_taxonomy(){
   //Show extra category boxes
   $term = get_queried_object();
   if( have_rows('boxes',$term) ):
       echo'<div class="extra-cat-boxes">';
    while( have_rows('boxes',$term) ) : the_row();
        $title = get_sub_field('box_title');
        $img = get_sub_field('box_image');
        $url = get_sub_field('box_url');
      echo'<a href="'.$url.'" class="cat-box">';
      echo'<img src="'.$img["sizes"]["woocommerce_thumbnail"].'" title="'.$title.'" alt="'.$title.'"/>';
      echo'<div class="cat-box-title">'.$title.'</div>';
      echo'</a>';
    endwhile;
    echo'</div>';
  endif;
   //Trigger show stock
   $term = get_term_by( 'slug', get_query_var( 'term' ), get_query_var( 'taxonomy' ) );
   $ancestors = array();
   if ( $term && ! is_wp_error( $term ) && isset( $term->term_id ) ) {
      $ancestors = get_ancestors( $term->term_id, 'product_cat', 'taxonomy' );
   }
    if(is_product_category( 'accessories' ) OR in_array(33,$ancestors)) {
      add_action( 'woocommerce_before_shop_loop_item_title', 'ls_show_stock', 100 );
    }
 }//check_the_taxonomy
function ls_show_stock(){
  global $product;
  echo'<span class="stock-status">';
  if ( $product->is_in_stock() ) {
       echo 'In stock';
   } else {
       echo 'Out of stock';
   }
  echo'</span>';
}//ls_show_stock
add_shortcode('ls_related_products','ls_related_products_func');
function ls_related_products_func(){
  $r='';
  $product_string='';
  $related_products = get_field('related_products');
    if( $related_products ):
      $r.='<div class="ls_related_wrap">';
      foreach( $related_products as $post ):
        setup_postdata($post);
        $product_string.=$post.', ';
      endforeach;
      wp_reset_postdata();
      $r.= do_shortcode('[products ids="'.$product_string.'" columns="4" orderby="date"] ');
      $r.='</div>'; //related wrap
    endif;
  return $r;
}//ls_related_products
function ls_register_nav_menu(){
       register_nav_menus( array(
           'trade_menu' => __( 'Trade Menu', 'Woocommerce' ),
           'mobile_menu' => __( 'Mobile Menu', 'Woocommerce' ),
           'us_menu' => __( 'US Menu', 'Woocommerce' ),
           'us_mobile' => __( 'US Mobile Menu', 'Woocommerce' ),
       ) );
   }
   add_action( 'after_setup_theme', 'ls_register_nav_menu', 0 );
   add_filter( 'woocommerce_cart_needs_shipping', '__return_true' );
   add_filter( 'woocommerce_cart_no_shipping_available_html', 'change_noship_message' );
   add_filter( 'woocommerce_no_shipping_available_html', 'change_noship_message' );
   function change_noship_message() {
//echo '<div class="international-shipping-popup">Please <a href="/shop-contact/" target="_blank">contact us</a> for a shipping quote. Thank you</div>';
   }
   add_action('woocommerce_before_shipping_calculator','shipping_gform',1);
   add_action('woocommerce_after_checkout_form','shipping_gform',1);
   function shipping_gform(){
      echo '<div class="shipping_form_wrap">'.do_shortcode('[gravityform id="4" title="false" description="false" ajax="false" tabindex="49" ]').'</div>';
    //echo'<div class="shipping_form_wrap">*</div>';
   }//shipping_gform
   /**
		 * Enhanced Ecommerce Google Analytics compatibility
		 */
			add_action( 'wp_loaded', function () {
				if ( class_exists( 'Enhanced_Ecommerce_Google_Analytics' ) ) {
					global $wp_filter;
					foreach ( $wp_filter['woocommerce_thankyou']->callbacks as $key => $val ) {
						if ( 10 !== $key ) {
							continue;
						}
						foreach ( $val as $innerkey => $innerval ) {
							if ( isset( $innerval['function'] ) && is_array( $innerval['function'] ) ) {
								if ( is_a( $innerval['function']['0'], 'Enhanced_Ecommerce_Google_Analytics_Public' ) ) {
									$Enhanced_Ecommerce_Google_Analytics = $innerval['function']['0'];
									remove_action( 'woocommerce_thankyou', array( $Enhanced_Ecommerce_Google_Analytics, 'ecommerce_tracking_code' ) );
									break;
								}
							}
						}
					}
				}
			}, 0 );
      /**
 * This snippet will stop purchase events to fire on thank you page
 **/
add_action( 'woocommerce_init', function () {
	//get all WooCommerce integrations
	$integrations = WC()->integrations->get_integrations();
	//checking if facebook for woocommerce installed?
	if ( isset( $integrations['facebookcommerce'] ) && $integrations['facebookcommerce'] instanceof WC_Facebookcommerce_Integration ) {
		/**
		 * For version < 1.1.0
		 */
		remove_action( 'woocommerce_thankyou', [
			$integrations['facebookcommerce']->events_tracker,
			'inject_gateway_purchase_event'
		], $integrations['facebookcommerce']->events_tracker::FB_PRIORITY_HIGH );
		/**
		 * For version >= 1.1.0
		 */
		remove_action( 'woocommerce_thankyou', [
			$integrations['facebookcommerce']->events_tracker,
			'inject_purchase_event'
		], 40 );
	}else{
		if ( function_exists('facebook_for_woocommerce') ) {
			$event_track = facebook_for_woocommerce()->get_integration()->events_tracker;
			/**
			 * For version >= 1.1.0
			 */
			remove_action( 'woocommerce_thankyou', [
				$event_track,
				'inject_purchase_event'
			], 40 );
			remove_action( 'woocommerce_checkout_update_order_meta', [
				$event_track,
				'inject_purchase_event'
			], 10 );
		}
	}
}, 999 );
add_filter('wffn_show_menu_upsell','__return_true');
/*** Geo locate users on the homepage, product archives or single product page***/
//Load the popup if the US cookie is set
function ls_US_popup() {
    if ( is_admin() ) {
        return;
    }
  if ( (is_front_page() || is_woocommerce()) && !isset($_COOKIE['ac_geo']) ) {
      //Geo locate
      $location = WC_Geolocation::geolocate_ip();
      $country = $location['country'];
      //If US then set the cookie
      if($country=='US'){
        $cookie_name = "ac_geo";
        $cookie_value = "US";
        setcookie($cookie_name, $cookie_value, time() + (86400 * 30), "/"); // 86400 = 1 day
          if(!isset($_COOKIE['geo-popup-close'])){
            echo '<div class="us-popup-wrap">';
            echo'<div class="inner">';
            echo get_field('intro_copy','options');
            echo'<div class="stockists-list">';
            if( have_rows('stockists','options') ):
              while( have_rows('stockists','options') ) : the_row();
                  $name = get_sub_field('name');
                  $url = get_sub_field('url');
                  echo'<a class="stockist-link" href="'.$url.'" target="_blank" title="'.$name.'">'.$name.'</a>';
              endwhile;
            endif;
            echo'</div>';
            echo'<a class=" button" title="proceed">CONTINUE TO UK SITE</a>';
          //  echo'<span class="or">OR</span>';
          //  echo'<a class=" button" href="/stockists/" title="stockists">Visit stockists in the US</a>';
            echo'</div>';
            echo'</div>';
          }
      } //is us
    }//is page
}//ls_US_popup
//add_action( 'wp_footer', 'ls_US_popup' );
add_action('woocommerce_after_add_to_cart_form','delivery_info_link',1,0);
function delivery_info_link(){
  global $product;
  $price = floatval(wc_get_price_including_tax( $product ))*100;
/***KLARNA****/
$amountclass = '';
if ( $product->is_type( 'variable' ) ) {
  $pricestr='';
}else{
  $amountclass="simple";
  $price=$product->get_price() / 3;
  $price=number_format((float)$price, 2, '.', '');
  $pricestr = '£'.$price;
}
if( has_term( array( 'armadillo', 'furniture','rose-cottage','outdoor-tables','outdoor-furniture','outdoor-benches','outdoor','office','living-room-furniture','kids-furniture','in-stock-furniture','dining-tables','dining-room','dining-chairs','desks','day-beds','console-tables','coffee-tables','chests','benches','beds','bedroom',
'armchairs','chairs-benches','mirrors	','task-chairs','tables','stools','sofas-armchairs-day-beds','sofas','sofa-beds','sideboard','side-tables','shelving' ), 'product_cat', $product->get_id() )) {
  //echo '*';
  echo '<div class="klarna-outer">';
  echo'<div class="another-klarna-wrap '.$amountclass.'">';
    echo'<p class="klarna-text">Make 3 payments with <span class="learn-more"><img src="/wp-content/themes/merchandiser-child/images/klarna.png"class="klarna-logo"/>Learn more</span></p>';
  echo'</div>';
  echo'<div style="display:none;" class="klarna-overlay"></div>';
  echo'<div style="display:none;" class="klarna-popup '.$amountclass.'">';
    echo'<div class="inner">';
      echo'<h4>Pay 3 instalments <span class="amountwrap">of <span class="amount">'.$pricestr.'</span></span></h4>';
      echo'<p>Pay in 3 interest-free instalments so you can spread the cost.</p>';
      echo'<ul>';
      echo'<li>Add item(s) to your cart</li>';
      echo'<li>Go to checkout and choose "Buy now, pay later with Klarna"</li>';
      echo'<li>Enter your debit or credit card information</li>';
      echo'<li>Pay later in 3 instalments. The first payment is taken when the order is processed and the remaining 2 are automatically taken every 30 days.</li>';
      echo'</ul>';
    //  echo'<span class="close">x</span>';
    echo'</div>';
  echo'</div>';
  echo'</div>';
}
    echo'<div class="carbon-netural">';
    echo'<a href="/sustainability/#carbon"><img src="/wp-content/uploads/AC_carbon_neutral_02.svg" title="Carbon Neutral"/></a>';
    echo'<p><a style="text-decoration:underline;" href="/sustainability/#carbon">We are B-Corp and Carbon Neutral</a></p>';
    echo'</div>';

}//delivery_info_link
add_action( 'woocommerce_before_add_to_cart_form', 'ls_swatches', 5 );
function ls_swatches(){
  if ( function_exists( 'ac_is_fabric_drawer_enabled' ) && ac_is_fabric_drawer_enabled() ) {
    return;
  }
  if( have_rows('swatches') ):
    echo '<select class="multiselect" id="swatches" multiple>';
      while( have_rows('swatches') ) : the_row();
          $image = get_sub_field('swatch_image');
          $name = get_sub_field('swatch_name');
          $hide=get_sub_field('hide');
          if($hide !=1){
          echo'<option  data-label="'.$name.'" data-value="'.$name.'" data-image="'.$image["url"].'">'.$name.'</option>';
          }
      endwhile;
      echo'</select>';
  endif;
}//ls_swatches
// Add a custom field before single add to cart
add_action( 'woocommerce_before_add_to_cart_button', 'custom_swatch_fields', 5 );
function custom_swatch_fields(){
	if ( function_exists( 'ac_is_fabric_drawer_enabled' ) && ac_is_fabric_drawer_enabled() ) {
		return;
	}
	if( have_rows('swatches') ){
    echo  '<input type="hidden" name="swatches" value="" id="swatches_hidden_input">';
	}
}//custom_swatch_fields
add_filter('woocommerce_add_cart_item_data', 'add_custom_swatch_data', 20, 2 );
function add_custom_swatch_data( $cart_item_data, $product_id ){
    if (isset($_POST['swatches'])){
    $swatches =  sanitize_text_field( $_POST['swatches'] );
    $cart_item_data['swatches'] = $swatches;
    }
    return $cart_item_data;
}//add_custom_field_data
add_filter('woocommerce_cart_item_name','add_custom_swatch_info_to_cart',1,3);
function add_custom_swatch_info_to_cart($product_name, $values, $cart_item_key ) {
    $return_string = $product_name;
    if ( ! empty( $values['swatches'] ) ) {
		$return_string .= '<br><strong>Swatches:</strong> <span class="cart-swatch">' . esc_html( $values['swatches'] ) . '</span>';
    }
    return $return_string;
}
add_action('woocommerce_add_order_item_meta','add_swatches_to_order_item_meta',1,2);
function add_swatches_to_order_item_meta($item_id, $values) {
    global $woocommerce,$wpdb;
    if ( ! empty( $values['swatches'] ) ) {
      wc_add_order_item_meta( $item_id, 'Swatches', $values['swatches'] );
    }
}
//Disable redirects
add_filter( 'wpseo_premium_post_redirect_slug_change', '__return_true' );
add_filter('Yoast\WP\SEO\post_redirect_slug_change', '__return_true' );
//Add  How did you hear about us to checkout
add_filter( 'woocommerce_before_order_notes', 'ls_how_did_you_hear' );

function ls_how_did_you_hear( $checkout ) {
    woocommerce_form_field( 'how_you_hear', array(
         'type' => 'select',
         'options'     => array(
                               'Recommended by a friend' => __('Recommended by a friend'),
                               'Came across you on Instagram / Facebook' => __('Came across you on Instagram / Facebook'),
                               'Planted Country Show<' => __('Planted Country” Show'),
                               'I’ve bought from you before' => __('I’ve bought from you before'),
                               'In a magazine/newspaper' => __('In a magazine/newspaper'),
                               'Google / Bing Search' => __('Google / Bing Search'),
                               'Saw your stand at an exhibition/trade show' => __('Saw your stand at an exhibition/trade show'),
                               'Through a stockist website' => __('Through a stockist website'),
                               'Worked with you on a trade project' => __('Worked with you on a trade project'),
                               'Visited your showroom' => __('Visited your showroom'),
                               'Other' => __('Other'),
             ),
         'class' => array( 'form-row-wide' ),
         'label' => 'How did you hear about us?',
         'required' => false,
      ), $checkout->get_value( 'how_you_hear' ) );
 }

 add_action( 'woocommerce_checkout_update_order_meta', 'ls_save_howyouhear_field' );

 function ls_save_howyouhear_field( $order_id ) {
     if ( $_POST['how_you_hear'] ) update_post_meta( $order_id, '_how_you_hear', esc_attr( $_POST['how_you_hear'] ) );
 }


 add_action( 'woocommerce_admin_order_data_after_billing_address', 'ls_show_new_howyouhear_order' );

 function ls_show_new_howyouhear_order( $order ) {
    $order_id = $order->get_id();
    if ( get_post_meta( $order_id, '_how_you_hear', true ) ) echo '<p><strong>How did you hear about us:</strong> ' . get_post_meta( $order_id, '_how_you_hear', true ) . '</p>';
 }
//Allow ACF to perform shortcodes in textareas
 add_filter('acf/format_value/type=textarea', 'do_shortcode');
 add_filter( 'woocommerce_single_product_carousel_options', 'filter_single_product_carousel_options' );
 function filter_single_product_carousel_options( $args ) {
     $args['animation']      = 'fade';
     $args['easing']         = 'swing';
     $args['controlNav']     = true;
     $args['slideshow']      = true;
     $args['touch']          = true;
     $args['animationSpeed'] = 1200;
     $args['slideshowSpeed'] = 3500;
     $args['animationLoop']  = true; // Breaks photoswipe pagination if true.
     $args['allowOneSlide']  = true;
     $args['prevText']       = "<";  // String - Set the text for the "previous" directionNav item
     $args['nextText']       = ">";  // String - Set the text for the "next" directionNav item
     $args['directionNav'] = true;
     return $args;
 }
 // Change 'Choose an option' to use attribute name to be more user friendly.
 // Inspired by: https://stackoverflow.com/a/34713246/8605943
 add_filter( 'woocommerce_dropdown_variation_attribute_options_args', 'am_change_option_none_text' );
 function am_change_option_none_text( $args ) {
    $args['show_option_none'] =  wc_attribute_label( $args[ 'attribute' ] );

    return $args;
 }
 add_filter( 'gettext', 'theme_change_text', 20, 3 );
 function theme_change_text( $translated_text, $text, $domain ) {
         switch ( $translated_text ) {

             case 'Returning customer?' :
                 $translated_text = __( '', 'woocommerce' );
                 break;
            case 'Have a coupon?' :
                $translated_text = __( '', 'woocommerce' );
                break;
            case 'Click here to enter your code' :
                $translated_text = __( 'Enter a coupon code', 'woocommerce' );
                break;
            case 'Click here to login' :
                $translated_text = __( 'Login to Account', 'woocommerce' );
                break;

         }

     return $translated_text;
 }
 add_filter( 'woocommerce_return_to_shop_redirect', 'bbloomer_change_return_shop_url' );

 function bbloomer_change_return_shop_url() {
    return '/contemporary-craft/furniture/';
 }
 add_shortcode('downloads','downloads_func');
function downloads_func(){
    $r='';
    if(isset( $_GET['cat'] )){
        $ppp=9999999;
    }else{
        $ppp=24;
    }
    $catselect = sanitize_text_field( $_GET['cat'] );
    $catarray=array();

        if( have_rows( 'downloads' ) ) :
            while( have_rows( 'downloads' ) ): the_row();
               $cat= get_sub_field( 'category' );
               foreach($cat as $c){
                   if (!in_array($c, $catarray)){
                        $catarray[]=$c;
                    }
                }
            endwhile;
        endif;
        sort( $catarray);
    $r.='<div class="download-table-header">';
        $r.='<h3>Download Files</h3>';
        $r.='<select id="download-filter">';
            $r.='<option disabled selected>Filter</option>';
        foreach($catarray as $c){
            if($c == $catselect){
                $selected='selected';
            }else{
                $selected='';
            }
            $r.='<option '.$selected.' value="'.$c.'">'.$c.'</option>';
        }
        $r.='</select>';
    $r.='</div>';
    if(isset( $_GET['cat'] )){
        $r.='<p class="reset"><a href="'.get_permalink().'">Reset</a></p>';
    }
    if( get_query_var('paged') ) {
    $page = get_query_var( 'paged' );
    } else {
    $page = 1;
    }
    // Variables
    $row              = 0;
    $files_per_page  = $ppp; // How many images to display on each page
    $files           = get_field( 'downloads' );
    if( $files){
        $total            = count( $files );
    }else{
        $total=0;
    }
    $pages            = ceil( $total / $files_per_page );
    $min              = ( ( $page * $files_per_page ) - $files_per_page ) + 1;
    $max              = ( $min + $files_per_page ) - 1;
    // ACF Loop
    if( have_rows( 'downloads' ) ) :
        $r.='<ul class="downloads">';
     while( have_rows( 'downloads' ) ): the_row();
    $row++;
    //if( (isset( $_GET['cat'] ) && get_sub_field( 'category' )==$catselect) || !isset( $_GET['cat'] )){
    $setcats=get_sub_field( 'category' );
   if( (isset( $_GET['cat'] ) && in_array( $catselect,  $setcats) ) || !isset( $_GET['cat'] )){
    // Ignore this image if $row is lower than $min
    if($row < $min) { continue; }
    // Stop loop completely if $row is higher than $max
    if($row > $max) { break; }
    $filetitle = get_sub_field( 'title' );
    $file = get_sub_field( 'file' );
     $r.= '<li>';
     $r.='<span class="title">'.$filetitle.'</span>';
     if($file){
        $r.='<span class="action"><a target="_blank" href="'.$file["url"].'" class="view">View</a> <span class="seperator">|</span> <a download target="_blank" href="'.$file["url"].'" class="download">Download</a></span>';
     }
     $r.='</li>';
 }//if cat
     endwhile;
    $r.='<div class="pagination clearfix">';

    $big = 999999999; // need an unlikely integer
    // Pagination
    $r.= paginate_links( array(
    'base' => str_replace( $big, '%#%', esc_url( get_pagenum_link( $big ) ) ),
    'format' => '?page=%#%',
    'current' => $page,
    'total' => $pages,
    'prev_text'    => __(''),
    'next_text'    => __(''),
    ) );

    $r.='</div>';
     endif;
   $r.=' </ul>';
    return $r;
}//downloads_func
add_shortcode('trade-side-nav','trade_side_nav_func');
function trade_side_nav_func(){
    $r='';
    if( have_rows('trade_nav','options') ):
        $r.='<ul class="trade-side-nav">';
        while( have_rows('trade_nav','options') ) : the_row();
            $label = get_sub_field('label');
            $url = get_sub_field('url');
            $r.='<li><a href="'.$url.'">'.$label.'</a></li>';
        endwhile;
        $r.='</ul>';
    endif;
    $r.='<h3>Got a question?</h3>';
    $r.='<a class="another_btn transparent" href="mailto:mail@anothercountry.com">Email our team</a>';
    return $r;
}//trade_side_nav_func
function custom_upload_mimes ( $existing_mimes=array() ) {
    $existing_mimes['dwg'] = 'image/vnd.dwg';
    return $existing_mimes;
}
add_filter('upload_mimes', 'custom_upload_mimes');
    /**
     * True if we should treat the customer as US/CA.
     * Criteria: selected currency is USD (Aelia cookie) OR shipping country is US/CA.
     */
    function ls_is_us_ca_customer_blocked() {
        $blocked_countries = array( 'US', 'CA' );
        // Currency (Aelia Currency Switcher)
        $currency = isset( $_COOKIE['aelia_cs_selected_currency'] )
            ? sanitize_text_field( $_COOKIE['aelia_cs_selected_currency'] )
            : '';
        // Shipping country (Woo customer)
        $ship_country = ( function_exists('WC') && WC()->customer )
            ? WC()->customer->get_shipping_country()
            : '';
        // Block if USD currency OR shipping country is US/CA
        return (
            $currency === 'USD'
            || in_array( $ship_country, $blocked_countries, true )
        );
    }
  add_action( 'woocommerce_cart_totals_after_shipping', function () {
      if ( ! function_exists('is_cart') || ! is_cart() ) {
          return;
      }
      if ( ! function_exists('ls_is_us_ca_customer_blocked') || ! ls_is_us_ca_customer_blocked() ) {
          return;
      }
      ?>
      <div class="us-shipping-quote-message">
                  For USA/ Canada deliveries, shipping quotes are provided on request.
                  Please <a class="toggle-quote-form" href="#" title="contact us">contact us</a>
                  to receive a tailored delivery quote for your order.
      </div>
      <div class="us-shipping-quote-box" style="display:none;">
        <?php echo do_shortcode('[gravityform id="4" title="false" description="false" ajax="false" tabindex="49" ]'); ?>
      </div>
      <?php
  }, 20 );
  /**
   * Show US/CA shipping quote message below Add to Cart on single product pages.
   */
  add_action( 'woocommerce_after_add_to_cart_button', function () {
      if ( ! function_exists('is_product') || ! is_product() ) {
          return;
      }
      if ( ! function_exists('ls_is_us_ca_customer_blocked') || ! ls_is_us_ca_customer_blocked() ) {
          return;
      }
      echo '<div class="us-shipping-quote-msg-single" style="margin-top:12px;">';
      echo 'For USA/ Canada deliveries, shipping quotes are provided on request. Please <a href="mailto:shop@anothercountry.com">contact us</a> to receive a tailored delivery quote for your order.';
      echo '</div>';
  }, 20 );
/**
 * Redirect blocked customers away from checkout to cart.
 */
function ls_redirect_blocked_customers_from_checkout() {
    if ( is_admin() ) return;
    // Avoid interfering with AJAX / background requests
    if ( defined('DOING_AJAX') && DOING_AJAX ) return;
    if ( function_exists('is_checkout') && is_checkout() && ! is_order_received_page() ) {
        if ( ls_is_us_ca_customer_blocked() ) {
            wp_safe_redirect( wc_get_cart_url() );
            exit;
        }
    }
}
add_action('template_redirect', 'ls_redirect_blocked_customers_from_checkout', 20);
add_shortcode('instock_furniture', 'show_true_instock_products');
   function show_true_instock_products($atts) {
       ob_start();
       $args = [
           'post_type' => 'product',
           'posts_per_page' => -1,
           'post_status' => 'publish',
           'meta_query' => [
               // Only products that are marked as in stock
               [
                   'key' => '_stock_status',
                   'value' => 'instock'
               ],
               // Only products that do not allow backorders
               [
                   'key' => '_backorders',
                   'value' => 'no'
               ]
           ],
           'tax_query' => [
               // Include only 'furniture' category
               [
                   'taxonomy' => 'product_cat',
                   'field' => 'slug',
                   'terms' => 'furniture'
               ],
               // Exclude 'accessories' and its children
               [
                   'taxonomy' => 'product_cat',
                   'field' => 'slug',
                   'terms' => 'accessories',
                   'operator' => 'NOT IN',
                   'include_children' => true
               ]
           ]
       ];
       $loop = new WP_Query($args);
       if ($loop->have_posts()) {
           echo '<div class="woocommerce columns-3">';
           echo '<ul class="products products-grid small-block-grid-2 medium-block-grid-2 large-block-grid-2 xlarge-block-grid-3 xxlarge-block-grid-3 columns-3">';
           while ($loop->have_posts()) {
               $loop->the_post();
               $product = wc_get_product(get_the_ID());
               if ($product->is_type('simple')) {
                     wc_get_template_part('content', 'product');
                }
                if ($product->is_type('variable')) {
                              $parent_ids[] = $product->get_id();
                }
           }//while
           wp_reset_postdata();
           if (!empty($parent_ids)) {
                  $variation_args = [
                      'post_type' => 'product_variation',
                      'post_status' => 'publish',
                      'posts_per_page' => -1,
                      'post_parent__in' => $parent_ids,
                      'meta_query' => [
                          [
                              'key' => '_stock_status',
                              'value' => 'instock'
                          ],

                      ]
                  ];
                  $variation_query = new WP_Query($variation_args);
                  if ($variation_query->have_posts()) {
                            while ($variation_query->have_posts()) {
                                $variation_query->the_post();
                                $variation = wc_get_product(get_the_ID());
                                $parent = wc_get_product($variation->get_parent_id());
                                wc_get_template_part('content', 'product');
                            }
                            wp_reset_postdata();
                        }
                    }//if !empty parents
           echo '</ul>';
           echo '</div>';
       } else {
           echo 'No products found.';
       }
       wp_reset_postdata();
       return ob_get_clean();
   }
 // Handle the AJAX request for filtered products
  add_action('wp_ajax_filter_products', 'handle_filter_products');
  add_action('wp_ajax_nopriv_filter_products', 'handle_filter_products');
  function handle_filter_products() {
      // Verify the AJAX nonce. Both registered entry points
      // (wp_ajax_filter_products and wp_ajax_nopriv_filter_products) call this same
      // handler, and this check runs first on every one of them, so every path into
      // the handler is covered. The nonce is unslashed + sanitised before use.
      $nonce = isset($_GET['nonce']) ? sanitize_text_field( wp_unslash( $_GET['nonce'] ) ) : '';
      if ( ! wp_verify_nonce( $nonce, 'filter_nonce' ) ) {
          die('Permission denied');
      }

      // Pull the raw filter bag and sanitise it inline at the point of read (below):
      // map_deep applies sanitize_text_field across the whole nested array, so the
      // raw filter value is never assigned unsanitised. Its values do reach the query
      // (tax_query term IDs, the price meta_query, sort direction), so each is also
      // re-read with a stricter sanitiser at use: absint for numeric IDs, a float
      // cast for prices, an ASC-or-DESC check for the sort, and a fixed pa_ taxonomy
      // whitelist for attributes. A client meta_query, tax_query or orderby is never
      // accepted.
      $filters = ( isset($_GET['filters']) && is_array($_GET['filters']) ) ? map_deep( wp_unslash( $_GET['filters'] ), 'sanitize_text_field' ) : [];

      // Pagination is ALWAYS bounded — there is no unbounded branch. per_page mirrors
      // the shop archive (default 45, clamped 1–100); page defaults to 1. Every
      // request therefore runs exactly one paged query, whatever the client sends.
      $per_page = absint( $filters['per_page'] ?? 0 );
      if ( $per_page < 1 || $per_page > 100 ) {
          $per_page = 45;
      }
      $get_page = isset( $_GET['page'] ) ? absint( wp_unslash( $_GET['page'] ) ) : 1;
      $page     = max( 1, absint( $filters['page'] ?? $get_page ) );

      // Category is an integer term ID, defaulting to the current archive term.
      $current_category_id = ! empty( $filters['category'] ) ? absint( $filters['category'] ) : absint( get_queried_object_id() );

      // Sort direction is whitelisted to ASC / DESC.
      $order = ( isset($filters['order']) && strtoupper( sanitize_text_field( $filters['order'] ) ) === 'DESC' ) ? 'DESC' : 'ASC';

      // Start the product query.
      $args = [
          'post_type'        => array('product', 'product_variation'), // Products and variations
          'order'            => $order,
          'iconic_ssv_query' => 1, // Ensure variations are included
          'wc_query'         => 'product_query', // Identify this as a product query
          'post_status'      => 'publish', // Exclude private / unpublished products
      ];

      if ( isset($filters['showall']) && sanitize_text_field( $filters['showall'] ) === 'true' ) {
          // 'showall' returns the original catalogue set, in its original order.
          $original_products = array_filter( array_map( 'absint', (array) ( $filters['original_products'] ?? [] ) ) );
          $args['post__in']  = ! empty($original_products) ? $original_products : [ 0 ]; // [0] => empty result, never "everything"
          $args['orderby']   = 'post__in';  // Preserve original order
      } else {
          $args['orderby'] = 'menu_order';
      }

      // Build the taxonomy query in one place: category + attribute filters + the
      // catalogue-visibility exclusion (relation AND).
      $args['tax_query'] = [ 'relation' => 'AND' ];
      if ( $current_category_id ) {
          $args['tax_query'][] = [
              'taxonomy' => 'product_cat',
              'field'    => 'id',
              'terms'    => $current_category_id,
              'operator' => 'IN',
          ];
      }

      // Price filter (optional). Prices arrive incl. VAT from the UI; convert to the
      // ex-VAT figure stored in _price. Bounds are cast to float — never trusted raw.
      if ( isset($filters['min_price'], $filters['max_price']) && is_numeric($filters['min_price']) && is_numeric($filters['max_price']) ) {
          $vat_rate         = 0.2;
          $min_price_ex_vat = round( (float) $filters['min_price'] / (1 + $vat_rate) - 1, 2 );
          $max_price_ex_vat = round( (float) $filters['max_price'] / (1 + $vat_rate) - 1, 2 );
          $args['meta_query'] = [
              'relation' => 'OR', // applies to both simple and variable products
              [
                  'key'     => '_price',
                  'value'   => [ $min_price_ex_vat, $max_price_ex_vat ],
                  'compare' => 'BETWEEN',
                  'type'    => 'NUMERIC',
              ],
              [
                  'key'        => '_price',
                  'value'      => [ $min_price_ex_vat, $max_price_ex_vat ],
                  'compare'    => 'BETWEEN',
                  'type'       => 'NUMERIC',
                  'meta_query' => [
                      'relation' => 'AND',
                      [
                          'key'     => '_price',
                          'value'   => [ $min_price_ex_vat, $max_price_ex_vat ],
                          'compare' => 'BETWEEN',
                          'type'    => 'NUMERIC',
                      ],
                  ],
              ],
          ];
      }

      // Attribute filters. Each is a list of term IDs (integers) against a fixed,
      // whitelisted attribute taxonomy — the client sends term IDs only, never a
      // taxonomy name or a query structure.
      $attribute_taxonomies = [
          'size'       => 'pa_size',
          'finish'     => 'pa_finish',
          'material'   => 'pa_material',
          'shape'      => 'pa_shape',
          'extendable' => 'pa_extendable',
      ];
      foreach ( $attribute_taxonomies as $filter_key => $taxonomy ) {
          if ( empty( $filters[ $filter_key ] ) ) {
              continue;
          }
          $terms = array_filter( array_map( 'absint', (array) $filters[ $filter_key ] ) );
          if ( empty( $terms ) ) {
              continue;
          }
          $args['tax_query'][] = [
              'taxonomy' => $taxonomy,
              'field'    => 'id',
              'terms'    => $terms,
              'operator' => 'IN',
          ];
      }

      // Exclude products flagged 'exclude-from-catalog' (product_visibility term 7).
      $args['tax_query'][] = [
          'taxonomy' => 'product_visibility',
          'field'    => 'term_taxonomy_id',
          'terms'    => [ 7 ],
          'operator' => 'NOT IN',
      ];

      // NOTE: a client-supplied meta_query is deliberately NOT accepted here. An
      // earlier version merged a request-supplied meta_query straight into the query,
      // letting arbitrary query structures reach WP_Query — a performance and
      // injection / abuse risk. Only the server-built price meta_query is used.

      // One bounded, paged query per request (no unbounded fetch). iconic_ssv_query
      // still folds variations into the same query, but the result set is limited to
      // a single page, and the found_posts / max_num_pages returned below come
      // straight from this one query — so no separate counting query is needed.
      $args['posts_per_page'] = $per_page;
      $args['paged']          = $page;

    // Run the product query
    $query = new WP_Query($args);
    $s=0;
    $v=0;

     $product_html='';
    // Check if the query has any posts
    if ($query->have_posts()) {
        $products_html = '';
        $product_ids = [];
       while ($query->have_posts()) {
           $query->the_post();
           $product_ids[] = get_the_ID();
       }         // End of the while loop
           $product_ids = array_unique($product_ids);
           foreach ($product_ids as $product_id) {
               $product = wc_get_product($product_id);
               if (!$product) continue;
               // Handle variations
               if ($product->is_type('variation')) {
                   // Get parent product URL
                   $parent_id = $product->get_parent_id();
                   $base_url = get_permalink($parent_id);
                   // Get variation attributes
                   $attributes = $product->get_attributes(); // e.g. ['pa_size' => 'medium']
                   // Build query string for the variation
                   $query_args = [];
                   foreach ($attributes as $key => $value) {
                       $taxonomy = wc_attribute_taxonomy_slug($key); // removes 'pa_' if needed
                       $query_args["attribute_$key"] = $value;
                   }
                   $permalink = add_query_arg($query_args, $base_url);
               } else {
                   $permalink = get_permalink($product_id);
               }
               // Pricing for Variable products
               if ($product->is_type('variable')) {
                   $min_price = $product->get_variation_price('min', true); // incl VAT
                   $max_price = $product->get_variation_price('max', true); // incl VAT
                   // Check if the variable product is on sale
                   if ($product->is_on_sale()) {
                       $regular_min_price = $product->get_variation_regular_price('min', true);
                       $regular_max_price = $product->get_variation_regular_price('max', true);
                       // Display the prices with strikethrough for regular prices and sale prices below
                       if ($min_price === $max_price) {
                           $price = '<div class="price"><del>' . wc_price($regular_min_price) . '</del></div>';
                           $price .= '<div class="price">' . wc_price($min_price) . '</div>';
                       } else {
                           $price = '<div class="price"><del>' . wc_price($regular_min_price) . ' - ' . wc_price($regular_max_price) . '</del></div>';
                           $price .= '<div class="price">' . wc_price($min_price) . ' - ' . wc_price($max_price) . '</div>';
                       }
                   } else {
                       // Show the regular price range for variable products
                       if ($min_price === $max_price) {
                           $price = wc_price($min_price);
                       } else {
                           $price = wc_price($min_price) . ' - ' . wc_price($max_price);
                       }
                   }
               } else {
                   // Pricing for Simple products
                   $price = wc_price(wc_get_price_including_tax($product));
                   // Check if the simple product is on sale
                   if ($product->is_on_sale()) {
                       $regular_price = $product->get_regular_price();
                       $sale_price = $product->get_sale_price();
                       if ($regular_price !== $sale_price) {
                           // Show strikethrough regular price and sale price
                           $price = '<div class="price"><del>' . wc_price($regular_price) . '</del></div>';
                           $price .= '<div class="price">' . wc_price($sale_price) . '</div>';
                       }
                   }
               }
               // For variations, use the parent product's title
               $title = $product->get_name();
               $products_html .= '<li class="product getbowtied_ajax_load_more_item_visible">';
               // Product image
               $products_html .= '<div class="product_thumbnail">';
               $products_html .= '<a href="' . esc_url($permalink) . '">';
               $thumbnail_id = $product->get_image_id();
               if ($thumbnail_id) {
                   $products_html .= wp_get_attachment_image($thumbnail_id, 'shop_catalog');
               } else {
                   $products_html .= wc_placeholder_img();
               }
               $products_html .= '</a>';
               $products_html .= '</div>'; // End product_thumbnail
               // Product info
               $products_html .= '<div class="shop_product_metas">';
               $products_html .= '<h3><a class="shop_product_title" href="' . esc_url($permalink) . '">' . esc_html($title) . '</a></h3>';
               // Product price
               $products_html .= '<div class="shop_product_price">';
               $products_html .= $price; // Display price (with regular and sale price)
               $products_html .= '</div>'; // End shop_product_price
               $products_html .= '</div>'; // End shop_product_metas
               $products_html .= '</li>'; // End product list item
           }
        // Return the products
        wp_send_json_success([
            'products'      => $products_html,
            'max_num_pages' => (int) $query->max_num_pages,
            'found'         => (int) $query->found_posts,
            'page'          => $page,
            'per_page'      => $per_page,
        ]);
    } else {
        wp_send_json_success([
            'products'      => '<p>No products found for these filters.</p>',
            'max_num_pages' => 0,
            'found'         => 0,
            'page'          => $page,
            'per_page'      => $per_page,
        ]);
    }
    wp_die();
  }

  add_action( 'woocommerce_new_order', function( $order_id ) {
      $order = wc_get_order( $order_id );
      $created_via = $order->get_meta( '_created_via' );
      // Save a clean version for Klaviyo on all orders
      $order->update_meta_data( 'created_via', $created_via ?: 'unknown' );
      if ( $created_via === 'rest-api' ) {
          $order->update_meta_data( 'skip_klaviyo_email', '1' );
      }
      $order->save();
  });
  add_filter( 'klaviyo_get_order_properties', function( $properties, $order ) {
      // Add your custom fields here
      $properties['created_via'] = $order->get_meta('created_via');
      $properties['skip_klaviyo_email'] = $order->get_meta('skip_klaviyo_email');

      return $properties;
  }, 10, 2 );
   add_shortcode('clearance','clearance_func');
  function clearance_func(){
      $r='';
      // ACF Loop
      if( have_rows( 'items' ) ) :
        $r.='<ul class="clerance-items">';
          while( have_rows( 'items' ) ): the_row();
          $image = get_sub_field( 'image' );
          $title = get_sub_field( 'title' );
          $file = get_sub_field( 'file' );
           $r.= '<li>';
           $r.='<span class="image"><a target="_blank" href="'.$file["url"].'" class="view"><img src="'.$image["sizes"]["thumbnail"].'"/ title="'.$title.'"/></a></span>';
           $r.='<span class="title">'.$title.'</span>';
           if($file){
              $r.='<span class="action"><a target="_blank" href="'.$file["url"].'" class="view">Download</a> <span class="seperator">|</span> <a class="clerance-enquire" href="#" data-product="'.$title.'">Enquire</a></span>';
           }
           $r.='</li>';
        endwhile;
       endif;
     $r.=' </ul>';
      return $r;
  }//downloads_func
  add_filter( 'woocommerce_get_price_html', function( $price_html, $product ) {
      if ( ! is_product() || ! $product ) {
          return $price_html;
      }
      // Change 'workstead' to the exact slug of your category if different
      if ( has_term( 'workstead', 'product_cat', $product->get_id() ) ) {
          // Avoid adding it twice
          if ( strpos( $price_html, 'plus shipping' ) === false ) {
              $price_html .= ' <span  class="plus-shipping">plus shipping</span>';
          }
      }
      return $price_html;
  }, 20, 2 );

/* =========================================================================
 * FABRIC DRAWER  (core)
 * ========================================================================= */
function ac_is_fabric_drawer_enabled( $product_id = 0 ) {
  $product_id = $product_id ? $product_id : get_the_ID();
  $meta_enabled = (string) get_post_meta( $product_id, '_ac_enable_fabric_drawer', true );
  if ( in_array( strtolower( $meta_enabled ), array( 'yes', '1', 'true', 'on' ), true ) ) {
    return true;
  }
  // Legacy fallback: read stored ACF field value directly from post meta (without ACF APIs).
  $legacy_enabled = (string) get_post_meta( $product_id, 'ac_enable_fabric_drawer', true );
  return in_array( strtolower( $legacy_enabled ), array( 'yes', '1', 'true', 'on' ), true );
}
function ac_get_product_fabric_groups( $product_id ) {
  $raw = (string) get_post_meta( $product_id, '_ac_fabric_groups', true );
  $groups = array();
  if ( '' === trim( $raw ) ) {
    return $groups;
  }
  $lines = preg_split( '/\r\n|\r|\n/', $raw );
  if ( ! is_array( $lines ) ) {
    return $groups;
  }
  foreach ( $lines as $line ) {
    $line = trim( $line );
    if ( '' === $line ) {
      continue;
    }
    $parts = array_map( 'trim', explode( '|', $line ) );
    $key = isset( $parts[0] ) ? sanitize_title( $parts[0] ) : '';
    if ( '' === $key ) {
      continue;
    }
    $groups[ $key ] = array(
      'label' => isset( $parts[1] ) && '' !== $parts[1] ? $parts[1] : ucwords( str_replace( '-', ' ', $key ) ),
      'sort'  => isset( $parts[2] ) && is_numeric( $parts[2] ) ? (int) $parts[2] : 0,
    );
  }
  return $groups;
}
function ac_get_fabric_term_swatch_id( $term_id ) {
  return (int) get_term_meta( $term_id, 'ac_fabric_swatch_image_id', true );
}
function ac_get_fabric_term_swatch_url( $term_id, $size = 'thumbnail' ) {
  $image_id = ac_get_fabric_term_swatch_id( $term_id );
  if ( ! $image_id ) {
    return '';
  }
  $url = wp_get_attachment_image_url( $image_id, $size );
  return $url ? $url : '';
}
function ac_get_fabric_drawer_preview_image_id( $variation_id ) {
  return (int) get_post_meta( $variation_id, '_ac_fabric_drawer_preview_image_id', true );
}
function ac_get_fabric_drawer_preview_url( $variation_id, $size = 'woocommerce_single' ) {
  $image_id = ac_get_fabric_drawer_preview_image_id( $variation_id );
  if ( ! $image_id ) {
    return '';
  }
  $url = wp_get_attachment_image_url( $image_id, $size );
  return $url ? $url : '';
}
function ac_get_variation_image_preview_url( $variation ) {
  if ( ! empty( $variation['image']['full_src'] ) ) {
    return $variation['image']['full_src'];
  }
  if ( ! empty( $variation['image']['src'] ) ) {
    return $variation['image']['src'];
  }
  if ( ! empty( $variation['image']['thumb_src'] ) ) {
    return $variation['image']['thumb_src'];
  }
  return '';
}
add_action( 'pa_fabric_add_form_fields', 'ac_fabric_term_swatch_add_field' );
function ac_fabric_term_swatch_add_field() {
  ?>
  <div class="form-field term-ac-fabric-swatch-wrap">
    <label for="ac_fabric_swatch_image_id"><?php esc_html_e( 'Swatch Image', 'woocommerce' ); ?></label>
    <input type="hidden" name="ac_fabric_swatch_image_id" id="ac_fabric_swatch_image_id" value="" />
    <div class="ac-fabric-swatch-preview" style="margin:8px 0;"></div>
    <button type="button" class="button ac-fabric-upload"><?php esc_html_e( 'Select Image', 'woocommerce' ); ?></button>
    <button type="button" class="button ac-fabric-remove" style="display:none;"><?php esc_html_e( 'Remove Image', 'woocommerce' ); ?></button>
    <p class="description"><?php esc_html_e( 'Used for fabric tile in the trigger and drawer swatches.', 'woocommerce' ); ?></p>
  </div>
  <?php
}
add_action( 'pa_fabric_edit_form_fields', 'ac_fabric_term_swatch_edit_field' );
function ac_fabric_term_swatch_edit_field( $term ) {
  $image_id  = ac_get_fabric_term_swatch_id( $term->term_id );
  $image_url = $image_id ? wp_get_attachment_image_url( $image_id, 'thumbnail' ) : '';
  ?>
  <tr class="form-field term-ac-fabric-swatch-wrap">
    <th scope="row"><label for="ac_fabric_swatch_image_id"><?php esc_html_e( 'Swatch Image', 'woocommerce' ); ?></label></th>
    <td>
      <input type="hidden" name="ac_fabric_swatch_image_id" id="ac_fabric_swatch_image_id" value="<?php echo esc_attr( $image_id ); ?>" />
      <div class="ac-fabric-swatch-preview" style="margin:8px 0;">
        <?php if ( $image_url ) : ?>
          <img src="<?php echo esc_url( $image_url ); ?>" alt="" style="max-width:80px;height:auto;" />
        <?php endif; ?>
      </div>
      <button type="button" class="button ac-fabric-upload"><?php esc_html_e( 'Select Image', 'woocommerce' ); ?></button>
      <button type="button" class="button ac-fabric-remove" <?php echo $image_url ? '' : 'style="display:none;"'; ?>><?php esc_html_e( 'Remove Image', 'woocommerce' ); ?></button>
      <p class="description"><?php esc_html_e( 'Used for fabric tile in the trigger and drawer swatches.', 'woocommerce' ); ?></p>
    </td>
  </tr>
  <?php
}
add_action( 'created_pa_fabric', 'ac_save_fabric_term_swatch_meta' );
add_action( 'edited_pa_fabric', 'ac_save_fabric_term_swatch_meta' );
function ac_save_fabric_term_swatch_meta( $term_id ) {
  $image_id = isset( $_POST['ac_fabric_swatch_image_id'] ) ? (int) $_POST['ac_fabric_swatch_image_id'] : 0;
  if ( $image_id ) {
    update_term_meta( $term_id, 'ac_fabric_swatch_image_id', $image_id );
  } else {
    delete_term_meta( $term_id, 'ac_fabric_swatch_image_id' );
  }
}
add_action( 'admin_enqueue_scripts', 'ac_enqueue_fabric_term_media_script' );
function ac_enqueue_fabric_term_media_script( $hook ) {
  $screen = get_current_screen();
  if ( ! $screen || 'pa_fabric' !== $screen->taxonomy ) {
    return;
  }
  if ( 'edit-tags.php' !== $hook && 'term.php' !== $hook ) {
    return;
  }
  wp_enqueue_media();
  add_action( 'admin_footer', 'ac_fabric_term_media_script' );
}
function ac_fabric_term_media_script() {
  ?>
  <script>
    jQuery(function($) {
      var frame;
      function setPreview(url) {
        var html = url ? '<img src="' + url + '" alt="" style="max-width:80px;height:auto;" />' : '';
        $('.ac-fabric-swatch-preview').html(html);
        $('.ac-fabric-remove').toggle(!!url);
      }
      $('body').on('click', '.ac-fabric-upload', function(e) {
        e.preventDefault();
        if (frame) {
          frame.open();
          return;
        }
        frame = wp.media({
          title: 'Select swatch image',
          button: { text: 'Use image' },
          multiple: false
        });
        frame.on('select', function() {
          var attachment = frame.state().get('selection').first().toJSON();
          $('#ac_fabric_swatch_image_id').val(attachment.id);
          setPreview(attachment.sizes && attachment.sizes.thumbnail ? attachment.sizes.thumbnail.url : attachment.url);
        });
        frame.open();
      });
      $('body').on('click', '.ac-fabric-remove', function(e) {
        e.preventDefault();
        $('#ac_fabric_swatch_image_id').val('');
        setPreview('');
      });
    });
  </script>
  <?php
}
/**
 * Request-level memoisation of WC_Product::get_available_variations().
 *
 * get_available_variations() is expensive (it builds full data for every
 * variation) and was being called multiple times per request on the fabric
 * drawer PDP. This returns the same result for a given product within a single
 * request, calling the underlying WooCommerce method at most once per product.
 */
function ac_get_cached_available_variations( $product ) {
  static $cache = array();
  if ( ! $product || ! $product->is_type( 'variable' ) ) {
    return array();
  }
  $pid = $product->get_id();
  if ( ! isset( $cache[ $pid ] ) ) {
    $cache[ $pid ] = $product->get_available_variations();
  }
  return $cache[ $pid ];
}
function ac_build_product_fabric_data( $product ) {
  if ( ! $product || ! $product->is_type( 'variable' ) ) {
    return array();
  }
  // Cache the built output per product + currency. The data includes
  // currency-dependent display_price values, so the currency MUST be part of
  // the key (this site runs the Aelia Currency Switcher). Cleared on save via
  // ac_clear_fabric_caches().
  $cache_key = 'ac_fabric_data_' . $product->get_id() . '_' . get_woocommerce_currency();
  $cached    = get_transient( $cache_key );
  if ( false !== $cached ) {
    return $cached;
  }
  $available_variations = ac_get_cached_available_variations( $product );
  if ( empty( $available_variations ) ) {
    return array();
  }
  $group_config   = ac_get_product_fabric_groups( $product->get_id() );
  $fabrics = array();
  foreach ( $available_variations as $variation ) {
    $variation_id = isset( $variation['variation_id'] ) ? (int) $variation['variation_id'] : 0;
    $attributes = isset( $variation['attributes'] ) ? $variation['attributes'] : array();
    $fabric_slug = isset( $attributes['attribute_pa_fabric'] ) ? $attributes['attribute_pa_fabric'] : '';
    if ( '' === $fabric_slug ) {
      continue;
    }
    if ( ! isset( $fabrics[ $fabric_slug ] ) ) {
      $term = get_term_by( 'slug', $fabric_slug, 'pa_fabric' );
      if ( ! $term || is_wp_error( $term ) ) {
        continue;
      }
      $tile    = ac_get_fabric_term_swatch_url( $term->term_id, 'thumbnail' );
      $preview = ac_get_fabric_drawer_preview_url( $variation_id, 'woocommerce_single' );
      $meta_group_key = $variation_id ? sanitize_title( (string) get_post_meta( $variation_id, '_ac_fabric_group_key', true ) ) : '';
      $meta_sort      = $variation_id ? (int) get_post_meta( $variation_id, '_ac_fabric_sort_order', true ) : 0;
      $meta_desc      = $variation_id ? (string) get_post_meta( $variation_id, '_ac_fabric_drawer_description', true ) : '';
      if ( ! $tile && ! empty( $variation['image']['thumb_src'] ) ) {
        $tile = $variation['image']['thumb_src'];
      }
      if ( ! $preview ) {
        $preview = ac_get_variation_image_preview_url( $variation );
      }
      $resolved_group_key   = $meta_group_key ? $meta_group_key : 'available-fabrics';
      $resolved_group_label = 'Available Fabrics';
      $resolved_group_sort  = 0;
      if ( isset( $group_config[ $resolved_group_key ] ) ) {
        $resolved_group_label = $group_config[ $resolved_group_key ]['label'];
        $resolved_group_sort  = $group_config[ $resolved_group_key ]['sort'];
      } elseif ( $resolved_group_key ) {
        $resolved_group_label = ucwords( str_replace( '-', ' ', $resolved_group_key ) );
      }
      $fabrics[ $fabric_slug ] = array(
        'slug'        => $fabric_slug,
        'name'        => $term->name,
        'group_key'   => $resolved_group_key,
        'group_label' => $resolved_group_label,
        'group_sort'  => $resolved_group_sort,
        'sort_order'  => $meta_sort,
        'description' => $meta_desc,
        'tile'        => $tile,
        'preview'     => $preview,
        'min_price'   => null,
        'max_price'   => null,
      );
    } else {
      $custom_preview = ac_get_fabric_drawer_preview_url( $variation_id, 'woocommerce_single' );
      if ( $custom_preview ) {
        $fabrics[ $fabric_slug ]['preview'] = $custom_preview;
      }
    }
    $price = isset( $variation['display_price'] ) ? (float) $variation['display_price'] : 0;
    if ( null === $fabrics[ $fabric_slug ]['min_price'] || $price < $fabrics[ $fabric_slug ]['min_price'] ) {
      $fabrics[ $fabric_slug ]['min_price'] = $price;
    }
    if ( null === $fabrics[ $fabric_slug ]['max_price'] || $price > $fabrics[ $fabric_slug ]['max_price'] ) {
      $fabrics[ $fabric_slug ]['max_price'] = $price;
    }
  }
  uasort( $fabrics, function( $a, $b ) {
    if ( $a['sort_order'] === $b['sort_order'] ) {
      return strcasecmp( $a['name'], $b['name'] );
    }
    return $a['sort_order'] <=> $b['sort_order'];
  } );
  set_transient( $cache_key, $fabrics, WEEK_IN_SECONDS );
  return $fabrics;
}

/* =========================================================================
 * ===== OCTOBER COMMS ADDITION - START =====================================
 * In-drawer sample ordering + screen note for the fabric drawer.
 * Adds: swatch product config, an AJAX handler that drops the £0 swatch
 * product into the cart using the existing `swatches` line-item format, and
 * the localize that feeds fabric-drawer.js. The drawer markup additions are
 * inside ac_render_fabric_drawer_ui() below, tagged // AC-SAMPLE.
 * Safe to remove this whole block + the // AC-SAMPLE lines to revert.
 * ========================================================================= */

/** The £0 swatch product ID. */
function ac_get_swatch_product_id() {
  return (int) apply_filters( 'ac_swatch_product_id', 169741 );
}

/** Free-sample limit before a delivery charge applies (messaging only). */
function ac_get_free_swatch_limit() {
  return (int) apply_filters( 'ac_free_swatch_limit', 5 );
}

/** Pass config to the existing fabric-drawer script (combined file). */
add_action( 'wp_enqueue_scripts', 'ac_enqueue_fabric_swatch_data', 30 );
function ac_enqueue_fabric_swatch_data() {
  if ( ! function_exists( 'is_product' ) || ! is_product() ) {
    return;
  }

  // Build a (non-fabric attribute combination) -> fabric -> {price, preview}
  // map server-side, keyed by the full combination of all non-fabric
  // attributes (Size, Cushion Filling, etc.) so the drawer price/render
  // reflects every selection. Works regardless of variation count.
  $matrix  = array();
  $product = wc_get_product( get_queried_object_id() );
  if ( $product && $product->is_type( 'variable' ) ) {
    $matrix = ac_build_fabric_size_matrix( $product );
  }

  wp_localize_script(
    'ac-fabric-drawer',
    'acSwatchData',
    array(
      'ajaxurl'    => admin_url( 'admin-ajax.php' ),
      'nonce'      => wp_create_nonce( 'ac_swatch_nonce' ),
      'freeLimit'  => ac_get_free_swatch_limit(),
      'cartUrl'    => function_exists( 'wc_get_cart_url' ) ? wc_get_cart_url() : '/cart/',
      'hasProduct' => ac_get_swatch_product_id() > 0 ? 1 : 0,
      'matrix'     => $matrix,
    )
  );
}

/**
 * Composite key (all non-fabric attributes) => fabric slug => { price, preview }.
 * Key = non-fabric attribute name=value pairs, sorted by name, joined with "|"
 * (e.g. attribute_cushion-filling=all-feather|attribute_pa_size=two-seater).
 * The JS builds the identical key from the live selectors.
 */
function ac_build_fabric_size_matrix( $product ) {
  $matrix = array();
  if ( ! $product || ! $product->is_type( 'variable' ) ) {
    return $matrix;
  }
  // Cache the built matrix per product + currency. The values include
  // currency-dependent price_html / wc_price() output, so the currency MUST be
  // part of the key. Cleared on save via ac_clear_fabric_caches().
  $cache_key = 'ac_fabric_matrix_' . $product->get_id() . '_' . get_woocommerce_currency();
  $cached    = get_transient( $cache_key );
  if ( false !== $cached ) {
    return $cached;
  }
  foreach ( ac_get_cached_available_variations( $product ) as $v ) {
    $attrs  = isset( $v['attributes'] ) ? $v['attributes'] : array();
    $fabric = isset( $attrs['attribute_pa_fabric'] ) ? $attrs['attribute_pa_fabric'] : '';
    if ( '' === $fabric ) {
      continue;
    }
    // Composite key of every non-fabric, non-empty attribute, sorted by name.
    $key_parts = array();
    foreach ( $attrs as $key => $val ) {
      if ( 'attribute_pa_fabric' === $key || '' === $val ) {
        continue;
      }
      $key_parts[ $key ] = $val;
    }
    if ( empty( $key_parts ) ) {
      continue;
    }
    ksort( $key_parts );
    $compo = array();
    foreach ( $key_parts as $key => $val ) {
      $compo[] = $key . '=' . $val;
    }
    $compo = implode( '|', $compo );

    $vid     = isset( $v['variation_id'] ) ? (int) $v['variation_id'] : 0;
    $preview = $vid ? ac_get_fabric_drawer_preview_url( $vid, 'woocommerce_single' ) : '';
    if ( ! $preview ) {
      $preview = ac_get_variation_image_preview_url( $v );
    }
    $price = isset( $v['price_html'] ) && '' !== $v['price_html']
      ? $v['price_html']
      : wc_price( isset( $v['display_price'] ) ? $v['display_price'] : 0 );

    if ( ! isset( $matrix[ $compo ] ) ) {
      $matrix[ $compo ] = array();
    }
    $matrix[ $compo ][ $fabric ] = array(
      'price'   => $price,
      'preview' => $preview,
    );
  }
  set_transient( $cache_key, $matrix, WEEK_IN_SECONDS );
  return $matrix;
}

/**
 * Invalidate the fabric drawer transient caches for a product.
 *
 * Hooked to product/variation saves. Accepts either a product ID or a
 * variation ID (resolved up to its parent), and deletes both the data and
 * matrix transients for every active currency so no currency serves stale
 * prices after an edit.
 */
function ac_clear_fabric_caches( $product_id ) {
  $product_id = (int) $product_id;
  if ( ! $product_id ) {
    return;
  }
  // Resolve a variation ID up to its parent product.
  $parent = wp_get_post_parent_id( $product_id );
  if ( $parent ) {
    $product_id = $parent;
  }
  // Build the list of currencies to clear: the Aelia enabled-currency list if
  // available, otherwise at least the shop base currency.
  $currencies = apply_filters( 'wc_aelia_cs_enabled_currencies', array() );
  if ( ! is_array( $currencies ) ) {
    $currencies = array();
  }
  $currencies[] = get_option( 'woocommerce_currency' );
  if ( function_exists( 'get_woocommerce_currency' ) ) {
    $currencies[] = get_woocommerce_currency();
  }
  $currencies = array_unique( array_filter( $currencies ) );
  foreach ( $currencies as $currency ) {
    delete_transient( 'ac_fabric_data_' . $product_id . '_' . $currency );
    delete_transient( 'ac_fabric_matrix_' . $product_id . '_' . $currency );
  }
}
add_action( 'woocommerce_update_product', 'ac_clear_fabric_caches' );
add_action( 'woocommerce_save_product_variation', 'ac_clear_fabric_caches' );

/** AJAX: add selected fabrics to the cart as the £0 swatch product. */
add_action( 'wp_ajax_ac_add_fabric_swatches', 'ac_add_fabric_swatches' );
add_action( 'wp_ajax_nopriv_ac_add_fabric_swatches', 'ac_add_fabric_swatches' );
function ac_add_fabric_swatches() {
  check_ajax_referer( 'ac_swatch_nonce', 'nonce' );
  $product_id = ac_get_swatch_product_id();
  if ( ! $product_id ) {
    wp_send_json_error( array( 'message' => 'Swatch product is not configured.' ) );
  }
  $names = isset( $_POST['swatches'] ) ? sanitize_text_field( wp_unslash( $_POST['swatches'] ) ) : '';
  if ( '' === trim( $names ) ) {
    wp_send_json_error( array( 'message' => 'Please select at least one fabric.' ) );
  }
  if ( ! function_exists( 'WC' ) || ! WC()->cart ) {
    wp_send_json_error( array( 'message' => 'Cart is unavailable.' ) );
  }
  // Match the exact line-item format the old multiselect produced.
  $_POST['swatches'] = $names;
  $added = WC()->cart->add_to_cart( $product_id, 1, 0, array(), array( 'swatches' => $names ) );
  if ( ! $added ) {
    wp_send_json_error( array( 'message' => 'Could not add samples to the basket.' ) );
  }
  wp_send_json_success(
    array(
      'count'    => WC()->cart->get_cart_contents_count(),
      'cart_url' => wc_get_cart_url(),
    )
  );
}
/* ===== OCTOBER COMMS ADDITION - END ======================================
 * (The fabric drawer render + admin fields below are existing code. The only
 *  October Comms changes inside them are the lines tagged // AC-SAMPLE.)
 * ========================================================================= */

add_action( 'woocommerce_before_variations_form', 'ac_render_fabric_drawer_ui', 3 );
function ac_render_fabric_drawer_ui() {
  if ( ! is_product() ) {
    return;
  }
  global $product;
  if ( ! $product || ! $product->is_type( 'variable' ) || ! ac_is_fabric_drawer_enabled( $product->get_id() ) ) {
    return;
  }
  $fabrics = ac_build_product_fabric_data( $product );
  if ( empty( $fabrics ) ) {
    return;
  }
  $show_samples = ac_get_swatch_product_id() > 0; // AC-SAMPLE
  $grouped = array();
  foreach ( $fabrics as $fabric ) {
    if ( ! isset( $grouped[ $fabric['group_key'] ] ) ) {
      $grouped[ $fabric['group_key'] ] = array(
        'label' => $fabric['group_label'],
        'sort'  => isset( $fabric['group_sort'] ) ? (int) $fabric['group_sort'] : 0,
        'items' => array(),
      );
    }
    $grouped[ $fabric['group_key'] ]['items'][] = $fabric;
  }
  uasort(
    $grouped,
    function( $a, $b ) {
      if ( $a['sort'] === $b['sort'] ) {
        return strcasecmp( $a['label'], $b['label'] );
      }
      return $a['sort'] <=> $b['sort'];
    }
  );
  echo '<div class="ac-fabric-swatch-ui" data-fabric-attribute="attribute_pa_fabric">';
  echo '<button type="button" class="ac-fabric-trigger ac-open-fabric-drawer">';
  echo '<span class="ac-fabric-trigger-left"><span class="ac-acc-num ac-fabric-num"></span><span class="ac-fabric-trigger-title">Fabric<span class="ac-fabric-trigger-selected"></span></span></span>';
  echo '<span class="ac-fabric-trigger-thumb" aria-hidden="true" style="display:none"><img src="" alt="" /></span>';
  echo '<span class="ac-fabric-trigger-arrow" aria-hidden="true">+</span>';
  echo '</button>';
  echo '</div>';
  echo '<div class="ac-fabric-drawer-backdrop" aria-hidden="true"></div>';
  echo '<aside class="ac-fabric-drawer" aria-hidden="true">';
  echo '<div class="ac-fabric-drawer-head"><h3>Choose a fabric</h3><button type="button" class="ac-close-fabric-drawer" aria-label="Close">&times;</button></div>';
  echo '<div class="ac-fabric-drawer-preview"><img src="" alt="" /></div>';
  // AC-SAMPLE: screen-colour note
  echo '<p class="ac-fabric-screen-note">Screen colours vary. Order a free fabric swatch to see the true colour and feel before you commit.</p>';
  echo '<div class="ac-fabric-drawer-body">';
  foreach ( $grouped as $group ) {
    echo '<section class="ac-fabric-group">';
    echo '<h4>' . esc_html( $group['label'] ) . '</h4>';
    echo '<div class="ac-fabric-group-grid">';
    foreach ( $group['items'] as $fabric ) {
      $range = wc_price( $fabric['min_price'] );
      if ( $fabric['min_price'] !== $fabric['max_price'] ) {
        $range .= ' - ' . wc_price( $fabric['max_price'] );
      }
      echo '<div class="ac-fabric-cell">'; // AC-SAMPLE wrapper
      echo '<button type="button" class="ac-fabric-swatch" data-fabric-slug="' . esc_attr( $fabric['slug'] ) . '" data-preview="' . esc_url( $fabric['preview'] ) . '" data-price="' . esc_attr( $range ) . '">';
      if ( ! empty( $fabric['tile'] ) ) {
        echo '<span class="ac-fabric-swatch-tile"><img src="' . esc_url( $fabric['tile'] ) . '" alt="' . esc_attr( $fabric['name'] ) . '" /></span>';
      }
      echo '<span class="ac-fabric-swatch-name">' . esc_html( $fabric['name'] ) . '</span>';
      if ( ! empty( $fabric['description'] ) ) {
        echo '<span class="ac-fabric-swatch-desc">' . esc_html( $fabric['description'] ) . '</span>';
      }
      echo '</button>';
      // AC-SAMPLE: per-fabric sample toggle (sibling of the button, valid markup)
      if ( $show_samples ) {
        echo '<label class="ac-fabric-sample"><input type="checkbox" class="ac-fabric-sample-input" data-fabric-name="' . esc_attr( $fabric['name'] ) . '" /> <span>Add swatch to</span> <img class="ac-swatch-cart-ico" src="/wp-content/themes/merchandiser-child/images/AC_Cart_Icon.svg" width="14" alt="cart" /></label>';
      }
      echo '</div>'; // .ac-fabric-cell
    }
    echo '</div></section>';
  }
  echo '</div>';
  // AC-SAMPLE: sample order bar
  if ( $show_samples ) {
    echo '<div class="ac-fabric-sample-bar">';
    echo '<span class="ac-fabric-sample-count">0 swatches selected</span>';
    echo '<button type="button" class="another_btn ac-order-swatches" disabled>Add swatch to cart</button>';
    echo '<span class="ac-fabric-sample-msg" aria-live="polite"></span>';
    echo '</div>';
  }
  echo '<div class="ac-fabric-drawer-footer">';
  echo '<span class="ac-fabric-drawer-selected"></span>';
  echo '<span class="ac-fabric-drawer-price" aria-live="polite"></span>';
  echo '<button type="button" class="another_btn ac-confirm-fabric-selection">' . esc_html__( 'Confirm selection', 'woocommerce' ) . '</button>';
  echo '</div>';
  echo '</aside>';
}
add_action( 'woocommerce_product_options_general_product_data', 'ac_add_fabric_drawer_product_meta_fields' );
function ac_add_fabric_drawer_product_meta_fields() {
  echo '<div class="options_group">';
  woocommerce_wp_checkbox(
    array(
      'id'          => '_ac_enable_fabric_drawer',
      'label'       => __( 'Enable Fabric Drawer', 'woocommerce' ),
      'description' => __( 'Use custom fabric drawer for this product.', 'woocommerce' ),
      'desc_tip'    => true,
    )
  );
  woocommerce_wp_textarea_input(
    array(
      'id'          => '_ac_fabric_groups',
      'label'       => __( 'Fabric Groups', 'woocommerce' ),
      'description' => __( 'One per line: key|Label|Sort. Example: tier-1|From £X|10', 'woocommerce' ),
      'desc_tip'    => true,
      'value'       => get_post_meta( get_the_ID(), '_ac_fabric_groups', true ),
    )
  );
  echo '<p class="form-field"><button type="button" class="button" id="ac-save-refresh-fabric-groups">' . esc_html__( 'Save Groups And Refresh Variation Options', 'woocommerce' ) . '</button></p>';
  echo '</div>';
}
add_action( 'woocommerce_process_product_meta', 'ac_save_fabric_drawer_product_meta_fields' );
function ac_save_fabric_drawer_product_meta_fields( $product_id ) {
  $enabled = isset( $_POST['_ac_enable_fabric_drawer'] ) ? 'yes' : 'no';
  update_post_meta( $product_id, '_ac_enable_fabric_drawer', $enabled );
  $groups_raw = isset( $_POST['_ac_fabric_groups'] ) ? wp_kses_post( wp_unslash( $_POST['_ac_fabric_groups'] ) ) : '';
  update_post_meta( $product_id, '_ac_fabric_groups', $groups_raw );
}
add_action( 'woocommerce_product_after_variable_attributes', 'ac_add_fabric_variation_meta_fields', 10, 3 );
function ac_add_fabric_variation_meta_fields( $loop, $variation_data, $variation ) {
  $group_options = ac_get_product_fabric_groups( $variation->post_parent );
  $select_options = array( '' => __( 'Default (Available Fabrics)', 'woocommerce' ) );
  foreach ( $group_options as $group_key => $group_row ) {
    $select_options[ $group_key ] = $group_row['label'];
  }
  echo '<div class="ac-fabric-variation-fields" style="padding:8px 0;border-top:1px solid #eee;">';
  echo '<p><strong>' . esc_html__( 'Fabric Drawer Meta', 'woocommerce' ) . '</strong></p>';
  $drawer_preview_id  = ac_get_fabric_drawer_preview_image_id( $variation->ID );
  $drawer_preview_url = $drawer_preview_id ? wp_get_attachment_image_url( $drawer_preview_id, 'thumbnail' ) : '';
  ?>
  <p class="form-field ac-fabric-drawer-preview-field">
    <label><?php esc_html_e( 'Drawer Preview Image', 'woocommerce' ); ?></label>
    <input type="hidden" class="ac-fabric-drawer-preview-id" name="ac_fabric_drawer_preview_image_id[<?php echo esc_attr( $loop ); ?>]" value="<?php echo esc_attr( $drawer_preview_id ); ?>" />
    <span class="ac-fabric-drawer-preview-thumb" style="display:block;margin:8px 0;">
      <?php if ( $drawer_preview_url ) : ?>
        <img src="<?php echo esc_url( $drawer_preview_url ); ?>" alt="" style="max-width:80px;height:auto;" />
      <?php endif; ?>
    </span>
    <button type="button" class="button ac-fabric-drawer-preview-upload"><?php esc_html_e( 'Select image', 'woocommerce' ); ?></button>
    <button type="button" class="button ac-fabric-drawer-preview-remove" <?php echo $drawer_preview_url ? '' : 'style="display:none;"'; ?>><?php esc_html_e( 'Remove image', 'woocommerce' ); ?></button>
    <span class="description"><?php esc_html_e( 'Large preview at top of fabric drawer. Does not replace the main variation product image.', 'woocommerce' ); ?></span>
  </p>
  <?php
  woocommerce_wp_select(
    array(
      'id'            => "ac_fabric_group_key_{$loop}",
      'name'          => "ac_fabric_group_key[{$loop}]",
      'label'         => __( 'Fabric Group', 'woocommerce' ),
      'value'         => get_post_meta( $variation->ID, '_ac_fabric_group_key', true ),
      'options'       => $select_options,
      'wrapper_class' => 'form-row form-row-first',
    )
  );
  woocommerce_wp_text_input(
    array(
      'id'            => "ac_fabric_drawer_description_{$loop}",
      'name'          => "ac_fabric_drawer_description[{$loop}]",
      'label'         => __( 'Drawer Description', 'woocommerce' ),
      'value'         => get_post_meta( $variation->ID, '_ac_fabric_drawer_description', true ),
      'wrapper_class' => 'form-row form-row-first',
    )
  );
  woocommerce_wp_text_input(
    array(
      'id'            => "ac_fabric_sort_order_{$loop}",
      'name'          => "ac_fabric_sort_order[{$loop}]",
      'label'         => __( 'Sort Order', 'woocommerce' ),
      'type'          => 'number',
      'value'         => get_post_meta( $variation->ID, '_ac_fabric_sort_order', true ),
      'wrapper_class' => 'form-row form-row-last',
    )
  );
  echo '</div>';
}
add_action( 'woocommerce_save_product_variation', 'ac_save_fabric_variation_meta_fields', 10, 2 );
function ac_save_fabric_variation_meta_fields( $variation_id, $loop ) {
  $group_key   = isset( $_POST['ac_fabric_group_key'][ $loop ] ) ? sanitize_title( sanitize_text_field( wp_unslash( $_POST['ac_fabric_group_key'][ $loop ] ) ) ) : '';
  $description = isset( $_POST['ac_fabric_drawer_description'][ $loop ] ) ? sanitize_text_field( wp_unslash( $_POST['ac_fabric_drawer_description'][ $loop ] ) ) : '';
  $sort_order  = isset( $_POST['ac_fabric_sort_order'][ $loop ] ) ? (int) $_POST['ac_fabric_sort_order'][ $loop ] : 0;
  $preview_id  = isset( $_POST['ac_fabric_drawer_preview_image_id'][ $loop ] ) ? (int) $_POST['ac_fabric_drawer_preview_image_id'][ $loop ] : 0;
  update_post_meta( $variation_id, '_ac_fabric_group_key', $group_key );
  update_post_meta( $variation_id, '_ac_fabric_drawer_description', $description );
  update_post_meta( $variation_id, '_ac_fabric_sort_order', $sort_order );
  if ( $preview_id ) {
    update_post_meta( $variation_id, '_ac_fabric_drawer_preview_image_id', $preview_id );
  } else {
    delete_post_meta( $variation_id, '_ac_fabric_drawer_preview_image_id' );
  }
}
add_action( 'admin_enqueue_scripts', 'ac_enqueue_fabric_variation_media_script' );
function ac_enqueue_fabric_variation_media_script( $hook ) {
  if ( 'post.php' !== $hook && 'post-new.php' !== $hook ) {
    return;
  }
  $screen = get_current_screen();
  if ( ! $screen || 'product' !== $screen->post_type ) {
    return;
  }
  wp_enqueue_media();
  add_action( 'admin_footer', 'ac_fabric_variation_media_script' );
}
function ac_fabric_variation_media_script() {
  ?>
  <script>
    jQuery(function($) {
      $('body').on('click', '.ac-fabric-drawer-preview-upload', function(e) {
        e.preventDefault();
        var $field = $(this).closest('.ac-fabric-drawer-preview-field');
        var frame = wp.media({
          title: 'Select drawer preview image',
          button: { text: 'Use image' },
          multiple: false
        });
        frame.on('select', function() {
          var attachment = frame.state().get('selection').first().toJSON();
          var thumbUrl = attachment.sizes && attachment.sizes.thumbnail ? attachment.sizes.thumbnail.url : attachment.url;
          $field.find('.ac-fabric-drawer-preview-id').val(attachment.id);
          $field.find('.ac-fabric-drawer-preview-thumb').html('<img src="' + thumbUrl + '" alt="" style="max-width:80px;height:auto;" />');
          $field.find('.ac-fabric-drawer-preview-remove').show();
        });
        frame.open();
      });
      $('body').on('click', '.ac-fabric-drawer-preview-remove', function(e) {
        e.preventDefault();
        var $field = $(this).closest('.ac-fabric-drawer-preview-field');
        $field.find('.ac-fabric-drawer-preview-id').val('');
        $field.find('.ac-fabric-drawer-preview-thumb').empty();
        $field.find('.ac-fabric-drawer-preview-remove').hide();
      });
    });
  </script>
  <?php
}
add_action( 'admin_footer-post.php', 'ac_fabric_group_refresh_button_script' );
function ac_fabric_group_refresh_button_script() {
  global $post;
  if ( ! $post || 'product' !== $post->post_type ) {
    return;
  }
  ?>
  <script>
    jQuery(function($) {
      $('#ac-save-refresh-fabric-groups').on('click', function() {
        $('#publish').trigger('click');
      });
    });
  </script>
  <?php
}

/* =========================================================================
 * ===== OCTOBER COMMS ADDITION - START =====================================
 * Lead Times (v1.7 integration). All lead-time wording comes from the Another
 * Country Lead Times plugin and is shown INLINE in the price/stock badge
 * ("Made to Order in 8-12 weeks"), with the old tooltip removed. The trust
 * chips carry only Free UK delivery + (made-to-order) Customise — the old
 * "This is made for you… lead time" line has moved into the badge. The
 * per-product "Lead time" field + supplier resolution now live in the plugin.
 * ========================================================================= */

/** Is this a made-to-order furniture product? (not currently in stock) */
function ac_lt_is_made_to_order( $product ) {
	if ( ! $product ) {
		return false;
	}

	// Memoize per product for the rest of the request: this is called up to twice
	// per PDP (trust chips + the inline badge in the footer) and, for a variable
	// product, loops every variation's stock-status meta. On the 384-variation
	// sofa that's an expensive scan we only want to run once.
	static $cache = array();
	$pid = $product->get_id();
	if ( isset( $cache[ $pid ] ) ) {
		return $cache[ $pid ];
	}

	$furniture_cats = array( 'armadillo', 'furniture', 'rose-cottage', 'outdoor-tables', 'outdoor-furniture', 'outdoor-benches', 'outdoor', 'office', 'living-room-furniture', 'kids-furniture', 'in-stock-furniture', 'dining-tables', 'dining-room', 'dining-chairs', 'desks', 'day-beds', 'console-tables', 'coffee-tables', 'chests', 'benches', 'beds', 'bedroom', 'armchairs', 'chairs-benches', 'task-chairs', 'tables', 'stools', 'sofas-armchairs-day-beds', 'sofas', 'sofa-beds', 'sideboard', 'side-tables', 'shelving' );
	if ( ! has_term( $furniture_cats, 'product_cat', $pid ) ) {
		return $cache[ $pid ] = false;
	}
	// Variable products report the PARENT stock status as 'instock' whenever any
	// variation is purchasable (and "on backorder" is purchasable), so the parent
	// status hides made-to-order products — and a product re-sync (e.g. saving it)
	// flips it back to 'instock'. Inspect the variations instead: made to order if
	// any variation isn't plainly in stock. One indexed query instead of a
	// per-variation meta read, exiting as soon as one non-'instock' row is found.
	if ( $product->is_type( 'variable' ) ) {
		$children = $product->get_children();
		if ( empty( $children ) ) {
			return $cache[ $pid ] = false;
		}
		global $wpdb;
		$placeholders = implode( ',', array_fill( 0, count( $children ), '%d' ) );
		$found = $wpdb->get_var( $wpdb->prepare(
			"SELECT 1 FROM {$wpdb->postmeta}
			 WHERE meta_key = '_stock_status' AND meta_value <> 'instock'
			   AND post_id IN ( {$placeholders} )
			 LIMIT 1",
			$children
		) );
		return $cache[ $pid ] = (bool) $found;
	}
	return $cache[ $pid ] = ( 'instock' !== $product->get_stock_status() );
}

/** Expose each variation's resolved lead time to the variations JSON so the
 *  front-end can show the selected variant's lead time. */
add_filter( 'woocommerce_available_variation', 'ac_lt_variation_lead', 10, 3 );
function ac_lt_variation_lead( $data, $product, $variation ) {
	if ( function_exists( 'aclt_get_lead_time' ) ) {
		$data['ac_lead_time']  = aclt_get_lead_time( $variation->get_id() );
		$data['ac_lead_label'] = function_exists( 'aclt_get_badge_label' ) ? aclt_get_badge_label( $variation->get_id() ) : '';
	}
	return $data;
}

/** Trust chips below the add-to-cart (no lead-time line — that's inline now). */
add_action( 'woocommerce_after_add_to_cart_form', 'ac_pdp_trust_chips', 20 );
function ac_pdp_trust_chips() {
	if ( ! function_exists( 'is_product' ) || ! is_product() ) {
		return;
	}
	global $product;
	if ( ! $product ) {
		return;
	}
	$made_to_order = ac_lt_is_made_to_order( $product );

	$ic_truck  = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h11v9H3z"/><path d="M14 9h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/></svg>';
	$ic_pencil = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>';

	echo '<ul class="ac-trust-chips">';
	echo '<li class="ac-trust-chip"><span class="ac-trust-ic">' . $ic_truck . '</span><span class="ac-trust-tx"><strong>Free UK delivery</strong> on orders over &pound;1,500. International delivery quoted by location.</span></li>';
	if ( $made_to_order ) {
		echo '<li class="ac-trust-chip"><span class="ac-trust-ic">' . $ic_pencil . '</span><span class="ac-trust-tx">We can adapt this to meet your specific requirements. <a class="ac-trust-link ac-open-customise" href="#ac-customise-modal">Customise your order</a></span></li>';
	}
	echo '</ul>';

	if ( $made_to_order ) {
		echo '<div class="ac-modal-overlay" id="ac-customise-modal" aria-hidden="true">';
		echo '<div class="ac-modal" role="dialog" aria-modal="true" aria-label="Request a customisation">';
		echo '<button type="button" class="ac-modal-close" aria-label="Close">&times;</button>';
		echo '<h3 class="ac-modal-title">Customise</h3>';
		echo do_shortcode( '[gravityform id="12" title="false" description="false" ajax="true"]' );
		echo '</div>';
		echo '</div>';
	}
}

/**
 * Inline lead time inside the price/badge + the "Made to Order / In Stock"
 * de-duplication. Inserted after the stock badge via JS so placement is correct
 * regardless of how the price/badge are hooked.
 */
add_action( 'wp_footer', 'ac_lt_inline_assets', 99 );
function ac_lt_inline_assets() {
	if ( ! function_exists( 'is_product' ) || ! is_product() ) {
		return;
	}
	global $product;
	if ( ! $product ) {
		return;
	}

	$lead   = '';
	$label  = '';
	$season = '';
	if ( ac_lt_is_made_to_order( $product ) ) {
		$pid    = $product->get_id();
		$lead   = function_exists( 'aclt_get_lead_time' ) ? aclt_get_lead_time( $pid ) : '8-10 weeks';
		$label  = function_exists( 'aclt_get_badge_label' ) ? aclt_get_badge_label( $pid ) : 'Made to Order';
		$season = function_exists( 'aclt_get_seasonal_note' ) ? aclt_get_seasonal_note( $pid ) : '';
	}
	?>
	<style>
		/* Remove the old CSS tooltip + its info icon on the stock labels. */
		.single-product p.available-on-backorder:before,
		.single-product p.available-on-backorder:after,
		.single-product p.stock.in-stock:before,
		.single-product p.stock.in-stock:after{
			content:none !important;
			display:none !important;
		}
		.single-product .ac-lead-season{ display:block; margin-top:.15em; }
		/* The badge is not a real link — neutralise the old tooltip trigger. */
		.single-product p.available-on-backorder{ cursor:default !important; }
		.single-product p.available-on-backorder a{
			pointer-events:none !important;
			cursor:default !important;
			text-decoration:none !important;
			color:inherit !important;
		}
		/* This theme renders the made-to-order badge (p.stock.available-on-backorder)
		   INSIDE the price amount, as a sibling of the price number <bdi>. Flex that
		   amount so the price and badge sit on one line, TOP-aligned, badge 40px to
		   the right. Scoped to .woocommerce-variation-price so the first-load price
		   RANGE (in .product_price) is untouched. */
		.single-product .woocommerce-variation-price .woocommerce-Price-amount.amount{
			display:inline-flex !important;
			align-items:flex-start !important;
			flex-wrap:wrap;
		}
		.single-product .woocommerce-variation-price p.stock.available-on-backorder{
			margin:0 0 0 40px !important;
			padding:0 !important;
			font-size:16px;
			line-height:1.4;
		}
		.single-product p.stock.available-on-backorder{ color:inherit; }
		/* Remove the empty availability block + collapse the space around the price. */
		.single-product .woocommerce-variation-availability{ display:none !important; }
		.single-product .ac-fabric-swatch-ui{ margin-bottom:.4rem !important; }
		.single-product .single_variation_wrap,
		.single-product .woocommerce-variation.single_variation,
		.single-product .woocommerce-variation-description,
		.single-product .woocommerce-variation-price .price{ margin:0 !important; padding:0 !important; }
		.single-product .woocommerce-variation-price{ margin:.1em 0 0 0 !important; padding:0 !important; }
		.single-product .woocommerce-variation-add-to-cart{ margin-top:.6em !important; padding-top:0 !important; }
		@media (max-width:782px){
			.single-product .woocommerce-variation-price .woocommerce-Price-amount.amount{ display:block !important; }
			.single-product .woocommerce-variation-price p.stock.available-on-backorder{ margin:.5em 0 0 0 !important; }
		}
	</style>
	<script>
	jQuery(function ($) {
		var data = { lead: <?php echo wp_json_encode( $lead ); ?>, label: <?php echo wp_json_encode( $label ); ?>, season: <?php echo wp_json_encode( $season ); ?> };
		var $scope = $('.product_infos, .summary').first();
		if (!$scope.length) { $scope = $('body'); }

		function esc(t){ return $('<div>').text(t).html(); }

		// This theme renders the badge (p.stock.available-on-backorder) inside the
		// price amount. We only need to set its wording and keep it visible — CSS
		// lays it out beside the price. No relocation needed.
		function applyInline(lead, label){
			lead  = lead  || data.lead;
			label = label || data.label;
			if (!lead) { return; }
			var $badge = $scope.find('.woocommerce-variation-price p.available-on-backorder').first();
			if (!$badge.length) { $badge = $scope.find('p.available-on-backorder').first(); }
			if (!$badge.length) { return; }
			var html = (label ? esc(label) + ' ' : '') + '<span class="ac-lead-inline">in ' + esc(lead) + '</span>';
			if (data.season) { html += '<br><span class="ac-lead-season">' + esc(data.season) + '</span>'; }
			$badge.html(html).css('display', '');
		}

		applyInline();

		// Re-apply per selected variation (the variation JSON carries its own
		// resolved lead time / label from ac_lt_variation_lead()).
		$(document.body).on('show_variation', function (e, v) {
			applyInline(
				v && v.ac_lead_time  ? v.ac_lead_time  : data.lead,
				v && v.ac_lead_label ? v.ac_lead_label : data.label
			);
		});
	});
	</script>
	<?php
}

/** Back-compat: anything still calling ac_get_lead_time() defers to the plugin. */
if ( ! function_exists( 'ac_get_lead_time' ) ) {
	function ac_get_lead_time( $product_id ) {
		return function_exists( 'aclt_get_lead_time' ) ? aclt_get_lead_time( $product_id ) : '8-10 weeks';
	}
}
/* ===== OCTOBER COMMS ADDITION - END ===================================== */

/* =========================================================================
 * ===== OCTOBER COMMS ADDITION - START =====================================
 * Expose each variation's drawer preview image + price to the variations JSON
 * so the fabric drawer can show the correct render and a single price for the
 * size the customer has selected.
 * ========================================================================= */
add_filter( 'woocommerce_available_variation', 'ac_add_variation_drawer_preview', 10, 3 );
function ac_add_variation_drawer_preview( $data, $product, $variation ) {
  $preview = ac_get_fabric_drawer_preview_url( $variation->get_id(), 'woocommerce_single' );
  if ( ! $preview ) {
    $preview = ac_get_variation_image_preview_url( $data );
  }
  $data['ac_drawer_preview'] = $preview;
  return $data;
}
/* ===== OCTOBER COMMS ADDITION - END ===================================== */

/* =========================================================================
 * ===== OCTOBER COMMS ADDITION - START =====================================
 * "Order fabric swatches" button shown next to Add to Cart on fabric-drawer
 * products. Clicking it opens the fabric drawer (handled in fabric-drawer.js).
 * ========================================================================= */
add_action( 'woocommerce_after_add_to_cart_button', 'ac_order_swatches_button', 5 );
function ac_order_swatches_button() {
  if ( ! function_exists( 'is_product' ) || ! is_product() ) {
    return;
  }
  global $product;
  if ( ! $product || ! $product->is_type( 'variable' ) || ! ac_is_fabric_drawer_enabled( $product->get_id() ) ) {
    return;
  }
  if ( ac_get_swatch_product_id() <= 0 ) {
    return;
  }
  echo '<button type="button" class="ac-order-swatch-trigger">Order fabric swatches</button>';
}
/* ===== OCTOBER COMMS ADDITION - END ===================================== */