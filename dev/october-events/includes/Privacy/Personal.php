<?php
declare(strict_types=1);

namespace OE\Privacy;

use OE\Mail\Contacts;
use OE\Mail\Suppression;
use OE\People\Repository;
use OE\Ticketing\Schema as TicketSchema;

defined('ABSPATH') || exit;

/**
 * GDPR personal-data export and erasure (UI-SPEC §6).
 *
 * Plugs into WordPress core's privacy tools (Tools → Export / Erase Personal
 * Data), so a data subject's request runs through the same admin flow as every
 * other plugin:
 *
 *  - Exporter: gathers everything the plugin holds for an email — the marketing
 *    contact, the unified CRM person rollup, ticket orders, and volunteer
 *    signups.
 *  - Eraser: deletes the marketing contact and the CRM rollup, and suppresses
 *    the email so no further mail is sent. Ticket orders and volunteer signups
 *    are retained (accounting / legitimate-interest basis) and reported as
 *    such, which core surfaces to the operator.
 */
final class Personal {

    private const GROUP = 'october-events';

    public static function init(): void {
        add_filter('wp_privacy_personal_data_exporters', [self::class, 'register_exporter']);
        add_filter('wp_privacy_personal_data_erasers', [self::class, 'register_eraser']);
    }

    public static function register_exporter(array $exporters): array {
        $exporters[self::GROUP] = [
            'exporter_friendly_name' => __('October Events', 'october-events'),
            'callback'               => [self::class, 'export'],
        ];
        return $exporters;
    }

    public static function register_eraser(array $erasers): array {
        $erasers[self::GROUP] = [
            'eraser_friendly_name' => __('October Events', 'october-events'),
            'callback'             => [self::class, 'erase'],
        ];
        return $erasers;
    }

    /**
     * Export everything held for one email.
     *
     * @return array{data:array<int,array<string,mixed>>,done:bool}
     */
    public static function export(string $email, int $page = 1): array {
        $email = strtolower(trim($email));
        $items = [];

        if ($email !== '' && is_email($email)) {
            // Marketing contact.
            $c = Contacts::get($email);
            if ($c) {
                $items[] = [
                    'group_id'    => 'oe_contact',
                    'group_label' => __('Marketing contact', 'october-events'),
                    'item_id'     => 'oe_contact',
                    'data'        => [
                        ['name' => __('Email', 'october-events'), 'value' => (string) $c->email],
                        ['name' => __('Name', 'october-events'), 'value' => (string) ($c->name ?? '')],
                        ['name' => __('Phone', 'october-events'), 'value' => (string) ($c->phone ?? '')],
                        ['name' => __('Status', 'october-events'), 'value' => (string) ($c->status ?? '')],
                        ['name' => __('Added', 'october-events'), 'value' => (string) ($c->created_at ?? '')],
                    ],
                ];
            }

            // Unified CRM person rollup.
            $pid = Repository::id_by_email($email);
            if ($pid) {
                $p = Repository::get($pid);
                if ($p) {
                    $items[] = [
                        'group_id'    => 'oe_person',
                        'group_label' => __('CRM person', 'october-events'),
                        'item_id'     => 'oe_person',
                        'data'        => [
                            ['name' => __('Name', 'october-events'), 'value' => (string) ($p->name ?? '')],
                            ['name' => __('Phone', 'october-events'), 'value' => (string) ($p->phone ?? '')],
                            ['name' => __('Orders', 'october-events'), 'value' => (string) ($p->orders ?? 0)],
                            ['name' => __('Tickets', 'october-events'), 'value' => (string) ($p->tickets ?? 0)],
                            ['name' => __('Revenue', 'october-events'), 'value' => (string) ($p->revenue ?? 0)],
                            ['name' => __('First seen', 'october-events'), 'value' => (string) ($p->first_seen ?? '')],
                            ['name' => __('Last seen', 'october-events'), 'value' => (string) ($p->last_seen ?? '')],
                        ],
                    ];
                }
            }

            // Ticket orders.
            foreach (self::orders($email) as $o) {
                $items[] = [
                    'group_id'    => 'oe_orders',
                    'group_label' => __('Ticket orders', 'october-events'),
                    'item_id'     => 'oe_order_' . (int) $o->id,
                    'data'        => [
                        ['name' => __('Order', 'october-events'), 'value' => '#' . (int) $o->id],
                        ['name' => __('Name', 'october-events'), 'value' => (string) $o->name],
                        ['name' => __('Event', 'october-events'), 'value' => $o->event_id ? (get_the_title((int) $o->event_id) ?: ('#' . (int) $o->event_id)) : ''],
                        ['name' => __('Total', 'october-events'), 'value' => (string) $o->total . ' ' . strtoupper((string) $o->currency)],
                        ['name' => __('Status', 'october-events'), 'value' => (string) $o->status],
                        ['name' => __('Placed', 'october-events'), 'value' => (string) $o->created_at],
                    ],
                ];
            }

            // Volunteer signups.
            foreach (self::volunteer_signups($email) as $s) {
                $items[] = [
                    'group_id'    => 'oe_volunteer',
                    'group_label' => __('Volunteer signups', 'october-events'),
                    'item_id'     => 'oe_vol_' . (int) $s->id,
                    'data'        => [
                        ['name' => __('Signup', 'october-events'), 'value' => '#' . (int) $s->id],
                        ['name' => __('Name', 'october-events'), 'value' => (string) ($s->name ?? '')],
                        ['name' => __('Phone', 'october-events'), 'value' => (string) ($s->phone ?? '')],
                        ['name' => __('When', 'october-events'), 'value' => (string) ($s->created_at ?? '')],
                    ],
                ];
            }
        }

        return ['data' => $items, 'done' => true];
    }

