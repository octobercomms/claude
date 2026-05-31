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

		<?php
		$design_brief  = (string) $val( 'design_brief' );
		$render_prompt = (string) $val( 'render_prompt' );
		$design_error  = isset( $_GET['design_error'] ) ? sanitize_key( $_GET['design_error'] ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		$render_error  = isset( $_GET['render_error'] ) ? sanitize_key( $_GET['render_error'] ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		$renders       = HGD_Project_Asset::for_project( $pid, 'render' );
		$settings_url  = admin_url( 'admin.php?page=hgd-settings' );
		?>

		<div class="hgd-panel">
			<h2><?php esc_html_e( 'Design &amp; ideas', 'hillcroft-garden-designer' ); ?></h2>
			<p class="hgd-muted"><?php esc_html_e( 'Capture the design brief and the prompt used to generate concept renders. Use “Compose with Claude” to draft both from the consultation reading and your ideas, then hand-edit either as needed.', 'hillcroft-garden-designer' ); ?></p>

			<?php if ( isset( $_GET['design_saved'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
				<div class="hgd-flash"><?php esc_html_e( 'Design brief and render prompt saved.', 'hillcroft-garden-designer' ); ?></div>
			<?php endif; ?>
			<?php if ( isset( $_GET['design_composed'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
				<div class="hgd-flash"><?php esc_html_e( 'Claude composed a design brief and render prompt.', 'hillcroft-garden-designer' ); ?></div>
			<?php endif; ?>
			<?php if ( 'nokey' === $design_error ) : ?>
				<div class="hgd-flash hgd-flash-error"><?php esc_html_e( 'No Claude API key configured — add one under Settings.', 'hillcroft-garden-designer' ); ?></div>
			<?php elseif ( 'api' === $design_error || 'parse' === $design_error ) :
				$de = get_transient( 'hgd_design_error_' . get_current_user_id() ); delete_transient( 'hgd_design_error_' . get_current_user_id() ); ?>
				<div class="hgd-flash hgd-flash-error"><?php echo esc_html( $de ? $de : __( 'Claude could not compose the brief.', 'hillcroft-garden-designer' ) ); ?></div>
			<?php endif; ?>

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="hgd-form">
				<input type="hidden" name="action" value="hgd_save_design" />
				<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>" />
				<?php wp_nonce_field( 'hgd_save_design_' . $pid ); ?>

				<label class="hgd-full"><span><?php esc_html_e( 'Design brief', 'hillcroft-garden-designer' ); ?></span>
					<textarea name="design_brief" rows="6"><?php echo esc_textarea( $design_brief ); ?></textarea></label>

				<label class="hgd-full"><span><?php esc_html_e( 'Render prompt', 'hillcroft-garden-designer' ); ?></span>
					<textarea name="render_prompt" rows="6"><?php echo esc_textarea( $render_prompt ); ?></textarea></label>
				<p class="hgd-muted"><?php esc_html_e( 'The render prompt is sent to Gemini to generate concept renders below. Tweak it and generate again to iterate.', 'hillcroft-garden-designer' ); ?></p>

				<div class="hgd-form-actions">
					<button type="submit" class="hgd-pill"><?php esc_html_e( 'Save', 'hillcroft-garden-designer' ); ?></button>
				</div>
			</form>

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="hgd_compose_prompt" />
				<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>" />
				<?php wp_nonce_field( 'hgd_compose_prompt_' . $pid ); ?>
				<div class="hgd-form-actions">
					<button type="submit" class="hgd-pill hgd-pill-ghost"><?php esc_html_e( 'Compose with Claude', 'hillcroft-garden-designer' ); ?></button>
					<span class="hgd-muted"><?php esc_html_e( 'Fills both fields from the consultation reading + your ideas. May take a few seconds.', 'hillcroft-garden-designer' ); ?></span>
				</div>
			</form>
		</div>

		<div class="hgd-panel">
			<h2><?php esc_html_e( 'Concept renders', 'hillcroft-garden-designer' ); ?></h2>
			<p class="hgd-muted"><?php esc_html_e( 'Generate a photorealistic concept render from the render prompt, using any uploaded sketch as a layout reference. May take ~10–20s. Press again after tweaking the prompt to iterate — each render is appended below.', 'hillcroft-garden-designer' ); ?></p>

			<?php if ( isset( $_GET['render_done'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
				<div class="hgd-flash"><?php esc_html_e( 'Concept render generated.', 'hillcroft-garden-designer' ); ?></div>
			<?php endif; ?>
			<?php if ( 'nokey' === $render_error ) : ?>
				<div class="hgd-flash hgd-flash-error"><?php
					printf(
						/* translators: %s settings link */
						esc_html__( 'No Gemini API key configured — add one under %s.', 'hillcroft-garden-designer' ),
						'<a href="' . esc_url( $settings_url ) . '">' . esc_html__( 'Settings', 'hillcroft-garden-designer' ) . '</a>'
					);
				?></div>
			<?php elseif ( 'api' === $render_error || 'save' === $render_error ) :
				$re = get_transient( 'hgd_render_error_' . get_current_user_id() ); delete_transient( 'hgd_render_error_' . get_current_user_id() ); ?>
				<div class="hgd-flash hgd-flash-error"><?php echo esc_html( $re ? $re : __( 'Could not generate a render.', 'hillcroft-garden-designer' ) ); ?></div>
			<?php endif; ?>

			<?php if ( HGD_Gemini::is_configured() ) : ?>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="hgd_generate_render" />
					<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>" />
					<?php wp_nonce_field( 'hgd_generate_render_' . $pid ); ?>
					<div class="hgd-form-actions">
						<button type="submit" class="hgd-pill"><?php esc_html_e( 'Generate render', 'hillcroft-garden-designer' ); ?></button>
						<span class="hgd-muted"><?php esc_html_e( 'Uses the render prompt + sketch as reference.', 'hillcroft-garden-designer' ); ?></span>
					</div>
				</form>
			<?php else : ?>
				<p class="hgd-muted"><?php
					printf(
						/* translators: %s settings link */
						esc_html__( 'Add a Gemini API key under %s to enable concept renders.', 'hillcroft-garden-designer' ),
						'<a href="' . esc_url( $settings_url ) . '">' . esc_html__( 'Settings', 'hillcroft-garden-designer' ) . '</a>'
					);
				?></p>
			<?php endif; ?>

			<?php if ( ! empty( $renders ) ) : ?>
				<div class="hgd-asset-grid">
					<?php foreach ( $renders as $render ) :
						$del_url = wp_nonce_url(
							add_query_arg(
								array( 'action' => 'hgd_delete_asset', 'asset_id' => (int) $render['id'], 'id' => $pid ),
								admin_url( 'admin-post.php' )
							),
							'hgd_delete_asset_' . (int) $render['id']
						);
						?>
						<div class="hgd-asset">
							<?php echo wp_get_attachment_image( (int) $render['attachment_id'], 'large' ); ?>
							<div class="hgd-asset-meta">
								<span class="hgd-pill hgd-pill-ghost"><?php echo esc_html( HGD_Project_Asset::role_label( $render['role'] ) ); ?></span>
								<a class="hgd-muted" href="<?php echo esc_url( $del_url ); ?>" onclick="return confirm('<?php echo esc_js( __( 'Delete this render?', 'hillcroft-garden-designer' ) ); ?>');"><?php esc_html_e( 'Delete', 'hillcroft-garden-designer' ); ?></a>
							</div>
						</div>
					<?php endforeach; ?>
				</div>
				<p class="hgd-muted"><?php esc_html_e( 'To iterate: edit the render prompt above, Save, then Generate render again.', 'hillcroft-garden-designer' ); ?></p>
			<?php else : ?>
				<p class="hgd-muted"><?php esc_html_e( 'No renders yet.', 'hillcroft-garden-designer' ); ?></p>
			<?php endif; ?>
		</div>

		<?php
		// --- Render pack ------------------------------------------------------
		$pack_assets = HGD_Render_Pack::pack_for_project( $pid );
		$pack_error  = isset( $_GET['pack_error'] ) ? sanitize_key( $_GET['pack_error'] ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		$maps_ready  = HGD_Maps::is_configured();
		?>
		<div class="hgd-panel">
			<h2><?php esc_html_e( 'Render pack', 'hillcroft-garden-designer' ); ?></h2>
			<p class="hgd-muted"><?php esc_html_e( 'A deliberate set of named garden views for the proposal and client portal — aerial masterplan, watercolour cover, hand-drawn plan and eye-level corners. Each view uses your latest concept render above as the consistency anchor, so every image shows the same garden from a different viewpoint or season.', 'hillcroft-garden-designer' ); ?></p>
			<p class="hgd-muted"><?php esc_html_e( 'Each image is a separate Gemini generation (cost applies). Generating the full pack makes about six images and may take a minute or two — leave the tab open until it finishes.', 'hillcroft-garden-designer' ); ?></p>

			<?php if ( isset( $_GET['pack_done'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
				<div class="hgd-flash"><?php esc_html_e( 'Pack view generated.', 'hillcroft-garden-designer' ); ?></div>
			<?php endif; ?>
			<?php if ( isset( $_GET['pack_satellite'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
				<div class="hgd-flash"><?php esc_html_e( 'Satellite view fetched.', 'hillcroft-garden-designer' ); ?></div>
			<?php endif; ?>
			<?php if ( isset( $_GET['pack_all'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
				<div class="hgd-flash"><?php
					echo esc_html( sprintf(
						/* translators: 1: generated count, 2: skipped count, 3: failed count */
						__( 'Render pack: %1$d generated, %2$d already existed, %3$d failed.', 'hillcroft-garden-designer' ),
						isset( $_GET['pack_gen'] ) ? (int) $_GET['pack_gen'] : 0, // phpcs:ignore WordPress.Security.NonceVerification
						isset( $_GET['pack_skip'] ) ? (int) $_GET['pack_skip'] : 0, // phpcs:ignore WordPress.Security.NonceVerification
						isset( $_GET['pack_fail'] ) ? (int) $_GET['pack_fail'] : 0 // phpcs:ignore WordPress.Security.NonceVerification
					) );
				?></div>
			<?php endif; ?>
			<?php if ( 'nokey' === $pack_error ) : ?>
				<div class="hgd-flash hgd-flash-error"><?php
					printf(
						/* translators: %s settings link */
						esc_html__( 'No Gemini API key configured — add one under %s.', 'hillcroft-garden-designer' ),
						'<a href="' . esc_url( $settings_url ) . '">' . esc_html__( 'Settings', 'hillcroft-garden-designer' ) . '</a>'
					);
				?></div>
			<?php elseif ( 'nomaps' === $pack_error ) : ?>
				<div class="hgd-flash hgd-flash-error"><?php
					printf(
						/* translators: %s settings link */
						esc_html__( 'No Google Maps API key configured — add one under %s.', 'hillcroft-garden-designer' ),
						'<a href="' . esc_url( $settings_url ) . '">' . esc_html__( 'Settings', 'hillcroft-garden-designer' ) . '</a>'
					);
				?></div>
			<?php elseif ( 'badview' === $pack_error ) : ?>
				<div class="hgd-flash hgd-flash-error"><?php esc_html_e( 'Unknown render-pack view.', 'hillcroft-garden-designer' ); ?></div>
			<?php elseif ( 'api' === $pack_error || 'maps' === $pack_error ) :
				$pe = get_transient( 'hgd_pack_error_' . get_current_user_id() ); delete_transient( 'hgd_pack_error_' . get_current_user_id() ); ?>
				<div class="hgd-flash hgd-flash-error"><?php echo esc_html( $pe ? $pe : __( 'Could not generate the render pack.', 'hillcroft-garden-designer' ) ); ?></div>
			<?php endif; ?>

			<?php if ( ! HGD_Gemini::is_configured() ) : ?>
				<p class="hgd-muted"><?php
					printf(
						/* translators: %s settings link */
						esc_html__( 'Add a Gemini API key under %s to generate the render pack.', 'hillcroft-garden-designer' ),
						'<a href="' . esc_url( $settings_url ) . '">' . esc_html__( 'Settings', 'hillcroft-garden-designer' ) . '</a>'
					);
				?></p>
			<?php else :
				if ( empty( $renders ) ) : ?>
					<p class="hgd-muted"><?php esc_html_e( 'Tip: generate a concept render above first — the pack anchors to it for consistency. Without one, it will fall back to the sketch.', 'hillcroft-garden-designer' ); ?></p>
				<?php endif; ?>

				<div class="hgd-form-actions">
					<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline;">
						<input type="hidden" name="action" value="hgd_pack_generate_all" />
						<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>" />
						<?php wp_nonce_field( 'hgd_pack_generate_all_' . $pid ); ?>
						<button type="submit" class="hgd-pill" onclick="return confirm('<?php echo esc_js( __( 'Generate the full render pack (about six Gemini images)? This may take a minute or two.', 'hillcroft-garden-designer' ) ); ?>');"><?php esc_html_e( 'Generate full pack', 'hillcroft-garden-designer' ); ?></button>
					</form>

					<?php if ( $maps_ready ) : ?>
						<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline;">
							<input type="hidden" name="action" value="hgd_pack_fetch_satellite" />
							<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>" />
							<?php wp_nonce_field( 'hgd_pack_fetch_satellite_' . $pid ); ?>
							<button type="submit" class="hgd-pill hgd-pill-ghost"><?php esc_html_e( 'Fetch satellite view', 'hillcroft-garden-designer' ); ?></button>
						</form>
					<?php endif; ?>
				</div>
				<p class="hgd-muted"><?php esc_html_e( 'The full-pack button tops up: it skips any view that already exists, so you can re-run it safely. The satellite view is the real aerial photo of the plot (from Google), distinct from the Gemini “Masterplan (aerial)” render of your design.', 'hillcroft-garden-designer' ); ?></p>

				<div class="hgd-subform">
					<p class="hgd-muted"><?php esc_html_e( 'Generate a single view', 'hillcroft-garden-designer' ); ?></p>
					<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="hgd-inline-form">
						<input type="hidden" name="action" value="hgd_pack_generate_view" />
						<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>" />
						<?php wp_nonce_field( 'hgd_pack_generate_view_' . $pid ); ?>
						<div class="hgd-grid">
							<label><span><?php esc_html_e( 'View', 'hillcroft-garden-designer' ); ?></span>
								<select name="view_key">
									<?php foreach ( HGD_Render_Pack::VIEWS as $vk => $vdef ) : ?>
										<option value="<?php echo esc_attr( $vk ); ?>"><?php echo esc_html( $vdef['label'] ); ?></option>
									<?php endforeach; ?>
								</select></label>
							<label><span><?php esc_html_e( 'Season', 'hillcroft-garden-designer' ); ?></span>
								<select name="season">
									<?php foreach ( array_keys( HGD_Render_Pack::SEASONS ) as $sk ) : ?>
										<option value="<?php echo esc_attr( $sk ); ?>" <?php selected( HGD_Render_Pack::DEFAULT_SEASON, $sk ); ?>><?php echo esc_html( HGD_Render_Pack::season_label( $sk ) ); ?></option>
									<?php endforeach; ?>
								</select></label>
						</div>
						<div class="hgd-form-actions">
							<button type="submit" class="hgd-pill hgd-pill-ghost"><?php esc_html_e( 'Generate view', 'hillcroft-garden-designer' ); ?></button>
						</div>
					</form>
				</div>

				<div class="hgd-subform">
					<p class="hgd-muted"><?php esc_html_e( 'Generate one view across all four seasons', 'hillcroft-garden-designer' ); ?></p>
					<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="hgd-inline-form">
						<input type="hidden" name="action" value="hgd_pack_seasonal" />
						<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>" />
						<?php wp_nonce_field( 'hgd_pack_seasonal_' . $pid ); ?>
						<div class="hgd-grid">
							<label><span><?php esc_html_e( 'View', 'hillcroft-garden-designer' ); ?></span>
								<select name="view_key">
									<?php foreach ( HGD_Render_Pack::VIEWS as $vk => $vdef ) : ?>
										<option value="<?php echo esc_attr( $vk ); ?>"><?php echo esc_html( $vdef['label'] ); ?></option>
									<?php endforeach; ?>
								</select></label>
						</div>
						<div class="hgd-form-actions">
							<button type="submit" class="hgd-pill hgd-pill-ghost" onclick="return confirm('<?php echo esc_js( __( 'Generate this view for spring, summer, autumn and winter (up to four Gemini images)?', 'hillcroft-garden-designer' ) ); ?>');"><?php esc_html_e( 'Generate all seasons', 'hillcroft-garden-designer' ); ?></button>
						</div>
					</form>
				</div>
			<?php endif; ?>

			<?php if ( ! empty( $pack_assets ) ) : ?>
				<div class="hgd-asset-grid">
					<?php foreach ( $pack_assets as $pack ) :
						$del_url = wp_nonce_url(
							add_query_arg(
								array( 'action' => 'hgd_delete_asset', 'asset_id' => (int) $pack['id'], 'id' => $pid ),
								admin_url( 'admin-post.php' )
							),
							'hgd_delete_asset_' . (int) $pack['id']
						);
						?>
						<div class="hgd-asset">
							<?php echo wp_get_attachment_image( (int) $pack['attachment_id'], 'medium' ); ?>
							<div class="hgd-asset-meta">
								<span class="hgd-pill hgd-pill-ghost"><?php echo esc_html( $pack['pack_label'] ); ?></span>
								<a class="hgd-muted" href="<?php echo esc_url( $del_url ); ?>" onclick="return confirm('<?php echo esc_js( __( 'Delete this pack image?', 'hillcroft-garden-designer' ) ); ?>');"><?php esc_html_e( 'Delete', 'hillcroft-garden-designer' ); ?></a>
							</div>
						</div>
					<?php endforeach; ?>
				</div>
			<?php else : ?>
				<p class="hgd-muted"><?php esc_html_e( 'No pack images yet.', 'hillcroft-garden-designer' ); ?></p>
			<?php endif; ?>
		</div>

		<?php
		// --- Keepsakes (plant book, proposal keepsake, seasonal film) ---------
		$book_proposal  = HGD_Proposal::for_project( $pid );
		$keepsake_token = ( $book_proposal && ! empty( $book_proposal['token'] ) ) ? $book_proposal['token'] : '';
		$has_live_token = ( '' !== $keepsake_token && 'draft' !== $book_proposal['status'] && ! HGD_Proposal::is_expired( $book_proposal ) );
		$book_preview   = home_url( '/?hgd_book_preview=' . $pid );
		$film_preview   = home_url( '/?hgd_film_preview=' . $pid );
		$plant_book_n   = HGD_Documents::plant_count_for_project( $pid );
		$book_token_url = $has_live_token ? home_url( '/?hgd_book=' . rawurlencode( $keepsake_token ) ) : '';
		$keepsake_url   = $has_live_token ? home_url( '/?hgd_keepsake=' . rawurlencode( $keepsake_token ) ) : '';
		$film_token_url = $has_live_token ? home_url( '/?hgd_film=' . rawurlencode( $keepsake_token ) ) : '';
		?>
		<div class="hgd-panel">
			<h2><?php esc_html_e( 'Keepsakes', 'hillcroft-garden-designer' ); ?></h2>
			<p class="hgd-muted"><?php esc_html_e( 'Client-facing deliverables: a print-ready planting book (the client saves it as a PDF), a printable proposal keepsake, and a cinematic seasonal film of the render pack. The book uses the watercolour render-pack image as its cover.', 'hillcroft-garden-designer' ); ?></p>
			<p class="hgd-muted"><?php
				echo esc_html( sprintf(
					/* translators: %d distinct plant count */
					_n( '%d plant from this project’s quotes will appear in the book.', '%d plants from this project’s quotes will appear in the book.', $plant_book_n, 'hillcroft-garden-designer' ),
					$plant_book_n
				) );
			?></p>

			<?php if ( $has_live_token ) : ?>
				<p class="hgd-muted"><?php esc_html_e( 'Client links (share via the same private token as the portal):', 'hillcroft-garden-designer' ); ?></p>
				<div class="hgd-form-actions">
					<a class="hgd-pill" href="<?php echo esc_url( $book_token_url ); ?>" target="_blank" rel="noopener"><?php esc_html_e( 'Open plant book ↗', 'hillcroft-garden-designer' ); ?></a>
					<a class="hgd-pill" href="<?php echo esc_url( $keepsake_url ); ?>" target="_blank" rel="noopener"><?php esc_html_e( 'Open keepsake proposal ↗', 'hillcroft-garden-designer' ); ?></a>
					<a class="hgd-pill" href="<?php echo esc_url( $film_token_url ); ?>" target="_blank" rel="noopener"><?php esc_html_e( 'Open seasonal film ↗', 'hillcroft-garden-designer' ); ?></a>
				</div>
			<?php else : ?>
				<p class="hgd-muted"><?php esc_html_e( 'No sent proposal yet — send a proposal below to generate shareable client links. You can still preview the book and film now:', 'hillcroft-garden-designer' ); ?></p>
			<?php endif; ?>

			<p class="hgd-muted" style="margin-top:14px;"><?php esc_html_e( 'Studio previews (admin only):', 'hillcroft-garden-designer' ); ?></p>
			<div class="hgd-form-actions">
				<a class="hgd-pill hgd-pill-ghost" href="<?php echo esc_url( $book_preview ); ?>" target="_blank" rel="noopener"><?php esc_html_e( 'Preview plant book ↗', 'hillcroft-garden-designer' ); ?></a>
				<a class="hgd-pill hgd-pill-ghost" href="<?php echo esc_url( $film_preview ); ?>" target="_blank" rel="noopener"><?php esc_html_e( 'Preview seasonal film ↗', 'hillcroft-garden-designer' ); ?></a>
			</div>
		</div>

		<?php
		// --- Pricing engine ---------------------------------------------------
		$quotes      = isset( $quotes ) && is_array( $quotes ) ? $quotes : array();
		$has_quotes  = ! empty( $quotes );
		$post_url    = admin_url( 'admin-post.php' );
		$money       = function ( $n ) { return '£' . number_format( (float) $n, 2 ); };
		$quote_error = isset( $_GET['quote_error'] ); // phpcs:ignore WordPress.Security.NonceVerification
		?>

		<div class="hgd-panel">
			<h2><?php esc_html_e( 'Pricing', 'hillcroft-garden-designer' ); ?></h2>
			<p class="hgd-muted"><?php esc_html_e( 'Build a Good / Better / Best quote for this project. Add plants from the catalogue and custom lines, set labour and overheads, then review the costed totals. The margin is for your eyes only.', 'hillcroft-garden-designer' ); ?></p>

			<?php if ( isset( $_GET['quote_init'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
				<div class="hgd-flash"><?php esc_html_e( 'Good / Better / Best quotes created.', 'hillcroft-garden-designer' ); ?></div>
			<?php endif; ?>
			<?php if ( isset( $_GET['quote_saved'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
				<div class="hgd-flash"><?php esc_html_e( 'Quote settings saved.', 'hillcroft-garden-designer' ); ?></div>
			<?php endif; ?>
			<?php if ( isset( $_GET['item_added'] ) || isset( $_GET['plant_added'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
				<div class="hgd-flash"><?php esc_html_e( 'Line item added.', 'hillcroft-garden-designer' ); ?></div>
			<?php endif; ?>
			<?php if ( isset( $_GET['item_saved'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
				<div class="hgd-flash"><?php esc_html_e( 'Line item updated.', 'hillcroft-garden-designer' ); ?></div>
			<?php endif; ?>
			<?php if ( isset( $_GET['item_deleted'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
				<div class="hgd-flash"><?php esc_html_e( 'Line item removed.', 'hillcroft-garden-designer' ); ?></div>
			<?php endif; ?>
			<?php if ( isset( $_GET['tiers_seeded'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
				<div class="hgd-flash"><?php esc_html_e( 'Better &amp; Best seeded from Good.', 'hillcroft-garden-designer' ); ?></div>
			<?php endif; ?>
			<?php if ( $quote_error ) : ?>
				<div class="hgd-flash hgd-flash-error"><?php esc_html_e( 'Could not complete that pricing action.', 'hillcroft-garden-designer' ); ?></div>
			<?php endif; ?>

			<?php if ( ! $has_quotes ) : ?>
				<form method="post" action="<?php echo esc_url( $post_url ); ?>">
					<input type="hidden" name="action" value="hgd_quote_init" />
					<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>" />
					<?php wp_nonce_field( 'hgd_quote_init_' . $pid ); ?>
					<div class="hgd-form-actions">
						<button type="submit" class="hgd-pill"><?php esc_html_e( 'Create Good / Better / Best quotes', 'hillcroft-garden-designer' ); ?></button>
					</div>
				</form>
			<?php else :
				$plant_query   = HGD_Plant::query( array( 'per_page' => 500 ) );
				$plant_options = isset( $plant_query['items'] ) ? $plant_query['items'] : array();
				?>

				<div class="hgd-tier-summary hgd-cards">
					<?php foreach ( $quotes as $q ) :
						$t = HGD_Quote::compute( (int) $q['id'] );
						?>
						<div class="hgd-card">
							<span class="hgd-card-label"><?php echo esc_html( HGD_Quote::tier_label( $q['tier'] ) ); ?></span>
							<span class="hgd-card-figure"><?php echo esc_html( '£' . number_format( $t['total_rounded'], 0 ) ); ?></span>
							<table class="hgd-table hgd-totals-table">
								<tbody>
									<tr><td><?php esc_html_e( 'Materials', 'hillcroft-garden-designer' ); ?></td><td class="num"><?php echo esc_html( $money( $t['materials_subtotal'] ) ); ?></td></tr>
									<tr><td><?php esc_html_e( 'Wastage', 'hillcroft-garden-designer' ); ?></td><td class="num"><?php echo esc_html( $money( $t['wastage'] ) ); ?></td></tr>
									<tr><td><?php esc_html_e( 'Labour', 'hillcroft-garden-designer' ); ?></td><td class="num"><?php echo esc_html( $money( $t['labour'] ) ); ?></td></tr>
									<tr><td><?php esc_html_e( 'Contingency', 'hillcroft-garden-designer' ); ?></td><td class="num"><?php echo esc_html( $money( $t['contingency'] ) ); ?></td></tr>
									<tr><td><?php esc_html_e( 'Design fee', 'hillcroft-garden-designer' ); ?></td><td class="num"><?php echo esc_html( $money( $t['design_fee'] ) ); ?></td></tr>
									<tr><td><?php esc_html_e( 'Subtotal', 'hillcroft-garden-designer' ); ?></td><td class="num"><?php echo esc_html( $money( $t['subtotal'] ) ); ?></td></tr>
									<tr><td><?php esc_html_e( 'VAT', 'hillcroft-garden-designer' ); ?></td><td class="num"><?php echo esc_html( $money( $t['vat'] ) ); ?></td></tr>
									<tr class="hgd-total-row"><td><strong><?php esc_html_e( 'Total', 'hillcroft-garden-designer' ); ?></strong></td><td class="num"><strong><?php echo esc_html( $money( $t['total'] ) ); ?></strong></td></tr>
								</tbody>
							</table>
							<span class="hgd-muted hgd-margin-aside"><?php
								echo esc_html( sprintf(
									/* translators: %s margin amount */
									__( 'Internal — not shown to client: margin %s', 'hillcroft-garden-designer' ),
									$money( $t['margin'] )
								) );
							?></span>
						</div>
					<?php endforeach; ?>
				</div>

				<form method="post" action="<?php echo esc_url( $post_url ); ?>" class="hgd-seed-form">
					<input type="hidden" name="action" value="hgd_quote_seed_tiers" />
					<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>" />
					<?php wp_nonce_field( 'hgd_quote_seed_tiers_' . $pid ); ?>
					<div class="hgd-form-actions">
						<button type="submit" class="hgd-pill hgd-pill-ghost" onclick="return confirm('<?php echo esc_js( __( 'This rebuilds the Better and Best tiers from Good (replacing their line items). Continue?', 'hillcroft-garden-designer' ) ); ?>');"><?php esc_html_e( 'Seed Better &amp; Best from Good', 'hillcroft-garden-designer' ); ?></button>
						<span class="hgd-muted"><?php esc_html_e( 'Copies Good’s lines into the other tiers, scaled by the uplift % in Settings.', 'hillcroft-garden-designer' ); ?></span>
					</div>
				</form>

				<?php
				// Editable detail for the Good tier (the primary working quote).
				$good = null;
				foreach ( $quotes as $q ) {
					if ( 'good' === $q['tier'] ) {
						$good = $q;
						break;
					}
				}
				if ( $good ) :
					$gid        = (int) $good['id'];
					$good_items = HGD_Quote::items( $gid );
					?>
					<h3><?php esc_html_e( 'Good tier — line items', 'hillcroft-garden-designer' ); ?></h3>
					<table class="hgd-table hgd-quote-items">
						<thead>
							<tr>
								<th><?php esc_html_e( 'Item', 'hillcroft-garden-designer' ); ?></th>
								<th class="num"><?php esc_html_e( 'Qty', 'hillcroft-garden-designer' ); ?></th>
								<th><?php esc_html_e( 'Unit', 'hillcroft-garden-designer' ); ?></th>
								<th class="num"><?php esc_html_e( 'Unit cost', 'hillcroft-garden-designer' ); ?></th>
								<th class="num"><?php esc_html_e( 'Markup %', 'hillcroft-garden-designer' ); ?></th>
								<th class="num"><?php esc_html_e( 'Line sale', 'hillcroft-garden-designer' ); ?></th>
								<th class="actions"></th>
							</tr>
						</thead>
						<tbody>
							<?php if ( empty( $good_items ) ) : ?>
								<tr><td colspan="7" class="hgd-empty"><?php esc_html_e( 'No line items yet — add plants or custom lines below.', 'hillcroft-garden-designer' ); ?></td></tr>
							<?php else : foreach ( $good_items as $item ) :
								$line_sale = round( (float) $item['qty'] * (float) $item['unit_cost_gbp'] * ( 1 + (float) $item['markup_pct'] / 100 ), 2 );
								?>
								<tr>
									<form method="post" action="<?php echo esc_url( $post_url ); ?>">
										<input type="hidden" name="action" value="hgd_quote_update_item" />
										<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>" />
										<input type="hidden" name="quote_id" value="<?php echo esc_attr( $gid ); ?>" />
										<input type="hidden" name="item_id" value="<?php echo esc_attr( (int) $item['id'] ); ?>" />
										<?php wp_nonce_field( 'hgd_quote_update_item_' . (int) $item['id'] ); ?>
									<td>
										<select name="item_type">
											<?php foreach ( HGD_Quote::ITEM_TYPES as $tk => $tl ) : ?>
												<option value="<?php echo esc_attr( $tk ); ?>" <?php selected( $item['item_type'], $tk ); ?>><?php echo esc_html( $tl ); ?></option>
											<?php endforeach; ?>
										</select>
										<input type="text" name="label" value="<?php echo esc_attr( $item['label'] ); ?>" />
									</td>
									<td class="num"><input type="number" step="0.01" min="0" name="qty" value="<?php echo esc_attr( $item['qty'] ); ?>" style="max-width:90px;" /></td>
									<td><input type="text" name="unit" value="<?php echo esc_attr( $item['unit'] ); ?>" style="max-width:80px;" /></td>
									<td class="num"><input type="number" step="0.01" min="0" name="unit_cost_gbp" value="<?php echo esc_attr( $item['unit_cost_gbp'] ); ?>" style="max-width:110px;" /></td>
									<td class="num"><input type="number" step="0.01" name="markup_pct" value="<?php echo esc_attr( $item['markup_pct'] ); ?>" style="max-width:90px;" /></td>
									<td class="num"><?php echo esc_html( $money( $line_sale ) ); ?></td>
									<td class="actions">
										<button type="submit" class="hgd-pill hgd-pill-ghost"><?php esc_html_e( 'Save', 'hillcroft-garden-designer' ); ?></button>
									</form>
									<form method="post" action="<?php echo esc_url( $post_url ); ?>" style="display:inline;">
										<input type="hidden" name="action" value="hgd_quote_delete_item" />
										<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>" />
										<input type="hidden" name="quote_id" value="<?php echo esc_attr( $gid ); ?>" />
										<input type="hidden" name="item_id" value="<?php echo esc_attr( (int) $item['id'] ); ?>" />
										<?php wp_nonce_field( 'hgd_quote_delete_item_' . (int) $item['id'] ); ?>
										<button type="submit" class="hgd-link-danger" onclick="return confirm('<?php echo esc_js( __( 'Remove this line?', 'hillcroft-garden-designer' ) ); ?>');"><?php esc_html_e( 'Delete', 'hillcroft-garden-designer' ); ?></button>
									</form>
									</td>
								</tr>
							<?php endforeach; endif; ?>
						</tbody>
					</table>

					<div class="hgd-quote-add">
						<div class="hgd-subform">
							<p class="hgd-muted"><?php esc_html_e( 'Add a plant from the catalogue', 'hillcroft-garden-designer' ); ?></p>
							<?php if ( empty( $plant_options ) ) : ?>
								<p class="hgd-muted"><?php
									printf(
										/* translators: %s catalogue link */
										esc_html__( 'No plants in the catalogue yet — add some under %s.', 'hillcroft-garden-designer' ),
										'<a href="' . esc_url( admin_url( 'admin.php?page=hgd-plants' ) ) . '">' . esc_html__( 'Plant Catalogue', 'hillcroft-garden-designer' ) . '</a>'
									);
								?></p>
							<?php else : ?>
								<form method="post" action="<?php echo esc_url( $post_url ); ?>" class="hgd-inline-form">
									<input type="hidden" name="action" value="hgd_quote_add_plant" />
									<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>" />
									<input type="hidden" name="quote_id" value="<?php echo esc_attr( $gid ); ?>" />
									<?php wp_nonce_field( 'hgd_quote_add_plant_' . $gid ); ?>
									<div class="hgd-grid">
										<label><span><?php esc_html_e( 'Plant', 'hillcroft-garden-designer' ); ?></span>
											<select name="plant_id">
												<?php foreach ( $plant_options as $po ) :
													$pname = '' !== (string) $po['botanical_name'] ? $po['botanical_name'] : $po['common_name'];
													if ( '' !== (string) $po['common_name'] && '' !== (string) $po['botanical_name'] ) {
														$pname = $po['botanical_name'] . ' (' . $po['common_name'] . ')';
													}
													?>
													<option value="<?php echo esc_attr( $po['id'] ); ?>"><?php echo esc_html( $pname . ' — £' . number_format( (float) $po['unit_cost'], 2 ) ); ?></option>
												<?php endforeach; ?>
											</select></label>
										<label><span><?php esc_html_e( 'Quantity', 'hillcroft-garden-designer' ); ?></span>
											<input type="number" step="0.01" min="0" name="qty" value="1" /></label>
									</div>
									<div class="hgd-form-actions">
										<button type="submit" class="hgd-pill"><?php esc_html_e( 'Add plant', 'hillcroft-garden-designer' ); ?></button>
									</div>
								</form>
							<?php endif; ?>
						</div>

						<div class="hgd-subform">
							<p class="hgd-muted"><?php esc_html_e( 'Add a custom line (material, labour or other)', 'hillcroft-garden-designer' ); ?></p>
							<form method="post" action="<?php echo esc_url( $post_url ); ?>" class="hgd-inline-form">
								<input type="hidden" name="action" value="hgd_quote_add_item" />
								<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>" />
								<input type="hidden" name="quote_id" value="<?php echo esc_attr( $gid ); ?>" />
								<?php wp_nonce_field( 'hgd_quote_add_item_' . $gid ); ?>
								<div class="hgd-grid">
									<label><span><?php esc_html_e( 'Type', 'hillcroft-garden-designer' ); ?></span>
										<select name="item_type">
											<?php foreach ( HGD_Quote::ITEM_TYPES as $tk => $tl ) : ?>
												<option value="<?php echo esc_attr( $tk ); ?>" <?php selected( 'material', $tk ); ?>><?php echo esc_html( $tl ); ?></option>
											<?php endforeach; ?>
										</select></label>
									<label><span><?php esc_html_e( 'Label', 'hillcroft-garden-designer' ); ?></span>
										<input type="text" name="label" value="" placeholder="<?php esc_attr_e( 'e.g. Indian sandstone paving', 'hillcroft-garden-designer' ); ?>" /></label>
									<label><span><?php esc_html_e( 'Quantity', 'hillcroft-garden-designer' ); ?></span>
										<input type="number" step="0.01" min="0" name="qty" value="1" /></label>
									<label><span><?php esc_html_e( 'Unit', 'hillcroft-garden-designer' ); ?></span>
										<input type="text" name="unit" value="each" placeholder="each, m2, m, m3" /></label>
									<label><span><?php esc_html_e( 'Unit cost (£)', 'hillcroft-garden-designer' ); ?></span>
										<input type="number" step="0.01" min="0" name="unit_cost_gbp" value="0" /></label>
									<label><span><?php esc_html_e( 'Markup %', 'hillcroft-garden-designer' ); ?></span>
										<input type="number" step="0.01" name="markup_pct" value="0" /></label>
								</div>
								<div class="hgd-form-actions">
									<button type="submit" class="hgd-pill"><?php esc_html_e( 'Add line', 'hillcroft-garden-designer' ); ?></button>
								</div>
							</form>
						</div>
					</div>

					<h3><?php esc_html_e( 'Good tier — quote settings', 'hillcroft-garden-designer' ); ?></h3>
					<form method="post" action="<?php echo esc_url( $post_url ); ?>" class="hgd-form">
						<input type="hidden" name="action" value="hgd_quote_save" />
						<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>" />
						<input type="hidden" name="quote_id" value="<?php echo esc_attr( $gid ); ?>" />
						<?php wp_nonce_field( 'hgd_quote_save_' . $gid ); ?>
						<div class="hgd-grid">
							<label><span><?php esc_html_e( 'Quote title', 'hillcroft-garden-designer' ); ?></span>
								<input type="text" name="title" value="<?php echo esc_attr( $good['title'] ); ?>" /></label>
							<label><span><?php esc_html_e( 'Labour days', 'hillcroft-garden-designer' ); ?></span>
								<input type="number" step="0.01" min="0" name="labour_days" value="<?php echo esc_attr( $good['labour_days'] ); ?>" /></label>
							<label><span><?php esc_html_e( 'Day rate (£)', 'hillcroft-garden-designer' ); ?></span>
								<input type="number" step="0.01" min="0" name="day_rate_gbp" value="<?php echo esc_attr( $good['day_rate_gbp'] ); ?>" /></label>
							<label><span><?php esc_html_e( 'Wastage %', 'hillcroft-garden-designer' ); ?></span>
								<input type="number" step="0.01" min="0" name="wastage_pct" value="<?php echo esc_attr( $good['wastage_pct'] ); ?>" /></label>
							<label><span><?php esc_html_e( 'Contingency %', 'hillcroft-garden-designer' ); ?></span>
								<input type="number" step="0.01" min="0" name="contingency_pct" value="<?php echo esc_attr( $good['contingency_pct'] ); ?>" /></label>
							<label><span><?php esc_html_e( 'Design fee (£)', 'hillcroft-garden-designer' ); ?></span>
								<input type="number" step="0.01" min="0" name="design_fee_gbp" value="<?php echo esc_attr( $good['design_fee_gbp'] ); ?>" /></label>
							<label><span><?php esc_html_e( 'VAT %', 'hillcroft-garden-designer' ); ?></span>
								<input type="number" step="0.01" min="0" name="vat_pct" value="<?php echo esc_attr( $good['vat_pct'] ); ?>" /></label>
						</div>
						<label class="hgd-full"><span><?php esc_html_e( 'Quote notes', 'hillcroft-garden-designer' ); ?></span>
							<textarea name="notes" rows="3"><?php echo esc_textarea( $good['notes'] ); ?></textarea></label>
						<div class="hgd-form-actions">
							<button type="submit" class="hgd-pill"><?php esc_html_e( 'Save quote settings', 'hillcroft-garden-designer' ); ?></button>
						</div>
					</form>
				<?php endif; ?>
			<?php endif; ?>
		</div>

		<?php
		// --- Proposal + milestone payments -----------------------------------
		$proposal       = isset( $proposal ) ? $proposal : null;
		$payments       = isset( $payments ) && is_array( $payments ) ? $payments : array();
		$proposal_error = isset( $_GET['proposal_error'] ) ? sanitize_text_field( wp_unslash( $_GET['proposal_error'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		?>
		<div class="hgd-panel">
			<h2><?php esc_html_e( 'Proposal', 'hillcroft-garden-designer' ); ?></h2>
			<p class="hgd-muted"><?php esc_html_e( 'Turn a chosen quote into a sendable, payable proposal. The client reviews it on a private, branded page, accepts and signs, then pays the deposit to begin.', 'hillcroft-garden-designer' ); ?></p>

			<?php if ( isset( $_GET['proposal_created'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
				<div class="hgd-flash"><?php esc_html_e( 'Proposal created.', 'hillcroft-garden-designer' ); ?></div>
			<?php endif; ?>
			<?php if ( isset( $_GET['proposal_saved'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
				<div class="hgd-flash"><?php esc_html_e( 'Proposal saved.', 'hillcroft-garden-designer' ); ?></div>
			<?php endif; ?>
			<?php if ( isset( $_GET['proposal_sent'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
				<div class="hgd-flash"><?php esc_html_e( 'Proposal sent to the client.', 'hillcroft-garden-designer' ); ?></div>
			<?php endif; ?>
			<?php if ( isset( $_GET['proposal_deleted'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
				<div class="hgd-flash"><?php esc_html_e( 'Proposal deleted.', 'hillcroft-garden-designer' ); ?></div>
			<?php endif; ?>
			<?php if ( 'noemail' === $proposal_error ) : ?>
				<div class="hgd-flash hgd-flash-error"><?php esc_html_e( 'This project has no client email — add one before sending.', 'hillcroft-garden-designer' ); ?></div>
			<?php elseif ( '' !== $proposal_error ) : ?>
				<div class="hgd-flash hgd-flash-error"><?php esc_html_e( 'Could not complete that proposal action.', 'hillcroft-garden-designer' ); ?></div>
			<?php endif; ?>

			<?php if ( ! $proposal ) : ?>
				<?php if ( ! $has_quotes ) : ?>
					<p class="hgd-muted"><?php esc_html_e( 'Create a Good / Better / Best quote above first, then you can build a proposal from one of the tiers.', 'hillcroft-garden-designer' ); ?></p>
				<?php else : ?>
					<form method="post" action="<?php echo esc_url( $post_url ); ?>" class="hgd-inline-form">
						<input type="hidden" name="action" value="hgd_proposal_create" />
						<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>" />
						<?php wp_nonce_field( 'hgd_proposal_create_' . $pid ); ?>
						<div class="hgd-grid">
							<label><span><?php esc_html_e( 'Build proposal from', 'hillcroft-garden-designer' ); ?></span>
								<select name="quote_id">
									<?php foreach ( $quotes as $q ) :
										$qt = HGD_Quote::compute( (int) $q['id'] );
										?>
										<option value="<?php echo esc_attr( (int) $q['id'] ); ?>"><?php echo esc_html( HGD_Quote::tier_label( $q['tier'] ) . ' — £' . number_format( $qt['total_rounded'], 0 ) ); ?></option>
									<?php endforeach; ?>
								</select></label>
						</div>
						<div class="hgd-form-actions">
							<button type="submit" class="hgd-pill"><?php esc_html_e( 'Create proposal', 'hillcroft-garden-designer' ); ?></button>
						</div>
					</form>
				<?php endif; ?>
			<?php else :
				$portal_url = HGD_Proposal::portal_url( $proposal );
				$exp_value  = ! empty( $proposal['expires_at'] ) ? mysql2date( 'Y-m-d', $proposal['expires_at'] ) : '';
				?>
				<p>
					<span class="hgd-status hgd-status-<?php echo esc_attr( $proposal['status'] ); ?>"><?php echo esc_html( HGD_Proposal::status_label( $proposal['status'] ) ); ?></span>
					&nbsp;
					<span class="hgd-muted"><?php echo esc_html( sprintf( /* translators: %s amount */ __( 'Total: £%s', 'hillcroft-garden-designer' ), number_format( (float) $proposal['total_gbp'], 2 ) ) ); ?></span>
				</p>

				<label class="hgd-full"><span><?php esc_html_e( 'Client portal link (private)', 'hillcroft-garden-designer' ); ?></span>
					<input type="text" class="hgd-code" readonly value="<?php echo esc_attr( $portal_url ); ?>" onclick="this.select();" /></label>
				<p class="hgd-muted"><a href="<?php echo esc_url( $portal_url ); ?>" target="_blank" rel="noopener"><?php esc_html_e( 'Open the client portal preview ↗', 'hillcroft-garden-designer' ); ?></a></p>

				<form method="post" action="<?php echo esc_url( $post_url ); ?>" class="hgd-form">
					<input type="hidden" name="action" value="hgd_proposal_save" />
					<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>" />
					<input type="hidden" name="proposal_id" value="<?php echo esc_attr( (int) $proposal['id'] ); ?>" />
					<?php wp_nonce_field( 'hgd_proposal_save_' . (int) $proposal['id'] ); ?>

					<label class="hgd-full"><span><?php esc_html_e( 'Introduction (shown to the client)', 'hillcroft-garden-designer' ); ?></span>
						<textarea name="intro_text" rows="4"><?php echo esc_textarea( (string) $proposal['intro_text'] ); ?></textarea></label>

					<div class="hgd-grid">
						<label><span><?php esc_html_e( 'Deposit type', 'hillcroft-garden-designer' ); ?></span>
							<select name="deposit_type">
								<option value="pct" <?php selected( $proposal['deposit_type'], 'pct' ); ?>><?php esc_html_e( 'Percentage of total', 'hillcroft-garden-designer' ); ?></option>
								<option value="fixed" <?php selected( $proposal['deposit_type'], 'fixed' ); ?>><?php esc_html_e( 'Fixed amount (£)', 'hillcroft-garden-designer' ); ?></option>
							</select></label>
						<label><span><?php esc_html_e( 'Deposit value (% or £)', 'hillcroft-garden-designer' ); ?></span>
							<input type="number" step="0.01" min="0" name="deposit_value" value="<?php echo esc_attr( $proposal['deposit_value'] ); ?>" /></label>
						<label><span><?php esc_html_e( 'Expires on', 'hillcroft-garden-designer' ); ?></span>
							<input type="date" name="expires_at" value="<?php echo esc_attr( $exp_value ); ?>" /></label>
					</div>

					<label class="hgd-full"><span><?php esc_html_e( 'Terms &amp; conditions (shown to the client)', 'hillcroft-garden-designer' ); ?></span>
						<textarea name="terms_text" rows="6"><?php echo esc_textarea( (string) $proposal['terms_text'] ); ?></textarea></label>

					<div class="hgd-form-actions">
						<button type="submit" class="hgd-pill"><?php esc_html_e( 'Save proposal', 'hillcroft-garden-designer' ); ?></button>
						<span class="hgd-muted"><?php esc_html_e( 'Saving re-snapshots the total from the quote and rebuilds the payment schedule.', 'hillcroft-garden-designer' ); ?></span>
					</div>
				</form>

				<h3><?php esc_html_e( 'Payment schedule', 'hillcroft-garden-designer' ); ?></h3>
				<table class="hgd-table hgd-totals-table">
					<tbody>
						<?php foreach ( $payments as $p ) : ?>
							<tr>
								<td><?php echo esc_html( $p['label'] ); ?></td>
								<td class="num"><?php echo esc_html( '£' . number_format( (float) $p['amount_gbp'], 2 ) ); ?></td>
								<td>
									<?php if ( 'paid' === $p['status'] ) : ?>
										<span class="hgd-status hgd-status-complete"><?php esc_html_e( 'Paid', 'hillcroft-garden-designer' ); ?></span>
									<?php else : ?>
										<span class="hgd-status hgd-status-lead"><?php esc_html_e( 'Due', 'hillcroft-garden-designer' ); ?></span>
									<?php endif; ?>
								</td>
							</tr>
						<?php endforeach; ?>
					</tbody>
				</table>

				<div class="hgd-form-actions" style="margin-top:18px;">
					<form method="post" action="<?php echo esc_url( $post_url ); ?>" style="display:inline;">
						<input type="hidden" name="action" value="hgd_proposal_send" />
						<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>" />
						<input type="hidden" name="proposal_id" value="<?php echo esc_attr( (int) $proposal['id'] ); ?>" />
						<?php wp_nonce_field( 'hgd_proposal_send_' . (int) $proposal['id'] ); ?>
						<button type="submit" class="hgd-pill"><?php echo 'draft' === $proposal['status'] ? esc_html__( 'Send to client', 'hillcroft-garden-designer' ) : esc_html__( 'Re-send to client', 'hillcroft-garden-designer' ); ?></button>
					</form>
					<form method="post" action="<?php echo esc_url( $post_url ); ?>" style="display:inline;">
						<input type="hidden" name="action" value="hgd_proposal_delete" />
						<input type="hidden" name="project_id" value="<?php echo esc_attr( $pid ); ?>" />
						<input type="hidden" name="proposal_id" value="<?php echo esc_attr( (int) $proposal['id'] ); ?>" />
						<?php wp_nonce_field( 'hgd_proposal_delete_' . (int) $proposal['id'] ); ?>
						<button type="submit" class="hgd-link-danger" onclick="return confirm('<?php echo esc_js( __( 'Delete this proposal and its payment schedule?', 'hillcroft-garden-designer' ) ); ?>');"><?php esc_html_e( 'Delete proposal', 'hillcroft-garden-designer' ); ?></button>
					</form>
				</div>
			<?php endif; ?>
		</div>
	<?php endif; ?>

</div>
