<?php
declare(strict_types=1);

namespace OE\AI;

defined('ABSPATH') || exit;

/**
 * Public REST API for the customer support chat (oe/v1/support/*).
 *
 * These routes are intentionally PUBLIC (logged-out visitors use them), so every
 * callback does its own rate-limiting and, for chat, re-verifies the session
 * token issued by {@see SupportAuth}. No staff data is reachable here — the
 * assistant is hard-scoped to the verified customer's own email.
 */
final class PublicRest {

    private const NS = 'oe/v1';
    private const CHAT_RL_WINDOW = 60;
    private const CHAT_RL_MAX    = 15; // chat turns per IP per minute

    public static function init(): void {
        add_action('rest_api_init', [self::class, 'register_routes']);
    }

    public static function register_routes(): void {
        $public = '__return_true';
        register_rest_route(self::NS, '/support/request-code', [
            'methods' => 'POST', 'callback' => [self::class, 'request_code'], 'permission_callback' => $public,
        ]);
        register_rest_route(self::NS, '/support/verify', [
            'methods' => 'POST', 'callback' => [self::class, 'verify'], 'permission_callback' => $public,
        ]);
        register_rest_route(self::NS, '/support/chat', [
            'methods' => 'POST', 'callback' => [self::class, 'chat'], 'permission_callback' => $public,
        ]);
    }

    public static function request_code(\WP_REST_Request $req): \WP_REST_Response {
        $result = SupportAuth::request_code((string) $req->get_param('email'));
        return new \WP_REST_Response($result, $result['ok'] ? 200 : 429);
    }

    public static function verify(\WP_REST_Request $req): \WP_REST_Response {
        $result = SupportAuth::verify_code((string) $req->get_param('email'), (string) $req->get_param('code'));
        return new \WP_REST_Response($result, $result['ok'] ? 200 : 401);
    }

    public static function chat(\WP_REST_Request $req): \WP_REST_Response {
        // Per-IP throttle on the chat itself.
        $ip_key = 'oe_support_chat_rl_' . md5((string) ($_SERVER['REMOTE_ADDR'] ?? 'x'));
        $hits   = (int) get_transient($ip_key);
        if ($hits >= self::CHAT_RL_MAX) {
            return new \WP_REST_Response(['ok' => false, 'reply' => __('You’re sending messages a little fast — give it a moment.', 'october-events')], 429);
        }
        set_transient($ip_key, $hits + 1, self::CHAT_RL_WINDOW);

        $email = SupportAuth::verify_token((string) $req->get_param('token'));
        if ($email === null) {
            return new \WP_REST_Response(['ok' => false, 'expired' => true, 'reply' => __('Your session has expired — please verify your email again.', 'october-events')], 401);
        }

        $messages = $req->get_param('messages');
        if (! is_array($messages)) {
            $single   = trim((string) $req->get_param('message'));
            $messages = $single !== '' ? [['role' => 'user', 'content' => $single]] : [];
        }

        $reply = PublicAssistant::ask($email, $messages);
        return new \WP_REST_Response(['ok' => true, 'reply' => $reply], 200);
    }
}
