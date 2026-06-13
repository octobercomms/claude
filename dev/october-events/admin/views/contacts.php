<?php
defined('ABSPATH') || exit;
/** @var array $counts @var array $contacts */
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
