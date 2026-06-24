<?php
/**
 * Claude API layer — grounded helpers used across the plugin:
 *   - rewrite_section(): re-angle canonical boilerplate for a client (facts kept).
 *   - draft_case_study(): structure a case study from uploaded raw material.
 *   - suggest_pricing(): propose line items from the rate card + past proposals,
 *     clamped to per-service bands so it can never say "£10k for a website".
 *   - engagement_report(): monthly/annual summary + template suggestions.
 *
 * All calls are grounded and guard-railed; every output is editable by the
 * studio and nothing is ever auto-sent. Degrades to '' when no key is set.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCP_Claude {

	const ENDPOINT = 'https://api.anthropic.com/v1/messages';
	const VERSION  = '2023-06-01';

	/** Model tiers (latest Claude family). */
	const MODEL_DRAFT  = 'claude-sonnet-4-6';        // studio-side drafting.
	const MODEL_PUBLIC = 'claude-haiku-4-5-20251001'; // cheap public agent.

	public static function enabled() {
		return '' !== trim( (string) OCP_Settings::get( 'claude_key' ) );
	}

	/**
	 * Low-level call to the Messages API.
	 *
	 * @return string|WP_Error Assistant text, or error.
	 */
	public static function message( $system, $messages, $model = self::MODEL_DRAFT, $max_tokens = 1200 ) {
		$key = OCP_Settings::get( 'claude_key' );
		if ( ! $key ) {
			return new WP_Error( 'ocp_no_key', __( 'Claude API key not set.', 'oc-proposals' ) );
		}
		$res = wp_remote_post( self::ENDPOINT, array(
			'headers' => array(
				'x-api-key'         => $key,
				'anthropic-version' => self::VERSION,
				'content-type'      => 'application/json',
			),
			'body'    => wp_json_encode( array(
				'model'      => $model,
				'max_tokens' => (int) $max_tokens,
				'system'     => $system,
				'messages'   => $messages,
			) ),
			'timeout' => 45,
		) );
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		$json = json_decode( wp_remote_retrieve_body( $res ), true );
		if ( isset( $json['content'][0]['text'] ) ) {
			return (string) $json['content'][0]['text'];
		}
		$msg = $json['error']['message'] ?? __( 'Unexpected response from Claude.', 'oc-proposals' );
		return new WP_Error( 'ocp_claude_failed', $msg );
	}

	/** Re-angle a canonical block for a client without changing the facts. */
	public static function rewrite_section( $canonical, array $context ) {
		$system = 'You are October Communications’ proposal writer. Re-angle the given '
			. 'canonical text so it speaks directly to this client’s sector and situation. '
			. 'Keep every fact unchanged; only adjust emphasis, examples and tone. British '
			. 'English, warm and design-literate. Return prose only, no preamble.';
		$user = "Client sector: {$context['sector']}\nSituation: {$context['situation']}\n\nCanonical text:\n{$canonical}";
		$out  = self::message( $system, array( array( 'role' => 'user', 'content' => $user ) ) );
		return is_wp_error( $out ) ? '' : trim( $out );
	}

	/** Draft a structured case study from raw uploaded material. */
	public static function draft_case_study( $raw ) {
		$system = 'Turn the raw material into a concise case study in October’s voice. '
			. 'Return strict JSON with keys: title, client, sector, services, summary, '
			. 'body, stats (array of "value | label" strings). No commentary.';
		$out = self::message( $system, array( array( 'role' => 'user', 'content' => (string) $raw ) ), self::MODEL_DRAFT, 1500 );
		if ( is_wp_error( $out ) ) {
			return array();
		}
		$json = json_decode( self::strip_fence( $out ), true );
		return is_array( $json ) ? $json : array();
	}

	/**
	 * Suggest pricing line items, clamped to the studio's per-service bands so it
	 * can never hallucinate an out-of-range fee.
	 *
	 * @return array Items array (each: cadence,label,unit_amount).
	 */
	public static function suggest_pricing( array $brief, array $bands, $hourly_rate ) {
		$system = 'You are October’s pricing assistant. Propose proposal line items as '
			. 'strict JSON: {"items":[{"cadence":"oneoff|monthly|project","label":"…",'
			. '"unit_amount":number}]}. Respect the hourly rate and the min/max band per '
			. 'service type. Never exceed a band. Mirror how past October proposals are scoped.';
		$user = 'Hourly rate: ' . (float) $hourly_rate . "\nBands: " . wp_json_encode( $bands )
			. "\nBrief: " . wp_json_encode( $brief );
		$out = self::message( $system, array( array( 'role' => 'user', 'content' => $user ) ), self::MODEL_DRAFT, 900 );
		if ( is_wp_error( $out ) ) {
			return array();
		}
		$json  = json_decode( self::strip_fence( $out ), true );
		$items = is_array( $json ) && isset( $json['items'] ) ? $json['items'] : array();
		// Hard clamp to bands in code (never trust the model with the ceiling).
		foreach ( $items as &$it ) {
			$band = $bands[ $it['cadence'] ] ?? null;
			if ( $band ) {
				$it['unit_amount'] = max( (float) $band['min'], min( (float) $band['max'], (float) ( $it['unit_amount'] ?? 0 ) ) );
			}
		}
		return $items;
	}

	/** Monthly / annual engagement report with improvement suggestions. */
	public static function engagement_report( array $stats ) {
		$system = 'You are October’s proposal analyst. Given aggregate engagement stats '
			. 'across proposals, write a short report: what is working, where readers drop '
			. 'off, and concrete suggestions to improve the proposal template. Plain prose.';
		$out = self::message( $system, array( array( 'role' => 'user', 'content' => wp_json_encode( $stats ) ) ) );
		return is_wp_error( $out ) ? '' : trim( $out );
	}

	/**
	 * Discovery chat — the studio pastes a call transcript / client email and
	 * talks it through with Claude to shape the proposal. Returns the assistant's
	 * reply. `context` carries the client name/sector + the source material.
	 */
	public static function discovery_reply( $history, array $context ) {
		$system = 'You are October Communications’ proposal strategist, working WITH Daniel '
			. '(not the client). He pastes a call transcript or a client email; help him '
			. 'interrogate it and shape a proposal: surface the client’s real situation, their '
			. 'objectives, and a sensible strategy in October’s voice. Ask sharp clarifying '
			. 'questions when something is missing, suggest angles, and keep it concise. British '
			. 'English. This is an internal working chat — be direct and practical.'
			. "\n\nClient: " . ( $context['client_name'] ?? '' ) . ' · Sector: ' . ( $context['sector'] ?? '' );
		if ( ! empty( $context['material'] ) ) {
			$system .= "\n\nSource material (transcript / email) provided:\n" . $context['material'];
		}
		$out = self::message( $system, $history, self::MODEL_DRAFT, 1200 );
		return is_wp_error( $out ) ? $out : trim( $out );
	}

	/**
	 * Turn the source material + discussion into the proposal's two written
	 * sections. Returns ['situation' => string, 'objectives' => string].
	 */
	public static function extract_content( $material, $history, array $context ) {
		$system = 'From the source material and the working discussion, write two sections of '
			. 'an October proposal in finished prose (British English, warm and design-literate, '
			. 'no headings, no preamble). Return STRICT JSON: {"situation":"…","objectives":"…"}. '
			. '"situation" = a tight "where you are now" for the client. "objectives" = their '
			. 'objectives plus the strategy to get there. Use only what is supported by the '
			. 'material/discussion; do not invent specifics.'
			. "\n\nClient: " . ( $context['client_name'] ?? '' ) . ' · Sector: ' . ( $context['sector'] ?? '' )
			. "\n\nSource material:\n" . $material;
		$msgs = is_array( $history ) ? $history : array();
		$msgs[] = array( 'role' => 'user', 'content' => 'Write the situation and objectives sections now as JSON.' );
		$out  = self::message( $system, $msgs, self::MODEL_DRAFT, 1600 );
		if ( is_wp_error( $out ) ) {
			return array();
		}
		$json = json_decode( self::strip_fence( $out ), true );
		return is_array( $json ) ? $json : array();
	}

	/** Public builder agent — tightly scoped, cheap model, capped output. */
	public static function builder_reply( $history, $services_summary ) {		$system = 'You are October Communications’ proposal assistant on a public web page. '
			. 'ONLY discuss October’s marketing/PR/website services and help the visitor scope '
			. 'an indicative proposal. Politely refuse anything off-topic and never answer '
			. 'general-knowledge questions. Give indicative ranges, never a binding quote, and '
			. 'always note a short call confirms final pricing. Services: ' . $services_summary;
		return self::message( $system, $history, self::MODEL_PUBLIC, 600 );
	}

	private static function strip_fence( $text ) {
		$text = preg_replace( '/^```(json)?/m', '', (string) $text );
		return trim( str_replace( '```', '', $text ) );
	}
}
