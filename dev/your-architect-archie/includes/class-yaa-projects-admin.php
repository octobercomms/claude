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
			'abandoned'  => array( 'label' => 'Abandoned',  'statuses' => array( 'abandoned' ) ),
		);
	}

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'assets' ) );
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
				<a class="yaa-btn" href="<?php echo esc_url( admin_url( 'admin.php?page=yaa-settings' ) ); ?>"><?php esc_html_e( 'Settings', 'your-architect-archie' ); ?></a>
			</div>

			<div class="yaa-stats">
				<div class="yaa-stat"><span class="n"><?php echo esc_html( $total_n ); ?></span><span class="l"><?php esc_html_e( 'All projects', 'your-architect-archie' ); ?></span></div>
				<div class="yaa-stat"><span class="n"><?php echo esc_html( $started_n ); ?></span><span class="l"><?php esc_html_e( 'Started, not submitted', 'your-architect-archie' ); ?></span></div>
				<div class="yaa-stat"><span class="n"><?php echo esc_html( $submitted_n ); ?></span><span class="l"><?php esc_html_e( 'Submitted', 'your-architect-archie' ); ?></span></div>
				<div class="yaa-stat"><span class="n"><?php echo esc_html( $conv ); ?>%</span><span class="l"><?php esc_html_e( 'Submit rate', 'your-architect-archie' ); ?></span></div>
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
				<div class="yaa-empty"><?php esc_html_e( 'No projects here yet.', 'your-architect-archie' ); ?></div>
			<?php else : ?>
			<table class="yaa-table">
				<thead>
					<tr>
						<th><?php esc_html_e( 'Person', 'your-architect-archie' ); ?></th>
						<th><?php esc_html_e( 'Status', 'your-architect-archie' ); ?></th>
						<th><?php esc_html_e( 'Project', 'your-architect-archie' ); ?></th>
						<th><?php esc_html_e( 'Progress', 'your-architect-archie' ); ?></th>
						<th><?php esc_html_e( 'Total', 'your-architect-archie' ); ?></th>
						<th><?php esc_html_e( 'Last activity', 'your-architect-archie' ); ?></th>
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
					</tr>
				<?php endforeach; ?>
				</tbody>
			</table>
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
					<a class="yaa-back" href="<?php echo $back; // phpcs:ignore WordPress.Security.EscapeOutput ?>">&larr; <?php esc_html_e( 'All projects', 'your-architect-archie' ); ?></a>
					<h1><?php echo esc_html( $who ); ?> <?php echo self::badge( $row->status ); // phpcs:ignore WordPress.Security.EscapeOutput ?></h1>
					<p class="yaa-meta">
						<?php if ( $row->email ) : ?><?php echo esc_html( $row->email ); ?> · <?php endif; ?>
						<?php if ( $row->ref ) : ?>Ref <?php echo esc_html( $row->ref ); ?> · <?php endif; ?>
						<?php esc_html_e( 'Started', 'your-architect-archie' ); ?> <?php echo esc_html( self::date( $row->created ) ); ?>
						<?php if ( $row->submitted_at ) : ?> · <?php esc_html_e( 'Submitted', 'your-architect-archie' ); ?> <?php echo esc_html( self::date( $row->submitted_at ) ); ?><?php endif; ?>
					</p>
				</div>
				<div class="yaa-total-big"><?php echo esc_html( YAA_Pricing::money( (int) $row->total ) ); ?></div>
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
			'redirected' => array( 'RIBA / Tiam', 'purple' ),
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
		@media (max-width:900px){ .yaa-grid{grid-template-columns:1fr;} .yaa-stats{grid-template-columns:repeat(2,1fr);} }
		';
	}
}
