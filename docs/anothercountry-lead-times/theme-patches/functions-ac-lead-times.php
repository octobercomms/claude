<?php
/**
 * REPLACEMENT for the "OCTOBER COMMS — PDP trust chips" block in the theme's
 * functions.php (merchandiser-child).
 *
 * Behaviour (v2):
 *  - Lead time shows INLINE right under the price/badge (no tooltip, no chip
 *    line). The seasonal note appears under it automatically when active.
 *  - The trust-chip "Delivered in … weeks" line is removed; chips now carry only
 *    Free UK delivery + (made-to-order) Customise.
 *  - Resolves the "Made to Order + In Stock" double label (keeps Made to Order;
 *    shows the selected variation's true status as variations change).
 *  - All lead-time wording comes from the Another Country Lead Times plugin.
 *
 * Deploy: replace the whole functions.php with the generated file, or paste this
 * (minus the first `<?php` line) over the old OCTOBER COMMS PDP block.
 */

defined( 'ABSPATH' ) || exit;

/** Is this a made-to-order furniture product? (not currently in stock) */
function ac_lt_is_made_to_order( $product ) {
	if ( ! $product ) {
		return false;
	}
	$furniture_cats = array( 'armadillo', 'furniture', 'rose-cottage', 'outdoor-tables', 'outdoor-furniture', 'outdoor-benches', 'outdoor', 'office', 'living-room-furniture', 'kids-furniture', 'in-stock-furniture', 'dining-tables', 'dining-room', 'dining-chairs', 'desks', 'day-beds', 'console-tables', 'coffee-tables', 'chests', 'benches', 'beds', 'bedroom', 'armchairs', 'chairs-benches', 'task-chairs', 'tables', 'stools', 'sofas-armchairs-day-beds', 'sofas', 'sofa-beds', 'sideboard', 'side-tables', 'shelving' );
	return has_term( $furniture_cats, 'product_cat', $product->get_id() ) && 'instock' !== $product->get_stock_status();
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
 * Inline lead time under the price/badge + the "Made to Order / In Stock"
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
	$season = '';
	if ( ac_lt_is_made_to_order( $product ) ) {
		$pid    = $product->get_id();
		$lead   = function_exists( 'aclt_get_lead_time' ) ? aclt_get_lead_time( $pid ) : '8-10 weeks';
		$season = function_exists( 'aclt_get_seasonal_note' ) ? aclt_get_seasonal_note( $pid ) : '';
	}
	?>
	<style>
		/* Remove the old CSS tooltip + its info icon on the stock labels
		   (no template edit needed). */
		.single-product p.available-on-backorder:before,
		.single-product p.available-on-backorder:after,
		.single-product p.stock.in-stock:before,
		.single-product p.stock.in-stock:after{
			content:none !important;
			display:none !important;
		}
		/* Lead time + seasonal note are appended inside the "Made to Order"
		   badge (with a line break) so they share its font and colour. */
		.single-product .ac-lead-season{ display:inline-block; margin-top:.15em; }
		/* The badge is not a real link — neutralise the old tooltip trigger. */
		.single-product p.available-on-backorder{ cursor:default !important; }
		.single-product p.available-on-backorder a{
			pointer-events:none !important;
			cursor:default !important;
			text-decoration:none !important;
			color:inherit !important;
		}
	</style>
	<script>
	jQuery(function ($) {
		var data = { lead: <?php echo wp_json_encode( $lead ); ?>, season: <?php echo wp_json_encode( $season ); ?> };
		var $scope = $('.product_infos, .summary').first();
		if (!$scope.length) { $scope = $('body'); }

		function esc(t){ return $('<div>').text(t).html(); }

		// 1) Resolve the "Made to Order + In Stock" oxymoron — keep Made to Order.
		function resolveOxymoron(){
			var $bo = $scope.find('p.available-on-backorder:visible');
			var $is = $scope.find('p.stock.in-stock:visible');
			if ($bo.length && $is.length) { $is.hide(); }
		}

		// 2) Append the lead time (and seasonal note, on a new line) to the badge
		//    → "Made to Order in 8-12 weeks" / "Allow up to 15 weeks…".
		function applyInline(){
			if (!data.lead) { return; }
			var $badge = $scope.find('p.available-on-backorder:visible').first();
			if (!$badge.length) { return; } // only on made-to-order
			if ($badge.find('.ac-lead-inline').length) { return; }
			var add = '<span class="ac-lead-inline"> in ' + esc(data.lead) + '</span>';
			if (data.season) { add += '<br><span class="ac-lead-season">' + esc(data.season) + '</span>'; }
			$badge.append(add);
		}

		function refresh(){ resolveOxymoron(); applyInline(); }
		refresh();

		// 3) Keep a single, correct status (and appended lead time) as variations change.
		$(document.body).on('show_variation', function (e, v) {
			var $var = $('.woocommerce-variation-availability p.stock');
			if ($var.length) {
				$scope.find('p.stock').not($var).hide();
				$var.show();
			} else {
				$scope.find('p.available-on-backorder').hide();
				$scope.find('p.stock.in-stock').show();
			}
			refresh();
		});
	});
	</script>
	<?php
}

/** Back-compat: anything still calling ac_get_lead_time() keeps working. */
if ( ! function_exists( 'ac_get_lead_time' ) ) {
	function ac_get_lead_time( $product_id ) {
		return function_exists( 'aclt_get_lead_time' ) ? aclt_get_lead_time( $product_id ) : '8-10 weeks';
	}
}
