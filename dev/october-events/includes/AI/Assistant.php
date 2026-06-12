<?php
declare(strict_types=1);

namespace OE\AI;

use OE\Settings;
use OE\Connectors\ClaudeConnector;
use OE\Connectors\StripeConnector;
use OE\Planning\Events;
use OE\Ticketing\Orders;
use OE\Ticketing\Schema as TicketSchema;
use OE\Mail\Contacts;
use OE\Volunteers;

defined('ABSPATH') || exit;

/**
 * Staff operations assistant — Claude with tool-use over the festival's live
 * data (events, ticket sales, orders, failed payments, contacts, volunteers,
 * campaigns). Answers detailed questions instantly with real numbers.
 *
 * Staff-only: it can see everything, so it's exposed only to authenticated users
 * who can edit (see {@see Rest}). The public, per-order-scoped version is separate.
 */
final class Assistant {

    public static function is_ready(): bool {
        return ClaudeConnector::is_ready();
    }

    /**
     * @param array<int,array{role:string,content:string}> $messages
     */
    public static function ask(array $messages): string {
        if (! self::is_ready()) {
            return __('The assistant needs a Claude API key (OE_CLAUDE_API_KEY) to run.', 'october-events');
        }
        $clean = [];
        foreach ($messages as $m) {
            $role = ($m['role'] ?? '') === 'assistant' ? 'assistant' : 'user';
            $content = trim((string) ($m['content'] ?? ''));
            if ($content !== '') {
                $clean[] = ['role' => $role, 'content' => $content];
            }
        }
        if (! $clean) {
            return __('Ask me anything about your events, tickets, payments, contacts or volunteers.', 'october-events');
        }

        $reply = ClaudeConnector::converse($clean, self::tools(), self::system_prompt(), [self::class, 'exec']);
        return $reply !== null ? $reply : __('Sorry — I hit an error reaching the model. Check the debug log.', 'october-events');
    }

    private static function system_prompt(): string {
        $brand = (string) Settings::get('brand_name', 'October Events');
        $today = wp_date('l, j F Y');
        return "You are the operations assistant for {$brand}. You are talking to authorised staff. "
            . "Today is {$today}. Use your tools to look up LIVE data and answer precisely with real numbers — "
            . "never guess or invent figures. Be concise and direct; use short lists or a quick table when it helps. "
            . "If a tool returns nothing, say so plainly. You can answer about events, ticket sales, individual orders, "
            . "failed payments, contacts, volunteer coverage and email campaigns.";
    }

    /* ------------------------------------------------------------------ *
     * Tool schemas
     * ------------------------------------------------------------------ */

    /** @return array<int,array<string,mixed>> */
    private static function tools(): array {
        $obj = static function (array $props = [], array $required = []): array {
            return ['type' => 'object', 'properties' => (object) $props, 'required' => $required];
        };
        return [
            ['name' => 'events_overview', 'description' => 'Counts of events by status (confirmed/green, in progress, draft) and the next upcoming confirmed events.', 'input_schema' => $obj()],
            ['name' => 'event_readiness', 'description' => 'For a named event, what it still needs before it can be confirmed/published.', 'input_schema' => $obj(['name' => ['type' => 'string', 'description' => 'Event title or part of it']], ['name'])],
            ['name' => 'ticket_sales', 'description' => 'Ticket sales totals: today and all-time tickets + revenue, and a per-event breakdown.', 'input_schema' => $obj()],
            ['name' => 'find_order', 'description' => 'Look up ticket order(s) by buyer email, order id, or Stripe payment id.', 'input_schema' => $obj(['query' => ['type' => 'string', 'description' => 'email, order id, or payment id']], ['query'])],
            ['name' => 'failed_payments', 'description' => 'Recent failed card charges (from Stripe), with amount, email and the failure reason.', 'input_schema' => $obj(['limit' => ['type' => 'integer', 'description' => 'how many to fetch (default 20)']])],
            ['name' => 'find_contact', 'description' => 'Search the contact list by name or email; returns status, source and phone.', 'input_schema' => $obj(['query' => ['type' => 'string']], ['query'])],
            ['name' => 'volunteer_coverage', 'description' => 'Volunteer opportunities with capacity vs filled, and how many signups still need a decision.', 'input_schema' => $obj()],
            ['name' => 'campaign_stats', 'description' => 'Recent email campaigns with sent / opened / clicked counts and status.', 'input_schema' => $obj()],
        ];
    }

    /* ------------------------------------------------------------------ *
     * Tool execution
     * ------------------------------------------------------------------ */

