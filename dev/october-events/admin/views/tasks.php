<?php
/** @var array $grouped  department => task[]   @var ?object $editing */
defined('ABSPATH') || exit;
use OE\Tasks\Tasks;
$counts = Tasks::counts();
?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('Tasks', 'october-events'); ?></h1>
    <p class="description">
        <?php printf(esc_html__('%1$d open · %2$d blocked · %3$d done', 'october-events'), (int) $counts['open'], (int) $counts['blocked'], (int) $counts['done']); ?>
    </p>

    <h2><?php echo $editing ? esc_html__('Edit task', 'october-events') : esc_html__('Add a task', 'october-events'); ?></h2>
    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:16px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
        <input type="hidden" name="action" value="oe_save_task">
        <input type="hidden" name="id" value="<?php echo (int) ($editing->id ?? 0); ?>">
        <?php wp_nonce_field('oe_save_task'); ?>
        <label><?php esc_html_e('Task', 'october-events'); ?><br><input type="text" name="title" required size="32" value="<?php echo esc_attr($editing->title ?? ''); ?>"></label>
        <label><?php esc_html_e('Department', 'october-events'); ?><br>
            <select name="department">
                <?php foreach (Tasks::DEPARTMENTS as $d) : ?>
                    <option value="<?php echo esc_attr($d); ?>" <?php selected(($editing->department ?? '') === $d); ?>><?php echo esc_html($d); ?></option>
                <?php endforeach; ?>
            </select></label>
        <label><?php esc_html_e('Status', 'october-events'); ?><br>
            <select name="status">
                <?php foreach (Tasks::STATUSES as $k => $lbl) : ?>
                    <option value="<?php echo esc_attr($k); ?>" <?php selected(($editing->status ?? 'todo') === $k); ?>><?php echo esc_html($lbl); ?></option>
                <?php endforeach; ?>
            </select></label>
        <label><?php esc_html_e('Due', 'october-events'); ?><br><input type="date" name="due_date" value="<?php echo esc_attr($editing->due_date ?? ''); ?>"></label>
        <label><?php esc_html_e('Assignee', 'october-events'); ?><br><input type="text" name="assignee" value="<?php echo esc_attr($editing->assignee ?? ''); ?>"></label>
        <label style="flex:1;min-width:200px"><?php esc_html_e('Notes / blockers', 'october-events'); ?><br><input type="text" name="notes" style="width:100%" value="<?php echo esc_attr($editing->notes ?? ''); ?>"></label>
        <button class="button button-primary"><?php echo $editing ? esc_html__('Update', 'october-events') : esc_html__('Add task', 'october-events'); ?></button>
        <?php if ($editing) : ?><a class="button" href="<?php echo esc_url(admin_url('admin.php?page=oe-tasks')); ?>"><?php esc_html_e('Cancel', 'october-events'); ?></a><?php endif; ?>
    </form>

    <?php if (! $grouped) : ?>
        <p style="margin-top:20px"><?php esc_html_e('No tasks yet.', 'october-events'); ?></p>
    <?php endif; ?>

    <?php foreach (Tasks::DEPARTMENTS as $dept) :
        if (empty($grouped[$dept])) { continue; } ?>
        <h2 style="margin-top:24px"><?php echo esc_html($dept); ?> <span class="description">(<?php echo count($grouped[$dept]); ?>)</span></h2>
        <table class="widefat striped">
            <thead><tr>
                <th><?php esc_html_e('Task', 'october-events'); ?></th>
                <th><?php esc_html_e('Status', 'october-events'); ?></th>
                <th><?php esc_html_e('Due', 'october-events'); ?></th>
                <th><?php esc_html_e('Assignee', 'october-events'); ?></th>
                <th><?php esc_html_e('Notes', 'october-events'); ?></th>
                <th></th>
            </tr></thead>
            <tbody>
            <?php foreach ($grouped[$dept] as $t) :
                $del = wp_nonce_url(admin_url('admin-post.php?action=oe_delete_task&id=' . $t->id), 'oe_delete_task'); ?>
                <tr class="<?php echo $t->status === 'done' ? 'oe-task-done' : ''; ?>">
                    <td><strong><?php echo esc_html($t->title); ?></strong></td>
                    <td>
                        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="display:inline">
                            <input type="hidden" name="action" value="oe_task_status">
                            <input type="hidden" name="id" value="<?php echo (int) $t->id; ?>">
                            <?php wp_nonce_field('oe_task_status'); ?>
                            <select name="status" onchange="this.form.submit()">
                                <?php foreach (Tasks::STATUSES as $k => $lbl) : ?>
                                    <option value="<?php echo esc_attr($k); ?>" <?php selected($t->status === $k); ?>><?php echo esc_html($lbl); ?></option>
                                <?php endforeach; ?>
                            </select>
                        </form>
                    </td>
                    <td><?php echo $t->due_date ? esc_html($t->due_date) : '—'; ?></td>
                    <td><?php echo esc_html($t->assignee ?: '—'); ?></td>
                    <td><?php echo esc_html($t->notes ?: ''); ?></td>
                    <td>
                        <a class="button button-small" href="<?php echo esc_url(admin_url('admin.php?page=oe-tasks&edit=' . $t->id)); ?>"><?php esc_html_e('Edit', 'october-events'); ?></a>
                        <a class="button button-small" href="<?php echo esc_url($del); ?>" onclick="return confirm('<?php echo esc_js(__('Delete this task?', 'october-events')); ?>')"><?php esc_html_e('Delete', 'october-events'); ?></a>
                    </td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    <?php endforeach; ?>
</div>
<style>.oe-task-done td{opacity:.55}.oe-task-done strong{text-decoration:line-through}</style>
