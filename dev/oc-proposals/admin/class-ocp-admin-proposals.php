<?php
/**
 * Proposals admin — list, and a stepped wizard (details → content → proof →
 * pricing → publish) that builds a proposal from the library plus a little
 * per-client writing. Each step saves and advances.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCP_Admin_Proposals {

	const PAGE = 'oc-proposals-list';
	const CAP  = 'manage_options';

	/** Wizard steps in order. */
	public static function steps() {
		return array(
			'details' => __( 'Details', 'oc-proposals' ),
			'content' => __( 'Content', 'oc-proposals' ),
			'proof'   => __( 'Proof', 'oc-proposals' ),
			'pricing' => __( 'Pricing', 'oc-proposals' ),
			'publish' => __( 'Review & publish', 'oc-proposals' ),
		);
	}

	public static function init() {
		add_action( 'admin_post_ocp_new_proposal', array( __CLASS__, 'create' ) );
		add_action( 'admin_post_ocp_save_step', array( __CLASS__, 'save_step' ) );
		add_action( 'admin_post_ocp_delete_proposal', array( __CLASS__, 'delete' ) );
		add_action( 'admin_post_ocp_mark_sent', array( __CLASS__, 'mark_sent' ) );
		add_action( 'admin_post_ocp_ai_assist', array( __CLASS__, 'ai_assist' ) );
		add_action( 'wp_ajax_ocp_content_chat', array( __CLASS__, 'content_chat' ) );
		add_action( 'wp_ajax_ocp_content_generate', array( __CLASS__, 'content_generate' ) );
	}

	public static function render() {
		$action = isset( $_GET['action'] ) ? sanitize_key( wp_unslash( $_GET['action'] ) ) : 'list'; // phpcs:ignore WordPress.Security.NonceVerification
		echo '<div class="wrap ocp-wrap">';
		if ( 'edit' === $action ) {
			self::render_wizard();
		} else {
			self::render_list();
		}
		echo '</div>';
	}

	// --- List ----------------------------------------------------------------

	private static function render_list() {
		echo '<h1 class="ocp-h1">' . esc_html__( 'Proposals', 'oc-proposals' ) . '</h1>';

		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" style="margin:12px 0">';
		echo '<input type="hidden" name="action" value="ocp_new_proposal" />';
		wp_nonce_field( 'ocp_new_proposal' );
		echo '<select name="type">';
		foreach ( OCP_Types::all() as $k => $t ) {
			printf( '<option value="%s">%s</option>', esc_attr( $k ), esc_html( $t['label'] ) );
		}
		echo '</select> ';
		echo '<input type="text" name="client_name" placeholder="' . esc_attr__( 'Client name', 'oc-proposals' ) . '" required /> ';
		submit_button( __( 'New proposal', 'oc-proposals' ), 'primary', 'submit', false );
		echo '</form>';

		$rows = OCP_Proposal::all();
		echo '<table class="widefat striped"><thead><tr>';
		echo '<th>' . esc_html__( 'Client', 'oc-proposals' ) . '</th><th>' . esc_html__( 'Type', 'oc-proposals' ) . '</th><th>' . esc_html__( 'Status', 'oc-proposals' ) . '</th><th>' . esc_html__( 'Updated', 'oc-proposals' ) . '</th><th></th></tr></thead><tbody>';
		if ( ! $rows ) {
			echo '<tr><td colspan="5">' . esc_html__( 'No proposals yet.', 'oc-proposals' ) . '</td></tr>';
		}
		foreach ( (array) $rows as $p ) {
			$edit = add_query_arg( array( 'page' => self::PAGE, 'action' => 'edit', 'id' => $p['id'], 'step' => 'details' ), admin_url( 'admin.php' ) );
			$del  = wp_nonce_url( add_query_arg( array( 'action' => 'ocp_delete_proposal', 'id' => $p['id'] ), admin_url( 'admin-post.php' ) ), 'ocp_delete_proposal_' . $p['id'] );
			echo '<tr>';
			echo '<td><strong>' . esc_html( $p['client_name'] ) . '</strong></td>';
			echo '<td>' . esc_html( OCP_Types::label( $p['type'] ) ) . '</td>';
			echo '<td><span class="ocp-chip">' . esc_html( OCP_Proposal::status_label( $p['status'] ) ) . '</span></td>';
			echo '<td>' . esc_html( $p['updated_at'] ) . '</td>';
			printf(
				'<td><a href="%s">%s</a> &nbsp;|&nbsp; <a href="%s" onclick="return confirm(\'%s\')">%s</a></td>',
				esc_url( $edit ), esc_html__( 'Edit', 'oc-proposals' ),
				esc_url( $del ), esc_js( __( 'Delete this proposal?', 'oc-proposals' ) ), esc_html__( 'Delete', 'oc-proposals' )
			);
			echo '</tr>';
		}
		echo '</tbody></table>';
	}

	// --- Wizard --------------------------------------------------------------

	private static function current_id() {
		return isset( $_GET['id'] ) ? (int) $_GET['id'] : 0; // phpcs:ignore WordPress.Security.NonceVerification
	}

	private static function current_step() {
		$step  = isset( $_GET['step'] ) ? sanitize_key( wp_unslash( $_GET['step'] ) ) : 'details'; // phpcs:ignore WordPress.Security.NonceVerification
		$steps = self::steps();
		return isset( $steps[ $step ] ) ? $step : 'details';
	}

	private static function render_wizard() {
		$id = self::current_id();
		$p  = OCP_Proposal::get( $id );
		if ( ! $p ) {
			echo '<p>' . esc_html__( 'Proposal not found.', 'oc-proposals' ) . '</p>';
			return;
		}
		$step = self::current_step();

		echo '<h1 class="ocp-h1">' . esc_html( $p['client_name'] ?: __( 'Proposal', 'oc-proposals' ) ) . '</h1>';

		// Step nav.
		echo '<h2 class="nav-tab-wrapper">';
		foreach ( self::steps() as $k => $label ) {
			$url = add_query_arg( array( 'page' => self::PAGE, 'action' => 'edit', 'id' => $id, 'step' => $k ), admin_url( 'admin.php' ) );
			printf( '<a href="%s" class="nav-tab %s">%s</a>', esc_url( $url ), $k === $step ? 'nav-tab-active' : '', esc_html( $label ) );
		}
		echo '</h2>';

		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" style="max-width:860px;margin-top:16px">';
		echo '<input type="hidden" name="action" value="ocp_save_step" />';
		echo '<input type="hidden" name="id" value="' . esc_attr( $id ) . '" />';
		echo '<input type="hidden" name="step" value="' . esc_attr( $step ) . '" />';
		wp_nonce_field( 'ocp_save_step' );

		$method = 'step_' . $step;
		self::$method( $p );

		submit_button( __( 'Save & continue', 'oc-proposals' ) );
		echo '</form>';
	}

	private static function step_details( $p ) {
		echo '<table class="form-table" role="presentation">';
		self::text( 'client_name', __( 'Client name', 'oc-proposals' ), $p['client_name'] );
		self::text( 'title', __( 'Proposal title', 'oc-proposals' ), $p['title'] );

		echo '<tr><th>' . esc_html__( 'Type', 'oc-proposals' ) . '</th><td><select name="type">';
		foreach ( OCP_Types::all() as $k => $t ) {
			printf( '<option value="%s"%s>%s</option>', esc_attr( $k ), selected( $p['type'], $k, false ), esc_html( $t['label'] ) );
		}
		echo '</select></td></tr>';

		echo '<tr><th>' . esc_html__( 'Region', 'oc-proposals' ) . '</th><td><select name="region">';
		foreach ( array( 'global' => __( 'Global (A4, GBP)', 'oc-proposals' ), 'us' => __( 'US (Letter, USD)', 'oc-proposals' ) ) as $k => $label ) {
			printf( '<option value="%s"%s>%s</option>', esc_attr( $k ), selected( $p['region'], $k, false ), esc_html( $label ) );
		}
		echo '</select><p class="description">' . esc_html__( 'US sets USD + US Letter; VAT is handled silently.', 'oc-proposals' ) . '</p></td></tr>';

		self::text( 'sector', __( 'Client sector (drives proof filtering)', 'oc-proposals' ), $p['sector'] );
		self::text( 'website_url', __( 'Client website URL', 'oc-proposals' ), $p['website_url'], 'url' );
		self::text( 'website_image', __( 'Client website image URL (so they see themselves)', 'oc-proposals' ), $p['website_image'], 'url' );
		echo '</table>';
	}

	private static function step_content( $p ) {
		$sit      = OCP_Proposal::get_section( $p['id'], 'situation' );
		$obj      = OCP_Proposal::get_section( $p['id'], 'objectives' );
		$material = OCP_Proposal::get_section( $p['id'], 'source_material' );
		$chat     = OCP_Proposal::get_section( $p['id'], 'discovery' );
		$history  = $chat && $chat['body'] ? json_decode( $chat['body'], true ) : array();

		if ( ! OCP_Claude::enabled() ) {
			echo '<div class="notice notice-warning inline"><p>' . esc_html__( 'Add a Claude API key in Settings to use the discovery chat. You can still write the sections by hand below.', 'oc-proposals' ) . '</p></div>';
		}

		echo '<p class="description">' . esc_html__( 'Paste the call transcript or the client’s email, then talk it through with Claude. When you’re happy, draft the proposal content — it fills the two sections below, which you can edit before saving.', 'oc-proposals' ) . '</p>';

		// Source material (saved with the step).
		echo '<p><label><strong>' . esc_html__( 'Call transcript / client email', 'oc-proposals' ) . '</strong>';
		echo '<textarea name="source_material" id="ocp-source" rows="6" class="large-text" placeholder="' . esc_attr__( 'Paste the transcript or email here…', 'oc-proposals' ) . '">' . esc_textarea( $material['body'] ?? '' ) . '</textarea></label></p>';

		// Chat panel (AJAX; outside the form submit).
		echo '<div id="ocp-chat" class="ocp-chat"'
			. ' data-id="' . esc_attr( $p['id'] ) . '"'
			. ' data-ajax="' . esc_url( admin_url( 'admin-ajax.php' ) ) . '"'
			. ' data-nonce="' . esc_attr( wp_create_nonce( 'ocp_content_chat' ) ) . '">';
		echo '<div class="ocp-chat-thread" id="ocp-chat-thread">';
		foreach ( (array) $history as $turn ) {
			$role = ( 'user' === ( $turn['role'] ?? '' ) ) ? 'me' : 'claude';
			echo '<div class="ocp-msg ocp-msg--' . esc_attr( $role ) . '">' . wp_kses_post( wpautop( (string) ( $turn['content'] ?? '' ) ) ) . '</div>';
		}
		echo '</div>';
		echo '<div class="ocp-chat-input"><textarea id="ocp-chat-text" rows="2" class="large-text" placeholder="' . esc_attr__( 'Discuss with Claude… (e.g. “draft the situation focusing on their rebrand”)', 'oc-proposals' ) . '"></textarea>';
		echo '<div class="ocp-chat-actions"><button type="button" class="button button-primary" id="ocp-chat-send">' . esc_html__( 'Send', 'oc-proposals' ) . '</button>';
		echo '<button type="button" class="button" id="ocp-chat-generate">' . esc_html__( 'Draft Situation & Objectives →', 'oc-proposals' ) . '</button>';
		echo '<span class="spinner" id="ocp-chat-spin"></span></div></div>';
		echo '</div>';

		// The two written sections — populated by the chat, still editable.
		echo '<table class="form-table" role="presentation">';
		echo '<tr><th>' . esc_html__( 'Your situation', 'oc-proposals' ) . '</th><td><textarea name="situation" id="ocp-situation" rows="6" class="large-text">' . esc_textarea( $sit['body'] ?? '' ) . '</textarea></td></tr>';
		echo '<tr><th>' . esc_html__( 'Objectives & strategy', 'oc-proposals' ) . '</th><td><textarea name="objectives" id="ocp-objectives" rows="6" class="large-text">' . esc_textarea( $obj['body'] ?? '' ) . '</textarea></td></tr>';
		echo '</table>';

		// Optional one-click diagnostics snapshot into the situation.
		if ( OCP_Diagnostics::enabled() ) {
			echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" style="display:inline-block;margin:0 8px 8px 0">';
			echo '<input type="hidden" name="action" value="ocp_ai_assist" /><input type="hidden" name="id" value="' . esc_attr( $p['id'] ) . '" /><input type="hidden" name="do" value="diagnostics" />';
			wp_nonce_field( 'ocp_ai_assist' );
			echo '<button class="button" title="' . esc_attr__( 'Uses DataForSEO + the client website URL.', 'oc-proposals' ) . '">' . esc_html__( 'Add current-state SEO snapshot', 'oc-proposals' ) . '</button></form>';
		}
	}

	private static function step_proof( $p ) {
		$chosen = OCP_Proposal::section_ref_ids( $p['id'], 'proof' );
		$suggested = wp_list_pluck( OCP_Library::case_studies_for_sector( $p['sector'], 3 ), 'id' );
		echo '<p class="description">' . sprintf(
			/* translators: %s sector */
			esc_html__( 'Case studies tagged for “%s” are pre-ticked. Untick/add as needed.', 'oc-proposals' ),
			esc_html( $p['sector'] ?: __( 'any sector', 'oc-proposals' ) )
		) . '</p>';
		$all = OCP_Repo::all( OCP_DB::case_studies_table(), 'id DESC' );
		if ( ! $all ) {
			echo '<p>' . esc_html__( 'No case studies in the library yet — add some under Library.', 'oc-proposals' ) . '</p>';
			return;
		}
		echo '<ul style="list-style:none;margin:0">';
		foreach ( $all as $cs ) {
			$checked = ( in_array( (int) $cs['id'], $chosen, true ) || ( ! $chosen && in_array( (int) $cs['id'], $suggested, true ) ) );
			printf(
				'<li><label><input type="checkbox" name="proof_ids[]" value="%d" %s /> <strong>%s</strong> <span class="ocp-muted">%s</span></label></li>',
				(int) $cs['id'], checked( $checked, true, false ),
				esc_html( $cs['title'] ), esc_html( $cs['sector'] )
			);
		}
		echo '</ul>';
	}

	private static function step_pricing( $p ) {
		$items = OCP_Proposal::items( $p['id'] );
		if ( ! $items ) {
			$items = array( array( 'cadence' => 'oneoff', 'stage' => '', 'label' => '', 'qty' => 1, 'unit_amount' => '', 'hours' => '' ) );
		}
		echo '<p class="description">' . esc_html__( 'Line items grouped by cadence. Totals compute automatically; currency follows the proposal. Add a row by filling the blank line.', 'oc-proposals' ) . '</p>';
		echo '<table class="widefat" id="ocp-pricing"><thead><tr>';
		echo '<th>' . esc_html__( 'Cadence', 'oc-proposals' ) . '</th><th>' . esc_html__( 'Stage', 'oc-proposals' ) . '</th><th>' . esc_html__( 'Label', 'oc-proposals' ) . '</th><th>' . esc_html__( 'Qty', 'oc-proposals' ) . '</th><th>' . esc_html__( 'Unit amount', 'oc-proposals' ) . '</th><th>' . esc_html__( 'Hours', 'oc-proposals' ) . '</th></tr></thead><tbody>';

		// Render existing + one spare blank row.
		$rows = array_merge( $items, array( array( 'cadence' => 'oneoff', 'stage' => '', 'label' => '', 'qty' => 1, 'unit_amount' => '', 'hours' => '' ) ) );
		foreach ( $rows as $i => $it ) {
			echo '<tr>';
			echo '<td><select name="item_cadence[]">';
			foreach ( OCP_Types::cadences() as $ck => $cl ) {
				printf( '<option value="%s"%s>%s</option>', esc_attr( $ck ), selected( $it['cadence'] ?? '', $ck, false ), esc_html( $cl ) );
			}
			echo '</select></td>';
			printf( '<td><input type="number" name="item_stage[]" value="%s" style="width:60px" min="1" max="5" /></td>', esc_attr( (string) ( $it['stage'] ?? '' ) ) );
			printf( '<td><input type="text" name="item_label[]" value="%s" class="regular-text" /></td>', esc_attr( (string) ( $it['label'] ?? '' ) ) );
			printf( '<td><input type="number" step="0.01" name="item_qty[]" value="%s" style="width:70px" /></td>', esc_attr( (string) ( $it['qty'] ?? 1 ) ) );
			printf( '<td><input type="number" step="0.01" name="item_amount[]" value="%s" style="width:110px" /></td>', esc_attr( (string) ( $it['unit_amount'] ?? '' ) ) );
			printf( '<td><input type="number" step="0.25" name="item_hours[]" value="%s" style="width:80px" /></td>', esc_attr( (string) ( $it['hours'] ?? '' ) ) );
			echo '</tr>';
		}
		echo '</tbody></table>';

		// Live totals (server-rendered snapshot).
		$t = OCP_Proposal::totals( $p['id'] );
		echo '<p style="margin-top:12px">';
		foreach ( OCP_Types::cadences() as $ck => $cl ) {
			if ( ! empty( $t['by_cadence'][ $ck ] ) ) {
				echo '<strong>' . esc_html( $cl ) . ':</strong> ' . esc_html( OCP_Proposal::money( $t['by_cadence'][ $ck ], $t['currency'] ) ) . ' &nbsp; ';
			}
		}
		echo '</p>';
	}

	private static function step_publish( $p ) {
		$t   = OCP_Proposal::totals( $p['id'] );
		$url = OCP_Proposal::url( $p['token'] );
		echo '<table class="form-table" role="presentation">';
		echo '<tr><th>' . esc_html__( 'Status', 'oc-proposals' ) . '</th><td><span class="ocp-chip">' . esc_html( OCP_Proposal::status_label( $p['status'] ) ) . '</span></td></tr>';
		echo '<tr><th>' . esc_html__( 'Private link', 'oc-proposals' ) . '</th><td><a href="' . esc_url( $url ) . '" target="_blank" rel="noopener"><code>' . esc_html( $url ) . '</code></a></td></tr>';
		$pdf_ready = class_exists( 'OCP_PDF' ) && OCP_PDF::available();
		echo '<tr><th>' . esc_html__( 'PDF', 'oc-proposals' ) . '</th><td>';
		if ( $pdf_ready ) {
			echo '<a class="button" href="' . esc_url( OCP_PDF::url( $p['token'] ) ) . '" target="_blank" rel="noopener">' . esc_html__( 'Open PDF (landscape)', 'oc-proposals' ) . '</a>';
		} else {
			echo '<span class="ocp-muted">' . esc_html__( 'Run composer install (or use the release zip) to enable PDF.', 'oc-proposals' ) . '</span>';
		}
		echo '</td></tr>';
		echo '<tr><th>' . esc_html__( 'Pricing', 'oc-proposals' ) . '</th><td>';
		foreach ( OCP_Types::cadences() as $ck => $cl ) {
			if ( ! empty( $t['by_cadence'][ $ck ] ) ) {
				echo esc_html( $cl . ': ' . OCP_Proposal::money( $t['by_cadence'][ $ck ], $t['currency'] ) ) . '<br />';
			}
		}
		echo '</td></tr>';
		echo '<tr><th>' . esc_html__( 'Expiry', 'oc-proposals' ) . '</th><td><input type="date" name="expires_at" value="' . esc_attr( $p['expires_at'] ? substr( $p['expires_at'], 0, 10 ) : '' ) . '" /></td></tr>';
		echo '</table>';

		$sent = wp_nonce_url( add_query_arg( array( 'action' => 'ocp_mark_sent', 'id' => $p['id'] ), admin_url( 'admin-post.php' ) ), 'ocp_mark_sent_' . $p['id'] );
		echo '<p><a class="ocp-btn" href="' . esc_url( $sent ) . '">' . esc_html__( 'Mark as sent', 'oc-proposals' ) . '</a></p>';
	}

	private static function text( $name, $label, $val, $type = 'text' ) {
		printf(
			'<tr><th scope="row"><label for="p_%1$s">%2$s</label></th><td><input type="%3$s" id="p_%1$s" name="%1$s" value="%4$s" class="regular-text" /></td></tr>',
			esc_attr( $name ), esc_html( $label ), esc_attr( $type ), esc_attr( (string) $val )
		);
	}

	// --- Handlers ------------------------------------------------------------

	public static function create() {
		self::guard( 'ocp_new_proposal' );
		$id = OCP_Proposal::create( array(
			'type'        => sanitize_key( wp_unslash( $_POST['type'] ?? 'retainer' ) ),
			'client_name' => sanitize_text_field( wp_unslash( $_POST['client_name'] ?? '' ) ),
		) );
		self::redirect_step( $id, 'details' );
	}

	public static function save_step() {
		self::guard( 'ocp_save_step' );
		$id   = (int) ( $_POST['id'] ?? 0 );
		$step = sanitize_key( wp_unslash( $_POST['step'] ?? 'details' ) );

		switch ( $step ) {
			case 'details':
				OCP_Proposal::update( $id, array(
					'client_name'   => sanitize_text_field( wp_unslash( $_POST['client_name'] ?? '' ) ),
					'title'         => sanitize_text_field( wp_unslash( $_POST['title'] ?? '' ) ),
					'type'          => sanitize_key( wp_unslash( $_POST['type'] ?? 'retainer' ) ),
					'region'        => sanitize_key( wp_unslash( $_POST['region'] ?? 'global' ) ),
					'sector'        => sanitize_text_field( wp_unslash( $_POST['sector'] ?? '' ) ),
					'website_url'   => esc_url_raw( wp_unslash( $_POST['website_url'] ?? '' ) ),
					'website_image' => esc_url_raw( wp_unslash( $_POST['website_image'] ?? '' ) ),
				) );
				break;

			case 'content':
				OCP_Proposal::set_section( $id, 'situation', array( 'body' => wp_kses_post( wp_unslash( $_POST['situation'] ?? '' ) ) ) );
				OCP_Proposal::set_section( $id, 'objectives', array( 'body' => wp_kses_post( wp_unslash( $_POST['objectives'] ?? '' ) ) ) );
				if ( isset( $_POST['source_material'] ) ) {
					OCP_Proposal::set_section( $id, 'source_material', array( 'body' => sanitize_textarea_field( wp_unslash( $_POST['source_material'] ) ) ) );
				}
				break;

			case 'proof':
				$ids = array_map( 'intval', (array) ( $_POST['proof_ids'] ?? array() ) );
				OCP_Proposal::set_section( $id, 'proof', array( 'ref_ids' => implode( ',', $ids ) ) );
				break;

			case 'pricing':
				self::save_pricing( $id );
				break;

			case 'publish':
				$exp = sanitize_text_field( wp_unslash( $_POST['expires_at'] ?? '' ) );
				OCP_Proposal::update( $id, array( 'expires_at' => $exp ? $exp . ' 23:59:59' : null ) );
				break;
		}

		// Advance to the next step, or stay on publish.
		$keys = array_keys( self::steps() );
		$pos  = array_search( $step, $keys, true );
		$next = ( false !== $pos && $pos < count( $keys ) - 1 ) ? $keys[ $pos + 1 ] : $step;
		self::redirect_step( $id, $next );
	}

	private static function save_pricing( $id ) {
		$cad    = (array) ( $_POST['item_cadence'] ?? array() );
		$stage  = (array) ( $_POST['item_stage'] ?? array() );
		$label  = (array) ( $_POST['item_label'] ?? array() );
		$qty    = (array) ( $_POST['item_qty'] ?? array() );
		$amount = (array) ( $_POST['item_amount'] ?? array() );
		$hours  = (array) ( $_POST['item_hours'] ?? array() );

		$items = array();
		foreach ( $label as $i => $lab ) {
			$items[] = array(
				'cadence'     => sanitize_key( $cad[ $i ] ?? 'oneoff' ),
				'stage'       => isset( $stage[ $i ] ) ? sanitize_text_field( $stage[ $i ] ) : '',
				'label'       => sanitize_text_field( wp_unslash( $lab ) ),
				'qty'         => (float) ( $qty[ $i ] ?? 1 ),
				'unit_amount' => (float) ( $amount[ $i ] ?? 0 ),
				'hours'       => isset( $hours[ $i ] ) ? sanitize_text_field( $hours[ $i ] ) : '',
			);
		}
		OCP_Proposal::replace_items( $id, $items );
	}

	public static function ai_assist() {
		self::guard( 'ocp_ai_assist' );
		$id = (int) ( $_POST['id'] ?? 0 );
		$do = sanitize_key( wp_unslash( $_POST['do'] ?? '' ) );
		$p  = OCP_Proposal::get( $id );
		if ( $p ) {
			if ( 'diagnostics' === $do ) {
				$text = OCP_Diagnostics::snapshot_text( $p['website_url'] );
				if ( $text ) {
					$cur = OCP_Proposal::get_section( $id, 'situation' );
					$body = trim( ( $cur['body'] ?? '' ) . "\n\n" . $text );
					OCP_Proposal::set_section( $id, 'situation', array( 'body' => $body ) );
				}
			} elseif ( 'reangle' === $do ) {
				$obj = OCP_Proposal::get_section( $id, 'objectives' );
				$sit = OCP_Proposal::get_section( $id, 'situation' );
				if ( $obj && trim( (string) $obj['body'] ) !== '' ) {
					$new = OCP_Claude::rewrite_section( $obj['body'], array(
						'sector'    => $p['sector'],
						'situation' => wp_strip_all_tags( (string) ( $sit['body'] ?? '' ) ),
					) );
					if ( $new ) {
						OCP_Proposal::set_section( $id, 'objectives', array( 'body' => $new ) );
					}
				}
			}
		}
		self::redirect_step( $id, 'content' );
	}

	/** AJAX: one turn of the discovery chat. Persists history on the proposal. */
	public static function content_chat() {
		if ( ! current_user_can( self::CAP ) ) {
			wp_send_json_error( array( 'message' => __( 'Not allowed.', 'oc-proposals' ) ), 403 );
		}
		check_ajax_referer( 'ocp_content_chat', 'nonce' );

		$id = (int) ( $_POST['id'] ?? 0 );
		$p  = OCP_Proposal::get( $id );
		if ( ! $p ) {
			wp_send_json_error( array( 'message' => __( 'Proposal not found.', 'oc-proposals' ) ), 404 );
		}
		if ( ! OCP_Claude::enabled() ) {
			wp_send_json_error( array( 'message' => __( 'Add a Claude API key in Settings.', 'oc-proposals' ) ), 400 );
		}

		$material = sanitize_textarea_field( wp_unslash( $_POST['material'] ?? '' ) );
		$message  = sanitize_textarea_field( wp_unslash( $_POST['message'] ?? '' ) );
		OCP_Proposal::set_section( $id, 'source_material', array( 'body' => $material ) );

		$history   = self::history( $id );
		$history[] = array( 'role' => 'user', 'content' => $message );

		$reply = OCP_Claude::discovery_reply( $history, array(
			'client_name' => $p['client_name'],
			'sector'      => $p['sector'],
			'material'    => $material,
		) );
		if ( is_wp_error( $reply ) ) {
			wp_send_json_error( array( 'message' => $reply->get_error_message() ), 502 );
		}
		$history[] = array( 'role' => 'assistant', 'content' => $reply );
		self::save_history( $id, $history );

		wp_send_json_success( array( 'reply' => $reply ) );
	}

	/** AJAX: draft the Situation + Objectives from the material + discussion. */
	public static function content_generate() {
		if ( ! current_user_can( self::CAP ) ) {
			wp_send_json_error( array( 'message' => __( 'Not allowed.', 'oc-proposals' ) ), 403 );
		}
		check_ajax_referer( 'ocp_content_chat', 'nonce' );

		$id = (int) ( $_POST['id'] ?? 0 );
		$p  = OCP_Proposal::get( $id );
		if ( ! $p || ! OCP_Claude::enabled() ) {
			wp_send_json_error( array( 'message' => __( 'Unavailable.', 'oc-proposals' ) ), 400 );
		}
		$material = sanitize_textarea_field( wp_unslash( $_POST['material'] ?? '' ) );
		OCP_Proposal::set_section( $id, 'source_material', array( 'body' => $material ) );

		$out = OCP_Claude::extract_content( $material, self::history( $id ), array(
			'client_name' => $p['client_name'],
			'sector'      => $p['sector'],
		) );
		if ( empty( $out['situation'] ) && empty( $out['objectives'] ) ) {
			wp_send_json_error( array( 'message' => __( 'Could not draft the sections — add more detail and try again.', 'oc-proposals' ) ), 502 );
		}
		$situation  = wp_kses_post( $out['situation'] ?? '' );
		$objectives = wp_kses_post( $out['objectives'] ?? '' );
		OCP_Proposal::set_section( $id, 'situation', array( 'body' => $situation ) );
		OCP_Proposal::set_section( $id, 'objectives', array( 'body' => $objectives ) );

		wp_send_json_success( array( 'situation' => $situation, 'objectives' => $objectives ) );
	}

	private static function history( $id ) {
		$s = OCP_Proposal::get_section( $id, 'discovery' );
		$h = $s && $s['body'] ? json_decode( $s['body'], true ) : array();
		return is_array( $h ) ? array_slice( $h, -12 ) : array();
	}

	private static function save_history( $id, $history ) {
		OCP_Proposal::set_section( $id, 'discovery', array( 'body' => wp_json_encode( array_slice( $history, -12 ) ) ) );
	}

	public static function mark_sent() {
		$id = (int) ( $_GET['id'] ?? 0 );
		if ( ! current_user_can( self::CAP ) || ! wp_verify_nonce( $_GET['_wpnonce'] ?? '', 'ocp_mark_sent_' . $id ) ) {
			wp_die( esc_html__( 'Not allowed.', 'oc-proposals' ) );
		}
		OCP_Proposal::mark_sent( $id );
		self::redirect_step( $id, 'publish' );
	}

	public static function delete() {
		$id = (int) ( $_GET['id'] ?? 0 );
		if ( ! current_user_can( self::CAP ) || ! wp_verify_nonce( $_GET['_wpnonce'] ?? '', 'ocp_delete_proposal_' . $id ) ) {
			wp_die( esc_html__( 'Not allowed.', 'oc-proposals' ) );
		}
		OCP_Proposal::delete( $id );
		wp_safe_redirect( add_query_arg( array( 'page' => self::PAGE ), admin_url( 'admin.php' ) ) );
		exit;
	}

	private static function guard( $nonce ) {
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( esc_html__( 'Not allowed.', 'oc-proposals' ) );
		}
		check_admin_referer( $nonce );
	}

	private static function redirect_step( $id, $step ) {
		wp_safe_redirect( add_query_arg(
			array( 'page' => self::PAGE, 'action' => 'edit', 'id' => $id, 'step' => $step ),
			admin_url( 'admin.php' )
		) );
		exit;
	}
}
