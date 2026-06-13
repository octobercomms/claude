<?php
defined('ABSPATH') || exit;
/** @var array $counts @var array $contacts @var array $lists */
$rebuild_url = wp_nonce_url(admin_url('admin-post.php?action=oe_rebuild_contacts'), 'oe_rebuild_contacts');
$cleanup_url = wp_nonce_url(admin_url('admin-post.php?action=oe_cleanup_contacts'), 'oe_cleanup_contacts');
$to_clean    = \OE\Mail\Enrich::remaining();

$tabs = [
    'overview' => __('Overview', 'october-events'),
    'lists'    => __('Lists', 'october-events'),
    'contacts' => __('Contacts', 'october-events'),
    'tools'    => __('Import & clean', 'october-events'),
];
$tab = isset($_GET['tab']) && isset($tabs[$_GET['tab']]) ? sanitize_key((string) $_GET['tab']) : 'overview';
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
    <?php $cleaned = get_transient('oe_cleanup_done'); if ($cleaned !== false) { delete_transient('oe_cleanup_done'); ?>
        <div class="notice notice-success is-dismissible"><p><?php echo esc_html(sprintf(__('Cleaned up %d contact(s) — tidied names and derived companies from email.', 'october-events'), (int) $cleaned)); ?></p></div>
    <?php } ?>

    <h2 class="nav-tab-wrapper">
        <?php foreach ($tabs as $key => $label) :
            $count = $key === 'lists' ? count($lists) : ($key === 'contacts' ? (int) $counts['total'] : 0); ?>
            <a class="nav-tab <?php echo $tab === $key ? 'nav-tab-active' : ''; ?>" href="<?php echo esc_url(admin_url('admin.php?page=oe-contacts&tab=' . $key)); ?>">
                <?php echo esc_html($label); ?><?php echo in_array($key, ['lists', 'contacts'], true) ? ' <span class="oe-status">' . esc_html(number_format_i18n($count)) . '</span>' : ''; ?>
            </a>
        <?php endforeach; ?>
    </h2>

    <?php if ($tab === 'overview') : ?>
        <div class="oe-panel-label"><?php esc_html_e('Your list, at a glance', 'october-events'); ?></div>
        <div class="oe-kpis">
            <div class="oe-kpi dark"><div class="k"><?php esc_html_e('Total', 'october-events'); ?></div><div class="v"><?php echo esc_html(number_format_i18n($counts['total'])); ?></div><div class="s"><?php esc_html_e('contacts', 'october-events'); ?></div></div>
            <div class="oe-kpi"><div class="k"><?php esc_html_e('Subscribed', 'october-events'); ?></div><div class="v"><?php echo esc_html(number_format_i18n($counts['subscribed'])); ?></div><div class="s"><i class="dot green"></i><?php esc_html_e('can receive email', 'october-events'); ?></div></div>
            <div class="oe-kpi"><div class="k"><?php esc_html_e('Unsubscribed', 'october-events'); ?></div><div class="v"><?php echo esc_html(number_format_i18n($counts['unsubscribed'])); ?></div><div class="s"><?php esc_html_e('opted out', 'october-events'); ?></div></div>
            <div class="oe-kpi"><div class="k"><?php esc_html_e('SMS opt-in', 'october-events'); ?></div><div class="v"><?php echo esc_html(number_format_i18n($counts['sms'])); ?></div><div class="s"><?php esc_html_e('phone consented', 'october-events'); ?></div></div>
        </div>
        <p class="description"><?php echo esc_html(sprintf(__('%1$s contacts across %2$s lists. Built automatically from accounts, ticket buyers, volunteers, submitters and users — manage lists and send from the platform.', 'october-events'), number_format_i18n($counts['total']), number_format_i18n(count($lists)))); ?>
            <?php if ($to_clean > 0) { echo ' <strong>' . esc_html(sprintf(__('%s still to clean up — see Import & clean.', 'october-events'), number_format_i18n($to_clean))) . '</strong>'; } ?></p>

    <?php elseif ($tab === 'lists') : ?>
        <?php if (! $lists) : ?>
            <table class="widefat"><tbody><tr><td style="padding:26px 16px"><strong><?php esc_html_e('No lists yet.', 'october-events'); ?></strong>
                <span class="description"><?php esc_html_e('Import a Brevo export (Import & clean) to create them, or build lists in the platform.', 'october-events'); ?></span></td></tr></tbody></table>
        <?php else : ?>
            <table class="widefat striped" style="max-width:680px">
                <thead><tr><th><?php esc_html_e('List', 'october-events'); ?></th><th><?php esc_html_e('Type', 'october-events'); ?></th><th><?php esc_html_e('Members', 'october-events'); ?></th></tr></thead>
                <tbody>
                <?php foreach ($lists as $l) : ?>
                    <tr>
                        <td><strong><?php echo esc_html($l->name); ?></strong></td>
                        <td><span class="oe-status"><?php echo esc_html($l->type === 'dynamic' ? __('segment', 'october-events') : __('list', 'october-events')); ?></span></td>
                        <td><?php echo esc_html(number_format_i18n((int) $l->member_count)); ?></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
            <p class="description"><?php esc_html_e('Manage lists, build segments and target them in campaigns from the platform.', 'october-events'); ?></p>
        <?php endif; ?>

    <?php elseif ($tab === 'contacts') : ?>
        <table class="widefat striped">
            <thead><tr>
                <th><?php esc_html_e('Email', 'october-events'); ?></th>
                <th><?php esc_html_e('Name', 'october-events'); ?></th>
                <th><?php esc_html_e('Company', 'october-events'); ?></th>
                <th><?php esc_html_e('Source', 'october-events'); ?></th>
                <th><?php esc_html_e('Status', 'october-events'); ?></th>
            </tr></thead>
            <tbody>
            <?php if (! $contacts) : ?>
                <tr><td colspan="5"><em><?php esc_html_e('No contacts yet — see Import & clean.', 'october-events'); ?></em></td></tr>
            <?php else : foreach ($contacts as $c) : ?>
                <tr>
                    <td><?php echo esc_html($c->email); ?></td>
                    <td><?php echo esc_html($c->name); ?></td>
                    <td><?php echo esc_html((string) ($c->company ?? '') ?: '—'); ?></td>
                    <td><span class="oe-status"><?php echo esc_html($c->source ?: '—'); ?></span></td>
                    <td><span class="oe-status oe-status-<?php echo $c->status === 'subscribed' ? 'approved' : 'rejected'; ?>"><?php echo esc_html($c->status); ?></span></td>
                </tr>
            <?php endforeach; endif; ?>
            </tbody>
        </table>
        <p class="description"><?php esc_html_e('Showing the most recent 50. Search and full management live in the platform.', 'october-events'); ?></p>

    <?php else : // tools ?>
        <div class="oe-cols">
            <div class="oe-panel">
                <h3><?php esc_html_e('Import from Brevo (with lists)', 'october-events'); ?></h3>
                <p class="description"><?php esc_html_e('Upload your Brevo export (the CSV with the _listIds column). Captures every contact, respects email/SMS consent, and auto-creates & assigns your lists. Safe to re-run; large exports take a minute.', 'october-events'); ?></p>
                <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" enctype="multipart/form-data">
                    <input type="hidden" name="action" value="oe_import_brevo">
                    <?php wp_nonce_field('oe_import_brevo'); ?>
                    <p><input type="file" name="oe_brevo_csv" accept=".csv,text/csv" required></p>
                    <?php submit_button(__('Import Brevo + create lists', 'october-events'), 'primary', 'submit', false); ?>
                </form>
            </div>

            <div class="oe-panel">
                <h3><?php esc_html_e('Clean up', 'october-events'); ?></h3>
                <p class="description"><?php esc_html_e('Tidy names and derive each contact’s company from their email domain.', 'october-events'); ?>
                    <?php if ($to_clean > 0) { echo ' <strong>' . esc_html(sprintf(__('%s to do.', 'october-events'), number_format_i18n($to_clean))) . '</strong>'; } else { echo ' ' . esc_html__('All clean.', 'october-events'); } ?></p>
                <a class="button button-primary" href="<?php echo esc_url($cleanup_url); ?>"><?php echo $to_clean > 0 ? esc_html(sprintf(__('Run cleanup (%s)', 'october-events'), number_format_i18n($to_clean))) : esc_html__('Run cleanup', 'october-events'); ?></a>
            </div>

            <div class="oe-panel">
                <h3><?php esc_html_e('Rebuild from site data', 'october-events'); ?></h3>
                <p class="description"><?php esc_html_e('Re-scan accounts, ticket buyers, volunteers, submitters and WordPress users, de-duplicated by email.', 'october-events'); ?></p>
                <a class="button" href="<?php echo esc_url($rebuild_url); ?>"><?php esc_html_e('Rebuild', 'october-events'); ?></a>
            </div>

            <div class="oe-panel">
                <h3><?php esc_html_e('Import a plain CSV', 'october-events'); ?></h3>
                <p class="description"><?php esc_html_e('A simple list with an “email” column (+ optional name / phone). For Brevo exports with lists, use the Brevo importer.', 'october-events'); ?></p>
                <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" enctype="multipart/form-data">
                    <input type="hidden" name="action" value="oe_import_contacts">
                    <?php wp_nonce_field('oe_import_contacts'); ?>
                    <p><input type="file" name="oe_csv" accept=".csv,text/csv" required></p>
                    <?php submit_button(__('Import contacts', 'october-events'), 'secondary', 'submit', false); ?>
                </form>
            </div>
        </div>
    <?php endif; ?>
</div>
