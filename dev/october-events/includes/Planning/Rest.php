<?php
declare(strict_types=1);

namespace OE\Planning;

defined('ABSPATH') || exit;

/**
 * Planning REST API (oe/v1) — the data the platform UI reads and writes for the
 * confirm→green event board. Auth: an authenticated user who can edit events.
 */
final class Rest {

    private const NS = 'oe/v1';

    public static function init(): void {
        add_action('rest_api_init', [self::class, 'register_routes']);
    }

    public static function can_edit(): bool {
        return current_user_can('edit_posts');
    }

    public static function register_routes(): void {
        register_rest_route(self::NS, '/planning/events', [
            'methods'             => 'GET',
            'callback'            => [self::class, 'list_events'],
            'permission_callback' => [self::class, 'can_edit'],
        ]);
        register_rest_route(self::NS, '/planning/event/(?P<id>\d+)', [
            [
                'methods'             => 'GET',
                'callback'            => [self::class, 'get_event'],
                'permission_callback' => [self::class, 'can_edit'],
            ],
            [
                'methods'             => 'POST',
                'callback'            => [self::class, 'update_event'],
                'permission_callback' => [self::class, 'can_edit'],
            ],
        ]);
        register_rest_route(self::NS, '/planning/event/(?P<id>\d+)/confirm', [
            'methods'             => 'POST',
            'callback'            => [self::class, 'confirm_event'],
            'permission_callback' => [self::class, 'can_edit'],
        ]);
    }

    public static function list_events(\WP_REST_Request $req): \WP_REST_Response {
        return new \WP_REST_Response(array_map([Events::class, 'summary'], Events::all_event_ids()), 200);
    }

    public static function get_event(\WP_REST_Request $req): \WP_REST_Response {
        $id = (int) $req['id'];
        if (get_post_type($id) !== Events::slug()) {
            return new \WP_REST_Response(['error' => 'not_found'], 404);
        }
        return new \WP_REST_Response(Events::record($id), 200);
    }

    public static function update_event(\WP_REST_Request $req): \WP_REST_Response {
        $id = (int) $req['id'];
        if (get_post_type($id) !== Events::slug() || ! current_user_can('edit_post', $id)) {
            return new \WP_REST_Response(['error' => 'forbidden'], 403);
        }
        $fields = (array) $req->get_param('fields');
        if ($fields) {
            Events::save_fields($id, $fields);
        }
        $sessions = $req->get_param('sessions');
        if (is_array($sessions)) {
            Events::set_sessions($id, $sessions);
        }
        return new \WP_REST_Response(Events::record($id), 200);
    }

    public static function confirm_event(\WP_REST_Request $req): \WP_REST_Response {
        $id = (int) $req['id'];
        if (get_post_type($id) !== Events::slug() || ! current_user_can('edit_post', $id)) {
            return new \WP_REST_Response(['error' => 'forbidden'], 403);
        }
        $r = Events::confirm($id);
        if (is_wp_error($r)) {
            return new \WP_REST_Response(['error' => $r->get_error_message(), 'missing' => $r->get_error_data()['missing'] ?? []], 409);
        }
        return new \WP_REST_Response(Events::summary($id), 200);
    }
}
