<?php
declare(strict_types=1);

namespace ADF;

defined('ABSPATH') || exit;

/**
 * Self-updater: watches GitHub Releases and offers updates inside WordPress's
 * normal "Updates" screen (one-click install).
 *
 * Mirrors the proven Hillcroft Garden Designer updater. Because this lives in a
 * PRIVATE monorepo it authenticates with a stored fine-grained token (Contents:
 * read) and handles GitHub's redirect to signed storage when downloading the
 * release asset. Only releases tagged with the configured prefix (`adf-v`) are
 * considered, so other apps in the same repo never interfere.
 *
 * The release zip is built by .github/workflows/adf-festival-release.yml, which
 * runs `composer install --no-dev` so the bundled `vendor/` (Stripe SDK) ships
 * inside the package — sites updating this way never run Composer themselves.
 */
final class Updater {

    private string $basename;   // adf-festival-plugin/adf-festival-plugin.php
    private string $slug;       // adf-festival-plugin
    private string $version;
    private string $repo;       // owner/repo
    private string $token;
    private string $tag_prefix; // adf-v
    private string $cache_key;

    public function __construct(string $basename, string $version, string $repo, string $token, string $tag_prefix = 'adf-v') {
        $this->basename   = $basename;
        $this->slug       = dirname($basename);
        $this->version    = $version;
        $this->repo       = trim($repo, '/ ');
        $this->token      = $token;
        $this->tag_prefix = $tag_prefix;
        $this->cache_key  = 'adf_updater_' . md5($this->repo . '|' . $this->tag_prefix);
    }

    public function init(): void {
        add_filter('pre_set_site_transient_update_plugins', [$this, 'check_for_update']);
        add_filter('plugins_api', [$this, 'plugin_info'], 20, 3);
        add_filter('upgrader_pre_download', [$this, 'download_private_asset'], 10, 3);
        add_action('upgrader_process_complete', [$this, 'flush_cache'], 10, 0);
    }

    /* ------------------------------------------------------------------ *
     * Release lookup
     * ------------------------------------------------------------------ */

    /**
     * @return array{version:string,zip:string,changelog:string,published:string,html:string}|null
     */
    private function latest_release(): ?array {
        if ($this->token === '') {
            return null;
        }
        $cached = get_transient($this->cache_key);
        if (false !== $cached) {
            return $cached ?: null;
        }

        $response = wp_remote_get(
            "https://api.github.com/repos/{$this->repo}/releases?per_page=30",
            $this->request_args('application/vnd.github+json')
        );
        if (is_wp_error($response) || 200 !== (int) wp_remote_retrieve_response_code($response)) {
            set_transient($this->cache_key, '', 10 * MINUTE_IN_SECONDS);
            return null;
        }

        $releases = json_decode((string) wp_remote_retrieve_body($response), true);
        if (! is_array($releases)) {
            set_transient($this->cache_key, '', 10 * MINUTE_IN_SECONDS);
            return null;
        }

        $best = null;
        foreach ($releases as $release) {
            if (! empty($release['draft']) || ! empty($release['prerelease'])) {
                continue;
            }
            $tag = isset($release['tag_name']) ? (string) $release['tag_name'] : '';
            if (0 !== strpos($tag, $this->tag_prefix)) {
                continue;
            }
            $version = ltrim(substr($tag, strlen($this->tag_prefix)), 'v');
            if ('' === $version) {
                continue;
            }
            if (null === $best || version_compare($version, $best['version'], '>')) {
                $zip = $this->find_zip_asset($release);
                if ($zip) {
                    $best = [
                        'version'   => $version,
                        'zip'       => $zip,
                        'changelog' => (string) ($release['body'] ?? ''),
                        'published' => (string) ($release['published_at'] ?? ''),
                        'html'      => (string) ($release['html_url'] ?? ''),
                    ];
                }
            }
        }

        if ($best) {
            set_transient($this->cache_key, $best, 3 * HOUR_IN_SECONDS);
        } else {
            set_transient($this->cache_key, '', 15 * MINUTE_IN_SECONDS);
        }
        return $best;
    }

    private function find_zip_asset(array $release): ?string {
        if (empty($release['assets']) || ! is_array($release['assets'])) {
            return null;
        }
        foreach ($release['assets'] as $asset) {
            if (isset($asset['name'], $asset['url']) && substr((string) $asset['name'], -4) === '.zip') {
                return (string) $asset['url'];
            }
        }
        return null;
    }

    /* ------------------------------------------------------------------ *
     * WordPress update plumbing
     * ------------------------------------------------------------------ */

    public function check_for_update($transient) {
        if (empty($transient->checked)) {
            return $transient;
        }
        if (! empty($_GET['force-check'])) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
            delete_transient($this->cache_key);
        }

