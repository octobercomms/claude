<?php
defined('ABSPATH') || exit;
/** @var array $counts @var array $contacts @var array $lists */
$rebuild_url = wp_nonce_url(admin_url('admin-post.php?action=oe_rebuild_contacts'), 'oe_rebuild_contacts');
?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('Contacts', 'october-events'); ?></h1>
    <?php \OE\Admin\Admin::bento('contacts'); ?>

    <?php if (! empty($_GET['rebuilt'])) : ?>
        <div class="notice notice-success is-dismissible"><p><?php esc_html_e('Contacts rebuilt from accounts, ticket buyers, volunteers and users.', 'october-events'); ?></p></div>
    <?php endif; ?>
    <?php if (isset($_GET['imported'])) : ?>
        <div class="notice notice-success is-dismissible"><p><?php echo esc_html(sprintf(__('Imported %d contact(s) from the CSV.', 'october-events'), (int) $_GET['imported'])); ?></p></div>
    <?php endif; ?>
    <?php $brevo = get_transient('oe_brevo_import'); if (is_array($brevo)) { delete_transient('oe_brevo_import'); ?>
        <div class="notice <?php echo ! empty($brevo['ok']) ? 'notice-success' : 'notice-error'; ?> is-dismissible"><p>
            <?php echo ! empty($brevo['ok'])
                ? esc_html(sprintf(__('Brevo import complete: %1$d contacts, %2$d lists created, %3$d list memberships.', 'october-events'), (int) ($brevo['contacts'] ?? 0), (int) ($brevo['lists_created'] ?? 0), (int) ($brevo['members'] ?? 0)))
                : esc_html__('Brevo import failed — check the file is the Brevo export CSV.', 'october-events'); ?>
        </p></div>
    <?php } ?>

    <div class="oe-panel">
        <div class="oe-cols">
            <div>
                <h3><?php esc_html_e('Your list', 'october-events'); ?></h3>
                <p class="description"><?php esc_html_e('Built automatically — no manual import needed.', 'october-events'); ?></p>
                <div class="oe-mini-stats">
                    <span><span class="v"><?php echo esc_html(number_format_i18n($counts['total'])); ?></span><span class="l"><?php esc_html_e('total', 'october-events'); ?></span></span>
                    <span><span class="v green"><?php echo esc_html(number_format_i18n($counts['subscribed'])); ?></span><span class="l"><?php esc_html_e('subscribed', 'october-events'); ?></span></span>
                    <span><span class="v"><?php echo esc_html(number_format_i18n($counts['unsubscribed'])); ?></span><span class="l"><?php esc_html_e('unsubscribed', 'october-events'); ?></span></span>
                    <span><span class="v"><?php echo esc_html(number_format_i18n($counts['sms'])); ?></span><span class="l"><?php esc_html_e('SMS opt-in', 'october-events'); ?></span></span>
                </div>
            </div>

            <div>
                <h3><?php esc_html_e('Rebuild', 'october-events'); ?></h3>
                <p class="description"><?php esc_html_e('Re-scan accounts, ticket buyers, volunteers, submitters and WordPress users, de-duplicated by email.', 'october-events'); ?></p>
                <a class="button button-primary" href="<?php echo esc_url($rebuild_url); ?>"><?php esc_html_e('Rebuild from existing data', 'october-events'); ?></a>
            </div>

            <div>
                <h3><?php esc_html_e('Import a CSV', 'october-events'); ?></h3>
                <p class="description"><?php esc_html_e('Optional — bring in an outside list (e.g. a Brevo export). We detect an “email” column, plus optional name / phone.', 'october-events'); ?></p>
                <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" enctype="multipart/form-data">
                    <input type="hidden" name="action" value="oe_import_contacts">
                    <?php wp_nonce_field('oe_import_contacts'); ?>
                    <p><input type="file" name="oe_csv" accept=".csv,text/csv" required></p>
                    <?php submit_button(__('Import contacts', 'october-events'), 'secondary', 'submit', false); ?>
                </form>
            </div>
        </div>
    </div>

    <div class="oe-panel">
        <h3><?php esc_html_e('Import from Brevo (with lists)', 'october-events'); ?></h3>
        <p class="description" style="max-width:760px"><?php esc_html_e('One-shot: upload your Brevo contact export (the CSV with the _listIds column). It captures every contact, respects email/SMS consent, and auto-creates &amp; assigns your lists (Subscribers, Event — Tours, Volunteers, etc.). Safe to re-run. Large exports can take a minute.', 'october-events'); ?></p>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" enctype="multipart/form-data">
            <input type="hidden" name="action" value="oe_import_brevo">
            <?php wp_nonce_field('oe_import_brevo'); ?>
            <p><input type="file" name="oe_brevo_csv" accept=".csv,text/csv" required></p>
            <?php submit_button(__('Import Brevo export + create lists', 'october-events'), 'primary', 'submit', false); ?>
        </form>
    </div>

    <?php if (! empty($lists)) : ?>
        <div class="oe-panel-label"><?php echo esc_html(sprintf(_n('%d list', '%d lists', count($lists), 'october-events'), number_format_i18n(count($lists)))); ?></div>
        <table class="widefat striped" style="max-width:640px">
            <thead><tr><th><?php esc_html_e('List', 'october-events'); ?></th><th><?php esc_html_e('Members', 'october-events'); ?></th></tr></thead>
            <tbody>
            <?php foreach ($lists as $l) : ?>
                <tr><td><strong><?php echo esc_html($l->name); ?></strong><?php echo $l->type === 'dynamic' ? ' <span class="oe-status">segment</span>' : ''; ?></td>
                    <td><?php echo esc_html(number_format_i18n((int) $l->member_count)); ?></td></tr>
            <?php endforeach; ?>
            </tbody>
        </table>
        <p class="description"><?php esc_html_e('Manage lists and target them in campaigns from the platform.', 'october-events'); ?></p>
    <?php endif; ?>

    <div class="oe-panel-label"><?php esc_html_e('All contacts', 'october-events'); ?></div>
    <table class="widefat striped">
        <thead><tr>
            <th><?php esc_html_e('Email', 'october-events'); ?></th>
            <th><?php esc_html_e('Name', 'october-events'); ?></th>
            <th><?php esc_html_e('Phone', 'october-events'); ?></th>
            <th><?php esc_html_e('Source', 'october-events'); ?></th>
            <th><?php esc_html_e('Status', 'october-events'); ?></th>
        </tr></thead>
        <tbody>
        <?php if (! $contacts) : ?>
            <tr><td colspan="5"><em><?php esc_html_e('No contacts yet — click “Rebuild from existing data”.', 'october-events'); ?></em></td></tr>
        <?php else : foreach ($contacts as $c) : ?>
            <tr>
                <td><?php echo esc_html($c->email); ?></td>
                <td><?php echo esc_html($c->name); ?></td>
                <td><?php echo esc_html($c->phone); ?></td>
                <td><span class="oe-status"><?php echo esc_html($c->source ?: '—'); ?></span></td>
                <td><span class="oe-status oe-status-<?php echo $c->status === 'subscribed' ? 'approved' : 'rejected'; ?>"><?php echo esc_html($c->status); ?></span></td>
            </tr>
        <?php endforeach; endif; ?>
        </tbody>
    </table>
</div>
