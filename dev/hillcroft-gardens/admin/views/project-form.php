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

	<?php if ( $is_edit ) :
		$pid          = (int) $val( 'id', 0 );
		$assets       = isset( $assets ) && is_array( $assets ) ? $assets : array();
		$ai_reading   = (string) $val( 'ai_reading' );
		$ai_questions = array();
		$raw_q        = $val( 'ai_questions' );
		if ( $raw_q ) {
			$decoded_q = json_decode( $raw_q, true );
			if ( is_array( $decoded_q ) ) {
				$ai_questions = $decoded_q;
			}
		}
		$claude_error = isset( $_GET['claude_error'] ) ? sanitize_key( $_GET['claude_error'] ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		?>
		<div class="hgd-panel">
			<h2><?php esc_html_e( 'Consultation capture', 'hillcroft-garden-designer' ); ?></h2>
			<p class="hgd-muted"><?php esc_html_e( 'Upload hand-drawn sketches and site photos, then let Claude read the sketch and draft clarifying questions.', 'hillcroft-garden-designer' ); ?></p>

			<?php if ( isset( $_GET['uploaded'] ) && (int) $_GET['uploaded'] > 0 ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
				<div class="hgd-flash"><?php echo esc_html( sprintf( /* translators: %d count */ _n( '%d file uploaded.', '%d files uploaded.', (int) $_GET['uploaded'], 'hillcroft-garden-designer' ), (int) $_GET['uploaded'] ) ); ?></div>
			<?php endif; ?>
			<?php if ( isset( $_GET['upload_error'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification
				$ue = get_transient( 'hgd_upload_error_' . get_current_user_id() ); delete_transient( 'hgd_upload_error_' . get_current_user_id() ); ?>
				<div class="hgd-flash hgd-flash-error"><?php echo esc_html( $ue ? $ue : __( 'Upload failed.', 'hillcroft-garden-designer' ) ); ?></div>
			<?php endif; ?>
			<?php if ( isset( $_GET['asset_deleted'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
				<div class="hgd-flash"><?php esc_html_e( 'Asset deleted.', 'hillcroft-garden-designer' ); ?></div>
			<?php endif; ?>
			<?php if ( isset( $_GET['claude_read'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
				<div class="hgd-flash"><?php esc_html_e( 'Claude has read the sketch.', 'hillcroft-garden-designer' ); ?></div>
			<?php endif; ?>
			<?php if ( 'nokey' === $claude_error ) : ?>
				<div class="hgd-flash hgd-flash-error"><?php esc_html_e( 'No Claude API key configured — add one under Settings.', 'hillcroft-garden-designer' ); ?></div>
			<?php elseif ( 'noassets' === $claude_error ) : ?>
				<div class="hgd-flash hgd-flash-error"><?php esc_html_e( 'Upload at least one sketch or photo first.', 'hillcroft-garden-designer' ); ?></div>
			<?php elseif ( 'api' === $claude_error || 'parse' === $claude_error ) :
				$ce = get_transient( 'hgd_claude_error_' . get_current_user_id() ); delete_transient( 'hgd_claude_error_' . get_current_user_id() ); ?>
				<div class="hgd-flash hgd-flash-error"><?php echo esc_html( $ce ? $ce : __( 'Claude could not read the sketch.', 'hillcroft-garden-designer' ) ); ?></div>
			<?php endif; ?>

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" enctype="multipart/form-data" class="hgd-form">
				<input type="hidden" name="action" value="hgd_upload_assets" />
				<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>" />
				<?php wp_nonce_field( 'hgd_upload_assets_' . $pid ); ?>
				<div class="hgd-grid">
					<label><span><?php esc_html_e( 'Files', 'hillcroft-garden-designer' ); ?></span>
						<input type="file" name="files[]" multiple accept="image/*" /></label>
					<label><span><?php esc_html_e( 'Role', 'hillcroft-garden-designer' ); ?></span>
						<select name="role">
							<?php foreach ( HGD_Project_Asset::ROLES as $rk => $rl ) : ?>
								<option value="<?php echo esc_attr( $rk ); ?>" <?php selected( 'sketch', $rk ); ?>><?php echo esc_html( $rl ); ?></option>
							<?php endforeach; ?>
						</select></label>
				</div>
				<div class="hgd-form-actions">
					<button type="submit" class="hgd-pill"><?php esc_html_e( 'Upload', 'hillcroft-garden-designer' ); ?></button>
				</div>
			</form>

			<?php if ( ! empty( $assets ) ) : ?>
				<div class="hgd-asset-grid">
					<?php foreach ( $assets as $asset ) :
						$del_url = wp_nonce_url(
							add_query_arg(
								array( 'action' => 'hgd_delete_asset', 'asset_id' => (int) $asset['id'], 'id' => $pid ),
								admin_url( 'admin-post.php' )
							),
							'hgd_delete_asset_' . (int) $asset['id']
						);
						?>
						<div class="hgd-asset">
							<?php echo wp_get_attachment_image( (int) $asset['attachment_id'], 'medium' ); ?>
							<div class="hgd-asset-meta">
								<span class="hgd-pill hgd-pill-ghost"><?php echo esc_html( HGD_Project_Asset::role_label( $asset['role'] ) ); ?></span>
								<a class="hgd-muted" href="<?php echo esc_url( $del_url ); ?>" onclick="return confirm('<?php echo esc_js( __( 'Delete this asset?', 'hillcroft-garden-designer' ) ); ?>');"><?php esc_html_e( 'Delete', 'hillcroft-garden-designer' ); ?></a>
							</div>
						</div>
					<?php endforeach; ?>
				</div>
			<?php else : ?>
				<p class="hgd-muted"><?php esc_html_e( 'No files uploaded yet.', 'hillcroft-garden-designer' ); ?></p>
			<?php endif; ?>

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="hgd_claude_read" />
				<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>" />
				<?php wp_nonce_field( 'hgd_claude_read_' . $pid ); ?>
				<div class="hgd-form-actions">
					<button type="submit" class="hgd-pill"><?php esc_html_e( 'Read sketch with Claude', 'hillcroft-garden-designer' ); ?></button>
					<span class="hgd-muted"><?php esc_html_e( 'Reads the uploaded sketch(es) and hand-written dimensions. May take a few seconds.', 'hillcroft-garden-designer' ); ?></span>
				</div>
			</form>
		</div>

		<?php if ( '' !== $ai_reading || ! empty( $ai_questions ) ) : ?>
			<div class="hgd-panel">
				<h2><?php esc_html_e( "Claude's reading", 'hillcroft-garden-designer' ); ?></h2>
				<?php if ( '' !== $ai_reading ) : ?>
					<div class="hgd-ai-reading"><?php echo wp_kses_post( wpautop( $ai_reading ) ); ?></div>
				<?php endif; ?>
				<?php if ( ! empty( $ai_questions ) ) : ?>
					<h3><?php esc_html_e( 'Questions to confirm', 'hillcroft-garden-designer' ); ?></h3>
					<ul class="hgd-ai-questions">
						<?php foreach ( $ai_questions as $q ) : ?>
							<li><?php echo esc_html( $q ); ?></li>
						<?php endforeach; ?>
					</ul>
				<?php endif; ?>
				<p class="hgd-muted"><?php esc_html_e( 'Edit the brief / notes above to capture the answers to these questions.', 'hillcroft-garden-designer' ); ?></p>
			</div>
		<?php endif; ?>
	<?php endif; ?>

</div>
