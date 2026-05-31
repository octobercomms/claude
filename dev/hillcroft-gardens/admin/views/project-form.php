<?php
/**
 * Add / edit a project. Expects $banner_cb, $project (array, empty for new), $clients (array).
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
$is_edit = ! empty( $project['id'] );
$val     = function ( $key, $default = '' ) use ( $project ) {
	return isset( $project[ $key ] ) ? $project[ $key ] : $default;
};
$list_url = admin_url( 'admin.php?page=hgd-projects' );
?>
<div class="wrap hgd-wrap">

	<?php call_user_func( $banner_cb ); ?>

	<div class="hgd-page-head">
		<h1><?php echo $is_edit ? esc_html__( 'Edit project', 'hillcroft-garden-designer' ) : esc_html__( 'New project', 'hillcroft-garden-designer' ); ?></h1>
		<a class="hgd-pill hgd-pill-ghost" href="<?php echo esc_url( $list_url ); ?>"><?php esc_html_e( '← All projects', 'hillcroft-garden-designer' ); ?></a>
	</div>

	<?php if ( isset( $_GET['updated'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
		<div class="hgd-flash"><?php esc_html_e( 'Project saved.', 'hillcroft-garden-designer' ); ?></div>
	<?php endif; ?>

	<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="hgd-panel hgd-form">
		<input type="hidden" name="action" value="hgd_save_project" />
		<input type="hidden" name="id" value="<?php echo esc_attr( (int) $val( 'id', 0 ) ); ?>" />
		<?php wp_nonce_field( 'hgd_save_project' ); ?>

		<div class="hgd-grid">
			<label><span><?php esc_html_e( 'Project title', 'hillcroft-garden-designer' ); ?></span>
				<input type="text" name="title" value="<?php echo esc_attr( $val( 'title' ) ); ?>" placeholder="<?php esc_attr_e( "e.g. Meli's Garden", 'hillcroft-garden-designer' ); ?>" /></label>

			<label><span><?php esc_html_e( 'Status', 'hillcroft-garden-designer' ); ?></span>
				<select name="status">
					<?php foreach ( HGD_Project::STATUSES as $key => $label ) : ?>
						<option value="<?php echo esc_attr( $key ); ?>" <?php selected( $val( 'status', 'lead' ), $key ); ?>><?php echo esc_html( $label ); ?></option>
					<?php endforeach; ?>
				</select></label>

			<label><span><?php esc_html_e( 'Existing client', 'hillcroft-garden-designer' ); ?></span>
				<select name="client_id">
					<option value=""><?php esc_html_e( '— none / add below —', 'hillcroft-garden-designer' ); ?></option>
					<?php foreach ( $clients as $c ) : ?>
						<option value="<?php echo esc_attr( $c['id'] ); ?>" <?php selected( (int) $val( 'client_id' ), (int) $c['id'] ); ?>><?php echo esc_html( HGD_Client::full_name( $c ) ); ?></option>
					<?php endforeach; ?>
				</select></label>

			<label><span><?php esc_html_e( 'Source', 'hillcroft-garden-designer' ); ?></span>
				<select name="source">
					<?php foreach ( HGD_Project::SOURCES as $key => $label ) : ?>
						<option value="<?php echo esc_attr( $key ); ?>" <?php selected( $val( 'source', 'manual' ), $key ); ?>><?php echo esc_html( $label ); ?></option>
					<?php endforeach; ?>
				</select></label>
		</div>

		<?php if ( ! $is_edit ) : ?>
			<div class="hgd-subform">
				<p class="hgd-muted"><?php esc_html_e( 'Or add a new client (used only if no existing client is selected):', 'hillcroft-garden-designer' ); ?></p>
				<div class="hgd-grid">
					<label><span><?php esc_html_e( 'New client name', 'hillcroft-garden-designer' ); ?></span>
						<input type="text" name="new_client_name" value="" /></label>
					<label><span><?php esc_html_e( 'New client email', 'hillcroft-garden-designer' ); ?></span>
						<input type="email" name="new_client_email" value="" /></label>
				</div>
			</div>
		<?php endif; ?>

		<div class="hgd-grid">
			<label><span><?php esc_html_e( 'Garden address', 'hillcroft-garden-designer' ); ?></span>
				<input type="text" name="address" value="<?php echo esc_attr( $val( 'address' ) ); ?>" /></label>
			<label><span><?php esc_html_e( 'Postcode', 'hillcroft-garden-designer' ); ?></span>
				<input type="text" name="postcode" value="<?php echo esc_attr( $val( 'postcode' ) ); ?>" /></label>

			<label><span><?php esc_html_e( 'Budget range', 'hillcroft-garden-designer' ); ?></span>
				<input type="text" name="budget_range" value="<?php echo esc_attr( $val( 'budget_range' ) ); ?>" /></label>
			<label><span><?php esc_html_e( 'Style preferences', 'hillcroft-garden-designer' ); ?></span>
				<input type="text" name="style_prefs" value="<?php echo esc_attr( $val( 'style_prefs' ) ); ?>" placeholder="<?php esc_attr_e( 'e.g. cottage, modern, wildlife', 'hillcroft-garden-designer' ); ?>" /></label>
		</div>

		<div class="hgd-checks">
			<label class="hgd-checkbox"><input type="checkbox" name="has_pets" value="1" <?php checked( ! empty( $val( 'has_pets' ) ) ); ?> /> <span><?php esc_html_e( 'Pets at home (flag toxic plants)', 'hillcroft-garden-designer' ); ?></span></label>
			<label class="hgd-checkbox"><input type="checkbox" name="has_children" value="1" <?php checked( ! empty( $val( 'has_children' ) ) ); ?> /> <span><?php esc_html_e( 'Children at home', 'hillcroft-garden-designer' ); ?></span></label>
		</div>

		<label class="hgd-full"><span><?php esc_html_e( 'Brief / notes', 'hillcroft-garden-designer' ); ?></span>
			<textarea name="brief_notes" rows="5"><?php echo esc_textarea( $val( 'brief_notes' ) ); ?></textarea></label>

		<div class="hgd-form-actions">
			<button type="submit" class="hgd-pill"><?php echo $is_edit ? esc_html__( 'Save project', 'hillcroft-garden-designer' ) : esc_html__( 'Create project', 'hillcroft-garden-designer' ); ?></button>
			<a class="hgd-pill hgd-pill-ghost" href="<?php echo esc_url( $list_url ); ?>"><?php esc_html_e( 'Cancel', 'hillcroft-garden-designer' ); ?></a>
		</div>
	</form>

</div>
