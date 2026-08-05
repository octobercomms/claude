<?php
/**
 * Archie — the assistant orchestration.
 *
 * Owns the system prompt, the field-extraction tool, and a single turn:
 * user message → Claude (text + set_fields) → merge state → server recomputes the
 * package → persist → return { message, package, options }. Archie never states a
 * price; the package panel does. Prices are computed by YAA_Pricing, never by the
 * model.
 *
 * Two things beyond plain form-filling:
 *  - Every turn Archie may propose `replies` — short tappable answer buttons — so
 *    the person can tap OR type. The UI renders them and always keeps the text box.
 *  - The system prompt is rebuilt each turn with WHAT WE KNOW about the address
 *    (London/M25, listed building, conservation area) from YAA_Historic_England,
 *    so Archie can ask genuinely intelligent, plain-English follow-ups.
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_Archie {

	/** The fixed opener (no Claude call — saves a turn's tokens). Free-text, no chips. */
	public static function opener( $project_id ) {
		$text = __( "Hi — I'm Archie, Your Architect's project assistant. I'll ask a few simple questions, explain anything that's unclear, and build your fixed price as we go. There are no silly questions here. To start, what's the address of the property?", 'your-architect-archie' );
		YAA_Project::add_message( $project_id, 'assistant', $text );
		return array(
			'message'  => $text,
			'package'  => YAA_Project::package( $project_id ),
			'options'  => array(), // address is free text — nothing to tap.
			'redirect' => false,
			'done'     => false,
		);
	}

	/**
	 * System prompt — scoped tightly to package-building, written to be answerable
	 * by someone who knows nothing about architecture or planning. Rebuilt each turn
	 * with what we've learned about the address so Archie can be clever, not scripted.
	 */
	private static function system_prompt( array $state = array() ) {
		$lines = array(
			'You are Archie, the project assistant for Your Architect — fixed-price architectural drawings for UK homeowners (a trading name of Tiam Architects Ltd, ARB-registered and RIBA chartered).',
			'',
			'WHO YOU ARE TALKING TO: ordinary homeowners who usually have NO idea how planning, drawings or architecture work, and may feel out of their depth. Your job is to make this feel easy and friendly — you are a helpful guide, not a form. Never make anyone feel they should already know something.',
			'',
			'HOW TO ASK EVERYTHING:',
			'- One short question at a time, in plain everyday English. Never use jargon without immediately explaining it in a few words (e.g. "planning permission — that\'s the council\'s formal go-ahead to build").',
			'- Keep every reply to one or two warm, direct sentences. British English.',
			'- After ANY question that has a handful of natural answers, ALSO propose tappable buttons via the set_fields tool\'s `replies` field (2–5 very short labels, in the person\'s own words). The person can tap one OR type their own — both are fine.',
			'- Whenever a question contains a term a non-expert might not know, ALWAYS include a final reply option worded like "What does that mean?" or "I\'m not sure". If they pick it (or seem confused, or ask), explain the term simply in one or two sentences with a relatable example, reassure them it\'s a normal thing not to know, then ask the same question again with the buttons.',
			'- If someone answers "I don\'t know" to anything, that is completely fine: help them reason it out or offer a sensible default, never pressure them.',
			'',
			'THE INFORMATION TO COLLECT (ask in this order, and SKIP anything that clearly does not apply):',
			'1) the property address (already asked in the opener);',
			'2) what they want to do — e.g. a rear or side extension, a loft or mansard conversion, converting a garage, a garden room / outbuilding, internal alterations, or building a brand-new home;',
			'3) IF it is a rear or side extension: is it single storey or two storey (offer "Not sure" — single is the common one);',
			'4) where they are up to with planning — explain the choice plainly: they still need planning permission, OR planning is already approved and they now need "building regulations" drawings (the technical drawings a builder builds from), OR it is a large / full-service project;',
			'5) IF they still need planning permission: would they like us to submit and manage the council application for them, or will they do that part themselves;',
			'6) IF planning is already approved: would they like an optional simple 3D visual to help picture the design;',
			'7) IF the property is in London or within the M25: would they like us to visit the property in person;',
			'8) do they already have a "measured survey" — explain it\'s an accurate set of drawings of the property as it exists today, which we need before designing — or should we arrange one;',
			'9) will the work involve structural changes (removing walls, adding steel beams) — reassure "No / not sure" is fine;',
			'10) their rough timeframe;',
			'11) finally their name and email (optional — just so they can save and come back).',
			'',
			'HARD RULES:',
			'- NEVER state, estimate or discuss a price, fee or number in your replies. The panel on the right shows every price as it builds. If asked "how much?", say the price is building on the right as they answer.',
			'- Do NOT give planning or design advice or promise an outcome; you help scope the drawings package only.',
			'- A measured survey and a structural engineer are NEVER part of our fee — if one is needed we source an independent local professional and share their quote for the client\'s approval first; they pay only for that work, not our time. Say this plainly; never quote a number.',
			'- Full RIBA services (concept to construction) or a larger commission are handled directly by Tiam Architects: set package to "riba" and point them to info@tiamarchitects.com at the end.',
			'',
			'TOOL USE — EVERY turn call set_fields with: (a) any structured fields you learned this message (omit the rest), and (b) `replies` for the question you just asked (omit `replies` only for open answers like the address, a free description, name or email). MAPPING: still need planning permission = package "planning"; planning already approved / needs building regs = package "buildingregs"; full RIBA or larger commission = package "riba". submitApp=true only if they want us to submit/manage the planning application. concept=true only for the 3D visual add-on on a building-regs project (the planning package already includes a 3D concept). siteVisit=true only if they want the London/M25 visit. survey=true if a measured survey needs arranging. done=true only after you have asked for name and email.',
		);

		$known = self::address_knowledge( $state );
		if ( $known ) {
			$lines[] = '';
			$lines[] = $known;
		}

		return implode( "\n", $lines );
	}

	/**
	 * Turn what YAA_Historic_England found about the address into guidance Archie
	 * can act on — so listed / conservation-area homes get intelligent, reassuring
	 * follow-ups instead of the generic script. Only emitted once we have an address.
	 */
	private static function address_knowledge( array $state ) {
		if ( empty( $state['postcode'] ) ) {
			return '';
		}
		$facts = array();
		$facts[] = ! empty( $state['london'] )
			? '- Location: this address is in London / within the M25, so an in-person site visit can be offered.'
			: '- Location: this address is outside London / the M25, so do not offer the London site visit.';

		if ( ! empty( $state['listed'] ) ) {
			$facts[] = '- This appears to be a LISTED BUILDING. Gently let them know (many owners do not realise): it means the building is legally protected for its special architectural or historic interest, so most changes need "listed building consent" as well as planning permission, and work has to be more sympathetic. Reassure them this is completely normal and we handle listed buildings routinely. Then ask what they are hoping to do. Never imply it is impossible, and never quote a number.';
		}
		if ( ! empty( $state['conservation'] ) ) {
			$facts[] = '- This appears to be in a CONSERVATION AREA. Explain simply: that is an area protected for its overall character, so the council applies stricter rules and some normal "permitted development" rights are removed (meaning more things need permission). Reassure them we deal with conservation areas all the time and it just shapes the design and paperwork. Never quote a number.';
		}

		return "WHAT WE KNOW ABOUT THIS PROPERTY (from an address lookup — use it to be genuinely helpful and to ask smarter questions; introduce it warmly, never to alarm):\n" . implode( "\n", $facts );
	}

	/** The single field-extraction tool (now also carries the tappable `replies`). */
	private static function tools() {
		return array(
			array(
				'name'         => 'set_fields',
				'description'  => 'Record the structured fields learned from the user this turn, and propose tappable quick-reply buttons for the question you just asked. Only include fields you are confident about.',
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
						'replies'     => array(
							'type'        => 'array',
							'items'       => array( 'type' => 'string' ),
							'description' => '2–5 very short (max ~5 words) tappable answer buttons for the question you just asked, in the user\'s own words. Include a final "What does that mean?" / "I\'m not sure" option whenever the question uses a term a non-expert might not know. OMIT entirely for open answers such as the address, a free description, name or email.',
						),
					),
				),
			),
		);
	}

	/** Fields the tool may write into state (`replies` is deliberately excluded — it drives the UI, not the record). */
	private static $allowed = array( 'address', 'package', 'projectType', 'storeys', 'submitApp', 'concept', 'siteVisit', 'survey', 'structural', 'timeframe', 'name', 'email', 'done' );

	/**
	 * Run one conversational turn.
	 *
	 * @return array|WP_Error { message, package, options, redirect, done }.
	 */
	public static function turn( $project_id, $user_text ) {
		$user_text = trim( (string) $user_text );
		if ( '' === $user_text ) {
			return new WP_Error( 'yaa_empty', __( 'Say something to Archie.', 'your-architect-archie' ) );
		}

		YAA_Project::add_message( $project_id, 'user', $user_text );
		$messages = YAA_Project::messages( $project_id );
		$state    = YAA_Project::state( $project_id );

		$result = YAA_Claude::turn( self::system_prompt( $state ), $messages, self::tools() );
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		// Merge extracted fields.
		$done    = false;
		$options = array();
		if ( ! empty( $result['tool']['input'] ) ) {
			$input = $result['tool']['input'];

			// Tappable quick replies — drive the UI only, never stored in state.
			if ( ! empty( $input['replies'] ) && is_array( $input['replies'] ) ) {
				foreach ( $input['replies'] as $r ) {
					$r = sanitize_text_field( (string) $r );
					if ( '' !== $r ) {
						$options[] = $r;
					}
					if ( count( $options ) >= 5 ) {
						break;
					}
				}
			}

			foreach ( $input as $k => $v ) {
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
					$state['london']       = ! empty( $he['london'] );       // gates the site-visit question.
					$state['listed']       = ! empty( $he['listed'] );       // drives listed-building follow-ups.
					$state['conservation'] = ! empty( $he['conservation'] ); // drives conservation-area follow-ups.
					continue;
				}
				if ( in_array( $k, array( 'name', 'email' ), true ) ) {
					$state[ $k ] = sanitize_text_field( (string) $v );
					continue;
				}
				$state[ $k ] = is_bool( $v ) ? $v : sanitize_text_field( (string) $v );
			}
		}

		// If Claude didn't propose tappable replies this turn, fall back to
		// deterministic options for whatever the next unanswered question is — so
		// the closed-set questions always get quick chips regardless of the model.
		if ( empty( $options ) ) {
			$options = self::suggested_options( $state );
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
			'options'  => $options,
			'redirect' => ! empty( $package['redirect'] ),
			'done'     => $done,
		);
	}

	/**
	 * Deterministic quick-reply options for the next unanswered question, derived
	 * from the collected state and the fixed flow order. Used as a reliable
	 * fallback when the model doesn't propose its own `replies`. Open questions
	 * (address, name, email) return no options — those are free text.
	 *
	 * @return string[] short tappable labels (sent verbatim as the user's answer).
	 */
	public static function suggested_options( array $s ) {
		$pkg      = isset( $s['package'] ) ? $s['package'] : '';
		$priced   = ( $pkg && 'riba' !== $pkg );
		$has      = function ( $k ) use ( $s ) {
			return array_key_exists( $k, $s );
		};

		if ( ! $has( 'projectType' ) || '' === $s['projectType'] ) {
			return array( 'Rear or side extension', 'Loft or mansard conversion', 'Garage conversion', 'Garden room / outbuilding', 'Internal alterations', 'A brand-new home', 'Something else' );
		}
		if ( 'extension' === $s['projectType'] && ( ! $has( 'storeys' ) || '' === $s['storeys'] ) ) {
			return array( 'Single storey', 'Two storey', 'Not sure yet' );
		}
		if ( ! $pkg ) {
			return array( 'I still need planning permission', 'Planning is already approved', 'It\'s a bigger project', 'I\'m not sure what this means' );
		}
		if ( 'planning' === $pkg && ! $has( 'submitApp' ) ) {
			return array( 'Please submit & manage it for me', 'I\'ll submit it myself' );
		}
		if ( 'buildingregs' === $pkg && ! $has( 'concept' ) ) {
			return array( 'Yes, add a 3D visual', 'No thanks' );
		}
		if ( $priced && ! empty( $s['london'] ) && ! $has( 'siteVisit' ) ) {
			return array( 'Yes, please visit', 'No need' );
		}
		if ( $priced && ! $has( 'survey' ) ) {
			return array( 'I already have measured drawings', 'I\'ll need a survey', 'What\'s a measured survey?' );
		}
		if ( $priced && ! $has( 'structural' ) ) {
			return array( 'Yes', 'No / not sure' );
		}
		if ( $priced && ( ! $has( 'timeframe' ) || '' === $s['timeframe'] ) ) {
			return array( 'Next few weeks', 'A few months', 'Just planning ahead' );
		}
		return array(); // name / email → free text.
	}

	/**
	 * Render the collected state as an ordered, form-style Q&A summary for the
	 * admin — only the questions that apply to this project, each marked answered
	 * or not, so Tiam can see exactly how far someone got and where they stopped.
	 *
	 * @return array[] each: { label, value, answered }
	 */
	public static function answer_summary( array $s ) {
		$types = array(
			'extension'   => 'Rear / side extension',
			'loft'        => 'Loft or mansard conversion',
			'garage'      => 'Garage conversion',
			'outbuilding' => 'Garden room / outbuilding',
			'internal'    => 'Internal alterations',
			'newdwelling' => 'New dwelling',
		);
		$packages = array(
			'planning'     => 'Still needs planning permission',
			'buildingregs' => 'Planning approved — needs building regs',
			'riba'         => 'Full RIBA / larger commission',
		);
		$storeys = array( 'single' => 'Single storey', 'two' => 'Two storey', 'unsure' => 'Not sure yet' );

		$pkg      = isset( $s['package'] ) ? $s['package'] : '';
		$is_priced = ( $pkg && 'riba' !== $pkg );
		$yn       = function ( $k ) use ( $s ) {
			return array( isset( $s[ $k ] ), ! empty( $s[ $k ] ) ? 'Yes' : 'No' );
		};

		// [ label, value|null, applies ]
		$rows = array();
		$rows[] = array( 'Property address', isset( $s['postcode'] ) ? $s['postcode'] : null, true );
		$rows[] = array( 'What they want to do', isset( $s['projectType'], $types[ $s['projectType'] ] ) ? $types[ $s['projectType'] ] : null, true );
		if ( isset( $s['projectType'] ) && 'extension' === $s['projectType'] ) {
			$rows[] = array( 'Storeys', isset( $s['storeys'], $storeys[ $s['storeys'] ] ) ? $storeys[ $s['storeys'] ] : null, true );
		}
		$rows[] = array( 'Planning status', ( $pkg && isset( $packages[ $pkg ] ) ) ? $packages[ $pkg ] : null, true );
		if ( 'planning' === $pkg ) {
			list( $ans, $val ) = $yn( 'submitApp' );
			$rows[] = array( 'We submit & manage the application', $ans ? $val : null, true );
		}
		if ( 'buildingregs' === $pkg ) {
			list( $ans, $val ) = $yn( 'concept' );
			$rows[] = array( '3D concept add-on', $ans ? $val : null, true );
		}
		if ( $is_priced && ! empty( $s['london'] ) ) {
			list( $ans, $val ) = $yn( 'siteVisit' );
			$rows[] = array( 'Site visit (London / M25)', $ans ? $val : null, true );
		}
		if ( $is_priced ) {
			list( $ans, $val ) = $yn( 'survey' );
			$rows[] = array( 'Needs a measured survey', $ans ? $val : null, true );
			list( $ans2, $val2 ) = $yn( 'structural' );
			$rows[] = array( 'Structural changes', $ans2 ? $val2 : null, true );
			$rows[] = array( 'Timeframe', isset( $s['timeframe'] ) ? $s['timeframe'] : null, true );
		}
		$rows[] = array( 'Name', isset( $s['name'] ) && '' !== $s['name'] ? $s['name'] : null, true );
		$rows[] = array( 'Email', isset( $s['email'] ) && '' !== $s['email'] ? $s['email'] : null, true );

		$out = array();
		foreach ( $rows as $r ) {
			$out[] = array(
				'label'    => $r[0],
				'value'    => $r[1],
				'answered' => ( null !== $r[1] && '' !== $r[1] ),
			);
		}
		return $out;
	}
}