    /**
     * Erase the marketing contact and CRM rollup, suppress the email, and
     * report ticket orders / volunteer signups as retained.
     *
     * @return array{items_removed:bool,items_retained:bool,messages:array<int,string>,done:bool}
     */
    public static function erase(string $email, int $page = 1): array {
        $email = strtolower(trim($email));
        $removed  = false;
        $retained = false;
        $messages = [];

        if ($email !== '' && is_email($email)) {
            $c = Contacts::get($email);
            if ($c) {
                Contacts::delete((int) $c->id);
                $removed = true;
            }

            if (Repository::forget($email) > 0) {
                $removed = true;
            }

            // Stop further mail regardless (retention-safe).
            Suppression::add($email, 'gdpr_erasure');

            // Operational / financial records are kept under a legal basis.
            if (self::orders($email) || self::volunteer_signups($email)) {
                $retained = true;
                $messages[] = __('Ticket orders and volunteer signups were kept as business records (accounting and legitimate-interest basis) and were not deleted.', 'october-events');
            }
        }

        return [
            'items_removed'  => $removed,
            'items_retained' => $retained,
            'messages'       => $messages,
            'done'           => true,
        ];
    }

    /** @return array<int,object> order rows for an email. */
    private static function orders(string $email): array {
        global $wpdb;
        $o = TicketSchema::orders();
        if ((string) $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $o)) !== $o) {
            return [];
        }
        return $wpdb->get_results($wpdb->prepare(
            "SELECT id, event_id, name, total, currency, status, created_at FROM {$o} WHERE email = %s ORDER BY id DESC",
            $email
        )) ?: [];
    }

    /** @return array<int,object> volunteer signup rows for an email. */
    private static function volunteer_signups(string $email): array {
        global $wpdb;
        $vs = $wpdb->prefix . 'oe_volunteer_signups';
        if ((string) $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $vs)) !== $vs) {
            return [];
        }
        return $wpdb->get_results($wpdb->prepare(
            "SELECT id, name, phone, created_at FROM {$vs} WHERE email = %s ORDER BY id DESC",
            $email
        )) ?: [];
    }
}
