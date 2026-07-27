<?php
/**
 * Settings screen (Popups → Settings). Holds the GitHub token/repo the
 * self-updater uses, and exposes get()/update() helpers for the whole plugin.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCPOP_Settings {

	const OPTION = 'ocpop_settings';

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_init', array( __CLASS__, 'register' ) );
	}

	public static function defaults() {
		return array(
			'github_token' => '',
			'github_repo'  => 'octobercomms/claude',
		);
	}

	public static function all() {
		$saved = get_option( self::OPTION, array() );
		if ( ! is_array( $saved ) ) {
			$saved = array();
		}
		return array_merge( self::defaults(), $saved );
	}

	public static function get( $key, $fallback = null ) {
		$all = self::all();
		if ( isset( $all[ $key ] ) && '' !== $all[ $key ] ) {
			return $all[ $key ];
		}
		return null === $fallback ? ( isset( $all[ $key ] ) ? $all[ $key ] : null ) : $fallback;
	}

	public static function menu() {
		add_submenu_page(
			'edit.php?post_type=' . OCPOP_CPT,
			__( 'Popup Settings', 'october-popups' ),
			__( 'Settings', 'october-popups' ),
			'manage_options',
			'ocpop-settings',
			array( __CLASS__, 'render' )
		);
	}

	public static function register() {
		register_setting(
			'ocpop_settings_group',
			self::OPTION,
			array( __CLASS__, 'sanitize' )
		);
	}

	public static function sanitize( $in ) {
		$out                 = self::all();
		$out['github_token'] = isset( $in['github_token'] ) ? trim( sanitize_text_field( $in['github_token'] ) ) : '';
		$out['github_repo']  = isset( $in['github_repo'] ) ? trim( sanitize_text_field( $in['github_repo'] ) ) : self::defaults()['github_repo'];
		return $out;
	}

	public static function render() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$all = self::all();

		// Handle a "Test connection" click.
		$diag = null;
		if ( isset( $_POST['ocpop_test'] ) && check_admin_referer( 'ocpop_test_conn' ) ) {
			$updater = new OCPOP_Updater( OCPOP_BASENAME, OCPOP_VERSION, $all['github_repo'], $all['github_token'], 'ocpop-v' );
			$diag    = $updater->diagnose();
		}
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'October Popups — Settings', 'october-popups' ); ?></h1>

			<?php if ( $diag ) : ?>
				<div class="notice notice-<?php echo $diag['ok'] ? 'success' : 'error'; ?>">
					<p><?php echo esc_html( $diag['message'] ); ?></p>
				</div>
			<?php endif; ?>

			<form method="post" action="options.php">
				<?php settings_fields( 'ocpop_settings_group' ); ?>
				<h2><?php esc_html_e( 'Automatic updates', 'october-popups' ); ?></h2>
				<p class="description">
					<?php esc_html_e( 'Paste a GitHub fine-grained token with "Contents: read" on the plugin repo. New releases then appear on the WordPress Updates screen for one-click install.', 'october-popups' ); ?>
				</p>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="ocpop_repo"><?php esc_html_e( 'Repository', 'october-popups' ); ?></label></th>
						<td><input name="<?php echo esc_attr( self::OPTION ); ?>[github_repo]" id="ocpop_repo" type="text" class="regular-text" value="<?php echo esc_attr( $all['github_repo'] ); ?>" placeholder="octobercomms/claude"></td>
					</tr>
					<tr>
						<th scope="row"><label for="ocpop_token"><?php esc_html_e( 'GitHub token', 'october-popups' ); ?></label></th>
						<td><input name="<?php echo esc_attr( self::OPTION ); ?>[github_token]" id="ocpop_token" type="password" class="regular-text" value="<?php echo esc_attr( $all['github_token'] ); ?>" autocomplete="off"></td>
					</tr>
				</table>
				<?php submit_button(); ?>
			</form>

			<form method="post">
				<?php wp_nonce_field( 'ocpop_test_conn' ); ?>
				<input type="hidden" name="ocpop_test" value="1">
				<?php submit_button( __( 'Test update connection', 'october-popups' ), 'secondary', 'submit', false ); ?>
			</form>
		</div>
		<?php
	}
}
