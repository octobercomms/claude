<?php
/**
 * PDF generation logic using mPDF.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class AIPDF_PDF_Generator {

	// A4 layout constants (mm)
	const PW   = 210;  // page width
	const PH   = 297;  // page height
	const ML   = 18;   // margin left
	const MT   = 15;   // margin top
	const MB   = 18;   // margin bottom (used for top calculations)
	const CW   = 174;  // content width (PW - ML - ML)

	public static function init() {
		add_action( 'wp_enqueue_scripts', [ __CLASS__, 'enqueue_button_script' ] );
		add_action( 'wp_ajax_aipdf_generate',        [ __CLASS__, 'handle_ajax' ] );
		add_action( 'wp_ajax_nopriv_aipdf_generate', [ __CLASS__, 'handle_ajax' ] );
		add_shortcode( 'aipdf_download_button', [ __CLASS__, 'shortcode' ] );
	}

	public static function enqueue_button_script() {
		wp_enqueue_script(
			'aipdf-generate',
			AIPDF_URL . 'assets/js/generate.js',
			[ 'jquery' ],
			AIPDF_VERSION,
			true
		);
		wp_localize_script( 'aipdf-generate', 'aipdf', [
			'ajax_url' => admin_url( 'admin-ajax.php' ),
			'nonce'    => wp_create_nonce( 'aipdf_generate' ),
		] );
	}

	public static function shortcode( $atts ) {
		$atts = shortcode_atts( [ 'post_id' => get_the_ID() ], $atts );
		$pid  = intval( $atts['post_id'] );
		if ( ! $pid ) return '';
		return sprintf(
			'<button class="aipdf-download-btn" data-post-id="%d">Download Itinerary PDF</button>',
			$pid
		);
	}

	public static function handle_ajax() {
		check_ajax_referer( 'aipdf_generate', 'nonce' );
		$post_id = isset( $_POST['post_id'] ) ? intval( $_POST['post_id'] ) : 0;
		if ( ! $post_id || ! get_post( $post_id ) ) {
			wp_send_json_error( 'Invalid post.' );
		}
		if ( ! file_exists( AIPDF_VENDOR ) ) {
			wp_send_json_error( 'mPDF not installed. Run composer install in the plugin directory.' );
		}
		require_once AIPDF_VENDOR;
		try {
			self::generate( $post_id );
		} catch ( Exception $e ) {
			wp_send_json_error( $e->getMessage() );
		}
		exit;
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Main generator
	// ─────────────────────────────────────────────────────────────────────────

	public static function generate( $post_id ) {
		$data = self::collect_fields( $post_id );

		$mpdf = new \Mpdf\Mpdf( [
			'format'        => 'A4',
			'margin_top'    => 0,
			'margin_right'  => 0,
			'margin_bottom' => 0,
			'margin_left'   => 0,
			'default_font'  => 'courier',
		] );
		$mpdf->showImageErrors    = true;
		$mpdf->autoScriptToLang   = false;
		$mpdf->useSubstitutions   = false;

		// Cover
		$mpdf->AddPage();
		$mpdf->WriteHTML( self::cover_page( $data ) );

		// Overview
		$mpdf->AddPage();
		$mpdf->WriteHTML( self::overview_page( $data ) );
		self::write_ref_code( $mpdf, $data['tour_reference'] );

		// Day pages — 2 days per page
		$days = self::get_days( $post_id );
		if ( ! empty( $days ) ) {
			$pairs     = array_chunk( $days, 2 );
			$last_idx  = count( $pairs ) - 1;
			foreach ( $pairs as $i => $pair ) {
				$mpdf->AddPage();
				$mpdf->WriteHTML( self::days_page( $data, $pair, $i + 2, $i === $last_idx ) );
				self::write_ref_code( $mpdf, $data['tour_reference'] );
			}
		}

		// Terms & Conditions
		if ( ! empty( $data['terms_text'] ) ) {
			$mpdf->AddPage();
			$mpdf->WriteHTML( self::terms_page( $data ) );
			self::write_ref_code( $mpdf, $data['tour_reference'] );
		}

		// Back cover
		$mpdf->AddPage();
		$mpdf->WriteHTML( self::back_cover_page( $data ) );

		// Filename: "Architourian Itinerary {subtitle} YYYYMMDD.pdf"
		$subtitle = $data['tour_subtitle'] ?: get_the_title( $post_id );
		$filename = sanitize_file_name(
			'Architourian Itinerary ' . $subtitle . ' ' . date( 'Ymd' ) . '.pdf'
		);
		$mpdf->Output( $filename, \Mpdf\Output\Destination::DOWNLOAD );
	}

	/**
	 * Add the rotated reference code to the right edge of the current page
	 * using mPDF native rendering (CSS writing-mode not reliably supported).
	 */
	private static function write_ref_code( $mpdf, $ref ) {
		if ( ! $ref ) return;
		$mpdf->SetFont( 'courier', '', 6.5 );
		$mpdf->SetTextColor( 0, 0, 0 );
		// Each char stacked: x=204mm, starting from y=16mm, ~3.5mm per char
		$x    = 204;
		$y    = 16;
		$step = 3.5;
		$chars = mb_str_split( $ref );
		foreach ( $chars as $char ) {
			$mpdf->Text( $x, $y, $char );
			$y += $step;
		}
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Field collection
	// ─────────────────────────────────────────────────────────────────────────

	private static function collect_fields( $post_id ) {
		$f = function( $key ) use ( $post_id ) {
			if ( function_exists( 'get_field' ) ) {
				$val = get_field( $key, $post_id );
				if ( $val !== null && $val !== false && $val !== '' ) return $val;
			}
			return get_post_meta( $post_id, $key, true );
		};

		$included_items = $not_included_items = [];
		for ( $i = 1; $i <= 10; $i++ ) {
			$v = $f( 'included_' . $i );     if ( $v ) $included_items[]     = $v;
			$v = $f( 'not_included_' . $i ); if ( $v ) $not_included_items[] = $v;
		}

		return [
			'post_id'            => $post_id,
			'post_title'         => get_the_title( $post_id ),
			'tour_subtitle'      => $f( 'pdf_tour_subtitle' ),
			'tour_reference'     => $f( 'pdf_tour_reference' ),
			'trip_description'   => $f( 'pdf_trip_description' ),
			'starting_point'     => $f( 'pdf_starting_point' ),
			'end_point'          => $f( 'pdf_end_point' ),
			'cover_svg_id'       => intval( $f( 'pdf_cover_svg_id' ) ),
			'days_svg_id'        => intval( $f( 'pdf_days_svg_id' ) ),
			'back_cover_svg_id'  => intval( $f( 'pdf_back_cover_svg_id' ) ),
			'terms_text'         => $f( 'pdf_terms_text' ) ?: AIPDF_Settings::get( 'terms_text', '' ),
			'group_size'         => $f( 'group_size' ),
			'guide_price'        => self::parse_price_field( $f( 'guide_price' ) ),
			'nights'             => $f( 'nights' ),
			'included_items'     => $included_items,
			'not_included_items' => $not_included_items,
			'brand_name'         => AIPDF_Settings::get( 'brand_name', 'Architourian' ),
			'logo_mark_id'       => intval( AIPDF_Settings::get( 'logo_mark_id', 0 ) ),
			'contact_name'       => AIPDF_Settings::get( 'contact_name' ),
			'contact_phone'      => AIPDF_Settings::get( 'contact_phone' ),
			'contact_email'      => AIPDF_Settings::get( 'contact_email' ),
			'contact_website'    => AIPDF_Settings::get( 'contact_website' ),
		];
	}

	private static function parse_price_field( $value ) {
		if ( empty( $value ) ) return '';
		$processed = do_shortcode( $value );
		if ( $processed !== $value ) return wp_strip_all_tags( $processed );
		preg_match_all( '/price="(\d+)"/', $value, $matches );
		if ( ! empty( $matches[1] ) ) {
			return implode( ' – ', array_map( fn( $p ) => '£' . number_format( (int) $p ), $matches[1] ) );
		}
		return $value;
	}

	private static function get_days( $post_id ) {
		$days = [];
		$f    = function( $key ) use ( $post_id ) {
			if ( function_exists( 'get_field' ) ) {
				$val = get_field( $key, $post_id );
				if ( $val !== null && $val !== false && $val !== '' ) return $val;
			}
			return get_post_meta( $post_id, $key, true );
		};
		for ( $i = 1; $i <= 12; $i++ ) {
			$title   = $f( 'day_' . $i . '_title' );
			$content = $f( 'day_' . $i . '_text' );
			if ( empty( $title ) && empty( $content ) ) continue;
			$days[] = [
				'title'   => $title ?: ( 'Day ' . $i ),
				'content' => $content,
			];
		}
		return $days;
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Helpers
	// ─────────────────────────────────────────────────────────────────────────

	/**
	 * Load an SVG file, strip everything before the <svg tag, optionally set dimensions.
	 * Strips XML declarations, DOCTYPE, comments etc. which mPDF renders as literal text.
	 */
	private static function svg_tag( $attachment_id, $width = '', $height = '' ) {
		if ( ! $attachment_id ) return '';
		$path = get_attached_file( $attachment_id );
		if ( ! $path || ! file_exists( $path ) ) return '';

		$svg = file_get_contents( $path );

		// Find the opening <svg tag and discard everything before it.
		// This reliably removes <?xml?>, <!DOCTYPE>, comments, BOM characters, etc.
		$start = stripos( $svg, '<svg' );
		if ( $start === false ) return ''; // not a valid SVG
		$svg = substr( $svg, $start );

		// Override width/height on the root <svg> element
		if ( $width || $height ) {
			$svg = preg_replace( '/<svg\b([^>]*?)\s+width="[^"]*"/i',  '<svg$1', $svg );
			$svg = preg_replace( '/<svg\b([^>]*?)\s+height="[^"]*"/i', '<svg$1', $svg );
			$attrs  = $width  ? ' width="'  . esc_attr( $width )  . '"' : '';
			$attrs .= $height ? ' height="' . esc_attr( $height ) . '"' : '';
			$svg = preg_replace( '/<svg\b/i', '<svg' . $attrs, $svg, 1 );
		}

		return $svg;
	}

	/**
	 * Format plain textarea text into HTML paragraphs / bullet lists.
	 * Lines beginning with – or - become list items.
	 */
	private static function format_body( $text ) {
		if ( empty( $text ) ) return '';
		if ( strip_tags( $text ) !== $text ) return wp_kses_post( $text );

		$lines   = explode( "\n", trim( $text ) );
		$output  = '';
		$in_list = false;

		foreach ( $lines as $line ) {
			$line = rtrim( $line );
			if ( preg_match( '/^[\-–—]\s*(.+)/', $line, $m ) ) {
				if ( ! $in_list ) { $output .= '<ul>'; $in_list = true; }
				$output .= '<li>' . esc_html( $m[1] ) . '</li>';
			} else {
				if ( $in_list ) { $output .= '</ul>'; $in_list = false; }
				$output .= $line === '' ? '' : '<p>' . esc_html( $line ) . '</p>';
			}
		}
		if ( $in_list ) $output .= '</ul>';
		return $output;
	}

	/**
	 * Format T&C text: numbered headings (e.g. "1) Heading") become <h3>.
	 */
	private static function format_terms( $text ) {
		if ( empty( $text ) ) return '';
		if ( strip_tags( $text ) !== $text ) return wp_kses_post( $text );

		$output = '';
		foreach ( explode( "\n", trim( $text ) ) as $line ) {
			$line = rtrim( $line );
			if ( $line === '' ) continue;
			if ( preg_match( '/^\d+[)\.]\s+\S/', $line ) ) {
				$output .= '<h3>' . esc_html( $line ) . '</h3>';
			} else {
				$output .= '<p>' . esc_html( $line ) . '</p>';
			}
		}
		return $output;
	}

	/**
	 * Split an HTML string of <p> and <h3> elements into N balanced columns.
	 * Returns array of N HTML strings.
	 */
	private static function split_into_cols( $html, $num_cols = 3 ) {
		preg_match_all( '/<(p|h3)[^>]*>.*?<\/\1>/s', $html, $matches );
		$elements = $matches[0];
		if ( empty( $elements ) ) {
			return array_fill( 0, $num_cols, $html );
		}
		// Weight h3 headings as 2 to keep sections together
		$weights      = array_map( fn( $el ) => strpos( $el, '<h3' ) !== false ? 2 : 1, $elements );
		$total_weight = array_sum( $weights );
		$target       = $total_weight / $num_cols;

		$cols       = array_fill( 0, $num_cols, '' );
		$col        = 0;
		$col_weight = 0;

		foreach ( $elements as $i => $el ) {
			$cols[ $col ] .= $el;
			$col_weight   += $weights[ $i ];
			if ( $col < $num_cols - 1 && $col_weight >= $target ) {
				$col++;
				$col_weight = 0;
			}
		}
		return $cols;
	}

	/** Shared CSS loaded on every page. */
	private static function css() {
		return '<style>
		* {
			font-family: "Courier New", Courier, monospace;
			font-size: 9pt;
			color: #000;
			box-sizing: border-box;
		}
		body { margin: 0; padding: 0; }

		/* ── Overview info columns ── */
		.ov-col { vertical-align: top; font-size: 9pt; line-height: 1.55; padding-right: 8mm; }
		.ov-col:last-child { padding-right: 0; }
		.ov-col p { margin: 0 0 3mm 0; }

		/* ── Included section ── */
		.incl h2 { font-size: 11pt; font-weight: bold; margin: 0 0 3mm 0; padding: 0; }
		.incl ul  { list-style: none; padding: 0; margin: 0 0 2mm 0; }
		.incl ul li { font-size: 9pt; line-height: 1.5; margin-bottom: 1.5mm; }
		.incl ul li::before { content: ""; }
		.incl p   { font-size: 9pt; line-height: 1.5; margin: 0 0 2mm 0; }

		/* ── Day pages ── */
		.day-head { font-size: 14pt; font-weight: bold; margin: 0 0 4mm 0; }
		.day-body ul  { list-style: none; padding: 0; margin: 0; }
		.day-body ul li { font-size: 9pt; line-height: 1.5; margin-bottom: 2mm; padding-left: 5mm; text-indent: -5mm; }
		.day-body ul li::before { content: "\2013\00a0"; }
		.day-body p   { font-size: 9pt; line-height: 1.5; margin: 0 0 2.5mm 0; }

		/* ── T&C — used inside absolutely-positioned column divs ── */
		h3 { font-size: 8.5pt; font-weight: bold; margin: 3.5mm 0 1mm 0; padding: 0; }
		h3:first-child { margin-top: 0; }
		</style>';
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Page renderers
	// ─────────────────────────────────────────────────────────────────────────

	private static function cover_page( $d ) {
		// Center SVG: A4 = 210mm, use 148mm wide SVG → left = (210-148)/2 = 31mm
		$cover_svg = self::svg_tag( $d['cover_svg_id'], '148mm', '' );
		$logo_svg  = self::svg_tag( $d['logo_mark_id'], '13mm', '13mm' );
		$brand     = esc_html( $d['brand_name'] );
		$subtitle  = nl2br( esc_html( $d['tour_subtitle'] ) );

		// Footer top = PH - MB - footer_height ≈ 297 - 18 - 16 = 263mm
		ob_start(); ?>
<!DOCTYPE html><html><head><?php echo self::css(); ?></head><body>

<div style="position:absolute; top:52mm; left:31mm; width:148mm; text-align:center;">
	<?php echo $cover_svg; ?>
</div>

<div style="position:absolute; top:263mm; left:<?php echo self::ML; ?>mm; width:<?php echo self::CW; ?>mm;">
	<table width="100%" border="0" cellpadding="0" cellspacing="0">
		<tr>
			<td style="width:16mm; vertical-align:bottom;"><?php echo $logo_svg; ?></td>
			<td style="width:48mm; vertical-align:bottom; padding-left:3mm;">
				<strong style="font-size:11pt;"><?php echo $brand; ?></strong>
			</td>
			<td style="vertical-align:bottom; font-size:8.5pt; line-height:1.4;">
				<?php echo $subtitle; ?>
			</td>
		</tr>
	</table>
</div>

</body></html>
		<?php return ob_get_clean();
	}

	private static function overview_page( $d ) {
		$brand    = esc_html( $d['brand_name'] );
		$subtitle = nl2br( esc_html( $d['tour_subtitle'] ) );

		// Centre column
		$centre = '';
		if ( $d['starting_point'] ) {
			$centre .= '<p>Starting point:<br/>' . esc_html( $d['starting_point'] ) . '</p>';
		}
		if ( $d['end_point'] ) {
			$centre .= '<p>End Point:<br/>' . esc_html( $d['end_point'] ) . '</p>';
		}

		// Right column
		$right = '';
		if ( $d['group_size'] ) {
			$right .= '<p>Group size: ' . esc_html( $d['group_size'] ) . '.</p>';
		}
		if ( $d['guide_price'] ) {
			$right .= '<p>' . nl2br( esc_html( $d['guide_price'] ) ) . ' per person.</p>';
		}

		// Left column
		$left = self::format_body( $d['trip_description'] );

		$has_incl = ! empty( $d['included_items'] ) || ! empty( $d['not_included_items'] );

		ob_start(); ?>
<!DOCTYPE html><html><head><?php echo self::css(); ?></head><body>

<?php echo self::inner_header( $brand, $subtitle, 'Itinerary' ); ?>

<div style="position:absolute; top:50mm; left:<?php echo self::ML; ?>mm; width:<?php echo self::CW; ?>mm;">

	<table width="100%" border="0" cellpadding="0" cellspacing="0">
		<tr>
			<td class="ov-col" style="width:33%;"><?php echo $left; ?></td>
			<td class="ov-col" style="width:33%;"><?php echo $centre; ?></td>
			<td class="ov-col" style="width:34%;"><?php echo $right; ?></td>
		</tr>
	</table>

	<?php if ( $has_incl ) : ?>
	<div class="incl" style="margin-top:14mm;">
		<?php if ( ! empty( $d['included_items'] ) ) : ?>
			<h2>Included in the trip</h2>
			<ul>
				<?php foreach ( $d['included_items'] as $item ) : ?>
				<li><?php echo esc_html( $item ); ?></li>
				<?php endforeach; ?>
			</ul>
		<?php endif; ?>
		<?php if ( ! empty( $d['not_included_items'] ) ) : ?>
			<h2 style="margin-top:4mm;">Not included</h2>
			<ul>
				<?php foreach ( $d['not_included_items'] as $item ) : ?>
				<li><?php echo esc_html( $item ); ?></li>
				<?php endforeach; ?>
			</ul>
		<?php endif; ?>
	</div>
	<?php endif; ?>

</div>

</body></html>
		<?php return ob_get_clean();
	}

	private static function days_page( $d, $pair, $page_num, $show_svg = false ) {
		$brand    = esc_html( $d['brand_name'] );
		$subtitle = nl2br( esc_html( $d['tour_subtitle'] ) );

		ob_start(); ?>
<!DOCTYPE html><html><head><?php echo self::css(); ?></head><body>

<?php echo self::inner_header( $brand, $subtitle, 'Itinerary' ); ?>

<div style="position:absolute; top:50mm; left:<?php echo self::ML; ?>mm; width:<?php echo self::CW; ?>mm;">
	<table width="100%" border="0" cellpadding="0" cellspacing="0">
		<tr>
		<?php foreach ( $pair as $day ) : ?>
			<td style="width:50%; vertical-align:top; padding-right:10mm;">
				<div class="day-head"><?php echo esc_html( $day['title'] ); ?></div>
				<div class="day-body"><?php echo self::format_body( $day['content'] ); ?></div>
			</td>
		<?php endforeach; ?>
		<?php if ( count( $pair ) === 1 ) : ?>
			<td style="width:50%;"></td>
		<?php endif; ?>
		</tr>
	</table>
</div>

<!-- Page number — top: PH - MB - 5 = 274mm -->
<div style="position:absolute; top:274mm; left:<?php echo self::ML; ?>mm; font-size:8.5pt;">
	page <?php echo esc_html( $page_num ); ?>
</div>

<?php if ( $show_svg ) :
	$svg = self::svg_tag( $d['days_svg_id'], '55mm', '' );
	if ( $svg ) : ?>
<!-- Illustration — bottom-right: top ≈ 230mm, right edge at 192mm → left=137mm -->
<div style="position:absolute; top:230mm; left:137mm; width:55mm; text-align:right;">
	<?php echo $svg; ?>
</div>
	<?php endif;
endif; ?>

</body></html>
		<?php return ob_get_clean();
	}

	private static function terms_page( $d ) {
		$brand   = esc_html( $d['brand_name'] );
		$content = self::format_terms( $d['terms_text'] );
		$cols    = self::split_into_cols( $content, 3 );

		// 3 columns × 54mm + 2 gutters × 6mm = 174mm total
		// Col left positions (from page left edge): 18, 78, 138mm
		$col_w = 54;
		$gutter = 6;
		$tc_top = 50; // mm from top

		$tc_col_style = 'font-size:8.5pt; line-height:1.5; font-family:"Courier New",Courier,monospace;';

		ob_start(); ?>
<!DOCTYPE html><html><head><?php echo self::css(); ?></head><body>

<?php echo self::inner_header( $brand, '', 'Terms &amp; Conditions' ); ?>

<?php foreach ( $cols as $i => $col_html ) :
	$left = self::ML + $i * ( $col_w + $gutter ); ?>
<div style="position:absolute; top:<?php echo $tc_top; ?>mm; left:<?php echo $left; ?>mm; width:<?php echo $col_w; ?>mm; <?php echo $tc_col_style; ?>">
	<?php echo $col_html; ?>
</div>
<?php endforeach; ?>

</body></html>
		<?php return ob_get_clean();
	}

	private static function back_cover_page( $d ) {
		$back_svg = self::svg_tag( $d['back_cover_svg_id'], '130mm', '' );
		$logo_svg = self::svg_tag( $d['logo_mark_id'], '13mm', '13mm' );
		$brand    = esc_html( $d['brand_name'] );

		ob_start(); ?>
<!DOCTYPE html><html><head><?php echo self::css(); ?></head><body>

<?php if ( $back_svg ) : ?>
<!-- Centre illustration: left = (210-130)/2 = 40mm -->
<div style="position:absolute; top:60mm; left:40mm; width:130mm; text-align:center;">
	<?php echo $back_svg; ?>
</div>
<?php endif; ?>

<!-- Footer: top = 297 - 18 - 16 = 263mm -->
<div style="position:absolute; top:263mm; left:<?php echo self::ML; ?>mm; width:<?php echo self::CW; ?>mm;">
	<table width="100%" border="0" cellpadding="0" cellspacing="0">
		<tr>
			<td style="width:48mm; vertical-align:bottom;">
				<strong style="font-size:11pt;"><?php echo $brand; ?></strong>
			</td>
			<td style="vertical-align:bottom; font-size:8.5pt; line-height:1.55;">
				<?php echo esc_html( $d['contact_name'] ); ?><br/>
				<?php echo esc_html( $d['contact_phone'] ); ?>
			</td>
			<td style="vertical-align:bottom; font-size:8.5pt; line-height:1.55; text-align:right;">
				<?php echo esc_html( $d['contact_email'] ); ?><br/>
				<?php echo esc_html( $d['contact_website'] ); ?>
			</td>
		</tr>
	</table>
</div>

</body></html>
		<?php return ob_get_clean();
	}

	/**
	 * Shared inner-page header (Architourian | subtitle | section label).
	 * Uses table-layout:fixed with percentages — most reliable in mPDF.
	 * Reference code is added separately via write_ref_code().
	 */
	private static function inner_header( $brand, $subtitle, $section_label ) {
		ob_start(); ?>
<div style="position:absolute; top:<?php echo self::MT; ?>mm; left:<?php echo self::ML; ?>mm; width:<?php echo self::CW; ?>mm;">
	<table style="width:100%; table-layout:fixed; border-collapse:collapse;" cellpadding="0" cellspacing="0">
		<colgroup>
			<col style="width:17%;"/>
			<col style="width:67%;"/>
			<col style="width:16%;"/>
		</colgroup>
		<tr>
			<td style="vertical-align:top; padding:0;">
				<strong style="font-size:10pt; font-family:'Courier New',Courier,monospace;"><?php echo $brand; ?></strong>
			</td>
			<td style="vertical-align:top; padding:0; font-size:8.5pt; line-height:1.4; font-family:'Courier New',Courier,monospace;">
				<?php echo $subtitle; ?>
			</td>
			<td style="vertical-align:top; padding:0; text-align:right; font-size:9pt; font-family:'Courier New',Courier,monospace;">
				<?php echo $section_label; ?>
			</td>
		</tr>
	</table>
</div>
		<?php return ob_get_clean();
	}
}
