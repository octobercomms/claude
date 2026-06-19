<?php
/**
 * REPLACEMENT for the "OCTOBER COMMS ADDITION — PDP trust chips" block in the
 * theme's functions.php (merchandiser-child).
 *
 * Deploy: delete the entire old block between
 *   "===== OCTOBER COMMS ADDITION - START ... PDP trust chips ..."
 *   and its matching "===== OCTOBER COMMS ADDITION - END ====="
 * (the `ac_lead_time_field`, `ac_save_lead_time_field`, `ac_get_lead_time` and
 *  `ac_pdp_trust_chips` functions) and paste this in its place.
 *
 * What changed vs the old block:
 *  - The per-product "Lead time" field + its save are GONE from here — the
 *    Another Country Lead Times plugin now owns the `_ac_lead_time` field on the
 *    product General tab (same meta key, so existing data is preserved).
 *  - Lead time, supplier note and the seasonal line all come from the plugin
 *    (one source of truth). The hardcoded "Allow up to 15 weeks…" line is gone.
 *  - The chip no longer repeats availability ("Made to order…" / "In stock.") —
 *    the approved green badge by the price is the single place that's stated.
 *  - Safe fallbacks are kept, so if the plugin is ever deactivated the page
 *    still shows sensible wording (today's behaviour).
 */

defined( 'ABSPATH' ) || exit;

/** Frontend: render the trust chips above the add-to-cart form. */
add_action( 'woocommerce_after_add_to_cart_form', 'ac_pdp_trust_chips', 20 );
function ac_pdp_trust_chips() {
	if ( ! function_exists( 'is_product' ) || ! is_product() ) {
		return;
	}
	global $product;
	if ( ! $product ) {
		return;
	}

	$pid = $product->get_id();

	$furniture_cats = array( 'armadillo', 'furniture', 'rose-cottage', 'outdoor-tables', 'outdoor-furniture', 'outdoor-benches', 'outdoor', 'office', 'living-room-furniture', 'kids-furniture', 'in-stock-furniture', 'dining-tables', 'dining-room', 'dining-chairs', 'desks', 'day-beds', 'console-tables', 'coffee-tables', 'chests', 'benches', 'beds', 'bedroom', 'armchairs', 'chairs-benches', 'task-chairs', 'tables', 'stools', 'sofas-armchairs-day-beds', 'sofas', 'sofa-beds', 'sideboard', 'side-tables', 'shelving' );
	$is_furniture  = has_term( $furniture_cats, 'product_cat', $pid );
	$is_instock    = ( 'instock' === $product->get_stock_status() );
	$made_to_order = ( $is_furniture && ! $is_instock );

	// --- Lead-time wording from the central plugin (with safe fallbacks) ------
	$lead   = function_exists( 'aclt_get_lead_time' )      ? aclt_get_lead_time( $pid )      : '8-10 weeks';
	$note   = function_exists( 'aclt_get_lead_time_note' ) ? aclt_get_lead_time_note( $pid ) : '';
	$season = function_exists( 'aclt_get_seasonal_note' )  ? aclt_get_seasonal_note( $pid )
		: 'Allow up to 15 weeks for orders placed July to September.';

	$lead   = esc_html( $lead );
	$note   = esc_html( $note );
	$season = esc_html( $season );

	// Simple line icons (stroke uses currentColor, coloured via CSS).
	$ic_clock  = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
	$ic_truck  = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h11v9H3z"/><path d="M14 9h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/></svg>';
	$ic_pencil = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>';

	echo '<ul class="ac-trust-chips">';

	// Availability is shown by the badge near the price — these chips carry only
	// the lead-time / dispatch detail (no duplication).
	if ( $made_to_order ) {
		$line = 'Delivered in <strong>' . $lead . ' lead time.</strong>';
		if ( '' !== $note ) {
			$line .= ' ' . $note;
		}
		if ( '' !== $season ) {
			$line .= '<br /><em>' . $season . '</em>';
		}
		echo '<li class="ac-trust-chip"><span class="ac-trust-ic">' . $ic_clock . '</span><span class="ac-trust-tx">' . $line . '</span></li>';
	} elseif ( $is_instock ) {
		$dispatch = $is_furniture ? 'typically within 1&ndash;3 weeks' : 'within 2&ndash;3 working days';
		echo '<li class="ac-trust-chip"><span class="ac-trust-ic">' . $ic_clock . '</span><span class="ac-trust-tx">Ready to dispatch, ' . $dispatch . '.</span></li>';
	}

	echo '<li class="ac-trust-chip"><span class="ac-trust-ic">' . $ic_truck . '</span><span class="ac-trust-tx"><strong>Free UK delivery</strong> on orders over &pound;1,500. International delivery quoted by location.</span></li>';

	if ( $made_to_order ) {
		echo '<li class="ac-trust-chip"><span class="ac-trust-ic">' . $ic_pencil . '</span><span class="ac-trust-tx">We can adapt this to meet your specific requirements. <a class="ac-trust-link ac-open-customise" href="#ac-customise-modal">Customise your order</a></span></li>';
	}

	echo '</ul>';

	// Customise modal (Gravity Form 12), made-to-order products only.
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
 * Back-compat: anything else that still calls ac_get_lead_time() keeps working,
 * now reading from the plugin. Safe to remove once nothing references it.
 */
if ( ! function_exists( 'ac_get_lead_time' ) ) {
	function ac_get_lead_time( $product_id ) {
		return function_exists( 'aclt_get_lead_time' ) ? aclt_get_lead_time( $product_id ) : '8-10 weeks';
	}
}
