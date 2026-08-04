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

	/** System prompt (scoped tightly to package-building; Tiam's question logic). */
	private static function system_prompt() {
		return implode(
			"\n",
			array(
				'You are Archie, the project assistant for Your Architect — fixed-price architectural drawings for UK homeowners (a trading name of Tiam Architects Ltd, ARB-registered and RIBA chartered).',
				'Your job: ask short, plain-English questions, ONE at a time, and collect what is needed to build the client\'s package. Ask in this order, and SKIP any question that does not apply:',
				'1) the property address; 2) what they want to do (rear/side extension, loft or mansard conversion, garage conversion, outbuilding, internal alterations, or a new dwelling); 3) IF it is a rear or side extension, how many storeys; 4) where they are up to with planning; 5) IF they still need planning permission, whether they would like you to submit and manage the application or they will submit it themselves; 6) IF planning is already approved (building regs), whether they would like an optional 3D concept visual; 7) IF the property is in London or within the M25, whether they would like a site visit; 8) whether they already have a measured survey or need one arranged; 9) whether there are structural changes; 10) their rough timeframe; 11) finally their name and email (optional).',
				'HARD RULES:',
				'- NEVER state, estimate or discuss a price, fee or number in your replies. The package panel shows all prices. If asked about cost, say the price is building on the right as you answer.',
				'- Do NOT give planning or design advice.',
				'- Use British English and everyday client language.',
				'- Keep every reply to one or two short sentences, warm and direct.',
				'- A measured survey and a structural engineer are NEVER part of our fee — if one is needed we source an independent local professional and share their quote for the client\'s approval first; they pay only for that work, not our time. Say this plainly; never quote a number.',
				'- Full RIBA services (Stages 0–7, concept to construction) or a larger commission are handled directly by Tiam Architects: set package to "riba" and point them to info@tiamarchitects.com at the end.',
				'EVERY turn, call the set_fields tool with any fields you learned this message (omit the rest). MAPPING: still need planning permission = package "planning"; planning already approved / needs building regs = package "buildingregs"; full RIBA or larger commission = package "riba". Set submitApp=true only if they want you to submit/manage the planning application. Set concept=true only for a 3D concept add-on on a building-regs project (the planning package already includes a 3D concept). Set siteVisit=true only if they want the London/M25 site visit. Set survey=true if a measured survey needs arranging. Set done=true only after you have asked for name and email.',
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
						'address'     => array( 'type' => 'string' ),
						'package'     => array( 'type' => 'string', 'enum' => array( 'planning', 'buildingregs', 'riba' ) ),
						'projectType' => array( 'type' => 'string', 'enum' => array( 'extension', 'loft', 'garage', 'outbuilding', 'internal', 'newdwelling' ) ),
						'storeys'     => array( 'type' => 'string', 'description' => 'for a rear/side extension: single, two, or unsure' ),
						'submitApp'   => array( 'type' => 'boolean', 'description' => 'true if they want us to submit & manage the planning application' ),
						'concept'     => array( 'type' => 'boolean', 'description' => 'true for an optional 3D concept visual add-on on a building-regs project' ),
						'siteVisit'   => array( 'type' => 'boolean', 'description' => 'true if they want a London / within-M25 site visit' ),
						'survey'      => array( 'type' => 'boolean', 'description' => 'true if a measured survey needs arranging (they do NOT already have drawings)' ),
						'structural'  => array( 'type' => 'boolean' ),
						'timeframe'   => array( 'type' => 'string' ),
						'name'        => array( 'type' => 'string' ),
						'email'       => array( 'type' => 'string' ),
						'done'        => array( 'type' => 'boolean' ),
					),
				),
			),
		);
	}

	/** Fields the tool may write into state. */
	private static $allowed = array( 'address', 'package', 'projectType', 'storeys', 'submitApp', 'concept', 'siteVisit', 'survey', 'structural', 'timeframe', 'name', 'email', 'done' );

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
					$state['london'] = $he['london']; // gates the site-visit question.
					continue;
				}
				if ( in_array( $k, array( 'name', 'email' ), true ) ) {
					$state[ $k ] = sanitize_text_field( (string) $v );
					continue;
				}
				$state[ $k ] = is_bool( $v ) ? $v : sanitize_text_field( (string) $v );
			}
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
