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
            ['methods' => 'POST',   'callback' => [self::class, 'update'], 'permission_callback' => $auth],
            ['methods' => 'DELETE', 'callback' => [self::class, 'remove'], 'permission_callback' => $auth],
        ]);
        register_rest_route(self::NS, '/contact/(?P<id>\d+)/activity', [
            'methods' => 'GET', 'callback' => [self::class, 'activity'], 'permission_callback' => $auth,
        ]);
        // Lists.
        register_rest_route(self::NS, '/lists', [
            ['methods' => 'GET',  'callback' => [self::class, 'list_lists'], 'permission_callback' => $auth],
            ['methods' => 'POST', 'callback' => [self::class, 'create_list'], 'permission_callback' => $auth],
        ]);
        register_rest_route(self::NS, '/lists/(?P<id>\d+)', [
            ['methods' => 'POST',   'callback' => [self::class, 'update_list'], 'permission_callback' => $auth],
            ['methods' => 'DELETE', 'callback' => [self::class, 'delete_list'], 'permission_callback' => $auth],
        ]);
        register_rest_route(self::NS, '/lists/(?P<id>\d+)/members', [
            'methods' => 'POST', 'callback' => [self::class, 'list_member'], 'permission_callback' => $auth,
        ]);
        register_rest_route(self::NS, '/lists/(?P<id>\d+)/import', [
            'methods' => 'POST', 'callback' => [self::class, 'import_list'], 'permission_callback' => $auth,
        ]);
    }

    public static function list_lists(\WP_REST_Request $req): \WP_REST_Response {
        $out = array_map(static function ($l) {
            return [
                'id'           => (int) $l->id,
                'name'         => $l->name,
                'description'  => $l->description,
                'type'         => $l->type,
                'member_count' => (int) $l->member_count,
            ];
        }, Lists::all());
        return new \WP_REST_Response($out, 200);
    }

    public static function create_list(\WP_REST_Request $req): \WP_REST_Response {
        $id = Lists::create((string) $req->get_param('name'), (string) $req->get_param('description'));
        if ($id <= 0) {
            return new \WP_REST_Response(['error' => 'invalid_name'], 400);
        }
        return new \WP_REST_Response(['id' => $id], 201);
    }

    public static function update_list(\WP_REST_Request $req): \WP_REST_Response {
        $id = (int) $req['id'];
        if (! Lists::get($id)) {
            return new \WP_REST_Response(['error' => 'not_found'], 404);
        }
        Lists::update($id, [
            'name'        => (string) $req->get_param('name'),
            'description' => (string) $req->get_param('description'),
        ]);
        return new \WP_REST_Response(['ok' => true], 200);
    }

    public static function delete_list(\WP_REST_Request $req): \WP_REST_Response {
        Lists::delete((int) $req['id']);
        return new \WP_REST_Response(['ok' => true], 200);
    }

    public static function list_member(\WP_REST_Request $req): \WP_REST_Response {
        $list_id    = (int) $req['id'];
        $contact_id = (int) $req->get_param('contact_id');
        $action     = sanitize_key((string) $req->get_param('action')) ?: 'add';
        if (! Lists::get($list_id) || ! Contacts::get_by_id($contact_id)) {
            return new \WP_REST_Response(['error' => 'not_found'], 404);
        }
        if ($action === 'remove') {
            Lists::remove_contact($list_id, $contact_id);
        } else {
            Lists::add_contact($list_id, $contact_id);
        }
        return new \WP_REST_Response(['ok' => true, 'member_count' => Lists::count($list_id)], 200);
    }

    public static function import_list(\WP_REST_Request $req): \WP_REST_Response {
        $list_id = (int) $req['id'];
        if (! Lists::get($list_id)) {
            return new \WP_REST_Response(['error' => 'not_found'], 404);
        }
        $files = $req->get_file_params();
        $tmp   = $files['file']['tmp_name'] ?? '';
        if (! $tmp || ! is_uploaded_file($tmp)) {
            return new \WP_REST_Response(['error' => 'no_file'], 400);
        }
        $added = Lists::import_csv_to_list($list_id, $tmp);
        return new \WP_REST_Response(['ok' => true, 'added' => $added, 'member_count' => Lists::count($list_id)], 200);
    }

    public static function meta(\WP_REST_Request $req): \WP_REST_Response {
        return new \WP_REST_Response(Contacts::counts(), 200);
    }

    public static function list_contacts(\WP_REST_Request $req): \WP_REST_Response {
        $search = sanitize_text_field((string) $req->get_param('search'));
        $offset = max(0, (int) $req->get_param('offset'));
        $list   = (int) $req->get_param('list');
        $rows   = $list > 0 ? Lists::contacts($list, $search, 50, $offset) : Contacts::search($search, 50, $offset);
        return new \WP_REST_Response(array_map([self::class, 'dto'], $rows), 200);
    }

    public static function update(\WP_REST_Request $req): \WP_REST_Response {
        $id  = (int) $req['id'];
        $row = Contacts::get_by_id($id);
        if (! $row) {
            return new \WP_REST_Response(['error' => 'not_found'], 404);
        }
        // Editable profile fields (only those actually supplied).
        $fields = [];
        foreach (['name', 'company', 'tags', 'phone'] as $k) {
            if ($req->get_param($k) !== null) {
                $fields[$k] = (string) $req->get_param($k);
            }
        }
        if ($fields) {
            Contacts::update_fields($id, $fields);
        }
        $status = sanitize_key((string) $req->get_param('status'));
        if ($status === Contacts::STATUS_UNSUBSCRIBED) {
            Contacts::unsubscribe((string) $row->email);
        } elseif ($status === Contacts::STATUS_SUBSCRIBED) {
            Contacts::resubscribe((string) $row->email);
        }
        return new \WP_REST_Response(self::dto(Contacts::get_by_id($id)), 200);
    }

    public static function remove(\WP_REST_Request $req): \WP_REST_Response {
        Contacts::delete((int) $req['id']);
        return new \WP_REST_Response(['ok' => true], 200);
    }

    /** Per-contact CRM activity: lists, source, join date and email engagement. */
    public static function activity(\WP_REST_Request $req): \WP_REST_Response {
        $c = Contacts::get_by_id((int) $req['id']);
        if (! $c) {
            return new \WP_REST_Response(['error' => 'not_found'], 404);
        }
        global $wpdb;
        $lists = $wpdb->get_col($wpdb->prepare(
            'SELECT l.name FROM ' . Lists::members_table() . ' m JOIN ' . Lists::lists_table() . ' l ON l.id = m.list_id WHERE m.contact_id = %d ORDER BY l.name',
            (int) $c->id
        )) ?: [];
        $msgs = $wpdb->get_results($wpdb->prepare(
            'SELECT m.opened, m.clicked, m.status, m.sent_at, c.name AS campaign FROM ' . Campaigns::messages_table() . ' m '
            . 'JOIN ' . Campaigns::campaigns_table() . ' c ON c.id = m.campaign_id WHERE m.email = %s ORDER BY m.id DESC LIMIT 50',
            (string) $c->email
        )) ?: [];
        $received = 0; $opened = 0; $clicked = 0; $campaigns = [];
        foreach ($msgs as $m) {
            if ($m->sent_at) { $received++; }
            if ((int) $m->opened) { $opened++; }
            if ((int) $m->clicked) { $clicked++; }
            $campaigns[] = [
                'campaign' => $m->campaign,
                'sent_at'  => $m->sent_at,
                'opened'   => (bool) $m->opened,
                'clicked'  => (bool) $m->clicked,
                'status'   => $m->status,
            ];
        }
        return new \WP_REST_Response([
            'joined'     => $c->created_at,
            'source'     => $c->source,
            'status'     => $c->status,
            'lists'      => array_values($lists),
            'engagement' => ['received' => $received, 'opened' => $opened, 'clicked' => $clicked],
            'campaigns'  => $campaigns,
        ], 200);
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
            'company'    => $c->company ?? '',
            'tags'       => $c->tags ?? '',
            'lists'      => Lists::for_contact((int) $c->id),
        ];
    }
}
