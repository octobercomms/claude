<?php
/**
 * Self-updater for a plugin distributed from a PRIVATE GitHub repo.
 *
 * Flow:
 *   - Reads releases from the repo via the GitHub API (authenticated with a
 *     stored fine-grained token).
 *   - Considers only releases whose tag starts with the configured prefix
 *     (e.g. "hgd-v"), so other apps in the same monorepo don't interfere.
 *   - Surfaces the newest version in the WordPress "Updates" screen.
 *   - Downloads the attached .zip release asset with the right auth headers,
 *     handling GitHub's redirect to signed storage (where the auth header must
 *     NOT be forwarded).
 *
 * No third-party library required.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Updater {

	private $basename;     // e.g. hillcroft-garden-designer/hillcroft-garden-designer.php
	private $slug;         // e.g. hillcroft-garden-designer
	private $version;      // installed version
	private $repo;         // owner/repo
	private $token;        // GitHub token
	private $tag_prefix;   // e.g. hgd-v
	private $cache_key;

	public function __construct( $basename, $version, $repo, $token, $tag_prefix = 'hgd-v' ) {
		$this->basename   = $basename;
		$this->slug       = dirname( $basename );
		$this->version    = $version;
		$this->repo       = trim( $repo, '/ ' );
		$this->token      = $token;
		$this->tag_prefix = $tag_prefix;
		$this->cache_key  = 'hgd_updater_' . md5( $this->repo . '|' . $this->tag_prefix );

		add_filter( 'pre_set_site_transient_update_plugins', array( $this, 'check_for_update' ) );
		add_filter( 'plugins_api', array( $this, 'plugin_info' ), 20, 3 );
		add_filter( 'upgrader_pre_download', array( $this, 'download_private_asset' ), 10, 3 );
		add_action( 'upgrader_process_complete', array( $this, 'flush_cache' ), 10, 0 );
	}

	// -------------------------------------------------------------------------
	// Release lookup
	// -------------------------------------------------------------------------

	/**
	 * Fetch and cache the latest matching release info.
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
			$this->request_args( 'application/vnd.github+json' )
		);

		if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
			// Cache the miss briefly so we don't hammer the API on every page load.
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
				continue;
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

		// Cache a positive result for a few hours; cache a "no matching release"
		// result only briefly so a newly published release is noticed quickly
		// (and a manual "Check again" bypasses this cache entirely).
		if ( $best ) {
			set_transient( $this->cache_key, $best, 3 * HOUR_IN_SECONDS );
		} else {
			set_transient( $this->cache_key, '', 15 * MINUTE_IN_SECONDS );
		}
		return $best;
	}

	/** Return the GitHub API asset URL for the first .zip on a release. */
	private function find_zip_asset( array $release ) {
		if ( empty( $release['assets'] ) || ! is_array( $release['assets'] ) ) {
			return null;
		}
		foreach ( $release['assets'] as $asset ) {
			if ( isset( $asset['name'], $asset['url'] ) && substr( $asset['name'], -4 ) === '.zip' ) {
				return $asset['url']; // api.github.com/.../releases/assets/{id}
			}
		}
		return null;
	}

	// -------------------------------------------------------------------------
	// WordPress update plumbing
	// -------------------------------------------------------------------------

	public function check_for_update( $transient ) {
		if ( empty( $transient->checked ) ) {
			return $transient;
		}

		// On a manual "Check again" (update-core.php?force-check=1), bypass our
		// own cache so a freshly published release is picked up immediately.
		if ( ! empty( $_GET['force-check'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			delete_transient( $this->cache_key );
		}

		$release = $this->latest_release();
		if ( $release && version_compare( $release['version'], $this->version, '>' ) ) {
			$update = array(
				'slug'        => $this->slug,
				'plugin'      => $this->basename,
				'new_version' => $release['version'],
				'url'         => $release['html'],
				// Sentinel package: download_private_asset() swaps it for the real,
				// signed binary URL so we can attach the auth header correctly.
				'package'     => 'hgd-private:' . $release['zip'],
			);
			$transient->response[ $this->basename ] = (object) $update;
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
			'name'          => 'Hillcroft Garden Designer',
			'slug'          => $this->slug,
			'version'       => $release['version'],
			'author'        => '<a href="https://octobercomms.com">October Comms</a>',
			'homepage'      => 'https://octobercomms.com',
			'download_link' => 'hgd-private:' . $release['zip'],
			'last_updated'  => $release['published'],
			'sections'      => array(
				'changelog' => wpautop( esc_html( $release['changelog'] ) ),
			),
		);
	}

	/**
	 * Intercept the download of our sentinel package, fetch the private asset
	 * with auth, and hand WordPress a local file to install.
	 *
	 * @param mixed  $reply   Default false (let WP handle it).
	 * @param string $package The package URL.
	 * @return mixed WP_Error, a local file path, or the unchanged $reply.
	 */
	public function download_private_asset( $reply, $package, $upgrader = null ) {
		if ( ! is_string( $package ) || 0 !== strpos( $package, 'hgd-private:' ) ) {
			return $reply;
		}
		$asset_url = substr( $package, strlen( 'hgd-private:' ) );

		// Step 1: hit the asset API with octet-stream Accept and capture the
		// redirect Location WITHOUT following it (the auth header must not be
		// forwarded to the signed storage URL).
		$args                = $this->request_args( 'application/octet-stream' );
		$args['redirection'] = 0;
		$head                = wp_remote_get( $asset_url, $args );

		if ( is_wp_error( $head ) ) {
			return $head;
		}

		$code     = (int) wp_remote_retrieve_response_code( $head );
		$location = wp_remote_retrieve_header( $head, 'location' );

		if ( ( 301 === $code || 302 === $code || 307 === $code ) && $location ) {
			// Step 2: download the signed URL plainly (no auth header).
			$tmp = download_url( $location );
		} elseif ( 200 === $code ) {
			// Some setups return the binary directly.
			$tmp = wp_tempnam( 'hgd-update.zip' );
			$body = wp_remote_retrieve_body( $head );
			if ( ! $tmp || ! $body || false === file_put_contents( $tmp, $body ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions
				return new WP_Error( 'hgd_download_failed', __( 'Could not save the update package.', 'hillcroft-garden-designer' ) );
			}
		} else {
			return new WP_Error( 'hgd_download_failed', sprintf(
				/* translators: %d: HTTP status code */
				__( 'GitHub returned status %d when downloading the update.', 'hillcroft-garden-designer' ),
				$code
			) );
		}

		return $tmp;
	}

	public function flush_cache() {
		delete_transient( $this->cache_key );
	}

	/**
	 * Diagnose the update connection — calls the GitHub releases API and reports
	 * exactly what happened, so a silent failure (bad token, org approval needed,
	 * wrong scope, no matching release) becomes visible in Settings.
	 *
	 * @return array{ok:bool, message:string}
	 */
	public function diagnose() {
		if ( '' === trim( (string) $this->token ) ) {
			return array( 'ok' => false, 'message' => __( 'No GitHub token saved. Paste a fine-grained token with Contents: read on this repo.', 'hillcroft-garden-designer' ) );
		}

		$response = wp_remote_get(
			"https://api.github.com/repos/{$this->repo}/releases?per_page=30",
			$this->request_args( 'application/vnd.github+json' )
		);

		if ( is_wp_error( $response ) ) {
			return array( 'ok' => false, 'message' => sprintf(
				/* translators: %s error */ __( 'Could not reach GitHub: %s', 'hillcroft-garden-designer' ),
				$response->get_error_message()
			) );
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		$body = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( 200 !== $code ) {
			$api_msg = is_array( $body ) && isset( $body['message'] ) ? $body['message'] : '';
			$hint    = '';
			if ( 401 === $code ) {
				$hint = __( 'The token is invalid or expired.', 'hillcroft-garden-designer' );
			} elseif ( 403 === $code ) {
				$hint = __( 'Access forbidden — the org may require approval for fine-grained tokens, or the token lacks Contents: read.', 'hillcroft-garden-designer' );
			} elseif ( 404 === $code ) {
				$hint = __( 'Repo not found for this token — check the repository name and that the token is scoped to it (Resource owner = octobercomms).', 'hillcroft-garden-designer' );
			}
			return array( 'ok' => false, 'message' => sprintf(
				/* translators: 1: HTTP code, 2: github message, 3: hint */ __( 'GitHub returned HTTP %1$d (%2$s). %3$s', 'hillcroft-garden-designer' ),
				$code,
				$api_msg ? $api_msg : '—',
				$hint
			) );
		}

		if ( ! is_array( $body ) ) {
			return array( 'ok' => false, 'message' => __( 'GitHub returned an unexpected response.', 'hillcroft-garden-designer' ) );
		}

		// Count matching releases.
		$matching = 0;
		$latest   = '';
		foreach ( $body as $release ) {
			if ( ! empty( $release['draft'] ) || ! empty( $release['prerelease'] ) ) {
				continue;
			}
			$tag = isset( $release['tag_name'] ) ? $release['tag_name'] : '';
			if ( 0 !== strpos( $tag, $this->tag_prefix ) ) {
				continue;
			}
			$matching++;
			$v = ltrim( substr( $tag, strlen( $this->tag_prefix ) ), 'v' );
			if ( '' === $latest || version_compare( $v, $latest, '>' ) ) {
				$latest = $v;
			}
		}

		if ( 0 === $matching ) {
			return array( 'ok' => false, 'message' => sprintf(
				/* translators: %s tag prefix */ __( 'Connected to GitHub, but found no releases tagged "%s…". Check the tag prefix.', 'hillcroft-garden-designer' ),
				$this->tag_prefix
			) );
		}

		// Clear any stale cached miss so the Updates screen re-checks.
		delete_transient( $this->cache_key );

		return array( 'ok' => true, 'message' => sprintf(
			/* translators: 1: count, 2: latest version, 3: installed version */ __( 'Connected. Found %1$d releases; latest is %2$s (you have %3$s). Go to Dashboard → Updates → Check again to pull it in.', 'hillcroft-garden-designer' ),
			$matching,
			$latest,
			$this->version
		) );
	}

	// -------------------------------------------------------------------------

	private function request_args( $accept ) {
		return array(
			'timeout'   => 20,
			'headers'   => array(
				'Authorization'        => 'Bearer ' . $this->token,
				'Accept'               => $accept,
				'X-GitHub-Api-Version' => '2022-11-28',
				'User-Agent'           => 'Hillcroft-Garden-Designer-Updater',
			),
		);
	}
}
