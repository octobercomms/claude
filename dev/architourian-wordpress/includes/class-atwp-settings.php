<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ATWP_Settings {

	private static $page_hook;

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'add_menu' ) );
		add_action( 'admin_init', array( __CLASS__, 'register_settings' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue_assets' ) );
	}

	public static function add_menu() {
		self::$page_hook = add_options_page(
			__( 'Architourian API', 'architourian-wordpress' ),
			__( 'Architourian API', 'architourian-wordpress' ),
			'manage_options',
			'atwp-settings',
			array( __CLASS__, 'render_page' )
		);
	}

	public static function enqueue_assets( $hook ) {
		if ( ! isset( self::$page_hook ) || $hook !== self::$page_hook ) {
			return;
		}
		wp_enqueue_style( 'atwp-admin', ATWP_URL . 'assets/css/admin.css', array(), ATWP_VERSION );
		wp_enqueue_script( 'atwp-admin', ATWP_URL . 'assets/js/admin.js', array( 'jquery' ), ATWP_VERSION, true );
		wp_localize_script( 'atwp-admin', 'atwpAdmin', array(
			'ajaxUrl' => admin_url( 'admin-ajax.php' ),
			'nonce'   => wp_create_nonce( 'atwp_admin_nonce' ),
			'strings' => array(
				'confirmDelete' => __( 'Delete this API key? This cannot be undone.', 'architourian-wordpress' ),
				'copied'        => __( 'Copied to clipboard', 'architourian-wordpress' ),
				'keyWarning'    => __( 'Copy this key now. It will not be shown again.', 'architourian-wordpress' ),
			),
		) );
	}

	public static function register_settings() {
		register_setting( 'atwp_settings', 'atwp_tour_cpt', array(
			'type'              => 'string',
			'sanitize_callback' => 'sanitize_text_field',
			'default'           => 'post',
		) );

		register_setting( 'atwp_settings', 'atwp_field_mapping', array(
			'type'              => 'array',
			'sanitize_callback' => array( __CLASS__, 'sanitize_field_mapping' ),
			'default'           => array(),
		) );

		register_setting( 'atwp_settings', 'atwp_require_https', array(
			'type'              => 'boolean',
			'sanitize_callback' => 'rest_sanitize_boolean',
			'default'           => false,
		) );

		register_setting( 'atwp_settings', 'atwp_ip_allowlist', array(
			'type'              => 'string',
			'sanitize_callback' => 'sanitize_textarea_field',
			'default'           => '',
		) );

		add_settings_section(
			'atwp_keys_section',
			__( 'API Keys', 'architourian-wordpress' ),
			array( __CLASS__, 'render_keys_section' ),
			'atwp-settings'
		);

		add_settings_section(
			'atwp_tour_section',
			__( 'Tour Configuration', 'architourian-wordpress' ),
			array( __CLASS__, 'render_tour_section' ),
			'atwp-settings'
		);

		add_settings_section(
			'atwp_security_section',
			__( 'Security', 'architourian-wordpress' ),
			array( __CLASS__, 'render_security_section' ),
			'atwp-settings'
		);
	}

	public static function sanitize_field_mapping( $input ) {
		if ( ! is_array( $input ) ) {
			return array();
		}
		$clean = array();
		foreach ( $input as $key => $value ) {
			$clean[ sanitize_key( $key ) ] = sanitize_text_field( $value );
		}
		return $clean;
	}

	public static function render_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		?>
		<div class="wrap">
			<h1><?php echo esc_html( get_admin_page_title() ); ?></h1>

			<div class="atwp-api-url">
				<strong><?php esc_html_e( 'API Base URL:', 'architourian-wordpress' ); ?></strong>
				<code id="atwp-base-url"><?php echo esc_url( rest_url( 'architourian/v1/' ) ); ?></code>
				<button type="button" class="button button-small atwp-copy-btn" data-copy-target="atwp-base-url">
					<?php esc_html_e( 'Copy', 'architourian-wordpress' ); ?>
				</button>
			</div>

			<form action="options.php" method="post">
				<?php
				settings_fields( 'atwp_settings' );
				do_settings_sections( 'atwp-settings' );
				submit_button();
				?>
			</form>
		</div>
		<?php
	}

	public static function render_keys_section() {
		$keys = get_option( 'atwp_api_keys', array() );
		?>
		<table class="widefat atwp-keys-table" id="atwp-keys-table">
			<thead>
				<tr>
					<th><?php esc_html_e( 'Name', 'architourian-wordpress' ); ?></th>
					<th><?php esc_html_e( 'Key ID', 'architourian-wordpress' ); ?></th>
					<th><?php esc_html_e( 'Permissions', 'architourian-wordpress' ); ?></th>
					<th><?php esc_html_e( 'Created', 'architourian-wordpress' ); ?></th>
					<th><?php esc_html_e( 'Last Used', 'architourian-wordpress' ); ?></th>
					<th><?php esc_html_e( 'Actions', 'architourian-wordpress' ); ?></th>
				</tr>
			</thead>
			<tbody>
			<?php if ( empty( $keys ) ) : ?>
				<tr class="atwp-no-keys">
					<td colspan="6"><?php esc_html_e( 'No API keys created yet.', 'architourian-wordpress' ); ?></td>
				</tr>
			<?php else : ?>
				<?php foreach ( $keys as $key ) : ?>
				<tr data-key-id="<?php echo esc_attr( $key['id'] ); ?>">
					<td><?php echo esc_html( $key['name'] ); ?></td>
					<td><code><?php echo esc_html( $key['id'] ); ?></code></td>
					<td>
						<span class="atwp-permission-badge atwp-permission-<?php echo esc_attr( $key['permissions'] ); ?>">
							<?php echo esc_html( ucfirst( $key['permissions'] ) ); ?>
						</span>
					</td>
					<td><?php echo esc_html( $key['created_at'] ); ?></td>
					<td><?php echo esc_html( $key['last_used_at'] ?: '—' ); ?></td>
					<td>
						<button type="button" class="button button-small atwp-delete-key" data-key-id="<?php echo esc_attr( $key['id'] ); ?>">
							<?php esc_html_e( 'Delete', 'architourian-wordpress' ); ?>
						</button>
					</td>
				</tr>
				<?php endforeach; ?>
			<?php endif; ?>
			</tbody>
		</table>

		<div class="atwp-generate-key-form">
			<h4><?php esc_html_e( 'Generate New Key', 'architourian-wordpress' ); ?></h4>
			<p>
				<label>
					<?php esc_html_e( 'Name:', 'architourian-wordpress' ); ?>
					<input type="text" id="atwp-new-key-name" placeholder="<?php esc_attr_e( 'e.g. Claude Desktop', 'architourian-wordpress' ); ?>" />
				</label>
			</p>
			<p>
				<label>
					<?php esc_html_e( 'Permissions:', 'architourian-wordpress' ); ?>
					<select id="atwp-new-key-permissions">
						<option value="read"><?php esc_html_e( 'Read', 'architourian-wordpress' ); ?></option>
						<option value="write" selected><?php esc_html_e( 'Write (read + create/update)', 'architourian-wordpress' ); ?></option>
						<option value="admin"><?php esc_html_e( 'Admin (full access)', 'architourian-wordpress' ); ?></option>
					</select>
				</label>
			</p>
			<button type="button" class="button button-primary" id="atwp-generate-key">
				<?php esc_html_e( 'Generate API Key', 'architourian-wordpress' ); ?>
			</button>

			<div id="atwp-new-key-display" style="display:none;">
				<div class="atwp-key-box">
					<p class="atwp-key-warning"><?php esc_html_e( 'Copy this key now. It will not be shown again.', 'architourian-wordpress' ); ?></p>
					<code id="atwp-new-key-value"></code>
					<button type="button" class="button atwp-copy-btn" data-copy-target="atwp-new-key-value">
						<?php esc_html_e( 'Copy Key', 'architourian-wordpress' ); ?>
					</button>
				</div>
			</div>
		</div>
		<?php
	}

	public static function render_tour_section() {
		$current_cpt    = get_option( 'atwp_tour_cpt', 'post' );
		$field_mapping  = get_option( 'atwp_field_mapping', array() );
		$post_types     = get_post_types( array( 'public' => true ), 'objects' );
		?>
		<table class="form-table">
			<tr>
				<th scope="row">
					<label for="atwp_tour_cpt"><?php esc_html_e( 'Tour Post Type', 'architourian-wordpress' ); ?></label>
				</th>
				<td>
					<select name="atwp_tour_cpt" id="atwp_tour_cpt">
						<?php foreach ( $post_types as $pt ) : ?>
						<option value="<?php echo esc_attr( $pt->name ); ?>" <?php selected( $current_cpt, $pt->name ); ?>>
							<?php echo esc_html( $pt->label . ' (' . $pt->name . ')' ); ?>
						</option>
						<?php endforeach; ?>
					</select>
					<p class="description">
						<?php esc_html_e( 'Select the custom post type used for tours.', 'architourian-wordpress' ); ?>
					</p>
				</td>
			</tr>
		</table>

		<h4><?php esc_html_e( 'Field Mapping', 'architourian-wordpress' ); ?></h4>
		<p class="description">
			<?php esc_html_e( 'Map your tour fields to standard roles. Enter the meta field name (JetEngine field name) for each.', 'architourian-wordpress' ); ?>
		</p>

		<table class="form-table">
			<?php
			$mappable_fields = array(
				'tour_date'           => __( 'Tour Date', 'architourian-wordpress' ),
				'tour_end_date'       => __( 'Tour End Date', 'architourian-wordpress' ),
				'availability_status' => __( 'Availability Status', 'architourian-wordpress' ),
				'max_capacity'        => __( 'Max Capacity', 'architourian-wordpress' ),
				'price'               => __( 'Price', 'architourian-wordpress' ),
				'location'            => __( 'Location', 'architourian-wordpress' ),
			);
			foreach ( $mappable_fields as $role => $label ) :
				$value = isset( $field_mapping[ $role ] ) ? $field_mapping[ $role ] : '';
			?>
			<tr>
				<th scope="row">
					<label for="atwp_field_mapping_<?php echo esc_attr( $role ); ?>"><?php echo esc_html( $label ); ?></label>
				</th>
				<td>
					<input type="text"
						name="atwp_field_mapping[<?php echo esc_attr( $role ); ?>]"
						id="atwp_field_mapping_<?php echo esc_attr( $role ); ?>"
						value="<?php echo esc_attr( $value ); ?>"
						class="regular-text"
						placeholder="<?php esc_attr_e( 'meta field name', 'architourian-wordpress' ); ?>" />
				</td>
			</tr>
			<?php endforeach; ?>
		</table>
		<?php
	}

	public static function render_security_section() {
		$require_https = get_option( 'atwp_require_https', false );
		$ip_allowlist  = get_option( 'atwp_ip_allowlist', '' );
		?>
		<table class="form-table">
			<tr>
				<th scope="row"><?php esc_html_e( 'Require HTTPS', 'architourian-wordpress' ); ?></th>
				<td>
					<label>
						<input type="checkbox" name="atwp_require_https" value="1" <?php checked( $require_https ); ?> />
						<?php esc_html_e( 'Only allow API requests over HTTPS', 'architourian-wordpress' ); ?>
					</label>
				</td>
			</tr>
			<tr>
				<th scope="row">
					<label for="atwp_ip_allowlist"><?php esc_html_e( 'IP Allowlist', 'architourian-wordpress' ); ?></label>
				</th>
				<td>
					<textarea name="atwp_ip_allowlist" id="atwp_ip_allowlist" rows="4" cols="40" class="regular-text"
						placeholder="<?php esc_attr_e( "Leave empty to allow all IPs\nOne IP per line", 'architourian-wordpress' ); ?>"><?php echo esc_textarea( $ip_allowlist ); ?></textarea>
					<p class="description">
						<?php esc_html_e( 'One IP address per line. Leave empty to allow all IPs.', 'architourian-wordpress' ); ?>
					</p>
				</td>
			</tr>
		</table>
		<?php
	}
}
