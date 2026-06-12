<?php
declare(strict_types=1);

namespace OE\Mail;

defined('ABSPATH') || exit;

/**
 * Campaigns REST API (oe/v1/campaigns) — what the platform's email builder reads
 * and writes. Auth: an authenticated user who can edit.
 */
final class CampaignsRest {

    private const NS = 'oe/v1';

    public static function init(): void {
        add_action('rest_api_init', [self::class, 'register_routes']);
    }

    public static function can(): bool {
        return current_user_can('edit_posts');
    }

    public static function register_routes(): void {
        $auth = [self::class, 'can'];
        register_rest_route(self::NS, '/campaigns', [
            ['methods' => 'GET',  'callback' => [self::class, 'list_campaigns'], 'permission_callback' => $auth],
            ['methods' => 'POST', 'callback' => [self::class, 'create'],         'permission_callback' => $auth],
        ]);
        register_rest_route(self::NS, '/campaigns/(?P<id>\d+)', [
            ['methods' => 'GET',    'callback' => [self::class, 'get_one'], 'permission_callback' => $auth],
            ['methods' => 'POST',   'callback' => [self::class, 'update'],  'permission_callback' => $auth],
            ['methods' => 'DELETE', 'callback' => [self::class, 'remove'],  'permission_callback' => $auth],
        ]);
        register_rest_route(self::NS, '/campaigns/(?P<id>\d+)/test', [
            'methods' => 'POST', 'callback' => [self::class, 'test'], 'permission_callback' => $auth,
        ]);
        register_rest_route(self::NS, '/campaigns/(?P<id>\d+)/send', [
            'methods' => 'POST', 'callback' => [self::class, 'send'], 'permission_callback' => $auth,
        ]);
        register_rest_route(self::NS, '/audiences', [
            'methods' => 'GET', 'callback' => [self::class, 'audiences'], 'permission_callback' => $auth,
        ]);
    }

    public static function list_campaigns(\WP_REST_Request $req): \WP_REST_Response {
        return new \WP_REST_Response(array_map([Campaigns::class, 'dto'], Campaigns::all()), 200);
    }

    public static function get_one(\WP_REST_Request $req): \WP_REST_Response {
        $c = Campaigns::get((int) $req['id']);
        return $c
            ? new \WP_REST_Response(Campaigns::dto($c), 200)
            : new \WP_REST_Response(['error' => 'not_found'], 404);
    }

    public static function create(\WP_REST_Request $req): \WP_REST_Response {
        $id = Campaigns::save(self::payload($req));
        return new \WP_REST_Response(Campaigns::dto(Campaigns::get($id)), 201);
    }

    public static function update(\WP_REST_Request $req): \WP_REST_Response {
        $id = (int) $req['id'];
        if (! Campaigns::get($id)) {
            return new \WP_REST_Response(['error' => 'not_found'], 404);
        }
        Campaigns::save(self::payload($req), $id);
        return new \WP_REST_Response(Campaigns::dto(Campaigns::get($id)), 200);
    }

    public static function remove(\WP_REST_Request $req): \WP_REST_Response {
        Campaigns::delete((int) $req['id']);
        return new \WP_REST_Response(['ok' => true], 200);
    }

    public static function test(\WP_REST_Request $req): \WP_REST_Response {
        $ok = Campaigns::send_test((int) $req['id'], sanitize_email((string) $req->get_param('email')));
        return new \WP_REST_Response(['ok' => $ok], $ok ? 200 : 400);
    }

    public static function send(\WP_REST_Request $req): \WP_REST_Response {
        $id = (int) $req['id'];
        if (! Campaigns::get($id)) {
            return new \WP_REST_Response(['error' => 'not_found'], 404);
        }
        $queued = Campaigns::send($id);
        return new \WP_REST_Response(['ok' => true, 'queued' => $queued, 'campaign' => Campaigns::dto(Campaigns::get($id))], 200);
    }

    public static function audiences(\WP_REST_Request $req): \WP_REST_Response {
        return new \WP_REST_Response(Campaigns::audiences(), 200);
    }

    /** @return array<string,mixed> */
    private static function payload(\WP_REST_Request $req): array {
        return [
            'name'         => $req->get_param('name'),
            'subject'      => $req->get_param('subject'),
            'preheader'    => $req->get_param('preheader'),
            'body_html'    => $req->get_param('body_html'),
            'body_json'    => $req->get_param('body_json'),
            'audience'     => $req->get_param('audience'),
            'scheduled_at' => $req->get_param('scheduled_at'),
        ];
    }
}
