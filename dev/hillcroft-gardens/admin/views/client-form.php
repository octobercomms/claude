<?php
/**
 * Add / edit a client. Expects $banner_cb and $client (array, empty for new).
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
$is_edit = ! empty( $client['id'] );
$val     = function ( $key, $default = '' ) use ( $client ) {
	return isset( $client[ $key ] ) ? $client[ $key ] : $default;
};
$list_url = admin_url( 'admin.php?page=hgd-clients' );
?>
<div class="wrap hgd-wrap">

	<?php call_user_func( $banner_cb ); ?>

	<div class="hgd-page-head">
		<h1><?php echo $is_edit ? esc_html__( 'Edit client', 'hillcroft-garden-designer' ) : esc_html__( 'New client', 'hillcroft-garden-designer' ); ?></h1>
		<a class="hgd-pill hgd-pill-ghost" href="<?php echo esc_url( $list_url ); ?>"><?php esc_html_e( '← All clients', 'hillcroft-garden-designer' ); ?></a>
	</div>

	<?php if ( isset( $_GET['error'] ) && 'empty' === $_GET['error'] ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
		<div class="hgd-flash hgd-flash-error"><?php esc_html_e( 'Please add at least a name or an email.', 'hillcroft-garden-designer' ); ?></div>
	<?php endif; ?>

	<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="hgd-panel hgd-form">
		<input type="hidden" name="action" value="hgd_save_client" />
		<input type="hidden" name="id" value="<?php echo esc_attr( (int) $val( 'id', 0 ) ); ?>" />
		<?php wp_nonce_field( 'hgd_save_client' ); ?>

		<div class="hgd-grid">
			<label><span><?php esc_html_e( 'First name', 'hillcroft-garden-designer' ); ?></span>
				<input type="text" name="first_name" value="<?php echo esc_attr( $val( 'first_name' ) ); ?>" /></label>
			<label><span><?php esc_html_e( 'Last name', 'hillcroft-garden-designer' ); ?></span>
				<input type="text" name="last_name" value="<?php echo esc_attr( $val( 'last_name' ) ); ?>" /></label>

			<label><span><?php esc_html_e( 'Email', 'hillcroft-garden-designer' ); ?></span>
				<input type="email" name="email" value="<?php echo esc_attr( $val( 'email' ) ); ?>" /></label>
			<label><span><?php esc_html_e( 'Phone', 'hillcroft-garden-designer' ); ?></span>
				<input type="tel" name="phone" value="<?php echo esc_attr( $val( 'phone' ) ); ?>" /></label>

			<label><span><?php esc_html_e( 'Address line 1', 'hillcroft-garden-designer' ); ?></span>
				<input type="text" name="address_line1" value="<?php echo esc_attr( $val( 'address_line1' ) ); ?>" /></label>
			<label><span><?php esc_html_e( 'Address line 2', 'hillcroft-garden-designer' ); ?></span>
				<input type="text" name="address_line2" value="<?php echo esc_attr( $val( 'address_line2' ) ); ?>" /></label>

			<label><span><?php esc_html_e( 'Town / city', 'hillcroft-garden-designer' ); ?></span>
				<input type="text" name="city" value="<?php echo esc_attr( $val( 'city' ) ); ?>" /></label>
			<label><span><?php esc_html_e( 'Postcode', 'hillcroft-garden-designer' ); ?></span>
				<input type="text" name="postcode" value="<?php echo esc_attr( $val( 'postcode' ) ); ?>" /></label>
		</div>

		<label class="hgd-full"><span><?php esc_html_e( 'Notes', 'hillcroft-garden-designer' ); ?></span>
			<textarea name="notes" rows="4"><?php echo esc_textarea( $val( 'notes' ) ); ?></textarea></label>

		<div class="hgd-form-actions">
			<button type="submit" class="hgd-pill"><?php echo $is_edit ? esc_html__( 'Save client', 'hillcroft-garden-designer' ) : esc_html__( 'Create client', 'hillcroft-garden-designer' ); ?></button>
			<a class="hgd-pill hgd-pill-ghost" href="<?php echo esc_url( $list_url ); ?>"><?php esc_html_e( 'Cancel', 'hillcroft-garden-designer' ); ?></a>
		</div>
	</form>

</div>
