<?php
/**
 * PDF generation logic using mPDF.
 *
 * Reads custom fields from the post and renders a multi-page branded PDF
 * matching the Architourian itinerary template.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class AIPDF_PDF_Generator {

	public static function init() {
		add_action( 'wp_enqueue_scripts', [ __CLASS__, 'enqueue_button_script' ] );
		add_action( 'wp_ajax_aipdf_generate',        [ __CLASS__, 'handle_ajax' ] );
		add_action( 'wp_ajax_nopriv_aipdf_generate', [ __CLASS__, 'handle_ajax' ] );

		// Shortcode: [aipdf_download_button]
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
		if ( ! $pid ) {
			return '';
		}
		return sprintf(
			'<button class="aipdf-download-btn" data-post-id="%d">Download Itinerary PDF</button>',
			$pid
		);
	}

	/**
	 * AJAX handler — streams the PDF directly to the browser as a download.
	 */
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

	/**
	 * Build and stream the PDF for the given post.
	 */
	public static function generate( $post_id ) {
		$data = self::collect_fields( $post_id );

		$mpdf = new \Mpdf\Mpdf( [
			'format'       => 'A4',
			'margin_top'   => 0,
			'margin_right' => 0,
			'margin_bottom'=> 0,
			'margin_left'  => 0,
			'default_font' => 'courier',
		] );

		$mpdf->SetProtection( [] );
		$mpdf->showImageErrors = true;
		$mpdf->autoScriptToLang = false;

		// ── Page 1: Cover ────────────────────────────────────────────────
		$mpdf->AddPage();
		$mpdf->WriteHTML( self::cover_page( $data ) );

		// ── Page 2: Overview ─────────────────────────────────────────────
		$mpdf->AddPage();
		$mpdf->WriteHTML( self::overview_page( $data ) );

		// ── Pages 3+: Day-by-day (2 days per page) ───────────────────────
		$days = self::get_days( $post_id );
		if ( ! empty( $days ) ) {
			$pairs        = array_chunk( $days, 2 );
			$last_pair    = count( $pairs ) - 1;
			foreach ( $pairs as $i => $pair ) {
				$mpdf->AddPage();
				$page_num = $i + 2; // Page 2 = overview, so days start at page 3 (display as "page 2" etc.)
				$show_svg = ( $i === $last_pair ); // illustration on last day page
				$mpdf->WriteHTML( self::days_page( $data, $pair, $page_num, $show_svg ) );
			}
		}

		// ── Terms & Conditions ───────────────────────────────────────────
		if ( ! empty( $data['terms_text'] ) ) {
			$mpdf->AddPage();
			$mpdf->WriteHTML( self::terms_page( $data ) );
		}

		// ── Back cover ───────────────────────────────────────────────────
		$mpdf->AddPage();
		$mpdf->WriteHTML( self::back_cover_page( $data ) );

		// Stream to browser
		$filename = sanitize_file_name( ( $data['tour_subtitle'] ?: 'itinerary' ) . '.pdf' );
		$mpdf->Output( $filename, \Mpdf\Output\Destination::DOWNLOAD );
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Field collection
	// ─────────────────────────────────────────────────────────────────────────

	private static function collect_fields( $post_id ) {
		$f = function( $key ) use ( $post_id ) {
			if ( function_exists( 'get_field' ) ) {
				$val = get_field( $key, $post_id );
				if ( $val !== null && $val !== false && $val !== '' ) {
					return $val;
				}
			}
			return get_post_meta( $post_id, $key, true );
		};

		// Build included/not-included lists from existing numbered fields
		$included_items     = [];
		$not_included_items = [];
		for ( $i = 1; $i <= 10; $i++ ) {
			$v = $f( 'included_' . $i );
			if ( $v ) $included_items[] = $v;
			$v = $f( 'not_included_' . $i );
			if ( $v ) $not_included_items[] = $v;
		}

		return [
			'post_id'            => $post_id,
			'post_title'         => get_the_title( $post_id ),
			// New PDF-specific fields
			'tour_subtitle'      => $f( 'pdf_tour_subtitle' ),
			'tour_reference'     => $f( 'pdf_tour_reference' ),
			'trip_description'   => $f( 'pdf_trip_description' ),
			'starting_point'     => $f( 'pdf_starting_point' ),
			'end_point'          => $f( 'pdf_end_point' ),
			'cover_svg_id'       => intval( $f( 'pdf_cover_svg_id' ) ),
			'days_svg_id'        => intval( $f( 'pdf_days_svg_id' ) ),
			'back_cover_svg_id'  => intval( $f( 'pdf_back_cover_svg_id' ) ),
			'terms_text'         => $f( 'pdf_terms_text' ) ?: AIPDF_Settings::get( 'terms_text', '' ),
			// Existing tour fields
			'group_size'         => $f( 'group_size' ),
			'guide_price'        => self::parse_price_field( $f( 'guide_price' ) ),
			'nights'             => $f( 'nights' ),
			'included_items'     => $included_items,
			'not_included_items' => $not_included_items,
			// Global brand settings
			'brand_name'         => AIPDF_Settings::get( 'brand_name', 'Architourian' ),
			'logo_mark_id'       => intval( AIPDF_Settings::get( 'logo_mark_id', 0 ) ),
			'contact_name'       => AIPDF_Settings::get( 'contact_name' ),
			'contact_phone'      => AIPDF_Settings::get( 'contact_phone' ),
			'contact_email'      => AIPDF_Settings::get( 'contact_email' ),
			'contact_website'    => AIPDF_Settings::get( 'contact_website' ),
		];
	}

	/**
	 * Handle guide_price field which may contain [currency price="3300"] shortcodes.
	 * Tries do_shortcode() first; falls back to extracting numbers.
	 */
	private static function parse_price_field( $value ) {
		if ( empty( $value ) ) {
			return '';
		}
		$processed = do_shortcode( $value );
		// If shortcode ran successfully, strip any wrapper HTML
		if ( $processed !== $value ) {
			return wp_strip_all_tags( $processed );
		}
		// Fallback: extract numbers from price="XXXX" attributes
		preg_match_all( '/price="(\d+)"/', $value, $matches );
		if ( ! empty( $matches[1] ) ) {
			return implode( ' – ', array_map( function ( $p ) {
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

		// Use existing day_N_title + day_N_text fields
		for ( $i = 1; $i <= 12; $i++ ) {
			$title   = $f( 'day_' . $i . '_title' );
			$content = $f( 'day_' . $i . '_text' );
			if ( empty( $title ) && empty( $content ) ) {
				continue;
			}
			$days[] = [
				'title'   => $title ?: ( 'Day ' . $i ),
				'content' => $content,
			];
		}

		return $days;
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Shared helpers
	// ─────────────────────────────────────────────────────────────────────────

	private static function svg_tag( $attachment_id, $style = '' ) {
		if ( ! $attachment_id ) {
			return '';
		}
		$path = get_attached_file( $attachment_id );
		if ( ! $path || ! file_exists( $path ) ) {
			return '';
		}
		// Inline the SVG so mPDF renders it faithfully
		$svg = file_get_contents( $path );
		if ( $style ) {
			// Inject style attribute on the root <svg> element
			$svg = preg_replace( '/<svg\b/', '<svg style="' . esc_attr( $style ) . '"', $svg, 1 );
		}
		return $svg;
	}

	/**
	 * Convert plain textarea content to HTML.
	 * Lines beginning with – (en dash) or - become list items.
	 * Blank lines become paragraph breaks.
	 */
	private static function format_body( $text ) {
		if ( empty( $text ) ) {
			return '';
		}
		// If it contains HTML tags already (WYSIWYG), return as-is
		if ( strip_tags( $text ) !== $text ) {
			return wp_kses_post( $text );
		}

		$lines  = explode( "\n", trim( $text ) );
		$output = '';
		$in_list = false;

		foreach ( $lines as $line ) {
			$line = rtrim( $line );

			if ( preg_match( '/^[\-–—]\s*(.+)/', $line, $m ) ) {
				if ( ! $in_list ) {
					$output  .= '<ul>';
					$in_list  = true;
				}
				$output .= '<li>' . esc_html( $m[1] ) . '</li>';
			} else {
				if ( $in_list ) {
					$output .= '</ul>';
					$in_list = false;
				}
				if ( $line === '' ) {
					$output .= '<br/>';
				} else {
					$output .= '<p>' . esc_html( $line ) . '</p>';
				}
			}
		}
		if ( $in_list ) {
			$output .= '</ul>';
		}
		return $output;
	}

	/** Shared CSS injected on every page. */
	private static function base_css() {
		return '
		<style>
			* { font-family: "Courier New", Courier, monospace; font-size: 9.5pt; color: #000; box-sizing: border-box; }
			body { margin: 0; padding: 0; }

			/* ── Inner page header ────────────────────────── */
			.page-header {
				position: absolute;
				top: 18mm;
				left: 18mm;
				right: 18mm;
				height: 12mm;
			}
			.page-header table { width: 100%; border-collapse: collapse; }
			.page-header td { vertical-align: top; padding: 0; }
			.page-header .brand { font-weight: bold; font-size: 10pt; white-space: nowrap; }
			.page-header .subtitle { font-size: 8.5pt; line-height: 1.4; }
			.page-header .section-label { text-align: right; font-size: 9pt; white-space: nowrap; }

			/* Rotated reference code — right edge */
			.ref-code {
				position: absolute;
				top: 0;
				right: 0;
				width: 8mm;
				writing-mode: vertical-rl;
				text-orientation: mixed;
				transform: rotate(180deg);
				font-size: 7pt;
				letter-spacing: 0.5pt;
				white-space: nowrap;
			}

			/* ── Overview page ────────────────────────────── */
			.overview-body {
				position: absolute;
				top: 52mm;
				left: 18mm;
				right: 18mm;
			}
			.overview-cols table { width: 100%; border-collapse: collapse; }
			.overview-cols td {
				vertical-align: top;
				width: 33.33%;
				padding-right: 8mm;
				font-size: 9pt;
				line-height: 1.55;
			}
			.overview-cols td:last-child { padding-right: 0; }

			.included-section { margin-top: 14mm; }
			.included-section h2 {
				font-size: 11pt;
				font-weight: bold;
				margin: 0 0 4mm 0;
				padding: 0;
			}
			.included-section p, .included-section ul {
				font-size: 9pt;
				line-height: 1.55;
				margin: 0 0 2mm 0;
				padding: 0;
			}
			.included-section ul { list-style: none; padding: 0; margin: 0; }
			.included-section ul li::before { content: "– "; }
			.included-section ul li { margin-bottom: 1.5mm; }

			/* ── Days pages ───────────────────────────────── */
			.days-body {
				position: absolute;
				top: 52mm;
				left: 18mm;
				right: 18mm;
				bottom: 25mm;
			}
			.days-cols { width: 100%; border-collapse: collapse; }
			.days-cols td {
				vertical-align: top;
				width: 50%;
				padding-right: 10mm;
			}
			.days-cols td:last-child { padding-right: 0; }
			.day-heading {
				font-size: 14pt;
				font-weight: bold;
				margin: 0 0 4mm 0;
			}
			.day-content ul { list-style: none; padding: 0; margin: 0; }
			.day-content ul li { font-size: 9pt; line-height: 1.5; margin-bottom: 2mm; padding-left: 5mm; text-indent: -5mm; }
			.day-content ul li::before { content: "– "; }
			.day-content p { font-size: 9pt; line-height: 1.5; margin: 0 0 2mm 0; }

			/* Page number */
			.page-num {
				position: absolute;
				bottom: 12mm;
				left: 18mm;
				font-size: 8.5pt;
			}

			/* Days illustration */
			.days-illustration {
				position: absolute;
				bottom: 8mm;
				right: 18mm;
				width: 55mm;
				height: 45mm;
				text-align: right;
			}
			.days-illustration svg { max-width: 100%; max-height: 100%; }

			/* ── Cover page ───────────────────────────────── */
			.cover-illustration {
				position: absolute;
				top: 60mm;
				left: 50%;
				transform: translateX(-50%);
				width: 150mm;
				text-align: center;
			}
			.cover-illustration svg { max-width: 150mm; max-height: 110mm; }

			.cover-footer {
				position: absolute;
				bottom: 18mm;
				left: 18mm;
				right: 18mm;
				height: 18mm;
			}
			.cover-footer table { width: 100%; border-collapse: collapse; }
			.cover-footer td { vertical-align: bottom; padding: 0; }
			.cover-footer .logo-cell { width: 22mm; }
			.cover-footer .logo-cell svg { width: 14mm; height: 14mm; }
			.cover-footer .brand-cell { width: 45mm; }
			.cover-footer .brand-cell .brand { font-size: 11pt; font-weight: bold; }
			.cover-footer .subtitle-cell {
				font-size: 8.5pt;
				line-height: 1.4;
				text-align: left;
			}

			/* ── Terms & Conditions ──────────────────────── */
			.tc-body {
				position: absolute;
				top: 52mm;
				left: 18mm;
				right: 18mm;
				bottom: 18mm;
				column-count: 3;
				column-gap: 8mm;
			}
			.tc-body p { font-size: 8.5pt; line-height: 1.5; margin: 0 0 2.5mm 0; }
			.tc-body h3 {
				font-size: 8.5pt;
				font-weight: bold;
				margin: 4mm 0 1.5mm 0;
				font-family: "Courier New", Courier, monospace;
			}
			.tc-body ul, .tc-body ol { padding: 0; margin: 0 0 2.5mm 0; list-style: none; }
			.tc-body ul li, .tc-body ol li { font-size: 8.5pt; line-height: 1.5; margin-bottom: 1.5mm; }

			/* ── Back cover ───────────────────────────────── */
			.backcover-illustration {
				position: absolute;
				top: 60mm;
				left: 50%;
				transform: translateX(-50%);
				width: 130mm;
				text-align: center;
			}
			.backcover-illustration svg { max-width: 130mm; max-height: 120mm; }

			.backcover-footer {
				position: absolute;
				bottom: 18mm;
				left: 18mm;
				right: 18mm;
			}
			.backcover-footer table { width: 100%; border-collapse: collapse; }
			.backcover-footer td { vertical-align: bottom; padding: 0; }
			.backcover-footer .brand { font-size: 11pt; font-weight: bold; }
			.backcover-footer .contact-col { font-size: 8.5pt; line-height: 1.55; }
		</style>
		';
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Page renderers
	// ─────────────────────────────────────────────────────────────────────────

	private static function cover_page( $d ) {
		$cover_svg   = self::svg_tag( $d['cover_svg_id'] );
		$logo_svg    = self::svg_tag( $d['logo_mark_id'] );
		$brand       = esc_html( $d['brand_name'] );
		$subtitle    = esc_html( $d['tour_subtitle'] );

		ob_start();
		?>
		<!DOCTYPE html><html><head><?php echo self::base_css(); ?></head><body>

		<?php if ( $cover_svg ) : ?>
		<div class="cover-illustration">
			<?php echo $cover_svg; ?>
		</div>
		<?php endif; ?>

		<div class="cover-footer">
			<table>
				<tr>
					<td class="logo-cell">
						<?php echo $logo_svg; ?>
					</td>
					<td class="brand-cell">
						<span class="brand"><?php echo $brand; ?></span>
					</td>
					<td class="subtitle-cell">
						<?php echo $subtitle; ?>
					</td>
				</tr>
			</table>
		</div>

		</body></html>
		<?php
		return ob_get_clean();
	}

	private static function overview_page( $d ) {
		$brand    = esc_html( $d['brand_name'] );
		$subtitle = esc_html( $d['tour_subtitle'] );
		$ref      = esc_html( $d['tour_reference'] );

		// Left column — trip description
		$trip_desc = self::format_body( $d['trip_description'] );

		// Centre column — starting/end point
		$centre = '';
		if ( $d['starting_point'] ) {
			$centre .= '<p>Starting point:<br/>' . esc_html( $d['starting_point'] ) . '</p>';
		}
		if ( $d['end_point'] ) {
			$centre .= '<p>End Point:<br/>' . esc_html( $d['end_point'] ) . '</p>';
		}

		// Right column — group size & price (from existing fields)
		$right = '';
		if ( $d['group_size'] ) {
			$right .= '<p>Group size: ' . esc_html( $d['group_size'] ) . '.</p>';
		}
		if ( $d['guide_price'] ) {
			$right .= '<p>' . esc_html( $d['guide_price'] ) . ' per person.</p>';
		}

		// Included section — built from included_1…included_N + not_included_1…N
		$has_included = ! empty( $d['included_items'] ) || ! empty( $d['not_included_items'] );

		ob_start();
		?>
		<!DOCTYPE html><html><head><?php echo self::base_css(); ?></head><body>

		<!-- Header -->
		<div class="page-header">
			<table>
				<tr>
					<td style="width:28mm;"><span class="brand"><?php echo $brand; ?></span></td>
					<td><span class="subtitle"><?php echo $subtitle; ?></span></td>
					<td style="width:30mm;"><span class="section-label">Itinerary</span></td>
				</tr>
			</table>
			<?php if ( $ref ) : ?>
			<div class="ref-code"><?php echo $ref; ?></div>
			<?php endif; ?>
		</div>

		<!-- Overview body -->
		<div class="overview-body">
			<div class="overview-cols">
				<table>
					<tr>
						<td><?php echo $trip_desc; ?></td>
						<td><?php echo $centre; ?></td>
						<td><?php echo $right; ?></td>
					</tr>
				</table>
			</div>

			<?php if ( $has_included ) : ?>
			<div class="included-section">
				<?php if ( ! empty( $d['included_items'] ) ) : ?>
				<h2>Included in the trip</h2>
				<ul>
					<?php foreach ( $d['included_items'] as $item ) : ?>
					<li><?php echo esc_html( $item ); ?></li>
					<?php endforeach; ?>
				</ul>
				<?php endif; ?>

				<?php if ( ! empty( $d['not_included_items'] ) ) : ?>
				<h2>Not included</h2>
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
		<?php
		return ob_get_clean();
	}

	private static function days_page( $d, $pair, $page_num, $show_svg = false ) {
		$brand    = esc_html( $d['brand_name'] );
		$subtitle = esc_html( $d['tour_subtitle'] );
		$ref      = esc_html( $d['tour_reference'] );

		// Build two columns
		$cols = '';
		foreach ( $pair as $day ) {
			$heading = esc_html( $day['title'] );
			$content = self::format_body( $day['content'] );
			$cols   .= '<td><div class="day-heading">' . $heading . '</div><div class="day-content">' . $content . '</div></td>';
		}
		// If only one day in the pair, add an empty column
		if ( count( $pair ) === 1 ) {
			$cols .= '<td></td>';
		}

		$svg_html = '';
		if ( $show_svg ) {
			$svg = self::svg_tag( $d['days_svg_id'] );
			if ( $svg ) {
				$svg_html = '<div class="days-illustration">' . $svg . '</div>';
			}
		}

		ob_start();
		?>
		<!DOCTYPE html><html><head><?php echo self::base_css(); ?></head><body>

		<!-- Header -->
		<div class="page-header">
			<table>
				<tr>
					<td style="width:28mm;">
						<span class="brand"><?php echo $brand; ?></span>
					</td>
					<td>
						<span class="subtitle"><?php echo $subtitle; ?></span>
					</td>
					<td style="width:30mm;">
						<span class="section-label">Itinerary</span>
					</td>
				</tr>
			</table>
			<?php if ( $ref ) : ?>
			<div class="ref-code"><?php echo $ref; ?></div>
			<?php endif; ?>
		</div>

		<!-- Day content -->
		<div class="days-body">
			<table class="days-cols">
				<tr><?php echo $cols; ?></tr>
			</table>
		</div>

		<!-- Page number -->
		<div class="page-num">page <?php echo esc_html( $page_num ); ?></div>

		<!-- Optional illustration -->
		<?php echo $svg_html; ?>

		</body></html>
		<?php
		return ob_get_clean();
	}

	private static function terms_page( $d ) {
		$brand    = esc_html( $d['brand_name'] );
		$subtitle = esc_html( $d['tour_subtitle'] );
		$ref      = esc_html( $d['tour_reference'] );
		$content  = self::format_terms( $d['terms_text'] );

		ob_start();
		?>
		<!DOCTYPE html><html><head><?php echo self::base_css(); ?></head><body>

		<!-- Header — "Terms & Conditions" replaces "Itinerary" -->
		<div class="page-header">
			<table>
				<tr>
					<td style="width:28mm;">
						<span class="brand"><?php echo $brand; ?></span>
					</td>
					<td>
						<span class="subtitle">Terms &amp; Conditions</span>
					</td>
					<td style="width:30mm;"></td>
				</tr>
			</table>
			<?php if ( $ref ) : ?>
			<div class="ref-code"><?php echo $ref; ?></div>
			<?php endif; ?>
		</div>

		<!-- 3-column body -->
		<div class="tc-body">
			<?php echo $content; ?>
		</div>

		</body></html>
		<?php
		return ob_get_clean();
	}

	/**
	 * Format T&C text into HTML suitable for the 3-column layout.
	 * Lines like "1) Your Fitness" become <h3> headings.
	 * Already-HTML content is passed through.
	 */
	private static function format_terms( $text ) {
		if ( empty( $text ) ) {
			return '';
		}
		// Already HTML — pass through with allowed tags
		if ( strip_tags( $text ) !== $text ) {
			return wp_kses_post( $text );
		}

		$lines  = explode( "\n", trim( $text ) );
		$output = '';

		foreach ( $lines as $line ) {
			$line = rtrim( $line );
			if ( $line === '' ) {
				continue;
			}
			// Numbered section headings: "1) Heading" or "1. Heading"
			if ( preg_match( '/^\d+[)\.]\s+\S/', $line ) ) {
				$output .= '<h3>' . esc_html( $line ) . '</h3>';
			} else {
				$output .= '<p>' . esc_html( $line ) . '</p>';
			}
		}
		return $output;
	}

	private static function back_cover_page( $d ) {
		$back_svg  = self::svg_tag( $d['back_cover_svg_id'] );
		$logo_svg  = self::svg_tag( $d['logo_mark_id'] );
		$brand     = esc_html( $d['brand_name'] );
		$name      = esc_html( $d['contact_name'] );
		$phone     = esc_html( $d['contact_phone'] );
		$email     = esc_html( $d['contact_email'] );
		$website   = esc_html( $d['contact_website'] );

		ob_start();
		?>
		<!DOCTYPE html><html><head><?php echo self::base_css(); ?></head><body>

		<?php if ( $back_svg ) : ?>
		<div class="backcover-illustration">
			<?php echo $back_svg; ?>
		</div>
		<?php endif; ?>

		<div class="backcover-footer">
			<table>
				<tr>
					<td style="width:50mm;" class="contact-col">
						<span class="brand"><?php echo $brand; ?></span>
					</td>
					<td class="contact-col">
						<?php echo $name; ?><br/>
						<?php echo $phone; ?>
					</td>
					<td class="contact-col" style="text-align:right;">
						<?php echo $email; ?><br/>
						<?php echo $website; ?>
					</td>
				</tr>
			</table>
		</div>

		</body></html>
		<?php
		return ob_get_clean();
	}
}
