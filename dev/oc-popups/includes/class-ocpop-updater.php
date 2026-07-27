<?php
/**
 * Self-updater for a plugin distributed from a PRIVATE GitHub repo.
 *
 * Reads releases via the GitHub API (authenticated with a stored fine-grained
 * token), considers only releases whose tag starts with the configured prefix
 * (e.g. "ocpop-v") so other apps in the same monorepo don't interfere, and
 * surfaces the newest version on the WordPress "Updates" screen. Downloads the
 * attached .zip with the right auth headers, handling GitHub's redirect to
 * signed storage (where the auth header must NOT be forwarded).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCPOP_Updater {

	private $basename;
	private $slug;
	private $version;
	private $repo;
	private $token;
	private $tag_prefix;
	private $cache_key;

	public function __construct( $basename, $version, $repo, $token, $tag_prefix = 'ocpop-v' ) {
		$this->basename   = $basename;
		$this->slug       = dirname( $basename );
		$this->version    = $version;
		$this->repo       = trim( $repo, '/ ' );
		$this->token      = $token;
		$this->tag_prefix = $tag_prefix;
		$this->cache_key  = 'ocpop_updater_' . md5( $this->repo . '|' . $this->tag_prefix );

		add_filter( 'pre_set_site_transient_update_plugins', array( $this, 'check_for_update' ) );
		add_filter( 'plugins_api', array( $this, 'plugin_info' ), 20, 3 );
		add_filter( 'upgrader_pre_download', array( $this, 'download_private_asset' ), 10, 3 );
		add_action( 'upgrader_process_complete', array( $this, 'flush_cache' ), 10, 0 );
	}

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

		if ( $best ) {
			set_transient( $this->cache_key, $best, 20 * MINUTE_IN_SECONDS );
		} else {
			set_transient( $this->cache_key, '', 15 * MINUTE_IN_SECONDS );
		}
		return $best;
	}

	private function find_zip_asset( array $release ) {
		if ( empty( $release['assets'] ) || ! is_array( $release['assets'] ) ) {
			return null;
		}
		foreach ( $release['assets'] as $asset ) {
			if ( isset( $asset['name'], $asset['url'] ) && substr( $asset['name'], -4 ) === '.zip' ) {
				return $asset['url'];
			}
		}
		return null;
	}

	public function check_for_update( $transient ) {
		if ( empty( $transient->checked ) ) {
			return $transient;
		}

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
				'package'     => 'ocpop-private:' . $release['zip'],
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
			'name'          => 'October Popups',
			'slug'          => $this->slug,
			'version'       => $release['version'],
			'author'        => '<a href="https://octobercomms.com">October Comms</a>',
			'homepage'      => 'https://octobercomms.com',
			'download_link' => 'ocpop-private:' . $release['zip'],
			'last_updated'  => $release['published'],
			'sections'      => array(
				'changelog' => wpautop( esc_html( $release['changelog'] ) ),
			),
		);
	}

	public function download_private_asset( $reply, $package, $upgrader = null ) {
		if ( ! is_string( $package ) || 0 !== strpos( $package, 'ocpop-private:' ) ) {
			return $reply;
		}
		$asset_url = substr( $package, strlen( 'ocpop-private:' ) );

		$args                = $this->request_args( 'application/octet-stream' );
		$args['redirection'] = 0;
		$head                = wp_remote_get( $asset_url, $args );

		if ( is_wp_error( $head ) ) {
			return $head;
		}

		$code     = (int) wp_remote_retrieve_response_code( $head );
		$location = wp_remote_retrieve_header( $head, 'location' );

		if ( ( 301 === $code || 302 === $code || 307 === $code ) && $location ) {
			$tmp = download_url( $location );
		} elseif ( 200 === $code ) {
			$tmp  = wp_tempnam( 'ocpop-update.zip' );
			$body = wp_remote_retrieve_body( $head );
			if ( ! $tmp || ! $body || false === file_put_contents( $tmp, $body ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions
				return new WP_Error( 'ocpop_download_failed', __( 'Could not save the update package.', 'october-popups' ) );
			}
		} else {
			return new WP_Error( 'ocpop_download_failed', sprintf(
				/* translators: %d: HTTP status code */
				__( 'GitHub returned status %d when downloading the update.', 'october-popups' ),
				$code
			) );
		}

		return $tmp;
	}

	public function flush_cache() {
		delete_transient( $this->cache_key );
	}

	public function diagnose() {
		if ( '' === trim( (string) $this->token ) ) {
			return array( 'ok' => false, 'message' => __( 'No GitHub token saved. Paste a fine-grained token with Contents: read on this repo.', 'october-popups' ) );
		}

		$response = wp_remote_get(
			"https://api.github.com/repos/{$this->repo}/releases?per_page=30",
			$this->request_args( 'application/vnd.github+json' )
		);

		if ( is_wp_error( $response ) ) {
			return array( 'ok' => false, 'message' => sprintf(
				/* translators: %s error */ __( 'Could not reach GitHub: %s', 'october-popups' ),
				$response->get_error_message()
			) );
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		$body = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( 200 !== $code ) {
			$api_msg = is_array( $body ) && isset( $body['message'] ) ? $body['message'] : '';
			$hint    = '';
			if ( 401 === $code ) {
				$hint = __( 'The token is invalid or expired.', 'october-popups' );
			} elseif ( 403 === $code ) {
				$hint = __( 'Access forbidden — the org may require approval for fine-grained tokens, or the token lacks Contents: read.', 'october-popups' );
			} elseif ( 404 === $code ) {
				$hint = __( 'Repo not found for this token — check the repository name and that the token is scoped to it.', 'october-popups' );
			}
			return array( 'ok' => false, 'message' => sprintf(
				/* translators: 1: HTTP code, 2: github message, 3: hint */ __( 'GitHub returned HTTP %1$d (%2$s). %3$s', 'october-popups' ),
				$code,
				$api_msg ? $api_msg : '—',
				$hint
			) );
		}

		if ( ! is_array( $body ) ) {
			return array( 'ok' => false, 'message' => __( 'GitHub returned an unexpected response.', 'october-popups' ) );
		}

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
				/* translators: %s tag prefix */ __( 'Connected to GitHub, but found no releases tagged "%s…".', 'october-popups' ),
				$this->tag_prefix
			) );
		}

		delete_transient( $this->cache_key );

		return array( 'ok' => true, 'message' => sprintf(
			/* translators: 1: count, 2: latest version, 3: installed version */ __( 'Connected. Found %1$d releases; latest is %2$s (you have %3$s). Go to Dashboard → Updates → Check again to pull it in.', 'october-popups' ),
			$matching,
			$latest,
			$this->version
		) );
	}

	private function request_args( $accept ) {
		return array(
			'timeout' => 20,
			'headers' => array(
				'Authorization'        => 'Bearer ' . $this->token,
				'Accept'               => $accept,
				'X-GitHub-Api-Version' => '2022-11-28',
				'User-Agent'           => 'October-Popups-Updater',
			),
		);
	}
}
