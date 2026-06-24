<?php
/**
 * Section renderer — turns a proposal + its sections/items/library refs into
 * OMI-styled HTML blocks. Shared by the public portal (modern CSS) and, where
 * the markup stays mPDF-safe, the PDF template. No internal cost/margin ever
 * leaks; only client-facing pricing is shown.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCP_Render {

	/** Assemble the enabled sections, in the proposal type's order. */
	public static function body( array $p, $for = 'web' ) {
		$order = OCP_Types::default_sections( $p['type'] );
		$out   = '';
		foreach ( $order as $key ) {
			$method = 'section_' . $key;
			if ( method_exists( __CLASS__, $method ) ) {
				$out .= self::$method( $p, $for );
			}
		}
		return $out;
	}

	private static function loom( $url ) {
		$url = trim( (string) $url );
		if ( '' === $url ) {
			return '';
		}
		// Normalise share links to embed.
		$embed = str_replace( '/share/', '/embed/', $url );
		return '<div class="ocp-video"><iframe src="' . esc_url( $embed ) . '" frameborder="0" allowfullscreen></iframe></div>';
	}

	private static function section_cover( $p ) {
		$logo = OCP_Settings::get( 'logo_url' );
		$img  = $p['website_image'];
		$html = '<section class="ocp-cover">';
		if ( $logo ) {
			$html .= '<img class="ocp-logo" src="' . esc_url( $logo ) . '" alt="October" />';
		}
		$html .= '<div class="ocp-eyebrow">' . esc_html( OCP_Types::label( $p['type'] ) . ' — ' . gmdate( 'F Y' ) ) . '</div>';
		$html .= '<h1>' . esc_html( $p['title'] ?: sprintf( __( 'A proposal for %s', 'oc-proposals' ), $p['client_name'] ) ) . '</h1>';
		$html .= '<p class="ocp-cover-client">' . esc_html( $p['client_name'] ) . '</p>';
		if ( $img ) {
			$html .= '<div class="ocp-cover-img"><img src="' . esc_url( $img ) . '" alt="' . esc_attr( $p['client_name'] ) . '" /></div>';
		}
		$html .= '</section>';
		return $html;
	}

	private static function section_intro( $p ) {
		$company = OCP_Settings::get( 'company_name' );
		$html  = '<section class="ocp-sec" data-sec="intro"><div class="ocp-eyebrow">' . esc_html__( 'Introduction', 'oc-proposals' ) . '</div>';
		$html .= self::loom( $p['intro_video'] );
		$html .= '<p>' . esc_html__( 'Thank you for the opportunity. Within these pages we set out how we would work together and a clear breakdown of the investment.', 'oc-proposals' ) . '</p>';
		$html .= '<p class="ocp-sign">' . esc_html__( 'Daniel Nelson — Founder & Director,', 'oc-proposals' ) . ' ' . esc_html( $company ) . '</p>';
		$html .= '</section>';
		return $html;
	}

	private static function section_situation( $p ) {
		$s = OCP_Proposal::get_section( $p['id'], 'situation' );
		if ( ! $s || '' === trim( (string) $s['body'] ) ) {
			return '';
		}
		return '<section class="ocp-sec" data-sec="situation"><div class="ocp-eyebrow">' . esc_html__( 'Your situation', 'oc-proposals' ) . '</div>'
			. wp_kses_post( wpautop( $s['body'] ) ) . '</section>';
	}

	private static function section_proof( $p ) {
		$ids = OCP_Proposal::section_ref_ids( $p['id'], 'proof' );
		if ( ! $ids ) {
			$ids = wp_list_pluck( OCP_Library::case_studies_for_sector( $p['sector'], 3 ), 'id' );
		}
		if ( ! $ids ) {
			return '';
		}
		$html = '<section class="ocp-sec" data-sec="proof"><div class="ocp-eyebrow">' . esc_html__( 'Proof', 'oc-proposals' ) . '</div><div class="ocp-cards">';
		foreach ( $ids as $id ) {
			$cs = OCP_Repo::get( OCP_DB::case_studies_table(), $id );
			if ( ! $cs ) {
				continue;
			}
			$html .= '<article class="ocp-card2"><h3>' . esc_html( $cs['title'] ) . '</h3>';
			if ( $cs['summary'] ) {
				$html .= '<p>' . esc_html( $cs['summary'] ) . '</p>';
			}
			$stats = OCP_Library::parse_stats( $cs['stats'] );
			if ( $stats ) {
				$html .= '<div class="ocp-stats">';
				foreach ( $stats as $st ) {
					$html .= '<div class="ocp-stat"><b>' . esc_html( $st['value'] ) . '</b><span>' . esc_html( $st['label'] ) . '</span></div>';
				}
				$html .= '</div>';
			}
			$html .= self::loom( $cs['video_url'] );
			if ( $cs['link_url'] ) {
				$html .= '<a class="ocp-link" href="' . esc_url( $cs['link_url'] ) . '" target="_blank" rel="noopener">' . esc_html__( 'See the work →', 'oc-proposals' ) . '</a>';
			}
			$html .= '</article>';
		}
		$html .= '</div></section>';
		return $html;
	}

	private static function section_objectives( $p ) {
		$s = OCP_Proposal::get_section( $p['id'], 'objectives' );
		if ( ! $s || '' === trim( (string) $s['body'] ) ) {
			return '';
		}
		return '<section class="ocp-sec" data-sec="objectives"><div class="ocp-eyebrow">' . esc_html__( 'Objectives & strategy', 'oc-proposals' ) . '</div>'
			. wp_kses_post( wpautop( $s['body'] ) ) . '</section>';
	}

	private static function section_process( $p ) {
		$stages = array(
			array( '1', __( 'Learning', 'oc-proposals' ) ),
			array( '2', __( 'Preparation', 'oc-proposals' ) ),
			array( '3', __( 'Production', 'oc-proposals' ) ),
			array( '4', __( 'Strategy', 'oc-proposals' ) ),
			array( '5', __( 'Promotion', 'oc-proposals' ) ),
		);
		$html = '<section class="ocp-sec" data-sec="process"><div class="ocp-eyebrow">' . esc_html__( 'How we work', 'oc-proposals' ) . '</div>';
		$html .= self::loom( $p['process_video'] );
		$html .= '<div class="ocp-rail">';
		foreach ( $stages as $st ) {
			$html .= '<div class="ocp-stage"><span class="ocp-num">' . esc_html( $st[0] ) . '</span><h4>' . esc_html( $st[1] ) . '</h4></div>';
		}
		$html .= '</div></section>';
		return $html;
	}

	private static function section_investment( $p ) {
		$t   = OCP_Proposal::totals( $p['id'] );
		$cur = $t['currency'];
		$items = OCP_Proposal::items( $p['id'] );
		$html = '<section class="ocp-sec" data-sec="investment"><div class="ocp-eyebrow">' . esc_html__( 'Your investment', 'oc-proposals' ) . '</div>';
		$html .= '<div class="ocp-buckets">';
		foreach ( OCP_Types::cadences() as $ck => $cl ) {
			if ( empty( $t['by_cadence'][ $ck ] ) ) {
				continue;
			}
			$html .= '<div class="ocp-bucket"><div class="ocp-kicker">' . esc_html( $cl ) . '</div>';
			$html .= '<div class="ocp-price">' . esc_html( OCP_Proposal::money( $t['by_cadence'][ $ck ], $cur ) );
			$html .= '<span class="ocp-per">' . ( 'monthly' === $ck ? esc_html__( '/ month', 'oc-proposals' ) : esc_html__( 'one-off', 'oc-proposals' ) ) . '</span></div>';
			$html .= '<ul class="ocp-incl">';
			foreach ( $items as $it ) {
				if ( $it['cadence'] === $ck ) {
					$html .= '<li>' . esc_html( $it['label'] ) . '</li>';
				}
			}
			$html .= '</ul></div>';
		}
		$html .= '</div>';
		$html .= '<p class="ocp-reassure">' . esc_html__( 'No lock-in. Give 14 days’ notice before any renewal to pause or stop — nothing is taken after that.', 'oc-proposals' ) . '</p>';
		$html .= '</section>';
		return $html;
	}

	private static function section_next_step( $p, $for = 'web' ) {
		if ( 'web' !== $for ) {
			return '<section class="ocp-sec"><div class="ocp-eyebrow">' . esc_html__( 'Next step', 'oc-proposals' ) . '</div><p>'
				. esc_html__( 'To proceed, accept and sign the online proposal, or book a kickoff call.', 'oc-proposals' ) . '</p></section>';
		}
		// Web: the accept/sign form is rendered by the portal (needs the token + nonce).
		return '';
	}

	private static function section_appendix( $p ) {
		$services = OCP_Repo::all( OCP_DB::services_table(), 'sort_order ASC, id ASC' );
		$clients  = OCP_Repo::all( OCP_DB::clients_table(), 'sort_order ASC, id ASC' );
		$testi    = OCP_Repo::all( OCP_DB::testimonials_table(), 'sort_order ASC, id ASC' );
		if ( ! $services && ! $clients && ! $testi ) {
			return '';
		}
		$html = '<section class="ocp-sec ocp-appendix" data-sec="appendix"><div class="ocp-eyebrow">' . esc_html__( 'Appendix', 'oc-proposals' ) . '</div>';
		if ( $testi ) {
			$html .= '<div class="ocp-testi">';
			foreach ( $testi as $tt ) {
				$html .= '<figure>';
				if ( $tt['logo'] ) {
					$html .= '<img src="' . esc_url( $tt['logo'] ) . '" alt="' . esc_attr( $tt['company'] ) . '" />';
				}
				$html .= '<blockquote>' . esc_html( $tt['quote'] ) . '</blockquote>';
				$html .= '<figcaption>' . esc_html( trim( $tt['company'] . ' ' . $tt['person'] ) ) . '</figcaption></figure>';
			}
			$html .= '</div>';
		}
		if ( $services ) {
			$html .= '<h3>' . esc_html__( 'Capabilities', 'oc-proposals' ) . '</h3><ul class="ocp-svc">';
			foreach ( $services as $sv ) {
				$html .= '<li>' . esc_html( $sv['name'] ) . '</li>';
			}
			$html .= '</ul>';
		}
		if ( $clients ) {
			$html .= '<h3>' . esc_html__( 'Selected clients', 'oc-proposals' ) . '</h3><p class="ocp-clients">';
			$html .= esc_html( implode( '  ·  ', wp_list_pluck( $clients, 'name' ) ) );
			$html .= '</p>';
		}
		$html .= '</section>';
		return $html;
	}
}
