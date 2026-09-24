<?php
declare(strict_types=1);

namespace OE\Connectors;

use OE\Settings;
use OE\Crypto;
use OE\Logger;

defined('ABSPATH') || exit;

/**
 * LinkedIn organization publishing via the Posts API.
 *
 * Inert until an admin sets the client id/secret + organization URN (Settings →
 * Social publishing) and completes the OAuth connect, which stores an access
 * token. Publishing an image is initialize-upload → PUT the bytes → create post.
 *
 * Go-live needs a LinkedIn app with the Community Management API product and App
 * Review for w_organization_social, plus admin rights on the organization page.
 */
final class LinkedInConnector {

    private const AUTH   = 'https://www.linkedin.com/oauth/v2';
    private const API    = 'https://api.linkedin.com';
    private const OPTION = 'oe_social_linkedin';

    public static function api_version(): string {
        return (string) apply_filters('oe_linkedin_api_version', '202401');
    }

    public static function configured(): bool {
        return (string) Settings::get('linkedin_client_id', '') !== ''
            && (string) Settings::get('linkedin_client_secret', '') !== ''
            && (string) Settings::get('linkedin_org_urn', '') !== '';
    }

    public static function is_ready(): bool {
        return self::configured() && self::token() !== '';
    }

    /** The organization URN to post as, e.g. urn:li:organization:12345. */
    public static function org_urn(): string {
        $v = trim((string) Settings::get('linkedin_org_urn', ''));
        if ($v !== '' && strpos($v, 'urn:li:organization:') !== 0 && ctype_digit($v)) {
            $v = 'urn:li:organization:' . $v; // allow a bare id
        }
        return $v;
    }

    public static function token(): string {
        $raw = get_option(self::OPTION);
        return is_array($raw) && isset($raw['token']) ? Crypto::decrypt((string) $raw['token']) : '';
    }

    public static function connected_at(): int {
        $raw = get_option(self::OPTION);
        return is_array($raw) ? (int) ($raw['connected_at'] ?? 0) : 0;
    }

    public static function disconnect(): void {
        delete_option(self::OPTION);
    }

    /* ---- OAuth ---- */

    public static function oauth_url(string $redirect_uri, string $state): string {
        return self::AUTH . '/authorization?' . http_build_query([
            'response_type' => 'code',
            'client_id'     => (string) Settings::get('linkedin_client_id', ''),
            'redirect_uri'  => $redirect_uri,
            'state'         => $state,
            'scope'         => 'w_organization_social r_organization_social',
        ]);
    }

    public static function complete_oauth(string $code, string $redirect_uri): string {
        $res = self::decode(wp_remote_post(self::AUTH . '/accessToken', [
            'timeout' => 30,
            'headers' => ['Content-Type' => 'application/x-www-form-urlencoded'],
            'body'    => [
                'grant_type'    => 'authorization_code',
                'code'          => $code,
                'redirect_uri'  => $redirect_uri,
                'client_id'     => (string) Settings::get('linkedin_client_id', ''),
                'client_secret' => (string) Settings::get('linkedin_client_secret', ''),
            ],
        ]));
        $token = (string) ($res['access_token'] ?? '');
        if ($token === '') {
            return (string) ($res['error_description'] ?? ($res['error'] ?? 'no_token'));
        }
        update_option(self::OPTION, [
            'token'        => Crypto::encrypt($token),
            'expires_in'   => (int) ($res['expires_in'] ?? 0),
            'connected_at' => time(),
        ], false);
        return '';
    }

    /* ---- publish ---- */

    /** @return array{ok:bool,permalink:string,error:string} */
    public static function publish_image(string $image_url, string $caption): array {
        $token = self::token();
        $owner = self::org_urn();
        if ($token === '' || $owner === '') {
            return ['ok' => false, 'permalink' => '', 'error' => 'not_connected'];
        }
        // 1) initialize an image upload for the organization.
        $init = self::decode(wp_remote_post(self::API . '/rest/images?action=initializeUpload', [
            'timeout' => 30,
            'headers' => self::headers($token, true),
            'body'    => wp_json_encode(['initializeUploadRequest' => ['owner' => $owner]]),
        ]));
        $value      = is_array($init['value'] ?? null) ? $init['value'] : [];
        $upload_url = (string) ($value['uploadUrl'] ?? '');
        $image_urn  = (string) ($value['image'] ?? '');
        if ($upload_url === '' || $image_urn === '') {
            return ['ok' => false, 'permalink' => '', 'error' => self::err($init, 'init_upload_failed')];
        }
        // 2) fetch the source bytes and PUT them to the upload URL.
        $bytes = wp_remote_retrieve_body(wp_remote_get($image_url, ['timeout' => 30]));
        if ($bytes === '') {
            return ['ok' => false, 'permalink' => '', 'error' => 'image_fetch_failed'];
        }
        $put = wp_remote_request($upload_url, [
            'method'  => 'PUT',
            'timeout' => 45,
            'headers' => ['Authorization' => 'Bearer ' . $token],
            'body'    => $bytes,
        ]);
        if (is_wp_error($put) || (int) wp_remote_retrieve_response_code($put) >= 300) {
            return ['ok' => false, 'permalink' => '', 'error' => 'image_upload_failed'];
        }
        // 3) create the post referencing the uploaded image.
        $resp = wp_remote_post(self::API . '/rest/posts', [
            'timeout' => 30,
            'headers' => self::headers($token, true),
            'body'    => wp_json_encode([
                'author'          => $owner,
                'commentary'      => $caption,
                'visibility'      => 'PUBLIC',
                'distribution'    => ['feedDistribution' => 'MAIN_FEED', 'targetEntities' => [], 'thirdPartyDistributionChannels' => []],
                'content'         => ['media' => ['id' => $image_urn]],
                'lifecycleState'  => 'PUBLISHED',
                'isReshareDisabledByAuthor' => false,
            ]),
        ]);
        $post = self::decode($resp);
        // The created post URN comes back in the x-restli-id header (a 201 with an
        // empty body), falling back to the body for older API shapes.
        $urn = is_wp_error($resp) ? '' : (string) wp_remote_retrieve_header($resp, 'x-restli-id');
        if ($urn === '') {
            $urn = (string) ($post['id'] ?? '');
        }
        if ($urn === '') {
            return ['ok' => false, 'permalink' => '', 'error' => self::err($post, 'post_failed')];
        }
        return ['ok' => true, 'permalink' => 'https://www.linkedin.com/feed/update/' . $urn, 'error' => ''];
    }

    /* ---- transport ---- */

    private static function headers(string $token, bool $json): array {
        $h = [
            'Authorization'             => 'Bearer ' . $token,
            'LinkedIn-Version'          => self::api_version(),
            'X-Restli-Protocol-Version' => '2.0.0',
        ];
        if ($json) {
            $h['Content-Type'] = 'application/json';
        }
        return $h;
    }

    private static function decode($response): array {
        if (is_wp_error($response)) {
            Logger::log('LinkedIn API transport error', ['error' => $response->get_error_message()]);
            return ['error' => $response->get_error_message()];
        }
        $data = json_decode((string) wp_remote_retrieve_body($response), true);
        return is_array($data) ? $data : [];
    }

    private static function err(array $res, string $fallback): string {
        $msg = (string) ($res['message'] ?? ($res['error'] ?? ''));
        return $msg !== '' ? $msg : $fallback;
    }
}
