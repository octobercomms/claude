<?php
declare(strict_types=1);

namespace OE\Porter;

use OE\PostTypes;
use OE\Planning\Events;

defined('ABSPATH') || exit;

/**
 * Entity exporter (ADMIN-BUILD AD13). Streams any supported entity as CSV or
 * JSON. Each entity declares its columns and a row provider; providers are
 * defensive so a missing model never fatals the screen.
 */
final class Exporter {

    /** @return array<string,string> entity key => label */
    public static function entities(): array {
        return [
            'people'     => __('People (CRM)', 'october-events'),
            'contacts'   => __('Contacts', 'october-events'),
            'team'       => __('Team / crew', 'october-events'),
            'volunteers' => __('Volunteer signups', 'october-events'),
            'events'     => __('Events', 'october-events'),
            'accounts'   => __('Accounts', 'october-events'),
            'campaigns'  => __('Campaigns', 'october-events'),
        ];
    }

    /**
     * Columns + rows for one entity.
     *
     * @return array{columns:array<int,string>,rows:array<int,array<string,mixed>>}
     */
    public static function dataset(string $entity): array {
        switch ($entity) {
            case 'people':     return self::people();
            case 'contacts':   return self::contacts();
            case 'team':       return self::team();
            case 'volunteers': return self::volunteers();
            case 'events':     return self::events();
            case 'accounts':   return self::accounts();
            case 'campaigns':  return self::campaigns();
        }
        return ['columns' => [], 'rows' => []];
    }

