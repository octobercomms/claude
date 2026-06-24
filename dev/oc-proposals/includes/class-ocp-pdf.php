<?php
/**
 * Server-side PDF via mPDF — the same content model as the web portal, but
 * rendered through an mPDF-safe template (simple block/table layout, inline
 * styles, no flexbox/grid) so it lands on the first pass.
 *
 * Page size follows the proposal's region: A4 landscape (global) or US Letter
 * landscape (US). Reached by ?ocp_pdf=<token>; also attachable to the
 * acceptance email. Degrades gracefully if the mPDF vendor dir is absent
 * (run `composer install` in the plugin folder, or use the release zip).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCP_PDF {

	public static function init() {
		add_filter( 'query_vars', array( __CLASS__, 'query_vars' ) );
		add_action( 'template_redirect', array( __CLASS__, 'maybe_download' ) );
	}

	public static function query_vars( $vars ) {
		$vars[] = 'ocp_pdf';
		return $vars;
	}

	public static function available() {
		return file_exists( OCP_PATH . 'vendor/autoload.php' ) && self::load() && class_exists( '\\Mpdf\\Mpdf' );
	}

	private static function load() {
		if ( class_exists( '\\Mpdf\\Mpdf' ) ) {
			return true;
		}
		$autoload = OCP_PATH . 'vendor/autoload.php';
		if ( file_exists( $autoload ) ) {
			require_once $autoload;
		}
		return class_exists( '\\Mpdf\\Mpdf' );
	}

	public static function maybe_download() {
		$token = get_query_var( 'ocp_pdf' );
		if ( '' === $token && isset( $_GET['ocp_pdf'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			$token = wp_unslash( $_GET['ocp_pdf'] ); // phpcs:ignore WordPress.Security.NonceVerification
		}
		$token = preg_replace( '/[^A-Za-z0-9]/', '', (string) $token );
		if ( '' === $token ) {
			return;
		}
		$p = OCP_Proposal::get_by_token( $token );
		if ( ! $p ) {
			status_header( 404 );
			wp_die( esc_html__( 'Proposal not found.', 'oc-proposals' ) );
		}
		if ( ! self::available() ) {
			wp_die( esc_html__( 'PDF engine not installed. Run composer install in the plugin folder, or install the release zip.', 'oc-proposals' ) );
		}
		self::stream( $p );
	}

	/** Public PDF URL for a token. */
	public static function url( $token ) {
		return add_query_arg( 'ocp_pdf', $token, home_url( '/' ) );
	}

	/** Page format string for mPDF based on region. */
	private static function format( array $p ) {
		return ( 'us' === $p['region'] ) ? 'Letter-L' : 'A4-L';
	}

	private static function new_mpdf( array $p ) {
		$config = array(
			'mode'        => 'utf-8',
			'format'      => self::format( $p ),
			'margin_left' => 12,
			'margin_right' => 12,
			'margin_top'  => 12,
			'margin_bottom' => 14,
			'tempDir'     => get_temp_dir(),
		);
		// Bundle a brand font under assets/fonts to embed; falls back to DejaVu.
		$font_dir = OCP_PATH . 'assets/fonts';
		if ( is_dir( $font_dir ) && file_exists( $font_dir . '/brand-regular.ttf' ) ) {
			$config['fontDir'][]            = $font_dir;
			$config['fontdata']['brand']    = array( 'R' => 'brand-regular.ttf', 'B' => 'brand-bold.ttf' );
			$config['default_font']         = 'brand';
		}
		return new \Mpdf\Mpdf( $config );
	}

	public static function stream( array $p ) {
		$mpdf = self::new_mpdf( $p );
		$mpdf->SetTitle( $p['client_name'] . ' — Proposal' );
		$mpdf->WriteHTML( self::html( $p ) );
		$filename = sanitize_file_name( $p['client_name'] . '-proposal.pdf' );
		$mpdf->Output( $filename, \Mpdf\Output\Destination::INLINE );
		exit;
	}

	/** Render the PDF to a file and return its path (for email attachment). */
	public static function save_to_file( array $p ) {
		if ( ! self::available() ) {
			return '';
		}
		$mpdf = self::new_mpdf( $p );
		$mpdf->WriteHTML( self::html( $p ) );
		$uploads = wp_upload_dir();
		$dir     = trailingslashit( $uploads['basedir'] ) . 'ocp-proposals';
		wp_mkdir_p( $dir );
		$path = $dir . '/' . sanitize_file_name( $p['token'] . '.pdf' );
		$mpdf->Output( $path, \Mpdf\Output\Destination::FILE );
		return $path;
	}

	// --- mPDF-safe template --------------------------------------------------

	private static function html( array $p ) {
		$s   = OCP_Settings::all();
		$ink = $s['color_ink'];
		$acc = $s['color_accent'];
		$mut = $s['color_muted'];
		$card = $s['color_card'];

		$t   = OCP_Proposal::totals( $p['id'] );
		$cur = $t['currency'];

		$css = "body{font-family:sans-serif;color:{$ink};font-size:11px;}"
			. "h1{font-size:24px;margin:0 0 4px;}h2{font-size:15px;margin:0 0 6px;}"
			. ".eyebrow{font-size:9px;letter-spacing:2px;text-transform:uppercase;color:{$mut};font-weight:bold;}"
			. ".sec{border:1px solid {$card};border-radius:8px;padding:14px 16px;margin-bottom:10px;}"
			. ".muted{color:{$mut};}"
			. ".price{font-size:26px;font-weight:bold;}"
			. "table{width:100%;border-collapse:collapse;}"
			. ".stat{font-size:18px;font-weight:bold;}"
			. ".bucket{border:1px solid {$card};border-radius:8px;padding:12px;}";

		$html  = '<style>' . $css . '</style>';

		// Cover.
		$logo  = $s['logo_url'] ? '<img src="' . esc_url( $s['logo_url'] ) . '" height="22" /><br/><br/>' : '';
		$html .= '<div class="sec">' . $logo . '<div class="eyebrow">' . esc_html( OCP_Types::label( $p['type'] ) . ' — ' . gmdate( 'F Y' ) ) . '</div>';
		$html .= '<h1>' . esc_html( $p['title'] ?: ( 'A proposal for ' . $p['client_name'] ) ) . '</h1>';
		$html .= '<div class="muted">' . esc_html( $p['client_name'] ) . '</div></div>';

		// Situation.
		$sit = OCP_Proposal::get_section( $p['id'], 'situation' );
		if ( $sit && trim( (string) $sit['body'] ) !== '' ) {
			$html .= '<div class="sec"><div class="eyebrow">Your situation</div>' . wp_kses_post( wpautop( $sit['body'] ) ) . '</div>';
		}

		// Proof.
		$ids = OCP_Proposal::section_ref_ids( $p['id'], 'proof' );
		if ( ! $ids ) {
			$ids = wp_list_pluck( OCP_Library::case_studies_for_sector( $p['sector'], 3 ), 'id' );
		}
		if ( $ids ) {
			$html .= '<div class="sec"><div class="eyebrow">Proof</div>';
			foreach ( $ids as $id ) {
				$cs = OCP_Repo::get( OCP_DB::case_studies_table(), $id );
				if ( ! $cs ) {
					continue;
				}
				$html .= '<p><strong>' . esc_html( $cs['title'] ) . '</strong>';
				if ( $cs['summary'] ) {
					$html .= '<br/>' . esc_html( $cs['summary'] );
				}
				$stats = OCP_Library::parse_stats( $cs['stats'] );
				if ( $stats ) {
					$html .= '<table><tr>';
					foreach ( $stats as $st ) {
						$html .= '<td><span class="stat">' . esc_html( $st['value'] ) . '</span><br/><span class="muted">' . esc_html( $st['label'] ) . '</span></td>';
					}
					$html .= '</tr></table>';
				}
				$html .= '</p>';
			}
			$html .= '</div>';
		}

		// Process (5-stage as a table).
		$html .= '<div class="sec"><div class="eyebrow">How we work</div><table><tr>';
		foreach ( array( 'Learning', 'Preparation', 'Production', 'Strategy', 'Promotion' ) as $i => $name ) {
			$html .= '<td style="text-align:center;"><strong>' . ( $i + 1 ) . '</strong><br/>' . esc_html( $name ) . '</td>';
		}
		$html .= '</tr></table></div>';

		// Investment.
		$items = OCP_Proposal::items( $p['id'] );
		$html .= '<div class="sec"><div class="eyebrow">Your investment</div><table><tr>';
		foreach ( OCP_Types::cadences() as $ck => $cl ) {
			if ( empty( $t['by_cadence'][ $ck ] ) ) {
				continue;
			}
			$html .= '<td width="50%" style="vertical-align:top;padding:4px;"><div class="bucket"><div class="muted">' . esc_html( $cl ) . '</div>';
			$html .= '<div class="price">' . esc_html( OCP_Proposal::money( $t['by_cadence'][ $ck ], $cur ) ) . '</div>';
			foreach ( $items as $it ) {
				if ( $it['cadence'] === $ck ) {
					$html .= '&bull; ' . esc_html( $it['label'] ) . '<br/>';
				}
			}
			$html .= '</div></td>';
		}
		$html .= '</tr></table>';

		// Payment schedule (project milestones).
		$mile = OCP_Render::milestones_html( $p, $t );
		if ( $mile ) {
			$html .= '<p><strong>' . esc_html__( 'Payment schedule', 'oc-proposals' ) . '</strong><br/>';
			$meta = $p['pricing_meta'] ? json_decode( $p['pricing_meta'], true ) : array();
			foreach ( (array) ( $meta['milestones'] ?? array() ) as $m ) {
				if ( (float) ( $m['pct'] ?? 0 ) > 0 ) {
					$amt = OCP_Proposal::money( ( $t['by_cadence']['project'] ?? 0 ) * (float) $m['pct'] / 100, $cur );
					$html .= esc_html( (float) $m['pct'] . '% · ' . ( $m['label'] ?? '' ) . ' — ' . $amt ) . '<br/>';
				}
			}
			$html .= '</p>';
		}

		// ROI anchor.
		$stats = OCP_Render::roi_stats( $p );
		if ( $stats ) {
			$html .= '<table><tr>';
			foreach ( $stats as $st ) {
				$html .= '<td><span class="stat">' . esc_html( $st['value'] ) . '</span><br/><span class="muted">' . esc_html( $st['label'] ) . '</span></td>';
			}
			$html .= '</tr></table>';
		}

		$html .= '<p class="muted">No lock-in. 14 days&rsquo; notice to pause or stop before any renewal.</p></div>';

		// Legal footer.
		$html .= '<p class="muted" style="font-size:9px;">' . esc_html( $s['company_name'] . ' ' . $s['company_legal'] . ' ' . $s['company_address'] ) . '</p>';

		return $html;
	}
}
