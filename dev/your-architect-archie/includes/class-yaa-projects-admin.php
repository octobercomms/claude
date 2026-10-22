<?php
/**
 * Archie Projects — the studio-facing admin.
 *
 * A branded, site-styled screen (not the generic CPT list) that shows everyone
 * who *started* as well as those who *submitted*, split into tabs, plus a
 * per-project detail view that renders the collected answers as a form so Tiam
 * can see exactly how far each person got and where they dropped off.
 *
 * Read-only observability for now (Phase 1). Approve → email → payment → portal
 * actions arrive in later phases and hang off the same records + event log.
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_Projects_Admin {

	const SLUG = 'yaa-projects';

	/** Tab key → statuses filter. */
	public static function tabs() {
		return array(
			'all'        => array( 'label' => 'All',        'statuses' => array() ),
			'started'    => array( 'label' => 'Started',    'statuses' => array( 'partial', 'quoted' ) ),
			'submitted'  => array( 'label' => 'Submitted',  'statuses' => array( 'submitted' ) ),
			'redirected' => array( 'label' => 'RIBA / Tiam','statuses' => array( 'redirected' ) ),
			'recovered'  => array( 'label' => 'Recovered',  'statuses' => array( 'recovered' ) ),
			'abandoned'  => array( 'label' => 'Abandoned',  'statuses' => array( 'abandoned' ) ),
		);
	}

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'assets' ) );
		add_action( 'admin_post_yaa_project_approve', array( __CLASS__, 'act_approve' ) );
		add_action( 'admin_post_yaa_project_start', array( __CLASS__, 'act_start' ) );
		add_action( 'admin_post_yaa_project_survey', array( __CLASS__, 'act_survey' ) );
		add_action( 'admin_post_yaa_project_quote', array( __CLASS__, 'act_quote' ) );
		add_action( 'admin_post_yaa_project_reject', array( __CLASS__, 'act_reject' ) );
		add_action( 'admin_post_yaa_email_draft', array( __CLASS__, 'act_email_draft' ) );
		add_action( 'admin_post_yaa_email_save', array( __CLASS__, 'act_email_save' ) );
		add_action( 'admin_post_yaa_email_send', array( __CLASS__, 'act_email_send' ) );
		add_action( 'admin_post_yaa_project_delete', array( __CLASS__, 'act_delete' ) );
		add_action( 'admin_post_yaa_projects_bulk_delete', array( __CLASS__, 'act_bulk_delete' ) );
		add_action( 'admin_post_yaa_projects_export', array( __CLASS__, 'act_export_csv' ) );
		add_action( 'admin_post_yaa_project_print', array( __CLASS__, 'act_print' ) );
	}

	/** Permanently delete a submission/project and everything attached to it. */
	public static function act_delete() {
		if ( ! current_user_can( 'manage_options' ) || ! check_admin_referer( 'yaa_delete' ) ) {
			wp_die( 'Nope' );
		}
		$pid = (int) ( $_POST['project_id'] ?? 0 );
		if ( $pid ) {
			YAA_Project::delete( $pid );
		}
		wp_safe_redirect( add_query_arg( array( 'page' => self::SLUG, 'notice' => 'deleted' ), admin_url( 'admin.php' ) ) );
		exit;
	}

	/**
	 * Delete from the list: a single row (the trash button, `delete_one`) or every
	 * ticked row at once (`ids[]`). Both post the same bulk form so we never nest
	 * <form> tags inside the table.
	 */
	public static function act_bulk_delete() {
		if ( ! current_user_can( 'manage_options' ) || ! check_admin_referer( 'yaa_bulk_delete' ) ) {
			wp_die( 'Nope' );
		}
		$ids = array();
		if ( isset( $_POST['delete_one'] ) ) {
			$ids[] = (int) $_POST['delete_one'];
		} elseif ( ! empty( $_POST['ids'] ) && is_array( $_POST['ids'] ) ) {
			$ids = array_map( 'intval', wp_unslash( $_POST['ids'] ) );
		}
		$ids = array_filter( array_unique( $ids ) );
		$n   = 0;
		foreach ( $ids as $pid ) {
			YAA_Project::delete( $pid );
			$n++;
		}
		$args = array( 'page' => self::SLUG, 'notice' => $n ? 'deleted' : '' );
		if ( ! empty( $_POST['tab'] ) ) {
			$args['tab'] = sanitize_key( wp_unslash( $_POST['tab'] ) );
		}
		wp_safe_redirect( add_query_arg( $args, admin_url( 'admin.php' ) ) );
		exit;
	}

	/** Comma-joined service labels for a project's state (multi-service aware). */
	private static function service_labels( array $state ) {
		$services = YAA_Pricing::table()['services'];
		$keys     = array();
		if ( ! empty( $state['services'] ) && is_array( $state['services'] ) ) {
			$keys = $state['services'];
		} elseif ( ! empty( $state['service'] ) ) {
			$keys = array( $state['service'] );
		}
		$labels = array();
		foreach ( $keys as $k ) {
			if ( isset( $services[ $k ] ) ) {
				$labels[] = $services[ $k ]['label'];
			}
		}
		return implode( '; ', $labels );
	}

	/** Bulk CSV export of the projects matching the current tab + search. */
	public static function act_export_csv() {
		if ( ! current_user_can( 'manage_options' ) || ! check_admin_referer( 'yaa_export' ) ) {
			wp_die( 'Nope' );
		}
		$tab      = isset( $_POST['tab'] ) ? sanitize_key( wp_unslash( $_POST['tab'] ) ) : 'all';
		$search   = isset( $_POST['s'] ) ? sanitize_text_field( wp_unslash( $_POST['s'] ) ) : '';
		$tabs     = self::tabs();
		$statuses = isset( $tabs[ $tab ] ) ? $tabs[ $tab ]['statuses'] : array();
		$rows     = YAA_Project::query( array( 'statuses' => $statuses, 'search' => $search, 'limit' => 5000 ) );

		nocache_headers();
		header( 'Content-Type: text/csv; charset=utf-8' );
		header( 'Content-Disposition: attachment; filename="archie-projects-' . gmdate( 'Y-m-d' ) . '.csv"' );
		$out = fopen( 'php://output', 'w' );
		fwrite( $out, "\xEF\xBB\xBF" ); // UTF-8 BOM so Excel reads accents/£ correctly.
		fputcsv( $out, array( 'Ref', 'Status', 'Name', 'Email', 'Address', 'Postcode', 'Services', 'What the work is', 'Total (GBP)', 'Paid', 'Amount paid (GBP)', 'London', 'Listed', 'Conservation', 'Marketing opt-in', 'Started', 'Submitted', 'Approved', 'Paid at' ) );
		foreach ( (array) $rows as $r ) {
			$state = json_decode( (string) $r->state_json, true );
			$state = is_array( $state ) ? $state : array();
			fputcsv( $out, array(
				$r->ref,
				$r->status,
				$r->name,
				$r->email,
				isset( $state['address'] ) ? $state['address'] : '',
				$r->postcode,
				self::service_labels( $state ),
				self::type_label( $r->project_type ),
				(int) $r->total,
				$r->paid ? 'yes' : 'no',
				$r->amount_paid ? (int) round( $r->amount_paid / 100 ) : 0,
				$r->london ? 'yes' : 'no',
				$r->listed ? 'yes' : 'no',
				$r->conservation ? 'yes' : 'no',
				! empty( $state['marketing'] ) ? 'yes' : 'no',
				$r->created,
				$r->submitted_at,
				$r->approved_at,
				$r->paid_at,
			) );
		}
		fclose( $out );
		exit;
	}

	/** Standalone printable project sheet (cover details + full transcript) → Save as PDF. */
	public static function act_print() {
		if ( ! current_user_can( 'manage_options' ) || ! check_admin_referer( 'yaa_print' ) ) {
			wp_die( 'Nope' );
		}
		$pid = isset( $_GET['project'] ) ? (int) $_GET['project'] : 0;
		$row = YAA_Project::get( $pid );
		if ( ! $row ) {
			wp_die( esc_html__( 'Project not found.', 'your-architect-archie' ) );
		}
		$state    = json_decode( (string) $row->state_json, true );
		$state    = is_array( $state ) ? $state : array();
		$package  = json_decode( (string) $row->package_json, true );
		$package  = is_array( $package ) ? $package : array( 'nodes' => array(), 'total' => 0 );
		$messages = json_decode( (string) $row->messages_json, true );
		$messages = is_array( $messages ) ? $messages : array();
		$summary  = YAA_Archie::answer_summary( $state );
		$who      = $row->name ? $row->name : ( $row->email ? $row->email : __( 'Anonymous enquiry', 'your-architect-archie' ) );

		nocache_headers();
		header( 'Content-Type: text/html; charset=utf-8' );
		echo self::print_html( $row, $state, $package, $messages, $summary, $who ); // phpcs:ignore WordPress.Security.EscapeOutput
		exit;
	}

	/** Build the standalone print document. */
	private static function print_html( $row, $state, $package, $messages, $summary, $who ) {
		$ref     = $row->ref ? $row->ref : ( 'ID ' . (int) $row->id );
		$badge   = self::badge( $row->status );
		$gen     = date_i18n( 'j M Y, H:i', current_time( 'timestamp' ) );
		$total   = YAA_Pricing::money( (int) $row->total );

		ob_start();
		?><!doctype html><html lang="en"><head><meta charset="utf-8">
		<meta name="viewport" content="width=device-width,initial-scale=1">
		<title><?php echo esc_html( 'Your Architect — Project ' . $ref ); ?></title>
		<style>
			:root{ --navy:#253E94; --ink:#1a2233; --muted:#6b7488; --line:#e6e9f2; }
			*{ box-sizing:border-box; }
			body{ font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:var(--ink); margin:0; background:#f4f6fb; }
			.sheet{ max-width:820px; margin:0 auto; background:#fff; padding:40px 44px; }
			.bar{ position:sticky; top:0; background:#eef2fb; border-bottom:1px solid var(--line); padding:10px 16px; display:flex; gap:10px; align-items:center; justify-content:center; }
			.bar button{ background:var(--navy); color:#fff; border:0; border-radius:8px; padding:9px 18px; font-weight:700; cursor:pointer; font-size:.9rem; }
			.bar span{ color:var(--muted); font-size:.85rem; }
			h1{ color:var(--navy); font-size:1.5rem; margin:0 0 2px; }
			.head{ display:flex; justify-content:space-between; align-items:flex-start; gap:16px; border-bottom:3px solid var(--navy); padding-bottom:16px; margin-bottom:20px; }
			.head .r{ text-align:right; font-size:.82rem; color:var(--muted); line-height:1.6; }
			.badge{ display:inline-block; font-size:.72rem; font-weight:700; padding:3px 10px; border-radius:999px; background:#eef0f4; color:#5b6472; }
			.badge.green{ background:#e5f6ec; color:#0f7a3d; } .badge.amber{ background:#fff4e5; color:#a15c00; }
			.badge.purple{ background:#efe9fb; color:#5b34c7; } .badge.grey{ background:#eef0f4; color:#5b6472; }
			h2{ color:var(--navy); font-size:.82rem; text-transform:uppercase; letter-spacing:.06em; margin:24px 0 10px; }
			table{ width:100%; border-collapse:collapse; font-size:.9rem; }
			.kv td{ padding:7px 0; border-bottom:1px solid #eef1f7; vertical-align:top; }
			.kv td.k{ color:var(--muted); width:38%; }
			.kv td.v{ color:var(--ink); font-weight:600; }
			.pkg td{ padding:7px 0; border-bottom:1px solid #eef1f7; }
			.pkg td.p{ text-align:right; font-weight:700; white-space:nowrap; }
			.pkg tr.total td{ border-bottom:0; padding-top:12px; color:var(--navy); font-weight:800; font-size:1.05rem; }
			.convo{ margin-top:6px; }
			.turn{ margin:0 0 12px; }
			.turn .who{ font-size:.68rem; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin-bottom:2px; }
			.turn.bot .who{ color:var(--navy); }
			.turn .say{ font-size:.92rem; line-height:1.5; white-space:pre-wrap; }
			.foot{ margin-top:28px; padding-top:14px; border-top:1px solid var(--line); font-size:.75rem; color:var(--muted); }
			@media print{ .bar{ display:none; } body{ background:#fff; } .sheet{ max-width:none; padding:0; } .turn{ page-break-inside:avoid; } }
		</style></head><body>
		<div class="bar"><button onclick="window.print()">Print / Save as PDF</button><span>Use your browser's “Save as PDF” in the print dialog.</span></div>
		<div class="sheet">
			<div class="head">
				<div>
					<h1><?php echo esc_html( $who ); ?></h1>
					<div><?php echo $badge; // phpcs:ignore WordPress.Security.EscapeOutput ?></div>
				</div>
				<div class="r">
					<strong style="color:var(--navy);font-size:1rem;">Your Architect</strong><br>
					Project <strong><?php echo esc_html( $ref ); ?></strong><br>
					Generated <?php echo esc_html( $gen ); ?>
				</div>
			</div>

			<h2>Project details</h2>
			<table class="kv">
				<?php foreach ( $summary as $q ) : ?>
					<?php if ( $q['answered'] ) : ?>
						<tr><td class="k"><?php echo esc_html( $q['label'] ); ?></td><td class="v"><?php echo esc_html( $q['value'] ); ?></td></tr>
					<?php endif; ?>
				<?php endforeach; ?>
				<tr><td class="k">Status</td><td class="v"><?php echo esc_html( ucfirst( str_replace( '_', ' ', (string) $row->status ) ) ); ?></td></tr>
				<?php if ( $row->created ) : ?><tr><td class="k">Started</td><td class="v"><?php echo esc_html( self::date( $row->created ) ); ?></td></tr><?php endif; ?>
				<?php if ( $row->submitted_at ) : ?><tr><td class="k">Submitted</td><td class="v"><?php echo esc_html( self::date( $row->submitted_at ) ); ?></td></tr><?php endif; ?>
				<?php if ( $row->paid ) : ?><tr><td class="k">Paid</td><td class="v"><?php echo esc_html( YAA_Pricing::money( (int) round( $row->amount_paid / 100 ) ) . ' · ' . self::date( $row->paid_at ) ); ?></td></tr><?php endif; ?>
				<?php if ( ! empty( $state['marketing'] ) ) : ?><tr><td class="k">Marketing opt-in</td><td class="v">Yes</td></tr><?php endif; ?>
			</table>

			<?php if ( ! empty( $package['nodes'] ) ) : ?>
				<h2>Fixed-price package</h2>
				<table class="pkg">
					<?php foreach ( $package['nodes'] as $n ) : ?>
						<?php if ( isset( $n['kind'] ) && 'info' === $n['kind'] ) { continue; } ?>
						<tr>
							<td><?php echo esc_html( isset( $n['label'] ) ? $n['label'] : '' ); ?><?php echo ! empty( $n['sub'] ) ? ' <span style="color:#8B8A85;font-weight:400;">(' . esc_html( $n['sub'] ) . ')</span>' : ''; // phpcs:ignore ?></td>
							<td class="p"><?php echo ( isset( $n['price'] ) && null !== $n['price'] ) ? esc_html( YAA_Pricing::money( (int) $n['price'] ) ) : esc_html__( 'quote to follow', 'your-architect-archie' ); ?></td>
						</tr>
					<?php endforeach; ?>
					<tr class="total"><td>Total</td><td class="p"><?php echo esc_html( $total ); ?></td></tr>
				</table>
			<?php endif; ?>

			<h2>Conversation with Archie</h2>
			<div class="convo">
				<?php if ( empty( $messages ) ) : ?>
					<p style="color:var(--muted);">No conversation recorded.</p>
				<?php else : foreach ( $messages as $m ) : ?>
					<div class="turn <?php echo 'assistant' === $m['role'] ? 'bot' : 'user'; ?>">
						<div class="who"><?php echo 'assistant' === $m['role'] ? 'Archie' : esc_html( $row->name ? $row->name : __( 'Visitor', 'your-architect-archie' ) ); ?></div>
						<div class="say"><?php echo esc_html( $m['text'] ); ?></div>
					</div>
				<?php endforeach; endif; ?>
			</div>

			<div class="foot">Your Architect — a trading name of Tiam Architects LLP. ARB-registered, RIBA chartered. This document is for the project file.</div>
		</div>
		</body></html>
		<?php
		return ob_get_clean();
	}

	// ---- Workflow actions (nonce + cap checked; redirect back to the project) ----
	private static function guard( $nonce ) {
		if ( ! current_user_can( 'manage_options' ) || ! check_admin_referer( $nonce ) ) {
			wp_die( 'Nope' );
		}
	}
	private static function back( $pid, $notice = '' ) {
		$args = array( 'page' => self::SLUG, 'project' => (int) $pid );
		if ( $notice ) {
			$args['notice'] = $notice;
		}
		wp_safe_redirect( add_query_arg( $args, admin_url( 'admin.php' ) ) . '#workflow' );
		exit;
	}
	public static function act_approve() {
		self::guard( 'yaa_workflow' );
		$pid = (int) ( $_POST['project_id'] ?? 0 );
		YAA_Project::approve( $pid );
		self::back( $pid, 'approved' );
	}
	public static function act_start() {
		self::guard( 'yaa_workflow' );
		$pid = (int) ( $_POST['project_id'] ?? 0 );
		YAA_Project::ensure_token( $pid );
		YAA_Project::set_status( $pid, 'in_progress' );
		self::back( $pid, 'started_drawings' );
	}
	public static function act_survey() {
		self::guard( 'yaa_workflow' );
		$pid      = (int) ( $_POST['project_id'] ?? 0 );
		$received = ! empty( $_POST['received'] );
		YAA_Project::mark_survey_received( $pid, $received );
		self::back( $pid, $received ? 'survey_received' : 'survey_unmarked' );
	}
	public static function act_quote() {
		self::guard( 'yaa_workflow' );
		$pid = (int) ( $_POST['project_id'] ?? 0 );
		$ok  = class_exists( 'YAA_Followups' ) ? YAA_Followups::send_quote_copy( $pid, true ) : false;
		self::back( $pid, $ok ? 'quote_sent' : 'quote_failed' );
	}
	public static function act_reject() {
		self::guard( 'yaa_workflow' );
		$pid = (int) ( $_POST['project_id'] ?? 0 );
		YAA_Project::set_status( $pid, 'rejected' );
		self::back( $pid, 'rejected' );
	}
	public static function act_email_draft() {
		self::guard( 'yaa_workflow' );
		$pid  = (int) ( $_POST['project_id'] ?? 0 );
		$kind = isset( $_POST['kind'] ) ? sanitize_key( wp_unslash( $_POST['kind'] ) ) : 'approved';
		$res  = YAA_Email::draft_stage( $pid, $kind );
		self::back( $pid, is_wp_error( $res ) ? 'draft_failed' : 'drafted' );
	}
	public static function act_email_save() {
		self::guard( 'yaa_workflow' );
		$pid   = (int) ( $_POST['project_id'] ?? 0 );
		$eid   = (int) ( $_POST['email_id'] ?? 0 );
		YAA_Email::update_draft( $eid, sanitize_text_field( wp_unslash( $_POST['subject'] ?? '' ) ), wp_kses_post( wp_unslash( $_POST['body'] ?? '' ) ) );
		self::back( $pid, 'saved' );
	}
	public static function act_email_send() {
		self::guard( 'yaa_workflow' );
		$pid = (int) ( $_POST['project_id'] ?? 0 );
		$eid = (int) ( $_POST['email_id'] ?? 0 );
		$res = YAA_Email::send( $eid );
		if ( is_wp_error( $res ) ) {
			set_transient( 'yaa_send_err_' . get_current_user_id(), $res->get_error_message(), 120 );
		}
		self::back( $pid, is_wp_error( $res ) ? 'send_failed' : 'sent' );
	}

	public static function menu() {
		add_menu_page(
			__( 'Archie Projects', 'your-architect-archie' ),
			__( 'Archie Projects', 'your-architect-archie' ),
			'manage_options',
			self::SLUG,
			array( __CLASS__, 'render' ),
			'dashicons-format-chat',
			26
		);
		add_submenu_page(
			self::SLUG,
			__( 'Email log', 'your-architect-archie' ),
			__( 'Email log', 'your-architect-archie' ),
			'manage_options',
			'yaa-emails',
			array( __CLASS__, 'render_emails' )
		);
	}

	public static function assets() {
		$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		if ( 0 !== strpos( $page, 'yaa-' ) ) {
			return;
		}
		wp_register_style( 'yaa-admin', false, array(), YAA_VERSION );
		wp_enqueue_style( 'yaa-admin' );
		wp_add_inline_style( 'yaa-admin', self::css() );
	}

	public static function render() {
		$pid = isset( $_GET['project'] ) ? (int) $_GET['project'] : 0; // phpcs:ignore WordPress.Security.NonceVerification
		if ( $pid ) {
			self::render_detail( $pid );
			return;
		}
		self::render_list();
	}

	/** Friendly labels for the email `kind` column. */
	private static function email_kind_labels() {
		return array(
			'approved'        => __( 'Approval email', 'your-architect-archie' ),
			'progress'        => __( 'Drawings in progress', 'your-architect-archie' ),
			'preview'         => __( 'Preview + payment link', 'your-architect-archie' ),
			'rejected'        => __( 'Decline email', 'your-architect-archie' ),
			'receipt'         => __( 'Payment receipt', 'your-architect-archie' ),
			'quote'           => __( 'Quote copy to client', 'your-architect-archie' ),
			'confirmation'    => __( 'Confirmation', 'your-architect-archie' ),
			'notify_submit'   => __( 'New-enquiry alert', 'your-architect-archie' ),
			'client_summary'  => __( 'Quote summary to client', 'your-architect-archie' ),
			'resume'          => __( 'Resume reminder', 'your-architect-archie' ),
			'signin'          => __( 'Portal sign-in link', 'your-architect-archie' ),
			'notify_revision' => __( 'Revision-request alert', 'your-architect-archie' ),
		);
	}

	// ---- Email log (system-wide) ----
	public static function render_emails() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$view_id = isset( $_GET['email'] ) ? (int) $_GET['email'] : 0; // phpcs:ignore WordPress.Security.NonceVerification
		if ( $view_id ) {
			self::render_email_detail( $view_id );
			return;
		}
		$rows   = YAA_Email::recent_log( 300 );
		$labels = self::email_kind_labels();
		?>
		<div class="wrap yaa-wrap">
			<h1><?php esc_html_e( 'Email log', 'your-architect-archie' ); ?></h1>
			<p class="yaa-emails-meta"><?php esc_html_e( 'Every email the system has sent — staged client emails, new-enquiry and revision alerts to the studio, quote summaries, portal sign-in links and payment receipts. Newest first, last 300.', 'your-architect-archie' ); ?></p>
			<?php if ( empty( $rows ) ) : ?>
				<div class="yaa-card"><p class="yaa-emails-meta"><?php esc_html_e( 'No emails have been sent yet.', 'your-architect-archie' ); ?></p></div>
			<?php else : ?>
			<table class="wp-list-table widefat fixed striped" style="margin-top:12px">
				<thead>
					<tr>
						<th style="width:140px"><?php esc_html_e( 'When', 'your-architect-archie' ); ?></th>
						<th style="width:110px"><?php esc_html_e( 'Direction', 'your-architect-archie' ); ?></th>
						<th><?php esc_html_e( 'Email', 'your-architect-archie' ); ?></th>
						<th><?php esc_html_e( 'Recipient', 'your-architect-archie' ); ?></th>
						<th style="width:120px"><?php esc_html_e( 'Project', 'your-architect-archie' ); ?></th>
						<th style="width:80px"><?php esc_html_e( 'Status', 'your-architect-archie' ); ?></th>
					</tr>
				</thead>
				<tbody>
				<?php foreach ( $rows as $r ) :
					$is_studio = ( 'studio' === $r->recipient_type );
					$kind      = isset( $labels[ $r->kind ] ) ? $labels[ $r->kind ] : ucfirst( str_replace( '_', ' ', (string) $r->kind ) );
					$when      = $r->sent_at ? $r->sent_at : $r->created;
					$ts        = $when ? strtotime( $when ) : 0;
					$proj      = $r->project_ref ? $r->project_ref : ( $r->project_name ? $r->project_name : ( $r->project_id ? '#' . (int) $r->project_id : '—' ) );
					$purl      = add_query_arg( array( 'page' => self::SLUG, 'project' => (int) $r->project_id ), admin_url( 'admin.php' ) );
				?>
					<tr>
						<td><?php echo esc_html( $ts ? self::ago( $when ) : '—' ); ?><br><span class="yaa-emails-meta"><?php echo esc_html( $ts ? date_i18n( 'j M Y, H:i', $ts ) : '' ); ?></span></td>
						<td><span class="yaa-badge <?php echo $is_studio ? 'amber' : 'blue'; ?>"><?php echo $is_studio ? esc_html__( 'To studio', 'your-architect-archie' ) : esc_html__( 'To client', 'your-architect-archie' ); ?></span></td>
						<td><a href="<?php echo esc_url( add_query_arg( array( 'page' => 'yaa-emails', 'email' => (int) $r->id ), admin_url( 'admin.php' ) ) ); ?>"><strong><?php echo esc_html( $kind ); ?></strong></a><br><span class="yaa-emails-meta"><?php echo esc_html( (string) $r->subject ); ?></span></td>
						<td><?php echo esc_html( (string) $r->recipient ); ?></td>
						<td><?php if ( $r->project_id ) : ?><a href="<?php echo esc_url( $purl ); ?>"><?php echo esc_html( $proj ); ?></a><?php else : ?><?php echo esc_html( $proj ); ?><?php endif; ?></td>
						<td><?php if ( 'failed' === $r->status ) : ?><span class="yaa-badge red"><?php esc_html_e( 'Failed', 'your-architect-archie' ); ?></span><?php else : ?><span class="yaa-badge green"><?php esc_html_e( 'Sent', 'your-architect-archie' ); ?></span><?php endif; ?></td>
					</tr>
				<?php endforeach; ?>
				</tbody>
			</table>
			<?php endif; ?>
		</div>
		<?php
	}

	/** The actual email behind one log row: delivery details + the message as sent. */
	private static function render_email_detail( $id ) {
		$em     = YAA_Email::get( $id );
		$labels = self::email_kind_labels();
		$back   = add_query_arg( array( 'page' => 'yaa-emails' ), admin_url( 'admin.php' ) );
		?>
		<div class="wrap yaa-wrap">
			<h1><?php esc_html_e( 'Email', 'your-architect-archie' ); ?></h1>
			<p><a href="<?php echo esc_url( $back ); ?>">&larr; <?php esc_html_e( 'Back to the email log', 'your-architect-archie' ); ?></a></p>
			<?php if ( ! $em ) : ?>
				<div class="yaa-card"><p class="yaa-emails-meta"><?php esc_html_e( 'That email could not be found.', 'your-architect-archie' ); ?></p></div>
			<?php else :
				$kind = isset( $labels[ $em->kind ] ) ? $labels[ $em->kind ] : ucfirst( str_replace( '_', ' ', (string) $em->kind ) );
				$when = $em->sent_at ? $em->sent_at : $em->created;
				$is_studio = ( 'studio' === $em->recipient_type );
			?>
				<div class="yaa-card">
					<table style="width:100%;border-collapse:collapse;font-size:.92rem">
						<tr><td style="padding:6px 0;color:#6b7280;width:120px"><?php esc_html_e( 'Type', 'your-architect-archie' ); ?></td><td style="padding:6px 0;font-weight:600"><?php echo esc_html( $kind ); ?></td></tr>
						<tr><td style="padding:6px 0;color:#6b7280"><?php esc_html_e( 'Subject', 'your-architect-archie' ); ?></td><td style="padding:6px 0"><?php echo esc_html( (string) $em->subject ); ?></td></tr>
						<tr><td style="padding:6px 0;color:#6b7280"><?php esc_html_e( 'To', 'your-architect-archie' ); ?></td><td style="padding:6px 0"><?php echo esc_html( (string) $em->recipient ); ?> <span class="yaa-badge <?php echo $is_studio ? 'amber' : 'blue'; ?>"><?php echo $is_studio ? esc_html__( 'studio', 'your-architect-archie' ) : esc_html__( 'client', 'your-architect-archie' ); ?></span></td></tr>
						<tr><td style="padding:6px 0;color:#6b7280"><?php esc_html_e( 'When', 'your-architect-archie' ); ?></td><td style="padding:6px 0"><?php echo esc_html( $when ? date_i18n( 'j M Y, H:i', strtotime( $when ) ) : '—' ); ?></td></tr>
						<tr><td style="padding:6px 0;color:#6b7280"><?php esc_html_e( 'Status', 'your-architect-archie' ); ?></td><td style="padding:6px 0"><?php echo 'failed' === $em->status ? '<span class="yaa-badge red">' . esc_html__( 'Failed', 'your-architect-archie' ) . '</span>' : '<span class="yaa-badge green">' . esc_html__( 'Sent', 'your-architect-archie' ) . '</span>'; ?></td></tr>
					</table>
				</div>
				<div class="yaa-card">
					<h2 style="margin-top:0"><?php esc_html_e( 'Message', 'your-architect-archie' ); ?></h2>
					<?php if ( '' !== trim( (string) $em->body ) ) : ?>
						<iframe sandbox="" title="<?php esc_attr_e( 'Email preview', 'your-architect-archie' ); ?>" style="width:100%;min-height:560px;border:1px solid #e7eaef;border-radius:8px;background:#fff" srcdoc="<?php echo esc_attr( (string) $em->body ); ?>"></iframe>
					<?php else : ?>
						<p class="yaa-emails-meta"><?php esc_html_e( 'The full message wasn\'t stored for this email (it predates message logging). The subject and delivery details above are recorded.', 'your-architect-archie' ); ?></p>
					<?php endif; ?>
				</div>
			<?php endif; ?>
		</div>
		<?php
	}

	// ---- List ----
	private static function render_list() {
		$tabs    = self::tabs();
		$counts  = YAA_Project::status_counts();
		$active  = isset( $_GET['tab'] ) ? sanitize_key( wp_unslash( $_GET['tab'] ) ) : 'all'; // phpcs:ignore WordPress.Security.NonceVerification
		if ( ! isset( $tabs[ $active ] ) ) {
			$active = 'all';
		}
		$search  = isset( $_GET['s'] ) ? sanitize_text_field( wp_unslash( $_GET['s'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification

		$count_for = function ( $statuses ) use ( $counts ) {
			if ( empty( $statuses ) ) {
				return array_sum( $counts );
			}
			$n = 0;
			foreach ( $statuses as $s ) {
				$n += isset( $counts[ $s ] ) ? $counts[ $s ] : 0;
			}
			return $n;
		};

		$rows = YAA_Project::query(
			array(
				'statuses' => $tabs[ $active ]['statuses'],
				'search'   => $search,
				'limit'    => 200,
			)
		);

		// Headline funnel numbers.
		$started_n   = $count_for( array( 'partial', 'quoted' ) );
		$submitted_n = $count_for( array( 'submitted' ) );
		$total_n     = array_sum( $counts );
		$conv        = $total_n ? round( ( $submitted_n / max( 1, $total_n ) ) * 100 ) : 0;
		?>
		<div class="wrap yaa-admin">
			<div class="yaa-head">
				<h1><?php esc_html_e( 'Archie Projects', 'your-architect-archie' ); ?></h1>
				<div class="yaa-head-actions">
					<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline">
						<input type="hidden" name="action" value="yaa_projects_export">
						<input type="hidden" name="tab" value="<?php echo esc_attr( $active ); ?>">
						<input type="hidden" name="s" value="<?php echo esc_attr( $search ); ?>">
						<?php wp_nonce_field( 'yaa_export' ); ?>
						<button class="yaa-btn ghost" type="submit"><?php esc_html_e( 'Export CSV', 'your-architect-archie' ); ?></button>
					</form>
					<a class="yaa-btn" href="<?php echo esc_url( admin_url( 'admin.php?page=yaa-settings' ) ); ?>"><?php esc_html_e( 'Settings', 'your-architect-archie' ); ?></a>
				</div>
			</div>


			<?php if ( 'deleted' === ( isset( $_GET['notice'] ) ? sanitize_key( wp_unslash( $_GET['notice'] ) ) : '' ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
				<div class="yaa-notice ok"><?php esc_html_e( 'Deleted.', 'your-architect-archie' ); ?></div>
			<?php endif; ?>

			<div class="yaa-stats">
				<div class="yaa-stat"><span class="n"><?php echo esc_html( $total_n ); ?></span><span class="l"><?php esc_html_e( 'All submissions', 'your-architect-archie' ); ?></span></div>
				<div class="yaa-stat"><span class="n"><?php echo esc_html( $started_n ); ?></span><span class="l"><?php esc_html_e( 'Partial submissions', 'your-architect-archie' ); ?></span></div>
				<div class="yaa-stat"><span class="n"><?php echo esc_html( $submitted_n ); ?></span><span class="l"><?php esc_html_e( 'Projects (submitted)', 'your-architect-archie' ); ?></span></div>
				<div class="yaa-stat"><span class="n"><?php echo esc_html( $conv ); ?>%</span><span class="l"><?php esc_html_e( 'Conversion rate', 'your-architect-archie' ); ?></span></div>
			</div>

			<div class="yaa-tabs">
				<?php foreach ( $tabs as $key => $tab ) : ?>
					<a class="yaa-tab <?php echo $active === $key ? 'is-active' : ''; ?>"
					   href="<?php echo esc_url( add_query_arg( array( 'page' => self::SLUG, 'tab' => $key ), admin_url( 'admin.php' ) ) ); ?>">
						<?php echo esc_html( $tab['label'] ); ?>
						<span class="yaa-tab-n"><?php echo esc_html( $count_for( $tab['statuses'] ) ); ?></span>
					</a>
				<?php endforeach; ?>
				<form class="yaa-search" method="get">
					<input type="hidden" name="page" value="<?php echo esc_attr( self::SLUG ); ?>">
					<input type="hidden" name="tab" value="<?php echo esc_attr( $active ); ?>">
					<input type="search" name="s" value="<?php echo esc_attr( $search ); ?>" placeholder="<?php esc_attr_e( 'Search name, email, address…', 'your-architect-archie' ); ?>">
				</form>
			</div>

			<?php if ( empty( $rows ) ) : ?>
				<div class="yaa-empty"><?php esc_html_e( 'Nothing here yet.', 'your-architect-archie' ); ?></div>
			<?php else : ?>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="yaa-bulk">
				<input type="hidden" name="action" value="yaa_projects_bulk_delete">
				<input type="hidden" name="tab" value="<?php echo esc_attr( $active ); ?>">
				<?php wp_nonce_field( 'yaa_bulk_delete' ); ?>

				<div class="yaa-bulkbar">
					<button type="submit" class="yaa-bulk-del" name="bulk" value="delete" disabled
						onclick="return yaaConfirmBulk();">
						<?php esc_html_e( 'Delete selected', 'your-architect-archie' ); ?><span class="yaa-bulk-count"></span>
					</button>
					<span class="yaa-bulk-hint"><?php esc_html_e( 'Tick rows to delete in bulk — this cannot be undone.', 'your-architect-archie' ); ?></span>
				</div>

			<table class="yaa-table">
				<thead>
					<tr>
						<th class="yaa-col-check"><input type="checkbox" id="yaa-check-all" aria-label="<?php esc_attr_e( 'Select all', 'your-architect-archie' ); ?>"></th>
						<th><?php esc_html_e( 'Person', 'your-architect-archie' ); ?></th>
						<th><?php esc_html_e( 'Status', 'your-architect-archie' ); ?></th>
						<th><?php esc_html_e( 'Project', 'your-architect-archie' ); ?></th>
						<th><?php esc_html_e( 'Progress', 'your-architect-archie' ); ?></th>
						<th><?php esc_html_e( 'Total', 'your-architect-archie' ); ?></th>
						<th><?php esc_html_e( 'Last activity', 'your-architect-archie' ); ?></th>
						<th class="yaa-col-actions"><span class="screen-reader-text"><?php esc_html_e( 'Actions', 'your-architect-archie' ); ?></span></th>
					</tr>
				</thead>
				<tbody>
				<?php
				foreach ( $rows as $r ) :
					$state    = json_decode( (string) $r->state_json, true );
					$state    = is_array( $state ) ? $state : array();
					$summary  = YAA_Archie::answer_summary( $state );
					$answered = 0;
					foreach ( $summary as $q ) {
						$answered += $q['answered'] ? 1 : 0;
					}
					$total_q = max( 1, count( $summary ) );
					$pct     = round( ( $answered / $total_q ) * 100 );
					$who     = $r->name ? $r->name : ( $r->email ? $r->email : __( 'Anonymous', 'your-architect-archie' ) );
					$link    = esc_url( add_query_arg( array( 'page' => self::SLUG, 'project' => (int) $r->id ), admin_url( 'admin.php' ) ) );
					?>
					<tr onclick="window.location='<?php echo $link; // phpcs:ignore WordPress.Security.EscapeOutput ?>'">
						<td class="yaa-col-check" onclick="event.stopPropagation();">
							<input type="checkbox" class="yaa-check" name="ids[]" value="<?php echo esc_attr( (int) $r->id ); ?>" aria-label="<?php esc_attr_e( 'Select this submission', 'your-architect-archie' ); ?>">
						</td>
						<td>
							<a class="yaa-who" href="<?php echo $link; // phpcs:ignore WordPress.Security.EscapeOutput ?>"><?php echo esc_html( $who ); ?></a>
							<?php if ( $r->email && $r->name ) : ?><div class="yaa-sub"><?php echo esc_html( $r->email ); ?></div><?php endif; ?>
							<?php if ( $r->ref ) : ?><div class="yaa-sub">Ref <?php echo esc_html( $r->ref ); ?></div><?php endif; ?>
						</td>
						<td><?php echo self::badge( $r->status ); // phpcs:ignore WordPress.Security.EscapeOutput ?></td>
						<td>
							<?php echo esc_html( self::type_label( $r->project_type ) ); ?>
							<div class="yaa-flags">
								<?php if ( $r->london ) : ?><span class="yaa-flag london">London</span><?php endif; ?>
								<?php if ( $r->listed ) : ?><span class="yaa-flag warn">Listed</span><?php endif; ?>
								<?php if ( $r->conservation ) : ?><span class="yaa-flag warn">Conservation</span><?php endif; ?>
							</div>
						</td>
						<td>
							<div class="yaa-progress"><span style="width:<?php echo esc_attr( $pct ); ?>%"></span></div>
							<div class="yaa-sub"><?php echo esc_html( $answered . '/' . $total_q ); ?></div>
						</td>
						<td class="yaa-total"><?php echo esc_html( YAA_Pricing::money( (int) $r->total ) ); ?></td>
						<td><div class="yaa-sub"><?php echo esc_html( self::ago( $r->updated ) ); ?></div></td>
						<td class="yaa-row-actions" onclick="event.stopPropagation();">
							<button class="yaa-x" type="submit" name="delete_one" value="<?php echo esc_attr( (int) $r->id ); ?>"
								aria-label="<?php esc_attr_e( 'Delete', 'your-architect-archie' ); ?>" title="<?php esc_attr_e( 'Delete', 'your-architect-archie' ); ?>"
								onclick="return confirm('Permanently delete this submission and all of its data? This cannot be undone.');">&#128465;</button>
						</td>
					</tr>
				<?php endforeach; ?>
				</tbody>
			</table>
			</form>
			<script>
			function yaaConfirmBulk(){
				var n = document.querySelectorAll('.yaa-check:checked').length;
				if ( ! n ) { return false; }
				return confirm( 'Permanently delete ' + n + ' selected submission' + ( n > 1 ? 's' : '' ) + ' and all of their data? This cannot be undone.' );
			}
			(function(){
				var all = document.getElementById('yaa-check-all');
				var boxes = [].slice.call( document.querySelectorAll('.yaa-check') );
				var del = document.querySelector('.yaa-bulk-del');
				var cnt = document.querySelector('.yaa-bulk-count');
				function sync(){
					var n = document.querySelectorAll('.yaa-check:checked').length;
					if ( del ) { del.disabled = ( n === 0 ); }
					if ( cnt ) { cnt.textContent = n ? ' (' + n + ')' : ''; }
					if ( all ) { all.checked = ( n > 0 && n === boxes.length ); all.indeterminate = ( n > 0 && n < boxes.length ); }
				}
				if ( all ) { all.addEventListener('change', function(){ boxes.forEach(function(b){ b.checked = all.checked; }); sync(); }); }
				boxes.forEach(function(b){ b.addEventListener('change', sync); });
				sync();
			})();
			</script>
			<?php endif; ?>
		</div>
		<?php
	}

	// ---- Detail ----
	private static function render_detail( $pid ) {
		$row = YAA_Project::get( $pid );
		if ( ! $row ) {
			echo '<div class="wrap yaa-admin"><div class="yaa-empty">' . esc_html__( 'Project not found.', 'your-architect-archie' ) . '</div></div>';
			return;
		}
		$state    = json_decode( (string) $row->state_json, true );
		$state    = is_array( $state ) ? $state : array();
		$summary  = YAA_Archie::answer_summary( $state );
		$package  = json_decode( (string) $row->package_json, true );
		$package  = is_array( $package ) ? $package : array( 'nodes' => array(), 'total' => 0 );
		$messages = json_decode( (string) $row->messages_json, true );
		$messages = is_array( $messages ) ? $messages : array();
		$events   = YAA_Project::events( $pid );
		$who      = $row->name ? $row->name : ( $row->email ? $row->email : __( 'Anonymous', 'your-architect-archie' ) );

		$answered = 0;
		$dropoff  = '';
		foreach ( $summary as $q ) {
			if ( $q['answered'] ) {
				$answered++;
			} elseif ( '' === $dropoff ) {
				$dropoff = $q['label'];
			}
		}
		$back = esc_url( add_query_arg( array( 'page' => self::SLUG ), admin_url( 'admin.php' ) ) );
		?>
		<div class="wrap yaa-admin">
			<div class="yaa-head">
				<div>
					<a class="yaa-back" href="<?php echo $back; // phpcs:ignore WordPress.Security.EscapeOutput ?>">&larr; <?php esc_html_e( 'All submissions', 'your-architect-archie' ); ?></a>
					<h1><?php echo esc_html( $who ); ?> <?php echo self::badge( $row->status ); // phpcs:ignore WordPress.Security.EscapeOutput ?></h1>
					<p class="yaa-meta">
						<?php if ( $row->email ) : ?><?php echo esc_html( $row->email ); ?> · <?php endif; ?>
						<?php if ( $row->ref ) : ?>Ref <?php echo esc_html( $row->ref ); ?> · <?php endif; ?>
						<?php esc_html_e( 'Started', 'your-architect-archie' ); ?> <?php echo esc_html( self::date( $row->created ) ); ?>
						<?php if ( $row->submitted_at ) : ?> · <?php esc_html_e( 'Submitted', 'your-architect-archie' ); ?> <?php echo esc_html( self::date( $row->submitted_at ) ); ?><?php endif; ?>
					</p>
				</div>
				<div class="yaa-head-right">
					<div class="yaa-total-big"><?php echo esc_html( YAA_Pricing::money( (int) $row->total ) ); ?></div>
					<div class="yaa-inline" style="justify-content:flex-end;margin-top:0;">
						<a class="yaa-btn ghost" target="_blank" rel="noopener" href="<?php echo esc_url( wp_nonce_url( add_query_arg( array( 'action' => 'yaa_project_print', 'project' => (int) $row->id ), admin_url( 'admin-post.php' ) ), 'yaa_print' ) ); ?>"><?php esc_html_e( 'Print / Save as PDF', 'your-architect-archie' ); ?></a>
						<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" onsubmit="return confirm('Permanently delete this submission and all of its data? This cannot be undone.');">
							<input type="hidden" name="action" value="yaa_project_delete">
							<input type="hidden" name="project_id" value="<?php echo esc_attr( (int) $row->id ); ?>">
							<?php wp_nonce_field( 'yaa_delete' ); ?>
							<button class="yaa-btn danger" type="submit"><?php esc_html_e( 'Delete', 'your-architect-archie' ); ?></button>
						</form>
					</div>
				</div>
			</div>

			<div class="yaa-grid">
				<div class="yaa-card">
					<div class="yaa-card-head">
						<h2><?php esc_html_e( 'Answers', 'your-architect-archie' ); ?></h2>
						<span class="yaa-sub"><?php echo esc_html( $answered . '/' . count( $summary ) . ' answered' ); ?><?php if ( $dropoff && ! in_array( $row->status, array( 'submitted', 'redirected' ), true ) ) : ?> · <?php echo esc_html__( 'stopped at:', 'your-architect-archie' ) . ' ' . esc_html( $dropoff ); ?><?php endif; ?></span>
					</div>
					<div class="yaa-answers">
						<?php foreach ( $summary as $q ) : ?>
							<div class="yaa-answer <?php echo $q['answered'] ? 'yes' : 'no'; ?>">
								<span class="yaa-a-label"><?php echo esc_html( $q['label'] ); ?></span>
								<span class="yaa-a-value"><?php echo $q['answered'] ? esc_html( $q['value'] ) : '<em>' . esc_html__( 'not answered', 'your-architect-archie' ) . '</em>'; // phpcs:ignore WordPress.Security.EscapeOutput ?></span>
							</div>
						<?php endforeach; ?>
					</div>
				</div>

				<div class="yaa-side">
					<div class="yaa-card">
						<div class="yaa-card-head"><h2><?php esc_html_e( 'Package', 'your-architect-archie' ); ?></h2></div>
						<div class="yaa-nodes">
							<?php if ( empty( $package['nodes'] ) ) : ?>
								<div class="yaa-sub"><?php esc_html_e( 'No package built yet.', 'your-architect-archie' ); ?></div>
							<?php else : foreach ( $package['nodes'] as $n ) : ?>
								<div class="yaa-node">
									<span><?php echo esc_html( isset( $n['label'] ) ? $n['label'] : '' ); ?></span>
									<span><?php echo isset( $n['price'] ) && null !== $n['price'] ? esc_html( YAA_Pricing::money( (int) $n['price'] ) ) : esc_html__( 'quote to follow', 'your-architect-archie' ); ?></span>
								</div>
							<?php endforeach; endif; ?>
							<div class="yaa-node total"><span><?php esc_html_e( 'Total', 'your-architect-archie' ); ?></span><span><?php echo esc_html( YAA_Pricing::money( (int) $row->total ) ); ?></span></div>
						</div>
					</div>

					<div class="yaa-card">
						<div class="yaa-card-head"><h2><?php esc_html_e( 'Activity', 'your-architect-archie' ); ?></h2></div>
						<div class="yaa-timeline">
							<?php if ( empty( $events ) ) : ?>
								<div class="yaa-sub"><?php esc_html_e( 'No activity logged.', 'your-architect-archie' ); ?></div>
							<?php else : foreach ( $events as $e ) : ?>
								<div class="yaa-event"><span class="yaa-dot"></span><span><?php echo esc_html( self::event_label( $e ) ); ?></span><span class="yaa-sub"><?php echo esc_html( self::ago( $e->created ) ); ?></span></div>
							<?php endforeach; endif; ?>
						</div>
					</div>
				</div>
			</div>

			<?php echo self::render_workflow( $row ); // phpcs:ignore WordPress.Security.EscapeOutput ?>

			<div class="yaa-card">
				<div class="yaa-card-head"><h2><?php esc_html_e( 'Conversation', 'your-architect-archie' ); ?></h2></div>
				<div class="yaa-convo">
					<?php if ( empty( $messages ) ) : ?>
						<div class="yaa-sub"><?php esc_html_e( 'No messages.', 'your-architect-archie' ); ?></div>
					<?php else : foreach ( $messages as $m ) : ?>
						<div class="yaa-msg <?php echo 'assistant' === $m['role'] ? 'bot' : 'user'; ?>">
							<span class="yaa-msg-who"><?php echo 'assistant' === $m['role'] ? 'Archie' : esc_html__( 'Visitor', 'your-architect-archie' ); ?></span>
							<span class="yaa-msg-text"><?php echo esc_html( $m['text'] ); ?></span>
						</div>
					<?php endforeach; endif; ?>
				</div>
			</div>
		</div>
		<?php
	}

	// ---- Workflow card (approve → in progress → preview & pay → paid; or decline) ----
	private static function render_workflow( $project ) {
		$pid    = (int) $project->id;
		$status = $project->status;
		$order  = array( 'submitted' => 0, 'approved' => 1, 'in_progress' => 2, 'emailed' => 3, 'preview' => 3, 'paid' => 4 );
		$cur    = isset( $order[ $status ] ) ? $order[ $status ] : ( in_array( $status, array( 'partial', 'quoted' ), true ) ? -1 : 0 );
		$notice = isset( $_GET['notice'] ) ? sanitize_key( wp_unslash( $_GET['notice'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		$notices = array(
			'approved'         => array( 'ok', 'Project approved — send the client the approval email below.' ),
			'started_drawings' => array( 'ok', 'Marked as in progress.' ),
			'rejected'         => array( 'ok', 'Marked as not accepted — send the client the decline email below.' ),
			'drafted'          => array( 'ok', 'Email prepared — review and send below.' ),
			'draft_failed'     => array( 'err', 'Could not prepare the email.' ),
			'saved'            => array( 'ok', 'Draft saved.' ),
			'sent'             => array( 'ok', 'Email sent to the client.' ),
			'send_failed'      => array( 'err', 'Could not send — check the recipient and email settings.' ),
			'survey_received'  => array( 'ok', 'Measured survey marked as received.' ),
			'survey_unmarked'  => array( 'ok', 'Measured survey marked as not yet received.' ),
			'quote_sent'       => array( 'ok', 'The quote was emailed to the client.' ),
			'quote_failed'     => array( 'err', 'Could not email the quote — check the recipient and email settings.' ),
		);
		if ( 'file_failed' === $notice ) {
			$why = get_transient( 'yaa_upload_err_' . get_current_user_id() );
			delete_transient( 'yaa_upload_err_' . get_current_user_id() );
			$notices['file_failed'] = array( 'err', 'Upload failed: ' . ( $why ? $why : 'check the file type/size and your server error log.' ) );
		}
		if ( 'send_failed' === $notice ) {
			$why = get_transient( 'yaa_send_err_' . get_current_user_id() );
			delete_transient( 'yaa_send_err_' . get_current_user_id() );
			if ( $why ) {
				$notices['send_failed'] = array( 'err', 'Could not send: ' . $why . ' — set up an email service (Brevo API key in Settings, or an SMTP plugin).' );
			}
		}
		$post_url = admin_url( 'admin-post.php' );
		$pre_paid = in_array( $status, array( 'submitted', 'approved', 'in_progress', 'emailed', 'preview' ), true );

		// Plans gate: before drawings can start we need the plans they'll be based on
		// — either a measured survey we arrange (client had no drawings), or the
		// client's own existing drawings (they said they have some). Either is
		// "received" once the file is in or we mark it so.
		$state           = YAA_Project::state( $pid );
		$needs_survey    = ! empty( $state['survey'] );
		$needs_drawings  = ! empty( $state['hasDrawings'] );
		$has_client_file = ! empty( YAA_Files::for_project( $pid, 'client' ) );
		$plans_received  = ! empty( $project->survey_received_at ) || $has_client_file;
		$survey_received = $plans_received; // back-compat name used below
		$survey_blocks   = ( ( $needs_survey || $needs_drawings ) && ! $plans_received );

		ob_start();
		?>
		<div class="yaa-card" id="workflow">
			<div class="yaa-card-head"><h2><?php esc_html_e( 'Workflow', 'your-architect-archie' ); ?></h2>
				<a class="yaa-sub" href="<?php echo esc_url( YAA_Portal::url( $pid ) ); ?>" target="_blank" rel="noopener"><?php esc_html_e( 'Open client portal ↗', 'your-architect-archie' ); ?></a>
			</div>

			<?php if ( isset( $notices[ $notice ] ) ) : ?>
				<div class="yaa-notice <?php echo esc_attr( $notices[ $notice ][0] ); ?>"><?php echo esc_html( $notices[ $notice ][1] ); ?></div>
			<?php endif; ?>

			<?php if ( 'redirected' === $status ) : ?>
				<p class="yaa-sub"><?php esc_html_e( 'This is a full-RIBA / larger commission handled directly by Tiam — no online payment flow.', 'your-architect-archie' ); ?></p>

			<?php elseif ( 'rejected' === $status ) : ?>
				<div class="yaa-notice err" style="background:#eef0f4;color:#5b6472;"><?php esc_html_e( 'This enquiry has been marked as not accepted.', 'your-architect-archie' ); ?></div>
				<?php echo self::email_block( $project, 'rejected', __( 'Decline email', 'your-architect-archie' ) ); // phpcs:ignore WordPress.Security.EscapeOutput ?>

			<?php else : ?>

				<div class="yaa-steps">
					<?php foreach ( array( 'Submitted', 'Approved', 'In progress', 'Preview & pay', 'Paid' ) as $i => $label ) : ?>
						<div class="yaa-step <?php echo $cur >= $i ? 'done' : ''; ?>"><span class="yaa-step-n"><?php echo $cur > $i ? '✓' : esc_html( $i + 1 ); ?></span><?php echo esc_html( $label ); ?></div>
					<?php endforeach; ?>
				</div>

				<?php if ( ( $needs_survey || $needs_drawings ) && $pre_paid && ! $project->paid ) : ?>
					<?php if ( $plans_received ) : ?>
						<div class="yaa-survey ok">
							<div><span class="yaa-badge green"><?php echo $needs_drawings ? esc_html__( 'Client drawings received', 'your-architect-archie' ) : esc_html__( 'Measured survey received', 'your-architect-archie' ); ?></span>
								<span class="yaa-sub"><?php echo esc_html( $has_client_file ? __( 'uploaded by the client', 'your-architect-archie' ) : ( $project->survey_received_at ? self::ago( $project->survey_received_at ) : '' ) ); ?></span></div>
							<?php if ( ! $has_client_file ) : ?>
								<form method="post" action="<?php echo esc_url( $post_url ); ?>" class="yaa-inline">
									<input type="hidden" name="action" value="yaa_project_survey">
									<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>">
									<input type="hidden" name="received" value="0">
									<?php wp_nonce_field( 'yaa_workflow' ); ?>
									<button class="yaa-linkbtn"><?php esc_html_e( 'Mark not yet received', 'your-architect-archie' ); ?></button>
								</form>
							<?php endif; ?>
						</div>
					<?php else : ?>
						<div class="yaa-survey warn">
							<div class="yaa-survey-txt">
								<?php if ( $needs_drawings ) : ?>
									<strong>⚠ <?php esc_html_e( 'Client’s own drawings — not yet received', 'your-architect-archie' ); ?></strong>
									<p class="yaa-sub"><?php esc_html_e( 'The client said they already have existing drawings. We need them before work starts — they can upload them, or send them to us by email. Mark received once they’re in.', 'your-architect-archie' ); ?></p>
								<?php else : ?>
									<strong>⚠ <?php esc_html_e( 'Measured survey required — not yet received', 'your-architect-archie' ); ?></strong>
									<p class="yaa-sub"><?php esc_html_e( 'This client had no existing drawings, so the drawings are based on a measured survey arranged separately. Don’t start work until it’s in — mark it received once the surveyor’s file reaches you.', 'your-architect-archie' ); ?></p>
								<?php endif; ?>
							</div>
							<form method="post" action="<?php echo esc_url( $post_url ); ?>" class="yaa-inline">
								<input type="hidden" name="action" value="yaa_project_survey">
								<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>">
								<input type="hidden" name="received" value="1">
								<?php wp_nonce_field( 'yaa_workflow' ); ?>
								<button class="yaa-btn ghost"><?php esc_html_e( 'Mark received', 'your-architect-archie' ); ?></button>
							</form>
						</div>
					<?php endif; ?>
				<?php endif; ?>

				<?php if ( ! $project->paid && is_email( (string) $project->email ) && (int) $project->total > 0 ) : ?>
					<form method="post" action="<?php echo esc_url( $post_url ); ?>" class="yaa-inline" style="margin:4px 0 14px">
						<input type="hidden" name="action" value="yaa_project_quote">
						<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>">
						<?php wp_nonce_field( 'yaa_workflow' ); ?>
						<button class="yaa-linkbtn"><?php esc_html_e( '✉ Email the client their quote', 'your-architect-archie' ); ?></button>
					</form>
				<?php endif; ?>

				<?php if ( 'submitted' === $status ) : ?>
					<p class="yaa-sub"><?php esc_html_e( 'Decide whether to take this project on. Neither button emails the client right away — after you choose, you’ll prepare, edit and send the email yourself.', 'your-architect-archie' ); ?></p>
					<div class="yaa-actions">
						<form method="post" action="<?php echo esc_url( $post_url ); ?>" class="yaa-inline">
							<input type="hidden" name="action" value="yaa_project_approve">
							<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>">
							<?php wp_nonce_field( 'yaa_workflow' ); ?>
							<button class="yaa-btn"><?php esc_html_e( 'Approve project', 'your-architect-archie' ); ?></button>
						</form>
						<form method="post" action="<?php echo esc_url( $post_url ); ?>" class="yaa-inline" onsubmit="return confirm('Mark this enquiry as not accepted? Nothing is emailed yet — you can then edit and send the client a decline email.');">
							<input type="hidden" name="action" value="yaa_project_reject">
							<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>">
							<?php wp_nonce_field( 'yaa_workflow' ); ?>
							<button class="yaa-btn ghost yaa-btn-decline"><?php esc_html_e( 'Not accepted / decline…', 'your-architect-archie' ); ?></button>
						</form>
					</div>
				<?php endif; ?>

				<?php if ( 'approved' === $status ) : ?>
					<?php echo self::email_block( $project, 'approved', __( 'Approval email (preparing drawings)', 'your-architect-archie' ) ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
					<?php $start_confirm = $survey_blocks ? "return confirm('The plans the drawings are based on (survey or the client\u2019s own drawings) are not recorded as received yet. Start drawings anyway?');" : ''; ?>
					<form method="post" action="<?php echo esc_url( $post_url ); ?>" class="yaa-inline" onsubmit="<?php echo esc_attr( $start_confirm ); ?>">
						<input type="hidden" name="action" value="yaa_project_start">
						<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>">
						<?php wp_nonce_field( 'yaa_workflow' ); ?>
						<button class="yaa-btn ghost"><?php esc_html_e( 'Mark drawings started →', 'your-architect-archie' ); ?></button>
					</form>
				<?php endif; ?>

				<?php if ( 'in_progress' === $status ) : ?>
					<?php echo self::email_block( $project, 'progress', __( '“Drawings in progress” email (optional)', 'your-architect-archie' ) ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
				<?php endif; ?>

				<?php if ( $cur >= 1 ) : ?>
					<?php echo self::render_files_admin( $project ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
				<?php endif; ?>

				<?php if ( in_array( $status, array( 'in_progress', 'emailed', 'preview' ), true ) ) : ?>
					<?php echo self::email_block( $project, 'preview', __( 'Preview ready — send the payment link', 'your-architect-archie' ) ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
				<?php endif; ?>

				<div class="yaa-wf-block">
					<h3><?php esc_html_e( 'Payment', 'your-architect-archie' ); ?></h3>
					<?php if ( $project->paid ) : ?>
						<div class="yaa-badge green"><?php esc_html_e( 'Paid', 'your-architect-archie' ); ?></div>
						<span class="yaa-sub"><?php echo esc_html( YAA_Pricing::money( (int) round( $project->amount_paid / 100 ) ) ); ?> · <?php echo esc_html( $project->paid_at ? self::ago( $project->paid_at ) : '' ); ?></span>
						<p class="yaa-sub"><?php esc_html_e( 'A receipt was emailed automatically and the drawings are unlocked in the portal.', 'your-architect-archie' ); ?></p>
					<?php else : ?>
						<p class="yaa-sub"><?php esc_html_e( 'Awaiting payment. The client pays via the secure portal link in the preview email.', 'your-architect-archie' ); ?></p>
					<?php endif; ?>
				</div>

				<?php if ( $pre_paid && 'submitted' !== $status ) : ?>
					<form method="post" action="<?php echo esc_url( $post_url ); ?>" class="yaa-inline yaa-decline" onsubmit="return confirm('Mark this enquiry as not accepted? You can then send the client a decline email.');">
						<input type="hidden" name="action" value="yaa_project_reject">
						<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>">
						<?php wp_nonce_field( 'yaa_workflow' ); ?>
						<button class="yaa-btn ghost yaa-btn-decline"><?php esc_html_e( 'Not accepted / decline…', 'your-architect-archie' ); ?></button>
					</form>
				<?php endif; ?>

			<?php endif; ?>
		</div>
		<?php
		return ob_get_clean();
	}

	/**
	 * Compose/send block for one editable stage email (approved, progress, preview,
	 * rejected). Shows a "prepare" button, then an editable draft, then a sent summary.
	 */
	private static function email_block( $project, $kind, $heading ) {
		$pid      = (int) $project->id;
		$email    = YAA_Email::latest_of_kind( $pid, $kind );
		$post_url = admin_url( 'admin-post.php' );
		$has_cta  = ( 'preview' === $kind );
		ob_start();
		?>
		<div class="yaa-wf-block">
			<h3><?php echo esc_html( $heading ); ?></h3>
			<?php if ( ! $email || ( 'sent' === $email->status && isset( $_GET['redraft'] ) && $kind === $_GET['redraft'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
				<form method="post" action="<?php echo esc_url( $post_url ); ?>">
					<input type="hidden" name="action" value="yaa_email_draft">
					<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>">
					<input type="hidden" name="kind" value="<?php echo esc_attr( $kind ); ?>">
					<?php wp_nonce_field( 'yaa_workflow' ); ?>
					<p class="yaa-sub"><?php esc_html_e( 'Prepare this email from your saved template — you can edit it before sending.', 'your-architect-archie' ); ?></p>
					<button class="yaa-btn"><?php esc_html_e( 'Prepare email', 'your-architect-archie' ); ?></button>
				</form>
			<?php elseif ( 'sent' === $email->status ) : ?>
				<div class="yaa-email-sent">
					<div class="yaa-badge green"><?php esc_html_e( 'Sent', 'your-architect-archie' ); ?></div>
					<span class="yaa-sub"><?php echo esc_html( $email->sent_at ? self::ago( $email->sent_at ) : '' ); ?> · <?php echo esc_html( (int) $email->opens ); ?> <?php esc_html_e( 'opens', 'your-architect-archie' ); ?> · <?php echo esc_html( (int) $email->clicks ); ?> <?php esc_html_e( 'clicks', 'your-architect-archie' ); ?></span>
					<div class="yaa-email-preview"><strong><?php echo esc_html( $email->subject ); ?></strong><p><?php echo nl2br( esc_html( $email->body ) ); ?></p></div>
					<a class="yaa-sub" href="<?php echo esc_url( add_query_arg( array( 'page' => self::SLUG, 'project' => $pid, 'redraft' => $kind ), admin_url( 'admin.php' ) ) . '#workflow' ); ?>"><?php esc_html_e( 'Send another', 'your-architect-archie' ); ?></a>
				</div>
			<?php else : ?>
				<form method="post" action="<?php echo esc_url( $post_url ); ?>" class="yaa-email-form">
					<input type="hidden" name="action" value="yaa_email_save">
					<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>">
					<input type="hidden" name="email_id" value="<?php echo esc_attr( (int) $email->id ); ?>">
					<?php wp_nonce_field( 'yaa_workflow' ); ?>
					<label><?php esc_html_e( 'Subject', 'your-architect-archie' ); ?></label>
					<input type="text" name="subject" value="<?php echo esc_attr( $email->subject ); ?>" class="yaa-input">
					<label><?php echo $has_cta ? esc_html__( 'Body (the “view preview & pay” button is added automatically)', 'your-architect-archie' ) : esc_html__( 'Body', 'your-architect-archie' ); ?></label>
					<textarea name="body" rows="9" class="yaa-input"><?php echo esc_textarea( $email->body ); ?></textarea>
					<div class="yaa-inline">
						<button class="yaa-btn ghost"><?php esc_html_e( 'Save draft', 'your-architect-archie' ); ?></button>
					</div>
				</form>
				<form method="post" action="<?php echo esc_url( $post_url ); ?>" class="yaa-inline" onsubmit="return confirm('Send this email to the client?');">
					<input type="hidden" name="action" value="yaa_email_send">
					<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>">
					<input type="hidden" name="email_id" value="<?php echo esc_attr( (int) $email->id ); ?>">
					<?php wp_nonce_field( 'yaa_workflow' ); ?>
					<button class="yaa-btn"><?php esc_html_e( 'Send to client', 'your-architect-archie' ); ?></button>
				</form>
			<?php endif; ?>
		</div>
		<?php
		return ob_get_clean();
	}

	/** Tiam file uploads (drawings + third-party docs) with the paywall note. */
	private static function render_files_admin( $project ) {
		$pid   = (int) $project->id;
		$files = class_exists( 'YAA_Files' ) ? YAA_Files::for_project( $pid ) : array();
		$post_url = admin_url( 'admin-post.php' );
		ob_start();
		?>
		<div class="yaa-wf-block" id="files">
			<h3><?php esc_html_e( 'Drawings & documents', 'your-architect-archie' ); ?></h3>
			<div class="yaa-file-list">
				<?php if ( empty( $files ) ) : ?>
					<span class="yaa-sub"><?php esc_html_e( 'Nothing uploaded yet.', 'your-architect-archie' ); ?></span>
				<?php else : foreach ( $files as $f ) : ?>
					<div class="yaa-file-row">
						<span class="yaa-file-kind <?php echo esc_attr( $f->kind ); ?>"><?php echo esc_html( ucfirst( $f->kind ) ); ?></span>
						<span><?php echo esc_html( YAA_Files::filename( $f ) ); ?><?php echo $f->source ? ' · ' . esc_html( $f->source ) : ''; ?></span>
						<?php if ( 'drawing' === $f->kind ) : ?><span class="yaa-flag <?php echo $project->paid ? '' : 'warn'; ?>"><?php echo $project->paid ? esc_html__( 'released', 'your-architect-archie' ) : esc_html__( 'locked until paid', 'your-architect-archie' ); ?></span><?php endif; ?>
						<form method="post" action="<?php echo esc_url( $post_url ); ?>" class="yaa-del" onsubmit="return confirm('Delete this file?');">
							<input type="hidden" name="action" value="yaa_files_delete">
							<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>">
							<input type="hidden" name="file_id" value="<?php echo esc_attr( (int) $f->id ); ?>">
							<?php wp_nonce_field( 'yaa_files' ); ?>
							<button class="yaa-x" aria-label="Delete">✕</button>
						</form>
					</div>
				<?php endforeach; endif; ?>
			</div>
			<form method="post" action="<?php echo esc_url( $post_url ); ?>" enctype="multipart/form-data" class="yaa-upload">
				<input type="hidden" name="action" value="yaa_files_upload">
				<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>">
				<?php wp_nonce_field( 'yaa_files' ); ?>
				<select name="kind">
					<option value="drawing"><?php esc_html_e( 'Drawing (locked until paid)', 'your-architect-archie' ); ?></option>
					<option value="doc"><?php esc_html_e( 'Document (always visible)', 'your-architect-archie' ); ?></option>
				</select>
				<input type="text" name="label" placeholder="<?php esc_attr_e( 'Label (optional)', 'your-architect-archie' ); ?>" class="yaa-input">
				<input type="text" name="source" placeholder="<?php esc_attr_e( 'Source, e.g. Third-party surveyor', 'your-architect-archie' ); ?>" class="yaa-input">
				<input type="file" name="file" required>
				<button class="yaa-btn"><?php esc_html_e( 'Upload', 'your-architect-archie' ); ?></button>
			</form>
			<p class="yaa-sub"><?php esc_html_e( 'Third-party documents (e.g. a surveyor) — the client pays that provider directly, not Tiam.', 'your-architect-archie' ); ?></p>
		</div>
		<?php
		return ob_get_clean();
	}

	// ---- Helpers ----
	private static function type_label( $type ) {
		$map = array(
			'extension'   => 'Rear / side extension',
			'loft'        => 'Loft / mansard',
			'garage'      => 'Garage conversion',
			'outbuilding' => 'Outbuilding',
			'internal'    => 'Internal alterations',
			'newdwelling' => 'New dwelling',
		);
		return isset( $map[ $type ] ) ? $map[ $type ] : '—';
	}

	private static function badge( $status ) {
		$map = array(
			'partial'    => array( 'Started', 'amber' ),
			'quoted'     => array( 'Quoted', 'amber' ),
			'submitted'  => array( 'Submitted', 'green' ),
			'approved'   => array( 'Approved', 'green' ),
			'in_progress' => array( 'In progress', 'green' ),
			'emailed'    => array( 'Preview sent', 'green' ),
			'preview'    => array( 'Preview sent', 'green' ),
			'paid'       => array( 'Paid', 'green' ),
			'rejected'   => array( 'Not accepted', 'grey' ),
			'redirected' => array( 'RIBA / Tiam', 'purple' ),
			'recovered'  => array( 'Recovered', 'blue' ),
			'abandoned'  => array( 'Abandoned', 'grey' ),
		);
		$b = isset( $map[ $status ] ) ? $map[ $status ] : array( ucfirst( (string) $status ), 'grey' );
		return '<span class="yaa-badge ' . esc_attr( $b[1] ) . '">' . esc_html( $b[0] ) . '</span>';
	}

	private static function event_label( $e ) {
		$labels = array(
			'created'       => 'Started the chat',
			'status_change' => 'Status changed',
			'submitted'     => 'Submitted',
			'followup_sent' => 'Follow-up email sent',
		);
		$meta = json_decode( (string) $e->meta_json, true );
		if ( 'status_change' === $e->type && ! empty( $meta['status'] ) ) {
			return 'Status → ' . $meta['status'];
		}
		return isset( $labels[ $e->type ] ) ? $labels[ $e->type ] : ucfirst( str_replace( '_', ' ', (string) $e->type ) );
	}

	private static function date( $mysql ) {
		$ts = strtotime( (string) $mysql );
		return $ts ? date_i18n( 'j M Y, H:i', $ts ) : '—';
	}
	private static function ago( $mysql ) {
		$ts = strtotime( (string) $mysql );
		if ( ! $ts ) {
			return '—';
		}
		return human_time_diff( $ts, current_time( 'timestamp' ) ) . ' ago';
	}

	private static function css() {
		return '
		.yaa-admin { --navy:#253E94; --blue:#2f5fe0; --ink:#1a2233; --muted:#6b7488; --line:#e6e9f2; --bg:#f6f8fd; max-width:1180px; }
		.yaa-admin * { box-sizing:border-box; }
		.yaa-admin .yaa-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin:8px 0 18px; }
		.yaa-head-actions { display:flex; gap:8px; align-items:center; }
		.yaa-admin h1 { font-size:1.7rem; color:var(--navy); display:flex; align-items:center; gap:12px; margin:0; padding:0; }
		.yaa-admin h2 { font-size:1rem; color:var(--navy); margin:0; }
		.yaa-back { display:inline-block; color:var(--blue); text-decoration:none; font-weight:600; margin-bottom:6px; }
		.yaa-meta { color:var(--muted); margin:6px 0 0; }
		.yaa-total-big { font-size:1.8rem; font-weight:800; color:var(--navy); white-space:nowrap; }
		.yaa-btn { background:var(--navy); color:#fff !important; border-radius:8px; padding:8px 14px; text-decoration:none; font-weight:600; align-self:center; }
		.yaa-stats { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:18px; }
		.yaa-stat { background:#fff; border:2px solid var(--line); border-radius:12px; padding:14px 16px; }
		.yaa-stat .n { display:block; font-size:1.6rem; font-weight:800; color:var(--navy); }
		.yaa-stat .l { color:var(--muted); font-size:.85rem; }
		.yaa-tabs { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-bottom:14px; }
		.yaa-tab { display:inline-flex; align-items:center; gap:7px; padding:8px 14px; border-radius:999px; text-decoration:none; color:var(--ink); background:#fff; border:2px solid var(--line); font-weight:600; }
		.yaa-tab.is-active { background:var(--navy); color:#fff; border-color:var(--navy); }
		.yaa-tab-n { background:rgba(0,0,0,.08); border-radius:999px; padding:1px 8px; font-size:.78rem; }
		.yaa-tab.is-active .yaa-tab-n { background:rgba(255,255,255,.25); }
		.yaa-search { margin-left:auto; }
		.yaa-search input { border:2px solid var(--line); border-radius:999px; padding:7px 14px; min-width:240px; }
		.yaa-table { width:100%; border-collapse:separate; border-spacing:0; background:#fff; border:2px solid var(--line); border-radius:12px; overflow:hidden; }
		.yaa-table th { text-align:left; font-size:.78rem; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); padding:12px 14px; border-bottom:2px solid var(--line); }
		.yaa-table td { padding:12px 14px; border-bottom:1px solid var(--line); vertical-align:middle; }
		.yaa-table tbody tr { cursor:pointer; }
		.yaa-table tbody tr:hover { background:var(--bg); }
		.yaa-table tbody tr:last-child td { border-bottom:0; }
		.yaa-who { font-weight:700; color:var(--navy); text-decoration:none; }
		.yaa-sub { color:var(--muted); font-size:.83rem; }
		.yaa-total { font-weight:800; color:var(--navy); }
		.yaa-flags { display:flex; flex-wrap:wrap; gap:4px; margin-top:4px; }
		.yaa-flag { font-size:.72rem; font-weight:700; padding:2px 8px; border-radius:999px; background:#eef2fb; color:var(--navy); }
		.yaa-flag.warn { background:#fff4e5; color:#a15c00; }
		.yaa-badge { font-size:.75rem; font-weight:700; padding:3px 10px; border-radius:999px; }
		.yaa-badge.amber { background:#fff4e5; color:#a15c00; }
		.yaa-badge.green { background:#e5f6ec; color:#0f7a3d; }
		.yaa-badge.purple { background:#efe9fb; color:#5b34c7; }
		.yaa-badge.grey { background:#eef0f4; color:#5b6472; }
		.yaa-badge.blue { background:#e8f0fe; color:#2456c8; }
		.yaa-badge.red { background:#fde8e8; color:#b42318; }
		.yaa-emails-meta { color:var(--muted); font-size:.82rem; }
		.yaa-survey { display:flex; gap:16px; align-items:center; justify-content:space-between; flex-wrap:wrap; border-radius:12px; padding:14px 16px; margin:14px 0; }
		.yaa-survey.warn { background:#fff7ed; border:1px solid #f3c98b; }
		.yaa-survey.ok { background:#f0f9f2; border:1px solid #bfe4c9; }
		.yaa-survey-txt { max-width:640px; }
		.yaa-survey-txt strong { color:#a15c00; display:block; }
		.yaa-survey-txt p { margin:4px 0 0; }
		.yaa-linkbtn { background:none; border:none; color:var(--muted); text-decoration:underline; cursor:pointer; padding:0; font-size:.82rem; }
		.yaa-linkbtn:hover { color:var(--navy); }
		.yaa-progress { width:80px; height:7px; border-radius:999px; background:var(--line); overflow:hidden; }
		.yaa-progress span { display:block; height:100%; background:var(--blue); }
		.yaa-empty { background:#fff; border:2px dashed var(--line); border-radius:12px; padding:34px; text-align:center; color:var(--muted); }
		.yaa-grid { display:grid; grid-template-columns:1.35fr 1fr; gap:16px; margin-bottom:16px; }
		.yaa-card { background:#fff; border:2px solid var(--line); border-radius:14px; padding:16px 18px; margin-bottom:16px; }
		.yaa-side .yaa-card:last-child { margin-bottom:0; }
		.yaa-card-head { display:flex; align-items:baseline; justify-content:space-between; gap:10px; margin-bottom:12px; }
		.yaa-answers { display:flex; flex-direction:column; }
		.yaa-answer { display:flex; justify-content:space-between; gap:14px; padding:9px 0; border-bottom:1px solid var(--line); }
		.yaa-answer:last-child { border-bottom:0; }
		.yaa-a-label { color:var(--ink); font-weight:600; }
		.yaa-a-value { color:var(--navy); text-align:right; }
		.yaa-answer.no .yaa-a-label { color:var(--muted); font-weight:500; }
		.yaa-answer.no .yaa-a-value em { color:#b7bdc9; font-style:italic; }
		.yaa-answer.yes .yaa-a-label::before { content:"✓"; color:#0f7a3d; font-weight:800; margin-right:8px; }
		.yaa-node { display:flex; justify-content:space-between; gap:10px; padding:7px 0; border-bottom:1px solid var(--line); }
		.yaa-node.total { border-bottom:0; font-weight:800; color:var(--navy); padding-top:10px; }
		.yaa-timeline, .yaa-convo { display:flex; flex-direction:column; gap:9px; }
		.yaa-event { display:flex; align-items:center; gap:9px; }
		.yaa-dot { width:8px; height:8px; border-radius:999px; background:var(--blue); flex:0 0 auto; }
		.yaa-event .yaa-sub { margin-left:auto; }
		.yaa-msg { display:flex; flex-direction:column; gap:2px; padding:8px 12px; border-radius:10px; background:var(--bg); max-width:80%; }
		.yaa-msg.bot { align-self:flex-start; }
		.yaa-msg.user { align-self:flex-end; background:#eaf0ff; }
		.yaa-msg-who { font-size:.72rem; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.03em; }
		.yaa-msg-text { color:var(--ink); }
		.yaa-notice { border-radius:10px; padding:10px 14px; margin-bottom:14px; font-weight:600; }
		.yaa-notice.ok { background:#e5f6ec; color:#0f7a3d; }
		.yaa-notice.err { background:#fdecec; color:#c0392b; }
		.yaa-steps { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px; }
		.yaa-step { display:flex; align-items:center; gap:8px; padding:8px 14px; border-radius:999px; background:var(--bg); border:2px solid var(--line); color:var(--muted); font-weight:600; font-size:.86rem; }
		.yaa-step.done { background:#eaf0ff; border-color:var(--blue); color:var(--navy); }
		.yaa-step-n { width:20px; height:20px; border-radius:999px; background:#fff; border:1.5px solid currentColor; display:inline-flex; align-items:center; justify-content:center; font-size:.72rem; }
		.yaa-wf-block { border-top:1px solid var(--line); margin-top:16px; padding-top:16px; }
		.yaa-wf-block h3 { margin:0 0 10px; color:var(--navy); font-size:1rem; }
		.yaa-inline { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top:8px; }
		.yaa-btn.ghost { background:#fff; color:var(--navy) !important; border:2px solid var(--line); }
		.yaa-btn { border:0; cursor:pointer; font-family:inherit; font-size:.9rem; }
		.yaa-input { width:100%; border:2px solid var(--line); border-radius:9px; padding:9px 12px; font-family:inherit; margin:4px 0 12px; }
		.yaa-email-form label { font-weight:600; font-size:.85rem; color:var(--ink); }
		.yaa-email-preview { background:var(--bg); border-radius:10px; padding:12px 14px; margin-top:10px; }
		.yaa-email-preview p { color:var(--ink); margin:6px 0 0; }
		.yaa-file-list { display:flex; flex-direction:column; gap:8px; margin-bottom:12px; }
		.yaa-file-row { display:flex; align-items:center; gap:10px; padding:8px 10px; border:1.5px solid var(--line); border-radius:9px; }
		.yaa-file-kind { font-size:.72rem; font-weight:700; padding:2px 8px; border-radius:999px; background:#eef2fb; color:var(--navy); text-transform:uppercase; }
		.yaa-file-kind.drawing { background:#eae4fb; color:#5b34c7; }
		.yaa-file-row .yaa-del { margin-left:auto; }
		.yaa-x { background:none; border:0; color:var(--muted); cursor:pointer; font-size:1rem; }
		.yaa-row-actions { text-align:right; width:44px; }
		.yaa-row-actions .yaa-x:hover { color:#c0392b; }
		.yaa-col-actions { width:44px; }
		.yaa-col-check { width:34px; text-align:center; }
		.yaa-col-check input { cursor:pointer; }
		.yaa-bulkbar { display:flex; align-items:center; gap:12px; margin:0 0 12px; }
		.yaa-bulk-del { background:#fff; border:2px solid var(--line); color:var(--muted); font-weight:700; border-radius:999px; padding:7px 16px; cursor:pointer; font-size:.85rem; }
		.yaa-bulk-del:not([disabled]) { border-color:#e0b4b0; color:#c0392b; }
		.yaa-bulk-del:not([disabled]):hover { background:#fbeceb; border-color:#c0392b; }
		.yaa-bulk-del[disabled] { opacity:.55; cursor:not-allowed; }
		.yaa-bulk-hint { color:var(--muted); font-size:.82rem; }
		.yaa-head-right { display:flex; flex-direction:column; align-items:flex-end; gap:10px; }
		.yaa-btn.danger { background:#fff; color:#c0392b !important; border:2px solid #f0c9c4; }
		.yaa-btn.danger:hover { background:#c0392b; color:#fff !important; border-color:#c0392b; }
		.yaa-actions { display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-top:4px; }
		.yaa-decline { border-top:1px solid var(--line); margin-top:16px; padding-top:16px; }
		.yaa-btn-decline { color:#a15c00 !important; border-color:#f0d9b0; }
		.yaa-btn-decline:hover { background:#fff4e5; border-color:#a15c00; }
		.yaa-upload { display:flex; flex-wrap:wrap; gap:8px; align-items:center; background:var(--bg); padding:12px; border-radius:10px; }
		.yaa-upload .yaa-input { width:auto; flex:1; min-width:140px; margin:0; }
		.yaa-upload select { border:2px solid var(--line); border-radius:9px; padding:8px 10px; font-family:inherit; }
		@media (max-width:900px){ .yaa-grid{grid-template-columns:1fr;} .yaa-stats{grid-template-columns:repeat(2,1fr);} }
		';
	}
}