    /** @param array<string,mixed> $in */
    public static function exec(string $name, array $in) {
        switch ($name) {
            case 'events_overview':   return self::t_events_overview();
            case 'event_readiness':   return self::t_event_readiness((string) ($in['name'] ?? ''));
            case 'ticket_sales':      return self::t_ticket_sales();
            case 'find_order':        return self::t_find_order((string) ($in['query'] ?? ''));
            case 'failed_payments':   return StripeConnector::recent_failed((int) ($in['limit'] ?? 20));
            case 'find_contact':      return self::t_find_contact((string) ($in['query'] ?? ''));
            case 'volunteer_coverage':return self::t_volunteer_coverage();
            case 'campaign_stats':    return self::t_campaign_stats();
        }
        return ['error' => 'unknown_tool'];
    }

    private static function t_events_overview(): array {
        $ids = Events::all_event_ids(300);
        $counts = ['confirmed' => 0, 'in_progress' => 0, 'draft' => 0];
        $upcoming = [];
        foreach ($ids as $id) {
            $s = Events::status($id);
            $counts[$s] = ($counts[$s] ?? 0) + 1;
            if ($s === 'confirmed' && count($upcoming) < 10) {
                $f = Events::values($id);
                $upcoming[] = ['title' => get_the_title($id), 'when' => (string) ($f['start_datetime'] ?? ''), 'price' => (string) ($f['price'] ?? ''), 'location' => (string) ($f['location'] ?? '')];
            }
        }
        return ['total' => count($ids), 'by_status' => $counts, 'upcoming_confirmed' => $upcoming];
    }

    private static function t_event_readiness(string $name): array {
        $name = trim($name);
        foreach (Events::all_event_ids(300) as $id) {
            if ($name === '' || stripos(get_the_title($id), $name) !== false) {
                $r = Events::readiness($id);
                return ['title' => get_the_title($id), 'status' => Events::status($id), 'percent' => $r['percent'], 'missing' => $r['missing'], 'live' => get_post_status($id) === 'publish'];
            }
        }
        return ['error' => 'no event matched "' . $name . '"'];
    }

    private static function t_ticket_sales(): array {
        $stats = Orders::stats();
        $per = [];
        foreach (Orders::event_summary() as $row) {
            $per[] = ['event' => get_the_title((int) $row->event_id), 'tickets' => (int) $row->tickets, 'revenue' => (float) $row->revenue];
        }
        return ['today' => ['tickets' => $stats['today_tickets'] ?? 0, 'revenue' => $stats['today_revenue'] ?? 0], 'all_time' => ['tickets' => $stats['tickets'] ?? 0, 'revenue' => $stats['revenue'] ?? 0], 'currency' => strtoupper((string) Settings::get('currency', 'usd')), 'by_event' => $per];
    }

    private static function t_find_order(string $query): array {
        $query = trim($query);
        if ($query === '') {
            return ['error' => 'no query'];
        }
        global $wpdb;
        $t = TicketSchema::orders();
        $like = '%' . $wpdb->esc_like($query) . '%';
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM {$t} WHERE email LIKE %s OR payment_id = %s OR id = %d ORDER BY id DESC LIMIT 10",
            $like, $query, (int) $query
        )) ?: [];
        $out = [];
        foreach ($rows as $o) {
            $out[] = [
                'order_id' => (int) $o->id, 'name' => $o->name, 'email' => $o->email,
                'event' => get_the_title((int) $o->event_id), 'type' => $o->ticket_type_label,
                'qty' => (int) $o->qty, 'total' => (float) $o->total, 'currency' => strtoupper((string) $o->currency),
                'status' => $o->status, 'payment_id' => $o->payment_id, 'created' => $o->created_at,
            ];
        }
        return $out ?: ['result' => 'no orders found for "' . $query . '"'];
    }

    private static function t_find_contact(string $query): array {
        $rows = Contacts::search(trim($query), 10, 0);
        $out = [];
        foreach ($rows as $c) {
            $out[] = ['email' => $c->email, 'name' => $c->name, 'phone' => $c->phone, 'status' => $c->status, 'source' => $c->source];
        }
        return $out ?: ['result' => 'no contacts found'];
    }

    private static function t_volunteer_coverage(): array {
        $out = [];
        foreach (Volunteers::all_opportunity_ids() as $id) {
            $s = Volunteers::opportunity_summary($id);
            $out[] = ['title' => $s['title'], 'filled' => $s['filled'], 'capacity' => $s['capacity'], 'shifts' => $s['shifts'], 'to_review' => $s['pending'], 'open' => $s['open']];
        }
        return $out ?: ['result' => 'no volunteer opportunities'];
    }

    private static function t_campaign_stats(): array {
        $out = [];
        foreach (\OE\Mail\Campaigns::all() as $c) {
            $out[] = ['name' => $c->name, 'status' => $c->status, 'audience' => $c->audience, 'total' => (int) $c->total, 'sent' => (int) $c->sent, 'opened' => (int) $c->opened, 'clicked' => (int) $c->clicked];
            if (count($out) >= 15) {
                break;
            }
        }
        return $out ?: ['result' => 'no campaigns yet'];
    }
}
