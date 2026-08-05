<?php
/**
 * Blog Autopilot module.
 *
 * The first capability: a per-site brief plus (from the next build increment) a
 * scheduled research → draft → optimise → QA → review → publish pipeline that
 * turns Claude into the site's editorial team. This increment ships the module
 * shell — its gated menu, the brief the pipeline will run on, and an engine
 * status readout — so the plumbing (module gating, dual-mode Claude client) is
 * proven end to end before the pipeline lands.
 *
 * Only booted when the module is enabled (see OctoberMI_Modules), so a site that
 * doesn't want it carries none of this.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OctoberMI_Blog_Module extends OctoberMI_Module {

	const CAP         = 'manage_options';
	const MENU_SLUG   = 'october-mi-blog';
	const BRIEF_OPTION = 'octobermi_blog_brief';

	public function id() {
		return 'blog';
	}

	public function label() {
		return __( 'Blog Autopilot', 'october-mi' );
	}

	public function description() {
		return __( 'Research, draft, optimise and publish premium blog posts on a schedule — reviewed by a real author before they go live.', 'october-mi' );
	}

	public function activate() {
		if ( false === get_option( self::BRIEF_OPTION, false ) ) {
			add_option( self::BRIEF_OPTION, self::brief_defaults(), '', false );
		}
	}

	public function boot() {
		add_action( 'admin_menu', array( $this, 'register_menu' ), 20 );
		add_action( 'admin_post_octobermi_blog_save_brief', array( $this, 'handle_save_brief' ) );
		add_action( 'admin_post_octobermi_blog_learn', array( $this, 'handle_learn' ) );
		add_action( 'wp_ajax_octobermi_blog_job_status', array( $this, 'ajax_job_status' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_assets' ) );

		// This module's background job handlers (registered in every request,
		// including WP-Cron, so queued jobs can run).
		OctoberMI_Jobs::register_handler(
			OctoberMI_Blog_Context_Pack::JOB_TYPE,
			array( 'OctoberMI_Blog_Context_Pack', 'run_job' )
		);
	}

	public function enqueue_assets( $hook ) {
		$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		if ( self::MENU_SLUG !== $page ) {
			return;
		}
		wp_enqueue_script(
			'octobermi-blog',
			OCTOBERMI_URL . 'modules/blog/blog-admin.js',
			array(),
			OCTOBERMI_VERSION,
			true
		);
		wp_localize_script( 'octobermi-blog', 'OctoberMIBlog', array(
			'ajaxUrl' => admin_url( 'admin-ajax.php' ),
			'nonce'   => wp_create_nonce( 'octobermi_blog_status' ),
		) );
	}

	// =====================================================================
	// Brief
	// =====================================================================

	public static function brief_defaults() {
		return array(
			'topics'       => '',
			'audience'     => '',
			'tone'         => '',
			'author_id'    => 0,
			'cadence'      => 'weekly',
			'word_target'  => 1400,
			'publish_mode' => 'draft', // 'draft' (review) | 'auto' (trusted auto-publish)
		);
	}

	public static function brief() {
		$stored = get_option( self::BRIEF_OPTION, array() );
		if ( ! is_array( $stored ) ) {
			$stored = array();
		}
		return array_merge( self::brief_defaults(), $stored );
	}

	public function register_menu() {
		add_submenu_page(
			OctoberMI_Admin::SLUG,
			$this->label(),
			$this->label(),
			self::CAP,
			self::MENU_SLUG,
			array( $this, 'render_page' )
		);
	}

	public function handle_save_brief() {
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( esc_html__( 'You do not have permission to do that.', 'october-mi' ) );
		}
		check_admin_referer( 'octobermi_blog_save_brief' );

		$modes    = array( 'draft', 'auto' );
		$cadences = array( 'weekly', 'biweekly', 'monthly' );

		$brief = array(
			'topics'       => isset( $_POST['topics'] ) ? sanitize_textarea_field( wp_unslash( $_POST['topics'] ) ) : '',
			'audience'     => isset( $_POST['audience'] ) ? sanitize_textarea_field( wp_unslash( $_POST['audience'] ) ) : '',
			'tone'         => isset( $_POST['tone'] ) ? sanitize_textarea_field( wp_unslash( $_POST['tone'] ) ) : '',
			'author_id'    => isset( $_POST['author_id'] ) ? absint( $_POST['author_id'] ) : 0,
			'cadence'      => isset( $_POST['cadence'] ) && in_array( $_POST['cadence'], $cadences, true ) ? sanitize_key( $_POST['cadence'] ) : 'weekly',
			'word_target'  => isset( $_POST['word_target'] ) ? max( 300, min( 5000, absint( $_POST['word_target'] ) ) ) : 1400,
			'publish_mode' => isset( $_POST['publish_mode'] ) && in_array( $_POST['publish_mode'], $modes, true ) ? sanitize_key( $_POST['publish_mode'] ) : 'draft',
		);

		update_option( self::BRIEF_OPTION, $brief, false );

		wp_safe_redirect( add_query_arg(
			array( 'page' => self::MENU_SLUG, 'octobermi_notice' => rawurlencode( __( 'Brief saved.', 'october-mi' ) ), 'octobermi_ok' => '1' ),
			admin_url( 'admin.php' )
		) );
		exit;
	}

	// =====================================================================
	// Learn my site (Context Pack)
	// =====================================================================

	public function handle_learn() {
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( esc_html__( 'You do not have permission to do that.', 'october-mi' ) );
		}
		check_admin_referer( 'octobermi_blog_learn' );

		if ( ! OctoberMI_Claude::available() ) {
			$msg = __( 'Add a Claude API key (or connect a managed key) before learning your site.', 'october-mi' );
			$ok  = false;
		} else {
			OctoberMI_Blog_Context_Pack::start();
			$msg = __( 'Learning your site… this runs in the background and takes a minute.', 'october-mi' );
			$ok  = true;
		}

		wp_safe_redirect( add_query_arg(
			array( 'page' => self::MENU_SLUG, 'octobermi_notice' => rawurlencode( $msg ), 'octobermi_ok' => $ok ? '1' : '0' ),
			admin_url( 'admin.php' )
		) );
		exit;
	}

	/** Poll endpoint for the latest learn job's state. */
	public function ajax_job_status() {
		check_ajax_referer( 'octobermi_blog_status', 'nonce' );
		if ( ! current_user_can( self::CAP ) ) {
			wp_send_json_error( array( 'message' => __( 'Not allowed.', 'october-mi' ) ), 403 );
		}
		$job = OctoberMI_Jobs::latest_of_type( OctoberMI_Blog_Context_Pack::JOB_TYPE );
		if ( ! $job ) {
			wp_send_json_success( array( 'status' => 'none' ) );
		}
		wp_send_json_success( array(
			'status'   => $job['status'],
			'progress' => (int) $job['progress'],
			'note'     => $job['note'],
			'error'    => $job['error'],
		) );
	}

	// =====================================================================
	// Page
	// =====================================================================

	public function render_page() {
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( esc_html__( 'You do not have permission to view this page.', 'october-mi' ) );
		}

		$brief          = self::brief();
		$engine_ready   = OctoberMI_Claude::available();
		$backend        = OctoberMI_Claude::backend_label();
		$pack           = OctoberMI_Blog_Context_Pack::get();
		$learn_job      = OctoberMI_Jobs::latest_of_type( OctoberMI_Blog_Context_Pack::JOB_TYPE );
		$learn_running  = $learn_job && in_array( $learn_job['status'], array( 'queued', 'running' ), true );
		$notice         = isset( $_GET['octobermi_notice'] ) ? sanitize_text_field( wp_unslash( $_GET['octobermi_notice'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$notice_ok      = isset( $_GET['octobermi_ok'] ) ? (bool) (int) $_GET['octobermi_ok'] : true; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		?>
		<div class="wrap octobermi-wrap">
			<h1><?php esc_html_e( 'Blog Autopilot', 'october-mi' ); ?></h1>
			<p class="octobermi-tagline">
				<?php esc_html_e( 'Brief the engine once. It researches topics, drafts on brand, optimises for search and AI answer engines, and hands each post to your author to approve before it publishes.', 'october-mi' ); ?>
			</p>

			<?php if ( '' !== $notice ) : ?>
				<div class="notice <?php echo $notice_ok ? 'notice-success' : 'notice-error'; ?> is-dismissible">
					<p><?php echo esc_html( $notice ); ?></p>
				</div>
			<?php endif; ?>

			<div class="octobermi-card">
				<h2><?php esc_html_e( 'Engine status', 'october-mi' ); ?></h2>
				<p>
					<?php if ( $engine_ready ) : ?>
						<span class="octobermi-ok">&#10003; <?php esc_html_e( 'Ready', 'october-mi' ); ?></span>
						&mdash;
						<?php
						/* translators: %s: which key backend is active. */
						printf( esc_html__( 'using %s.', 'october-mi' ), '<strong>' . esc_html( $backend ) . '</strong>' );
						?>
					<?php else : ?>
						<span class="octobermi-fail">&#10007; <?php esc_html_e( 'Not configured', 'october-mi' ); ?></span>
						&mdash;
						<?php
						printf(
							/* translators: %s: link to the Settings page. */
							esc_html__( 'Add a Claude API key (or connect a managed key) on the %s page.', 'october-mi' ),
							'<a href="' . esc_url( admin_url( 'admin.php?page=' . OctoberMI_Admin::SLUG ) ) . '">' . esc_html__( 'Settings', 'october-mi' ) . '</a>'
						);
						?>
					<?php endif; ?>
				</p>
				<p class="description">
					<?php esc_html_e( 'Scheduled generation runs in the background and never blocks your site. The full research → draft → review → publish pipeline arrives in the next update; this brief is what it will run on.', 'october-mi' ); ?>
				</p>
			</div>

			<div class="octobermi-card">
				<h2><?php esc_html_e( 'Company knowledge', 'october-mi' ); ?></h2>
				<p class="description">
					<?php esc_html_e( 'The engine reads your own pages and posts to learn your positioning, products, audience, voice and internal links — so every draft is specific to your business, not generic.', 'october-mi' ); ?>
				</p>

				<div id="octobermi-learn-status"
					data-running="<?php echo $learn_running ? '1' : '0'; ?>"
					<?php if ( $learn_running ) : ?>
						data-progress="<?php echo esc_attr( (int) $learn_job['progress'] ); ?>"
						data-note="<?php echo esc_attr( $learn_job['note'] ); ?>"
					<?php endif; ?>>
					<?php if ( $learn_running ) : ?>
						<p><span class="octobermi-spinner"></span>
							<span class="octobermi-learn-note"><?php echo esc_html( $learn_job['note'] ? $learn_job['note'] : __( 'Working…', 'october-mi' ) ); ?></span>
							(<span class="octobermi-learn-pct"><?php echo esc_html( (int) $learn_job['progress'] ); ?></span>%)
						</p>
					<?php elseif ( $learn_job && 'error' === $learn_job['status'] ) : ?>
						<p class="octobermi-fail"><?php echo esc_html( $learn_job['error'] ? $learn_job['error'] : __( 'Learning failed.', 'october-mi' ) ); ?></p>
					<?php endif; ?>
				</div>

				<?php if ( $pack ) : ?>
					<table class="widefat striped" style="margin:10px 0;">
						<tbody>
							<?php if ( ! empty( $pack['one_line'] ) ) : ?>
								<tr><th style="width:160px;"><?php esc_html_e( 'Value proposition', 'october-mi' ); ?></th><td><?php echo esc_html( $pack['one_line'] ); ?></td></tr>
							<?php endif; ?>
							<?php if ( ! empty( $pack['positioning'] ) ) : ?>
								<tr><th><?php esc_html_e( 'Positioning', 'october-mi' ); ?></th><td><?php echo esc_html( $pack['positioning'] ); ?></td></tr>
							<?php endif; ?>
							<?php if ( ! empty( $pack['products'] ) && is_array( $pack['products'] ) ) : ?>
								<tr><th><?php esc_html_e( 'Products', 'october-mi' ); ?></th><td><?php echo esc_html( implode( ', ', array_filter( wp_list_pluck( $pack['products'], 'name' ) ) ) ); ?></td></tr>
							<?php endif; ?>
							<?php if ( ! empty( $pack['themes'] ) && is_array( $pack['themes'] ) ) : ?>
								<tr><th><?php esc_html_e( 'Themes to own', 'october-mi' ); ?></th><td><?php echo esc_html( implode( ', ', $pack['themes'] ) ); ?></td></tr>
							<?php endif; ?>
							<?php if ( ! empty( $pack['voice']['summary'] ) ) : ?>
								<tr><th><?php esc_html_e( 'Voice', 'october-mi' ); ?></th><td><?php echo esc_html( $pack['voice']['summary'] ); ?></td></tr>
							<?php endif; ?>
							<tr><th><?php esc_html_e( 'Learned from', 'october-mi' ); ?></th><td>
								<?php
								$counts = isset( $pack['source_counts'] ) ? $pack['source_counts'] : array();
								$links  = isset( $pack['internal_links'] ) ? count( (array) $pack['internal_links'] ) : 0;
								printf(
									/* translators: 1: page count, 2: post count, 3: internal link count. */
									esc_html__( '%1$d pages, %2$d posts — %3$d internal links mapped', 'october-mi' ),
									(int) ( isset( $counts['pages'] ) ? $counts['pages'] : 0 ),
									(int) ( isset( $counts['posts'] ) ? $counts['posts'] : 0 ),
									(int) $links
								);
								if ( ! empty( $pack['learned_at'] ) ) {
									echo ' · ' . esc_html( human_time_diff( (int) $pack['learned_at'], time() ) . ' ' . __( 'ago', 'october-mi' ) );
								}
								?>
							</td></tr>
						</tbody>
					</table>
				<?php elseif ( ! $learn_running ) : ?>
					<p><em><?php esc_html_e( 'Not learned yet.', 'october-mi' ); ?></em></p>
				<?php endif; ?>

				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="octobermi_blog_learn" />
					<?php wp_nonce_field( 'octobermi_blog_learn' ); ?>
					<button type="submit" class="button" <?php disabled( ! $engine_ready || $learn_running ); ?>>
						<?php echo $pack ? esc_html__( 'Re-learn my site', 'october-mi' ) : esc_html__( 'Learn my site', 'october-mi' ); ?>
					</button>
					<?php if ( ! $engine_ready ) : ?>
						<span class="description"><?php esc_html_e( 'Configure the content engine first.', 'october-mi' ); ?></span>
					<?php endif; ?>
				</form>
			</div>

			<div class="octobermi-card">
				<h2><?php esc_html_e( 'Content brief', 'october-mi' ); ?></h2>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="octobermi_blog_save_brief" />
					<?php wp_nonce_field( 'octobermi_blog_save_brief' ); ?>

					<table class="form-table" role="presentation">
						<tr>
							<th scope="row"><label for="octobermi_topics"><?php esc_html_e( 'Topics & focus', 'october-mi' ); ?></label></th>
							<td>
								<textarea id="octobermi_topics" name="topics" rows="3" class="large-text" placeholder="<?php esc_attr_e( 'What themes should the blog own? Products, services, questions your customers ask…', 'october-mi' ); ?>"><?php echo esc_textarea( $brief['topics'] ); ?></textarea>
							</td>
						</tr>
						<tr>
							<th scope="row"><label for="octobermi_audience"><?php esc_html_e( 'Audience', 'october-mi' ); ?></label></th>
							<td>
								<textarea id="octobermi_audience" name="audience" rows="2" class="large-text" placeholder="<?php esc_attr_e( 'Who are we writing for? Roles, industries, the problems they need solved.', 'october-mi' ); ?>"><?php echo esc_textarea( $brief['audience'] ); ?></textarea>
							</td>
						</tr>
						<tr>
							<th scope="row"><label for="octobermi_tone"><?php esc_html_e( 'Tone of voice', 'october-mi' ); ?></label></th>
							<td>
								<textarea id="octobermi_tone" name="tone" rows="2" class="large-text" placeholder="<?php esc_attr_e( 'How should it sound? e.g. authoritative but warm; active voice; no jargon or hype words.', 'october-mi' ); ?>"><?php echo esc_textarea( $brief['tone'] ); ?></textarea>
								<p class="description"><?php esc_html_e( 'When connected, the engine also learns voice automatically from your existing pages and posts.', 'october-mi' ); ?></p>
							</td>
						</tr>
						<tr>
							<th scope="row"><label for="octobermi_author"><?php esc_html_e( 'Attributed author', 'october-mi' ); ?></label></th>
							<td>
								<?php
								wp_dropdown_users( array(
									'name'             => 'author_id',
									'id'               => 'octobermi_author',
									'selected'         => (int) $brief['author_id'],
									'show_option_none' => __( '— Select an author —', 'october-mi' ),
									'option_none_value'=> 0,
									'capability'       => array( 'edit_posts' ),
								) );
								?>
								<p class="description"><?php esc_html_e( 'Every post is bylined to a real person for E-E-A-T. Pick who is accountable for this content.', 'october-mi' ); ?></p>
							</td>
						</tr>
						<tr>
							<th scope="row"><label for="octobermi_cadence"><?php esc_html_e( 'Cadence', 'october-mi' ); ?></label></th>
							<td>
								<select id="octobermi_cadence" name="cadence">
									<option value="weekly" <?php selected( $brief['cadence'], 'weekly' ); ?>><?php esc_html_e( 'Weekly', 'october-mi' ); ?></option>
									<option value="biweekly" <?php selected( $brief['cadence'], 'biweekly' ); ?>><?php esc_html_e( 'Every two weeks', 'october-mi' ); ?></option>
									<option value="monthly" <?php selected( $brief['cadence'], 'monthly' ); ?>><?php esc_html_e( 'Monthly', 'october-mi' ); ?></option>
								</select>
							</td>
						</tr>
						<tr>
							<th scope="row"><label for="octobermi_words"><?php esc_html_e( 'Target length', 'october-mi' ); ?></label></th>
							<td>
								<input type="number" id="octobermi_words" name="word_target" min="300" max="5000" step="100" value="<?php echo esc_attr( (int) $brief['word_target'] ); ?>" />
								<span class="description"><?php esc_html_e( 'words (benchmarked against the live search results when connected)', 'october-mi' ); ?></span>
							</td>
						</tr>
						<tr>
							<th scope="row"><?php esc_html_e( 'Publishing', 'october-mi' ); ?></th>
							<td>
								<fieldset>
									<label><input type="radio" name="publish_mode" value="draft" <?php checked( $brief['publish_mode'], 'draft' ); ?> /> <?php esc_html_e( 'Save as draft for review (recommended)', 'october-mi' ); ?></label><br />
									<label><input type="radio" name="publish_mode" value="auto" <?php checked( $brief['publish_mode'], 'auto' ); ?> /> <?php esc_html_e( 'Publish automatically (trusted auto-publish)', 'october-mi' ); ?></label>
								</fieldset>
								<p class="description"><?php esc_html_e( 'Premium sites should keep review on: a named author approving each post is itself the trust signal Google rewards.', 'october-mi' ); ?></p>
							</td>
						</tr>
					</table>

					<p><button type="submit" class="button button-primary"><?php esc_html_e( 'Save brief', 'october-mi' ); ?></button></p>
				</form>
			</div>
		</div>
		<?php
	}
}
