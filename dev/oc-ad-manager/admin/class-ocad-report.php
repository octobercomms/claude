<?php
/**
 * Campaign Report page — printable PDF-ready summary for advertisers.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCAD_Report {

	public static function page_report() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Permission denied.', 'oc-ad-manager' ) );
		}

		$campaigns   = OCAD_Campaign::get_all();
		$campaign_id = isset( $_GET['campaign_id'] ) ? absint( $_GET['campaign_id'] ) : 0;
		$campaign    = $campaign_id ? OCAD_Campaign::get( $campaign_id ) : null;

		// Default to first campaign.
		if ( ! $campaign && ! empty( $campaigns ) ) {
			$campaign    = $campaigns[0];
			$campaign_id = $campaign->id;
		}
		?>
		<div class="wrap ocad-wrap">
			<div class="ocad-report-header">
				<h1><?php esc_html_e( 'Campaign Report', 'oc-ad-manager' ); ?></h1>
				<div class="ocad-report-controls">
					<form method="get" style="display:inline-flex;align-items:center;gap:8px;">
						<input type="hidden" name="page" value="ocad-report">
						<select name="campaign_id" onchange="this.form.submit()" class="ocad-select-campaign">
							<?php foreach ( $campaigns as $c ) : ?>
								<option value="<?php echo esc_attr( $c->id ); ?>" <?php selected( $c->id, $campaign_id ); ?>>
									<?php echo esc_html( $c->name ); ?>
									<?php if ( $c->client_name ) echo ' — ' . esc_html( $c->client_name ); ?>
								</option>
							<?php endforeach; ?>
						</select>
					</form>
					<?php if ( $campaign ) : ?>
						<button onclick="window.print();" class="ocad-print-btn">
							&#x1F4C4; <?php esc_html_e( 'Print / Save as PDF', 'oc-ad-manager' ); ?>
						</button>
					<?php endif; ?>
				</div>
			</div>

			<?php if ( ! $campaign ) : ?>
				<p><?php esc_html_e( 'No campaigns found. Add a campaign first.', 'oc-ad-manager' ); ?></p>
			<?php else :
				$impressions  = OCAD_Tracker::get_count( $campaign_id, 'impression' );
				$clicks       = OCAD_Tracker::get_count( $campaign_id, 'click' );
				$ctr          = $impressions > 0 ? round( ( $clicks / $impressions ) * 100, 2 ) : 0;
				$dates        = OCAD_Tracker::get_date_range( $campaign_id );
				$imp_sources  = OCAD_Tracker::get_impressions_by_source( $campaign_id );
				$clk_sources  = OCAD_Tracker::get_clicks_by_source( $campaign_id );

				// Group impressions by domain.
				$imp_by_domain = array();
				foreach ( $imp_sources as $row ) {
					$domain = wp_parse_url( $row->source_url, PHP_URL_HOST ) ?: $row->source_url;
					$imp_by_domain[ $domain ] = ( $imp_by_domain[ $domain ] ?? 0 ) + (int) $row->cnt;
				}
				arsort( $imp_by_domain );
			?>

			<!-- ═══ PRINTABLE REPORT ═══ -->
			<div class="ocad-report" id="ocad-report-print">

				<div class="ocad-report-title-block">
					<div class="ocad-report-logo">Ad Manager — October Communications</div>
					<h2 class="ocad-report-campaign-name"><?php echo esc_html( $campaign->name ); ?></h2>
					<?php if ( $campaign->client_name ) : ?>
						<div class="ocad-report-client"><?php echo esc_html( $campaign->client_name ); ?></div>
					<?php endif; ?>
					<div class="ocad-report-meta">
						<?php
						if ( $campaign->start_date || $campaign->end_date ) {
							$from  = $campaign->start_date ? date_i18n( get_option( 'date_format' ), strtotime( $campaign->start_date ) ) : __( 'Ongoing', 'oc-ad-manager' );
							$until = $campaign->end_date ? date_i18n( get_option( 'date_format' ), strtotime( $campaign->end_date ) ) : __( 'Ongoing', 'oc-ad-manager' );
							echo esc_html( $from . ' – ' . $until );
						} else {
							esc_html_e( 'Ongoing campaign', 'oc-ad-manager' );
						}
						?>
						&nbsp;·&nbsp;
						<?php printf(
							esc_html__( 'Report generated %s', 'oc-ad-manager' ),
							esc_html( date_i18n( get_option( 'date_format' ) ) )
						); ?>
					</div>
				</div>

				<!-- Stats row -->
				<div class="ocad-report-stats">
					<div class="ocad-report-stat">
						<span class="ocad-report-stat-num"><?php echo esc_html( number_format( $impressions ) ); ?></span>
						<span class="ocad-report-stat-label"><?php esc_html_e( 'Impressions', 'oc-ad-manager' ); ?></span>
					</div>
					<div class="ocad-report-stat">
						<span class="ocad-report-stat-num"><?php echo esc_html( number_format( $clicks ) ); ?></span>
						<span class="ocad-report-stat-label"><?php esc_html_e( 'Clicks', 'oc-ad-manager' ); ?></span>
					</div>
					<div class="ocad-report-stat">
						<span class="ocad-report-stat-num"><?php echo esc_html( $ctr ); ?>%</span>
						<span class="ocad-report-stat-label"><?php esc_html_e( 'Click-Through Rate', 'oc-ad-manager' ); ?></span>
					</div>
					<?php if ( $dates && $dates->first_at ) : ?>
					<div class="ocad-report-stat">
						<span class="ocad-report-stat-num"><?php echo esc_html( date_i18n( 'M j', strtotime( $dates->first_at ) ) ); ?></span>
						<span class="ocad-report-stat-label"><?php esc_html_e( 'First Impression', 'oc-ad-manager' ); ?></span>
					</div>
					<?php endif; ?>
				</div>

				<!-- Impressions by site -->
				<?php if ( ! empty( $imp_by_domain ) ) : ?>
				<div class="ocad-report-section">
					<h3 class="ocad-report-section-title"><?php esc_html_e( 'Impressions by Site', 'oc-ad-manager' ); ?></h3>
					<table class="ocad-report-table">
						<thead>
							<tr>
								<th><?php esc_html_e( 'Domain', 'oc-ad-manager' ); ?></th>
								<th class="ocad-report-num"><?php esc_html_e( 'Impressions', 'oc-ad-manager' ); ?></th>
								<th class="ocad-report-num"><?php esc_html_e( 'Share', 'oc-ad-manager' ); ?></th>
							</tr>
						</thead>
						<tbody>
							<?php foreach ( $imp_by_domain as $domain => $count ) :
								$share = $impressions > 0 ? round( ( $count / $impressions ) * 100, 1 ) : 0;
							?>
							<tr>
								<td><?php echo esc_html( $domain ); ?></td>
								<td class="ocad-report-num"><?php echo esc_html( number_format( $count ) ); ?></td>
								<td class="ocad-report-num"><?php echo esc_html( $share ); ?>%</td>
							</tr>
							<?php endforeach; ?>
						</tbody>
					</table>
				</div>
				<?php endif; ?>

				<!-- Clicks by page -->
				<?php if ( ! empty( $clk_sources ) ) : ?>
				<div class="ocad-report-section">
					<h3 class="ocad-report-section-title"><?php esc_html_e( 'Clicks by Page', 'oc-ad-manager' ); ?></h3>
					<table class="ocad-report-table">
						<thead>
							<tr>
								<th><?php esc_html_e( 'Page URL', 'oc-ad-manager' ); ?></th>
								<th class="ocad-report-num"><?php esc_html_e( 'Clicks', 'oc-ad-manager' ); ?></th>
							</tr>
						</thead>
						<tbody>
							<?php foreach ( $clk_sources as $row ) : ?>
							<tr>
								<td class="ocad-report-url"><?php echo esc_html( $row->source_url ); ?></td>
								<td class="ocad-report-num"><?php echo esc_html( number_format( $row->cnt ) ); ?></td>
							</tr>
							<?php endforeach; ?>
						</tbody>
					</table>
				</div>
				<?php endif; ?>

				<?php if ( empty( $imp_by_domain ) && empty( $clk_sources ) ) : ?>
				<div class="ocad-report-section">
					<p class="ocad-report-empty"><?php esc_html_e( 'No source data recorded yet. Source tracking begins with plugin v1.1.0 — existing impression and click counts are preserved but their page sources are not available retroactively.', 'oc-ad-manager' ); ?></p>
				</div>
				<?php endif; ?>

				<div class="ocad-report-footer">
					<?php esc_html_e( 'Report prepared by October Communications · Ad Manager', 'oc-ad-manager' ); ?>
					&nbsp;·&nbsp;
					<?php echo esc_html( home_url( '/' ) ); ?>
				</div>

			</div><!-- /.ocad-report -->

			<?php endif; ?>
		</div>
		<?php
	}
}
