<?php
/**
 * Context Pack — the site learner.
 *
 * Reads the site's OWN published pages and posts (directly from WordPress, so
 * there's no HTTP fetch and no SSRF surface) and has Claude distil a structured,
 * persistent profile of the business: positioning, products, ICP, brand-voice
 * signals, recurring themes, an internal-link map, and author hints. Every later
 * pipeline stage conditions on this so the output is specific to THIS company,
 * not generic.
 *
 * Runs as a background job ('blog_context_pack'); the admin screen polls it.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OctoberMI_Blog_Context_Pack {

	const OPTION   = 'octobermi_blog_context_pack';
	const JOB_TYPE = 'blog_context_pack';

	/** Corpus limits — enough signal, bounded token cost. */
	const MAX_PAGES     = 15;
	const MAX_POSTS     = 15;
	const PER_DOC_CHARS = 1800;

	/** @return array|null the stored pack, or null if never learned. */
	public static function get() {
		$pack = get_option( self::OPTION, null );
		return is_array( $pack ) ? $pack : null;
	}

	public static function store( array $pack ) {
		$pack['learned_at'] = time();
		update_option( self::OPTION, $pack, false );
	}

	/** Queue a learn run. Returns the job id. */
	public static function start() {
		return OctoberMI_Jobs::enqueue( self::JOB_TYPE, array( 'site' => home_url() ) );
	}

	// =====================================================================
	// Job handler
	// =====================================================================

	/**
	 * @param array $job    The job row.
	 * @param int   $job_id
	 * @return array The stored pack (also persisted to the option).
	 * @throws Exception on a model failure (surfaces as the job error).
	 */
	public static function run_job( $job, $job_id ) {
		OctoberMI_Jobs::progress( $job_id, 10, __( 'Reading your pages and posts…', 'october-mi' ) );
		$corpus = self::gather_corpus();

		if ( '' === trim( $corpus['text'] ) ) {
			throw new Exception( __( 'No published pages or posts were found to learn from.', 'october-mi' ) );
		}

		OctoberMI_Jobs::progress( $job_id, 45, __( 'Learning your business with Claude…', 'october-mi' ) );

		$response = OctoberMI_Claude::complete( array(
			'model'      => OctoberMI_Claude::MODEL_DRAFT,
			'max_tokens' => 2200,
			'system'     => self::system_prompt(),
			'messages'   => array(
				array( 'role' => 'user', 'content' => self::user_prompt( $corpus['text'] ) ),
			),
		) );

		if ( is_wp_error( $response ) ) {
			throw new Exception( $response->get_error_message() );
		}

		OctoberMI_Jobs::progress( $job_id, 85, __( 'Structuring the company profile…', 'october-mi' ) );
		$pack = OctoberMI_Claude::json_from_reply( $response );
		if ( ! is_array( $pack ) || empty( $pack ) ) {
			$snippet = trim( preg_replace( '/\s+/u', ' ', (string) $response ) );
			$snippet = function_exists( 'mb_substr' ) ? mb_substr( $snippet, 0, 180 ) : substr( $snippet, 0, 180 );
			OctoberMI_Log::error( 'blog.learn', 'Unparseable profile reply', array( 'reply' => $snippet ) );
			throw new Exception( sprintf(
				/* translators: %s: a short excerpt of the model's reply. */
				__( 'Could not read a structured profile back from the model. It replied: “%s”', 'october-mi' ),
				'' === $snippet ? '(empty reply)' : $snippet
			) );
		}

		// Attach the internal-link map we already have from the corpus pass.
		$pack['internal_links'] = $corpus['links'];
		$pack['source_counts']  = $corpus['counts'];

		self::store( $pack );
		return $pack;
	}

	// =====================================================================
	// Corpus
	// =====================================================================

	private static function gather_corpus() {
		$links = array();
		$parts = array();

		// Site identity always helps ground the model.
		$name    = get_bloginfo( 'name' );
		$tagline = get_bloginfo( 'description' );
		if ( $name || $tagline ) {
			$parts[] = '## About this site' . "\n" . trim( $name . ( $tagline ? ' — ' . $tagline : '' ) );
		}

		$pages = get_posts( array(
			'post_type'        => 'page',
			'post_status'      => 'publish',
			'numberposts'      => self::MAX_PAGES,
			'orderby'          => 'menu_order title',
			'order'            => 'ASC',
			'suppress_filters' => false,
		) );
		$posts = get_posts( array(
			'post_type'        => 'post',
			'post_status'      => 'publish',
			'numberposts'      => self::MAX_POSTS,
			'orderby'          => 'date',
			'order'            => 'DESC',
			'suppress_filters' => false,
		) );

		$fetches = 0;
		foreach ( array_merge( $pages, $posts ) as $p ) {
			$title = get_the_title( $p );
			$body  = self::render_text( $p->post_content );

			// Page builders (Elementor, Divi, etc.) store little in post_content
			// — fall back to the rendered page over HTTP (same-site only), a few
			// times, so we learn the real visible copy.
			if ( strlen( $body ) < 160 && $fetches < 8 ) {
				$fetched = self::fetch_visible_text( get_permalink( $p ) );
				$fetches++;
				if ( strlen( $fetched ) > strlen( $body ) ) {
					$body = $fetched;
				}
			}

			if ( '' === $title && '' === $body ) {
				continue;
			}
			$snippet = function_exists( 'mb_substr' ) ? mb_substr( $body, 0, self::PER_DOC_CHARS ) : substr( $body, 0, self::PER_DOC_CHARS );

			$parts[] = '## ' . $title . ' (' . $p->post_type . ")\n" . $snippet;
			$links[] = array(
				'title' => $title,
				'url'   => get_permalink( $p ),
				'type'  => $p->post_type,
			);
		}

		$text = implode( "\n\n", $parts );

		// Last resort: if we still learned almost nothing, read the homepage.
		if ( strlen( $text ) < 400 ) {
			$home = self::fetch_visible_text( home_url( '/' ) );
			if ( '' !== $home ) {
				$text .= "\n\n## Homepage\n" . ( function_exists( 'mb_substr' ) ? mb_substr( $home, 0, 3000 ) : substr( $home, 0, 3000 ) );
			}
		}

		return array(
			'text'   => $text,
			'links'  => $links,
			'counts' => array( 'pages' => count( $pages ), 'posts' => count( $posts ), 'chars' => strlen( $text ) ),
		);
	}

	/** Render blocks + shortcodes to plain, collapsed text. */
	private static function render_text( $content ) {
		$content = (string) $content;
		if ( function_exists( 'do_blocks' ) ) {
			$content = do_blocks( $content );
		}
		$content = do_shortcode( $content );
		$content = wp_strip_all_tags( $content, true );
		return trim( preg_replace( '/\s+/u', ' ', $content ) );
	}

	/**
	 * Fetch a page over HTTP and extract its visible text. Same-site only (the
	 * host must match home_url) so this can never be pointed at another server.
	 */
	private static function fetch_visible_text( $url ) {
		if ( ! $url ) {
			return '';
		}
		$home_host = strtolower( (string) wp_parse_url( home_url(), PHP_URL_HOST ) );
		$host      = strtolower( (string) wp_parse_url( $url, PHP_URL_HOST ) );
		if ( '' === $host || $host !== $home_host ) {
			return '';
		}
		$res = wp_remote_get( $url, array( 'timeout' => 15, 'redirection' => 2 ) );
		if ( is_wp_error( $res ) || 200 !== (int) wp_remote_retrieve_response_code( $res ) ) {
			return '';
		}
		$html = wp_remote_retrieve_body( $res );
		if ( '' === $html ) {
			return '';
		}
		// Drop non-content regions, then tags.
		$html = preg_replace( '#<(script|style|noscript|nav|header|footer|svg)\b[^>]*>.*?</\1>#is', ' ', $html );
		$text = wp_strip_all_tags( (string) $html, true );
		return trim( preg_replace( '/\s+/u', ' ', $text ) );
	}

	// =====================================================================
	// Prompts / parsing
	// =====================================================================

	private static function system_prompt() {
		return "You are a senior brand and content strategist analysing a company from its own website copy. "
			. "You are precise and never invent facts: if the copy doesn't support a field, use an empty string or empty array. "
			. "You reply with ONE JSON object and nothing else — no prose, no code fences.";
	}

	private static function user_prompt( $corpus ) {
		$schema = <<<JSON
{
  "company_name": "",
  "one_line": "concise value proposition in the company's own framing",
  "positioning": "2-3 sentences: what they do, for whom, and what makes them different",
  "category": "",
  "differentiators": ["",""],
  "products": [{"name":"","summary":""}],
  "icp": {"who":"", "industries":["",""], "pains":["",""]},
  "voice": {
    "summary": "how the brand sounds, in behavioural terms",
    "rules": ["active voice", "..."],
    "preferred_terms": ["",""],
    "banned_terms": ["hype/AI-tell words to avoid"],
    "reading_level": "e.g. 9th grade"
  },
  "themes": ["recurring content themes worth owning"],
  "author_hints": ["names/roles of real people mentioned who could be bylined"]
}
JSON;

		return "Analyse the following pages and posts from a company website and return the JSON profile.\n\n"
			. "Return EXACTLY this shape (fill it in; keep keys):\n" . $schema . "\n\n"
			. "=== WEBSITE CONTENT ===\n" . $corpus;
	}

}
