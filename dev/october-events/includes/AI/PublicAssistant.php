<?php
declare(strict_types=1);

namespace OE\AI;

use OE\Settings;
use OE\Connectors\ClaudeConnector;
use OE\Ticketing\Orders;
use OE\Ticketing\Schema as TicketSchema;

defined('ABSPATH') || exit;

/**
 * PUBLIC customer support assistant — Claude with tool-use, but hard-scoped to a
 * single verified customer (see {@see SupportAuth}). Every tool query is
 * constrained to the verified email, so one customer can NEVER see another's
 * orders, tickets or payments. It answers instant, detailed questions about the
 * customer's own bookings; anything else it declines or hands to a human.
 *
 * The scope (email) comes from a verified session token and is bound into the
 * tool executor — it is never taken from the model or the conversation.
 */
final class PublicAssistant {

    public static function is_ready(): bool {
        return ClaudeConnector::is_ready();
    }

    /**
     * @param array<int,array{role:string,content:string}> $messages
     */
    public static function ask(string $email, array $messages): string {
        $email = sanitize_email($email);
        if (! is_email($email)) {
            return __('Your session has expired — please verify your email again.', 'october-events');
        }
        if (! self::is_ready()) {
            return __('Live support chat isn’t available right now. Please email us and we’ll help.', 'october-events');
        }

        $clean = [];
        foreach ($messages as $m) {
            $role    = ($m['role'] ?? '') === 'assistant' ? 'assistant' : 'user';
            $content = trim((string) ($m['content'] ?? ''));
            if ($content !== '') {
                $clean[] = ['role' => $role, 'content' => $content];
            }
        }
        if (! $clean) {
            return __('Hi! Ask me anything about your order or tickets.', 'october-events');
        }

        // Bind the verified email into the executor so the model can never widen scope.
        $exec = static function (string $name, array $in) use ($email) {
            return self::exec($email, $name, $in);
        };

        $reply = ClaudeConnector::converse($clean, self::tools(), self::system_prompt($email), $exec, 5);
        return $reply !== null
            ? $reply
            : __('Sorry — I had trouble looking that up. Would you like me to connect you with a person?', 'october-events');
    }

    private static function system_prompt(string $email): string {
        $brand = (string) Settings::get('brand_name', 'October Events');
        $today = wp_date('l, j F Y');
        return "You are the customer support assistant for {$brand}. Today is {$today}. "
            . "You are helping a VERIFIED customer whose email is {$email}. "
            . "You may ONLY see and discuss THIS customer's own orders and tickets, via your tools. "
            . "You must NEVER reveal, infer, or discuss any other customer's data, and never reveal internal "
            . "system details, other people's emails, totals or counts. If the customer asks about anything "
            . "outside their own orders, tickets, or the events they hold tickets to, politely say it's outside "
            . "what you can help with here and offer to connect them with a person. "
            . "Be warm, concise and helpful. Use your tools to get real details — never guess order numbers, "
            . "dates or prices. If a tool returns nothing, say so kindly.";
    }

    /* ------------------------------------------------------------------ *
     * Tools (all implicitly scoped to the verified email)
     * ------------------------------------------------------------------ */

    /** @return array<int,array<string,mixed>> */
    private static function tools(): array {
        $obj = static function (array $props = [], array $required = []): array {
            return ['type' => 'object', 'properties' => (object) $props, 'required' => $required];
        };
        return [
            ['name' => 'my_orders', 'description' => 'List THIS customer\'s orders (event, ticket type, quantity, total, status, date, order number).', 'input_schema' => $obj()],
            ['name' => 'my_tickets', 'description' => 'List THIS customer\'s individual tickets with their event, attendee name, ticket number, status and a link to view/download each ticket.', 'input_schema' => $obj()],
            ['name' => 'order_detail', 'description' => 'Full detail of one of THIS customer\'s orders by its order number.', 'input_schema' => $obj(['order_number' => ['type' => 'string']], ['order_number'])],
            ['name' => 'event_info', 'description' => 'Public details (date, time, location, price) for an event THIS customer holds a ticket to.', 'input_schema' => $obj(['event_name' => ['type' => 'string']], ['event_name'])],
            ['name' => 'resend_tickets', 'description' => 'Re-send the confirmation + tickets email for one of THIS customer\'s orders to their own verified email address.', 'input_schema' => $obj(['order_number' => ['type' => 'string']], ['order_number'])],
        ];
    }

