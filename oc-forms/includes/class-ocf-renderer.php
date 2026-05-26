<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCF_Renderer {

	public static function init() {
		add_shortcode( 'oc_form', array( __CLASS__, 'shortcode' ) );
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'register_assets' ) );
		add_action( 'init', array( __CLASS__, 'register_block' ) );
	}

	public static function register_assets() {
		wp_register_style( 'oc-forms', OCF_URL . 'assets/css/frontend.css', array(), OCF_VERSION );
		wp_register_script( 'oc-forms', OCF_URL . 'assets/js/frontend.js', array(), OCF_VERSION, true );

		if ( OCF_Spam::turnstile_site_key() ) {
			wp_register_script( 'cf-turnstile', 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', array(), null, true );
		}
	}

	public static function register_block() {
		if ( function_exists( 'register_block_type' ) ) {
			register_block_type( 'oc/form', array(
				'attributes'      => array(
					'formId' => array( 'type' => 'integer', 'default' => 0 ),
				),
				'render_callback' => function ( $attrs ) {
					return self::render( (int) ( $attrs['formId'] ?? 0 ) );
				},
			) );
		}
	}

	public static function shortcode( $atts ) {
		$atts = shortcode_atts( array( 'id' => 0 ), $atts );
		return self::render( (int) $atts['id'] );
	}

	public static function render( $form_id ) {
		if ( ! $form_id || ! OCF_CPT::exists( $form_id ) ) {
			return '<div class="ocf-error">Form not found.</div>';
		}
		$schema = OCF_Schema::get( $form_id );

		wp_enqueue_style( 'oc-forms' );
		wp_enqueue_script( 'oc-forms' );
		if ( ! empty( $schema['spam']['turnstile'] ) && OCF_Spam::turnstile_site_key() ) {
			wp_enqueue_script( 'cf-turnstile' );
		}

		$config = array(
			'formId'       => $form_id,
			'restUrl'      => esc_url_raw( rest_url( OCF_REST_API::NAMESPACE . '/' ) ),
			'nonce'        => wp_create_nonce( 'wp_rest' ),
			'schema'       => $schema,
			'turnstileKey' => ( ! empty( $schema['spam']['turnstile'] ) && OCF_Spam::turnstile_enabled() ) ? OCF_Spam::turnstile_site_key() : '',
		);

		ob_start();
		?>
		<div class="ocf-form-root"
			 id="ocf-<?php echo (int) $form_id; ?>"
			 data-ocf-config="<?php echo esc_attr( wp_json_encode( $config ) ); ?>"
			 style="<?php echo esc_attr( self::theme_vars( $schema['theme'] ) ); ?>">
			<noscript><div class="ocf-error">This form requires JavaScript.</div></noscript>
			<div class="ocf-loading">Loading form…</div>
		</div>
		<?php
		return ob_get_clean();
	}

	public static function theme_vars( $theme ) {
		$map = array(
			'--ocf-primary'    => $theme['primary']    ?? '#111',
			'--ocf-accent'     => $theme['accent']     ?? '#f59e0b',
			'--ocf-font'       => $theme['font']       ? sprintf( '"%s", system-ui, sans-serif', $theme['font'] ) : 'system-ui, sans-serif',
			'--ocf-radius'     => $theme['radius']     ?? '8px',
			'--ocf-background' => $theme['background'] ?? '#f5f5f5',
		);
		$out = array();
		foreach ( $map as $k => $v ) {
			$out[] = $k . ':' . $v;
		}
		return implode( ';', $out );
	}
}
