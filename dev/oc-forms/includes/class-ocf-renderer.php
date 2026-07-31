<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCF_Renderer {

	public static function init() {
		add_shortcode( 'nvelope_form', array( __CLASS__, 'shortcode' ) );
		// Back-compat alias in case anything embedded the earlier name.
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
			register_block_type( 'nvelope/form', array(
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
		self::maybe_enqueue_webfont( $schema['theme']['font'] ?? '' );

		$config = array(
			'formId'       => $form_id,
			'restUrl'      => esc_url_raw( rest_url( OCF_REST_API::NAMESPACE . '/' ) ),
			'nonce'        => wp_create_nonce( 'wp_rest' ),
			'schema'       => self::client_schema( $schema ),
			'turnstileKey' => ( ! empty( $schema['spam']['turnstile'] ) && OCF_Spam::turnstile_enabled() ) ? OCF_Spam::turnstile_site_key() : '',
			'fileField'    => self::first_file_field( $schema ),
		);

		$root_class = 'ocf-form-root';
		if ( ( $schema['mode'] ?? 'standard' ) === 'ai' ) {
			$root_class .= ' ocf-ai';
		}

		ob_start();
		?>
		<div class="<?php echo esc_attr( $root_class ); ?>"
			 id="ocf-<?php echo (int) $form_id; ?>"
			 data-ocf-config="<?php echo esc_attr( wp_json_encode( $config ) ); ?>"
			 style="<?php echo esc_attr( self::theme_vars( $schema['theme'] ) ); ?>">
			<noscript><div class="ocf-error">This form requires JavaScript.</div></noscript>
			<div class="ocf-loading">Loading form…</div>
		</div>
		<?php
		return ob_get_clean();
	}

	/**
	 * Trim the schema to what the browser actually needs, stripping anything
	 * sensitive. The assistant persona, model override, and Brevo maps must
	 * never reach the client; in AI mode the raw question list isn't needed
	 * either (the server drives the conversation).
	 */
	private static function client_schema( $schema ) {
		$client = $schema;

		// Never expose the AI persona or model override to the browser.
		if ( isset( $client['ai'] ) && is_array( $client['ai'] ) ) {
			unset( $client['ai']['persona'], $client['ai']['model'] );
		}
		// Integration internals are server-only.
		unset( $client['brevo'], $client['notifications'] );

		// In AI mode the front-end only renders a chat — it doesn't need the
		// steps/questions (the server holds them).
		if ( ( $client['mode'] ?? 'standard' ) === 'ai' ) {
			unset( $client['steps'] );
		}

		return $client;
	}

	/**
	 * The first file-upload question in the form (AI mode only), so the chat
	 * composer can always offer a persistent Attach control. Null if none.
	 */
	private static function first_file_field( $schema ) {
		if ( ( $schema['mode'] ?? 'standard' ) !== 'ai' ) {
			return null;
		}
		foreach ( (array) ( $schema['steps'] ?? array() ) as $step ) {
			foreach ( (array) ( $step['questions'] ?? array() ) as $q ) {
				if ( ( $q['type'] ?? '' ) === 'file_upload' ) {
					return array(
						'field_id'    => $q['id'],
						'accept'      => (string) ( $q['accept'] ?? '' ),
						'multiple'    => ! empty( $q['multiple'] ),
						'max_size_mb' => ! empty( $q['max_size_mb'] ) ? (int) $q['max_size_mb'] : 20,
					);
				}
			}
		}
		return null;
	}

	public static function theme_vars( $theme ) {
		$font = trim( (string) ( $theme['font'] ?? '' ) );
		$map = array(
			'--ocf-primary'    => $theme['primary']    ?? '#111111',
			'--ocf-accent'     => $theme['accent']     ?? '#f59e0b',
			'--ocf-font'       => self::font_stack( $font ),
			'--ocf-radius'     => $theme['radius']     ?? '8px',
			'--ocf-background' => $theme['background'] ?? '#ffffff',
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
		wp_enqueue_style( 'ocf-font-' . sanitize_key( $clean ), $url, array(), null );
	}
}