        $release = $this->latest_release();
        if ($release && version_compare($release['version'], $this->version, '>')) {
            $transient->response[$this->basename] = (object) [
                'slug'        => $this->slug,
                'plugin'      => $this->basename,
                'new_version' => $release['version'],
                'url'         => $release['html'],
                // Sentinel package — swapped for the signed binary URL in
                // download_private_asset() so auth headers attach correctly.
                'package'     => 'adf-private:' . $release['zip'],
            ];
        } else {
            unset($transient->response[$this->basename]);
        }
        return $transient;
    }

    public function plugin_info($result, $action, $args) {
        if ('plugin_information' !== $action || empty($args->slug) || $args->slug !== $this->slug) {
            return $result;
        }
        $release = $this->latest_release();
        if (! $release) {
            return $result;
        }
        return (object) [
            'name'          => 'ADF Festival',
            'slug'          => $this->slug,
            'version'       => $release['version'],
            'author'        => '<a href="https://octobercomms.com">October Comms</a>',
            'homepage'      => 'https://atlantadesignfestival.net',
            'download_link' => 'adf-private:' . $release['zip'],
            'last_updated'  => $release['published'],
            'sections'      => ['changelog' => wpautop(esc_html($release['changelog']))],
        ];
    }

    /**
     * Fetch the private release asset with auth, following GitHub's redirect to
     * signed storage without forwarding the auth header.
     */
    public function download_private_asset($reply, $package, $upgrader = null) {
        if (! is_string($package) || 0 !== strpos($package, 'adf-private:')) {
            return $reply;
        }
        $asset_url = substr($package, strlen('adf-private:'));

        $args                = $this->request_args('application/octet-stream');
        $args['redirection'] = 0;
        $head                = wp_remote_get($asset_url, $args);
        if (is_wp_error($head)) {
            return $head;
        }

        $code     = (int) wp_remote_retrieve_response_code($head);
        $location = wp_remote_retrieve_header($head, 'location');

        if (($code === 301 || $code === 302 || $code === 307) && $location) {
            return download_url($location);
        }
        if ($code === 200) {
            $tmp  = wp_tempnam('adf-update.zip');
            $body = wp_remote_retrieve_body($head);
            if (! $tmp || ! $body || false === file_put_contents($tmp, $body)) { // phpcs:ignore WordPress.WP.AlternativeFunctions
                return new \WP_Error('adf_download_failed', __('Could not save the update package.', 'adf-festival'));
            }
            return $tmp;
        }
        return new \WP_Error('adf_download_failed', sprintf(
            /* translators: %d: HTTP status code */
            __('GitHub returned status %d when downloading the update.', 'adf-festival'),
            $code
        ));
    }

    public function flush_cache(): void {
        delete_transient($this->cache_key);
    }

    /**
     * Diagnose the connection for the Settings screen — turns silent failures
     * (bad token, org approval, no matching release) into a clear message.
     *
     * @return array{ok:bool,message:string}
     */
    public function diagnose(): array {
        if (trim($this->token) === '') {
            return ['ok' => false, 'message' => __('No GitHub token saved. Add a fine-grained token with Contents: read on this repo (or define ADF_GITHUB_TOKEN).', 'adf-festival')];
        }
        $response = wp_remote_get(
            "https://api.github.com/repos/{$this->repo}/releases?per_page=30",
            $this->request_args('application/vnd.github+json')
        );
        if (is_wp_error($response)) {
            return ['ok' => false, 'message' => sprintf(/* translators: %s: error */ __('Could not reach GitHub: %s', 'adf-festival'), $response->get_error_message())];
        }
        $code = (int) wp_remote_retrieve_response_code($response);
        $body = json_decode((string) wp_remote_retrieve_body($response), true);
        if (200 !== $code) {
            $api_msg = is_array($body) && isset($body['message']) ? $body['message'] : '—';
            $hint = $code === 401 ? __('The token is invalid or expired.', 'adf-festival')
                : ($code === 403 ? __('Forbidden — the org may require approval for fine-grained tokens, or the token lacks Contents: read.', 'adf-festival')
                : ($code === 404 ? __('Repo not found for this token — check the name and that it is scoped to octobercomms.', 'adf-festival') : ''));
            return ['ok' => false, 'message' => sprintf(/* translators: 1: code 2: msg 3: hint */ __('GitHub returned HTTP %1$d (%2$s). %3$s', 'adf-festival'), $code, $api_msg, $hint)];
        }
        if (! is_array($body)) {
            return ['ok' => false, 'message' => __('GitHub returned an unexpected response.', 'adf-festival')];
        }

        $matching = 0; $latest = '';
        foreach ($body as $release) {
            if (! empty($release['draft']) || ! empty($release['prerelease'])) {
                continue;
            }
            $tag = (string) ($release['tag_name'] ?? '');
            if (0 !== strpos($tag, $this->tag_prefix)) {
                continue;
            }
            $matching++;
            $v = ltrim(substr($tag, strlen($this->tag_prefix)), 'v');
            if ('' === $latest || version_compare($v, $latest, '>')) {
                $latest = $v;
            }
        }
        if (0 === $matching) {
            return ['ok' => false, 'message' => sprintf(/* translators: %s: prefix */ __('Connected, but found no releases tagged "%s…".', 'adf-festival'), $this->tag_prefix)];
        }
        delete_transient($this->cache_key);
        return ['ok' => true, 'message' => sprintf(/* translators: 1: count 2: latest 3: installed */ __('Connected. Found %1$d release(s); latest is %2$s (you have %3$s). Dashboard → Updates → Check again to pull it in.', 'adf-festival'), $matching, $latest, $this->version)];
    }

    private function request_args(string $accept): array {
        return [
            'timeout' => 20,
            'headers' => [
                'Authorization'        => 'Bearer ' . $this->token,
                'Accept'               => $accept,
                'X-GitHub-Api-Version' => '2022-11-28',
                'User-Agent'           => 'ADF-Festival-Updater',
            ],
        ];
    }

    /**
     * Resolve the token from a constant first, then settings.
     */
    public static function token(): string {
        if (defined('ADF_GITHUB_TOKEN') && ADF_GITHUB_TOKEN) {
            return (string) ADF_GITHUB_TOKEN;
        }
        return (string) (Settings::all()['github_token'] ?? '');
    }

    public static function repo(): string {
        return (string) (Settings::all()['github_repo'] ?? 'octobercomms/claude');
    }
}
