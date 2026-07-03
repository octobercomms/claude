<?php
declare(strict_types=1);

namespace OE\Volunteers;

use OE\VolunteerSignups;

// NB: the management facade is the top-level class \OE\Volunteers. We reference it
// fully-qualified throughout because its name collides with this sub-namespace.

defined('ABSPATH') || exit;

/**
 * Volunteer management REST API (oe/v1/volunteers) — the data Ashleigh's
 * Volunteers view on the platform reads and writes. Mirrors the wp-admin
 * Volunteers screen: list opportunities, drill into shifts + signups, decide on
 * each signup (confirm / decline / no-show), toggle check-in, manually add a
 * volunteer, and remove a signup. Auth: an authenticated user who can edit.
 */
final class Rest {

    private const NS = 'oe/v1';

    public static function init(): void {
        add_action('rest_api_init', [self::class, 'register_routes']);
    }

    public static function can(): bool {
        return \OE\Access::can_manage();
    }

    public static function register_routes(): void {
        register_rest_route(self::NS, '/volunteers/opportunities', [
            'methods'             => 'GET',
            'callback'            => [self::class, 'list_opportunities'],
            'permission_callback' => [self::class, 'can'],
        ]);
        register_rest_route(self::NS, '/volunteers/opportunity/(?P<id>\d+)', [
            'methods'             => 'GET',
            'callback'            => [self::class, 'get_opportunity'],
            'permission_callback' => [self::class, 'can'],
        ]);
        register_rest_route(self::NS, '/volunteers/opportunity/(?P<id>\d+)/signup', [
            'methods'             => 'POST',
            'callback'            => [self::class, 'add_signup'],
            'permission_callback' => [self::class, 'can'],
        ]);
        register_rest_route(self::NS, '/volunteers/signup/(?P<id>\d+)', [
            [
                'methods'             => 'POST',
                'callback'            => [self::class, 'update_signup'],
                'permission_callback' => [self::class, 'can'],
            ],
            [
                'methods'             => 'DELETE',
                'callback'            => [self::class, 'remove_signup'],
                'permission_callback' => [self::class, 'can'],
            ],
        ]);
    }

    public static function list_opportunities(\WP_REST_Request $req): \WP_REST_Response {
        $out = [];
        foreach (\OE\Volunteers::all_opportunity_ids() as $id) {
            $out[] = \OE\Volunteers::opportunity_summary($id);
        }
        return new \WP_REST_Response($out, 200);
    }

    public static function get_opportunity(\WP_REST_Request $req): \WP_REST_Response {
        $id = (int) $req['id'];
        if (get_post_type($id) !== \OE\Volunteers::slug()) {
            return new \WP_REST_Response(['error' => 'not_found'], 404);
        }
        return new \WP_REST_Response(\OE\Volunteers::opportunity_detail($id), 200);
    }

    public static function add_signup(\WP_REST_Request $req): \WP_REST_Response {
        $id      = (int) $req['id'];
        $shift   = sanitize_key((string) $req->get_param('shift_id'));
        $person  = [
            'name'       => $req->get_param('name'),
            'email'      => $req->get_param('email'),
            'phone'      => $req->get_param('phone'),
            'sms_opt_in' => $req->get_param('sms_opt_in'),
        ];
        $r = \OE\Volunteers::admin_add($id, $shift, $person);
        if (is_wp_error($r)) {
            return new \WP_REST_Response(['error' => $r->get_error_message()], 400);
        }
        return new \WP_REST_Response(\OE\Volunteers::opportunity_detail($id), 201);
    }

    public static function update_signup(\WP_REST_Request $req): \WP_REST_Response {
        $signup_id = (int) $req['id'];
        $row = VolunteerSignups::get($signup_id);
        if (! $row) {
            return new \WP_REST_Response(['error' => 'not_found'], 404);
        }

        $status = $req->get_param('status');
        if ($status !== null) {
            $status = sanitize_key((string) $status);
            if ($status === VolunteerSignups::STATUS_CONFIRMED) {
                \OE\Volunteers::confirm($signup_id);
            } elseif ($status === VolunteerSignups::STATUS_DECLINED) {
                \OE\Volunteers::decline($signup_id);
            } elseif ($status === VolunteerSignups::STATUS_NO_SHOW) {
                \OE\Volunteers::mark_no_show($signup_id);
            } elseif ($status === VolunteerSignups::STATUS_PENDING) {
                VolunteerSignups::update($signup_id, ['status' => VolunteerSignups::STATUS_PENDING]);
            } else {
                return new \WP_REST_Response(['error' => 'bad_status'], 400);
            }
        }

        $checked_in = $req->get_param('checked_in');
        if ($checked_in !== null) {
            \OE\Volunteers::set_checked_in($signup_id, (bool) rest_sanitize_boolean($checked_in));
        }

        return new \WP_REST_Response(\OE\Volunteers::opportunity_detail((int) $row->opportunity_id), 200);
    }

    public static function remove_signup(\WP_REST_Request $req): \WP_REST_Response {
        $signup_id = (int) $req['id'];
        $row = VolunteerSignups::get($signup_id);
        if (! $row) {
            return new \WP_REST_Response(['error' => 'not_found'], 404);
        }
        $opportunity_id = (int) $row->opportunity_id;
        \OE\Volunteers::delete_signup($signup_id);
        return new \WP_REST_Response(\OE\Volunteers::opportunity_detail($opportunity_id), 200);
    }
}
