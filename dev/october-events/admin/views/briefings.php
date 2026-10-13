<?php
/**
 * Briefings & onboarding checklist manager (ROADMAP R4).
 *
 * @var array $briefings Briefings::briefings()
 * @var array $checklist Briefings::checklist()
 */
defined('ABSPATH') || exit;
$post = admin_url('admin-post.php');
?>
<div class="wrap oe-admin oe-briefings">
    <?php \OE\Admin\Admin::hub_tabs('admin', 'briefings'); ?>

    <?php if (isset($_GET['oe_msg'])) : // phpcs:ignore WordPress.Security.NonceVerification ?>
        <div class="notice notice-success is-dismissible inline"><p><?php esc_html_e('Saved.', 'october-events'); ?></p></div>
    <?php endif; ?>

    <div class="oe-ad-card" style="margin-bottom:14px;">
        <p style="margin:0;"><?php esc_html_e('Briefings are reference notes partners see in their portal. The checklist is the onboarding steps each partner ticks off; progress is tracked per partner.', 'october-events'); ?></p>
    </div>

    <div class="oe-ad-grid2">
        <div class="oe-ad-card">
            <div class="oe-ad-card-title"><?php esc_html_e('Briefings', 'october-events'); ?></div>
            <?php foreach ($briefings as $b) : ?>
                <details class="oe-brief-item">
                    <summary><strong><?php echo esc_html($b['title']); ?></strong></summary>
                    <form method="post" action="<?php echo esc_url($post); ?>" style="margin-top:8px;display:grid;gap:8px;">
                        <input type="hidden" name="action" value="oe_briefing_save">
                        <input type="hidden" name="id" value="<?php echo esc_attr($b['id']); ?>">
                        <?php wp_nonce_field('oe_briefing_save'); ?>
                        <input type="text" name="title" value="<?php echo esc_attr($b['title']); ?>" required>
                        <textarea name="body" rows="3"><?php echo esc_textarea($b['body']); ?></textarea>
                        <input type="url" name="link" value="<?php echo esc_attr($b['link']); ?>" placeholder="https://…">
                        <p style="margin:0;display:flex;gap:8px;">
                            <button class="button button-small button-primary"><?php esc_html_e('Save', 'october-events'); ?></button>
                            <a class="button button-small button-link-delete" href="<?php echo esc_url(wp_nonce_url(add_query_arg(['action' => 'oe_briefing_delete', 'id' => $b['id']], $post), 'oe_briefing_delete_' . $b['id'])); ?>" onclick="return confirm('<?php echo esc_js(__('Delete this briefing?', 'october-events')); ?>');"><?php esc_html_e('Delete', 'october-events'); ?></a>
                        </p>
                    </form>
                </details>
            <?php endforeach; ?>
            <form method="post" action="<?php echo esc_url($post); ?>" style="margin-top:12px;display:grid;gap:8px;border-top:1px solid #e3e2db;padding-top:12px;">
                <input type="hidden" name="action" value="oe_briefing_save">
                <?php wp_nonce_field('oe_briefing_save'); ?>
                <strong><?php esc_html_e('New briefing', 'october-events'); ?></strong>
                <input type="text" name="title" placeholder="<?php esc_attr_e('Title', 'october-events'); ?>" required>
                <textarea name="body" rows="3" placeholder="<?php esc_attr_e('Body', 'october-events'); ?>"></textarea>
                <input type="url" name="link" placeholder="<?php esc_attr_e('Optional link', 'october-events'); ?>">
                <p style="margin:0;"><button class="button button-small button-primary"><?php esc_html_e('Add briefing', 'october-events'); ?></button></p>
            </form>
        </div>

        <div class="oe-ad-card">
            <div class="oe-ad-card-title"><?php esc_html_e('Onboarding checklist', 'october-events'); ?></div>
            <?php foreach ($checklist as $c) : ?>
                <form method="post" action="<?php echo esc_url($post); ?>" class="oe-check-item" style="display:grid;gap:6px;border-bottom:1px solid #f0efe9;padding:8px 0;">
                    <input type="hidden" name="action" value="oe_checkitem_save">
                    <input type="hidden" name="id" value="<?php echo esc_attr($c['id']); ?>">
                    <?php wp_nonce_field('oe_checkitem_save'); ?>
                    <input type="text" name="label" value="<?php echo esc_attr($c['label']); ?>" required>
                    <input type="text" name="desc" value="<?php echo esc_attr($c['desc']); ?>" placeholder="<?php esc_attr_e('Short hint (optional)', 'october-events'); ?>">
                    <p style="margin:0;display:flex;gap:8px;">
                        <button class="button button-small"><?php esc_html_e('Save', 'october-events'); ?></button>
                        <a class="button button-small button-link-delete" href="<?php echo esc_url(wp_nonce_url(add_query_arg(['action' => 'oe_checkitem_delete', 'id' => $c['id']], $post), 'oe_checkitem_delete_' . $c['id'])); ?>" onclick="return confirm('<?php echo esc_js(__('Delete this item?', 'october-events')); ?>');"><?php esc_html_e('Delete', 'october-events'); ?></a>
                    </p>
                </form>
            <?php endforeach; ?>
            <form method="post" action="<?php echo esc_url($post); ?>" style="margin-top:12px;display:grid;gap:8px;">
                <input type="hidden" name="action" value="oe_checkitem_save">
                <?php wp_nonce_field('oe_checkitem_save'); ?>
                <strong><?php esc_html_e('New checklist item', 'october-events'); ?></strong>
                <input type="text" name="label" placeholder="<?php esc_attr_e('Step', 'october-events'); ?>" required>
                <input type="text" name="desc" placeholder="<?php esc_attr_e('Short hint (optional)', 'october-events'); ?>">
                <p style="margin:0;"><button class="button button-small button-primary"><?php esc_html_e('Add item', 'october-events'); ?></button></p>
            </form>
        </div>
    </div>
</div>
