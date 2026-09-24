<?php
declare(strict_types=1);

namespace OE\Connectors;

use OE\Settings;
use OE\Crypto;
use OE\Logger;

defined('ABSPATH') || exit;

/**
 * Meta (Facebook Page + Instagram Business) publishing via the Graph API.
 *
 * Inert until an admin sets the app id/secret (Settings → Social publishing) and
 * completes the OAuth connect, which resolves and stores the Page + Instagram
 * account and a long-lived Page token. Publishing an image is a two-step
 * container→publish for Instagram and a single photo post for the Page.
 *
 * Go-live needs a Meta app with an Instagram Business account linked to a
 * Facebook Page, and App Review for pages_manage_posts + instagram_content_publish.
 */
final class MetaConnector {

    private const GRAPH   = 'https://graph.facebook.com';
    private const VERSION = 'v21.0';
    private const OPTION  = 'oe_social_meta'; // resolved connection (page/ig/token)

    public static function api_version(): string {
        return (string) apply_filters('oe_meta_api_version', self::VERSION);
    }

    /** App configured (id + secret present). */
    public static function configured(): bool {
        return (string) Settings::get('meta_app_id', '') !== ''
            && (string) Settings::get('meta_app_secret', '') !== '';
    }

    /** Connected and ready to publish (a Page token + Page id resolved). */
    public static function is_ready(): bool {
        $c = self::connection();
        return $c['page_id'] !== '' && $c['page_token'] !== '';
    }

    /** @return array{page_id:string,page_name:string,ig_user_id:string,page_token:string,connected_at:int} */
    public static function connection(): array {
        $raw = get_option(self::OPTION);
        $raw = is_array($raw) ? $raw : [];
        return [
            'page_id'      => (string) ($raw['page_id'] ?? ''),
            'page_name'    => (string) ($raw['page_name'] ?? ''),
            'ig_user_id'   => (string) ($raw['ig_user_id'] ?? ''),
            'page_token'   => isset($raw['page_token']) ? Crypto::decrypt((string) $raw['page_token']) : '',
            'connected_at' => (int) ($raw['connected_at'] ?? 0),
        ];
    }

    public static function disconnect(): void {
        delete_option(self::OPTION);
    }

    /* ---- OAuth ---- */

    /** The Facebook login URL to start the connect (redirect_uri must be registered in the app). */
    public static function oauth_url(string $redirect_uri, string $state): string {
        return 'https://www.facebook.com/' . self::api_version() . '/dialog/oauth?' . http_build_query([
            'client_id'     => (string) Settings::get('meta_app_id', ''),
            'redirect_uri'  => $redirect_uri,
            'state'         => $state,
            'response_type' => 'code',
            'scope'         => 'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,business_management',
        ]);
    }

    /**
     * Exchange an OAuth code for a long-lived Page token and resolve the linked
     * Instagram account, storing the connection. Returns an error string, or ''.
     */
    public static function complete_oauth(string $code, string $redirect_uri): string {
        if (! self::configured()) {
            return 'app_not_configured';
        }
        $app_id     = (string) Settings::get('meta_app_id', '');
        $app_secret = (string) Settings::get('meta_app_secret', '');

        // Code → short-lived user token.
        $short = self::get(self::api_version() . '/oauth/access_token', [
            'client_id'     => $app_id,
            'client_secret' => $app_secret,
            'redirect_uri'  => $redirect_uri,
            'code'          => $code,
        ]);
        $user_token = (string) ($short['access_token'] ?? '');
        if ($user_token === '') {
            return self::err($short, 'no_user_token');
        }
        // Short → long-lived user token.
        $long = self::get(self::api_version() . '/oauth/access_token', [
            'grant_type'        => 'fb_exchange_token',
            'client_id'         => $app_id,
            'client_secret'     => $app_secret,
            'fb_exchange_token' => $user_token,
        ]);
        $user_token = (string) ($long['access_token'] ?? $user_token);

        // First Page the user manages → its (long-lived) Page token.
        $pages = self::get(self::api_version() . '/me/accounts', ['access_token' => $user_token, 'limit' => 50]);
        $page  = is_array($pages['data'][0] ?? null) ? $pages['data'][0] : [];
        $page_id    = (string) ($page['id'] ?? '');
        $page_token = (string) ($page['access_token'] ?? '');
        if ($page_id === '' || $page_token === '') {
            return self::err($pages, 'no_page');
        }
        // The Instagram Business account linked to the Page (optional).
        $igq = self::get(self::api_version() . '/' . rawurlencode($page_id), [
            'fields'       => 'instagram_business_account,name',
            'access_token' => $page_token,
        ]);
        update_option(self::OPTION, [
            'page_id'      => $page_id,
            'page_name'    => (string) ($igq['name'] ?? ($page['name'] ?? '')),
            'ig_user_id'   => (string) ($igq['instagram_business_account']['id'] ?? ''),
            'page_token'   => Crypto::encrypt($page_token),
            'connected_at' => time(),
        ], false);
        return '';
    }

