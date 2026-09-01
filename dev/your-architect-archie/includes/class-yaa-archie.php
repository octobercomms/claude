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
	/** The opener greeting text — no side effects, safe to show before a project exists. */
	public static function opener_text() {
		return __( "Hi — I'm Archie, Your Architect's project assistant. I'll ask a few simple questions, explain anything that's unclear, and build your fixed price as we go. There are no silly questions here. To start, what's the address of the property?", 'your-architect-archie' );
	}

	public static function opener( $project_id ) {
		$text = self::opener_text();
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
		$t        = YAA_Pricing::table();
		$services = YAA_Pricing::services();
		$addons   = $t['addons'];
		$meta     = $t['meta'];
		$ans      = isset( $t['answers'] ) ? $t['answers'] : array();

		// Service menu (built from the editable config so Archie always reflects it).
		$svc_lines = array();
		foreach ( $services as $key => $svc ) {
			$on_request = ( null === $svc['price'] || '' === $svc['price'] || ! empty( $svc['redirect'] ) );
			$price      = $on_request ? 'priced on request' : YAA_Pricing::money( (int) $svc['price'] );
			$svc_lines[] = sprintf( '- "%s" (service key: %s) — %s%s', $svc['label'], $key, $price, ( ! empty( $svc['sub'] ) ? ' — ' . $svc['sub'] : '' ) );
		}

		$addon_lines = array();
		if ( ! empty( $addons['submission']['enabled'] ) ) {
			$addon_lines[] = sprintf( '- "%s" — +%s. ONLY for the Full planning application service. Set submitApp=true if they want us to submit & manage it; if they will submit themselves, leave submitApp false. Recommend gently: letting us submit means the council deals with us directly and spares them the hassle.', $addons['submission']['label'], YAA_Pricing::money( (int) $addons['submission']['price'] ) );
		}
		if ( ! empty( $addons['concept3d']['enabled'] ) ) {
			$addon_lines[] = sprintf( '- "%s" — +%s. Optional on any service. Set concept=true if they want it.', $addons['concept3d']['label'], YAA_Pricing::money( (int) $addons['concept3d']['price'] ) );
		}
		if ( ! empty( $addons['siteVisit']['enabled'] ) ) {
			$addon_lines[] = sprintf( '- "%s" — +%s. ONLY offer if the property is in London / within the M25 (you will be told). Set siteVisit=true if they want it.', $addons['siteVisit']['label'], YAA_Pricing::money( (int) $addons['siteVisit']['price'] ) );
		}

		$phone           = isset( $meta['phone'] ) ? $meta['phone'] : '';
		$booking         = isset( $meta['bookingUrl'] ) ? $meta['bookingUrl'] : '';
		$riba            = isset( $meta['ribaEmail'] ) ? $meta['ribaEmail'] : 'info@tiamarchitects.com';
		$structural_line = ! empty( $ans['structuralUnsure'] ) ? $ans['structuralUnsure'] : 'No problem — we can confirm this with you in due course.';
		$survey_help     = ! empty( $ans['surveyHelp'] ) ? $ans['surveyHelp'] : 'No problem — we\'ll help. We find a trusted independent local professional to carry out an accurate laser-measured survey, and we base your drawings on that.';

		$advice = 'If they are not sure what they need or want to talk to someone, offer a free 15-minute phone call'
			. ( $booking ? ' (booking link: ' . $booking . ')' : '' )
			. ( $phone ? ' or the phone number ' . $phone : '' )
			. ', or that they can email their question — whatever suits them.';

		$lines = array(
			'You are Archie, the project assistant for Your Architect — fixed-price architectural drawings for UK homeowners (a trading name of Tiam Architects LLP, ARB-registered and RIBA chartered).',
			'',
			'WHO YOU ARE TALKING TO: ordinary homeowners who usually have NO idea how planning, drawings or architecture work, and may feel out of their depth. Your job is to make this feel easy and friendly — you are a helpful guide, not a form. Never make anyone feel they should already know something.',
			'',
			'HOW TO ASK EVERYTHING:',
			'- One short question at a time, in plain everyday English. Never use jargon without immediately explaining it in a few words (e.g. "planning permission — that\'s the council\'s formal go-ahead to build").',
			'- Keep every reply to one or two warm, direct sentences. British English.',
			'- Write in plain, everyday text only — never use markdown, asterisks (**), bullet characters, headings or other formatting. Whatever you type is shown to the person exactly as-is, so formatting marks appear as literal characters.',
			'- After ANY question that has a handful of natural answers, ALSO propose tappable buttons via the set_fields tool\'s `replies` field (2–5 very short labels, in the person\'s own words). The person can tap one OR type their own — both are fine.',
			'- Whenever a question contains a term a non-expert might not know, ALWAYS include a final reply option worded like "What does that mean?" or "I\'m not sure". If they pick it (or seem confused, or ask), explain the term simply in one or two sentences with a relatable example, reassure them it\'s a normal thing not to know, then ask the same question again with the buttons.',
			'- If someone answers "I don\'t know" to anything, that is completely fine: help them reason it out or offer a sensible default, never pressure them.',
			'',
			'THE SERVICES WE OFFER (this is the menu — set the `service` field to the matching key):',
			implode( "\n", $svc_lines ),
			'',
			'OPTIONAL ADD-ONS Archie ASKS about and then adds (never listed as something to remove):',
			( $addon_lines ? implode( "\n", $addon_lines ) : '- (none configured)' ),
			'',
			'THE INFORMATION TO COLLECT (ask in this order, and SKIP anything that clearly does not apply):',
			'1) the property address (already asked in the opener);',
			'2) WHICH SERVICE they need — offer the menu above in plain words as tappable options, plus "I\'m not sure / I need advice". Help them pick if unsure. Set the `service` field. ' . $advice . ' The MOMENT they choose the advice path (or clearly want to talk to someone rather than pick a service), set advice=true and STAY in advice mode: offer a free 15-minute call or to take their email so the team can get back to them, and do NOT present the service menu again. Asking for their email or their name are open questions — never offer tappable options for those.',
			'3) briefly, what the work physically is (a rear/side extension, loft, garage, outbuilding, internal work, a new home) — for our notes; set projectType if clear. Keep it to one light question, do not labour it.',
			'4) the relevant add-ons for their service (see the add-ons list): for Full planning, whether we submit & manage the application; the optional 3D visualisation; and the site visit ONLY if they are in London / the M25.',
			'5) "Do you have existing plans of your property drawn up?" — plain words for a measured survey (an accurate set of drawings of the property as it is today, which we need before designing). If YES → survey=false. If NO or "I\'d like the pro to help" → survey=true and reassure: "' . $survey_help . '"',
			'6) will the work involve structural changes (removing walls, adding steel beams)? Reassure that "No / not sure" is completely fine. If they are unsure, reply: "' . $structural_line . '" and set structural only if you are confident.',
			'7) their rough timeframe;',
			'8) finally, the best email address to send their quote to — and their name. Frame it warmly: you would like to EMAIL them a copy of this fixed-price quote so they have it to keep, and it is how the team will confirm details and get back to them. This is how Your Architect contacts them, so an email really is needed — do NOT call it optional. Reassure them it is only ever used for their quote and their project, never marketing. If they hesitate, briefly explain why it matters and ask once more.',
			'',
			'FINISHING — once you have a valid email (and their name), that is everything you need and the project is sent to our team automatically. Warmly wrap up: thank them, tell them you are emailing a copy of their fixed-price quote to that address and that the team will review it and get back to them to confirm the details and get things moving. Do not mention the price, and do not tell them to press any button.',
			'',
			'IF THEY NEED BUILDING REGULATIONS DRAWINGS, also gently establish (weave in naturally, do not interrogate): do they already have planning permission, or does the work even need it (you can advise); do they have approved planning drawings they could share; do they have a structural engineer already (if not, reassure we can find a trusted independent local one and coordinate); and would they like us to submit the building control pack to their local authority for them.',
			'',
			'HARD RULES:',
			'- NEVER state, estimate or discuss a price, fee or number in your replies. The panel on the right shows every price as it builds. If asked "how much?", say the price is building on the right as they answer.',
			'- Do NOT give planning or design advice or promise an outcome; you help scope the drawings package only.',
			'- A measured survey and a structural engineer are NEVER part of our fee — if one is needed we source an independent local professional and share their quote for the client\'s approval first; they pay only for that work, not our time. Say this plainly; never quote a number.',
			'- New dwellings and full RIBA services (concept to construction) or larger commissions are handled directly by Tiam Architects: set the `service` to "newdwelling" if that is what they want, and point them to ' . $riba . ' at the end.',
			'',
			'TOOL USE — EVERY turn call set_fields with: (a) any structured fields you learned this message (omit the rest), and (b) `replies` for the question you just asked (omit `replies` only for open answers like the address, a free description, name or email). submitApp=true only if they want us to submit/manage the planning application. concept=true only if they want the 3D visualisation add-on. siteVisit=true only if they want the London/M25 visit. survey=true if a measured survey needs arranging (they do NOT already have existing plans). done=true ONLY once you have captured a valid email address to reach them on (their name too if given) — never before.',
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
		$service_keys = array_keys( YAA_Pricing::services() );
		return array(
			array(
				'name'         => 'set_fields',
				'description'  => 'Record the structured fields learned from the user this turn, and propose tappable quick-reply buttons for the question you just asked. Only include fields you are confident about.',
				'input_schema' => array(
					'type'       => 'object',
					'properties' => array(
						'address'     => array( 'type' => 'string' ),
						'service'     => array( 'type' => 'string', 'enum' => $service_keys, 'description' => 'the base service the homeowner needs, chosen from the service menu' ),
						'advice'      => array( 'type' => 'boolean', 'description' => 'true if the person is unsure what they need or wants advice / to talk to someone rather than pick a service from the menu' ),
						'projectType' => array( 'type' => 'string', 'enum' => array( 'extension', 'loft', 'garage', 'outbuilding', 'internal', 'newdwelling' ), 'description' => 'optional context — what the work physically is' ),
						'storeys'     => array( 'type' => 'string', 'description' => 'for a rear/side extension: single, two, or unsure' ),
						'submitApp'   => array( 'type' => 'boolean', 'description' => 'true if they want us to submit & manage the planning application (planning service only)' ),
						'concept'     => array( 'type' => 'boolean', 'description' => 'true if they want the optional 3D visualisation add-on' ),
						'siteVisit'   => array( 'type' => 'boolean', 'description' => 'true if they want a London / within-M25 site visit' ),
						'survey'      => array( 'type' => 'boolean', 'description' => 'true if a measured survey needs arranging (they do NOT already have existing plans drawn up)' ),
						'structural'  => array( 'type' => 'boolean', 'description' => 'true if the work involves structural changes / needs a structural engineer' ),
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
	private static $allowed = array( 'address', 'service', 'advice', 'projectType', 'storeys', 'submitApp', 'concept', 'siteVisit', 'survey', 'structural', 'timeframe', 'name', 'email', 'done' );

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
				if ( 'email' === $k ) {
					$email = sanitize_email( (string) $v ); // only keep a genuine address.
					if ( is_email( $email ) ) {
						$state['email'] = $email;
					}
					continue;
				}
				if ( 'name' === $k ) {
					$state['name'] = sanitize_text_field( (string) $v );
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

		// Never treat the chat as finished until we actually have an email to reach
		// them on — an opened project with no contact is useless to the studio.
		if ( $done && empty( $state['email'] ) ) {
			$done = false;
		}

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
			'hasEmail' => ! empty( $state['email'] ),
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
		$service  = isset( $s['service'] ) ? (string) $s['service'] : '';
		$services = YAA_Pricing::services();
		$svc      = ( $service && isset( $services[ $service ] ) ) ? $services[ $service ] : null;
		$priced   = ( $svc && empty( $svc['redirect'] ) && null !== $svc['price'] && '' !== $svc['price'] );
		$has      = function ( $k ) use ( $s ) {
			return array_key_exists( $k, $s );
		};

		// Advice / contact-capture path (or once we already hold an email): the
		// remaining questions are open (call vs email, the email, their name), so
		// never fall back to the service menu here.
		if ( ! empty( $s['advice'] ) || ! empty( $s['email'] ) ) {
			return array();
		}

		// 1) Which service? — labels straight from the editable menu, plus an advice path.
		if ( ! $svc ) {
			$opts = array();
			foreach ( $services as $svc_row ) {
				$opts[] = $svc_row['label'];
			}
			$opts[] = 'I\'m not sure — I need advice';
			return array_slice( $opts, 0, 9 );
		}

		if ( ! $priced ) {
			return array(); // priced-on-request (e.g. new dwelling) → Archie hands off, free text.
		}

		// 2) Light project-type context.
		if ( ! $has( 'projectType' ) || '' === $s['projectType'] ) {
			return array( 'Rear or side extension', 'Loft or mansard conversion', 'Garage conversion', 'Garden room / outbuilding', 'Internal alterations', 'Something else' );
		}
		// 3) Add-ons.
		if ( 'planning' === $service && ! $has( 'submitApp' ) ) {
			return array( 'Please submit & manage it for me', 'I\'ll submit it myself' );
		}
		if ( ! $has( 'concept' ) ) {
			return array( 'Yes, add a 3D visualisation', 'No thanks', 'What\'s that?' );
		}
		if ( ! empty( $s['london'] ) && ! $has( 'siteVisit' ) ) {
			return array( 'Yes, please visit', 'No need' );
		}
		// 4) Existing plans (measured survey), structural, timeframe.
		if ( ! $has( 'survey' ) ) {
			return array( 'Yes, I have plans drawn up', 'No — please help with a survey', 'What\'s a measured survey?' );
		}
		if ( ! $has( 'structural' ) ) {
			return array( 'Yes', 'No / not sure' );
		}
		if ( ! $has( 'timeframe' ) || '' === $s['timeframe'] ) {
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
		$storeys  = array( 'single' => 'Single storey', 'two' => 'Two storey', 'unsure' => 'Not sure yet' );
		$services = YAA_Pricing::table()['services'];

		$service   = isset( $s['service'] ) ? (string) $s['service'] : '';
		$svc       = ( $service && isset( $services[ $service ] ) ) ? $services[ $service ] : null;
		$is_priced = ( $svc && empty( $svc['redirect'] ) && null !== $svc['price'] && '' !== $svc['price'] );
		$yn        = function ( $k ) use ( $s ) {
			return array( isset( $s[ $k ] ), ! empty( $s[ $k ] ) ? 'Yes' : 'No' );
		};

		// [ label, value|null, applies ]
		$rows = array();
		$rows[] = array( 'Property address', isset( $s['postcode'] ) ? $s['postcode'] : null, true );
		$rows[] = array( 'Service needed', $svc ? $svc['label'] : null, true );
		$rows[] = array( 'What the work is', isset( $s['projectType'], $types[ $s['projectType'] ] ) ? $types[ $s['projectType'] ] : null, true );
		if ( isset( $s['projectType'] ) && 'extension' === $s['projectType'] ) {
			$rows[] = array( 'Storeys', isset( $s['storeys'], $storeys[ $s['storeys'] ] ) ? $storeys[ $s['storeys'] ] : null, true );
		}
		if ( 'planning' === $service ) {
			list( $ans, $val ) = $yn( 'submitApp' );
			$rows[] = array( 'We submit & manage the application', $ans ? $val : null, true );
		}
		if ( $is_priced ) {
			list( $ansc, $valc ) = $yn( 'concept' );
			$rows[] = array( '3D visualisation add-on', $ansc ? $valc : null, true );
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
