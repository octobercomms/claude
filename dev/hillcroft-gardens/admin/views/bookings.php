<?php
/**
 * Bookings list. Expects $banner_cb, $bookings (array), $status.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
$base_url = admin_url( 'admin.php?page=hgd-bookings' );
?>
<div class="wrap hgd-wrap">

	<?php call_user_func( $banner_cb ); ?>

	<div class="hgd-page-head">
		<h1><?php esc_html_e( 'Consultation bookings', 'hillcroft-garden-designer' ); ?></h1>
		<span class="hgd-muted"><?php esc_html_e( 'Embed the booking form anywhere with', 'hillcroft-garden-designer' ); ?> <code class="hgd-code">[hgd_booking]</code></span>
	</div>

	<form method="get" class="hgd-filters">
		<input type="hidden" name="page" value="hgd-bookings" />
		<select name="status">
			<option value=""><?php esc_html_e( 'All statuses', 'hillcroft-garden-designer' ); ?></option>
			<?php foreach ( HGD_Booking::STATUSES as $key => $label ) : ?>
				<option value="<?php echo esc_attr( $key ); ?>" <?php selected( $status, $key ); ?>><?php echo esc_html( $label ); ?></option>
			<?php endforeach; ?>
		</select>
		<button type="submit" class="hgd-pill hgd-pill-ghost"><?php esc_html_e( 'Filter', 'hillcroft-garden-designer' ); ?></button>
	</form>

	<div class="hgd-panel">
		<table class="hgd-table">
			<thead>
				<tr>
					<th><?php esc_html_e( 'When', 'hillcroft-garden-designer' ); ?></th>
					<th><?php esc_html_e( 'Client', 'hillcroft-garden-designer' ); ?></th>
					<th><?php esc_html_e( 'Status', 'hillcroft-garden-designer' ); ?></th>
					<th class="num"><?php esc_html_e( 'Fee', 'hillcroft-garden-designer' ); ?></th>
					<th><?php esc_html_e( 'Project', 'hillcroft-garden-designer' ); ?></th>
				</tr>
			</thead>
			<tbody>
				<?php if ( ! $bookings ) : ?>
					<tr><td colspan="5" class="hgd-empty"><?php esc_html_e( 'No bookings yet. Paid consultations appear here automatically.', 'hillcroft-garden-designer' ); ?></td></tr>
				<?php else : ?>
					<?php foreach ( $bookings as $b ) :
						$when = $b['slot_start'] ? mysql2date( 'j M Y · g:ia', $b['slot_start'] ) : '—';
						?>
						<tr>
							<td><strong><?php echo esc_html( $when ); ?></strong></td>
							<td>
								<?php echo esc_html( $b['name'] ); ?><br />
								<span class="hgd-muted"><?php echo esc_html( $b['email'] ); ?></span>
							</td>
							<td><span class="hgd-status hgd-status-<?php echo esc_attr( $b['status'] ); ?>"><?php echo esc_html( HGD_Booking::status_label( $b['status'] ) ); ?></span></td>
							<td class="num">£<?php echo esc_html( number_format( (float) $b['amount_gbp'], 2 ) ); ?></td>
							<td>
								<?php if ( ! empty( $b['project_id'] ) ) : ?>
									<a href="<?php echo esc_url( add_query_arg( array( 'page' => 'hgd-projects', 'action' => 'edit', 'id' => (int) $b['project_id'] ), admin_url( 'admin.php' ) ) ); ?>"><?php esc_html_e( 'Open project', 'hillcroft-garden-designer' ); ?></a>
								<?php else : ?>
									<span class="hgd-muted">—</span>
								<?php endif; ?>
							</td>
						</tr>
					<?php endforeach; ?>
				<?php endif; ?>
			</tbody>
		</table>
	</div>

</div>
