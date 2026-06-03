<?php
/**
 * Forms hub (Forms tab). Expects $banner_cb and $forms (WP_Post[]).
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
$new_url = admin_url( 'post-new.php?post_type=' . HGDF_CPT );
?>
<div class="wrap hgd-wrap">

	<?php call_user_func( $banner_cb ); ?>

	<div class="hgd-page-head">
		<h1><?php esc_html_e( 'Forms', 'hillcroft-garden-designer' ); ?></h1>
		<a class="hgd-pill" href="<?php echo esc_url( $new_url ); ?>"><?php esc_html_e( '+ New form', 'hillcroft-garden-designer' ); ?></a>
	</div>

	<?php HGD_Admin::forms_tabs( 'hgd-forms' ); ?>

	<div class="hgd-panel" style="margin-top:16px;">
		<table class="hgd-table">
			<thead>
				<tr>
					<th><?php esc_html_e( 'Form', 'hillcroft-garden-designer' ); ?></th>
					<th><?php esc_html_e( 'Status', 'hillcroft-garden-designer' ); ?></th>
					<th><?php esc_html_e( 'Embed', 'hillcroft-garden-designer' ); ?></th>
					<th><?php esc_html_e( 'Updated', 'hillcroft-garden-designer' ); ?></th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				<?php if ( ! $forms ) : ?>
					<tr><td colspan="5" class="hgd-empty"><?php esc_html_e( 'No forms yet. Create one to start capturing enquiries.', 'hillcroft-garden-designer' ); ?></td></tr>
				<?php else : ?>
					<?php foreach ( $forms as $form ) :
						$edit_url    = get_edit_post_link( $form->ID, 'url' );
						$subs_url    = admin_url( 'admin.php?page=hgd-forms-submissions&form_id=' . $form->ID );
						$title       = $form->post_title ? $form->post_title : __( '(untitled form)', 'hillcroft-garden-designer' );
						?>
						<tr>
							<td><a href="<?php echo esc_url( $edit_url ); ?>"><strong><?php echo esc_html( $title ); ?></strong></a></td>
							<td><span class="hgd-status hgd-status-<?php echo esc_attr( $form->post_status ); ?>"><?php echo esc_html( ucfirst( $form->post_status ) ); ?></span></td>
							<td><code class="hgd-code">[hgd_form id="<?php echo (int) $form->ID; ?>"]</code></td>
							<td><?php echo esc_html( get_the_modified_date( 'j M Y', $form ) ); ?></td>
							<td class="actions">
								<a href="<?php echo esc_url( $edit_url ); ?>"><?php esc_html_e( 'Edit', 'hillcroft-garden-designer' ); ?></a>
								<a href="<?php echo esc_url( $subs_url ); ?>"><?php esc_html_e( 'Submissions', 'hillcroft-garden-designer' ); ?></a>
							</td>
						</tr>
					<?php endforeach; ?>
				<?php endif; ?>
			</tbody>
		</table>
	</div>

</div>
