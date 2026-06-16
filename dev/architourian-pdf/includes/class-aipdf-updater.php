<?php
/**
 * Self-updater: pulls release zips from the October monorepo's GitHub Releases.
 *
 * The plugin source lives in the (public) octobercomms/claude monorepo, which
 * publishes a GitHub Release for each plugin version — tagged with a per-plugin
 * prefix (here, "aipdf-v") so the several plugins in the repo don't collide.
 * This updater:
 *   - reads the repo's releases,
 *   - considers only releases whose tag starts with the prefix,
 *   - strips the prefix to get the version (e.g. "aipdf-v1.3.1" -> "1.3.1"),
 *   - surfaces the newest one on the WordPress "Updates" screen, and
 *   - installs the attached .zip asset.
 *
 * The repo is public, so no token is needed on the site — the release asset's
 * browser download URL is fetched directly by WordPress. No third-party library
 * required (this replaces the plugin-update-checker dependency).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class AIPDF_Updater {

	private $basename;     // architourian-pdf/architourian-pdf.php
	private $slug;         // architourian-pdf
	private $version;      // installed version
	private $repo;         // owner/repo, e.g. octobercomms/claude
	private $tag_prefix;   // e.g. aipdf-v
	private $cache_key;

	public function __construct( $basename, $version, $repo, $tag_prefix = 'aipdf-v' ) {
		$this->basename   = $basename;
		$this->slug       = dirname( $basename );
		$this->version    = $version;
		$this->repo       = trim( $repo, '/ ' );
		$this->tag_prefix = $tag_prefix;
		$this->cache_key  = 'aipdf_updater_' . md5( $this->repo . '|' . $this->tag_prefix );

		add_filter( 'pre_set_site_transient_update_plugins', array( $this, 'check_for_update' ) );
		add_filter( 'plugins_api', array( $this, 'plugin_info' ), 20, 3 );
		add_action( 'upgrader_process_complete', array( $this, 'flush_cache' ), 10, 0 );
	}

	/**
	 * Fetch and cache the newest matching release.
	 *
	 * @return array{version:string,zip:string,changelog:string,published:string,html:string}|null
	 */
	private function latest_release() {
		$cached = get_transient( $this->cache_key );
		if ( false !== $cached ) {
			return $cached ?: null;
		}

		$response = wp_remote_get(
			"https://api.github.com/repos/{$this->repo}/releases?per_page=30",
			array(
				'timeout' => 20,
				'headers' => array(
					'Accept'               => 'application/vnd.github+json',
					'X-GitHub-Api-Version' => '2022-11-28',
					'User-Agent'           => 'Architourian-PDF-Updater',
				),
			)
		);

		if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
			set_transient( $this->cache_key, '', 10 * MINUTE_IN_SECONDS );
			return null;
		}

		$releases = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( ! is_array( $releases ) ) {
			set_transient( $this->cache_key, '', 10 * MINUTE_IN_SECONDS );
			return null;
		}

		$best = null;
		foreach ( $releases as $release ) {
			if ( ! empty( $release['draft'] ) || ! empty( $release['prerelease'] ) ) {
				continue;
			}
			$tag = isset( $release['tag_name'] ) ? $release['tag_name'] : '';
			if ( 0 !== strpos( $tag, $this->tag_prefix ) ) {
				continue; // a different plugin's release in the same repo
			}
			$version = ltrim( substr( $tag, strlen( $this->tag_prefix ) ), 'v' );
			if ( '' === $version ) {
				continue;
			}
			if ( null === $best || version_compare( $version, $best['version'], '>' ) ) {
				$zip = $this->find_zip_asset( $release );
				if ( $zip ) {
					$best = array(
						'version'   => $version,
						'zip'       => $zip,
						'changelog' => isset( $release['body'] ) ? (string) $release['body'] : '',
						'published' => isset( $release['published_at'] ) ? (string) $release['published_at'] : '',
						'html'      => isset( $release['html_url'] ) ? (string) $release['html_url'] : '',
					);
				}
			}
		}

		if ( $best ) {
			set_transient( $this->cache_key, $best, 3 * HOUR_IN_SECONDS );
		} else {
			set_transient( $this->cache_key, '', 15 * MINUTE_IN_SECONDS );
		}
		return $best;
	}

	/** The public browser download URL of the first .zip asset on a release. */
	private function find_zip_asset( array $release ) {
		if ( empty( $release['assets'] ) || ! is_array( $release['assets'] ) ) {
			return null;
		}
		foreach ( $release['assets'] as $asset ) {
			if ( isset( $asset['name'], $asset['browser_download_url'] ) && substr( $asset['name'], -4 ) === '.zip' ) {
				return $asset['browser_download_url'];
			}
		}
		return null;
	}

	public function check_for_update( $transient ) {
		if ( empty( $transient->checked ) ) {
			return $transient;
		}
		// Manual "Check again" (update-core.php?force-check=1) bypasses our cache.
		if ( ! empty( $_GET['force-check'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			delete_transient( $this->cache_key );
		}

		$release = $this->latest_release();
		if ( $release && version_compare( $release['version'], $this->version, '>' ) ) {
			$transient->response[ $this->basename ] = (object) array(
				'slug'        => $this->slug,
				'plugin'      => $this->basename,
				'new_version' => $release['version'],
				'url'         => $release['html'],
				'package'     => $release['zip'], // public asset — WordPress downloads it directly
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
		$release = $this->latest_release();
		if ( ! $release ) {
			return $result;
		}
		return (object) array(
			'name'          => 'Architourian PDF Generator',
			'slug'          => $this->slug,
			'version'       => $release['version'],
			'author'        => '<a href="https://architourian.com">Architourian</a>',
			'homepage'      => 'https://architourian.com',
			'download_link' => $release['zip'],
			'last_updated'  => $release['published'],
			'sections'      => array(
				'changelog' => wpautop( esc_html( $release['changelog'] ) ),
			),
		);
	}

	public function flush_cache() {
		delete_transient( $this->cache_key );
	}
}
