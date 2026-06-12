<?php
declare(strict_types=1);

namespace OE\Tasks;

use OE\AuditLog;

defined('ABSPATH') || exit;

/**
 * Shared task list — CRUD + queries.
 */
final class Tasks {

    public const STATUSES = ['todo' => 'To do', 'doing' => 'In progress', 'blocked' => 'Blocked', 'done' => 'Done'];

    /** Default departments (mirrors the festival's Notion task groups). */
    public const DEPARTMENTS = [
        'Admin', 'Advertising', 'Content Marketing', 'Email Marketing', 'Public Relations',
        'Media Partners', 'Partners & Sponsors', 'Social Media', 'Website Development',
        'Website Support & Maintenance', 'Uncategorized',
    ];

    /** @return array<int,object> */
    public static function all(string $department = '', string $status = ''): array {
        global $wpdb;
        $where = ['1=1'];
        $args  = [];
        if ($department !== '') { $where[] = 'department = %s'; $args[] = $department; }
        if ($status !== '')     { $where[] = 'status = %s';     $args[] = $status; }
        $sql = 'SELECT * FROM ' . self::table_or() . ' WHERE ' . implode(' AND ', $where)
            . " ORDER BY FIELD(status,'blocked','doing','todo','done'), (due_date IS NULL), due_date ASC, id DESC";
        return $args
            ? ($wpdb->get_results($wpdb->prepare($sql, ...$args)) ?: [])
            : ($wpdb->get_results($sql) ?: []);
    }

    private static function table_or(): string {
        return Schema::table();
    }

    public static function get(int $id): ?object {
        global $wpdb;
        return $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . Schema::table() . ' WHERE id = %d', $id)) ?: null;
    }

    public static function save(array $data, int $id = 0): int {
        global $wpdb;
        $row = [
            'title'      => sanitize_text_field((string) ($data['title'] ?? '')),
            'department' => in_array(($data['department'] ?? ''), self::DEPARTMENTS, true) ? $data['department'] : 'Uncategorized',
            'status'     => isset(self::STATUSES[$data['status'] ?? '']) ? $data['status'] : 'todo',
            'due_date'   => ($data['due_date'] ?? '') ?: null,
            'assignee'   => sanitize_text_field((string) ($data['assignee'] ?? '')),
            'notes'      => sanitize_textarea_field((string) ($data['notes'] ?? '')),
            'updated_at' => current_time('mysql', true),
        ];
        if ($row['title'] === '') {
            return 0;
        }
        if ($id) {
            $wpdb->update(Schema::table(), $row, ['id' => $id]);
            return $id;
        }
        $row['created_at'] = current_time('mysql', true);
        $wpdb->insert(Schema::table(), $row);
        $new = (int) $wpdb->insert_id;
        AuditLog::record('task_created', $new, 'task');
        return $new;
    }

    public static function set_status(int $id, string $status): void {
        if (! isset(self::STATUSES[$status])) {
            return;
        }
        global $wpdb;
        $wpdb->update(Schema::table(), ['status' => $status, 'updated_at' => current_time('mysql', true)], ['id' => $id]);
    }

    public static function delete(int $id): void {
        global $wpdb;
        $wpdb->delete(Schema::table(), ['id' => $id]);
    }

    /** @return array{open:int,done:int,blocked:int} */
    public static function counts(): array {
        global $wpdb;
        $t = Schema::table();
        return [
            'open'    => (int) $wpdb->get_var("SELECT COUNT(*) FROM {$t} WHERE status IN ('todo','doing')"),
            'blocked' => (int) $wpdb->get_var("SELECT COUNT(*) FROM {$t} WHERE status='blocked'"),
            'done'    => (int) $wpdb->get_var("SELECT COUNT(*) FROM {$t} WHERE status='done'"),
        ];
    }

    /** @return array<string,mixed> */
    public static function dto(object $t): array {
        return [
            'id'         => (int) $t->id,
            'title'      => $t->title,
            'department' => $t->department,
            'status'     => $t->status,
            'due_date'   => $t->due_date,
            'assignee'   => $t->assignee,
            'notes'      => $t->notes,
        ];
    }
}