    /* ---- publish ---- */

    /**
     * Publish an image + caption to Instagram (if linked) and/or the Facebook Page.
     *
     * @param array<int,string> $targets any of 'instagram','facebook'
     * @return array<string,array{ok:bool,permalink:string,error:string}>
     */
    public static function publish_image(string $image_url, string $caption, array $targets): array {
        $out = [];
        $c   = self::connection();
        foreach ($targets as $t) {
            if ($t === 'instagram') {
                $out['instagram'] = $c['ig_user_id'] !== ''
                    ? self::publish_instagram($c, $image_url, $caption)
                    : ['ok' => false, 'permalink' => '', 'error' => 'no_instagram_account'];
            } elseif ($t === 'facebook') {
                $out['facebook'] = self::publish_facebook($c, $image_url, $caption);
            }
        }
        return $out;
    }

    /** @return array{ok:bool,permalink:string,error:string} */
    private static function publish_instagram(array $c, string $image_url, string $caption): array {
        // 1) create a media container, 2) publish it.
        $cont = self::post(self::api_version() . '/' . rawurlencode($c['ig_user_id']) . '/media', [
            'image_url'    => $image_url,
            'caption'      => $caption,
            'access_token' => $c['page_token'],
        ]);
        $creation_id = (string) ($cont['id'] ?? '');
        if ($creation_id === '') {
            return ['ok' => false, 'permalink' => '', 'error' => self::err($cont, 'container_failed')];
        }
        // Meta ingests the image_url asynchronously; publishing before the
        // container is FINISHED errors. Poll its status a few times first.
        for ($i = 0; $i < 6; $i++) {
            $s = self::get(self::api_version() . '/' . rawurlencode($creation_id), ['fields' => 'status_code', 'access_token' => $c['page_token']]);
            $code = (string) ($s['status_code'] ?? '');
            if ($code === 'FINISHED') {
                break;
            }
            if ($code === 'ERROR') {
                return ['ok' => false, 'permalink' => '', 'error' => 'container_error'];
            }
            sleep(2);
        }
        $pub = self::post(self::api_version() . '/' . rawurlencode($c['ig_user_id']) . '/media_publish', [
            'creation_id'  => $creation_id,
            'access_token' => $c['page_token'],
        ]);
        $media_id = (string) ($pub['id'] ?? '');
        if ($media_id === '') {
            return ['ok' => false, 'permalink' => '', 'error' => self::err($pub, 'publish_failed')];
        }
        $perm = self::get(self::api_version() . '/' . rawurlencode($media_id), ['fields' => 'permalink', 'access_token' => $c['page_token']]);
        return ['ok' => true, 'permalink' => (string) ($perm['permalink'] ?? ''), 'error' => ''];
    }

    /** @return array{ok:bool,permalink:string,error:string} */
    private static function publish_facebook(array $c, string $image_url, string $caption): array {
        $res = self::post(self::api_version() . '/' . rawurlencode($c['page_id']) . '/photos', [
            'url'          => $image_url,
            'caption'      => $caption,
            'access_token' => $c['page_token'],
        ]);
        $id = (string) ($res['post_id'] ?? ($res['id'] ?? ''));
        if ($id === '') {
            return ['ok' => false, 'permalink' => '', 'error' => self::err($res, 'fb_publish_failed')];
        }
        return ['ok' => true, 'permalink' => 'https://www.facebook.com/' . $id, 'error' => ''];
    }

    /* ---- transport ---- */

    private static function get(string $path, array $params): array {
        $url = self::GRAPH . '/' . ltrim($path, '/') . '?' . http_build_query($params);
        return self::decode(wp_remote_get($url, ['timeout' => 30]));
    }

    private static function post(string $path, array $params): array {
        $url = self::GRAPH . '/' . ltrim($path, '/');
        return self::decode(wp_remote_post($url, ['timeout' => 45, 'body' => $params]));
    }

    private static function decode($response): array {
        if (is_wp_error($response)) {
            Logger::log('Meta API transport error', ['error' => $response->get_error_message()]);
            return ['error' => ['message' => $response->get_error_message()]];
        }
        $data = json_decode((string) wp_remote_retrieve_body($response), true);
        return is_array($data) ? $data : [];
    }

    private static function err(array $res, string $fallback): string {
        $msg = (string) ($res['error']['message'] ?? '');
        return $msg !== '' ? $msg : $fallback;
    }
}
