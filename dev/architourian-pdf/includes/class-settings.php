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
		$id_fields = [ 'logo_mark_id', 'wordmark_id', 'ballinger_mono_id', 'tt_nooks_id' ];
		foreach ( $id_fields as $key ) {
			$clean[ $key ] = isset( $input[ $key ] ) ? absint( $input[ $key ] ) : 0;
		}
		$clean['terms_text'] = isset( $input['terms_text'] )
			? wp_kses_post( $input['terms_text'] )
			: '';
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
						<th scope="row">Corner Logo (cover &amp; back cover)</th>
						<td>
							<?php self::render_svg_upload( 'logo_mark_id', $opts['logo_mark_id'] ?? 0 ); ?>
							<p class="description">Small square bracket icon shown bottom-left of the cover page and back cover.</p>
						</td>
					</tr>
					<tr>
						<th scope="row">Wordmark SVG (inner page headers)</th>
						<td>
							<?php self::render_svg_upload( 'wordmark_id', $opts['wordmark_id'] ?? 0 ); ?>
							<p class="description">The "Architourian" wordmark SVG used in the header of every inner page. Falls back to plain text if not set.</p>
						</td>
					</tr>
					<tr>
						<th scope="row">Body Font — Ballinger Mono TTF</th>
						<td>
							<?php self::render_file_upload( 'ballinger_mono_id', $opts['ballinger_mono_id'] ?? 0 ); ?>
							<p class="description">Upload <strong>BallingerMono-Regular.ttf</strong> (or similar). Used for all body text in generated PDFs.</p>
						</td>
					</tr>
					<tr>
						<th scope="row">Heading Font — TT Nooks TTF</th>
						<td>
							<?php self::render_file_upload( 'tt_nooks_id', $opts['tt_nooks_id'] ?? 0 ); ?>
							<p class="description">Upload <strong>TTNooks-Regular.ttf</strong> (or similar). Used for day headings and section titles.</p>
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
					<tr>
						<th scope="row"><label for="aipdf_terms_text">Terms &amp; Conditions Text</label></th>
						<td>
							<p class="description" style="margin-bottom:6px;">
								Global T&amp;C appended to every itinerary PDF. Use numbered headings like <code>1) Your Fitness</code>.
								Paste plain text — line breaks are preserved, or use basic HTML.
								Override per-tour with the <code>pdf_terms_text</code> custom field.
							</p>
							<?php
							wp_editor(
								$opts['terms_text'] ?? '',
								'aipdf_terms_text',
								[
									'textarea_name' => self::OPTION . '[terms_text]',
									'textarea_rows' => 20,
									'media_buttons' => false,
									'teeny'         => true,
								]
							);
							?>
						</td>
					</tr>
				</table>
				<?php submit_button(); ?>
			</form>

			<hr>
			<h2>Fields used automatically (already on your Tours)</h2>
			<p>These existing fields are read directly — no changes needed:</p>
			<table class="widefat striped" style="max-width:700px">
				<thead><tr><th>Field Name</th><th>Used for</th></tr></thead>
				<tbody>
					<tr><td><code>day_1_title</code> … <code>day_12_title</code></td><td>Day headings on day pages</td></tr>
					<tr><td><code>day_1_text</code> … <code>day_12_text</code></td><td>Day content on day pages</td></tr>
					<tr><td><code>included_1</code> … <code>included_10</code></td><td>"Included in the trip" list items</td></tr>
					<tr><td><code>not_included_1</code> … <code>not_included_10</code></td><td>"Not included" list items</td></tr>
					<tr><td><code>guide_price</code></td><td>Price column on overview page (shortcodes parsed automatically)</td></tr>
					<tr><td><code>group_size</code></td><td>Group size on overview page</td></tr>
					<tr><td><code>nights</code></td><td>Nights count on overview page</td></tr>
				</tbody>
			</table>

			<h2 style="margin-top:20px;">New fields to create in JetEngine</h2>
			<p>Add these <strong>8 new fields</strong> to your Tour post type:</p>
			<table class="widefat striped" style="max-width:700px">
				<thead><tr><th>Field Name</th><th>Type</th><th>Description</th></tr></thead>
				<tbody>
					<tr><td><code>pdf_cover_svg_id</code></td><td>Media / Number</td><td>Cover page illustration — attachment ID of uploaded SVG</td></tr>
					<tr><td><code>pdf_tour_subtitle</code></td><td>Text</td><td>Subtitle shown in PDF header &amp; cover footer (e.g. "100 years of Architecture in India")</td></tr>
					<tr><td><code>pdf_tour_reference</code></td><td>Text</td><td>Reference code on right edge (e.g. INDEMP20250225)</td></tr>
					<tr><td><code>pdf_trip_description</code></td><td>Textarea</td><td>Left column on overview page — trip name &amp; summary</td></tr>
					<tr><td><code>pdf_starting_point</code></td><td>Text</td><td>e.g. "New Delhi."</td></tr>
					<tr><td><code>pdf_end_point</code></td><td>Text</td><td>e.g. "Chandigarh Airport or Railway Station."</td></tr>
					<tr><td><code>pdf_days_svg_id</code></td><td>Media / Number</td><td>SVG illustration bottom-right of final day page</td></tr>
					<tr><td><code>pdf_back_cover_svg_id</code></td><td>Media / Number</td><td>Back cover SVG illustration</td></tr>
					<tr><td><code>pdf_terms_text</code></td><td>Textarea</td><td><em>Optional.</em> Per-tour T&amp;C override. Blank = uses global T&amp;C from plugin settings.</td></tr>
				</tbody>
			</table>
		</div>
		<?php
	}

	/** Font upload — identical to SVG upload but labels say "Upload Font" / "Change Font". */
	private static function render_file_upload( $field_key, $attachment_id ) {
		$url    = $attachment_id ? wp_get_attachment_url( $attachment_id ) : '';
		$option = self::OPTION . '[' . $field_key . ']';
		?>
		<div class="aipdf-media-upload" data-field="<?php echo esc_attr( $field_key ); ?>">
			<input type="hidden" name="<?php echo esc_attr( $option ); ?>"
				id="aipdf_<?php echo esc_attr( $field_key ); ?>"
				value="<?php echo esc_attr( $attachment_id ); ?>" />
			<button type="button" class="button aipdf-upload-btn">
				<?php echo $attachment_id ? 'Change Font' : 'Upload Font (.ttf)'; ?>
			</button>
			<?php if ( $url ) : ?>
				<span class="aipdf-filename"><?php echo esc_html( basename( $url ) ); ?></span>
				<a href="#" class="aipdf-remove-btn" style="color:red;margin-left:8px;">Remove</a>
			<?php endif; ?>
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
