<?php
/**
 * Archie — the assistant orchestration.
 *
 * Owns the system prompt, the field-extraction tool, and a single turn:
 * user message → Claude (text + set_fields) → merge state → server recomputes the
 * package → persist → return { message, package }. Archie never states a price;
 * the package panel does. Prices are computed by YAA_Pricing, never by the model.
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_Archie {

	/** The fixed opener (no Claude call — saves a turn's tokens). */
	public static function opener( $project_id ) {
		$text = __( "Hi — I'm Archie, Your Architect's project assistant. I'll ask a few short questions and build your fixed price as we go. First, what's the address of the property?", 'your-architect-archie' );
		YAA_Project::add_message( $project_id, 'assistant', $text );
		return array(
			'message'  => $text,
			'package'  => YAA_Project::package( $project_id ),
			'redirect' => false,
			'done'     => false,
		);
	}

	/** System prompt (scoped tightly to package-building; Brief §6). */
	private static function system_prompt() {
		return implode(
			"\n",
			array(
				'You are Archie, the project assistant for Your Architect — fixed-price architectural drawings for UK homeowners (a trading name of Tiam Architects Ltd, ARB-registered and RIBA chartered).',
				'Your job: ask short, plain-English questions, one at a time, and collect the information to build the client\'s drawing package. Follow this order: property address; what they want to do; whether they have planning permission yet; rough size; existing survey/drawings; structural changes; shared wall with a neighbour; whether they\'d like a concept design; timeframe; and finally their name and email (optional).',
				'HARD RULES:',
				'- NEVER state, estimate or discuss a price, fee or number in your replies. The package panel shows all prices. If asked about cost, say the price is building on the right as you answer.',
				'- Do NOT give planning or design advice, and do not recommend design approaches.',
				'- Use British English and everyday client language ("building control drawings" not "tender"; "shared wall with a neighbour" not "party wall").',
				'- Keep every reply to one or two short sentences, warm and direct.',
				'- If asked something outside scope, say "That\'s worth discussing with the team — I can arrange a call" and continue.',
				'EVERY turn, call the set_fields tool with any fields you learned this message (omit the rest). Map planning status to service: still applying = "planning"; already has permission = "buildingcontrol"; permitted development = "permitted". Convert size to a band (A up to 50m², B 50–100m², C 100–150m², over = more than 150m²). Set done=true only after you have asked for name and email.',
			)
		);
	}

	/** The single field-extraction tool. */
	private static function tools() {
		return array(
			array(
				'name'         => 'set_fields',
				'description'  => 'Record the structured fields learned from the user this turn. Only include fields you are confident about.',
				'input_schema' => array(
					'type'       => 'object',
					'properties' => array(
						'address'    => array( 'type' => 'string' ),
						'service'    => array( 'type' => 'string', 'enum' => array( 'planning', 'buildingcontrol', 'permitted' ) ),
						'band'       => array( 'type' => 'string', 'enum' => array( 'A', 'B', 'C', 'over' ) ),
						'survey'     => array( 'type' => 'boolean', 'description' => 'true if a measured survey needs arranging (they do NOT already have drawings)' ),
						'structural' => array( 'type' => 'boolean' ),
						'partyWall'  => array( 'type' => 'boolean' ),
						'concept'    => array( 'type' => 'boolean' ),
						'listed'     => array( 'type' => 'boolean' ),
						'ongoing'    => array( 'type' => 'boolean', 'description' => 'true if they want ongoing project management / construction-stage services' ),
						'timeframe'  => array( 'type' => 'string' ),
						'name'       => array( 'type' => 'string' ),
						'email'      => array( 'type' => 'string' ),
						'done'       => array( 'type' => 'boolean' ),
					),
				),
			),
		);
	}

	/** Fields the tool may write into state. */
	private static $allowed = array( 'address', 'service', 'band', 'survey', 'structural', 'partyWall', 'concept', 'listed', 'ongoing', 'timeframe', 'name', 'email', 'done' );

	/**
	 * Run one conversational turn.
	 *
	 * @return array|WP_Error { message, package, redirect, done }.
	 */
	public static function turn( $project_id, $user_text ) {
		$user_text = trim( (string) $user_text );
		if ( '' === $user_text ) {
			return new WP_Error( 'yaa_empty', __( 'Say something to Archie.', 'your-architect-archie' ) );
		}

		YAA_Project::add_message( $project_id, 'user', $user_text );
		$messages = YAA_Project::messages( $project_id );
		$state    = YAA_Project::state( $project_id );

		$result = YAA_Claude::turn( self::system_prompt(), $messages, self::tools() );
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		// Merge extracted fields.
		$done = false;
		if ( ! empty( $result['tool']['input'] ) ) {
			foreach ( $result['tool']['input'] as $k => $v ) {
				if ( ! in_array( $k, self::$allowed, true ) ) {
					continue;
				}
				if ( 'done' === $k ) {
					$done = (bool) $v;
					continue;
				}
				if ( 'address' === $k ) {
					$state['postcode'] = sanitize_text_field( (string) $v );
					$he = YAA_Historic_England::check( (string) $v );
					$state['london'] = $he['london'];
					if ( $he['listed'] ) {
						$state['listed'] = true; // server-authoritative; don't unset a confirmed listing.
					}
					continue;
				}
				if ( in_array( $k, array( 'name', 'email' ), true ) ) {
					$state[ $k ] = sanitize_text_field( (string) $v );
					continue;
				}
				$state[ $k ] = is_bool( $v ) ? $v : sanitize_text_field( (string) $v );
			}
		}
		if ( empty( $state['band'] ) ) {
			$state['band'] = 'B';
		}

		if ( ! empty( $state['name'] ) || ! empty( $state['email'] ) ) {
			YAA_Project::set_contact( $project_id, isset( $state['name'] ) ? $state['name'] : '', isset( $state['email'] ) ? $state['email'] : '' );
		}

		$package = YAA_Pricing::build_package( $state );

		$message = '' !== $result['text'] ? $result['text'] : __( 'Got it — thanks.', 'your-architect-archie' );
		YAA_Project::set_state( $project_id, $state );
		YAA_Project::add_message( $project_id, 'assistant', $message );
		YAA_Project::set_package( $project_id, $package );
		if ( $done ) {
			YAA_Project::set_status( $project_id, 'quoted' );
		}

		return array(
			'message'  => $message,
			'package'  => $package,
			'redirect' => ! empty( $package['redirect'] ),
			'done'     => $done,
		);
	}
}
