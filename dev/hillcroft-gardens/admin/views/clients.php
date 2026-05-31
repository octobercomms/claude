<?php
/**
 * Clients list. Expects $banner_cb, $clients (array).
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
$base_url = admin_url( 'admin.php?page=hgd-clients' );
?>
<div class="wrap hgd-wrap">

	<?php call_user_func( $banner_cb ); ?>

	<div class="hgd-page-head">
		<h1><?php esc_html_e( 'Clients', 'hillcroft-garden-designer' ); ?></h1>
		<a class="hgd-pill" href="<?php echo esc_url( add_query_arg( 'action', 'new', $base_url ) ); ?>"><?php esc_html_e( '+ New client', 'hillcroft-garden-designer' ); ?></a>
	</div>

	<?php if ( isset( $_GET['updated'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
		<div class="hgd-flash"><?php esc_html_e( 'Client saved.', 'hillcroft-garden-designer' ); ?></div>
	<?php elseif ( isset( $_GET['deleted'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
		<div class="hgd-flash"><?php esc_html_e( 'Client deleted.', 'hillcroft-garden-designer' ); ?></div>
	<?php endif; ?>

	<div class="hgd-panel">
		<table class="hgd-table">
			<thead>
				<tr>
					<th><?php esc_html_e( 'Name', 'hillcroft-garden-designer' ); ?></th>
					<th><?php esc_html_e( 'Email', 'hillcroft-garden-designer' ); ?></th>
					<th><?php esc_html_e( 'Phone', 'hillcroft-garden-designer' ); ?></th>
					<th><?php esc_html_e( 'Postcode', 'hillcroft-garden-designer' ); ?></th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				<?php if ( ! $clients ) : ?>
					<tr><td colspan="5" class="hgd-empty"><?php esc_html_e( 'No clients yet.', 'hillcroft-garden-designer' ); ?></td></tr>
				<?php else : ?>
					<?php foreach ( $clients as $c ) :
						$edit_url   = add_query_arg( array( 'action' => 'edit', 'id' => (int) $c['id'] ), $base_url );
						$delete_url = wp_nonce_url( add_query_arg( array( 'action' => 'hgd_delete_client', 'id' => (int) $c['id'] ), admin_url( 'admin-post.php' ) ), 'hgd_delete_client_' . (int) $c['id'] );
						?>
						<tr>
							<td><a href="<?php echo esc_url( $edit_url ); ?>"><strong><?php echo esc_html( HGD_Client::full_name( $c ) ); ?></strong></a></td>
							<td><?php echo esc_html( $c['email'] ); ?></td>
							<td><?php echo esc_html( $c['phone'] ); ?></td>
							<td><?php echo esc_html( $c['postcode'] ); ?></td>
							<td class="actions">
								<a href="<?php echo esc_url( $edit_url ); ?>"><?php esc_html_e( 'Edit', 'hillcroft-garden-designer' ); ?></a>
								<a class="hgd-danger" href="<?php echo esc_url( $delete_url ); ?>" onclick="return confirm('<?php echo esc_js( __( 'Delete this client? Their projects are kept but unlinked.', 'hillcroft-garden-designer' ) ); ?>');"><?php esc_html_e( 'Delete', 'hillcroft-garden-designer' ); ?></a>
							</td>
						</tr>
					<?php endforeach; ?>
				<?php endif; ?>
			</tbody>
		</table>
	</div>

</div>
