<?php
/**
 * View for the "Sheets Sync" admin screen.
 *
 * @var string $token     Current sync token ('' when disabled).
 * @var bool   $stock_ro  Whether stock is read-only on push.
 * @var string $api_base  REST base URL for this store.
 * @var string $script    Ready-to-paste Apps Script ('' when disabled).
 *
 * @package OctBulkEditor
 */

defined( 'ABSPATH' ) || exit;

$enabled = $token !== '';
?>
<div class="wrap wbe-wrap">

	<h1 class="wbe-header">
		<?php esc_html_e( 'Bulk Editor – Google Sheets Sync', 'oct-bulk-editor' ); ?>
		<span class="wbe-badge">
			<?php echo $enabled ? esc_html__( 'Connected', 'oct-bulk-editor' ) : esc_html__( 'Not set up', 'oct-bulk-editor' ); ?>
		</span>
	</h1>

	<?php if ( isset( $_GET['updated'] ) ) : ?>
		<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Settings saved.', 'oct-bulk-editor' ); ?></p></div>
	<?php endif; ?>

	<p style="max-width:760px">
		<?php esc_html_e( 'Edit prices, sale prices, per-currency (EUR/USD) prices and product data from a Google Sheet. Pull the catalogue into a sheet, edit it like a spreadsheet, then push your changes back so they go live. Rows that changed in WooCommerce since your last pull are flagged so you always know what you would overwrite. The columns match the CSV export/import exactly.', 'oct-bulk-editor' ); ?>
	</p>

	<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
		<input type="hidden" name="action" value="octwbe_sync_save" />
		<?php wp_nonce_field( 'octwbe_sync_save' ); ?>

		<table class="form-table" role="presentation">
			<tr>
				<th scope="row"><?php esc_html_e( 'Connection token', 'oct-bulk-editor' ); ?></th>
				<td>
					<?php if ( $enabled ) : ?>
						<input type="text" class="regular-text code" readonly value="<?php echo esc_attr( $token ); ?>" onfocus="this.select()" style="width:420px" />
						<p class="description"><?php esc_html_e( 'Keep this secret — anyone with it and the store URL can read and edit your products.', 'oct-bulk-editor' ); ?></p>
					<?php else : ?>
						<p class="description"><?php esc_html_e( 'No token yet. Generate one to enable the sync.', 'oct-bulk-editor' ); ?></p>
					<?php endif; ?>
				</td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Store API URL', 'oct-bulk-editor' ); ?></th>
				<td><code><?php echo esc_html( $api_base ); ?></code></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Stock quantity', 'oct-bulk-editor' ); ?></th>
				<td>
					<label>
						<input type="checkbox" name="stock_readonly" value="1" <?php checked( $stock_ro ); ?> />
						<?php esc_html_e( 'Read-only (recommended) — show stock in the sheet but never push it back.', 'oct-bulk-editor' ); ?>
					</label>
					<p class="description"><?php esc_html_e( 'Live inventory changes constantly as orders come in. Leaving this on protects stock counts from being clobbered by a stale sheet. Untick only if the sheet is your source of truth for stock.', 'oct-bulk-editor' ); ?></p>
				</td>
			</tr>
		</table>

		<p class="submit">
			<button type="submit" name="octwbe_action" value="save" class="button button-primary"><?php esc_html_e( 'Save settings', 'oct-bulk-editor' ); ?></button>
			<button type="submit" name="octwbe_action" value="generate" class="button button-secondary">
				<?php echo $enabled ? esc_html__( 'Regenerate token', 'oct-bulk-editor' ) : esc_html__( 'Generate token & enable', 'oct-bulk-editor' ); ?>
			</button>
			<?php if ( $enabled ) : ?>
				<button type="submit" name="octwbe_action" value="revoke" class="button button-link-delete" onclick="return confirm('<?php echo esc_js( __( 'Revoke the token? Any connected sheet will stop working until you generate a new one and update the script.', 'oct-bulk-editor' ) ); ?>')"><?php esc_html_e( 'Revoke', 'oct-bulk-editor' ); ?></button>
			<?php endif; ?>
		</p>
	</form>

	<?php if ( $enabled ) : ?>
		<hr />
		<h2><?php esc_html_e( 'Set up the Google Sheet', 'oct-bulk-editor' ); ?></h2>
		<ol style="max-width:760px">
			<li><?php esc_html_e( 'Create (or open) a Google Sheet.', 'oct-bulk-editor' ); ?></li>
			<li><?php printf( esc_html__( 'Open %1$sExtensions ▸ Apps Script%2$s, delete any starter code, and paste the script below (it already has this store\'s URL and token filled in).', 'oct-bulk-editor' ), '<strong>', '</strong>' ); ?></li>
			<li><?php printf( esc_html__( 'Click %1$sSave%2$s, then reload the Google Sheet.', 'oct-bulk-editor' ), '<strong>', '</strong>' ); ?></li>
			<li><?php printf( esc_html__( 'A new %1$sBulk Editor%2$s menu appears. Use %1$s⬇ Pull products%2$s to load the catalogue, edit cells, %1$s🔍 Check for changes%2$s to see what moved in the store, then %1$s⬆ Push my changes%2$s.', 'oct-bulk-editor' ), '<strong>', '</strong>' ); ?></li>
		</ol>

		<p>
			<button type="button" class="button button-primary" onclick="var t=document.getElementById('octwbe-gs');t.select();document.execCommand('copy');this.textContent='<?php echo esc_js( __( 'Copied!', 'oct-bulk-editor' ) ); ?>';"><?php esc_html_e( 'Copy script to clipboard', 'oct-bulk-editor' ); ?></button>
		</p>
		<textarea id="octwbe-gs" readonly rows="18" style="width:100%;font-family:Menlo,Consolas,monospace;font-size:12px;white-space:pre" onclick="this.select()"><?php echo esc_textarea( $script ); ?></textarea>

		<h2><?php esc_html_e( 'Colour key', 'oct-bulk-editor' ); ?></h2>
		<ul style="max-width:760px">
			<li><span style="display:inline-block;width:14px;height:14px;background:#cfe3ff;border:1px solid #999;vertical-align:middle"></span> <?php esc_html_e( 'Blue — your unsaved edit in the sheet.', 'oct-bulk-editor' ); ?></li>
			<li><span style="display:inline-block;width:14px;height:14px;background:#ffe2b8;border:1px solid #999;vertical-align:middle"></span> <?php esc_html_e( 'Amber — changed in WooCommerce since your last pull (you would overwrite it).', 'oct-bulk-editor' ); ?></li>
			<li><span style="display:inline-block;width:14px;height:14px;background:#ffc7c2;border:1px solid #999;vertical-align:middle"></span> <?php esc_html_e( 'Red — conflict: changed in both the sheet and the store. These are not pushed unless you choose "Push & overwrite conflicts".', 'oct-bulk-editor' ); ?></li>
		</ul>

		<p class="description" style="max-width:760px">
			<?php esc_html_e( 'Multiple stores (e.g. a separate WooCommerce per country): repeat these steps in a separate sheet (or tab) for each store using that store\'s own token. Prices, sale prices and EUR/USD prices stay independent per store.', 'oct-bulk-editor' ); ?>
		</p>
	<?php endif; ?>

</div><!-- .wrap -->
