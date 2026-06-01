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

/** Render the 48×48 row thumbnail (real image or a branded placeholder). */
$render_thumb = function ( $p ) {
	$image_id = isset( $p['image_id'] ) ? (int) $p['image_id'] : 0;
	if ( $image_id > 0 && wp_attachment_is_image( $image_id ) ) {
		echo wp_get_attachment_image( $image_id, array( 48, 48 ), false, array( 'class' => 'hgd-plant-thumb' ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		return;
	}
	$source  = '' !== trim( (string) $p['botanical_name'] ) ? $p['botanical_name'] : (string) $p['common_name'];
	$initial = '' !== trim( $source ) ? mb_strtoupper( mb_substr( trim( $source ), 0, 1 ) ) : '✿';
	echo '<span class="hgd-plant-thumb hgd-plant-thumb-empty" aria-hidden="true">' . esc_html( $initial ) . '</span>';
};

/** Render the expandable detail grid for a plant — only fields with a value. */
$render_detail = function ( $p ) {
	$rows = array();

	$add = function ( $label, $value ) use ( &$rows ) {
		$value = trim( (string) $value );
		if ( '' !== $value ) {
			$rows[] = array( $label, $value );
		}
	};

	$add( __( 'Pot size / grade', 'hillcroft-garden-designer' ), $p['pot_size'] );

	$supplier = trim( (string) $p['supplier'] );
	if ( '' !== trim( (string) $p['supplier_sku'] ) ) {
		$supplier = ( '' !== $supplier ? $supplier . ' · ' : '' ) . __( 'SKU ', 'hillcroft-garden-designer' ) . trim( (string) $p['supplier_sku'] );
	}
	$add( __( 'Supplier', 'hillcroft-garden-designer' ), $supplier );

	if ( (int) $p['lead_time_days'] > 0 ) {
		$add( __( 'Lead time', 'hillcroft-garden-designer' ), sprintf( _n( '%d day', '%d days', (int) $p['lead_time_days'], 'hillcroft-garden-designer' ), (int) $p['lead_time_days'] ) );
	}
	if ( (int) $p['min_order_qty'] > 0 ) {
		$add( __( 'Min order qty', 'hillcroft-garden-designer' ), (int) $p['min_order_qty'] );
	}

	$h = (int) $p['mature_height_cm'];
	$w = (int) $p['mature_spread_cm'];
	if ( $h > 0 || $w > 0 ) {
		$add( __( 'Mature H × W', 'hillcroft-garden-designer' ), ( $h > 0 ? $h : '?' ) . ' × ' . ( $w > 0 ? $w : '?' ) . ' cm' );
	}
	if ( (float) $p['spacing_per_sqm'] > 0 ) {
		$add( __( 'Spacing', 'hillcroft-garden-designer' ), sprintf( __( '%s / m²', 'hillcroft-garden-designer' ), rtrim( rtrim( number_format( (float) $p['spacing_per_sqm'], 2 ), '0' ), '.' ) ) );
	}

	if ( '' !== trim( (string) $p['sun'] ) ) {
		$add( __( 'Sun', 'hillcroft-garden-designer' ), ucwords( str_replace( '_', ' ', $p['sun'] ) ) );
	}
	$add( __( 'Soil', 'hillcroft-garden-designer' ), $p['soil'] );
	$add( __( 'Hardiness', 'hillcroft-garden-designer' ), $p['hardiness'] );
	if ( '' !== trim( (string) $p['foliage'] ) ) {
		$add( __( 'Foliage', 'hillcroft-garden-designer' ), ucwords( str_replace( '_', ' ', $p['foliage'] ) ) );
	}
	$add( __( 'Flowering months', 'hillcroft-garden-designer' ), $p['flowering_months'] );
	if ( '' !== trim( (string) $p['toxicity'] ) && 'none' !== $p['toxicity'] ) {
		$add( __( 'Toxicity', 'hillcroft-garden-designer' ), ucfirst( $p['toxicity'] ) );
	}
	$add( __( 'Notes', 'hillcroft-garden-designer' ), $p['notes'] );

	if ( ! $rows ) {
		echo '<p class="hgd-muted">' . esc_html__( 'No extra details recorded yet. Use Edit to add them.', 'hillcroft-garden-designer' ) . '</p>';
		return;
	}

	echo '<dl class="hgd-plant-detail-grid">';
	foreach ( $rows as $row ) {
		echo '<div class="hgd-plant-detail-item">';
		echo '<dt>' . esc_html( $row[0] ) . '</dt>';
		echo '<dd>' . esc_html( $row[1] ) . '</dd>';
		echo '</div>';
	}
	echo '</dl>';
};
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
				<input type="file" id="hgd-csv-input" name="csv" accept=".csv,text/csv" class="hgd-visually-hidden" data-hgd-csv-auto required />
				<label for="hgd-csv-input" class="hgd-pill hgd-pill-ghost"><?php esc_html_e( 'Import CSV', 'hillcroft-garden-designer' ); ?></label>
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
		<table class="hgd-table hgd-plants-table">
			<thead>
				<tr>
					<th class="hgd-col-thumb"></th>
					<th><?php esc_html_e( 'Botanical', 'hillcroft-garden-designer' ); ?></th>
					<th><?php esc_html_e( 'Common', 'hillcroft-garden-designer' ); ?></th>
					<th><?php esc_html_e( 'Type', 'hillcroft-garden-designer' ); ?></th>
					<th><?php esc_html_e( 'Supplier', 'hillcroft-garden-designer' ); ?></th>
					<th class="num"><?php esc_html_e( 'Cost', 'hillcroft-garden-designer' ); ?></th>
					<th class="num"><?php esc_html_e( 'Retail', 'hillcroft-garden-designer' ); ?></th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				<?php if ( ! $items ) : ?>
					<tr><td colspan="8" class="hgd-empty"><?php esc_html_e( 'No plants yet. Add your first one to start building the catalogue.', 'hillcroft-garden-designer' ); ?></td></tr>
				<?php else : ?>
					<?php foreach ( $items as $p ) :
						$edit_url   = add_query_arg( array( 'action' => 'edit', 'id' => (int) $p['id'] ), $base_url );
						$delete_url = wp_nonce_url( add_query_arg( array( 'action' => 'hgd_delete_plant', 'id' => (int) $p['id'] ), admin_url( 'admin-post.php' ) ), 'hgd_delete_plant_' . (int) $p['id'] );
						$label      = '' !== trim( (string) $p['botanical_name'] ) ? $p['botanical_name'] : $p['common_name'];
						?>
						<tr class="hgd-plant-row" tabindex="0" role="button" aria-expanded="false" aria-label="<?php echo esc_attr( sprintf( __( 'Show details for %s', 'hillcroft-garden-designer' ), $label ) ); ?>">
							<td class="hgd-col-thumb"><?php $render_thumb( $p ); ?></td>
							<td><span class="hgd-plant-caret" aria-hidden="true">▸</span><em><?php echo esc_html( $p['botanical_name'] ); ?></em></td>
							<td><?php echo esc_html( $p['common_name'] ); ?></td>
							<td><?php echo esc_html( ucfirst( $p['plant_type'] ) ); ?></td>
							<td><?php echo esc_html( $p['supplier'] ); ?></td>
							<td class="num">£<?php echo esc_html( number_format( (float) $p['unit_cost'], 2 ) ); ?></td>
							<td class="num">£<?php echo esc_html( number_format( HGD_Plant::unit_price( $p ), 2 ) ); ?></td>
							<td class="actions">
								<a href="<?php echo esc_url( $edit_url ); ?>" data-hgd-no-expand><?php esc_html_e( 'Edit', 'hillcroft-garden-designer' ); ?></a>
								<a class="hgd-danger" href="<?php echo esc_url( $delete_url ); ?>" data-hgd-no-expand onclick="return confirm('<?php echo esc_js( __( 'Delete this plant?', 'hillcroft-garden-designer' ) ); ?>');"><?php esc_html_e( 'Delete', 'hillcroft-garden-designer' ); ?></a>
							</td>
						</tr>
						<tr class="hgd-plant-detail">
							<td colspan="8">
								<?php $render_detail( $p ); ?>
								<?php if ( ! ( isset( $p['image_id'] ) && (int) $p['image_id'] > 0 ) ) : ?>
									<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="hgd-plant-detail-fetch">
										<input type="hidden" name="action" value="hgd_plant_fetch_photo" />
										<input type="hidden" name="id" value="<?php echo esc_attr( (int) $p['id'] ); ?>" />
										<?php wp_nonce_field( 'hgd_plant_fetch_photo_' . (int) $p['id'] ); ?>
										<button type="submit" class="hgd-link-btn" data-hgd-no-expand><?php esc_html_e( 'Fetch photo from Wikipedia', 'hillcroft-garden-designer' ); ?></button>
									</form>
								<?php endif; ?>
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
