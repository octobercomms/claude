<?php
declare(strict_types=1);

namespace OE\Tasks;

defined('ABSPATH') || exit;

/**
 * Tasks REST API (oe/v1/tasks) — the shared task board for the platform.
 */
final class Rest {

    private const NS = 'oe/v1';

    public static function init(): void {
        add_action('rest_api_init', [self::class, 'register_routes']);
    }

    public static function can(): bool {
        return current_user_can('edit_posts');
    }

    public static function register_routes(): void {
        register_rest_route(self::NS, '/tasks', [
            [
                'methods'             => 'GET',
                'callback'            => [self::class, 'list_tasks'],
                'permission_callback' => [self::class, 'can'],
            ],
            [
                'methods'             => 'POST',
                'callback'            => [self::class, 'create'],
                'permission_callback' => [self::class, 'can'],
            ],
        ]);
        register_rest_route(self::NS, '/task/(?P<id>\d+)', [
            [
                'methods'             => 'POST',
                'callback'            => [self::class, 'update'],
                'permission_callback' => [self::class, 'can'],
            ],
            [
                'methods'             => 'DELETE',
                'callback'            => [self::class, 'remove'],
                'permission_callback' => [self::class, 'can'],
            ],
        ]);
        register_rest_route(self::NS, '/tasks/meta', [
            'methods'             => 'GET',
            'callback'            => [self::class, 'meta'],
            'permission_callback' => [self::class, 'can'],
        ]);
    }

    public static function meta(): \WP_REST_Response {
        return new \WP_REST_Response([
            'departments' => Tasks::DEPARTMENTS,
            'statuses'    => Tasks::STATUSES,
            'counts'      => Tasks::counts(),
        ], 200);
    }

    public static function list_tasks(\WP_REST_Request $req): \WP_REST_Response {
        $rows = Tasks::all(
            sanitize_text_field((string) $req->get_param('department')),
            sanitize_text_field((string) $req->get_param('status'))
        );
        return new \WP_REST_Response(array_map([Tasks::class, 'dto'], $rows), 200);
    }

    public static function create(\WP_REST_Request $req): \WP_REST_Response {
        $id = Tasks::save(self::payload($req));
        return $id
            ? new \WP_REST_Response(Tasks::dto(Tasks::get($id)), 201)
            : new \WP_REST_Response(['error' => 'title_required'], 400);
    }

    public static function update(\WP_REST_Request $req): \WP_REST_Response {
        $id = (int) $req['id'];
        if (! Tasks::get($id)) {
            return new \WP_REST_Response(['error' => 'not_found'], 404);
        }
        Tasks::save(self::payload($req), $id);
        return new \WP_REST_Response(Tasks::dto(Tasks::get($id)), 200);
    }

    public static function remove(\WP_REST_Request $req): \WP_REST_Response {
        Tasks::delete((int) $req['id']);
        return new \WP_REST_Response(['ok' => true], 200);
    }

    private static function payload(\WP_REST_Request $req): array {
        return [
            'title'      => $req->get_param('title'),
            'department' => $req->get_param('department'),
            'status'     => $req->get_param('status'),
            'due_date'   => $req->get_param('due_date'),
            'assignee'   => $req->get_param('assignee'),
            'notes'      => $req->get_param('notes'),
        ];
    }
}