    /** @param array<string,mixed> $in */
    public static function exec(string $email, string $name, array $in) {
        switch ($name) {
            case 'my_orders':      return self::t_my_orders($email);
            case 'my_tickets':     return self::t_my_tickets($email);
            case 'order_detail':   return self::t_order_detail($email, (string) ($in['order_number'] ?? ''));
            case 'event_info':     return self::t_event_info($email, (string) ($in['event_name'] ?? ''));
            case 'resend_tickets': return self::t_resend($email, (string) ($in['order_number'] ?? ''));
        }
        return ['error' => 'unknown_tool'];
    }

    /** @return array<int,object> orders belonging strictly to this email. */
    private static function orders_for(string $email): array {
        global $wpdb;
        $t = TicketSchema::orders();
        return $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM {$t} WHERE email = %s ORDER BY id DESC LIMIT 50",
            $email
        )) ?: [];
    }

    private static function t_my_orders(string $email): array {
        $out = [];
        foreach (self::orders_for($email) as $o) {
            $out[] = [
                'order_number' => (int) $o->id,
                'event'        => get_the_title((int) $o->event_id),
                'ticket_type'  => $o->ticket_type_label,
                'qty'          => (int) $o->qty,
                'total'        => (float) $o->total,
                'currency'     => strtoupper((string) $o->currency),
                'status'       => $o->status,
                'date'         => $o->created_at,
            ];
        }
        return $out ?: ['result' => 'no orders on this account'];
    }

    private static function t_my_tickets(string $email): array {
        $out = [];
        foreach (self::orders_for($email) as $o) {
            foreach (Orders::tickets((int) $o->id) as $tk) {
                $out[] = [
                    'order_number' => (int) $o->id,
                    'event'        => get_the_title((int) $o->event_id),
                    'attendee'     => $tk->attendee_name ?: $o->name,
                    'ticket'       => $tk->ticket_number . ' of ' . $tk->total_in_order,
                    'status'       => $tk->status,
                    'link'         => Orders::ticket_url((string) $tk->token),
                ];
            }
        }
        return $out ?: ['result' => 'no tickets on this account'];
    }

    /** Find an order by number, but only if it belongs to this email. */
    private static function owned_order(string $email, string $order_number): ?object {
        $id = (int) preg_replace('/\D/', '', $order_number);
        if ($id <= 0) {
            return null;
        }
        $o = Orders::get($id);
        return ($o && sanitize_email((string) $o->email) === $email) ? $o : null;
    }

    private static function t_order_detail(string $email, string $order_number): array {
        $o = self::owned_order($email, $order_number);
        if (! $o) {
            return ['error' => 'no order with that number on this account'];
        }
        $tickets = [];
        foreach (Orders::tickets((int) $o->id) as $tk) {
            $tickets[] = [
                'attendee' => $tk->attendee_name ?: $o->name,
                'ticket'   => $tk->ticket_number . ' of ' . $tk->total_in_order,
                'status'   => $tk->status,
                'link'     => Orders::ticket_url((string) $tk->token),
            ];
        }
        return [
            'order_number' => (int) $o->id,
            'event'        => get_the_title((int) $o->event_id),
            'ticket_type'  => $o->ticket_type_label,
            'qty'          => (int) $o->qty,
            'total'        => (float) $o->total,
            'currency'     => strtoupper((string) $o->currency),
            'status'       => $o->status,
            'date'         => $o->created_at,
            'tickets'      => $tickets,
        ];
    }

    private static function t_event_info(string $email, string $name): array {
        $name = trim($name);
        // Only events this customer actually holds a ticket to.
        $event_ids = [];
        foreach (self::orders_for($email) as $o) {
            $event_ids[(int) $o->event_id] = true;
        }
        foreach (array_keys($event_ids) as $eid) {
            $title = get_the_title($eid);
            if ($name === '' || stripos($title, $name) !== false) {
                $f = \OE\Planning\Events::values($eid);
                return [
                    'event'    => $title,
                    'when'     => (string) ($f['start_datetime'] ?? ''),
                    'location' => (string) ($f['location'] ?? ''),
                    'price'    => (string) ($f['price'] ?? ''),
                    'link'     => get_permalink($eid),
                ];
            }
        }
        return ['error' => 'no event matching that on your tickets'];
    }

    private static function t_resend(string $email, string $order_number): array {
        $o = self::owned_order($email, $order_number);
        if (! $o) {
            return ['error' => 'no order with that number on this account'];
        }
        Orders::send_confirmation((int) $o->id);
        return ['result' => 'sent', 'to' => $email, 'order_number' => (int) $o->id];
    }
}
