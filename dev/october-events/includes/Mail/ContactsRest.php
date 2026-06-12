<?php
declare(strict_types=1);

namespace OE\Mail;

defined('ABSPATH') || exit;

/**
 * Contacts REST API (oe/v1/contacts) — read + manage the native contact list
 * from the planning platform. Auth: an authenticated user who can edit.
 */
final class ContactsRest {

    private const NS = 'oe/v1';

    public static function init(): void {
        add_action('rest_api_init', [self::class, 'register_routes']);
    }

    public static function can(): bool {
        return current_user_can('edit_posts');
    }

    public static function register_routes(): void {
        $auth = [self::class, 'can'];
        register_rest_route(self::NS, '/contacts', [
            'methods' => 'GET', 'callback' => [self::class, 'list_contacts'], 'permission_callback' => $auth,
        ]);
        register_rest_route(self::NS, '/contacts/meta', [
            'methods' => 'GET', 'callback' => [self::class, 'meta'], 'permission_callback' => $auth,
        ]);
        register_rest_route(self::NS, '/contact/(?P<id>\d+)', [
            'methods' => 'POST', 'callback' => [self::class, 'update'], 'permission_callback' => $auth,
        ]);
    }

    public static function meta(\WP_REST_Request $req): \WP_REST_Response {
        return new \WP_REST_Response(Contacts::counts(), 200);
    }

    public static function list_contacts(\WP_REST_Request $req): \WP_REST_Response {
        $search = sanitize_text_field((string) $req->get_param('search'));
        $offset = max(0, (int) $req->get_param('offset'));
        $rows   = Contacts::search($search, 50, $offset);
        return new \WP_REST_Response(array_map([self::class, 'dto'], $rows), 200);
    }

    public static function update(\WP_REST_Request $req): \WP_REST_Response {
        $row = Contacts::get_by_id((int) $req['id']);
        if (! $row) {
            return new \WP_REST_Response(['error' => 'not_found'], 404);
        }
        $status = sanitize_key((string) $req->get_param('status'));
        if ($status === Contacts::STATUS_UNSUBSCRIBED) {
            Contacts::unsubscribe((string) $row->email);
        } elseif ($status === Contacts::STATUS_SUBSCRIBED) {
            Contacts::resubscribe((string) $row->email);
        }
        return new \WP_REST_Response(self::dto(Contacts::get_by_id((int) $req['id'])), 200);
    }

    /** @return array<string,mixed> */
    private static function dto(object $c): array {
        return [
            'id'         => (int) $c->id,
            'email'      => $c->email,
            'name'       => $c->name,
            'phone'      => $c->phone,
            'sms_opt_in' => (bool) $c->sms_opt_in,
            'source'     => $c->source,
            'status'     => $c->status,
        ];
    }
}
