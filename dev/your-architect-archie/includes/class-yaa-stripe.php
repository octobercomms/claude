<?php
/**
 * Stripe payment gate + Connect payouts — SCAFFOLD STUB.
 *
 * The live flow: on submit (non-redirect), create a Stripe Checkout Session for
 * the package total to gate release of the full (un-watermarked) drawings, and
 * use Stripe Connect to split payouts to Tiam + any appointed consultants. Model
 * this on Hillcroft's HGD_Stripe / HGD_Payment / HGD_Woo once the keys are set.
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_Stripe {

	public static function init() {
		// TODO: register the Checkout webhook route to mark a project 'paid'
		// and release files. add_action( 'rest_api_init', ... ).
	}

	public static function is_configured() {
		return '' !== trim( (string) YAA_Settings::get( 'stripe_secret_key', '' ) );
	}

	/**
	 * Return a Checkout URL for the package total, or null if Stripe isn't wired.
	 *
	 * TODO: create a real Checkout Session via the Stripe API
	 * (line item = "Your Architect drawings", amount = total*100 GBP), with
	 * success/cancel URLs, and the project reference in metadata.
	 *
	 * @return string|null
	 */
	public static function checkout_url( $project_id, array $package ) {
		if ( ! self::is_configured() ) {
			return null; // front end falls back to the "saved" confirmation.
		}
		/** Let an integration provide the URL without editing core. */
		return apply_filters( 'yaa_stripe_checkout_url', null, $project_id, $package );
	}
}
