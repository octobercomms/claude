<?php
/**
 * Writer — turns the brief + the learned Context Pack into a structured, on-brand,
 * search- and AI-answer-optimised article.
 *
 * The whole premise of the product lives here: we don't ask the model to "write an
 * article", we give it the company's real knowledge and a tight editorial spec, and
 * make it draft inside those constraints. Output is strict JSON so the publisher can
 * place every field precisely.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OctoberMI_Blog_Writer {

	/**
	 * Generate one article.
	 *
	 * @param array $args { @type string $topic Optional explicit topic/angle. }
	 * @return array|WP_Error Decoded article fields.
	 */
	public static function generate( array $args = array() ) {
		$brief = OctoberMI_Blog_Module::brief();
		$pack  = OctoberMI_Blog_Context_Pack::get();
		$topic = isset( $args['topic'] ) ? trim( (string) $args['topic'] ) : '';

		$word_target = max( 300, (int) $brief['word_target'] );
		$max_tokens  = min( 8000, max( 3000, $word_target * 3 ) );

		$response = OctoberMI_Claude::complete( array(
			'model'      => OctoberMI_Claude::MODEL_DRAFT,
			'max_tokens' => $max_tokens,
			'temperature'=> 0.6,
			'system'     => self::system_prompt(),
			'messages'   => array(
				array( 'role' => 'user', 'content' => self::user_prompt( $brief, $pack, $topic ) ),
			),
		) );

		if ( is_wp_error( $response ) ) {
			return $response;
		}
		$data = self::parse_json( $response );
		if ( null === $data || empty( $data['title'] ) || empty( $data['body_html'] ) ) {
			return new WP_Error( 'octobermi_writer_parse', __( 'The model did not return a usable article.', 'october-mi' ) );
		}
		return $data;
	}

	// =====================================================================
	// Prompt
	// =====================================================================

	private static function system_prompt() {
		return implode( ' ', array(
			'You are a senior editor writing for a premium brand. You produce genuinely useful, specific, non-generic content that a knowledgeable human would be proud to publish.',
			'Rules:',
			'(1) Be concrete — use real examples, specifics from the company knowledge provided, and a clear point of view. Never pad or write filler.',
			'(2) Structure for both Google and AI answer engines: use question-style H2 headings, and put a direct 40–60 word answer immediately under each heading before you elaborate. Use lists and tables where they genuinely help.',
			'(3) Demonstrate expertise (E-E-A-T) in the brand\'s own voice.',
			'(4) NEVER invent statistics, studies, quotes, or sources. If you cannot support a number, do not state it. Do not fabricate citations.',
			'(5) Avoid hype / AI-tell phrasing (e.g. "in today\'s fast-paced world", "unlock", "elevate", "seamless", "game-changer", "industry-leading").',
			'(6) Weave in 2–4 of the provided internal links using natural anchor text; do not invent URLs.',
			'(7) Write in clean HTML using only these tags: h2, h3, p, ul, ol, li, strong, em, a, blockquote, table, thead, tbody, tr, th, td. No h1, no inline styles, no scripts.',
			'Output ONE JSON object and nothing else — no prose, no code fences.',
		) );
	}

	private static function user_prompt( array $brief, $pack, $topic ) {
		$knowledge = self::knowledge_block( $pack );
		$links     = self::links_block( $pack );
		$recent    = self::recent_titles_block();

		$author = '';
		if ( ! empty( $brief['author_id'] ) ) {
			$u = get_userdata( (int) $brief['author_id'] );
			if ( $u ) {
				$author = $u->display_name;
			}
		}

		$schema = <<<JSON
{
  "title": "specific, compelling, not clickbait",
  "slug": "kebab-case-url-slug",
  "meta_description": "150-160 characters, benefit-led",
  "excerpt": "one or two sentence standfirst",
  "body_html": "the full article as clean HTML (allowed tags only)",
  "tags": ["3-6 relevant tags"],
  "faq": [{"q":"real question a reader/searcher would ask","a":"concise 40-60 word answer"}],
  "hero_image_prompt": "art-directed prompt for a bespoke hero image (no text in image)",
  "internal_links_used": ["the exact URLs you linked to"]
}
JSON;

		$parts = array();
		$parts[] = 'Write ONE article for this company. Return EXACTLY the JSON shape below (keep keys):';
		$parts[] = $schema;
		$parts[] = "=== COMPANY KNOWLEDGE ===\n" . $knowledge;
		$parts[] = "=== BRIEF ===\n"
			. 'Topics/focus: ' . ( $brief['topics'] ? $brief['topics'] : '(infer from company knowledge)' ) . "\n"
			. 'Audience: ' . ( $brief['audience'] ? $brief['audience'] : '(infer)' ) . "\n"
			. 'Tone of voice: ' . ( $brief['tone'] ? $brief['tone'] : '(match the brand voice above)' ) . "\n"
			. 'Target length: ~' . (int) $brief['word_target'] . " words\n"
			. ( $author ? 'Bylined author: ' . $author . " (write in a way a named expert can stand behind)\n" : '' );
		$parts[] = "=== AVAILABLE INTERNAL LINKS (use 2-4, natural anchors) ===\n" . $links;
		$parts[] = "=== ALREADY PUBLISHED (choose a DIFFERENT, specific angle) ===\n" . $recent;
		if ( '' !== $topic ) {
			$parts[] = '=== REQUIRED TOPIC/ANGLE ===' . "\n" . $topic;
		} else {
			$parts[] = 'Choose the single strongest, most specific topic for this audience that has not already been covered above.';
		}

		return implode( "\n\n", $parts );
	}

	private static function knowledge_block( $pack ) {
		if ( ! is_array( $pack ) ) {
			return '(The site has not been learned yet — infer carefully from the brief and do not invent specifics.)';
		}
		$out = array();
		foreach ( array( 'company_name', 'one_line', 'positioning', 'category' ) as $k ) {
			if ( ! empty( $pack[ $k ] ) ) {
				$out[] = ucfirst( str_replace( '_', ' ', $k ) ) . ': ' . ( is_array( $pack[ $k ] ) ? wp_json_encode( $pack[ $k ] ) : $pack[ $k ] );
			}
		}
		if ( ! empty( $pack['products'] ) ) {
			$names = array_filter( wp_list_pluck( (array) $pack['products'], 'name' ) );
			if ( $names ) {
				$out[] = 'Products/services: ' . implode( ', ', $names );
			}
		}
		if ( ! empty( $pack['icp'] ) && is_array( $pack['icp'] ) ) {
			$out[] = 'Ideal customer: ' . wp_json_encode( $pack['icp'] );
		}
		if ( ! empty( $pack['voice'] ) && is_array( $pack['voice'] ) ) {
			$out[] = 'Brand voice: ' . wp_json_encode( $pack['voice'] );
		}
		if ( ! empty( $pack['differentiators'] ) ) {
			$out[] = 'Differentiators: ' . implode( '; ', (array) $pack['differentiators'] );
		}
		return implode( "\n", $out );
	}

	private static function links_block( $pack ) {
		$links = ( is_array( $pack ) && ! empty( $pack['internal_links'] ) ) ? (array) $pack['internal_links'] : array();
		if ( empty( $links ) ) {
			return '(none available)';
		}
		$rows = array();
		foreach ( array_slice( $links, 0, 25 ) as $l ) {
			if ( empty( $l['url'] ) ) {
				continue;
			}
			$rows[] = '- ' . ( isset( $l['title'] ) ? $l['title'] : '' ) . ' — ' . $l['url'];
		}
		return implode( "\n", $rows );
	}

	private static function recent_titles_block() {
		$posts = get_posts( array(
			'post_type'        => 'post',
			'post_status'      => array( 'publish', 'draft', 'future', 'pending' ),
			'numberposts'      => 20,
			'orderby'          => 'date',
			'order'            => 'DESC',
			'suppress_filters' => false,
			'fields'           => 'ids',
		) );
		if ( empty( $posts ) ) {
			return '(none)';
		}
		$titles = array();
		foreach ( $posts as $id ) {
			$titles[] = '- ' . get_the_title( $id );
		}
		return implode( "\n", $titles );
	}

	/** Pull the first JSON object out of a model reply and decode it. */
	private static function parse_json( $text ) {
		$text  = (string) $text;
		$start = strpos( $text, '{' );
		$end   = strrpos( $text, '}' );
		if ( false === $start || false === $end || $end <= $start ) {
			return null;
		}
		$data = json_decode( substr( $text, $start, $end - $start + 1 ), true );
		return is_array( $data ) ? $data : null;
	}
}
