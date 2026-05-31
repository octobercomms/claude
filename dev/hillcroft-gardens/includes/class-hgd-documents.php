<?php
/**
 * Client-facing keepsake documents — the Plant book, the printable Proposal
 * keepsake, and the Seasonal film.
 *
 * Each is a standalone, on-brand full-HTML page (it does not use the theme),
 * reached via the same unguessable proposal token that gates the client portal,
 * so the same private link family works. Admin previews (gated by manage_options)
 * let the studio open a project's book/film before a proposal exists.
 *
 * Query vars:
 *   - ?hgd_book=<proposal_token>            print-ready planting book
 *   - ?hgd_book_preview=<project_id>        admin-only book preview
 *   - ?hgd_keepsake=<proposal_token>        printable proposal record
 *   - ?hgd_film=<proposal_token>            CSS/JS seasonal slideshow ("film")
 *   - ?hgd_film_preview=<project_id>        admin-only film preview
 *
 * The book + keepsake are print-optimised (A4 @page CSS, "Print / Save as PDF"
 * button); the film is a cinematic Ken-Burns slideshow built with pure CSS/JS.
 * No internal cost/margin is ever exposed. Every page validates its credential
 * and sends noindex headers.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Documents {

	public static function init() {
		add_filter( 'query_vars', array( __CLASS__, 'register_query_vars' ) );
		add_action( 'template_redirect', array( __CLASS__, 'maybe_render' ) );
	}

	public static function register_query_vars( $vars ) {
		$vars[] = 'hgd_book';
		$vars[] = 'hgd_book_preview';
		$vars[] = 'hgd_keepsake';
		$vars[] = 'hgd_film';
		$vars[] = 'hgd_film_preview';
		return $vars;
	}

	/** Read a query var, falling back to the raw $_GET (rewrites may be absent). */
	private static function read_var( $key ) {
		$value = get_query_var( $key );
		if ( '' === $value && isset( $_GET[ $key ] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			$value = wp_unslash( $_GET[ $key ] ); // phpcs:ignore WordPress.Security.NonceVerification
		}
		return (string) $value;
	}

	private static function clean_token( $raw ) {
		return preg_replace( '/[^A-Za-z0-9]/', '', (string) $raw );
	}

	// -------------------------------------------------------------------------
	// Routing
	// -------------------------------------------------------------------------

	public static function maybe_render() {
		// Tokenised, client-facing pages -------------------------------------
		$book_token     = self::clean_token( self::read_var( 'hgd_book' ) );
		$keepsake_token = self::clean_token( self::read_var( 'hgd_keepsake' ) );
		$film_token     = self::clean_token( self::read_var( 'hgd_film' ) );

		// Admin-only previews by project id ----------------------------------
		$book_preview = (int) self::read_var( 'hgd_book_preview' );
		$film_preview = (int) self::read_var( 'hgd_film_preview' );

		if ( '' === $book_token && '' === $keepsake_token && '' === $film_token
			&& $book_preview < 1 && $film_preview < 1 ) {
			return; // not our page
		}

		nocache_headers();
		header( 'Content-Type: text/html; charset=utf-8' );

		// --- Admin previews (capability-gated, never token) -----------------
		if ( $book_preview > 0 ) {
			$project = self::guard_preview( $book_preview );
			if ( $project ) {
				self::render_book( $project );
			}
			exit;
		}
		if ( $film_preview > 0 ) {
			$project = self::guard_preview( $film_preview );
			if ( $project ) {
				self::render_film( $project );
			}
			exit;
		}

		// --- Tokenised pages ------------------------------------------------
		if ( '' !== $book_token ) {
			$project = self::project_from_token( $book_token );
			if ( $project ) {
				self::render_book( $project );
			}
			exit;
		}
		if ( '' !== $keepsake_token ) {
			$proposal = self::live_proposal_from_token( $keepsake_token );
			if ( $proposal ) {
				self::render_keepsake( $proposal );
			}
			exit;
		}
		if ( '' !== $film_token ) {
			$project = self::project_from_token( $film_token );
			if ( $project ) {
				self::render_film( $project );
			}
			exit;
		}
	}

	/** Resolve an admin-preview project, or emit a polite 404 and return null. */
	private static function guard_preview( $project_id ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			status_header( 404 );
			self::render_unavailable();
			return null;
		}
		$project = HGD_Project::get( (int) $project_id );
		if ( ! $project ) {
			status_header( 404 );
			self::render_unavailable();
			return null;
		}
		return $project;
	}

	/** Resolve a live (non-draft, non-expired) proposal from a token, or null + 404/410. */
	private static function live_proposal_from_token( $token ) {
		$proposal = HGD_Proposal::get_by_token( $token );
		if ( ! $proposal || 'draft' === $proposal['status'] || HGD_Proposal::is_expired( $proposal ) ) {
			status_header( $proposal ? 410 : 404 );
			self::render_unavailable();
			return null;
		}
		return $proposal;
	}

	/** Resolve the project behind a live proposal token, or null + 404/410. */
	private static function project_from_token( $token ) {
		$proposal = self::live_proposal_from_token( $token );
		if ( ! $proposal ) {
			return null;
		}
		$project = HGD_Project::get( (int) $proposal['project_id'] );
		if ( ! $project ) {
			status_header( 404 );
			self::render_unavailable();
			return null;
		}
		return $project;
	}

	// -------------------------------------------------------------------------
	// Shared helpers
	// -------------------------------------------------------------------------

	/** Brand palette resolved from settings (with safe fallbacks). */
	private static function palette() {
		$s = HGD_Settings::all();
		return array(
			'olive'    => sanitize_hex_color( $s['brand_olive'] ) ?: '#494A20',
			'charcoal' => sanitize_hex_color( $s['brand_charcoal'] ) ?: '#1B1C18',
			'cream'    => sanitize_hex_color( $s['brand_cream'] ) ?: '#F2ECDD',
		);
	}

	/** The studio "from" line for closing pages (no settings contact field exists). */
	private static function contact_line() {
		$name  = get_bloginfo( 'name' );
		$email = sanitize_email( get_option( 'admin_email' ) );
		$bits  = array();
		if ( '' !== (string) $name ) {
			$bits[] = $name;
		}
		if ( '' !== $email ) {
			$bits[] = $email;
		}
		return implode( ' · ', $bits );
	}

	/** A client-friendly "prepared for" name from the project's client / address. */
	private static function prepared_for( array $project ) {
		$client = ! empty( $project['client_id'] ) ? HGD_Client::get( (int) $project['client_id'] ) : null;
		if ( $client ) {
			$name = HGD_Client::full_name( $client );
			if ( '' !== trim( (string) $name ) ) {
				return $name;
			}
		}
		if ( ! empty( $project['address'] ) ) {
			return (string) $project['address'];
		}
		return get_bloginfo( 'name' );
	}

	/**
	 * The distinct plants used in a project's garden — gathered from the plant
	 * line items across all of the project's quotes (item_type 'plant' carries a
	 * plant_id). De-duplicated by plant id, preserving first-seen order.
	 *
	 * @return array[] HGD_Plant rows (ARRAY_A).
	 */
	private static function plants_for_project( $project_id ) {
		$seen   = array();
		$plants = array();
		foreach ( HGD_Quote::for_project( (int) $project_id ) as $quote ) {
			foreach ( HGD_Quote::items( (int) $quote['id'] ) as $item ) {
				if ( 'plant' !== $item['item_type'] || empty( $item['plant_id'] ) ) {
					continue;
				}
				$pid = (int) $item['plant_id'];
				if ( isset( $seen[ $pid ] ) ) {
					continue;
				}
				$plant = HGD_Plant::get( $pid );
				if ( $plant ) {
					$seen[ $pid ]   = true;
					$plants[]       = $plant;
				}
			}
		}
		return $plants;
	}

	/** Count of distinct plants for a project (used by the admin panel). */
	public static function plant_count_for_project( $project_id ) {
		return count( self::plants_for_project( (int) $project_id ) );
	}

	/**
	 * The cover image url for a project's book: prefer the 'watercolour' pack
	 * view, then any pack image, then any concept render.
	 */
	private static function cover_image_url( $project_id ) {
		$project_id = (int) $project_id;
		$pack       = HGD_Render_Pack::pack_for_project( $project_id );

		foreach ( $pack as $row ) {
			if ( isset( $row['view_key'] ) && 'watercolour' === $row['view_key'] ) {
				$url = wp_get_attachment_image_url( (int) $row['attachment_id'], 'full' );
				if ( $url ) {
					return $url;
				}
			}
		}
		foreach ( $pack as $row ) {
			$url = wp_get_attachment_image_url( (int) $row['attachment_id'], 'full' );
			if ( $url ) {
				return $url;
			}
		}
		$renders = HGD_Project_Asset::for_project( $project_id, 'render' );
		foreach ( $renders as $r ) {
			$url = wp_get_attachment_image_url( (int) $r['attachment_id'], 'full' );
			if ( $url ) {
				return $url;
			}
		}
		return '';
	}

	/**
	 * Slides for the seasonal film. Prefers seasonal variants of the hero /
	 * corner views; if there are fewer than two such slides, falls back to all
	 * pack images. Each slide: array{ url, caption }.
	 *
	 * @return array[]
	 */
	private static function film_slides( $project_id ) {
		$project_id = (int) $project_id;
		$pack       = HGD_Render_Pack::pack_for_project( $project_id );
		if ( empty( $pack ) ) {
			return array();
		}

		// Views we prefer for the cinematic film (hero + eye-level corners).
		$preferred = array( 'watercolour', 'corner_patio', 'corner_border', 'corner_focal' );

		$seasonal = array();
		$all      = array();
		foreach ( $pack as $row ) {
			$url = wp_get_attachment_image_url( (int) $row['attachment_id'], 'full' );
			if ( ! $url ) {
				continue;
			}
			$view_key = isset( $row['view_key'] ) ? (string) $row['view_key'] : '';
			$label    = isset( $row['pack_label'] ) ? (string) $row['pack_label'] : HGD_Render_Pack::view_label( $view_key );
			$slide    = array( 'url' => $url, 'caption' => $label );

			$all[] = $slide;

			// A "seasonal variant" of a preferred view has its season folded into
			// the label (label differs from the bare view label) on a preferred view.
			$is_preferred = in_array( $view_key, $preferred, true );
			$is_seasonal  = $label !== HGD_Render_Pack::view_label( $view_key );
			if ( $is_preferred && $is_seasonal ) {
				$seasonal[] = $slide;
			}
		}

		return count( $seasonal ) >= 2 ? $seasonal : $all;
	}

	// -------------------------------------------------------------------------
	// Document <head> (print + screen brand CSS)
	// -------------------------------------------------------------------------

	/**
	 * Full <head> + opening <body class="…"> for a print-ready keepsake document.
	 *
	 * @param string $title     Page title.
	 * @param string $body_class Extra class on <body>.
	 */
	private static function doc_head( $title, $body_class = '' ) {
		$p = self::palette();
		ob_start();
		?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo( 'charset' ); ?>" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title><?php echo esc_html( $title . ' — ' . get_bloginfo( 'name' ) ); ?></title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400;1,600&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet" />
<style>
:root{--hgd-olive:<?php echo esc_html( $p['olive'] ); ?>;--hgd-charcoal:<?php echo esc_html( $p['charcoal'] ); ?>;--hgd-cream:<?php echo esc_html( $p['cream'] ); ?>;--hgd-paper:#FBF9F3;--hgd-green:#9FA145;--hgd-line:rgba(73,74,32,.18);}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;}
body{background:#d8d2c2;color:var(--hgd-charcoal);font-family:"DM Sans",system-ui,sans-serif;font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased;}
h1,h2,h3{font-family:"Cormorant Garamond",Georgia,serif;font-weight:600;color:var(--hgd-olive);line-height:1.12;margin:0 0 .4em;}

/* --- Print-ready A4 pages --- */
@page{size:A4;margin:0;}
.hgd-doc{max-width:210mm;margin:0 auto;}
.page{position:relative;width:210mm;min-height:297mm;margin:0 auto 18px;padding:22mm 20mm;background:var(--hgd-cream);box-shadow:0 6px 24px rgba(27,28,24,.18);page-break-after:always;overflow:hidden;}
.page:last-child{page-break-after:auto;margin-bottom:0;}

/* Cover */
.page-cover{display:flex;flex-direction:column;justify-content:flex-end;color:#fff;padding:0;background:var(--hgd-olive);}
.page-cover .cover-bg{position:absolute;inset:0;background-size:cover;background-position:center;}
.page-cover .cover-scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(27,28,24,.10) 0%,rgba(27,28,24,.18) 45%,rgba(27,28,24,.78) 100%);}
.page-cover .cover-inner{position:relative;padding:22mm 20mm 24mm;}
.cover-mark{font-family:"Cormorant Garamond",Georgia,serif;font-size:1.5rem;letter-spacing:.04em;margin-bottom:auto;}
.cover-eyebrow{text-transform:uppercase;letter-spacing:.28em;font-size:.72rem;opacity:.92;margin-bottom:14px;}
.page-cover h1{color:#fff;font-size:3.4rem;margin:0 0 .25em;text-shadow:0 1px 18px rgba(0,0,0,.35);}
.cover-for{font-size:1.15rem;opacity:.95;}

/* Intro */
.doc-eyebrow{text-transform:uppercase;letter-spacing:.24em;font-size:.72rem;color:var(--hgd-green);margin:0 0 10px;}
.page h1.doc-title{font-size:2.6rem;margin-bottom:.4em;}
.doc-brief{font-size:1.05rem;line-height:1.75;color:rgba(27,28,24,.85);}
.doc-brief p{margin:0 0 1em;}
.doc-rule{width:54px;height:3px;background:var(--hgd-green);border:none;margin:0 0 24px;}

/* Plant page */
.plant-head{display:flex;align-items:baseline;justify-content:space-between;gap:18px;border-bottom:2px solid var(--hgd-olive);padding-bottom:14px;margin-bottom:22px;}
.plant-name h2{font-size:2.4rem;font-style:italic;margin:0;}
.plant-name .common{font-size:1.1rem;color:rgba(27,28,24,.7);margin-top:4px;}
.plant-index{font-family:"Cormorant Garamond",Georgia,serif;font-size:1.3rem;color:var(--hgd-green);white-space:nowrap;}
.plant-photo{width:100%;height:88mm;border-radius:10px;background:repeating-linear-gradient(45deg,#ece6d6,#ece6d6 14px,#e6dfcc 14px,#e6dfcc 28px);border:1px solid var(--hgd-line);display:flex;align-items:center;justify-content:center;color:rgba(73,74,32,.55);font-family:"Cormorant Garamond",Georgia,serif;font-size:1.1rem;font-style:italic;margin-bottom:22px;overflow:hidden;}
.plant-photo img{width:100%;height:100%;object-fit:cover;display:block;}
.facts{display:grid;grid-template-columns:1fr 1fr;gap:0 28px;margin:0 0 18px;}
.fact{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--hgd-line);}
.fact .k{color:rgba(27,28,24,.6);font-size:.86rem;}
.fact .v{font-weight:500;text-align:right;}
.plant-notes{background:var(--hgd-paper);border:1px solid var(--hgd-line);border-radius:10px;padding:16px 18px;font-size:.95rem;color:rgba(27,28,24,.82);}
.plant-notes .lbl{display:block;font-size:.72rem;text-transform:uppercase;letter-spacing:.18em;color:var(--hgd-green);margin-bottom:6px;}

/* Closing */
.page-close{display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;}
.page-close h2{font-size:2.6rem;}
.page-close .close-mark{font-family:"Cormorant Garamond",Georgia,serif;font-size:1.4rem;color:var(--hgd-olive);margin-top:auto;}
.page-close .close-contact{color:rgba(27,28,24,.6);font-size:.92rem;margin-bottom:auto;}
.page-foot{position:absolute;left:20mm;right:20mm;bottom:12mm;display:flex;justify-content:space-between;font-size:.72rem;color:rgba(27,28,24,.45);letter-spacing:.04em;}

/* Keepsake gallery + tables */
.k-gallery{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:0 0 22px;}
.k-gallery img{width:100%;height:auto;border-radius:8px;display:block;border:1px solid var(--hgd-line);}
.k-table{width:100%;border-collapse:collapse;margin:0 0 8px;}
.k-table td{padding:10px 0;border-bottom:1px solid var(--hgd-line);}
.k-table td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}
.k-table tr.total td{border-top:2px solid var(--hgd-olive);border-bottom:none;padding-top:13px;font-size:1.15rem;}
.k-tag{display:inline-block;margin-left:8px;font-size:.7rem;font-weight:500;border-radius:999px;padding:2px 9px;background:rgba(73,74,32,.1);color:var(--hgd-olive);}
.k-tag-paid{background:var(--hgd-green);color:#fff;}
.k-terms{font-size:.9rem;color:rgba(27,28,24,.78);}
.k-section{margin:0 0 26px;}
.k-section h2{font-size:1.7rem;}

/* Print button (screen only) */
.hgd-print-btn{position:fixed;right:22px;bottom:22px;z-index:50;appearance:none;border:none;cursor:pointer;background:var(--hgd-olive);color:#fff;font:500 15px/1 "DM Sans",sans-serif;border-radius:999px;padding:15px 24px;box-shadow:0 8px 24px rgba(27,28,24,.3);}
.hgd-print-btn:hover{background:#3c3d1a;}

@media print{
	body{background:#fff;}
	.hgd-print-btn{display:none !important;}
	.page{box-shadow:none;margin:0;width:auto;min-height:auto;}
	.hgd-doc{max-width:none;}
}
</style>
</head>
<body class="<?php echo esc_attr( $body_class ); ?>">
		<?php
		return ob_get_clean();
	}

	/** A polite "no longer available" page (shared with the portal's tone). */
	private static function render_unavailable() {
		echo self::doc_head( __( 'Keepsake unavailable', 'hillcroft-garden-designer' ) ); // phpcs:ignore WordPress.Security.EscapeOutput
		?>
		<div class="hgd-doc"><div class="page page-close">
			<div class="close-mark"><?php esc_html_e( 'Hillcroft Gardens', 'hillcroft-garden-designer' ); ?></div>
			<h2><?php esc_html_e( 'This keepsake link is no longer available', 'hillcroft-garden-designer' ); ?></h2>
			<p class="close-contact"><?php esc_html_e( 'The link may have expired or been superseded. Please get in touch and we’ll send you an up-to-date copy.', 'hillcroft-garden-designer' ); ?></p>
		</div></div>
		</body></html>
		<?php
	}

	private static function print_button() {
		?>
		<button type="button" class="hgd-print-btn" onclick="window.print();"><?php esc_html_e( 'Print / Save as PDF', 'hillcroft-garden-designer' ); ?></button>
		<?php
	}

	// -------------------------------------------------------------------------
	// Plant book
	// -------------------------------------------------------------------------

	private static function render_book( array $project ) {
		$pid    = (int) $project['id'];
		$title  = '' !== trim( (string) $project['title'] ) ? (string) $project['title'] : __( 'Your garden', 'hillcroft-garden-designer' );
		$cover  = self::cover_image_url( $pid );
		$for    = self::prepared_for( $project );
		$brief  = trim( (string) ( isset( $project['design_brief'] ) ? $project['design_brief'] : '' ) );
		if ( '' === $brief ) {
			$brief = trim( (string) ( isset( $project['brief_notes'] ) ? $project['brief_notes'] : '' ) );
		}
		$plants = self::plants_for_project( $pid );

		echo self::doc_head( sprintf( __( 'Planting book — %s', 'hillcroft-garden-designer' ), $title ) ); // phpcs:ignore WordPress.Security.EscapeOutput
		?>
		<div class="hgd-doc">

			<!-- Cover -->
			<section class="page page-cover">
				<?php if ( '' !== $cover ) : ?>
					<div class="cover-bg" style="background-image:url('<?php echo esc_url( $cover ); ?>');"></div>
				<?php endif; ?>
				<div class="cover-scrim"></div>
				<div class="cover-inner">
					<div class="cover-mark"><?php esc_html_e( 'Hillcroft Gardens', 'hillcroft-garden-designer' ); ?></div>
					<div class="cover-eyebrow"><?php esc_html_e( 'The Planting Book', 'hillcroft-garden-designer' ); ?></div>
					<h1><?php echo esc_html( $title ); ?></h1>
					<p class="cover-for"><?php echo esc_html( sprintf( __( 'A planting book for %s', 'hillcroft-garden-designer' ), $for ) ); ?></p>
				</div>
			</section>

			<!-- Intro -->
			<section class="page">
				<p class="doc-eyebrow"><?php esc_html_e( 'Your garden', 'hillcroft-garden-designer' ); ?></p>
				<h1 class="doc-title"><?php esc_html_e( 'The design', 'hillcroft-garden-designer' ); ?></h1>
				<hr class="doc-rule" />
				<div class="doc-brief">
					<?php
					if ( '' !== $brief ) {
						echo wp_kses_post( wpautop( esc_html( $brief ) ) );
					} else {
						echo '<p>' . esc_html__( 'A garden designed around the way you live — chosen plants, considered planting and a scheme to enjoy through every season.', 'hillcroft-garden-designer' ) . '</p>';
					}
					?>
				</div>
				<div class="page-foot"><span><?php echo esc_html( $title ); ?></span><span><?php esc_html_e( 'Hillcroft Gardens', 'hillcroft-garden-designer' ); ?></span></div>
			</section>

			<!-- One page per plant -->
			<?php
			$total = count( $plants );
			$i     = 0;
			foreach ( $plants as $plant ) :
				$i++;
				echo self::plant_page( $plant, $i, $total, $title ); // phpcs:ignore WordPress.Security.EscapeOutput
			endforeach;

			if ( 0 === $total ) :
				?>
				<section class="page">
					<p class="doc-eyebrow"><?php esc_html_e( 'Your plants', 'hillcroft-garden-designer' ); ?></p>
					<h1 class="doc-title"><?php esc_html_e( 'Planting list', 'hillcroft-garden-designer' ); ?></h1>
					<hr class="doc-rule" />
					<p class="doc-brief"><?php esc_html_e( 'Your planting list will appear here once the plants have been chosen for your garden.', 'hillcroft-garden-designer' ); ?></p>
				</section>
			<?php endif; ?>

			<!-- Closing -->
			<section class="page page-close">
				<p class="close-contact"><?php esc_html_e( 'With thanks for letting us design your garden.', 'hillcroft-garden-designer' ); ?></p>
				<h2><?php esc_html_e( 'Enjoy your garden, season after season.', 'hillcroft-garden-designer' ); ?></h2>
				<div class="close-mark">
					<?php esc_html_e( 'Hillcroft Gardens', 'hillcroft-garden-designer' ); ?>
					<?php if ( '' !== self::contact_line() ) : ?>
						<div class="close-contact" style="margin-top:8px;"><?php echo esc_html( self::contact_line() ); ?></div>
					<?php endif; ?>
				</div>
			</section>

		</div>
		<?php
		self::print_button();
		?>
		</body></html>
		<?php
	}

	/** One elegant per-plant page. */
	private static function plant_page( array $plant, $index, $total, $book_title ) {
		$botanical = trim( (string) $plant['botanical_name'] );
		$common    = trim( (string) $plant['common_name'] );
		if ( '' === $botanical && '' === $common ) {
			$botanical = __( 'Plant', 'hillcroft-garden-designer' );
		}

		$facts = self::plant_facts( $plant );
		$notes = trim( (string) $plant['notes'] );

		ob_start();
		?>
		<section class="page">
			<div class="plant-head">
				<div class="plant-name">
					<h2><?php echo esc_html( '' !== $botanical ? $botanical : $common ); ?></h2>
					<?php if ( '' !== $common && '' !== $botanical ) : ?>
						<div class="common"><?php echo esc_html( $common ); ?></div>
					<?php endif; ?>
				</div>
				<div class="plant-index"><?php echo esc_html( sprintf( /* translators: 1: index 2: total */ __( '%1$d of %2$d', 'hillcroft-garden-designer' ), (int) $index, (int) $total ) ); ?></div>
			</div>

			<div class="plant-photo"><?php esc_html_e( 'Plant portrait', 'hillcroft-garden-designer' ); ?></div>

			<?php if ( ! empty( $facts ) ) : ?>
				<div class="facts">
					<?php foreach ( $facts as $k => $v ) : ?>
						<div class="fact"><span class="k"><?php echo esc_html( $k ); ?></span><span class="v"><?php echo esc_html( $v ); ?></span></div>
					<?php endforeach; ?>
				</div>
			<?php endif; ?>

			<?php if ( '' !== $notes ) : ?>
				<div class="plant-notes">
					<span class="lbl"><?php esc_html_e( "Donna's notes", 'hillcroft-garden-designer' ); ?></span>
					<?php echo esc_html( $notes ); ?>
				</div>
			<?php endif; ?>

			<div class="page-foot"><span><?php echo esc_html( $book_title ); ?></span><span><?php esc_html_e( 'Hillcroft Gardens', 'hillcroft-garden-designer' ); ?></span></div>
		</section>
		<?php
		return ob_get_clean();
	}

	/** Build the labelled care facts for a plant (skips empties). */
	private static function plant_facts( array $plant ) {
		$facts = array();

		$type = (string) $plant['plant_type'];
		if ( '' !== $type ) {
			$facts[ __( 'Type', 'hillcroft-garden-designer' ) ] = ucfirst( $type );
		}

		$sun = (string) $plant['sun'];
		if ( '' !== $sun ) {
			$sun_labels = array(
				'full_sun'   => __( 'Full sun', 'hillcroft-garden-designer' ),
				'part_shade' => __( 'Partial shade', 'hillcroft-garden-designer' ),
				'shade'      => __( 'Shade', 'hillcroft-garden-designer' ),
			);
			$facts[ __( 'Aspect', 'hillcroft-garden-designer' ) ] = isset( $sun_labels[ $sun ] ) ? $sun_labels[ $sun ] : ucwords( str_replace( '_', ' ', $sun ) );
		}

		if ( '' !== (string) $plant['soil'] ) {
			$facts[ __( 'Soil', 'hillcroft-garden-designer' ) ] = (string) $plant['soil'];
		}
		if ( '' !== (string) $plant['hardiness'] ) {
			$facts[ __( 'Hardiness', 'hillcroft-garden-designer' ) ] = (string) $plant['hardiness'];
		}

		$foliage = (string) $plant['foliage'];
		if ( '' !== $foliage ) {
			$facts[ __( 'Foliage', 'hillcroft-garden-designer' ) ] = ucwords( str_replace( '_', ' ', $foliage ) );
		}

		if ( '' !== (string) $plant['flowering_months'] ) {
			$facts[ __( 'In flower', 'hillcroft-garden-designer' ) ] = (string) $plant['flowering_months'];
		}

		$h = (int) $plant['mature_height_cm'];
		$w = (int) $plant['mature_spread_cm'];
		if ( $h > 0 || $w > 0 ) {
			$size = '';
			if ( $h > 0 ) {
				$size .= self::cm_label( $h );
			}
			if ( $w > 0 ) {
				$size .= ( '' !== $size ? ' × ' : '' ) . self::cm_label( $w );
			}
			$facts[ __( 'Mature size (H × W)', 'hillcroft-garden-designer' ) ] = $size;
		}

		$spacing = (float) $plant['spacing_per_sqm'];
		if ( $spacing > 0 ) {
			$facts[ __( 'Planting density', 'hillcroft-garden-designer' ) ] = sprintf( /* translators: %s number per m² */ __( '%s per m²', 'hillcroft-garden-designer' ), rtrim( rtrim( number_format( $spacing, 2 ), '0' ), '.' ) );
		}

		return $facts;
	}

	/** Friendly cm → m/cm label. */
	private static function cm_label( $cm ) {
		$cm = (int) $cm;
		if ( $cm >= 100 ) {
			$m = rtrim( rtrim( number_format( $cm / 100, 1 ), '0' ), '.' );
			return $m . 'm';
		}
		return $cm . 'cm';
	}

	// -------------------------------------------------------------------------
	// Proposal keepsake (printable record)
	// -------------------------------------------------------------------------

	private static function render_keepsake( array $proposal ) {
		$project = HGD_Project::get( (int) $proposal['project_id'] );
		$title   = ( $project && '' !== trim( (string) $project['title'] ) ) ? (string) $project['title'] : __( 'Your garden proposal', 'hillcroft-garden-designer' );
		$for     = $project ? self::prepared_for( $project ) : get_bloginfo( 'name' );

		$breakdown = self::client_breakdown( (int) $proposal['quote_id'] );
		$payments  = HGD_Payment::for_proposal( (int) $proposal['id'] );
		$renders   = $project ? HGD_Project_Asset::for_project( (int) $project['id'], 'render' ) : array();

		$money = function ( $n ) { return '£' . number_format( (float) $n, 2 ); };

		echo self::doc_head( sprintf( __( 'Proposal keepsake — %s', 'hillcroft-garden-designer' ), $title ) ); // phpcs:ignore WordPress.Security.EscapeOutput
		?>
		<div class="hgd-doc">
			<section class="page">
				<p class="doc-eyebrow"><?php esc_html_e( 'Your proposal', 'hillcroft-garden-designer' ); ?></p>
				<h1 class="doc-title"><?php echo esc_html( $title ); ?></h1>
				<p class="doc-brief" style="margin-top:-.4em;"><?php echo esc_html( sprintf( __( 'Prepared for %s', 'hillcroft-garden-designer' ), $for ) ); ?></p>
				<hr class="doc-rule" />

				<?php if ( '' !== trim( (string) $proposal['intro_text'] ) ) : ?>
					<div class="k-section doc-brief"><?php echo wp_kses_post( wpautop( esc_html( $proposal['intro_text'] ) ) ); ?></div>
				<?php endif; ?>

				<?php if ( ! empty( $renders ) ) : ?>
					<div class="k-section">
						<h2><?php esc_html_e( 'Your concept', 'hillcroft-garden-designer' ); ?></h2>
						<div class="k-gallery">
							<?php
							$shown = 0;
							foreach ( $renders as $r ) :
								if ( $shown >= 4 ) { break; }
								$url = wp_get_attachment_image_url( (int) $r['attachment_id'], 'large' );
								if ( ! $url ) { continue; }
								$shown++;
								?>
								<img src="<?php echo esc_url( $url ); ?>" alt="<?php esc_attr_e( 'Garden concept render', 'hillcroft-garden-designer' ); ?>" />
							<?php endforeach; ?>
						</div>
					</div>
				<?php endif; ?>

				<div class="k-section">
					<h2><?php esc_html_e( 'Your investment', 'hillcroft-garden-designer' ); ?></h2>
					<table class="k-table">
						<tbody>
							<tr><td><?php esc_html_e( 'Planting &amp; materials', 'hillcroft-garden-designer' ); ?></td><td class="num"><?php echo esc_html( $money( $breakdown['planting'] ) ); ?></td></tr>
							<tr><td><?php esc_html_e( 'Labour &amp; installation', 'hillcroft-garden-designer' ); ?></td><td class="num"><?php echo esc_html( $money( $breakdown['labour'] ) ); ?></td></tr>
							<?php if ( $breakdown['design_fee'] > 0 ) : ?>
								<tr><td><?php esc_html_e( 'Design fee', 'hillcroft-garden-designer' ); ?></td><td class="num"><?php echo esc_html( $money( $breakdown['design_fee'] ) ); ?></td></tr>
							<?php endif; ?>
							<?php if ( $breakdown['vat'] > 0 ) : ?>
								<tr><td><?php esc_html_e( 'Subtotal', 'hillcroft-garden-designer' ); ?></td><td class="num"><?php echo esc_html( $money( $breakdown['subtotal'] ) ); ?></td></tr>
								<tr><td><?php esc_html_e( 'VAT', 'hillcroft-garden-designer' ); ?></td><td class="num"><?php echo esc_html( $money( $breakdown['vat'] ) ); ?></td></tr>
							<?php endif; ?>
							<tr class="total"><td><strong><?php esc_html_e( 'Total', 'hillcroft-garden-designer' ); ?></strong></td><td class="num"><strong><?php echo esc_html( $money( $proposal['total_gbp'] ) ); ?></strong></td></tr>
						</tbody>
					</table>
				</div>

				<?php if ( ! empty( $payments ) ) : ?>
					<div class="k-section">
						<h2><?php esc_html_e( 'Payment schedule', 'hillcroft-garden-designer' ); ?></h2>
						<table class="k-table">
							<tbody>
								<?php foreach ( $payments as $p ) : ?>
									<tr>
										<td>
											<?php echo esc_html( $p['label'] ); ?>
											<?php if ( 'paid' === $p['status'] ) : ?>
												<span class="k-tag k-tag-paid"><?php esc_html_e( 'Paid', 'hillcroft-garden-designer' ); ?></span>
											<?php else : ?>
												<span class="k-tag"><?php esc_html_e( 'Due', 'hillcroft-garden-designer' ); ?></span>
											<?php endif; ?>
										</td>
										<td class="num"><?php echo esc_html( $money( $p['amount_gbp'] ) ); ?></td>
									</tr>
								<?php endforeach; ?>
							</tbody>
						</table>
					</div>
				<?php endif; ?>

				<div class="page-foot"><span><?php echo esc_html( $title ); ?></span><span><?php esc_html_e( 'Hillcroft Gardens', 'hillcroft-garden-designer' ); ?></span></div>
			</section>

			<?php if ( '' !== trim( (string) $proposal['terms_text'] ) ) : ?>
				<section class="page">
					<p class="doc-eyebrow"><?php esc_html_e( 'For your records', 'hillcroft-garden-designer' ); ?></p>
					<h1 class="doc-title"><?php esc_html_e( 'Terms &amp; conditions', 'hillcroft-garden-designer' ); ?></h1>
					<hr class="doc-rule" />
					<div class="k-terms"><?php echo wp_kses_post( wpautop( esc_html( $proposal['terms_text'] ) ) ); ?></div>
					<div class="page-foot"><span><?php echo esc_html( $title ); ?></span><span><?php esc_html_e( 'Hillcroft Gardens', 'hillcroft-garden-designer' ); ?></span></div>
				</section>
			<?php endif; ?>
		</div>
		<?php
		self::print_button();
		?>
		</body></html>
		<?php
	}

	/** Client-friendly cost breakdown (mirrors the portal — no margin/cost). */
	private static function client_breakdown( $quote_id ) {
		$t        = HGD_Quote::compute( (int) $quote_id );
		$planting = round( (float) $t['materials_subtotal'] + (float) $t['wastage'] + (float) $t['contingency'], 2 );
		return array(
			'planting'   => $planting,
			'labour'     => round( (float) $t['labour'], 2 ),
			'design_fee' => round( (float) $t['design_fee'], 2 ),
			'subtotal'   => round( (float) $t['subtotal'], 2 ),
			'vat'        => round( (float) $t['vat'], 2 ),
			'total'      => round( (float) $t['total'], 2 ),
		);
	}

	// -------------------------------------------------------------------------
	// Seasonal film (CSS/JS cinematic slideshow)
	// -------------------------------------------------------------------------

	private static function render_film( array $project ) {
		$pid    = (int) $project['id'];
		$title  = '' !== trim( (string) $project['title'] ) ? (string) $project['title'] : __( 'Your garden', 'hillcroft-garden-designer' );
		$slides = self::film_slides( $pid );

		$p = self::palette();
		?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo( 'charset' ); ?>" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title><?php echo esc_html( sprintf( __( '%s — a year in your garden', 'hillcroft-garden-designer' ), $title ) . ' — ' . get_bloginfo( 'name' ) ); ?></title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet" />
<style>
:root{--hgd-olive:<?php echo esc_html( $p['olive'] ); ?>;--hgd-charcoal:<?php echo esc_html( $p['charcoal'] ); ?>;--hgd-cream:<?php echo esc_html( $p['cream'] ); ?>;}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;height:100%;}
body{background:#0d0e0b;color:#fff;font-family:"DM Sans",system-ui,sans-serif;overflow:hidden;}
.film{position:fixed;inset:0;background:#0d0e0b;}

.slide{position:absolute;inset:0;opacity:0;transition:opacity 1.6s ease;}
.slide.is-active{opacity:1;}
.slide .img{position:absolute;inset:0;background-size:cover;background-position:center;transform:scale(1.04);}
.slide.is-active .img{animation:hgd-ken 9s ease-in-out forwards;}
@keyframes hgd-ken{
	0%{transform:scale(1.04) translate(0,0);}
	100%{transform:scale(1.18) translate(-2.5%,-2%);}
}
.slide .scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(13,14,11,.15) 0%,rgba(13,14,11,0) 35%,rgba(13,14,11,.7) 100%);}
.slide .caption{position:absolute;left:6vw;bottom:11vh;max-width:80vw;opacity:0;transform:translateY(14px);transition:opacity 1s ease .5s,transform 1s ease .5s;}
.slide.is-active .caption{opacity:1;transform:none;}
.slide .caption .eyebrow{text-transform:uppercase;letter-spacing:.28em;font-size:.7rem;color:rgba(255,255,255,.7);margin-bottom:8px;}
.slide .caption .label{font-family:"Cormorant Garamond",Georgia,serif;font-size:clamp(1.8rem,4.5vw,3rem);line-height:1.05;}

/* Title card */
.titlecard{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;background:var(--hgd-olive);opacity:0;transition:opacity 1.6s ease;z-index:5;padding:8vw;}
.titlecard.is-active{opacity:1;}
.titlecard .mark{font-family:"Cormorant Garamond",Georgia,serif;font-size:1.5rem;letter-spacing:.05em;margin-bottom:26px;opacity:.92;}
.titlecard h1{font-family:"Cormorant Garamond",Georgia,serif;font-weight:600;font-size:clamp(2.4rem,6vw,4.4rem);line-height:1.05;margin:0;}
.titlecard .sub{margin-top:18px;text-transform:uppercase;letter-spacing:.3em;font-size:.75rem;opacity:.8;}

/* Controls */
.controls{position:fixed;left:0;right:0;bottom:0;z-index:20;display:flex;align-items:center;gap:14px;padding:18px 22px;background:linear-gradient(0deg,rgba(13,14,11,.7),rgba(13,14,11,0));opacity:0;transition:opacity .3s ease;}
.film:hover .controls,.controls:focus-within{opacity:1;}
.ctrl{appearance:none;border:1px solid rgba(255,255,255,.4);background:rgba(0,0,0,.25);color:#fff;font:500 14px/1 "DM Sans",sans-serif;cursor:pointer;border-radius:999px;padding:11px 18px;backdrop-filter:blur(4px);}
.ctrl:hover{background:rgba(255,255,255,.16);}
.progress{flex:1;height:3px;background:rgba(255,255,255,.22);border-radius:2px;overflow:hidden;}
.progress .bar{height:100%;width:0;background:#fff;}
.wordmark{position:fixed;top:22px;left:6vw;z-index:20;font-family:"Cormorant Garamond",Georgia,serif;font-size:1.25rem;letter-spacing:.04em;color:rgba(255,255,255,.92);text-shadow:0 1px 10px rgba(0,0,0,.5);}

.empty{position:fixed;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;background:var(--hgd-olive);padding:8vw;}
.empty h1{font-family:"Cormorant Garamond",Georgia,serif;font-weight:600;font-size:clamp(2rem,5vw,3.4rem);}
</style>
</head>
<body>
		<?php if ( empty( $slides ) ) : ?>
			<div class="empty">
				<div>
					<h1><?php echo esc_html( sprintf( __( '%s — a year in your garden', 'hillcroft-garden-designer' ), $title ) ); ?></h1>
					<p><?php esc_html_e( 'Your seasonal film will appear here once the garden views have been created.', 'hillcroft-garden-designer' ); ?></p>
				</div>
			</div>
			</body></html>
			<?php
			return;
		endif;
		?>
		<div class="film" id="hgd-film">
			<div class="wordmark"><?php esc_html_e( 'Hillcroft Gardens', 'hillcroft-garden-designer' ); ?></div>

			<!-- Title card (first "scene") -->
			<div class="titlecard" data-scene="0">
				<div class="mark"><?php esc_html_e( 'Hillcroft Gardens', 'hillcroft-garden-designer' ); ?></div>
				<h1><?php echo esc_html( sprintf( __( '%s — a year in your garden', 'hillcroft-garden-designer' ), $title ) ); ?></h1>
				<div class="sub"><?php esc_html_e( 'A short film', 'hillcroft-garden-designer' ); ?></div>
			</div>

			<?php foreach ( $slides as $idx => $slide ) : ?>
				<div class="slide" data-scene="<?php echo esc_attr( $idx + 1 ); ?>">
					<div class="img" style="background-image:url('<?php echo esc_url( $slide['url'] ); ?>');"></div>
					<div class="scrim"></div>
					<div class="caption">
						<div class="eyebrow"><?php esc_html_e( 'Your garden', 'hillcroft-garden-designer' ); ?></div>
						<div class="label"><?php echo esc_html( $slide['caption'] ); ?></div>
					</div>
				</div>
			<?php endforeach; ?>

			<div class="controls">
				<button type="button" class="ctrl" id="hgd-prev" aria-label="<?php esc_attr_e( 'Previous', 'hillcroft-garden-designer' ); ?>">‹</button>
				<button type="button" class="ctrl" id="hgd-play" aria-label="<?php esc_attr_e( 'Play or pause', 'hillcroft-garden-designer' ); ?>"><?php esc_html_e( 'Pause', 'hillcroft-garden-designer' ); ?></button>
				<button type="button" class="ctrl" id="hgd-next" aria-label="<?php esc_attr_e( 'Next', 'hillcroft-garden-designer' ); ?>">›</button>
				<div class="progress"><div class="bar" id="hgd-bar"></div></div>
			</div>
		</div>

		<script>
		( function () {
			'use strict';
			var TITLE_MS = 3500;
			var SLIDE_MS = 8000;
			var scenes = Array.prototype.slice.call( document.querySelectorAll( '#hgd-film [data-scene]' ) );
			if ( ! scenes.length ) { return; }

			var i = 0, playing = true, timer = null, started = 0, raf = null;
			var bar = document.getElementById( 'hgd-bar' );
			var playBtn = document.getElementById( 'hgd-play' );
			var labels = { play: <?php echo wp_json_encode( __( 'Play', 'hillcroft-garden-designer' ) ); ?>, pause: <?php echo wp_json_encode( __( 'Pause', 'hillcroft-garden-designer' ) ); ?> };

			function durationFor( idx ) {
				return scenes[ idx ].classList.contains( 'titlecard' ) ? TITLE_MS : SLIDE_MS;
			}

			function tick() {
				if ( ! playing ) { return; }
				var pct = Math.min( 1, ( Date.now() - started ) / durationFor( i ) );
				if ( bar ) { bar.style.width = ( pct * 100 ) + '%'; }
				if ( pct >= 1 ) { next(); return; }
				raf = requestAnimationFrame( tick );
			}

			function restartKenBurns( el ) {
				// Re-trigger the CSS Ken Burns animation when a slide becomes active.
				var img = el.querySelector( '.img' );
				if ( ! img ) { return; }
				img.style.animation = 'none';
				/* force reflow */
				void img.offsetWidth;
				img.style.animation = '';
			}

			function show( idx ) {
				if ( raf ) { cancelAnimationFrame( raf ); }
				scenes.forEach( function ( s, n ) { s.classList.toggle( 'is-active', n === idx ); } );
				i = idx;
				restartKenBurns( scenes[ i ] );
				started = Date.now();
				if ( bar ) { bar.style.width = '0%'; }
				if ( playing ) { raf = requestAnimationFrame( tick ); }
			}

			function next() { show( ( i + 1 ) % scenes.length ); }
			function prev() { show( ( i - 1 + scenes.length ) % scenes.length ); }

			function setPlaying( on ) {
				playing = on;
				if ( playBtn ) { playBtn.textContent = on ? labels.pause : labels.play; }
				if ( on ) { started = Date.now(); raf = requestAnimationFrame( tick ); }
				else if ( raf ) { cancelAnimationFrame( raf ); }
			}

			document.getElementById( 'hgd-next' ).addEventListener( 'click', function () { next(); } );
			document.getElementById( 'hgd-prev' ).addEventListener( 'click', function () { prev(); } );
			playBtn.addEventListener( 'click', function () { setPlaying( ! playing ); } );
			document.addEventListener( 'keydown', function ( e ) {
				if ( 'ArrowRight' === e.key ) { next(); }
				else if ( 'ArrowLeft' === e.key ) { prev(); }
				else if ( ' ' === e.key ) { e.preventDefault(); setPlaying( ! playing ); }
			} );

			show( 0 );
		} )();
		</script>
		</body></html>
		<?php
	}
}
