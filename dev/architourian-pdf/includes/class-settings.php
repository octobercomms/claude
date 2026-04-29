<?php
/**
 * Plugin settings page — global brand assets and contact details.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class AIPDF_Settings {

	const OPTION = 'aipdf_settings';

	public static function init() {
		add_action( 'admin_menu', [ __CLASS__, 'add_menu' ] );
		add_action( 'admin_init', [ __CLASS__, 'register_settings' ] );
		add_action( 'admin_enqueue_scripts', [ __CLASS__, 'enqueue_media' ] );
	}

	public static function add_menu() {
		add_options_page(
			'Architourian PDF',
			'Architourian PDF',
			'manage_options',
			'aipdf-settings',
			[ __CLASS__, 'render_page' ]
		);
	}

	public static function register_settings() {
		register_setting( 'aipdf_settings_group', self::OPTION, [ __CLASS__, 'sanitize' ] );
	}

	public static function sanitize( $input ) {
		$clean = [];
		$text_fields = [
			'brand_name', 'contact_name', 'contact_phone',
			'contact_email', 'contact_website',
		];
		foreach ( $text_fields as $key ) {
			$clean[ $key ] = isset( $input[ $key ] ) ? sanitize_text_field( $input[ $key ] ) : '';
		}
		$id_fields = [ 'logo_mark_id', 'logo_mark_cover_id' ];
		foreach ( $id_fields as $key ) {
			$clean[ $key ] = isset( $input[ $key ] ) ? absint( $input[ $key ] ) : 0;
		}
		return $clean;
	}

	public static function enqueue_media( $hook ) {
		if ( 'settings_page_aipdf-settings' !== $hook ) {
			return;
		}
		wp_enqueue_media();
		wp_enqueue_script(
			'aipdf-admin',
			AIPDF_URL . 'assets/js/admin.js',
			[ 'jquery' ],
			AIPDF_VERSION,
			true
		);
	}

	public static function get( $key, $default = '' ) {
		$opts = get_option( self::OPTION, [] );
		return isset( $opts[ $key ] ) ? $opts[ $key ] : $default;
	}

	public static function render_page() {
		$opts = get_option( self::OPTION, [] );
		?>
		<div class="wrap">
			<h1>Architourian PDF — Settings</h1>
			<p>These values appear on every generated PDF. Upload SVG files via the media library.</p>
			<form method="post" action="options.php">
				<?php settings_fields( 'aipdf_settings_group' ); ?>
				<table class="form-table">
					<tr>
						<th scope="row"><label for="aipdf_brand_name">Brand Name</label></th>
						<td>
							<input type="text" id="aipdf_brand_name" name="<?php echo self::OPTION; ?>[brand_name]"
								value="<?php echo esc_attr( $opts['brand_name'] ?? 'Architourian' ); ?>" class="regular-text" />
						</td>
					</tr>
					<tr>
						<th scope="row">Logo Mark (inner pages &amp; cover footer)</th>
						<td>
							<?php self::render_svg_upload( 'logo_mark_id', $opts['logo_mark_id'] ?? 0 ); ?>
							<p class="description">Small square bracket icon used in the bottom-left of the cover and header of inner pages.</p>
						</td>
					</tr>
					<tr>
						<th scope="row">Contact Name</th>
						<td><input type="text" name="<?php echo self::OPTION; ?>[contact_name]"
							value="<?php echo esc_attr( $opts['contact_name'] ?? '' ); ?>" class="regular-text" /></td>
					</tr>
					<tr>
						<th scope="row">Contact Phone</th>
						<td><input type="text" name="<?php echo self::OPTION; ?>[contact_phone]"
							value="<?php echo esc_attr( $opts['contact_phone'] ?? '' ); ?>" class="regular-text" /></td>
					</tr>
					<tr>
						<th scope="row">Contact Email</th>
						<td><input type="text" name="<?php echo self::OPTION; ?>[contact_email]"
							value="<?php echo esc_attr( $opts['contact_email'] ?? '' ); ?>" class="regular-text" /></td>
					</tr>
					<tr>
						<th scope="row">Website</th>
						<td><input type="text" name="<?php echo self::OPTION; ?>[contact_website]"
							value="<?php echo esc_attr( $opts['contact_website'] ?? '' ); ?>" class="regular-text" /></td>
					</tr>
				</table>
				<?php submit_button(); ?>
			</form>

			<hr>
			<h2>Custom Field Reference</h2>
			<p>Add these field names to your JetEngine / ACF / Crocoblock setup on your Tour post type:</p>
			<table class="widefat striped" style="max-width:700px">
				<thead><tr><th>Field Name</th><th>Type</th><th>Description</th></tr></thead>
				<tbody>
					<tr><td><code>pdf_cover_svg_id</code></td><td>Media / Number</td><td>Cover page illustration (SVG attachment ID)</td></tr>
					<tr><td><code>pdf_tour_subtitle</code></td><td>Text</td><td>Tour subtitle shown in header &amp; cover (e.g. "100 years of Architecture in India")</td></tr>
					<tr><td><code>pdf_tour_reference</code></td><td>Text</td><td>Reference code shown vertically on right edge (e.g. INDEMP20250225)</td></tr>
					<tr><td><code>pdf_trip_description</code></td><td>Textarea</td><td>Trip name / overview text (left column, overview page)</td></tr>
					<tr><td><code>pdf_starting_point</code></td><td>Text</td><td>e.g. "New Delhi."</td></tr>
					<tr><td><code>pdf_end_point</code></td><td>Text</td><td>e.g. "Chandigarh Airport or Railway Station."</td></tr>
					<tr><td><code>pdf_group_info</code></td><td>Textarea</td><td>e.g. "Maximum group size of 8."</td></tr>
					<tr><td><code>pdf_cost_info</code></td><td>Textarea</td><td>e.g. "Cost for a double room: £3,300 per person"</td></tr>
					<tr><td><code>pdf_included_text</code></td><td>Textarea / WYSIWYG</td><td>"Included in the trip" section body text</td></tr>
					<tr><td><code>pdf_day_1</code> … <code>pdf_day_12</code></td><td>Textarea</td><td>Day-by-day content. Each line starting with – is a bullet point.</td></tr>
					<tr><td><code>pdf_days_svg_id</code></td><td>Media / Number</td><td>SVG illustration shown bottom-right of day pages</td></tr>
					<tr><td><code>pdf_back_cover_svg_id</code></td><td>Media / Number</td><td>Back cover page illustration</td></tr>
				</tbody>
			</table>
		</div>
		<?php
	}

	private static function render_svg_upload( $field_key, $attachment_id ) {
		$url    = $attachment_id ? wp_get_attachment_url( $attachment_id ) : '';
		$option = self::OPTION . '[' . $field_key . ']';
		?>
		<div class="aipdf-media-upload" data-field="<?php echo esc_attr( $field_key ); ?>">
			<input type="hidden" name="<?php echo esc_attr( $option ); ?>"
				id="aipdf_<?php echo esc_attr( $field_key ); ?>"
				value="<?php echo esc_attr( $attachment_id ); ?>" />
			<button type="button" class="button aipdf-upload-btn">
				<?php echo $attachment_id ? 'Change SVG' : 'Upload SVG'; ?>
			</button>
			<?php if ( $url ) : ?>
				<span class="aipdf-filename"><?php echo esc_html( basename( $url ) ); ?></span>
				<a href="#" class="aipdf-remove-btn" style="color:red;margin-left:8px;">Remove</a>
			<?php endif; ?>
		</div>
		<?php
	}
}
