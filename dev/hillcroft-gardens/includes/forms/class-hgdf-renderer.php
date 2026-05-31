<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGDF_Renderer {

	public static function init() {
		add_shortcode( 'hgd_form', array( __CLASS__, 'shortcode' ) );
		// Back-compat alias in case anything embedded the earlier name.
		add_shortcode( 'hgd_form', array( __CLASS__, 'shortcode' ) );
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'register_assets' ) );
		add_action( 'init', array( __CLASS__, 'register_block' ) );
	}

	public static function register_assets() {
		wp_register_style( 'hgd-forms', HGDF_URL . 'assets/forms/css/frontend.css', array(), HGDF_VERSION );
		wp_register_script( 'hgd-forms', HGDF_URL . 'assets/forms/js/frontend.js', array(), HGDF_VERSION, true );

		if ( HGDF_Spam::turnstile_site_key() ) {
			wp_register_script( 'cf-turnstile', 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', array(), null, true );
		}
	}

	public static function register_block() {
		if ( function_exists( 'register_block_type' ) ) {
			register_block_type( 'hgd/form', array(
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
		if ( ! $form_id || ! HGDF_CPT::exists( $form_id ) ) {
			return '<div class="hgd-form-error">Form not found.</div>';
		}
		$schema = HGDF_Schema::get( $form_id );

		wp_enqueue_style( 'hgd-forms' );
		wp_enqueue_script( 'hgd-forms' );
		if ( ! empty( $schema['spam']['turnstile'] ) && HGDF_Spam::turnstile_site_key() ) {
			wp_enqueue_script( 'cf-turnstile' );
		}
		self::maybe_enqueue_webfont( $schema['theme']['font'] ?? '' );

		$config = array(
			'formId'       => $form_id,
			'restUrl'      => esc_url_raw( rest_url( HGDF_REST_API::NAMESPACE . '/' ) ),
			'nonce'        => wp_create_nonce( 'wp_rest' ),
			'schema'       => $schema,
			'turnstileKey' => ( ! empty( $schema['spam']['turnstile'] ) && HGDF_Spam::turnstile_enabled() ) ? HGDF_Spam::turnstile_site_key() : '',
		);

		ob_start();
		?>
		<div class="hgd-form-form-root"
			 id="hgd-form-<?php echo (int) $form_id; ?>"
			 data-hgd-form-config="<?php echo esc_attr( wp_json_encode( $config ) ); ?>"
			 style="<?php echo esc_attr( self::theme_vars( $schema['theme'] ) ); ?>">
			<noscript><div class="hgd-form-error">This form requires JavaScript.</div></noscript>
			<div class="hgd-form-loading">Loading form…</div>
		</div>
		<?php
		return ob_get_clean();
	}

	public static function theme_vars( $theme ) {
		$font = trim( (string) ( $theme['font'] ?? '' ) );
		$map = array(
			'--hgd-form-primary'    => $theme['primary']    ?? '#111111',
			'--hgd-form-accent'     => $theme['accent']     ?? '#f59e0b',
			'--hgd-form-font'       => self::font_stack( $font ),
			'--hgd-form-radius'     => $theme['radius']     ?? '8px',
			'--hgd-form-background' => $theme['background'] ?? '#ffffff',
		);
		$out = array();
		foreach ( $map as $k => $v ) {
			$out[] = $k . ':' . $v;
		}
		return implode( ';', $out );
	}

	/**
	 * Build a safe CSS font stack from the user-provided font name.
	 * Empty or a recognised "system" alias collapses to the system stack.
	 */
	private static function font_stack( $font ) {
		$system_fallback = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
		if ( $font === '' || in_array( strtolower( $font ), array( 'system', 'system-ui', 'sans-serif', 'default' ), true ) ) {
			return $system_fallback;
		}
		// Strip risky chars to avoid CSS injection in the inline style attr.
		$font = preg_replace( '/[^A-Za-z0-9 _-]/', '', $font );
		if ( $font === '' ) { return $system_fallback; }
		return sprintf( '"%s", %s', $font, $system_fallback );
	}

	/**
	 * Auto-load the font from Google Fonts when it isn't a system stack.
	 * Most modern brand fonts live there; if a font doesn't exist, the
	 * stylesheet 404s harmlessly and the form falls back to system fonts.
	 */
	private static function maybe_enqueue_webfont( $font ) {
		$font = trim( (string) $font );
		if ( $font === '' ) { return; }
		if ( in_array( strtolower( $font ), array( 'system', 'system-ui', 'sans-serif', 'default', 'arial', 'helvetica', 'georgia', 'times', 'times new roman', 'courier', 'courier new', 'verdana', 'tahoma' ), true ) ) {
			return;
		}
		$clean = preg_replace( '/[^A-Za-z0-9 _-]/', '', $font );
		if ( $clean === '' ) { return; }
		$family = str_replace( ' ', '+', $clean );
		$url    = sprintf( 'https://fonts.googleapis.com/css2?family=%s:wght@400;500;600;700&display=swap', $family );
		wp_enqueue_style( 'hgd-form-font-' . sanitize_key( $clean ), $url, array(), null );
	}
}
