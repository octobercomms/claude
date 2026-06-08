<?php
/**
 * Self-updater that pulls new versions from the October Marketing Intelligence
 * platform — not from GitHub directly.
 *
 * The platform is the single distribution point: it serves the current plugin
 * build plus a small version manifest. That means a new version rolls out to
 * every paired site with NO GitHub token on the site at all, and the WordPress
 * "Updates" screen (and auto-updates) work against a plain, public download URL.
 *
 * Flow:
 *   - Poll  {platform}/api/integrations/wordpress-plugin/info  for the latest
 *     version + a download URL.
 *   - If it's newer, surface it on the Updates screen; WordPress downloads the
 *     zip directly from the platform (no auth header needed).
 *
 * The platform builds that zip from the deployed source (see the platform's
 * routes/integrations.js + update.sh), so "merge + deploy" is the release.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OctoberMI_Updater {

	private $basename;   // october-marketing-intelligence/october-marketing-intelligence.php
	private $slug;       // october-marketing-intelligence
	private $version;    // installed version
	private $platform;   // platform base URL, no trailing slash
	private $cache_key;

	public function __construct( $basename, $version, $platform ) {
		$this->basename  = $basename;
		$this->slug      = dirname( $basename );
		$this->version   = $version;
		$this->platform  = rtrim( (string) $platform, '/' );
		$this->cache_key = 'octobermi_updater_' . md5( $this->platform );

		add_filter( 'pre_set_site_transient_update_plugins', array( $this, 'check_for_update' ) );
		add_filter( 'plugins_api', array( $this, 'plugin_info' ), 20, 3 );
		add_action( 'upgrader_process_complete', array( $this, 'flush_cache' ), 10, 0 );
	}

	private function info_url() {
		return $this->platform . '/api/integrations/wordpress-plugin/info';
	}

	/**
	 * Fetch + cache the latest manifest from the platform.
	 *
	 * @return array{version:string,package:string,changelog:string,name:string,homepage:string}|null
	 */
	private function latest() {
		$cached = get_transient( $this->cache_key );
		if ( false !== $cached ) {
			return $cached ?: null;
		}

		$response = wp_remote_get( $this->info_url(), array(
			'timeout' => 15,
			'headers' => array( 'Accept' => 'application/json' ),
		) );

		if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
			set_transient( $this->cache_key, '', 10 * MINUTE_IN_SECONDS );
			return null;
		}

		$data = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( ! is_array( $data ) || empty( $data['version'] ) || empty( $data['package'] ) ) {
			set_transient( $this->cache_key, '', 10 * MINUTE_IN_SECONDS );
			return null;
		}

		$info = array(
			'version'   => (string) $data['version'],
			'package'   => (string) $data['package'],
			'changelog' => isset( $data['changelog'] ) ? (string) $data['changelog'] : '',
			'name'      => isset( $data['name'] ) ? (string) $data['name'] : 'October Marketing Intelligence',
			'homepage'  => isset( $data['homepage'] ) ? (string) $data['homepage'] : 'https://octobercomms.com',
		);
		set_transient( $this->cache_key, $info, 3 * HOUR_IN_SECONDS );
		return $info;
	}

	// -------------------------------------------------------------------------
	// WordPress update plumbing
	// -------------------------------------------------------------------------

	public function check_for_update( $transient ) {
		if ( empty( $transient->checked ) ) {
			return $transient;
		}

		// On a manual "Check again" (update-core.php?force-check=1), bypass our
		// cache so a freshly published version is picked up immediately.
		if ( ! empty( $_GET['force-check'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			delete_transient( $this->cache_key );
		}

		$info = $this->latest();
		if ( $info && version_compare( $info['version'], $this->version, '>' ) ) {
			$transient->response[ $this->basename ] = (object) array(
				'slug'        => $this->slug,
				'plugin'      => $this->basename,
				'new_version' => $info['version'],
				'url'         => $info['homepage'],
				'package'     => $info['package'], // plain, public zip URL on the platform
			);
		} else {
			unset( $transient->response[ $this->basename ] );
		}

		return $transient;
	}

	public function plugin_info( $result, $action, $args ) {
		if ( 'plugin_information' !== $action || empty( $args->slug ) || $args->slug !== $this->slug ) {
			return $result;
		}
		$info = $this->latest();
		if ( ! $info ) {
			return $result;
		}
		return (object) array(
			'name'          => $info['name'],
			'slug'          => $this->slug,
			'version'       => $info['version'],
			'author'        => '<a href="https://octobercomms.com">October</a>',
			'homepage'      => $info['homepage'],
			'download_link' => $info['package'],
			'sections'      => array(
				'changelog' => $info['changelog'] ? wpautop( esc_html( $info['changelog'] ) ) : '',
			),
		);
	}

	public function flush_cache() {
		delete_transient( $this->cache_key );
	}

	/**
	 * Diagnose the update connection against the platform — surfaced by the
	 * "Test update connection" button so a misconfiguration is visible.
	 *
	 * @return array{ok:bool,message:string}
	 */
	public function diagnose() {
		$response = wp_remote_get( $this->info_url(), array(
			'timeout' => 15,
			'headers' => array( 'Accept' => 'application/json' ),
		) );

		if ( is_wp_error( $response ) ) {
			return array(
				'ok'      => false,
				'message' => sprintf(
					/* translators: %s: error message */
					__( 'Could not reach the October platform: %s', 'october-mi' ),
					$response->get_error_message()
				),
			);
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		if ( 200 !== $code ) {
			return array(
				'ok'      => false,
				'message' => sprintf(
					/* translators: %d: HTTP status code */
					__( 'The platform returned HTTP %d for the update feed.', 'october-mi' ),
					$code
				),
			);
		}

		$data = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( ! is_array( $data ) || empty( $data['version'] ) ) {
			return array( 'ok' => false, 'message' => __( 'The platform update feed returned no version.', 'october-mi' ) );
		}

		delete_transient( $this->cache_key );
		return array(
			'ok'      => true,
			'message' => sprintf(
				/* translators: 1: latest version, 2: installed version */
				__( 'Connected. Latest published version is %1$s (you have %2$s).', 'october-mi' ),
				(string) $data['version'],
				$this->version
			),
		);
	}
}
