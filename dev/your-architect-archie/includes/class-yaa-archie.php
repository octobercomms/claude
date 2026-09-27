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
			'message'     => $text,
			'package'     => YAA_Project::package( $project_id ),
			'options'     => array(), // address is free text — nothing to tap.
			'placeholder' => self::input_hint( array(), false ),
			'redirect'    => false,
			'done'        => false,
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
		$terms           = YAA_Settings::get( 'terms_url', '' );
		if ( ! $terms ) {
			$terms = home_url( '/terms-of-service/' );
		}
		$structural_line = ! empty( $ans['structuralUnsure'] ) ? $ans['structuralUnsure'] : 'No problem — we can confirm this with you in due course.';
		$survey_help     = ! empty( $ans['surveyHelp'] ) ? $ans['surveyHelp'] : 'No problem — we\'ll help. We find a trusted independent local professional to carry out an accurate laser-measured survey, and we base your drawings on that.';

		$advice = 'If they are unsure which service they need, DO NOT jump to a phone call — help them yourself first: ask two or three short, friendly questions about what they want to do and whether any work has started, then recommend the specific service from our menu that best fits and set `services` to it, briefly saying what that service covers. Do NOT tell them whether their project needs planning permission or is permitted development — say the team will confirm the planning position. Only if they still cannot decide after that, or clearly want to speak to a person, offer a free 15-minute phone call'
			. ( $booking ? ' (booking link: ' . $booking . ')' : '' )
			. ( $phone ? ' or the phone number ' . $phone : '' )
			. ', or to take their email so the team can follow up — and only then set advice=true.';

		$lines = array(
			'You are Archie, the project assistant for Your Architect — fixed-price architectural drawings for UK homeowners (a trading name of Tiam Architects LLP, ARB-registered and RIBA chartered).',
			'',
			'WHO YOU ARE TALKING TO: ordinary homeowners who usually have NO idea how planning, drawings or architecture work, and may feel out of their depth. Your job is to make this feel easy and friendly — you are a helpful guide, not a form. Never make anyone feel they should already know something.',
			'',
			'HOW TO ASK EVERYTHING:',
			'- One short question at a time, in plain everyday English. Never use jargon without immediately explaining it in a few words (e.g. "planning permission — that\'s the council\'s formal go-ahead to build").',
			'- Keep every reply to one or two warm, direct sentences. British English.',
			'- Write in plain, everyday text only — never use markdown, asterisks (**), bullet characters, headings or other formatting. Whatever you type is shown to the person exactly as-is, so formatting marks appear as literal characters.',
			'- EVERY turn must include a spoken reply AND move the conversation forward with the next question — never reply with only the set_fields tool and no words, and never stop after acknowledging an answer. As soon as you have the postcode, thank them briefly and ask which service they need (offering the service menu as tappable options plus "I\'m not sure — I need advice").',
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
			'1) the property address (already asked in the opener). We work ONLY on properties in the United Kingdom, and we need the FULL address INCLUDING a valid UK postcode — we cannot carry out the work without the postcode, so treat it as essential. Set the `address` field to what they give, and the `postcode` field the moment you have a postcode. If their address has no postcode, warmly ask for the postcode before moving on to anything else (e.g. "Thanks — and what is the postcode?"). If the property is clearly NOT in the UK, set outsideUk=true, kindly explain that Your Architect only works on properties in the UK so sadly you are not able to help with this one, suggest they seek a local architect, and STOP there — do not ask anything else, do not pick a service, do not build a quote.',
			'2) WHICH SERVICE(S) they need — offer the menu above in plain words as tappable options, plus "I\'m not sure / I need advice". Help them pick if unsure. They can have MORE THAN ONE of our services in the same quote (e.g. a full planning application AND building regulations drawings). To put a service in the quote, set `addServices` to the ones to add; to take one out, set `removeServices` — and ONLY remove a service when the customer explicitly asks to remove that specific service. Never re-send the whole cart, and never remove anything because they declined an add-on or answered another question. The customer can ALSO remove items themselves with the ✕ on their quote, so the cart may differ from earlier in the chat — ALWAYS trust "THE CUSTOMER\'S CURRENT QUOTE" below for what is in the cart right now, never your own memory. Any time you add or remove something, say plainly what changed and read the current quote back. ONLY our own services from the menu can go in the quote. If they ask for a measured survey, a structural engineer, or anything not on our menu, warmly explain those are arranged separately through trusted independent professionals (we help find one; they approve that quote and pay them directly), so it is not part of our fixed fee and cannot be added as a priced line — never claim you have added it. ' . $advice . ' If they tap "I\'m not sure", diagnose and recommend a service as above rather than deflecting — only set advice=true once they clearly want to talk to a person instead of getting their price online. Asking for their email or their name are open questions — never offer tappable options for those.',
			'3) briefly, what the work physically is (a rear/side extension, loft, garage, outbuilding, internal work, a new home) — for our notes; set projectType if clear. Keep it to one light question, do not labour it.',
			'4) the relevant add-ons for the services they chose (see the add-ons list): for Full planning, whether we submit & manage the application; the optional 3D visualisation; and the site visit ONLY if they are in London / the M25.',
			'5) "Do you have existing plans of your property drawn up?" — plain words for a measured survey (an accurate set of drawings of the property as it is today, which we need before designing). If YES → set hasDrawings=true and survey=false, tell them it is essential we see those drawings and ask them to upload the file(s) now using the photo/paperclip button next to the message box; they should upload before finishing. If NO or "I\'d like the pro to help" → survey=true and reassure: "' . $survey_help . '" (For a full planning application an accurate measured survey is required before we can start, even if they only have estate-agent floor plans.)',
			'6) will the work involve structural changes (removing walls, adding steel beams)? Reassure that "No / not sure" is completely fine. If they are unsure, reply: "' . $structural_line . '" and set structural only if you are confident.',
			'7) their rough timeframe;',
			'8) finally, the best email address to send their quote to — and their name. Frame it warmly: you would like to EMAIL them a copy of this fixed-price quote so they have it to keep, and it is how the team will confirm details and get back to them. This is how Your Architect contacts them, so an email really is needed — do NOT call it optional. Reassure them it is only ever used for their quote and their project, never marketing. If they hesitate, briefly explain why it matters and ask once more.',
			'',
			'FINISHING — once you have a UK postcode, a valid email and their name, warmly tell them their fixed-price quote is ready and everything is captured. Then DIRECT them to press the "Save & submit project" button to send it to our team — that button is their final go-ahead, and nothing goes to the team until they press it. Reassure them you\'ll email a copy of the quote to their address and the team will review it and get back to them to confirm the details. Do not mention the price, and do not claim it has already been submitted.',
			'',
			'IF THEY NEED BUILDING REGULATIONS DRAWINGS, also gently establish (weave in naturally, do not interrogate): do they already have planning permission, or does the work even need it (you can advise); do they have approved planning drawings they could share; do they have a structural engineer already (if not, reassure we can find a trusted independent local one and coordinate); and would they like us to submit the building control pack to their local authority for them.',
			'',
			'HARD RULES:',
			'- Do NOT invent, estimate, negotiate or discount any price, and never quote a figure that is not in "THE CUSTOMER\'S CURRENT QUOTE" below. You MAY, when they ask what is on their quote or what their total is, read back the exact line items and running total shown there — a customer asking their total is a strong lead, so help them; never say you cannot see their screen or send them away to look. Do not describe where the panel is on the screen.',
			'- Do NOT give planning or design advice, and NEVER state or imply whether a project needs planning permission, is permitted development, or will be approved — not even on the advice path. When helping someone choose a service, recommend the service that fits what they describe and say the team will confirm the planning position; do not assert the planning position yourself.',
			'- Do NOT state refund, cancellation, guarantee or timing terms as fact. If asked about refunds, cancellation rights or guarantees, say you cannot guarantee a planning outcome and that the fee covers the professional drawing work, then point them to our Terms of Service at ' . $terms . ' for the full terms (including any cancellation rights) rather than stating a contractual position yourself.',
			'- A measured survey and a structural engineer are NEVER part of our fee — if one is needed we source an independent local professional and share their quote for the client\'s approval first; they pay only for that work, not our time. Say this plainly; never quote a number.',
			'- New dwellings and full RIBA services (concept to construction) or larger commissions are handled directly by Tiam Architects: include "newdwelling" in `services` if that is what they want, and point them to ' . $riba . ' at the end.',
			'',
			'TOOL USE — EVERY turn call set_fields with: (a) any structured fields you learned this message (omit the rest), and (b) `replies` for the question you just asked (omit `replies` only for open answers like the address, postcode, a free description, name or email). Set `postcode` as soon as you have the UK postcode, and `outsideUk`=true if the property is not in the UK. Use `addServices` to add our services and `removeServices` to remove one (only when explicitly asked to remove that service); never re-send the whole cart. Set `hasDrawings`=true if they already have existing plans/drawings/a survey. submitApp=true only if they want us to submit/manage the planning application. concept=true only if they want the 3D visualisation add-on. siteVisit=true only if they want the London/M25 visit. survey=true if a measured survey needs arranging (they do NOT already have existing plans). done=true ONLY once you have a UK postcode AND a valid email address to reach them on (their name too if given), the property is in the UK, and — if they said they have existing drawings — they have uploaded them. Never set done before all of that.',
		);

		$known = self::address_knowledge( $state );
		if ( $known ) {
			$lines[] = '';
			$lines[] = $known;
		}

		$quote = self::quote_context( $state );
		if ( $quote ) {
			$lines[] = '';
			$lines[] = $quote;
		}

		return implode( "\n", $lines );
	}

	/** The current priced quote, injected so Archie can read the customer's own figures back to them. */
	private static function quote_context( array $state ) {
		$pkg  = YAA_Pricing::build_package( $state );
		$rows = array();
		foreach ( $pkg['nodes'] as $n ) {
			if ( isset( $n['kind'] ) && 'info' === $n['kind'] ) {
				continue;
			}
			$price  = ( isset( $n['price'] ) && null !== $n['price'] ) ? YAA_Pricing::money( (int) $n['price'] ) : 'sourced separately (not our fee)';
			$rows[] = '- ' . $n['label'] . ': ' . $price;
		}
		if ( empty( $rows ) ) {
			return '';
		}
		return "THE CUSTOMER'S CURRENT QUOTE — the definitive contents of their cart right now, INCLUDING any items they removed with the ✕ button on their panel. This is the single source of truth: it may differ from what was said earlier in the chat, and you MUST use it (never your memory) when telling them what is on their quote or their total. Read these exact figures back if they ask; never invent, change, discount or add a price.\n"
			. implode( "\n", $rows )
			. "\nRunning total: " . YAA_Pricing::money( (int) $pkg['total'] );
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
						'address'     => array( 'type' => 'string', 'description' => 'the full property address as given (house/number, street, town)' ),
						'postcode'    => array( 'type' => 'string', 'description' => 'the UK postcode of the property once known — we cannot do the work without it' ),
						'outsideUk'   => array( 'type' => 'boolean', 'description' => 'true if the property is clearly NOT in the United Kingdom (we only work on UK properties)' ),
						'addServices'    => array(
							'type'        => 'array',
							'items'       => array( 'type' => 'string', 'enum' => $service_keys ),
							'description' => 'our services to ADD to the cart this turn (only ones not already in it). Only our own menu services — never a survey or structural engineer.',
						),
						'removeServices' => array(
							'type'        => 'array',
							'items'       => array( 'type' => 'string', 'enum' => $service_keys ),
							'description' => 'services to REMOVE from the cart this turn — ONLY when the customer explicitly asks to remove that specific service. Never remove anything otherwise.',
						),
						'advice'      => array( 'type' => 'boolean', 'description' => 'true if the person is unsure what they need or wants advice / to talk to someone rather than pick a service from the menu' ),
						'hasDrawings' => array( 'type' => 'boolean', 'description' => 'true if they say they already have existing drawings, plans or a measured survey of the property — if so they must upload the file(s)' ),
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
	private static $allowed = array( 'address', 'postcode', 'outsideUk', 'addServices', 'removeServices', 'services', 'service', 'advice', 'hasDrawings', 'projectType', 'storeys', 'submitApp', 'concept', 'siteVisit', 'survey', 'structural', 'timeframe', 'name', 'email', 'done' );

	/**
	 * No-model fast path for the opening data-capture steps (address → postcode →
	 * service menu). These are the slowest, highest-drop-off turns and need no
	 * reasoning, so we answer them instantly and only call the model once there's
	 * something to reason about. Anything that looks like a question, refusal or
	 * request for advice/price is handed to the model instead (returns null).
	 *
	 * @return array|null A turn result (same shape as turn()) or null to fall through.
	 */
	private static function fast_path( $project_id, $user_text, array $state ) {
		if ( ! empty( $state['postcode'] ) || ! empty( $state['outsideUk'] ) ) {
			return null; // only the very opening steps
		}
		$text = trim( (string) $user_text );
		if ( '' === $text || false !== strpos( $text, '?' ) ) {
			return null;
		}
		// Anything that reads like a question / refusal / advice or price ask → model.
		if ( preg_match( '/\b(price|cost|how much|quote first|advice|not sure|unsure|help|why|rather not|instead|won\'t|wont|cheaper|discount)\b/i', $text ) ) {
			return null;
		}

		$pc = self::extract_uk_postcode( $text );
		if ( $pc ) {
			if ( empty( $state['address'] ) ) {
				$state['address'] = sanitize_text_field( $text );
			}
			$state['postcode'] = $pc;
			self::apply_address_lookup( $state, $pc );
			$reply = __( 'Thanks — got that. Which of these best matches what you need? Tap one below, or if you\'re not sure, tap “I\'m not sure — I need advice”.', 'your-architect-archie' );
		} else {
			// No postcode yet. Only treat it as an address if it looks like one and we
			// don't already have an address; otherwise let the model handle it.
			$looks_address = ( empty( $state['address'] ) && preg_match( '/\d/', $text ) && mb_strlen( $text ) >= 6 && str_word_count( $text ) >= 2 );
			if ( ! $looks_address ) {
				return null;
			}
			$state['address'] = sanitize_text_field( $text );
			$reply = __( 'Thanks — and what\'s the postcode of the property? I need it to make sure we can help and to build your quote accurately.', 'your-architect-archie' );
		}

		$package = YAA_Pricing::build_package( $state );
		YAA_Project::set_state( $project_id, $state );
		YAA_Project::add_message( $project_id, 'assistant', $reply );
		YAA_Project::set_package( $project_id, $package );

		return array(
			'message'     => $reply,
			'package'     => $package,
			'options'     => self::suggested_options( $state ),
			'placeholder' => self::input_hint( $state, false ),
			'redirect'    => ! empty( $package['redirect'] ),
			'done'        => false,
			'hasEmail'    => ! empty( $state['email'] ),
		);
	}

	/**
	 * Instant handling of a single service chip-tap at the service-choice step. An
	 * exact match to one priced service label sets it and asks the next question
	 * with no model call — so it can never stub. Free-text / multi-service phrasing
	 * ("both planning and building regs") returns null and goes to the model.
	 */
	private static function service_tap_fast( $project_id, $user_text, array $state ) {
		if ( ! self::is_service_stage( $state ) ) {
			return null;
		}
		$text = trim( (string) $user_text );
		foreach ( YAA_Pricing::services() as $key => $svc ) {
			if ( 0 !== strcasecmp( $text, (string) $svc['label'] ) ) {
				continue;
			}
			$on_request = ( ! empty( $svc['redirect'] ) || null === $svc['price'] || '' === $svc['price'] );
			if ( $on_request ) {
				return null; // new dwelling etc. → let the model hand off warmly.
			}
			$state['services'] = array( $key );
			$reply   = __( 'Great — and to picture it: what is the work, roughly? For example a rear or side extension, a loft, a garage conversion, or something else.', 'your-architect-archie' );
			$package = YAA_Pricing::build_package( $state );
			YAA_Project::set_state( $project_id, $state );
			YAA_Project::add_message( $project_id, 'assistant', $reply );
			YAA_Project::set_package( $project_id, $package );
			return array(
				'message'     => $reply,
				'package'     => $package,
				'options'     => self::suggested_options( $state ),
				'placeholder' => self::input_hint( $state, false ),
				'redirect'    => ! empty( $package['redirect'] ),
				'done'        => false,
				'hasEmail'    => ! empty( $state['email'] ),
			);
		}
		return null;
	}

	/**
	 * Run one conversational turn.
	 *
	 * @return array|WP_Error { message, package, options, redirect, done }.
	 */
	public static function turn( $project_id, $user_text, $session = '' ) {
		$user_text = trim( (string) $user_text );
		if ( '' === $user_text ) {
			return new WP_Error( 'yaa_empty', __( 'Say something to Archie.', 'your-architect-archie' ) );
		}
		// Cap length to bound token cost / abuse (F15).
		if ( function_exists( 'mb_substr' ) && mb_strlen( $user_text ) > 1000 ) {
			$user_text = mb_substr( $user_text, 0, 1000 );
		}

		YAA_Project::add_message( $project_id, 'user', $user_text );
		$messages = YAA_Project::messages( $project_id );
		$state    = YAA_Project::state( $project_id );

		// Instant, no-model handling of the opening address/postcode steps.
		$fast = self::fast_path( $project_id, $user_text, $state );
		if ( null !== $fast ) {
			return $fast;
		}

		// Instant handling of a single service chip-tap — guarantees the next question
		// is asked (the model sometimes stubs with just "Great choice!").
		$svc_fast = self::service_tap_fast( $project_id, $user_text, $state );
		if ( null !== $svc_fast ) {
			return $svc_fast;
		}

		// This turn will call the model — count it against the per-session daily cap
		// (fast-path turns above are free and never counted).
		if ( '' !== $session ) {
			YAA_Rate_Limit::count_session_turn( $session );
		}

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
					$state['address'] = sanitize_text_field( (string) $v );
					// An address line often already contains the postcode — capture it
					// so we don't have to ask again when it was given in full.
					if ( empty( $state['postcode'] ) ) {
						$pc = self::extract_uk_postcode( (string) $v );
						if ( $pc ) {
							$state['postcode'] = $pc;
							self::apply_address_lookup( $state, $pc );
						}
					}
					continue;
				}
				if ( 'postcode' === $k ) {
					$pc = self::extract_uk_postcode( (string) $v );
					if ( $pc ) {
						$state['postcode'] = $pc;
						self::apply_address_lookup( $state, $pc );
					}
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
				if ( 'addServices' === $k || 'services' === $k ) {
					// ADD only. Even a stray full `services` list from the model just
					// appends — it can never clobber the panel's ✕ removals.
					$valid = array_keys( YAA_Pricing::services() );
					$cur   = isset( $state['services'] ) && is_array( $state['services'] ) ? $state['services'] : array();
					foreach ( (array) $v as $svc ) {
						$svc = sanitize_text_field( (string) $svc );
						if ( in_array( $svc, $valid, true ) && ! in_array( $svc, $cur, true ) ) {
							$cur[] = $svc;
						}
					}
					$state['services'] = array_values( $cur );
					continue;
				}
				if ( 'service' === $k ) {
					// Back-compat single key → ADD.
					$svc   = sanitize_text_field( (string) $v );
					$valid = array_keys( YAA_Pricing::services() );
					if ( in_array( $svc, $valid, true ) ) {
						$cur = isset( $state['services'] ) && is_array( $state['services'] ) ? $state['services'] : array();
						if ( ! in_array( $svc, $cur, true ) ) {
							$cur[] = $svc;
						}
						$state['services'] = array_values( $cur );
					}
					continue;
				}
				if ( 'removeServices' === $k ) {
					// Remove only the named services from the CURRENT cart.
					$cur = isset( $state['services'] ) && is_array( $state['services'] ) ? $state['services'] : array();
					foreach ( (array) $v as $svc ) {
						$svc = sanitize_text_field( (string) $svc );
						$cur = array_filter( $cur, function ( $x ) use ( $svc ) {
							return (string) $x !== $svc;
						} );
					}
					$state['services'] = array_values( $cur );
					continue;
				}
				$state[ $k ] = is_bool( $v ) ? $v : sanitize_text_field( (string) $v );
			}
		}

		// If Claude didn't propose tappable replies this turn, fall back to
		// deterministic options for whatever the next unanswered question is — so
		// the closed-set questions always get quick chips regardless of the model.
		// Closed-set questions ALWAYS use the config-derived chips: the model drops or
		// invents options ("New home" as a project type, 5 where there are 6) and its
		// chips lag the question being asked. Only genuinely open questions — where
		// suggested_options() returns nothing — keep the model's own replies.
		$deterministic = self::suggested_options( $state );
		if ( ! empty( $deterministic ) ) {
			$options = $deterministic;
		}

		if ( ! empty( $state['name'] ) || ! empty( $state['email'] ) ) {
			YAA_Project::set_contact( $project_id, isset( $state['name'] ) ? $state['name'] : '', isset( $state['email'] ) ? $state['email'] : '' );
		}

		// A property outside the UK is a hard stop — we don't quote or open a
		// project for it, so drop any service that may have slipped in.
		if ( ! empty( $state['outsideUk'] ) ) {
			unset( $state['services'], $state['service'] );
			$done = false;
		}

		$package = YAA_Pricing::build_package( $state );

		// Never treat the chat as finished until we have everything the studio needs
		// to act: a UK postcode, an email to reach them on, and — if they said they
		// already have drawings — the uploaded file(s).
		if ( $done ) {
			if ( empty( $state['email'] ) || empty( $state['postcode'] ) ) {
				$done = false;
			} elseif ( ! empty( $state['hasDrawings'] ) && ! self::has_client_upload( $project_id ) ) {
				$done = false;
			}
		}

		// The model sometimes returns a tool call with no spoken text (it recorded a
		// field but didn't continue). Fall back to the next question, not a dead-end
		// "thanks", so the conversation always moves forward.
		$message = '' !== $result['text'] ? $result['text'] : self::next_prompt( $state, $done );
		YAA_Project::set_state( $project_id, $state );
		YAA_Project::add_message( $project_id, 'assistant', $message );
		YAA_Project::set_package( $project_id, $package );
		if ( $done ) {
			YAA_Project::set_status( $project_id, 'quoted' );
		}

		return array(
			'message'     => $message,
			'package'     => $package,
			'options'     => $options,
			'placeholder' => self::input_hint( $state, $done ),
			'redirect'    => ! empty( $package['redirect'] ),
			'done'        => $done,
			'hasEmail'    => ! empty( $state['email'] ),
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
	/** The services chosen so far (multi-service cart), normalised to a key list. */
	private static function chosen_services( array $s ) {
		if ( ! empty( $s['services'] ) && is_array( $s['services'] ) ) {
			return array_values( array_filter( array_map( 'strval', $s['services'] ) ) );
		}
		if ( ! empty( $s['service'] ) ) {
			return array( (string) $s['service'] );
		}
		return array();
	}

	/** True when the very next question is "which service?" — always show the config menu here. */
	public static function is_service_stage( array $s ) {
		return ! empty( $s['postcode'] ) && empty( $s['outsideUk'] ) && empty( $s['advice'] )
			&& empty( $s['email'] ) && ! self::chosen_services( $s );
	}

	public static function suggested_options( array $s ) {
		$services = YAA_Pricing::services();
		$chosen   = self::chosen_services( $s );
		$priced_keys = array();
		foreach ( $chosen as $k ) {
			if ( isset( $services[ $k ] ) && empty( $services[ $k ]['redirect'] ) && null !== $services[ $k ]['price'] && '' !== $services[ $k ]['price'] ) {
				$priced_keys[] = $k;
			}
		}
		$has_priced   = ! empty( $priced_keys );
		$has_planning = in_array( 'planning', $chosen, true );
		$has          = function ( $k ) use ( $s ) {
			return array_key_exists( $k, $s );
		};

		// Advice / contact-capture path (or once we already hold an email): the
		// remaining questions are open (call vs email, the email, their name), so
		// never fall back to the service menu here.
		if ( ! empty( $s['advice'] ) || ! empty( $s['email'] ) ) {
			return array();
		}

		// Nothing to tap while we're still getting the address / postcode (both free
		// text), or for a property we can't take on — don't show the service menu yet.
		if ( empty( $s['postcode'] ) || ! empty( $s['outsideUk'] ) ) {
			return array();
		}

		// 1) Which service? — labels straight from the editable menu, plus an advice path.
		if ( ! $chosen ) {
			$opts = array();
			foreach ( $services as $svc_row ) {
				$opts[] = $svc_row['label'];
			}
			$opts[] = 'I\'m not sure — I need advice';
			return array_slice( $opts, 0, 9 );
		}

		if ( ! $has_priced ) {
			return array(); // priced-on-request only (e.g. new dwelling) → Archie hands off, free text.
		}

		// 2) Light project-type context.
		if ( ! $has( 'projectType' ) || '' === $s['projectType'] ) {
			return array( 'Rear or side extension', 'Loft or mansard conversion', 'Garage conversion', 'Garden room / outbuilding', 'Internal alterations', 'Something else' );
		}
		// 3) Add-ons.
		if ( $has_planning && ! $has( 'submitApp' ) ) {
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
	 * Pull a valid UK postcode out of a free-text address (or a bare postcode),
	 * normalised to upper case with a single space. Returns '' if none is found —
	 * which is how we know we still need to ask for it.
	 */
	public static function extract_uk_postcode( $text ) {
		$text = strtoupper( trim( (string) $text ) );
		if ( preg_match( '/\b([A-Z]{1,2}[0-9][A-Z0-9]?)\s*([0-9][A-Z]{2})\b/', $text, $m ) ) {
			return $m[1] . ' ' . $m[2];
		}
		return '';
	}

	/** Address lookup (London/M25, listed, conservation) → drives smarter follow-ups. */
	private static function apply_address_lookup( array &$state, $postcode ) {
		$he = YAA_Historic_England::check( (string) $postcode );
		$state['london']       = ! empty( $he['london'] );
		$state['listed']       = ! empty( $he['listed'] );
		$state['conservation'] = ! empty( $he['conservation'] );
	}

	/** True once the client has uploaded at least one file against this project. */
	private static function has_client_upload( $project_id ) {
		if ( ! class_exists( 'YAA_Files' ) ) {
			return false;
		}
		$files = YAA_Files::for_project( $project_id, 'client' );
		return ! empty( $files );
	}

	/**
	 * A contextual placeholder for the answer box that reiterates what we're asking
	 * for right now, so the field itself guides the person (an "address box", an
	 * "email box", etc.). Mirrors the flow order in suggested_options().
	 */
	public static function input_hint( array $s, $done = false ) {
		if ( $done ) {
			return __( 'That\'s everything — thank you.', 'your-architect-archie' );
		}
		if ( ! empty( $s['outsideUk'] ) ) {
			return __( 'Type your message…', 'your-architect-archie' );
		}
		if ( empty( $s['address'] ) && empty( $s['postcode'] ) ) {
			return __( 'Property address…', 'your-architect-archie' );
		}
		if ( empty( $s['postcode'] ) ) {
			return __( 'Postcode…', 'your-architect-archie' );
		}
		if ( ! empty( $s['email'] ) && empty( $s['name'] ) ) {
			return __( 'Your name…', 'your-architect-archie' );
		}
		if ( ! empty( $s['advice'] ) ) {
			return __( 'Your email address…', 'your-architect-archie' );
		}
		return __( 'Type your answer…', 'your-architect-archie' );
	}

	/**
	 * A deterministic next-question fallback, used only when the model returns a
	 * tool-only turn with no spoken text — so Archie never dead-ends on "thanks".
	 * Mirrors the flow order in input_hint()/suggested_options().
	 */
	public static function next_prompt( array $s, $done = false ) {
		if ( $done ) {
			return __( 'Thanks — that\'s everything I need. I\'m emailing a copy of your fixed-price quote over now, and our team will review it and be in touch to confirm the details.', 'your-architect-archie' );
		}
		if ( ! empty( $s['outsideUk'] ) ) {
			return __( 'I\'m sorry — Your Architect only works on properties in the UK, so we\'re not able to help with this one. I\'d recommend speaking to a local architect.', 'your-architect-archie' );
		}
		if ( empty( $s['address'] ) && empty( $s['postcode'] ) ) {
			return __( 'To start, what\'s the address of the property?', 'your-architect-archie' );
		}
		if ( empty( $s['postcode'] ) ) {
			return __( 'Thanks — and what\'s the postcode of the property? I need it to make sure we can help and to build your quote accurately.', 'your-architect-archie' );
		}
		if ( ! self::chosen_services( $s ) && empty( $s['advice'] ) ) {
			return __( 'Great — which of these best matches what you need? Tap one below, or if you\'re not sure, tap “I\'m not sure — I need advice”.', 'your-architect-archie' );
		}
		return __( 'Got it — thanks.', 'your-architect-archie' );
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

		$chosen    = self::chosen_services( $s );
		$labels    = array();
		$has_planning = in_array( 'planning', $chosen, true );
		$is_priced = false;
		foreach ( $chosen as $k ) {
			if ( isset( $services[ $k ] ) ) {
				$labels[] = $services[ $k ]['label'];
				if ( empty( $services[ $k ]['redirect'] ) && null !== $services[ $k ]['price'] && '' !== $services[ $k ]['price'] ) {
					$is_priced = true;
				}
			}
		}
		$yn        = function ( $k ) use ( $s ) {
			return array( isset( $s[ $k ] ), ! empty( $s[ $k ] ) ? 'Yes' : 'No' );
		};

		// [ label, value|null, applies ]
		$rows = array();
		$addr = '';
		if ( ! empty( $s['address'] ) ) {
			$addr = (string) $s['address'];
			if ( ! empty( $s['postcode'] ) && false === stripos( $addr, (string) $s['postcode'] ) ) {
				$addr .= ', ' . $s['postcode'];
			}
		} elseif ( ! empty( $s['postcode'] ) ) {
			$addr = (string) $s['postcode'];
		}
		$rows[] = array( 'Property address', '' !== $addr ? $addr : null, true );
		$rows[] = array( ( count( $labels ) > 1 ? 'Services needed' : 'Service needed' ), $labels ? implode( ', ', $labels ) : null, true );
		$rows[] = array( 'What the work is', isset( $s['projectType'], $types[ $s['projectType'] ] ) ? $types[ $s['projectType'] ] : null, true );
		if ( isset( $s['projectType'] ) && 'extension' === $s['projectType'] ) {
			$rows[] = array( 'Storeys', isset( $s['storeys'], $storeys[ $s['storeys'] ] ) ? $storeys[ $s['storeys'] ] : null, true );
		}
		if ( $has_planning ) {
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
