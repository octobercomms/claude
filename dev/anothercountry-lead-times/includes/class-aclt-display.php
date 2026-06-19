<?php
/**
 * Front-end output: the lead-time notice on product pages and the
 * [ac_lead_time] shortcode.
 */

defined( 'ABSPATH' ) || exit;

class ACLT_Display {

	public function __construct() {
		add_shortcode( 'ac_lead_time', [ $this, 'shortcode' ] );
		add_action( 'wp_enqueue_scripts', [ $this, 'enqueue' ] );

		$settings = aclt_get_settings();
		if ( ! empty( $settings['auto_display'] ) ) {
			// After the price / short description, before the add-to-cart button.
			add_action( 'woocommerce_single_product_summary', [ $this, 'render_single' ], 25 );
		}
	}

	public function enqueue(): void {
		wp_register_style( 'aclt-frontend', ACLT_URL . 'assets/css/frontend.css', [], ACLT_VERSION );
	}

	/**
	 * Build the notice markup for a product, or '' if there is nothing to show.
	 * (Optional standalone notice — the theme drives the main product page; this
	 * is for the shortcode or any spot the team wants a self-contained block.)
	 */
	public function notice_html( int $product_id ): string {
		$lead = ACLT_Resolver::get_lead_time( $product_id );
		if ( $lead === '' ) {
			return '';
		}

		$note   = ACLT_Resolver::get_lead_time_note( $product_id );
		$season = ACLT_Resolver::get_seasonal_note( $product_id );
		$text   = trim( $lead . ( $note !== '' ? ' ' . $note : '' ) );

		$settings = aclt_get_settings();
		$prefix   = trim( (string) ( $settings['prefix'] ?? '' ) );

		wp_enqueue_style( 'aclt-frontend' );

		$html  = '<div class="aclt-notice">';
		if ( $prefix !== '' ) {
			$html .= '<span class="aclt-label">' . esc_html( $prefix ) . '</span> ';
		}
		$html .= '<span class="aclt-value">' . esc_html( $text ) . '</span>';
		if ( $season !== '' ) {
			$html .= '<span class="aclt-season"><em>' . esc_html( $season ) . '</em></span>';
		}
		$html .= '</div>';

		/**
		 * Filter the rendered lead-time notice markup.
		 *
		 * @param string $html       Notice HTML.
		 * @param int    $product_id Product ID.
		 * @param string $text       Resolved lead-time text.
		 */
		return apply_filters( 'aclt_notice_html', $html, $product_id, $text );
	}

	public function render_single(): void {
		global $product;
		$id = $product instanceof WC_Product ? $product->get_id() : get_the_ID();
		if ( $id ) {
			echo $this->notice_html( (int) $id ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in notice_html().
		}
	}

	/**
	 * [ac_lead_time id="123"] — defaults to the current product.
	 */
	public function shortcode( $atts ): string {
		$atts = shortcode_atts( [ 'id' => 0 ], $atts, 'ac_lead_time' );
		$id   = absint( $atts['id'] );
		if ( ! $id ) {
			$id = get_the_ID();
		}
		if ( ! $id ) {
			return '';
		}
		return $this->notice_html( $id );
	}
}
