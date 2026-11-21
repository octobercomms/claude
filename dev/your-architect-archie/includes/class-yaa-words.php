<?php
/**
 * Archie — Words & Voice. The studio-editable layer over Archie's wording.
 *
 * Archie's replies come from two places: a handful of SCRIPTED strings (the
 * greetings, the tappable answer buttons, a few fixed acknowledgements, the
 * finishing line) and the AI's LIVE phrasing of everything else. This class
 * exposes both levers to the studio without a code change:
 *
 *   - the scripted strings become editable fields (defaults below are the live
 *     wording, so nothing changes until an override is saved — a blank field
 *     always falls back to the default here);
 *   - a free-text "house voice" box is appended to the system prompt, so the
 *     studio can steer every AI-phrased reply (tone, standing rules) too.
 *
 * The tappable button labels live here as the SINGLE source of truth: both the
 * rendering (suggested_options) and the tap-matching (record_tap_answer) read
 * them from here, so editing a label can never desync the two.
 *
 * Overrides are stored in one option ('yaa_words'); get() merges them over the
 * defaults. Some lines support {tokens} (e.g. {advice}, {terms}, {privacy})
 * that are substituted at use so an edited label stays consistent everywhere.
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_Words {

	const OPTION = 'yaa_words';

	/**
	 * Every editable string, with the current live wording as its default.
	 * Keys are grouped by prefix: greet_*, line_*, snip_*, chip_*, plus `voice`.
	 */
	public static function defaults() {
		return array(
			// House voice — appended to every prompt. Empty by default.
			'voice' => '',

			// Greetings (the opener — no AI call).
			'greet_b' => "Hi — I'm Archie. I'll build your fixed price with you as we go. First, what's the address of the property?",
			'greet_a' => "Hi — I'm Archie. I'll build your fixed price with you. First, what's your email address?",

			// Scripted acknowledgements / prompts (no AI call on these turns).
			'line_ask_postcode'   => "Thanks — and what's the postcode of the property? I need it to make sure we can help and to build your quote accurately.",
			'line_after_postcode' => "Thanks — got that. Which of these best matches what you need? Tap one below, or tap \"{advice}\" if you're not sure.",
			'line_service_picked' => "Great — and to picture it: what is the work, roughly? For example a rear or side extension, a loft, a garage conversion, or something else.",
			'line_email_gate'     => "Before I can build your quote I just need the best email address to send it to — that's how our architects get back to you, and we'll only ever use it for your quote and project. What's the best address to use?",
			'line_finish_cta'     => "You're all set — just press the \"Save & submit project\" button to send everything to our team. Nothing goes to them until you do.",

			// Front-end submit step (rendered in the browser).
			'line_submit_ready' => "Your quote's ready. One last thing before I send it to our team — please confirm you're happy with our {terms} and {privacy}. Tap below and I'll submit your project — or you can keep asking me questions or add another service first.",
			'line_agree_btn'    => "I agree — submit my project",

			// Prompt guidance for special addresses (how Archie handles these, not a
			// verbatim line — the AI phrases it). Editable so the studio can tune it.
			'snip_listed'       => "This appears to be a LISTED BUILDING. Gently let them know (many owners do not realise): it means the building is legally protected for its special architectural or historic interest, so most changes need \"listed building consent\" as well as planning permission, and work has to be more sympathetic. Reassure them this is completely normal and we handle listed buildings routinely. Then ask what they are hoping to do. Never imply it is impossible, and never quote a number.",
			'snip_conservation' => "This appears to be in a CONSERVATION AREA. Explain simply: that is an area protected for its overall character, so the council applies stricter rules and some normal \"permitted development\" rights are removed (meaning more things need permission). Reassure them we deal with conservation areas all the time and it just shapes the design and paperwork. Never quote a number.",

			// Tappable answer buttons (single source of truth — see class docblock).
			'chip_advice'         => "I'm not sure — I need advice",
			'chip_projectType'    => "Rear or side extension\nLoft or mansard conversion\nGarage conversion\nGarden room / outbuilding\nInternal alterations\nSomething else",
			'chip_submitApp_yes'  => "Please submit & manage it for me",
			'chip_submitApp_no'   => "I'll submit it myself",
			'chip_concept_yes'    => "Yes, add a 3D visualisation",
			'chip_concept_no'     => "No thanks",
			'chip_concept_info'   => "What's that?",
			'chip_siteVisit_yes'  => "Yes, please visit",
			'chip_siteVisit_no'   => "No need",
			'chip_survey_yes'     => "Yes, I have plans drawn up",
			'chip_survey_no'      => "No — please help with a survey",
			'chip_survey_info'    => "What's a measured survey?",
			'chip_structural_yes' => "Yes",
			'chip_structural_no'  => "No / not sure",
			'chip_timeframe'      => "Next few weeks\nA few months\nJust planning ahead",
		);
	}

	/** All values, saved overrides merged over the defaults (blank override = default). */
	public static function all() {
		$saved = get_option( self::OPTION, array() );
		$saved = is_array( $saved ) ? $saved : array();
		$out   = self::defaults();
		foreach ( $saved as $k => $v ) {
			if ( array_key_exists( $k, $out ) && '' !== trim( (string) $v ) ) {
				$out[ $k ] = (string) $v;
			}
		}
		return $out;
	}

	/** One value (default if unset/blank). */
	public static function get( $key, $default = '' ) {
		$all = self::all();
		return array_key_exists( $key, $all ) ? $all[ $key ] : $default;
	}

	/** The studio's house-voice text (may be ''). */
	public static function voice() {
		return trim( (string) self::get( 'voice' ) );
	}

	/** The greeting for a variant ('A' = email-first, else B). */
	public static function greeting( $variant = 'B' ) {
		return self::get( 'A' === $variant ? 'greet_a' : 'greet_b' );
	}

	/** A single chip label. */
	public static function chip( $key ) {
		return self::get( 'chip_' . $key );
	}

	/** A multi-line chip field as a clean list of labels. */
	public static function chip_list( $key ) {
		$out = array();
		foreach ( preg_split( '/\r\n|\r|\n/', (string) self::get( 'chip_' . $key ) ) as $l ) {
			$l = trim( $l );
			if ( '' !== $l ) {
				$out[] = $l;
			}
		}
		return $out;
	}

	/**
	 * A scripted line with {tokens} substituted. Default token: {advice} → the
	 * advice chip label (so a renamed advice button stays consistent in prose).
	 * Callers may pass extra tokens (e.g. {terms}).
	 */
	public static function line( $key, $tokens = array() ) {
		$text = (string) self::get( $key );
		$map  = array_merge( array( '{advice}' => self::chip( 'advice' ) ), (array) $tokens );
		return strtr( $text, $map );
	}

	// ---- Admin ----

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ), 40 );
		add_action( 'admin_post_yaa_save_words', array( __CLASS__, 'save' ) );
	}

	public static function menu() {
		add_submenu_page(
			YAA_Projects_Admin::SLUG,
			__( 'Words & Voice', 'your-architect-archie' ),
			__( 'Words & Voice', 'your-architect-archie' ),
			'manage_options',
			'yaa-words',
			array( __CLASS__, 'render' )
		);
	}

	public static function save() {
		if ( ! current_user_can( 'manage_options' ) || ! check_admin_referer( 'yaa_save_words' ) ) {
			wp_die( 'Nope' );
		}
		$in  = isset( $_POST['w'] ) && is_array( $_POST['w'] ) ? wp_unslash( $_POST['w'] ) : array();
		$out = array();
		foreach ( array_keys( self::defaults() ) as $k ) {
			// Only store a non-blank override; blank clears it (back to the default).
			$v = isset( $in[ $k ] ) ? sanitize_textarea_field( (string) $in[ $k ] ) : '';
			if ( '' !== trim( $v ) ) {
				$out[ $k ] = $v;
			}
		}
		update_option( self::OPTION, $out, false );
		wp_safe_redirect( add_query_arg( array( 'page' => 'yaa-words', 'updated' => '1' ), admin_url( 'admin.php' ) ) );
		exit;
	}

	/** One labelled textarea row on the settings form. */
	private static function field_row( $all, $key, $label, $help = '', $rows = 2 ) {
		$val = isset( $all[ $key ] ) ? $all[ $key ] : '';
		echo '<tr><th style="vertical-align:top"><label for="w_' . esc_attr( $key ) . '">' . esc_html( $label ) . '</label></th><td>';
		echo '<textarea id="w_' . esc_attr( $key ) . '" name="w[' . esc_attr( $key ) . ']" rows="' . (int) $rows . '" class="large-text" style="font-family:inherit">' . esc_textarea( $val ) . '</textarea>';
		if ( $help ) {
			echo '<p class="description">' . wp_kses_post( $help ) . '</p>';
		}
		echo '</td></tr>';
	}

	public static function render() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$all  = self::all();
		$post = admin_url( 'admin-post.php' );
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Archie — Words & Voice', 'your-architect-archie' ); ?></h1>
			<p class="description" style="max-width:880px">
				<?php esc_html_e( 'Edit what Archie says. Leave any field blank to use the built-in default. Two kinds of wording live here:', 'your-architect-archie' ); ?>
			</p>
			<ul style="max-width:880px;list-style:disc;margin-left:20px">
				<li><?php echo wp_kses_post( __( '<strong>Scripted lines & buttons</strong> — exact text Archie uses as-is (greetings, the tappable answer buttons, fixed acknowledgements, the finishing line). What you type is what shows.', 'your-architect-archie' ) ); ?></li>
				<li><?php echo wp_kses_post( __( '<strong>House voice</strong> — standing rules the AI follows when it phrases everything else. This steers tone across every reply; it is guidance, not a script.', 'your-architect-archie' ) ); ?></li>
			</ul>
			<?php if ( ! empty( $_GET['updated'] ) ) : ?>
				<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Saved.', 'your-architect-archie' ); ?></p></div>
			<?php endif; ?>

			<form method="post" action="<?php echo esc_url( $post ); ?>">
				<input type="hidden" name="action" value="yaa_save_words">
				<?php wp_nonce_field( 'yaa_save_words' ); ?>

				<h2><?php esc_html_e( 'House voice (steers every AI reply)', 'your-architect-archie' ); ?></h2>
				<table class="form-table"><tbody>
				<?php
				self::field_row( $all, 'voice', __( 'House voice / standing rules', 'your-architect-archie' ),
					__( 'Free text, added to every prompt. Examples: “Be concise — one or two sentences.” · “Always British English.” · “Never promise a planning outcome.” · “Warm but not gushing.” Leave blank for none.', 'your-architect-archie' ), 5 );
				?>
				</tbody></table>

				<h2><?php esc_html_e( 'Greetings', 'your-architect-archie' ); ?></h2>
				<table class="form-table"><tbody>
				<?php
				self::field_row( $all, 'greet_b', __( 'Opening message (normal)', 'your-architect-archie' ), __( 'The first thing Archie says. Asks for the address.', 'your-architect-archie' ) );
				self::field_row( $all, 'greet_a', __( 'Opening message (email-first A/B variant)', 'your-architect-archie' ), __( 'Shown only to the email-first test group. Asks for the email first.', 'your-architect-archie' ) );
				?>
				</tbody></table>

				<h2><?php esc_html_e( 'Scripted lines', 'your-architect-archie' ); ?></h2>
				<table class="form-table"><tbody>
				<?php
				self::field_row( $all, 'line_ask_postcode', __( 'Asking for the postcode', 'your-architect-archie' ) );
				self::field_row( $all, 'line_after_postcode', __( 'After the postcode (asking which service)', 'your-architect-archie' ), __( '<code>{advice}</code> is replaced with the advice button’s label.', 'your-architect-archie' ) );
				self::field_row( $all, 'line_service_picked', __( 'After a service is chosen (asking what the work is)', 'your-architect-archie' ) );
				self::field_row( $all, 'line_email_gate', __( 'Email-first re-ask (A/B variant, when they haven’t given an email yet)', 'your-architect-archie' ) );
				self::field_row( $all, 'line_finish_cta', __( 'Finishing nudge (press Save & submit)', 'your-architect-archie' ) );
				self::field_row( $all, 'line_submit_ready', __( 'Quote-ready message (before the consent buttons)', 'your-architect-archie' ), __( '<code>{terms}</code> and <code>{privacy}</code> become links to your Terms and Privacy pages.', 'your-architect-archie' ), 3 );
				self::field_row( $all, 'line_agree_btn', __( '“Agree & submit” button label', 'your-architect-archie' ), '', 1 );
				?>
				</tbody></table>

				<h2><?php esc_html_e( 'Tappable answer buttons', 'your-architect-archie' ); ?></h2>
				<p class="description" style="max-width:880px"><?php esc_html_e( 'The quick-reply buttons under the chat. Multi-line boxes: one button per line. These are matched exactly to record the answer, so editing here keeps the buttons and the logic in step. (The service buttons themselves come from Pricing & Services.)', 'your-architect-archie' ); ?></p>
				<table class="form-table"><tbody>
				<?php
				self::field_row( $all, 'chip_advice', __( 'Advice option (“I’m not sure”)', 'your-architect-archie' ), '', 1 );
				self::field_row( $all, 'chip_projectType', __( 'What the work is (one per line)', 'your-architect-archie' ), __( 'The last line is treated as the “something else” catch-all.', 'your-architect-archie' ), 6 );
				self::field_row( $all, 'chip_submitApp_yes', __( 'Submit & manage — yes', 'your-architect-archie' ), '', 1 );
				self::field_row( $all, 'chip_submitApp_no', __( 'Submit & manage — no', 'your-architect-archie' ), '', 1 );
				self::field_row( $all, 'chip_concept_yes', __( '3D visualisation — yes', 'your-architect-archie' ), '', 1 );
				self::field_row( $all, 'chip_concept_no', __( '3D visualisation — no', 'your-architect-archie' ), '', 1 );
				self::field_row( $all, 'chip_concept_info', __( '3D visualisation — “what’s that?”', 'your-architect-archie' ), '', 1 );
				self::field_row( $all, 'chip_siteVisit_yes', __( 'Site visit — yes', 'your-architect-archie' ), '', 1 );
				self::field_row( $all, 'chip_siteVisit_no', __( 'Site visit — no', 'your-architect-archie' ), '', 1 );
				self::field_row( $all, 'chip_survey_yes', __( 'Existing plans — yes', 'your-architect-archie' ), '', 1 );
				self::field_row( $all, 'chip_survey_no', __( 'Existing plans — no (needs survey)', 'your-architect-archie' ), '', 1 );
				self::field_row( $all, 'chip_survey_info', __( 'Existing plans — “what’s a survey?”', 'your-architect-archie' ), '', 1 );
				self::field_row( $all, 'chip_structural_yes', __( 'Structural changes — yes', 'your-architect-archie' ), '', 1 );
				self::field_row( $all, 'chip_structural_no', __( 'Structural changes — no', 'your-architect-archie' ), '', 1 );
				self::field_row( $all, 'chip_timeframe', __( 'Timeframe options (one per line)', 'your-architect-archie' ), '', 4 );
				?>
				</tbody></table>

				<h2><?php esc_html_e( 'Special-property guidance (how Archie handles these)', 'your-architect-archie' ); ?></h2>
				<p class="description" style="max-width:880px"><?php esc_html_e( 'Guidance the AI follows when an address lookup flags a listed building or conservation area — it phrases the reply itself. The “no survey” and “unsure about structural” reassurance lines are on the Pricing & Services page.', 'your-architect-archie' ); ?></p>
				<table class="form-table"><tbody>
				<?php
				self::field_row( $all, 'snip_listed', __( 'Listed building', 'your-architect-archie' ), '', 4 );
				self::field_row( $all, 'snip_conservation', __( 'Conservation area', 'your-architect-archie' ), '', 4 );
				?>
				</tbody></table>

				<?php submit_button( __( 'Save wording', 'your-architect-archie' ) ); ?>
			</form>

			<hr>
			<h2><?php esc_html_e( 'What Archie asks, in order', 'your-architect-archie' ); ?></h2>
			<p class="description" style="max-width:880px"><?php esc_html_e( 'The flow, so you can see the whole conversation at a glance. Steps marked “AI” are phrased live by the model (steer them with House voice above); the rest use the scripted lines you can edit.', 'your-architect-archie' ); ?></p>
			<ol style="max-width:880px;line-height:1.7">
				<li><?php echo wp_kses_post( __( '<strong>Greeting</strong> — scripted. Asks for the property address (or, in the A/B variant, the email first).', 'your-architect-archie' ) ); ?></li>
				<li><?php echo wp_kses_post( __( '<strong>Postcode</strong> — scripted, if not already given.', 'your-architect-archie' ) ); ?></li>
				<li><?php echo wp_kses_post( __( '<strong>Which service</strong> — scripted prompt + the service buttons (from Pricing &amp; Services) and the advice option. If they pick advice, the AI asks a couple of questions and recommends a service.', 'your-architect-archie' ) ); ?></li>
				<li><?php echo wp_kses_post( __( '<strong>What the work is</strong> — scripted prompt + the “what the work is” buttons.', 'your-architect-archie' ) ); ?></li>
				<li><?php echo wp_kses_post( __( '<strong>Add-ons</strong> — AI, with buttons: submit &amp; manage the application (planning only), 3D visualisation, and a site visit (London / M25 only).', 'your-architect-archie' ) ); ?></li>
				<li><?php echo wp_kses_post( __( '<strong>Existing plans / survey</strong> — AI, with buttons. If none, reassures about arranging a survey (line on the Pricing page).', 'your-architect-archie' ) ); ?></li>
				<li><?php echo wp_kses_post( __( '<strong>Structural changes</strong> — AI, with Yes / No buttons.', 'your-architect-archie' ) ); ?></li>
				<li><?php echo wp_kses_post( __( '<strong>Timeframe</strong> — AI, with buttons.', 'your-architect-archie' ) ); ?></li>
				<li><?php echo wp_kses_post( __( '<strong>Name</strong>, then <strong>email</strong> — AI, asked one at a time (free text).', 'your-architect-archie' ) ); ?></li>
				<li><?php echo wp_kses_post( __( '<strong>Phone</strong> — AI, optional (they can decline).', 'your-architect-archie' ) ); ?></li>
				<li><?php echo wp_kses_post( __( '<strong>Finish</strong> — the quote-ready message and the finishing nudge (both scripted above), then they press Save &amp; submit.', 'your-architect-archie' ) ); ?></li>
			</ol>
		</div>
		<?php
	}
}
