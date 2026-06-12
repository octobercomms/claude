<?php
declare(strict_types=1);

namespace OE\Admin;

use OE\Tasks\Tasks;

defined('ABSPATH') || exit;

/**
 * Shared Tasks admin screen — list grouped by department, add/edit, quick
 * status change and delete. The same data is exposed to the platform via REST.
 */
final class TasksAdmin {

    private static ?TasksAdmin $instance = null;

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public function init(): void {
        add_action('admin_post_oe_save_task', [$this, 'handle_save']);
        add_action('admin_post_oe_task_status', [$this, 'handle_status']);
        add_action('admin_post_oe_delete_task', [$this, 'handle_delete']);
    }

    public function render(): void {
        $editing = isset($_GET['edit']) ? Tasks::get(absint($_GET['edit'])) : null;
        $tasks   = Tasks::all();
        $grouped = [];
        foreach ($tasks as $t) {
            $grouped[$t->department][] = $t;
        }
        require OE_DIR . 'admin/views/tasks.php';
    }

    public function handle_save(): void {
        $this->guard('oe_save_task');
        Tasks::save([
            'title'      => $_POST['title'] ?? '',
            'department' => $_POST['department'] ?? 'Uncategorized',
            'status'     => $_POST['status'] ?? 'todo',
            'due_date'   => $_POST['due_date'] ?? '',
            'assignee'   => $_POST['assignee'] ?? '',
            'notes'      => $_POST['notes'] ?? '',
        ], absint($_POST['id'] ?? 0));
        wp_safe_redirect(admin_url('admin.php?page=oe-tasks'));
        exit;
    }

    public function handle_status(): void {
        $this->guard('oe_task_status');
        Tasks::set_status(absint($_REQUEST['id'] ?? 0), sanitize_key((string) ($_REQUEST['status'] ?? '')));
        wp_safe_redirect(wp_get_referer() ?: admin_url('admin.php?page=oe-tasks'));
        exit;
    }

    public function handle_delete(): void {
        $this->guard('oe_delete_task');
        Tasks::delete(absint($_REQUEST['id'] ?? 0));
        wp_safe_redirect(admin_url('admin.php?page=oe-tasks'));
        exit;
    }

    private function guard(string $action): void {
        if (! current_user_can('edit_posts')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        check_admin_referer($action);
    }
}
