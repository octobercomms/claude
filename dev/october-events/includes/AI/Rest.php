<?php
declare(strict_types=1);

namespace OE\AI;

defined('ABSPATH') || exit;

/**
 * Staff AI assistant REST API (oe/v1/assistant). The platform's chat view posts
 * the running conversation here; we hand it to {@see Assistant::ask()} which runs
 * Claude's tool-use loop over the festival's live data and returns the reply.
 *
 * Auth: an authenticated user who can edit. This assistant can see everything,
 * so it is staff-only — the public, per-order-scoped version is separate.
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
        $auth = [self::class, 'can'];
        register_rest_route(self::NS, '/assistant', [
            'methods'             => 'POST',
            'callback'            => [self::class, 'ask'],
            'permission_callback' => $auth,
        ]);
    }

    public static function ask(\WP_REST_Request $req): \WP_REST_Response {
        if (! Assistant::is_ready()) {
            return new \WP_REST_Response([
                'ok'    => false,
                'reply' => __('The assistant needs a Claude API key (OE_CLAUDE_API_KEY) to run.', 'october-events'),
            ], 400);
        }

        $messages = $req->get_param('messages');
        if (! is_array($messages)) {
            // Allow a single-shot {message:"..."} for convenience.
            $single = trim((string) $req->get_param('message'));
            $messages = $single !== '' ? [['role' => 'user', 'content' => $single]] : [];
        }

        $reply = Assistant::ask($messages);
        return new \WP_REST_Response(['ok' => true, 'reply' => $reply], 200);
    }
}
