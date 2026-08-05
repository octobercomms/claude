<?php
/**
 * Topic planner — the pillar/cluster content plan.
 *
 * Instead of choosing a topic ad hoc each time, the engine builds a plan of
 * specific, clustered titles grounded in the company's own knowledge, then works
 * through it one post per cycle and never repeats. This is what gives the blog
 * topical authority rather than a scatter of one-off posts.
 *
 * Standalone, topics come from the company knowledge (no invented search
 * volumes). When connected, the platform can enrich the plan with real
 * keyword/SERP data (see the OMI brief) — this class stays the store either way.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OctoberMI_Blog_Planner {

	const OPTION   = 'octobermi_blog_plan';
	const JOB_TYPE = 'blog_plan';

	/** @return array plan items: { title, angle, cluster, status, created }. */
	public static function all() {
		$plan = get_option( self::OPTION, array() );
		return is_array( $plan ) ? $plan : array();
	}

	public static function queued() {
		return array_values( array_filter( self::all(), function ( $i ) {
			return empty( $i['status'] ) || 'queued' === $i['status'];
		} ) );
	}

	public static function start() {
		return OctoberMI_Jobs::enqueue( self::JOB_TYPE, array() );
	}

	/** The next unused topic as a writer-ready string, or '' if the plan is dry. */
	public static function claim_next() {
		$queued = self::queued();
		if ( empty( $queued ) ) {
			return '';
		}
		$item = $queued[0];
		$topic = $item['title'];
		if ( ! empty( $item['angle'] ) ) {
			$topic .= ' — ' . $item['angle'];
		}
		return $topic;
	}

	/** Mark the first queued item whose title matches as used. */
	public static function mark_used( $title ) {
		$plan  = self::all();
		$title = trim( (string) $title );
		foreach ( $plan as $i => $item ) {
			if ( ( empty( $item['status'] ) || 'queued' === $item['status'] )
				&& 0 === strcasecmp( trim( $item['title'] ), $title ) ) {
				$plan[ $i ]['status'] = 'used';
				update_option( self::OPTION, $plan, false );
				return;
			}
		}
		// If we can't match by exact title, retire the oldest queued item so the
		// plan still advances.
		foreach ( $plan as $i => $item ) {
			if ( empty( $item['status'] ) || 'queued' === $item['status'] ) {
				$plan[ $i ]['status'] = 'used';
				update_option( self::OPTION, $plan, false );
				return;
			}
		}
	}

	// =====================================================================
	// Job handler
	// =====================================================================

	public static function run_job( $job, $job_id ) {
		OctoberMI_Jobs::progress( $job_id, 20, __( 'Planning topic clusters…', 'october-mi' ) );

		$pack = OctoberMI_Blog_Context_Pack::get();
		$brief = OctoberMI_Blog_Module::brief();

		$response = OctoberMI_Claude::complete( array(
			'model'      => OctoberMI_Claude::MODEL_DRAFT,
			'max_tokens' => 2000,
			'system'     => 'You are a content strategist building a topical-authority plan (pillars and clusters). '
				. 'Propose specific, non-generic blog topics grounded ONLY in the company knowledge and audience given. '
				. 'Do NOT invent search-volume numbers. Reply with ONE JSON object and nothing else.',
			'messages'   => array(
				array( 'role' => 'user', 'content' => self::prompt( $pack, $brief ) ),
			),
		) );

		if ( is_wp_error( $response ) ) {
			throw new Exception( $response->get_error_message() );
		}
		$parsed = self::parse_json( $response );
		if ( ! $parsed || empty( $parsed['topics'] ) || ! is_array( $parsed['topics'] ) ) {
			throw new Exception( __( 'The model did not return a usable topic plan.', 'october-mi' ) );
		}

		// Merge new topics into the existing plan, de-duplicating by title.
		$existing = self::all();
		$seen     = array();
		foreach ( $existing as $i ) {
			$seen[ strtolower( trim( $i['title'] ) ) ] = true;
		}
		$now = time();
		foreach ( $parsed['topics'] as $t ) {
			if ( empty( $t['title'] ) ) {
				continue;
			}
			$key = strtolower( trim( $t['title'] ) );
			if ( isset( $seen[ $key ] ) ) {
				continue;
			}
			$seen[ $key ] = true;
			$existing[]   = array(
				'title'   => sanitize_text_field( (string) $t['title'] ),
				'angle'   => isset( $t['angle'] ) ? sanitize_text_field( (string) $t['angle'] ) : '',
				'cluster' => isset( $t['cluster'] ) ? sanitize_text_field( (string) $t['cluster'] ) : '',
				'status'  => 'queued',
				'created' => $now,
			);
		}
		update_option( self::OPTION, $existing, false );

		return array( 'total' => count( $existing ), 'queued' => count( self::queued() ) );
	}

	private static function prompt( $pack, $brief ) {
		$knowledge = is_array( $pack ) ? wp_json_encode( array(
			'one_line'        => isset( $pack['one_line'] ) ? $pack['one_line'] : '',
			'positioning'     => isset( $pack['positioning'] ) ? $pack['positioning'] : '',
			'products'        => isset( $pack['products'] ) ? $pack['products'] : array(),
			'icp'             => isset( $pack['icp'] ) ? $pack['icp'] : array(),
			'themes'          => isset( $pack['themes'] ) ? $pack['themes'] : array(),
			'differentiators' => isset( $pack['differentiators'] ) ? $pack['differentiators'] : array(),
		) ) : '(site not learned yet)';

		$schema = '{ "topics": [ { "title": "specific post title", "angle": "the unique angle/intent", "cluster": "which pillar it belongs to" } ] }';

		return "Build a plan of ~12 blog topics organised into 3-4 clusters for this company.\n\n"
			. "Return EXACTLY: " . $schema . "\n\n"
			. "Rules: each topic must be specific to this business and audience; cover a mix of search intents; "
			. "no generic filler; no invented statistics or volumes.\n\n"
			. "=== COMPANY KNOWLEDGE ===\n" . $knowledge . "\n\n"
			. "=== BRIEF ===\nTopics/focus: " . ( $brief['topics'] ? $brief['topics'] : '(infer)' )
			. "\nAudience: " . ( $brief['audience'] ? $brief['audience'] : '(infer)' );
	}

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
