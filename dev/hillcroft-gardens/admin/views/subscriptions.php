<?php
/**
 * Maintenance-plan subscriptions list.
 * Expects $banner_cb, $subscriptions (array), $status, $plans (array), $configured (bool).
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$statuses = array(
	'active'     => __( 'Active', 'hillcroft-garden-designer' ),
	'past_due'   => __( 'Payment failed', 'hillcroft-garden-designer' ),
	'incomplete' => __( 'Awaiting payment', 'hillcroft-garden-designer' ),
	'canceled'   => __( 'Cancelled', 'hillcroft-garden-designer' ),
);

$cancel_error = get_transient( 'hgd_sub_error_' . get_current_user_id() );
if ( $cancel_error ) {
	delete_transient( 'hgd_sub_error_' . get_current_user_id() );
}
?>
<div class="wrap hgd-wrap">

	<?php call_user_func( $banner_cb ); ?>

	<div class="hgd-page-head">
		<h1><?php esc_html_e( 'Maintenance plans', 'hillcroft-garden-designer' ); ?></h1>
		<span class="hgd-muted"><?php esc_html_e( 'Embed the sign-up anywhere with', 'hillcroft-garden-designer' ); ?> <code class="hgd-code">[hgd_maintenance_plans]</code></span>
	</div>

	<?php if ( ! $configured ) : ?>
		<div class="notice notice-warning inline"><p>
			<?php
			printf(
				/* translators: %s: settings link */
				wp_kses_post( __( 'Add your Stripe keys in <a href="%s">Settings</a> to start selling maintenance plans. Stripe handles the recurring billing, card retries and reminder emails.', 'hillcroft-garden-designer' ) ),
				esc_url( admin_url( 'admin.php?page=hgd-settings' ) )
			);
			?>
		</p></div>
	<?php endif; ?>

	<?php if ( isset( $_GET['cancelled'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
		<div class="notice notice-success inline"><p><?php esc_html_e( 'The plan will be cancelled at the end of the current billing period.', 'hillcroft-garden-designer' ); ?></p></div>
	<?php endif; ?>
	<?php if ( $cancel_error ) : ?>
		<div class="notice notice-error inline"><p><?php echo esc_html( $cancel_error ); ?></p></div>
	<?php endif; ?>

	<!-- Plan summary -->
	<div class="hgd-panel" style="margin-bottom:18px;">
		<table class="hgd-table">
			<thead>
				<tr>
					<th><?php esc_html_e( 'Plan', 'hillcroft-garden-designer' ); ?></th>
					<th class="num"><?php esc_html_e( 'Price', 'hillcroft-garden-designer' ); ?></th>
					<th><?php esc_html_e( 'Description', 'hillcroft-garden-designer' ); ?></th>
				</tr>
			</thead>
			<tbody>
				<?php foreach ( $plans as $key => $plan ) :
					$interval = isset( $plan['interval'] ) ? $plan['interval'] : 'month'; ?>
					<tr>
						<td><strong><?php echo esc_html( $plan['label'] ); ?></strong></td>
						<td class="num">£<?php echo esc_html( number_format( (float) $plan['price'], 2 ) ); ?> / <?php echo esc_html( $interval ); ?></td>
						<td><span class="hgd-muted"><?php echo esc_html( isset( $plan['blurb'] ) ? $plan['blurb'] : '' ); ?></span></td>
					</tr>
				<?php endforeach; ?>
			</tbody>
		</table>
	</div>

	<form method="get" class="hgd-filters">
		<input type="hidden" name="page" value="hgd-subscriptions" />
		<select name="status">
			<option value=""><?php esc_html_e( 'All statuses', 'hillcroft-garden-designer' ); ?></option>
			<?php foreach ( $statuses as $key => $label ) : ?>
				<option value="<?php echo esc_attr( $key ); ?>" <?php selected( $status, $key ); ?>><?php echo esc_html( $label ); ?></option>
			<?php endforeach; ?>
		</select>
		<button type="submit" class="hgd-pill hgd-pill-ghost"><?php esc_html_e( 'Filter', 'hillcroft-garden-designer' ); ?></button>
	</form>

	<div class="hgd-panel">
		<table class="hgd-table">
			<thead>
				<tr>
					<th><?php esc_html_e( 'Subscriber', 'hillcroft-garden-designer' ); ?></th>
					<th><?php esc_html_e( 'Plan', 'hillcroft-garden-designer' ); ?></th>
					<th><?php esc_html_e( 'Status', 'hillcroft-garden-designer' ); ?></th>
					<th class="num"><?php esc_html_e( 'Amount', 'hillcroft-garden-designer' ); ?></th>
					<th><?php esc_html_e( 'Next bill', 'hillcroft-garden-designer' ); ?></th>
					<th><?php esc_html_e( 'Started', 'hillcroft-garden-designer' ); ?></th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				<?php if ( ! $subscriptions ) : ?>
					<tr><td colspan="7" class="hgd-empty"><?php esc_html_e( 'No subscriptions yet. Maintenance-plan sign-ups appear here automatically.', 'hillcroft-garden-designer' ); ?></td></tr>
				<?php else : ?>
					<?php foreach ( $subscriptions as $sub ) :
						$next = ! empty( $sub['current_period_end'] ) ? mysql2date( 'j M Y', $sub['current_period_end'] ) : '—';
						$can_cancel = in_array( $sub['status'], array( 'active', 'past_due' ), true ) && empty( $sub['canceled_at'] );
						$cancel_url = wp_nonce_url(
							add_query_arg( array( 'action' => 'hgd_subscription_cancel', 'id' => (int) $sub['id'] ), admin_url( 'admin-post.php' ) ),
							'hgd_subscription_cancel_' . (int) $sub['id']
						);
						?>
						<tr>
							<td>
								<?php echo esc_html( $sub['name'] ); ?><br />
								<span class="hgd-muted"><?php echo esc_html( $sub['email'] ); ?></span>
							</td>
							<td><?php echo esc_html( $sub['plan_label'] ); ?></td>
							<td>
								<span class="hgd-status hgd-status-<?php echo esc_attr( $sub['status'] ); ?>"><?php echo esc_html( HGD_Subscription::status_label( $sub['status'] ) ); ?></span>
								<?php if ( ! empty( $sub['canceled_at'] ) && 'canceled' !== $sub['status'] ) : ?>
									<br /><span class="hgd-muted"><?php esc_html_e( 'cancelling', 'hillcroft-garden-designer' ); ?></span>
								<?php endif; ?>
							</td>
							<td class="num">£<?php echo esc_html( number_format( (float) $sub['amount_gbp'], 2 ) ); ?></td>
							<td><?php echo esc_html( $next ); ?></td>
							<td><?php echo esc_html( $sub['created_at'] ? mysql2date( 'j M Y', $sub['created_at'] ) : '—' ); ?></td>
							<td>
								<?php if ( ! empty( $sub['client_id'] ) ) : ?>
									<a href="<?php echo esc_url( add_query_arg( array( 'page' => 'hgd-clients', 'action' => 'edit', 'id' => (int) $sub['client_id'] ), admin_url( 'admin.php' ) ) ); ?>"><?php esc_html_e( 'Client', 'hillcroft-garden-designer' ); ?></a>
								<?php endif; ?>
								<?php if ( ! empty( $sub['stripe_customer_id'] ) ) : ?>
									&nbsp;<a href="<?php echo esc_url( HGD_Subscription::manage_url( $sub ) ); ?>" target="_blank" rel="noopener" title="<?php esc_attr_e( 'Opens the customer\'s self-service billing portal', 'hillcroft-garden-designer' ); ?>"><?php esc_html_e( 'Manage link', 'hillcroft-garden-designer' ); ?></a>
								<?php endif; ?>
								<?php if ( $can_cancel ) : ?>
									&nbsp;<a href="<?php echo esc_url( $cancel_url ); ?>" class="hgd-link-danger" onclick="return confirm('<?php echo esc_js( __( 'Cancel this plan at the end of the current billing period?', 'hillcroft-garden-designer' ) ); ?>');"><?php esc_html_e( 'Cancel', 'hillcroft-garden-designer' ); ?></a>
								<?php endif; ?>
							</td>
						</tr>
					<?php endforeach; ?>
				<?php endif; ?>
			</tbody>
		</table>
	</div>

</div>
