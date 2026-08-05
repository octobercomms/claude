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

	/** Wipe the whole plan (e.g. to re-plan after re-learning the site). */
	public static function clear() {
		delete_option( self::OPTION );
	}

	/**
	 * Reserve the next unused topic and return it as a writer-ready string, or ''
	 * if the plan is dry. Marking used at claim time (rather than after the post
	 * is written) prevents two overlapping generate runs from picking the same
	 * topic and producing duplicate articles.
	 */
	public static function claim_next() {
		$plan = self::all();
		foreach ( $plan as $i => $item ) {
			if ( empty( $item['status'] ) || 'queued' === $item['status'] ) {
				$plan[ $i ]['status'] = 'used';
				update_option( self::OPTION, $plan, false );

				$topic = $item['title'];
				if ( ! empty( $item['angle'] ) ) {
					$topic .= ' — ' . $item['angle'];
				}
				return $topic;
			}
		}
		return '';
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
		$parsed = OctoberMI_Claude::json_from_reply( $response );
		$topics = self::topics_from( $parsed );
		if ( empty( $topics ) ) {
			OctoberMI_Log::error( 'blog.plan', 'Unparseable topic-plan reply', array( 'reply' => self::snippet( $response, 500 ) ) );
			throw new Exception( sprintf(
				/* translators: %s: a short excerpt of the model's reply. */
				__( 'The model did not return a usable topic plan. It replied: “%s”', 'october-mi' ),
				self::snippet( $response, 180 )
			) );
		}

		// Merge new topics into the existing plan, de-duplicating by title.
		$existing = self::all();
		$seen     = array();
		foreach ( $existing as $i ) {
			$seen[ strtolower( trim( $i['title'] ) ) ] = true;
		}
		$now = time();
		foreach ( $topics as $t ) {
			if ( is_string( $t ) ) {
				$t = array( 'title' => $t );
			}
			if ( ! is_array( $t ) ) {
				continue;
			}
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

		return 'Build a plan of ~12 blog topics organised into 3-4 clusters for the company that operates ' . home_url( '/' ) . ".\n\n"
			. 'Return EXACTLY: ' . $schema . "\n\n"
			. "Rules: base every topic STRICTLY on the company knowledge below — match this company's actual industry, products and audience. "
			. "Do NOT drift to a generic industry (e.g. SaaS, marketing agencies, project-management tools) unless the knowledge clearly supports it. "
			. "Cover a mix of search intents; no generic filler; no invented statistics or volumes.\n\n"
			. "=== COMPANY KNOWLEDGE ===\n" . $knowledge . "\n\n"
			. "=== BRIEF ===\nTopics/focus: " . ( $brief['topics'] ? $brief['topics'] : '(infer from the knowledge)' )
			. "\nAudience: " . ( $brief['audience'] ? $brief['audience'] : '(infer from the knowledge)' );
	}

	/** Normalise the parsed reply into a plain list of topic items. */
	private static function topics_from( $parsed ) {
		if ( ! is_array( $parsed ) ) {
			return array();
		}
		foreach ( array( 'topics', 'plan', 'items', 'posts' ) as $k ) {
			if ( ! empty( $parsed[ $k ] ) && is_array( $parsed[ $k ] ) ) {
				return $parsed[ $k ];
			}
		}
		// A bare list (numeric keys) is itself the topics array.
		if ( array_keys( $parsed ) === range( 0, count( $parsed ) - 1 ) ) {
			return $parsed;
		}
		return array();
	}

	/** A short, whitespace-collapsed excerpt of a model reply for diagnostics. */
	private static function snippet( $text, $len = 180 ) {
		$t = trim( preg_replace( '/\s+/u', ' ', (string) $text ) );
		if ( '' === $t ) {
			return '(empty reply)';
		}
		return function_exists( 'mb_substr' ) ? mb_substr( $t, 0, $len ) : substr( $t, 0, $len );
	}
}
