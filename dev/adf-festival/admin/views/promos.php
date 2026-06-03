<?php
/**
 * Promo / discount code CRUD.
 *
 * @var array      $promos
 * @var \WP_Post[] $events
 */
defined('ABSPATH') || exit;
?>
<div class="wrap adf-admin">
    <h1><?php esc_html_e('Promo Codes', 'adf-festival'); ?></h1>

    <h2><?php esc_html_e('Add a code', 'adf-festival'); ?></h2>
    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:16px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
        <input type="hidden" name="action" value="adf_save_promo">
        <?php wp_nonce_field('adf_save_promo'); ?>
        <label><?php esc_html_e('Code', 'adf-festival'); ?><br><input type="text" name="code" required style="text-transform:uppercase"></label>
        <label><?php esc_html_e('Event', 'adf-festival'); ?><br>
            <select name="event_id"><option value=""><?php esc_html_e('All events', 'adf-festival'); ?></option>
                <?php foreach ($events as $ev) : ?><option value="<?php echo (int) $ev->ID; ?>"><?php echo esc_html(get_the_title($ev)); ?></option><?php endforeach; ?>
            </select></label>
        <label><?php esc_html_e('Type', 'adf-festival'); ?><br>
            <select name="discount_type"><option value="percent">% percent</option><option value="fixed">fixed</option></select></label>
        <label><?php esc_html_e('Value', 'adf-festival'); ?><br><input type="number" step="0.01" min="0" name="discount_value" required style="width:80px"></label>
        <label><?php esc_html_e('Max uses', 'adf-festival'); ?><br><input type="number" min="0" name="max_uses" placeholder="∞" style="width:80px"></label>
        <label><?php esc_html_e('Expires', 'adf-festival'); ?><br><input type="datetime-local" name="expires_at"></label>
        <label><input type="checkbox" name="active" value="1" checked> <?php esc_html_e('Active', 'adf-festival'); ?></label>
        <button class="button button-primary"><?php esc_html_e('Save code', 'adf-festival'); ?></button>
    </form>

    <h2 style="margin-top:24px"><?php esc_html_e('Existing codes', 'adf-festival'); ?></h2>
    <table class="widefat striped">
        <thead><tr>
            <th><?php esc_html_e('Code', 'adf-festival'); ?></th><th><?php esc_html_e('Event', 'adf-festival'); ?></th>
            <th><?php esc_html_e('Discount', 'adf-festival'); ?></th><th><?php esc_html_e('Used', 'adf-festival'); ?></th>
            <th><?php esc_html_e('Expires', 'adf-festival'); ?></th><th><?php esc_html_e('Active', 'adf-festival'); ?></th><th></th>
        </tr></thead>
        <tbody>
        <?php if (! $promos) : ?><tr><td colspan="7"><?php esc_html_e('No codes yet.', 'adf-festival'); ?></td></tr><?php endif; ?>
        <?php foreach ($promos as $p) :
            $del = wp_nonce_url(admin_url('admin-post.php?action=adf_delete_promo&id=' . $p->id), 'adf_delete_promo'); ?>
            <tr>
                <td><code><?php echo esc_html($p->code); ?></code></td>
                <td><?php echo $p->event_id ? esc_html(get_the_title((int) $p->event_id)) : esc_html__('All', 'adf-festival'); ?></td>
                <td><?php echo $p->discount_type === 'percent' ? esc_html($p->discount_value . '%') : esc_html($p->discount_value); ?></td>
                <td><?php echo (int) $p->used_count; ?><?php echo $p->max_uses !== null ? ' / ' . (int) $p->max_uses : ''; ?></td>
                <td><?php echo $p->expires_at ? esc_html($p->expires_at) : '—'; ?></td>
                <td><?php echo $p->active ? '✓' : '—'; ?></td>
                <td><a class="button button-small" href="<?php echo esc_url($del); ?>" onclick="return confirm('<?php echo esc_js(__('Delete this code?', 'adf-festival')); ?>')"><?php esc_html_e('Delete', 'adf-festival'); ?></a></td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
</div>
