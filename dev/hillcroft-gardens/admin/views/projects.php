<?php
/**
 * Projects list. Expects $banner_cb, $projects (array), $status, $search.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
$base_url       = admin_url( 'admin.php?page=hgd-projects' );
$post_url       = admin_url( 'admin-post.php' );
$example_exists = HGD_Demo::exists();
?>
<div class="wrap hgd-wrap">

	<?php call_user_func( $banner_cb ); ?>

	<div class="hgd-page-head">
		<h1><?php esc_html_e( 'Projects', 'hillcroft-garden-designer' ); ?></h1>
		<div class="hgd-page-head-actions">
			<?php if ( $example_exists ) : ?>
				<a class="hgd-pill hgd-pill-ghost" href="<?php echo esc_url( add_query_arg( array( 'action' => 'edit', 'id' => HGD_Demo::project_id() ), $base_url ) ); ?>"><?php esc_html_e( 'Open example', 'hillcroft-garden-designer' ); ?></a>
				<form method="post" action="<?php echo esc_url( $post_url ); ?>" style="display:inline;" onsubmit="return confirm('<?php echo esc_js( __( 'Remove the example project and all of its demo data?', 'hillcroft-garden-designer' ) ); ?>');">
					<input type="hidden" name="action" value="hgd_remove_example" />
					<?php wp_nonce_field( 'hgd_remove_example' ); ?>
					<button type="submit" class="hgd-pill hgd-pill-ghost"><?php esc_html_e( 'Remove example project', 'hillcroft-garden-designer' ); ?></button>
				</form>
			<?php else : ?>
				<form method="post" action="<?php echo esc_url( $post_url ); ?>" style="display:inline;">
					<input type="hidden" name="action" value="hgd_create_example" />
					<?php wp_nonce_field( 'hgd_create_example' ); ?>
					<button type="submit" class="hgd-pill hgd-pill-ghost"><?php esc_html_e( 'Create example project', 'hillcroft-garden-designer' ); ?></button>
				</form>
			<?php endif; ?>
			<a class="hgd-pill" href="<?php echo esc_url( add_query_arg( 'action', 'new', $base_url ) ); ?>"><?php esc_html_e( '+ New project', 'hillcroft-garden-designer' ); ?></a>
		</div>
	</div>

	<?php if ( ! $example_exists ) : ?>
		<p class="hgd-muted hgd-example-hint"><?php esc_html_e( 'A complete, clickable demo using placeholder images and no API calls — explore the whole flow, then remove it.', 'hillcroft-garden-designer' ); ?></p>
	<?php endif; ?>

	<?php if ( isset( $_GET['example'] ) && 'created' === $_GET['example'] ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
		<div class="hgd-flash"><?php esc_html_e( 'Example project created.', 'hillcroft-garden-designer' ); ?></div>
	<?php elseif ( isset( $_GET['example'] ) && 'removed' === $_GET['example'] ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
		<div class="hgd-flash"><?php esc_html_e( 'Example project removed.', 'hillcroft-garden-designer' ); ?></div>
	<?php endif; ?>

	<?php if ( isset( $_GET['deleted'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
		<div class="hgd-flash"><?php esc_html_e( 'Project deleted.', 'hillcroft-garden-designer' ); ?></div>
	<?php endif; ?>

	<form method="get" class="hgd-filters">
		<input type="hidden" name="page" value="hgd-projects" />
		<input type="search" name="s" value="<?php echo esc_attr( $search ); ?>" placeholder="<?php esc_attr_e( 'Search project or client…', 'hillcroft-garden-designer' ); ?>" />
		<select name="status">
			<option value=""><?php esc_html_e( 'All statuses', 'hillcroft-garden-designer' ); ?></option>
			<?php foreach ( HGD_Project::STATUSES as $key => $label ) : ?>
				<option value="<?php echo esc_attr( $key ); ?>" <?php selected( $status, $key ); ?>><?php echo esc_html( $label ); ?></option>
			<?php endforeach; ?>
		</select>
		<button type="submit" class="hgd-pill hgd-pill-ghost"><?php esc_html_e( 'Filter', 'hillcroft-garden-designer' ); ?></button>
	</form>

	<div class="hgd-panel">
		<table class="hgd-table">
			<thead>
				<tr>
					<th><?php esc_html_e( 'Project', 'hillcroft-garden-designer' ); ?></th>
					<th><?php esc_html_e( 'Client', 'hillcroft-garden-designer' ); ?></th>
					<th><?php esc_html_e( 'Status', 'hillcroft-garden-designer' ); ?></th>
					<th><?php esc_html_e( 'Source', 'hillcroft-garden-designer' ); ?></th>
					<th><?php esc_html_e( 'Created', 'hillcroft-garden-designer' ); ?></th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				<?php if ( ! $projects ) : ?>
					<tr><td colspan="6" class="hgd-empty"><?php esc_html_e( 'No projects yet. New enquiries appear here automatically, or add one manually.', 'hillcroft-garden-designer' ); ?></td></tr>
				<?php else : ?>
					<?php foreach ( $projects as $p ) :
						$edit_url   = add_query_arg( array( 'action' => 'edit', 'id' => (int) $p['id'] ), $base_url );
						$delete_url = wp_nonce_url( add_query_arg( array( 'action' => 'hgd_delete_project', 'id' => (int) $p['id'] ), admin_url( 'admin-post.php' ) ), 'hgd_delete_project_' . (int) $p['id'] );
						$client     = trim( ( $p['first_name'] ?? '' ) . ' ' . ( $p['last_name'] ?? '' ) );
						$client     = '' !== $client ? $client : ( $p['email'] ?? '—' );
						?>
						<tr>
							<td><a href="<?php echo esc_url( $edit_url ); ?>"><strong><?php echo esc_html( $p['title'] ); ?></strong></a></td>
							<td><?php echo esc_html( $client ); ?></td>
							<td><span class="hgd-status hgd-status-<?php echo esc_attr( $p['status'] ); ?>"><?php echo esc_html( HGD_Project::status_label( $p['status'] ) ); ?></span></td>
							<td><?php echo esc_html( HGD_Project::SOURCES[ $p['source'] ] ?? $p['source'] ); ?></td>
							<td><?php echo esc_html( mysql2date( 'j M Y', $p['created_at'] ) ); ?></td>
							<td class="actions">
								<a href="<?php echo esc_url( $edit_url ); ?>"><?php esc_html_e( 'Open', 'hillcroft-garden-designer' ); ?></a>
								<a class="hgd-danger" href="<?php echo esc_url( $delete_url ); ?>" onclick="return confirm('<?php echo esc_js( __( 'Delete this project?', 'hillcroft-garden-designer' ) ); ?>');"><?php esc_html_e( 'Delete', 'hillcroft-garden-designer' ); ?></a>
							</td>
						</tr>
					<?php endforeach; ?>
				<?php endif; ?>
			</tbody>
		</table>
	</div>

</div>