    public static function stream(string $entity, string $format): void {
        $data = self::dataset($entity);
        $file = 'oe-' . $entity . '-' . gmdate('Ymd') . '.' . ($format === 'json' ? 'json' : 'csv');
        nocache_headers();
        if ($format === 'json') {
            header('Content-Type: application/json; charset=utf-8');
            header('Content-Disposition: attachment; filename="' . $file . '"');
            echo wp_json_encode($data['rows']);
            exit;
        }
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $file . '"');
        $out = fopen('php://output', 'w');
        fputcsv($out, $data['columns']);
        foreach ($data['rows'] as $row) {
            $line = [];
            foreach ($data['columns'] as $col) {
                $line[] = $row[$col] ?? '';
            }
            fputcsv($out, $line);
        }
        fclose($out);
        exit;
    }

    /* --------------------------------------------------------- providers */

    private static function people(): array {
        $cols = ['email', 'name', 'phone', 'orders', 'tickets', 'revenue', 'volunteer', 'pool', 'subscribed', 'last_seen'];
        $rows = [];
        if (class_exists('\\OE\\People\\Repository')) {
            foreach (\OE\People\Repository::search('', 100000) as $p) {
                $rows[] = [
                    'email' => $p->email, 'name' => $p->name, 'phone' => $p->phone,
                    'orders' => (int) $p->orders, 'tickets' => (int) $p->tickets, 'revenue' => $p->revenue,
                    'volunteer' => (int) $p->volunteer, 'pool' => (int) $p->pool,
                    'subscribed' => (int) $p->subscribed, 'last_seen' => $p->last_seen,
                ];
            }
        }
        return ['columns' => $cols, 'rows' => $rows];
    }

    private static function contacts(): array {
        $cols = ['email', 'name', 'phone', 'status', 'sms_opt_in', 'source', 'created_at'];
        $rows = [];
        if (class_exists('\\OE\\Mail\\Contacts')) {
            foreach (\OE\Mail\Contacts::search('', 100000) as $c) {
                $rows[] = [
                    'email' => $c->email, 'name' => $c->name, 'phone' => $c->phone,
                    'status' => $c->status, 'sms_opt_in' => (int) $c->sms_opt_in,
                    'source' => $c->source, 'created_at' => $c->created_at,
                ];
            }
        }
        return ['columns' => $cols, 'rows' => $rows];
    }

    private static function team(): array {
        $cols = ['tier', 'name', 'email', 'phone', 'role_title', 'role_owns', 'hours_month', 'status', 'term_start', 'term_end', 'role_email'];
        $rows = [];
        if (class_exists('\\OE\\Crew\\Crew')) {
            foreach (\OE\Crew\Crew::all() as $r) {
                $row = [];
                foreach ($cols as $c) { $row[$c] = $r->$c ?? ''; }
                $rows[] = $row;
            }
        }
        return ['columns' => $cols, 'rows' => $rows];
    }

    private static function volunteers(): array {
        global $wpdb;
        $cols = ['name', 'email', 'phone', 'opportunity', 'shift', 'status', 'checked_in', 'created_at'];
        $rows = [];
        if (class_exists('\\OE\\VolunteerSignups')) {
            $res = $wpdb->get_results('SELECT * FROM ' . \OE\VolunteerSignups::table() . ' ORDER BY created_at DESC') ?: [];
            foreach ($res as $r) {
                $rows[] = [
                    'name' => $r->name, 'email' => $r->email, 'phone' => $r->phone,
                    'opportunity' => get_the_title((int) $r->opportunity_id),
                    'shift' => $r->shift_id, 'status' => $r->status,
                    'checked_in' => $r->checked_in ? 'yes' : 'no', 'created_at' => $r->created_at,
                ];
            }
        }
        return ['columns' => $cols, 'rows' => $rows];
    }

    private static function events(): array {
        $cols = ['id', 'title', 'status', 'start', 'location'];
        $rows = [];
        $pt = PostTypes::slug('event');
        if ($pt !== '' && post_type_exists($pt)) {
            $ids = get_posts(['post_type' => $pt, 'post_status' => 'any', 'posts_per_page' => 100000, 'fields' => 'ids']);
            foreach ($ids as $id) {
                $rows[] = [
                    'id' => (int) $id,
                    'title' => get_the_title((int) $id),
                    'status' => get_post_status((int) $id),
                    'start' => class_exists('\\OE\\Planning\\Events') ? (string) Events::get((int) $id, 'start_datetime', '') : '',
                    'location' => class_exists('\\OE\\Planning\\Events') ? (string) Events::get((int) $id, 'location', '') : '',
                ];
            }
        }
        return ['columns' => $cols, 'rows' => $rows];
    }

    private static function accounts(): array {
        $cols = ['id', 'name', 'email', 'status'];
        $rows = [];
        $pt = PostTypes::slug('account');
        if ($pt !== '' && post_type_exists($pt)) {
            $ids = get_posts(['post_type' => $pt, 'post_status' => 'any', 'posts_per_page' => 100000, 'fields' => 'ids']);
            foreach ($ids as $id) {
                $rows[] = [
                    'id' => (int) $id,
                    'name' => get_the_title((int) $id),
                    'email' => (string) get_post_meta((int) $id, '_oe_email', true),
                    'status' => (string) get_post_meta((int) $id, '_oe_account_status', true) ?: 'active',
                ];
            }
        }
        return ['columns' => $cols, 'rows' => $rows];
    }

    private static function campaigns(): array {
        $cols = ['id', 'name', 'subject', 'audience', 'status', 'total', 'sent', 'opened', 'clicked', 'sent_at'];
        $rows = [];
        if (class_exists('\\OE\\Mail\\Campaigns')) {
            foreach (\OE\Mail\Campaigns::all() as $c) {
                $rows[] = [
                    'id' => (int) $c->id, 'name' => $c->name, 'subject' => $c->subject,
                    'audience' => $c->audience, 'status' => $c->status,
                    'total' => (int) $c->total, 'sent' => (int) $c->sent,
                    'opened' => (int) $c->opened, 'clicked' => (int) $c->clicked,
                    'sent_at' => $c->sent_at,
                ];
            }
        }
        return ['columns' => $cols, 'rows' => $rows];
    }
}
