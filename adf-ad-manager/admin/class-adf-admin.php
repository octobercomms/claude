<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ADF_Admin {

	public function __construct() {
		add_action( 'admin_menu', array( $this, 'register_menus' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_assets' ) );
		add_action( 'admin_post_adf_save_campaign', array( $this, 'handle_save_campaign' ) );
		add_action( 'admin_post_adf_delete_campaign', array( $this, 'handle_delete_campaign' ) );
		add_action( 'admin_post_adf_toggle_campaign', array( $this, 'handle_toggle_campaign' ) );
	}

	// -------------------------------------------------------------------------
	// Menu
	// -------------------------------------------------------------------------

	public function register_menus() {
		add_menu_page(
			__( 'ADF Ad Manager', 'adf-ad-manager' ),
			__( 'ADF Ads', 'adf-ad-manager' ),
			'manage_options',
			'adf-ad-manager',
			array( $this, 'page_dashboard' ),
			'dashicons-megaphone',
			30
		);

		add_submenu_page(
			'adf-ad-manager',
			__( 'All Campaigns', 'adf-ad-manager' ),
			__( 'All Campaigns', 'adf-ad-manager' ),
			'manage_options',
			'adf-ad-manager',
			array( $this, 'page_dashboard' )
		);

		add_submenu_page(
			'adf-ad-manager',
			__( 'Add Campaign', 'adf-ad-manager' ),
			__( 'Add Campaign', 'adf-ad-manager' ),
			'manage_options',
			'adf-add-campaign',
			array( $this, 'page_campaign_form' )
		);
	}

	// -------------------------------------------------------------------------
	// Assets
	// -------------------------------------------------------------------------

	public function enqueue_assets( $hook ) {
		$adf_hooks = array(
			'toplevel_page_adf-ad-manager',
			'adf-ads_page_adf-add-campaign',
			'adf-ads_page_adf-settings',
		);

		if ( ! in_array( $hook, $adf_hooks, true ) ) {
			return;
		}

		wp_enqueue_media();
		wp_enqueue_style( 'adf-admin', ADF_URL . 'assets/css/admin.css', array(), ADF_VERSION );
		wp_enqueue_script( 'adf-admin', ADF_URL . 'assets/js/admin.js', array( 'jquery' ), ADF_VERSION, true );
	}

	// -------------------------------------------------------------------------
	// Dashboard / Campaigns list
	// -------------------------------------------------------------------------

	public function page_dashboard() {
		$campaigns = ADF_Campaign::get_all();
		$stats     = ADF_Campaign::get_stats_for_all();

		$message = '';
		if ( isset( $_GET['adf_message'] ) ) {
			$msg_map = array(
				'saved'   => array( 'success', __( 'Campaign saved successfully.', 'adf-ad-manager' ) ),
				'deleted' => array( 'success', __( 'Campaign deleted.', 'adf-ad-manager' ) ),
				'toggled' => array( 'success', __( 'Campaign status updated.', 'adf-ad-manager' ) ),
				'error'   => array( 'error',   __( 'An error occurred. Please try again.', 'adf-ad-manager' ) ),
			);
			$key = sanitize_key( $_GET['adf_message'] );
			if ( isset( $msg_map[ $key ] ) ) {
				$message = $msg_map[ $key ];
			}
		}
		?>
		<div class="wrap adf-wrap">
			<h1 class="wp-heading-inline"><?php esc_html_e( 'ADF Ad Manager', 'adf-ad-manager' ); ?></h1>
			<a href="<?php echo esc_url( admin_url( 'admin.php?page=adf-add-campaign' ) ); ?>" class="page-title-action">
				<?php esc_html_e( 'Add Campaign', 'adf-ad-manager' ); ?>
			</a>
			<hr class="wp-header-end">

			<?php if ( $message ) : ?>
				<div class="notice notice-<?php echo esc_attr( $message[0] ); ?> is-dismissible">
					<p><?php echo esc_html( $message[1] ); ?></p>
				</div>
			<?php endif; ?>

			<?php if ( empty( $campaigns ) ) : ?>
				<div class="adf-empty">
					<p><?php esc_html_e( 'No campaigns yet. Add your first campaign to get started.', 'adf-ad-manager' ); ?></p>
					<a href="<?php echo esc_url( admin_url( 'admin.php?page=adf-add-campaign' ) ); ?>" class="button button-primary">
						<?php esc_html_e( 'Add Campaign', 'adf-ad-manager' ); ?>
					</a>
				</div>
			<?php else : ?>
				<table class="wp-list-table widefat fixed striped adf-table">
					<thead>
						<tr>
							<th><?php esc_html_e( 'Campaign', 'adf-ad-manager' ); ?></th>
							<th><?php esc_html_e( 'Status', 'adf-ad-manager' ); ?></th>
							<th><?php esc_html_e( 'Formats', 'adf-ad-manager' ); ?></th>
							<th><?php esc_html_e( 'Impressions', 'adf-ad-manager' ); ?></th>
							<th><?php esc_html_e( 'Clicks', 'adf-ad-manager' ); ?></th>
							<th><?php esc_html_e( 'Schedule', 'adf-ad-manager' ); ?></th>
							<th><?php esc_html_e( 'Actions', 'adf-ad-manager' ); ?></th>
						</tr>
					</thead>
					<tbody>
						<?php foreach ( $campaigns as $campaign ) :
							$s = $stats[ $campaign->id ] ?? array( 'impressions' => 0, 'clicks' => 0 );
							$ads = ADF_Campaign::get_ads_for_campaign( $campaign->id );
							$formats_present = wp_list_pluck( $ads, 'format' );
							$is_active = $campaign->status === 'active';
							$toggle_nonce = wp_create_nonce( 'adf_toggle_' . $campaign->id );
							$delete_nonce = wp_create_nonce( 'adf_delete_' . $campaign->id );
							$today = current_time( 'Y-m-d' );
							$expired = $campaign->end_date && $campaign->end_date < $today;
							$not_started = $campaign->start_date && $campaign->start_date > $today;
						?>
						<tr>
							<td>
								<strong>
									<a href="<?php echo esc_url( admin_url( 'admin.php?page=adf-add-campaign&campaign_id=' . $campaign->id ) ); ?>">
										<?php echo esc_html( $campaign->name ); ?>
									</a>
								</strong>
								<?php if ( $campaign->client_name ) : ?>
									<br><span class="description"><?php echo esc_html( $campaign->client_name ); ?></span>
								<?php endif; ?>
								<br>
								<a href="<?php echo esc_url( $campaign->url ); ?>" target="_blank" rel="noopener noreferrer" class="adf-url">
									<?php echo esc_html( $campaign->url ); ?>
								</a>
							</td>
							<td>
								<?php
								$badge_class = 'adf-badge';
								if ( ! $is_active ) {
									echo '<span class="' . $badge_class . ' adf-badge--inactive">' . esc_html__( 'Inactive', 'adf-ad-manager' ) . '</span>';
								} elseif ( $expired ) {
									echo '<span class="' . $badge_class . ' adf-badge--expired">' . esc_html__( 'Expired', 'adf-ad-manager' ) . '</span>';
								} elseif ( $not_started ) {
									echo '<span class="' . $badge_class . ' adf-badge--pending">' . esc_html__( 'Scheduled', 'adf-ad-manager' ) . '</span>';
								} else {
									echo '<span class="' . $badge_class . ' adf-badge--active">' . esc_html__( 'Active', 'adf-ad-manager' ) . '</span>';
								}
								?>
							</td>
							<td>
								<?php foreach ( ADF_FORMATS as $fmt_key => $fmt_info ) : ?>
									<span class="adf-format-chip adf-format-chip--<?php echo in_array( $fmt_key, $formats_present, true ) ? 'yes' : 'no'; ?>">
										<?php echo esc_html( $fmt_info['label'] ); ?>
									</span>
								<?php endforeach; ?>
							</td>
							<td>
								<?php echo esc_html( number_format( $s['impressions'] ) ); ?>
								<?php if ( $campaign->restrict_impressions && $campaign->max_impressions ) : ?>
									<br><span class="description">
										<?php printf(
											/* translators: %s = max impressions */
											esc_html__( 'Max: %s', 'adf-ad-manager' ),
											esc_html( number_format( $campaign->max_impressions ) )
										); ?>
									</span>
									<?php if ( $s['impressions'] >= $campaign->max_impressions ) : ?>
										<br><span class="adf-badge adf-badge--expired"><?php esc_html_e( 'Limit reached', 'adf-ad-manager' ); ?></span>
									<?php else : ?>
										<br><span class="description"><?php echo esc_html( number_format( $campaign->max_impressions - $s['impressions'] ) ); ?> <?php esc_html_e( 'remaining', 'adf-ad-manager' ); ?></span>
									<?php endif; ?>
								<?php endif; ?>
							</td>
							<td>
								<?php echo esc_html( number_format( $s['clicks'] ) ); ?>
								<?php if ( $campaign->restrict_clicks && $campaign->max_clicks ) : ?>
									<br><span class="description">
										<?php printf( esc_html__( 'Max: %s', 'adf-ad-manager' ), esc_html( number_format( $campaign->max_clicks ) ) ); ?>
									</span>
									<?php if ( $s['clicks'] >= $campaign->max_clicks ) : ?>
										<br><span class="adf-badge adf-badge--expired"><?php esc_html_e( 'Limit reached', 'adf-ad-manager' ); ?></span>
									<?php endif; ?>
								<?php endif; ?>
								<?php if ( $s['impressions'] > 0 ) : ?>
									<br><span class="description">
										<?php printf(
											esc_html__( 'CTR: %s%%', 'adf-ad-manager' ),
											esc_html( number_format( ( $s['clicks'] / $s['impressions'] ) * 100, 1 ) )
										); ?>
									</span>
								<?php endif; ?>
							</td>
							<td>
								<?php if ( $campaign->start_date ) : ?>
									<span class="description"><?php esc_html_e( 'From:', 'adf-ad-manager' ); ?></span>
									<?php echo esc_html( date_i18n( get_option( 'date_format' ), strtotime( $campaign->start_date ) ) ); ?><br>
								<?php endif; ?>
								<?php if ( $campaign->end_date ) : ?>
									<span class="description"><?php esc_html_e( 'Until:', 'adf-ad-manager' ); ?></span>
									<?php echo esc_html( date_i18n( get_option( 'date_format' ), strtotime( $campaign->end_date ) ) ); ?>
								<?php else : ?>
									<span class="description"><?php esc_html_e( 'No end date', 'adf-ad-manager' ); ?></span>
								<?php endif; ?>
							</td>
							<td class="adf-actions">
								<a href="<?php echo esc_url( admin_url( 'admin.php?page=adf-add-campaign&campaign_id=' . $campaign->id ) ); ?>"
								   class="button button-small">
									<?php esc_html_e( 'Edit', 'adf-ad-manager' ); ?>
								</a>

								<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline;">
									<input type="hidden" name="action" value="adf_toggle_campaign">
									<input type="hidden" name="campaign_id" value="<?php echo esc_attr( $campaign->id ); ?>">
									<input type="hidden" name="_wpnonce" value="<?php echo esc_attr( $toggle_nonce ); ?>">
									<button type="submit" class="button button-small <?php echo $is_active ? 'adf-btn-pause' : 'adf-btn-activate'; ?>">
										<?php echo $is_active ? esc_html__( 'Disable', 'adf-ad-manager' ) : esc_html__( 'Enable', 'adf-ad-manager' ); ?>
									</button>
								</form>

								<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline;"
								      onsubmit="return confirm('<?php esc_attr_e( 'Delete this campaign and all its tracking data?', 'adf-ad-manager' ); ?>');">
									<input type="hidden" name="action" value="adf_delete_campaign">
									<input type="hidden" name="campaign_id" value="<?php echo esc_attr( $campaign->id ); ?>">
									<input type="hidden" name="_wpnonce" value="<?php echo esc_attr( $delete_nonce ); ?>">
									<button type="submit" class="button button-small adf-btn-delete">
										<?php esc_html_e( 'Delete', 'adf-ad-manager' ); ?>
									</button>
								</form>
							</td>
						</tr>
						<?php endforeach; ?>
					</tbody>
				</table>
			<?php endif; ?>

			<div class="adf-shortcode-ref">
				<h3><?php esc_html_e( 'Shortcode Reference', 'adf-ad-manager' ); ?></h3>
				<p><?php esc_html_e( 'Use these shortcodes anywhere on your site:', 'adf-ad-manager' ); ?></p>
				<ul>
					<li><code>[adf_ad format="mpu"]</code> — <?php esc_html_e( 'MPU 300×250', 'adf-ad-manager' ); ?></li>
					<li><code>[adf_ad format="leaderboard"]</code> — <?php esc_html_e( 'Leaderboard 728×90', 'adf-ad-manager' ); ?></li>
					<li><code>[adf_ad format="skyscraper"]</code> — <?php esc_html_e( 'Skyscraper 160×600', 'adf-ad-manager' ); ?></li>
				</ul>
			</div>
		</div>
		<?php
	}

	// -------------------------------------------------------------------------
	// Campaign add / edit form
	// -------------------------------------------------------------------------

	public function page_campaign_form() {
		$campaign_id = isset( $_GET['campaign_id'] ) ? absint( $_GET['campaign_id'] ) : 0;
		$campaign    = $campaign_id ? ADF_Campaign::get( $campaign_id ) : null;
		$existing_ads = array();

		if ( $campaign ) {
			$ads_rows = ADF_Campaign::get_ads_for_campaign( $campaign_id );
			foreach ( $ads_rows as $row ) {
				$existing_ads[ $row->format ] = $row;
			}
		}

		$title = $campaign ? __( 'Edit Campaign', 'adf-ad-manager' ) : __( 'Add Campaign', 'adf-ad-manager' );
		$nonce = wp_create_nonce( 'adf_save_campaign' );
		?>
		<div class="wrap adf-wrap">
			<h1><?php echo esc_html( $title ); ?></h1>
			<a href="<?php echo esc_url( admin_url( 'admin.php?page=adf-ad-manager' ) ); ?>" class="page-title-action">
				&larr; <?php esc_html_e( 'All Campaigns', 'adf-ad-manager' ); ?>
			</a>
			<hr class="wp-header-end">

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="adf_save_campaign">
				<input type="hidden" name="_wpnonce" value="<?php echo esc_attr( $nonce ); ?>">
				<?php if ( $campaign_id ) : ?>
					<input type="hidden" name="campaign_id" value="<?php echo esc_attr( $campaign_id ); ?>">
				<?php endif; ?>

				<div class="adf-form-grid">

					<!-- Left: Campaign details -->
					<div class="adf-form-main">
						<div class="postbox">
							<div class="postbox-header">
								<h2><?php esc_html_e( 'Campaign Details', 'adf-ad-manager' ); ?></h2>
							</div>
							<div class="inside">

								<table class="form-table">
									<tr>
										<th><label for="adf_name"><?php esc_html_e( 'Campaign Name', 'adf-ad-manager' ); ?> <span class="required">*</span></label></th>
										<td>
											<input type="text" id="adf_name" name="name" required class="regular-text"
											       value="<?php echo esc_attr( $campaign->name ?? '' ); ?>">
										</td>
									</tr>
									<tr>
										<th><label for="adf_client"><?php esc_html_e( 'Client / Advertiser', 'adf-ad-manager' ); ?></label></th>
										<td>
											<input type="text" id="adf_client" name="client_name" class="regular-text"
											       value="<?php echo esc_attr( $campaign->client_name ?? '' ); ?>">
										</td>
									</tr>
									<tr>
										<th><label for="adf_url"><?php esc_html_e( 'Destination URL', 'adf-ad-manager' ); ?> <span class="required">*</span></label></th>
										<td>
											<input type="url" id="adf_url" name="url" required class="regular-text"
											       placeholder="https://"
											       value="<?php echo esc_attr( $campaign->url ?? '' ); ?>">
											<p class="description"><?php esc_html_e( 'All ad formats in this campaign link to this URL.', 'adf-ad-manager' ); ?></p>
										</td>
									</tr>
								</table>

							</div>
						</div>

						<!-- Ad Creatives -->
						<div class="postbox">
							<div class="postbox-header">
								<h2><?php esc_html_e( 'Ad Creatives', 'adf-ad-manager' ); ?></h2>
							</div>
							<div class="inside">
								<p class="description"><?php esc_html_e( 'Upload images for each ad format. You can leave formats blank if not required.', 'adf-ad-manager' ); ?></p>

								<?php foreach ( ADF_FORMATS as $fmt_key => $fmt_info ) :
									$existing = $existing_ads[ $fmt_key ] ?? null;
								?>
								<div class="adf-creative-row">
									<div class="adf-creative-label">
										<strong><?php echo esc_html( $fmt_info['label'] ); ?></strong>
										<span class="description"><?php echo esc_html( $fmt_info['width'] . '×' . $fmt_info['height'] ); ?></span>
									</div>
									<div class="adf-creative-fields">
										<?php if ( $existing && $existing->image_url ) : ?>
											<div class="adf-current-image" id="adf-preview-<?php echo esc_attr( $fmt_key ); ?>">
												<img src="<?php echo esc_url( $existing->image_url ); ?>"
												     alt="" style="max-width:200px;max-height:100px;">
											</div>
										<?php else : ?>
											<div class="adf-current-image" id="adf-preview-<?php echo esc_attr( $fmt_key ); ?>" style="display:none;"></div>
										<?php endif; ?>

										<input type="hidden"
										       name="ad[<?php echo esc_attr( $fmt_key ); ?>][image_url]"
										       id="adf-image-url-<?php echo esc_attr( $fmt_key ); ?>"
										       value="<?php echo esc_attr( $existing->image_url ?? '' ); ?>">

										<button type="button" class="button adf-media-upload"
										        data-format="<?php echo esc_attr( $fmt_key ); ?>">
											<?php echo $existing ? esc_html__( 'Change Image', 'adf-ad-manager' ) : esc_html__( 'Upload Image', 'adf-ad-manager' ); ?>
										</button>

										<?php if ( $existing ) : ?>
											<label style="margin-left:8px;">
												<input type="checkbox" name="ad[<?php echo esc_attr( $fmt_key ); ?>][remove]" value="1">
												<?php esc_html_e( 'Remove', 'adf-ad-manager' ); ?>
											</label>
										<?php endif; ?>

										<br>
										<label for="adf-alt-<?php echo esc_attr( $fmt_key ); ?>" style="margin-top:8px;display:block;">
											<?php esc_html_e( 'Alt text', 'adf-ad-manager' ); ?>
										</label>
										<input type="text" id="adf-alt-<?php echo esc_attr( $fmt_key ); ?>"
										       name="ad[<?php echo esc_attr( $fmt_key ); ?>][alt_text]"
										       class="regular-text"
										       value="<?php echo esc_attr( $existing->alt_text ?? '' ); ?>"
										       placeholder="<?php echo esc_attr( $fmt_info['label'] . ' advertisement' ); ?>">
									</div>
								</div>
								<?php endforeach; ?>
							</div>
						</div>
					</div>

					<!-- Right: Settings sidebar -->
					<div class="adf-form-sidebar">

						<div class="postbox">
							<div class="postbox-header">
								<h2><?php esc_html_e( 'Publish', 'adf-ad-manager' ); ?></h2>
							</div>
							<div class="inside">
								<label class="adf-toggle-label">
									<input type="checkbox" name="status" value="active"
									       <?php checked( ( $campaign->status ?? 'active' ), 'active' ); ?>>
									<?php esc_html_e( 'Campaign Active', 'adf-ad-manager' ); ?>
								</label>
								<p class="description"><?php esc_html_e( 'Inactive campaigns will not display any ads.', 'adf-ad-manager' ); ?></p>
								<hr>
								<?php submit_button( $campaign ? __( 'Update Campaign', 'adf-ad-manager' ) : __( 'Save Campaign', 'adf-ad-manager' ) ); ?>
							</div>
						</div>

						<div class="postbox">
							<div class="postbox-header">
								<h2><?php esc_html_e( 'Schedule', 'adf-ad-manager' ); ?></h2>
							</div>
							<div class="inside">
								<p class="description"><?php esc_html_e( 'Leave blank to run indefinitely.', 'adf-ad-manager' ); ?></p>

								<label for="adf_start_date"><?php esc_html_e( 'Start Date', 'adf-ad-manager' ); ?></label>
								<input type="date" id="adf_start_date" name="start_date" class="widefat"
								       value="<?php echo esc_attr( $campaign->start_date ?? '' ); ?>">

								<label for="adf_end_date" style="margin-top:10px;display:block;"><?php esc_html_e( 'End Date', 'adf-ad-manager' ); ?></label>
								<input type="date" id="adf_end_date" name="end_date" class="widefat"
								       value="<?php echo esc_attr( $campaign->end_date ?? '' ); ?>">
								<p class="description"><?php esc_html_e( 'Campaign stops displaying after this date.', 'adf-ad-manager' ); ?></p>
							</div>
						</div>

						<div class="postbox">
							<div class="postbox-header">
								<h2><?php esc_html_e( 'Restrictions', 'adf-ad-manager' ); ?></h2>
							</div>
							<div class="inside">
								<p class="description"><?php esc_html_e( 'Toggle limits per agreement type. Leave off for unlimited / continuous campaigns.', 'adf-ad-manager' ); ?></p>

								<!-- Impression cap -->
								<label class="adf-toggle-label">
									<input type="checkbox" name="restrict_impressions" value="1" id="adf_restrict_imp"
									       <?php checked( ! empty( $campaign->restrict_impressions ) ); ?>>
									<?php esc_html_e( 'Limit Impressions', 'adf-ad-manager' ); ?>
								</label>
								<div class="adf-restriction-field" id="adf-imp-cap-wrap"
								     style="<?php echo empty( $campaign->restrict_impressions ) ? 'display:none;' : ''; ?>">
									<label for="adf_max_impressions"><?php esc_html_e( 'Maximum Impressions', 'adf-ad-manager' ); ?></label>
									<input type="number" id="adf_max_impressions" name="max_impressions"
									       class="widefat" min="1" step="1"
									       value="<?php echo esc_attr( $campaign->max_impressions ?? '' ); ?>">
									<p class="description"><?php esc_html_e( 'Campaign auto-stops after this many impressions.', 'adf-ad-manager' ); ?></p>
								</div>

								<hr>

								<!-- Click cap -->
								<label class="adf-toggle-label">
									<input type="checkbox" name="restrict_clicks" value="1" id="adf_restrict_clk"
									       <?php checked( ! empty( $campaign->restrict_clicks ) ); ?>>
									<?php esc_html_e( 'Limit Clicks', 'adf-ad-manager' ); ?>
								</label>
								<div class="adf-restriction-field" id="adf-clk-cap-wrap"
								     style="<?php echo empty( $campaign->restrict_clicks ) ? 'display:none;' : ''; ?>">
									<label for="adf_max_clicks"><?php esc_html_e( 'Maximum Clicks', 'adf-ad-manager' ); ?></label>
									<input type="number" id="adf_max_clicks" name="max_clicks"
									       class="widefat" min="1" step="1"
									       value="<?php echo esc_attr( $campaign->max_clicks ?? '' ); ?>">
									<p class="description"><?php esc_html_e( 'Campaign auto-stops after this many clicks.', 'adf-ad-manager' ); ?></p>
								</div>
							</div>
						</div>

					</div>
				</div>
			</form>
		</div>
		<?php
	}

	// -------------------------------------------------------------------------
	// Form handlers
	// -------------------------------------------------------------------------

	public function handle_save_campaign() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Permission denied.', 'adf-ad-manager' ) );
		}

		check_admin_referer( 'adf_save_campaign' );

		$campaign_id = isset( $_POST['campaign_id'] ) ? absint( $_POST['campaign_id'] ) : 0;

		$data = array(
			'name'                 => sanitize_text_field( wp_unslash( $_POST['name'] ?? '' ) ),
			'client_name'          => sanitize_text_field( wp_unslash( $_POST['client_name'] ?? '' ) ),
			'url'                  => esc_url_raw( wp_unslash( $_POST['url'] ?? '' ) ),
			'status'               => isset( $_POST['status'] ) && $_POST['status'] === 'active' ? 'active' : 'inactive',
			'start_date'           => sanitize_text_field( wp_unslash( $_POST['start_date'] ?? '' ) ),
			'end_date'             => sanitize_text_field( wp_unslash( $_POST['end_date'] ?? '' ) ),
			'restrict_impressions' => ! empty( $_POST['restrict_impressions'] ),
			'max_impressions'      => ! empty( $_POST['max_impressions'] ) ? absint( $_POST['max_impressions'] ) : null,
			'restrict_clicks'      => ! empty( $_POST['restrict_clicks'] ),
			'max_clicks'           => ! empty( $_POST['max_clicks'] ) ? absint( $_POST['max_clicks'] ) : null,
		);

		if ( $campaign_id ) {
			ADF_Campaign::update( $campaign_id, $data );
		} else {
			$campaign_id = ADF_Campaign::create( $data );
		}

		// Save ads.
		$ad_data = isset( $_POST['ad'] ) && is_array( $_POST['ad'] ) ? $_POST['ad'] : array();
		foreach ( ADF_FORMATS as $fmt_key => $fmt_info ) {
			if ( ! isset( $ad_data[ $fmt_key ] ) ) {
				continue;
			}

			$ad = $ad_data[ $fmt_key ];

			if ( ! empty( $ad['remove'] ) ) {
				ADF_Campaign::delete_ad_for_format( $campaign_id, $fmt_key );
				continue;
			}

			$image_url = esc_url_raw( wp_unslash( $ad['image_url'] ?? '' ) );
			if ( $image_url ) {
				$alt_text = sanitize_text_field( wp_unslash( $ad['alt_text'] ?? '' ) );
				ADF_Campaign::save_ad( $campaign_id, $fmt_key, $image_url, $alt_text );
			}
		}

		wp_safe_redirect( add_query_arg(
			array( 'page' => 'adf-add-campaign', 'campaign_id' => $campaign_id, 'adf_message' => 'saved' ),
			admin_url( 'admin.php' )
		) );
		exit;
	}

	public function handle_delete_campaign() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Permission denied.', 'adf-ad-manager' ) );
		}

		$campaign_id = absint( $_POST['campaign_id'] ?? 0 );
		check_admin_referer( 'adf_delete_' . $campaign_id );

		ADF_Campaign::delete( $campaign_id );

		wp_safe_redirect( add_query_arg(
			array( 'page' => 'adf-ad-manager', 'adf_message' => 'deleted' ),
			admin_url( 'admin.php' )
		) );
		exit;
	}

	public function handle_toggle_campaign() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Permission denied.', 'adf-ad-manager' ) );
		}

		$campaign_id = absint( $_POST['campaign_id'] ?? 0 );
		check_admin_referer( 'adf_toggle_' . $campaign_id );

		$campaign = ADF_Campaign::get( $campaign_id );
		if ( $campaign ) {
			$new_status = $campaign->status === 'active' ? 'inactive' : 'active';
			ADF_Campaign::update( $campaign_id, array_merge( (array) $campaign, array( 'status' => $new_status ) ) );
		}

		wp_safe_redirect( add_query_arg(
			array( 'page' => 'adf-ad-manager', 'adf_message' => 'toggled' ),
			admin_url( 'admin.php' )
		) );
		exit;
	}
}
