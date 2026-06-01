<?php
/**
 * Plant catalogue list. Expects $banner_cb, $result (items,total), $search, $type, $paged, $per_page.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
$total       = $result['total'];
$items       = $result['items'];
$total_pages = max( 1, (int) ceil( $total / $per_page ) );
$base_url    = admin_url( 'admin.php?page=hgd-plants' );
?>
<div class="wrap hgd-wrap">

	<?php call_user_func( $banner_cb ); ?>

	<?php
	$export_url = wp_nonce_url(
		add_query_arg( array( 'action' => 'hgd_plants_export' ), admin_url( 'admin-post.php' ) ),
		'hgd_plants_export'
	);
	?>
	<div class="hgd-page-head">
		<h1><?php esc_html_e( 'Plant Catalogue', 'hillcroft-garden-designer' ); ?></h1>
		<div class="hgd-page-head-actions">
			<a class="hgd-pill" href="<?php echo esc_url( add_query_arg( array( 'action' => 'new' ), $base_url ) ); ?>"><?php esc_html_e( '+ Add plant', 'hillcroft-garden-designer' ); ?></a>
			<a class="hgd-pill hgd-pill-ghost" href="<?php echo esc_url( $export_url ); ?>"><?php esc_html_e( 'Export CSV', 'hillcroft-garden-designer' ); ?></a>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" enctype="multipart/form-data" class="hgd-csv-import">
				<input type="hidden" name="action" value="hgd_plants_import" />
				<?php wp_nonce_field( 'hgd_plants_import' ); ?>
				<input type="file" name="csv" accept=".csv,text/csv" required />
				<button type="submit" class="hgd-pill hgd-pill-ghost"><?php esc_html_e( 'Import', 'hillcroft-garden-designer' ); ?></button>
			</form>
		</div>
	</div>
	<p class="hgd-muted"><?php esc_html_e( 'Import adds new plants — the columns match the exported CSV (the header row maps to plant fields; unknown columns are ignored).', 'hillcroft-garden-designer' ); ?></p>

	<?php if ( isset( $_GET['updated'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
		<div class="hgd-flash"><?php esc_html_e( 'Plant saved.', 'hillcroft-garden-designer' ); ?></div>
	<?php elseif ( isset( $_GET['deleted'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
		<div class="hgd-flash"><?php esc_html_e( 'Plant deleted.', 'hillcroft-garden-designer' ); ?></div>
	<?php endif; ?>

	<?php if ( isset( $_GET['imported'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
		<div class="hgd-flash"><?php
			echo esc_html( sprintf(
				/* translators: 1: imported count, 2: skipped count */
				__( 'Import complete: %1$d plants added, %2$d rows skipped.', 'hillcroft-garden-designer' ),
				(int) $_GET['imported'], // phpcs:ignore WordPress.Security.NonceVerification
				isset( $_GET['skipped'] ) ? (int) $_GET['skipped'] : 0 // phpcs:ignore WordPress.Security.NonceVerification
			) );
		?></div>
	<?php elseif ( isset( $_GET['import_error'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
		<div class="hgd-flash hgd-flash-error"><?php esc_html_e( 'Could not import that CSV. Please check the file and try again.', 'hillcroft-garden-designer' ); ?></div>
	<?php endif; ?>

	<form method="get" class="hgd-filters">
		<input type="hidden" name="page" value="hgd-plants" />
		<input type="search" name="s" value="<?php echo esc_attr( $search ); ?>" placeholder="<?php esc_attr_e( 'Search name or supplier…', 'hillcroft-garden-designer' ); ?>" />
		<select name="type">
			<option value=""><?php esc_html_e( 'All types', 'hillcroft-garden-designer' ); ?></option>
			<?php foreach ( HGD_Plant::TYPES as $t ) : ?>
				<option value="<?php echo esc_attr( $t ); ?>" <?php selected( $type, $t ); ?>><?php echo esc_html( ucfirst( $t ) ); ?></option>
			<?php endforeach; ?>
		</select>
		<button type="submit" class="hgd-pill hgd-pill-ghost"><?php esc_html_e( 'Filter', 'hillcroft-garden-designer' ); ?></button>
	</form>

	<div class="hgd-panel">
		<table class="hgd-table">
			<thead>
				<tr>
					<th><?php esc_html_e( 'Botanical', 'hillcroft-garden-designer' ); ?></th>
					<th><?php esc_html_e( 'Common', 'hillcroft-garden-designer' ); ?></th>
					<th><?php esc_html_e( 'Type', 'hillcroft-garden-designer' ); ?></th>
					<th><?php esc_html_e( 'Supplier', 'hillcroft-garden-designer' ); ?></th>
					<th class="num"><?php esc_html_e( 'Cost', 'hillcroft-garden-designer' ); ?></th>
					<th class="num"><?php esc_html_e( 'Sale', 'hillcroft-garden-designer' ); ?></th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				<?php if ( ! $items ) : ?>
					<tr><td colspan="7" class="hgd-empty"><?php esc_html_e( 'No plants yet. Add your first one to start building the catalogue.', 'hillcroft-garden-designer' ); ?></td></tr>
				<?php else : ?>
					<?php foreach ( $items as $p ) :
						$edit_url   = add_query_arg( array( 'action' => 'edit', 'id' => (int) $p['id'] ), $base_url );
						$delete_url = wp_nonce_url( add_query_arg( array( 'action' => 'hgd_delete_plant', 'id' => (int) $p['id'] ), admin_url( 'admin-post.php' ) ), 'hgd_delete_plant_' . (int) $p['id'] );
						?>
						<tr>
							<td><em><?php echo esc_html( $p['botanical_name'] ); ?></em></td>
							<td><?php echo esc_html( $p['common_name'] ); ?></td>
							<td><?php echo esc_html( ucfirst( $p['plant_type'] ) ); ?></td>
							<td><?php echo esc_html( $p['supplier'] ); ?></td>
							<td class="num">£<?php echo esc_html( number_format( (float) $p['unit_cost'], 2 ) ); ?></td>
							<td class="num">£<?php echo esc_html( number_format( HGD_Plant::unit_price( $p ), 2 ) ); ?></td>
							<td class="actions">
								<a href="<?php echo esc_url( $edit_url ); ?>"><?php esc_html_e( 'Edit', 'hillcroft-garden-designer' ); ?></a>
								<a class="hgd-danger" href="<?php echo esc_url( $delete_url ); ?>" onclick="return confirm('<?php echo esc_js( __( 'Delete this plant?', 'hillcroft-garden-designer' ) ); ?>');"><?php esc_html_e( 'Delete', 'hillcroft-garden-designer' ); ?></a>
							</td>
						</tr>
					<?php endforeach; ?>
				<?php endif; ?>
			</tbody>
		</table>
	</div>

	<?php if ( $total_pages > 1 ) : ?>
		<div class="hgd-pagination">
			<?php
			for ( $i = 1; $i <= $total_pages; $i++ ) :
				$url = add_query_arg( array( 's' => $search, 'type' => $type, 'paged' => $i ), $base_url );
				?>
				<a class="hgd-page <?php echo $i === $paged ? 'current' : ''; ?>" href="<?php echo esc_url( $url ); ?>"><?php echo esc_html( $i ); ?></a>
			<?php endfor; ?>
		</div>
	<?php endif; ?>

</div>
