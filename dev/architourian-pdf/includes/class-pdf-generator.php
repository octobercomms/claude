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

	// 33 / 33 / 34 equal-column grid
	const C1   = 58;   // col 1 width  (33%)
	const C2   = 58;   // col 2 width  (33%)
	const C3   = 58;   // col 3 width  (34%)
	const CL2  = 76;   // col 2 left   (ML + C1)
	const CL3  = 134;  // col 3 left   (ML + C1 + C2)

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

		// Build font config from uploaded TTF attachment IDs
		$mpdf_config = [
			'format'        => 'A4',
			'margin_top'    => 0,
			'margin_right'  => 0,
			'margin_bottom' => 0,
			'margin_left'   => 0,
			'default_font'  => 'dejavusansmono',
		];
		$font_dirs  = [];
		$font_data  = [];
		$b_path = self::font_path( 'ballinger_mono_id' );
		$n_path = self::font_path( 'tt_nooks_id' );
		if ( $b_path ) {
			$font_dirs[]             = dirname( $b_path );
			$font_data['ballingermono'] = [ 'R' => basename( $b_path ) ];
			$mpdf_config['default_font'] = 'ballingermono';
		}
		if ( $n_path ) {
			$dir = dirname( $n_path );
			if ( ! in_array( $dir, $font_dirs, true ) ) $font_dirs[] = $dir;
			$font_data['ttnooks'] = [ 'R' => basename( $n_path ) ];
		}
		if ( $font_dirs )  $mpdf_config['fontDir']  = $font_dirs;
		if ( $font_data )  $mpdf_config['fontdata']  = $font_data;

		$mpdf = new \Mpdf\Mpdf( $mpdf_config );
		$mpdf->showImageErrors    = true;
		$mpdf->autoScriptToLang   = false;
		$mpdf->useSubstitutions   = false;

		// Cover
		$mpdf->AddPage();
		$mpdf->WriteHTML( self::cover_page( $data ) );

		// Overview
		$mpdf->AddPage();
		$mpdf->WriteHTML( self::overview_page( $data ) );

		// Day pages — 2 days per page, side by side
		$days = self::get_days( $post_id );
		if ( ! empty( $days ) ) {
			$chunks = array_chunk( $days, 2 );
			foreach ( $chunks as $i => $chunk ) {
				$mpdf->AddPage();
				$mpdf->WriteHTML( self::days_page( $data, $chunk, $i + 2, $i ) );
			}
		}

		// Back cover
		$mpdf->AddPage();
		$mpdf->WriteHTML( self::back_cover_page( $data ) );

		// Terms & Conditions — last page.
		// Header written first (absolute, no flow advance), then mPDF native
		// SetColumns drives 3-column flow so text wraps naturally.
		if ( ! empty( $data['terms_text'] ) ) {
			$mpdf->AddPage();
			$mpdf->WriteHTML( self::terms_page( $data ) );  // header only
			$mpdf->lMargin = self::ML;
			$mpdf->rMargin = self::ML;
			$mpdf->y       = 50;
			$mpdf->SetColumns( 3, '', 6 );
			$mpdf->WriteHTML( self::format_terms( $data['terms_text'] ), 2 );
			$mpdf->SetColumns( 1 );
			$mpdf->lMargin = 0;
			$mpdf->rMargin = 0;
		}

		// Filename: "Architourian-Itinerary-[slug]-[date].pdf"
		$slug     = get_post_field( 'post_name', $post_id ) ?: get_the_title( $post_id );
		$filename = sanitize_file_name(
			'Architourian Itinerary ' . $slug . ' ' . date( 'Ymd' ) . '.pdf'
		);
		$mpdf->Output( $filename, \Mpdf\Output\Destination::DOWNLOAD );
	}

	/**
	 * Bottom bar: "page N  ●  REF-CODE" at bottom-left (col1 start).
	 * Pass null for $page_num on pages without page numbers.
	 */
	private static function bottom_bar_html( $page_num, $ref ) {
		$parts = [];
		if ( $page_num !== null ) {
			$parts[] = 'page ' . esc_html( $page_num );
		}
		if ( $ref ) {
			$parts[] = esc_html( $ref );
		}
		if ( empty( $parts ) ) return '';
		return '<div style="position:absolute; top:274mm; left:' . self::ML . 'mm;'
			. ' font-size:10.5pt; font-family:ballingermono,\'Ballinger Mono\',\'Courier New\',monospace;">'
			. implode( ' &nbsp;&mdash;&nbsp; ', $parts )
			. '</div>';
	}

	/** Returns the filesystem path of an uploaded font file, or '' if not set / not found. */
	private static function font_path( $setting_key ) {
		$id = intval( AIPDF_Settings::get( $setting_key, 0 ) );
		if ( ! $id ) return '';
		$path = get_attached_file( $id );
		return ( $path && file_exists( $path ) ) ? $path : '';
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
			'days_svg_3_id'      => intval( $f( 'pdf_days_svg_id_3' ) ),
			'days_svg_4_id'      => intval( $f( 'pdf_days_svg_id_4' ) ),
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

		// Use HTML attributes (not CSS style) — mPDF only reliably respects width=/height= on <img>
		$attrs = '';
		if ( $width )  $attrs .= ' width="'  . esc_attr( $width )  . '"';
		if ( $height ) $attrs .= ' height="' . esc_attr( $height ) . '"';

		return '<img src="' . esc_attr( $path ) . '"' . $attrs . '>';
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
				$output .= '<li style="list-style:none;font-size:10.5pt;line-height:1.5;margin-bottom:1.5mm;padding-left:5mm;text-indent:-5mm;">&ndash;&nbsp;' . esc_html( $m[1] ) . '</li>';
			} else {
				if ( $in_list ) { $output .= '</ul>'; $in_list = false; }
				$output .= $line === '' ? '' : '<p style="margin:0 0 2.5mm 0;font-size:10.5pt;line-height:1.5;">' . esc_html( $line ) . '</p>';
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
		// Normalise HTML to plain text so line-by-line processing is consistent
		// regardless of whether content came from TinyMCE or a plain textarea.
		$text = str_replace( [ '</p>', '</P>', '<br>', '<br/>', '<br />' ], "\n", $text );
		$text = html_entity_decode( strip_tags( $text ), ENT_QUOTES | ENT_HTML5, 'UTF-8' );
		$text = str_replace( "\xc2\xa0", ' ', $text ); // non-breaking space → regular space
		// Inline bullet points stored as "sentence.– next point" — split onto own lines.
		$text = preg_replace( '/([.:])(\s*)([–—])\s+/', "$1\n$3 ", $text );
		$output = '';
		foreach ( explode( "\n", trim( $text ) ) as $line ) {
			$line = trim( $line );
			if ( $line === '' ) continue;
			if ( preg_match( '/^\d+[)\.]\s+\S/', $line ) ) {
				$output .= '<h3 style="font-size:8pt;font-weight:bold;margin:3mm 0 1mm 0;padding:0;font-family:ttnooks,\'TT Nooks\',Georgia,serif;">' . esc_html( $line ) . '</h3>';
			} elseif ( preg_match( '/^[–—]/', $line ) ) {
				$output .= '<p style="font-size:7pt;margin:0 0 1mm 0;line-height:1.4;padding-left:3mm;">' . esc_html( $line ) . '</p>';
			} else {
				$output .= '<p style="font-size:7pt;margin:0 0 1.5mm 0;line-height:1.4;">' . esc_html( $line ) . '</p>';
			}
		}
		return $output;
	}

	/**
	 * Split an HTML string of <h3>/<p> elements into N balanced columns.
	 * Splits at element level (sections can wrap across columns) but never
	 * ends a column on an <h3> to avoid orphaned headings.
	 */
	private static function split_into_cols( $html, $num_cols = 3 ) {
		preg_match_all( '/<(p|h3)[^>]*>.*?<\/\1>/s', $html, $matches );
		$elements = $matches[0];
		if ( empty( $elements ) ) {
			$result    = array_fill( 0, $num_cols, '' );
			$result[0] = $html;
			return $result;
		}

		$weights = array_map( function( $el ) {
			return strlen( strip_tags( $el ) ) + ( strpos( $el, '<h3' ) !== false ? 40 : 0 );
		}, $elements );

		$total  = array_sum( $weights );
		$target = $total / $num_cols;

		$cols       = array_fill( 0, $num_cols, '' );
		$col        = 0;
		$col_weight = 0;

		foreach ( $elements as $i => $el ) {
			$cols[ $col ] .= $el;
			$col_weight   += $weights[ $i ];
			// Break only after a <p> (never after <h3>) so headings are never orphaned.
			if ( $col < $num_cols - 1 && $col_weight >= $target && strpos( $el, '<h3' ) === false ) {
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
			font-family: ballingermono, "Ballinger Mono", "Courier New", monospace;
			color: #000;
			box-sizing: border-box;
		}
		body { margin: 0; padding: 0; font-size: 10.5pt; }

		/* ── Global headings ── */
		h2 { font-size: 14pt; font-weight: bold;
		     margin: 0 0 2.5mm 0; padding: 0 0 2.5mm 0;
		     font-family: ttnooks, "TT Nooks", Georgia, serif; }
		h3 { font-size: 14pt; font-weight: bold;
		     margin: 4mm 0 2.5mm 0; padding: 0 0 2.5mm 0;
		     font-family: ttnooks, "TT Nooks", Georgia, serif; }
		h3:first-child { margin-top: 0; }

		/* ── Overview info columns ── */
		.ov-col { vertical-align: top; font-size: 10.5pt; line-height: 1.5; padding-right: 6mm; }
		.ov-col:last-child { padding-right: 0; }

		/* ── Included section ── */
		.incl ul  { list-style: none; padding: 0; margin: 0 0 2mm 0; }
		.incl ul li { font-size: 10.5pt; line-height: 1.5; margin-bottom: 1.5mm; }
		.incl ul li::before { content: ""; }

		/* ── Day pages ── */
		.day-head { font-size: 14pt !important; font-weight: bold;
		            margin: 0 0 2.5mm 0 !important; padding: 0 0 2.5mm 0 !important;
		            font-family: ttnooks, "TT Nooks", Georgia, serif; }
		.day-body ul  { list-style: none; padding: 0; margin: 0; }
		.day-body ul li { font-size: 10.5pt; line-height: 1.5; margin-bottom: 2mm; padding-left: 5mm; text-indent: -5mm; }
		.day-body ul li::before { content: "\2013\00a0"; }
		.day-body p   { font-size: 10.5pt; line-height: 1.5; margin: 0 0 2.5mm 0; }
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
		$sub_style = 'font-size:10.5pt; line-height:1.3; font-family:ballingermono,\'Ballinger Mono\',\'Courier New\',monospace;';
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
		return '<strong style="font-size:' . $fs . '; font-family:ballingermono,\'Ballinger Mono\',\'Courier New\',monospace;">'
			. esc_html( $d['brand_name'] ) . '</strong>';
	}

	private static function overview_page( $d ) {
		$brand_html    = self::wordmark_html( $d, '32mm' );
		$subtitle_lines = array_values( array_filter( [ $d['subtitle_line_1'], $d['subtitle_line_2'], $d['subtitle_line_3'] ] ) );

		// Centre column — use <div> not <p>; mPDF collapses <p> in table cells
		$lbl    = 'font-size:10.5pt;font-weight:bold;margin:0 0 0.5mm 0;line-height:1.3;';
		$val    = 'font-size:10.5pt;margin:0 0 4mm 0;line-height:1.4;';
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
			$right .= '<div style="font-size:10.5pt;margin:0 0 2mm 0;">Group size: ' . esc_html( $d['group_size'] ) . '</div>';
		}
		if ( $d['guide_price'] ) {
			$right .= '<div style="font-size:10.5pt;margin:0 0 2mm 0;">' . esc_html( $d['guide_price'] ) . ' per person.</div>';
		}

		// Left column
		$left = self::format_body( $d['trip_description'] );

		$has_incl = ! empty( $d['included_items'] ) || ! empty( $d['not_included_items'] );

		ob_start(); ?>
<!DOCTYPE html><html><head><?php echo self::css(); ?></head><body>

<?php echo self::inner_header( $brand_html, $subtitle_lines, 'Itinerary' ); ?>

<div style="position:absolute; top:50mm; left:<?php echo self::ML; ?>mm; width:<?php echo self::CW; ?>mm;">

	<!-- Content: 33/33/34 — inline padding avoids mPDF :last-child bug -->
	<table width="100%" border="0" cellpadding="0" cellspacing="0" style="table-layout:fixed;">
		<tr>
			<td class="ov-col" width="33%" style="padding-right:6mm;"><?php echo $left; ?></td>
			<td class="ov-col" width="33%" style="padding-right:6mm;"><?php echo $centre; ?></td>
			<td class="ov-col" width="34%" style="padding-right:0;"><?php echo $right; ?></td>
		</tr>
	</table>

	<?php if ( $has_incl ) : ?>
	<!-- Included spans col1+col2 (60% = 30+30) — col3 stays clear -->
	<div class="incl" style="margin-top:14mm; width:60%;">
		<?php if ( ! empty( $d['included_items'] ) ) : ?>
			<h2 style="font-size:14pt;font-weight:bold;margin:0 0 2.5mm 0;padding:0 0 2.5mm 0;font-family:ttnooks,'TT Nooks',Georgia,serif;">Included in the trip</h2>
			<ul style="list-style:none;list-style-type:none;padding:0;margin:0 0 2mm 0;">
				<?php foreach ( $d['included_items'] as $item ) : ?>
				<li style="list-style:none;font-size:10.5pt;line-height:1.5;margin-bottom:1.5mm;">&mdash;&nbsp;<?php echo esc_html( $item ); ?></li>
				<?php endforeach; ?>
			</ul>
		<?php endif; ?>
		<?php if ( ! empty( $d['not_included_items'] ) ) : ?>
			<h2 style="font-size:14pt;font-weight:bold;margin:4mm 0 2.5mm 0;padding:0 0 2.5mm 0;font-family:ttnooks,'TT Nooks',Georgia,serif;">Not included</h2>
			<ul style="list-style:none;list-style-type:none;padding:0;margin:0 0 2mm 0;">
				<?php foreach ( $d['not_included_items'] as $item ) : ?>
				<li style="list-style:none;font-size:10.5pt;line-height:1.5;margin-bottom:1.5mm;">&mdash;&nbsp;<?php echo esc_html( $item ); ?></li>
				<?php endforeach; ?>
			</ul>
		<?php endif; ?>
	</div>
	<?php endif; ?>

</div>

<?php echo self::bottom_bar_html( 1, $d['tour_reference'] ); ?>

</body></html>
		<?php return ob_get_clean();
	}

	private static function days_page( $d, $chunk, $page_num, $page_index = 0 ) {
		$brand_html     = self::wordmark_html( $d, '32mm' );
		$subtitle_lines = array_values( array_filter( [ $d['subtitle_line_1'], $d['subtitle_line_2'], $d['subtitle_line_3'] ] ) );

		// Two absolute columns, one row per page — no overflow risk.
		$col_w  = 82;   // mm each column
		$col2_l = self::ML + $col_w + 10;  // 110mm

		ob_start(); ?>
<!DOCTYPE html><html><head><?php echo self::css(); ?></head><body>

<?php echo self::inner_header( $brand_html, $subtitle_lines, 'Itinerary' ); ?>

<?php foreach ( $chunk as $ci => $day ) :
	$left = $ci === 0 ? self::ML : $col2_l; ?>
<div style="position:absolute; top:50mm; left:<?php echo $left; ?>mm; width:<?php echo $col_w; ?>mm; overflow:hidden;">
	<h2 style="font-size:14pt;font-weight:bold;margin:0 0 3mm 0;font-family:ttnooks,'TT Nooks',Georgia,serif;"><?php echo esc_html( $day['title'] ); ?></h2>
	<div style="font-family:ballingermono,'Ballinger Mono','Courier New',monospace;"><?php echo self::format_body( $day['content'] ); ?></div>
</div>
<?php endforeach; ?>

<?php echo self::bottom_bar_html( $page_num, $d['tour_reference'] ); ?>

<?php
	// Anchor bottom edge to page bar (274mm from top = 23mm from page bottom).
	// This works regardless of SVG's actual rendered height.
	$svg_map = [ $d['days_svg_id'], $d['days_svg_2_id'], $d['days_svg_3_id'], $d['days_svg_4_id'] ];
	$svg_id  = $svg_map[ $page_index ] ?? $d['days_svg_id'];
	$svg = self::svg_tag( $svg_id, '', '55mm' );
	if ( $svg ) : ?>
<!-- Illustration — col3 right, bottom edge pinned to page bar -->
<div style="position:absolute; bottom:23mm; right:<?php echo self::ML; ?>mm; width:<?php echo self::C3; ?>mm; text-align:right;">
	<?php echo $svg; ?>
</div>
<?php endif; ?>

</body></html>
		<?php return ob_get_clean();
	}

	/** Renders the T&C page header only — content is written separately via SetColumns. */
	private static function terms_page( $d ) {
		$brand_html     = self::wordmark_html( $d, '32mm' );
		$subtitle_lines = array_values( array_filter( [ $d['subtitle_line_1'], $d['subtitle_line_2'], $d['subtitle_line_3'] ] ) );
		ob_start(); ?>
<!DOCTYPE html><html><head><?php echo self::css(); ?></head><body>
<?php echo self::inner_header( $brand_html, $subtitle_lines, 'Terms &amp; Conditions' ); ?>
</body></html>
		<?php return ob_get_clean();
	}

	private static function back_cover_page( $d ) {
		$back_svg     = self::svg_tag( $d['back_cover_svg_id'], '130mm', '' );
		$wordmark_svg = self::wordmark_html( $d, '48mm' );

		ob_start(); ?>
<!DOCTYPE html><html><head><?php echo self::css(); ?></head><body>

<?php if ( $back_svg ) : ?>
<!-- Centre illustration -->
<div style="position:absolute; top:60mm; left:40mm; width:130mm; text-align:center;">
	<?php echo $back_svg; ?>
</div>
<?php endif; ?>

<!-- Footer: 33/33/34 grid, all top-aligned -->
<div style="position:absolute; top:263mm; left:<?php echo self::ML; ?>mm; width:<?php echo self::CW; ?>mm;">
	<table width="100%" border="0" cellpadding="0" cellspacing="0" style="table-layout:fixed;">
		<tr>
			<!-- Col 1: SVG wordmark -->
			<td width="33%" style="vertical-align:top; padding:0;">
				<?php echo $wordmark_svg; ?>
			</td>
			<!-- Col 2: Contact name on own line, phone on own line, no wrapping -->
			<td width="33%" style="vertical-align:top; padding:0; font-size:10.5pt;">
				<div style="font-size:10.5pt; margin:0 0 1mm 0; white-space:nowrap;"><?php echo esc_html( $d['contact_name'] ); ?></div>
				<div style="font-size:10.5pt; margin:0; white-space:nowrap;"><?php echo esc_html( $d['contact_phone'] ); ?></div>
			</td>
			<!-- Col 3: Email + website, left-aligned -->
			<td width="34%" style="vertical-align:top; padding:0; font-size:10.5pt;">
				<div style="font-size:10.5pt; margin:0 0 1mm 0;"><?php echo esc_html( $d['contact_email'] ); ?></div>
				<div style="font-size:10.5pt; margin:0;"><?php echo esc_html( $d['contact_website'] ); ?></div>
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
		$sub_cell_style = 'padding:0; font-size:10.5pt; line-height:1.35; font-family:ballingermono,\'Ballinger Mono\',\'Courier New\',monospace;';
		ob_start(); ?>
<div style="position:absolute; top:<?php echo self::MT; ?>mm; left:<?php echo self::ML; ?>mm; width:<?php echo self::CW; ?>mm;">
	<table style="width:100%; table-layout:fixed; border-collapse:collapse;" cellpadding="0" cellspacing="0">
		<tr>
			<td width="33%" style="vertical-align:top; padding:0;">
				<?php echo $brand_html; ?>
			</td>
			<td width="33%" style="vertical-align:top; padding:0;">
				<table cellpadding="0" cellspacing="0" border="0" width="100%">
					<?php foreach ( (array) $subtitle_lines as $line ) : ?>
					<?php if ( $line !== '' ) : ?>
					<tr><td style="<?php echo $sub_cell_style; ?>"><?php echo esc_html( $line ); ?></td></tr>
					<?php endif; ?>
					<?php endforeach; ?>
				</table>
			</td>
			<td width="34%" style="vertical-align:top; padding:0; font-size:10.5pt;">
				<?php echo $section_label; ?>
			</td>
		</tr>
	</table>
</div>
		<?php return ob_get_clean();
	}
}
