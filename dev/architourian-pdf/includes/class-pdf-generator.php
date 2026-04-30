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
	const MB   = 18;   // margin bottom
	const CW   = 174;  // content width (PW - ML - ML)

	// 30 / 30 / 40 grid (applied to CW=174mm, all inner pages and cover footer)
	const C1   = 52;   // col 1 width  (30%)
	const C2   = 52;   // col 2 width  (30%)
	const C3   = 70;   // col 3 width  (40%)
	const CL2  = 70;   // col 2 left   (ML + C1)
	const CL3  = 122;  // col 3 left   (ML + C1 + C2)

	public static function init() {
		add_action( 'wp_enqueue_scripts', [ __CLASS__, 'enqueue_button_script' ] );
		add_action( 'wp_ajax_aipdf_generate',        [ __CLASS__, 'handle_ajax' ] );
		add_action( 'wp_ajax_nopriv_aipdf_generate', [ __CLASS__, 'handle_ajax' ] );
		add_action( 'wp_ajax_aipdf_diag',            [ __CLASS__, 'handle_diag' ] );
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
			wp_send_json_error( 'Invalid post ID.' );
		}

		if ( ! file_exists( AIPDF_VENDOR ) ) {
			wp_send_json_error( 'mPDF vendor directory missing. Re-upload the plugin zip.' );
		}

		try {
			require_once AIPDF_VENDOR;
		} catch ( \Throwable $e ) {
			wp_send_json_error( 'Vendor load failed: ' . $e->getMessage() );
		}

		try {
			self::generate( $post_id );
		} catch ( \Throwable $e ) {
			$msg = $e->getMessage() . ' — ' . basename( $e->getFile() ) . ':' . $e->getLine();
			error_log( 'Architourian PDF error: ' . $msg );
			wp_send_json_error( $msg );
		}
		exit;
	}

	/**
	 * Diagnostic AJAX handler — returns environment info as JSON.
	 * Access via: /wp-admin/admin-ajax.php?action=aipdf_diag&nonce=XXX
	 */
	public static function handle_diag() {
		check_ajax_referer( 'aipdf_generate', 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( 'Unauthorised.' );
		}
		$response = [
			'php_version'    => PHP_VERSION,
			'vendor_exists'  => file_exists( AIPDF_VENDOR ),
			'plugin_version' => AIPDF_VERSION,
			'file_mtime'     => date( 'Y-m-d H:i:s', filemtime( __FILE__ ) ),
			'class_methods'  => get_class_methods( __CLASS__ ),
		];
		$post_id = isset( $_REQUEST['post_id'] ) ? intval( $_REQUEST['post_id'] ) : 0;
		if ( $post_id ) {
			$raw = get_post_meta( $post_id );
			$response['post_meta'] = array_map( function( $v ) {
				return maybe_unserialize( $v[0] );
			}, $raw );
		}
		wp_send_json_success( $response );
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

		// Day pages — 4 days per page (2×2 grid)
		$days = self::get_days( $post_id );
		if ( ! empty( $days ) ) {
			$chunks = array_chunk( $days, 4 );
			foreach ( $chunks as $i => $chunk ) {
				$mpdf->AddPage();
				$mpdf->WriteHTML( self::days_page( $data, $chunk, $i + 2, $i ) );
			}
		}

		// Terms & Conditions
		if ( ! empty( $data['terms_text'] ) ) {
			$mpdf->AddPage();
			$mpdf->WriteHTML( self::terms_page( $data ) );
		}

		// Back cover
		$mpdf->AddPage();
		$mpdf->WriteHTML( self::back_cover_page( $data ) );

		// Filename: "Architourian-Itinerary-[slug]-[date].pdf"
		$slug     = get_post_field( 'post_name', $post_id ) ?: get_the_title( $post_id );
		$filename = sanitize_file_name(
			'Architourian Itinerary ' . $slug . ' ' . date( 'Ymd' ) . '.pdf'
		);
		$mpdf->Output( $filename, \Mpdf\Output\Destination::DOWNLOAD );
	}

	/** Reference code — bottom-right corner, col 3 (40%), right-aligned. */
	private static function ref_code_html( $ref ) {
		if ( ! $ref ) return '';
		return '<div style="position:absolute; top:272mm; left:' . self::CL3 . 'mm; width:' . self::C3 . 'mm;'
			. ' text-align:right; font-size:6pt; font-family:\'Courier New\',Courier,monospace;'
			. ' letter-spacing:0.3mm; color:#555;">'
			. esc_html( $ref ) . '</div>';
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
			'subtitle_line_1'    => sanitize_text_field( $f( 'pdf_subtitle_line_1' ) ),
			'subtitle_line_2'    => sanitize_text_field( $f( 'pdf_subtitle_line_2' ) ),
			'subtitle_line_3'    => sanitize_text_field( $f( 'pdf_subtitle_line_3' ) ),
			'tour_reference'     => $f( 'pdf_tour_reference' ),
			'trip_description'   => $f( 'pdf_trip_description' ),
			'starting_point'     => $f( 'pdf_starting_point' ),
			'end_point'          => $f( 'pdf_end_point' ),
			'cover_svg_id'       => intval( $f( 'pdf_cover_svg_id' ) ),
			'days_svg_id'        => intval( $f( 'pdf_days_svg_id' ) ),
			'days_svg_2_id'      => intval( $f( 'pdf_days_svg_id_2' ) ),
			'back_cover_svg_id'  => intval( $f( 'pdf_back_cover_svg_id' ) ),
			'terms_text'         => $f( 'pdf_terms_text' ) ?: AIPDF_Settings::get( 'terms_text', '' ),
			'group_size'         => $f( 'group_size' ),
			'guide_price'        => self::parse_price_field( $f( 'guide_price' ) ),
			'nights'             => $f( 'nights' ),
			'included_items'     => $included_items,
			'not_included_items' => $not_included_items,
			'brand_name'         => AIPDF_Settings::get( 'brand_name', 'Architourian' ),
			'logo_mark_id'       => intval( AIPDF_Settings::get( 'logo_mark_id', 0 ) ),
			'wordmark_id'        => intval( AIPDF_Settings::get( 'wordmark_id', 0 ) ),
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
			return implode( ' – ', array_map( function( $p ) {
				return '£' . number_format( (int) $p );
			}, $matches[1] ) );
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
	 * Return an <img> tag pointing to the SVG file on disk.
	 * Using <img src="path"> is more reliable in mPDF than inline SVG —
	 * it avoids XML declaration artefacts and respects width/height constraints.
	 */
	private static function svg_tag( $attachment_id, $width = '', $height = '' ) {
		if ( ! $attachment_id ) return '';
		$path = get_attached_file( $attachment_id );
		if ( ! $path || ! file_exists( $path ) ) return '';

		$style = '';
		if ( $width )  $style .= 'width:'  . $width  . ';';
		if ( $height ) $style .= 'height:' . $height . ';';

		return '<img src="' . esc_attr( $path ) . '"' . ( $style ? ' style="' . $style . '"' : '' ) . '>';
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
				if ( ! $in_list ) { $output .= '<ul style="list-style:none;list-style-type:none;padding:0;margin:0 0 2.5mm 0;">'; $in_list = true; }
				$output .= '<li style="list-style:none;font-size:9pt;line-height:1.5;margin-bottom:1.5mm;padding-left:5mm;text-indent:-5mm;">&ndash;&nbsp;' . esc_html( $m[1] ) . '</li>';
			} else {
				if ( $in_list ) { $output .= '</ul>'; $in_list = false; }
				$output .= $line === '' ? '' : '<p style="margin:0 0 2.5mm 0;font-size:9pt;line-height:1.5;">' . esc_html( $line ) . '</p>';
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
				$output .= '<h3 style="font-size:8.5pt;font-weight:bold;margin:3.5mm 0 1mm 0;padding:0;">' . esc_html( $line ) . '</h3>';
			} else {
				$output .= '<p style="margin:0 0 2mm 0;font-size:8.5pt;line-height:1.5;">' . esc_html( $line ) . '</p>';
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
		$weights      = array_map( function( $el ) { return strpos( $el, '<h3' ) !== false ? 2 : 1; }, $elements );
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
		.incl h2 { font-size: 11pt; font-weight: bold; margin: 0 0 5mm 0; padding: 0;
		           font-family: "TT Nooks", Georgia, serif; }
		.incl ul  { list-style: none; padding: 0; margin: 0 0 2mm 0; }
		.incl ul li { font-size: 10.5pt; line-height: 1.5; margin-bottom: 1.5mm; }
		.incl ul li::before { content: ""; }
		.incl p   { font-size: 10.5pt; line-height: 1.5; margin: 0 0 2mm 0; }

		/* ── Day pages ── */
		.day-head { font-size: 14pt; font-weight: bold; margin: 0 0 5mm 0;
		            font-family: "TT Nooks", Georgia, serif; }
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
		$cover_svg    = self::svg_tag( $d['cover_svg_id'], '148mm', '' );
		$logo_svg     = self::svg_tag( $d['logo_mark_id'], '22mm', '22mm' );
		$wordmark_svg = self::wordmark_html( $d );

		// Each subtitle line gets its own absolutely-positioned div — mPDF reliably
		// renders single-line divs; <p> tags inside shared positioned divs get collapsed.
		$sub_style = 'font-size:9pt; line-height:1; font-family:\'Courier New\',Courier,monospace;';
		$sub_lines = [
			$d['subtitle_line_1'],
			$d['subtitle_line_2'],
			$d['subtitle_line_3'],
		];
		$sub_tops  = [ '260mm', '265mm', '270mm' ];

		ob_start(); ?>
<!DOCTYPE html><html><head><?php echo self::css(); ?></head><body>

<div style="position:absolute; top:52mm; left:31mm; width:148mm; text-align:center;">
	<?php echo $cover_svg; ?>
</div>

<!-- Footer: logo | wordmark | subtitle -->
<!-- Logo col: 8–60mm -->
<div style="position:absolute; top:260mm; left:8mm; width:52mm;">
	<?php echo $logo_svg; ?>
</div>

<!-- Wordmark col: 60–130mm (70mm — SVG is 56mm so comfortable) -->
<div style="position:absolute; top:260mm; left:60mm; width:70mm;">
	<?php echo $wordmark_svg; ?>
</div>

<!-- Subtitle col: 135–205mm (70mm, 12mm gap after wordmark) -->
<?php foreach ( $sub_lines as $i => $line ) : ?>
<?php if ( $line !== '' ) : ?>
<div style="position:absolute; top:<?php echo $sub_tops[ $i ]; ?>; left:135mm; width:70mm; <?php echo $sub_style; ?>">
	<?php echo esc_html( $line ); ?>
</div>
<?php endif; ?>
<?php endforeach; ?>

</body></html>
		<?php return ob_get_clean();
	}

	/**
	 * Returns SVG wordmark img tag, or bold text fallback.
	 * $width = '56mm' for cover footer, '32mm' for inner page headers.
	 */
	private static function wordmark_html( $d, $width = '56mm' ) {
		$svg = self::svg_tag( $d['wordmark_id'], $width, '' );
		if ( $svg ) return $svg;
		$fs = $width === '56mm' ? '20pt' : '13pt';
		return '<strong style="font-size:' . $fs . '; font-family:\'Courier New\',Courier,monospace;">'
			. esc_html( $d['brand_name'] ) . '</strong>';
	}

	private static function overview_page( $d ) {
		$brand_html    = self::wordmark_html( $d, '32mm' );
		$subtitle_lines = array_values( array_filter( [ $d['subtitle_line_1'], $d['subtitle_line_2'], $d['subtitle_line_3'] ] ) );

		// Centre column — use <div> not <p>; mPDF collapses <p> in table cells
		$lbl    = 'font-size:9pt;font-weight:bold;margin:0 0 0.5mm 0;line-height:1.3;';
		$val    = 'font-size:9pt;margin:0 0 4mm 0;line-height:1.4;';
		$centre = '';
		if ( $d['starting_point'] ) {
			$centre .= '<div style="' . $lbl . '">Starting point</div>'
				. '<div style="' . $val . '">' . esc_html( $d['starting_point'] ) . '</div>';
		}
		if ( $d['end_point'] ) {
			$centre .= '<div style="' . $lbl . '">End point</div>'
				. '<div style="' . $val . '">' . esc_html( $d['end_point'] ) . '</div>';
		}

		// Right column
		$right = '';
		if ( $d['group_size'] ) {
			$right .= '<div style="font-size:9pt;margin:0 0 2mm 0;">Group size: ' . esc_html( $d['group_size'] ) . '</div>';
		}
		if ( $d['guide_price'] ) {
			$right .= '<div style="font-size:9pt;margin:0 0 2mm 0;">' . esc_html( $d['guide_price'] ) . ' per person.</div>';
		}

		// Left column
		$left = self::format_body( $d['trip_description'] );

		$has_incl = ! empty( $d['included_items'] ) || ! empty( $d['not_included_items'] );

		ob_start(); ?>
<!DOCTYPE html><html><head><?php echo self::css(); ?></head><body>

<?php echo self::inner_header( $brand_html, $subtitle_lines, 'Itinerary' ); ?>

<div style="position:absolute; top:50mm; left:<?php echo self::ML; ?>mm; width:<?php echo self::CW; ?>mm;">

	<!-- Content: 30 / 30 / 40 grid matching page constants -->
	<table width="100%" border="0" cellpadding="0" cellspacing="0" style="table-layout:fixed;">
		<tr>
			<td class="ov-col" width="30%"><?php echo $left; ?></td>
			<td class="ov-col" width="30%"><?php echo $centre; ?></td>
			<td class="ov-col" width="40%"><?php echo $right; ?></td>
		</tr>
	</table>

	<?php if ( $has_incl ) : ?>
	<!-- Included spans col1+col2 (60% = 30+30) — col3 stays clear -->
	<div class="incl" style="margin-top:14mm; width:60%;">
		<?php if ( ! empty( $d['included_items'] ) ) : ?>
			<h2>Included in the trip</h2>
			<ul style="list-style:none;list-style-type:none;padding:0;margin:0 0 2mm 0;">
				<?php foreach ( $d['included_items'] as $item ) : ?>
				<li style="list-style:none;font-size:10.5pt;line-height:1.5;margin-bottom:1.5mm;">&#9679;&nbsp;<?php echo esc_html( $item ); ?></li>
				<?php endforeach; ?>
			</ul>
		<?php endif; ?>
		<?php if ( ! empty( $d['not_included_items'] ) ) : ?>
			<h2 style="margin-top:4mm;">Not included</h2>
			<ul style="list-style:none;list-style-type:none;padding:0;margin:0 0 2mm 0;">
				<?php foreach ( $d['not_included_items'] as $item ) : ?>
				<li style="list-style:none;font-size:10.5pt;line-height:1.5;margin-bottom:1.5mm;">&#9679;&nbsp;<?php echo esc_html( $item ); ?></li>
				<?php endforeach; ?>
			</ul>
		<?php endif; ?>
	</div>
	<?php endif; ?>

</div>

<?php echo self::ref_code_html( $d['tour_reference'] ); ?>

</body></html>
		<?php return ob_get_clean();
	}

	private static function days_page( $d, $chunk, $page_num, $page_index = 0 ) {
		$brand_html     = self::wordmark_html( $d, '32mm' );
		$subtitle_lines = array_values( array_filter( [ $d['subtitle_line_1'], $d['subtitle_line_2'], $d['subtitle_line_3'] ] ) );
		$rows     = array_chunk( $chunk, 2 );

		ob_start(); ?>
<!DOCTYPE html><html><head><?php echo self::css(); ?></head><body>

<?php echo self::inner_header( $brand_html, $subtitle_lines, 'Itinerary' ); ?>

<div style="position:absolute; top:50mm; left:<?php echo self::ML; ?>mm; width:<?php echo self::CW; ?>mm;">
	<table width="100%" border="0" cellpadding="0" cellspacing="0">
	<?php foreach ( $rows as $ri => $row ) : ?>
		<?php if ( $ri > 0 ) : ?>
		<tr><td colspan="2" style="height:8mm;"></td></tr>
		<?php endif; ?>
		<tr>
		<?php foreach ( $row as $day ) : ?>
			<td style="width:50%; vertical-align:top; padding-right:10mm;">
				<div class="day-head"><?php echo esc_html( $day['title'] ); ?></div>
				<div class="day-body"><?php echo self::format_body( $day['content'] ); ?></div>
			</td>
		<?php endforeach; ?>
		<?php if ( count( $row ) === 1 ) : ?>
			<td style="width:50%;"></td>
		<?php endif; ?>
		</tr>
	<?php endforeach; ?>
	</table>
</div>

<!-- Page number -->
<div style="position:absolute; top:274mm; left:<?php echo self::ML; ?>mm; font-size:8.5pt;">
	page <?php echo esc_html( $page_num ); ?>
</div>

<?php
	$svg_id = ( $page_index > 0 && $d['days_svg_2_id'] )
		? $d['days_svg_2_id'] : $d['days_svg_id'];
	$svg = self::svg_tag( $svg_id, '55mm', '' );
	if ( $svg ) : ?>
<!-- Illustration — bottom-right -->
<div style="position:absolute; top:230mm; left:137mm; width:55mm; text-align:right;">
	<?php echo $svg; ?>
</div>
<?php echo self::ref_code_html( $d['tour_reference'] ); ?>
<?php endif; ?>

</body></html>
		<?php return ob_get_clean();
	}

	private static function terms_page( $d ) {
		$brand_html     = self::wordmark_html( $d, '32mm' );
		$subtitle_lines = array_values( array_filter( [ $d['subtitle_line_1'], $d['subtitle_line_2'], $d['subtitle_line_3'] ] ) );
		$content        = self::format_terms( $d['terms_text'] );
		$cols           = self::split_into_cols( $content, 3 );

		$tc_col_style = 'vertical-align:top; font-size:8.5pt; line-height:1.5;
			font-family:\'Courier New\',Courier,monospace;';

		ob_start(); ?>
<!DOCTYPE html><html><head><?php echo self::css(); ?></head><body>

<?php echo self::inner_header( $brand_html, $subtitle_lines, 'Terms &amp; Conditions' ); ?>

<?php echo self::ref_code_html( $d['tour_reference'] ); ?>

<div style="position:absolute; top:50mm; left:<?php echo self::ML; ?>mm; width:<?php echo self::CW; ?>mm;">
	<table width="100%" border="0" cellpadding="0" cellspacing="0">
		<tr>
			<td style="width:33%; padding-right:6mm; <?php echo $tc_col_style; ?>"><?php echo $cols[0]; ?></td>
			<td style="width:33%; padding-right:6mm; <?php echo $tc_col_style; ?>"><?php echo $cols[1]; ?></td>
			<td style="width:34%; <?php echo $tc_col_style; ?>"><?php echo $cols[2]; ?></td>
		</tr>
	</table>
</div>

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
			<td style="vertical-align:bottom; font-size:8.5pt;">
				<p style="margin:0 0 1mm 0;font-size:8.5pt;"><?php echo esc_html( $d['contact_name'] ); ?></p>
				<p style="margin:0;font-size:8.5pt;"><?php echo esc_html( $d['contact_phone'] ); ?></p>
			</td>
			<td style="vertical-align:bottom; font-size:8.5pt; text-align:right;">
				<p style="margin:0 0 1mm 0;font-size:8.5pt;"><?php echo esc_html( $d['contact_email'] ); ?></p>
				<p style="margin:0;font-size:8.5pt;"><?php echo esc_html( $d['contact_website'] ); ?></p>
			</td>
		</tr>
	</table>
</div>

</body></html>
		<?php return ob_get_clean();
	}

	/**
	 * Shared inner-page header: wordmark (30%) | subtitle lines (40%) | section label (30%).
	 * $subtitle_lines is an array of up to 3 strings.
	 * Subtitle uses a nested single-column table so each line renders on its own row —
	 * the only reliable way to get multi-line content in an mPDF table cell.
	 */
	private static function inner_header( $brand_html, $subtitle_lines, $section_label ) {
		$sub_cell_style = 'padding:0; font-size:7.5pt; line-height:1.35; font-family:\'Courier New\',Courier,monospace;';
		ob_start(); ?>
<div style="position:absolute; top:<?php echo self::MT; ?>mm; left:<?php echo self::ML; ?>mm; width:<?php echo self::CW; ?>mm;">
	<table style="width:100%; table-layout:fixed; border-collapse:collapse;" cellpadding="0" cellspacing="0">
		<tr>
			<td width="30%" style="vertical-align:top; padding:0;">
				<?php echo $brand_html; ?>
			</td>
			<td width="30%" style="vertical-align:top; padding:0;">
				<table cellpadding="0" cellspacing="0" border="0" width="100%">
					<?php foreach ( (array) $subtitle_lines as $line ) : ?>
					<?php if ( $line !== '' ) : ?>
					<tr><td style="<?php echo $sub_cell_style; ?>"><?php echo esc_html( $line ); ?></td></tr>
					<?php endif; ?>
					<?php endforeach; ?>
				</table>
			</td>
			<td width="40%" style="vertical-align:top; padding:0; font-size:9pt; font-family:'Courier New',Courier,monospace;">
				<?php echo $section_label; ?>
			</td>
		</tr>
	</table>
</div>
		<?php return ob_get_clean();
	}
}
