<?php
/**
 * Reports. Expects $banner_cb, $rev_month, $rev_year, $rev_all, $recurring,
 * $pipeline, $projects, $funnel.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$gbp = function ( $n ) {
	return '£' . number_format( (float) $n, 2 );
};
?>
<div class="wrap hgd-wrap">

	<?php call_user_func( $banner_cb ); ?>

	<div class="hgd-page-head">
		<h1><?php esc_html_e( 'Reports', 'hillcroft-garden-designer' ); ?></h1>
		<span class="hgd-muted"><?php esc_html_e( 'Collected revenue, recurring income and your sales pipeline at a glance.', 'hillcroft-garden-designer' ); ?></span>
	</div>

	<!-- Collected revenue -->
	<h2 class="hgd-section-title"><?php esc_html_e( 'Collected revenue', 'hillcroft-garden-designer' ); ?></h2>
	<div class="hgd-cards">
		<div class="hgd-card hgd-card--accent">
			<span class="hgd-card-label"><?php esc_html_e( 'This month', 'hillcroft-garden-designer' ); ?></span>
			<span class="hgd-card-figure"><?php echo esc_html( $gbp( $rev_month['total'] ) ); ?></span>
			<span class="hgd-muted"><?php echo esc_html( sprintf( __( 'Consultations %s · Design %s', 'hillcroft-garden-designer' ), $gbp( $rev_month['consultations'] ), $gbp( $rev_month['milestones'] ) ) ); ?></span>
		</div>
		<div class="hgd-card">
			<span class="hgd-card-label"><?php esc_html_e( 'This year', 'hillcroft-garden-designer' ); ?></span>
			<span class="hgd-card-figure"><?php echo esc_html( $gbp( $rev_year['total'] ) ); ?></span>
			<span class="hgd-muted"><?php echo esc_html( sprintf( __( 'Consultations %s · Design %s', 'hillcroft-garden-designer' ), $gbp( $rev_year['consultations'] ), $gbp( $rev_year['milestones'] ) ) ); ?></span>
		</div>
		<div class="hgd-card">
			<span class="hgd-card-label"><?php esc_html_e( 'All time', 'hillcroft-garden-designer' ); ?></span>
			<span class="hgd-card-figure"><?php echo esc_html( $gbp( $rev_all['total'] ) ); ?></span>
			<span class="hgd-muted"><?php echo esc_html( sprintf( __( 'Consultations %s · Design %s', 'hillcroft-garden-designer' ), $gbp( $rev_all['consultations'] ), $gbp( $rev_all['milestones'] ) ) ); ?></span>
		</div>
	</div>
	<p class="hgd-muted hgd-note"><?php esc_html_e( 'Collected = paid consultations and paid design milestones recorded by the plugin. Maintenance income is recurring and shown below.', 'hillcroft-garden-designer' ); ?></p>

	<!-- Recurring revenue -->
	<h2 class="hgd-section-title"><?php esc_html_e( 'Recurring revenue (maintenance plans)', 'hillcroft-garden-designer' ); ?></h2>
	<div class="hgd-cards">
		<div class="hgd-card hgd-card--accent">
			<span class="hgd-card-label"><?php esc_html_e( 'MRR', 'hillcroft-garden-designer' ); ?></span>
			<span class="hgd-card-figure"><?php echo esc_html( $gbp( $recurring['mrr'] ) ); ?></span>
			<span class="hgd-muted"><?php esc_html_e( 'Monthly recurring revenue', 'hillcroft-garden-designer' ); ?></span>
		</div>
		<div class="hgd-card">
			<span class="hgd-card-label"><?php esc_html_e( 'ARR', 'hillcroft-garden-designer' ); ?></span>
			<span class="hgd-card-figure"><?php echo esc_html( $gbp( $recurring['arr'] ) ); ?></span>
			<span class="hgd-muted"><?php esc_html_e( 'Annualised (MRR × 12)', 'hillcroft-garden-designer' ); ?></span>
		</div>
		<div class="hgd-card">
			<span class="hgd-card-label"><?php esc_html_e( 'Active plans', 'hillcroft-garden-designer' ); ?></span>
			<span class="hgd-card-figure"><?php echo esc_html( number_format( $recurring['active'] ) ); ?></span>
			<a class="hgd-pill hgd-pill-ghost" href="<?php echo esc_url( admin_url( 'admin.php?page=hgd-subscriptions' ) ); ?>"><?php esc_html_e( 'View plans', 'hillcroft-garden-designer' ); ?></a>
		</div>
		<div class="hgd-card">
			<span class="hgd-card-label"><?php esc_html_e( 'New this month', 'hillcroft-garden-designer' ); ?></span>
			<span class="hgd-card-figure"><?php echo esc_html( number_format( $recurring['new_this_month'] ) ); ?></span>
			<span class="hgd-muted"><?php esc_html_e( 'Sign-ups since the 1st', 'hillcroft-garden-designer' ); ?></span>
		</div>
	</div>

	<!-- Sales pipeline -->
	<h2 class="hgd-section-title"><?php esc_html_e( 'Sales pipeline', 'hillcroft-garden-designer' ); ?></h2>
	<div class="hgd-cards">
		<div class="hgd-card hgd-card--accent">
			<span class="hgd-card-label"><?php esc_html_e( 'Open proposal value', 'hillcroft-garden-designer' ); ?></span>
			<span class="hgd-card-figure"><?php echo esc_html( $gbp( $pipeline['open_value'] ) ); ?></span>
			<span class="hgd-muted"><?php esc_html_e( 'Sent, viewed, accepted & deposit-paid', 'hillcroft-garden-designer' ); ?></span>
		</div>
	</div>
	<div class="hgd-panel">
		<table class="hgd-table">
			<thead>
				<tr>
					<th><?php esc_html_e( 'Proposal stage', 'hillcroft-garden-designer' ); ?></th>
					<th class="num"><?php esc_html_e( 'Count', 'hillcroft-garden-designer' ); ?></th>
					<th class="num"><?php esc_html_e( 'Value', 'hillcroft-garden-designer' ); ?></th>
				</tr>
			</thead>
			<tbody>
				<?php foreach ( HGD_Proposal::STATUSES as $key => $label ) :
					$row = isset( $pipeline['by_status'][ $key ] ) ? $pipeline['by_status'][ $key ] : array( 'count' => 0, 'value' => 0 ); ?>
					<tr>
						<td><?php echo esc_html( $label ); ?></td>
						<td class="num"><?php echo esc_html( number_format( $row['count'] ) ); ?></td>
						<td class="num"><?php echo esc_html( $gbp( $row['value'] ) ); ?></td>
					</tr>
				<?php endforeach; ?>
			</tbody>
		</table>
	</div>

	<!-- Project pipeline + funnel -->
	<div class="hgd-two-col">
		<div class="hgd-panel">
			<h2><?php esc_html_e( 'Projects by status', 'hillcroft-garden-designer' ); ?></h2>
			<table class="hgd-table">
				<tbody>
					<?php foreach ( HGD_Project::STATUSES as $key => $label ) : ?>
						<tr>
							<td>
								<a href="<?php echo esc_url( add_query_arg( array( 'page' => 'hgd-projects', 'status' => $key ), admin_url( 'admin.php' ) ) ); ?>"><?php echo esc_html( $label ); ?></a>
							</td>
							<td class="num"><?php echo esc_html( number_format( isset( $projects[ $key ] ) ? $projects[ $key ] : 0 ) ); ?></td>
						</tr>
					<?php endforeach; ?>
				</tbody>
			</table>
		</div>

		<div class="hgd-panel">
			<h2><?php esc_html_e( 'Acquisition funnel', 'hillcroft-garden-designer' ); ?></h2>
			<table class="hgd-table">
				<tbody>
					<tr><td><?php esc_html_e( 'Leads / projects', 'hillcroft-garden-designer' ); ?></td><td class="num"><?php echo esc_html( number_format( $funnel['leads'] ) ); ?></td></tr>
					<tr><td><?php esc_html_e( 'Paid consultations', 'hillcroft-garden-designer' ); ?></td><td class="num"><?php echo esc_html( number_format( $funnel['consultations'] ) ); ?></td></tr>
					<tr><td><?php esc_html_e( 'Proposals sent', 'hillcroft-garden-designer' ); ?></td><td class="num"><?php echo esc_html( number_format( $funnel['proposals_sent'] ) ); ?></td></tr>
					<tr><td><?php esc_html_e( 'Proposals accepted', 'hillcroft-garden-designer' ); ?></td><td class="num"><?php echo esc_html( number_format( $funnel['accepted'] ) ); ?></td></tr>
					<tr><td><?php esc_html_e( 'Projects complete', 'hillcroft-garden-designer' ); ?></td><td class="num"><?php echo esc_html( number_format( $funnel['complete'] ) ); ?></td></tr>
				</tbody>
			</table>
		</div>
	</div>

</div>
