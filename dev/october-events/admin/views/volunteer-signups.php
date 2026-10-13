<?php
/**
 * Volunteers — Signups lens (ADMIN-BUILD).
 *
 * Every signup across all opportunities in one flat, searchable table, for
 * triaging confirmations and no-shows without opening each opportunity. Reuses
 * the same action handlers as the Opportunities lens (confirm / decline /
 * no-show / delete), so nothing about how a signup is changed moves here.
 *
 * @var array<string,mixed> $dash  from \OE\Volunteers::dashboard()
 */
defined('ABSPATH') || exit;

if (! function_exists('oe_vol_action_url')) {
    function oe_vol_action_url(int $signup_id, string $status): string {
        return wp_nonce_url(
            admin_url('admin-post.php?action=oe_volunteer_status&status=' . $status . '&id=' . $signup_id),
            'oe_volunteer_status_' . $signup_id
        );
    }
}
if (! function_exists('oe_vol_delete_url')) {
    function oe_vol_delete_url(int $signup_id): string {
        return wp_nonce_url(
            admin_url('admin-post.php?action=oe_volunteer_delete&id=' . $signup_id),
            'oe_volunteer_delete_' . $signup_id
        );
    }
}

$opps      = (array) ($dash['opportunities'] ?? []);
$clash_ids = (array) ($dash['clash_ids'] ?? []);

// Flatten opportunities → shifts → signups into one list.
$rows = [];
foreach ($opps as $opp) {
    foreach ((array) ($opp['shifts'] ?? []) as $shift) {
        foreach ((array) ($shift['signups'] ?? []) as $s) {
            $rows[] = ['opp' => $opp, 'shift' => $shift, 's' => $s];
        }
    }
}
?>
<div class="wrap oe-admin oe-vol">
    <?php \OE\Admin\Admin::people_header('volunteers', '<a class="button" href="' . esc_url(admin_url('admin.php?page=oe-volunteers&view=compose')) . '">' . esc_html__('Message volunteers', 'october-events') . '</a>'); ?>
    <?php \OE\Admin\Admin::volunteer_lens('signups'); ?>

    <?php if (isset($_GET['oe_msg'])) : // phpcs:ignore WordPress.Security.NonceVerification -- read-only notice
        $m = sanitize_key((string) $_GET['oe_msg']);
        if ($m === 'vmove_ok') : ?>
            <div class="notice notice-success is-dismissible inline"><p><?php esc_html_e('Volunteer moved. They’ve been emailed their new shift.', 'october-events'); ?></p></div>
        <?php endif;
    endif; ?>

    <div class="oe-tix-toolbar">
        <div class="oe-section-label"><?php echo esc_html(sprintf(_n('%s signup', '%s signups', count($rows), 'october-events'), number_format_i18n(count($rows)))); ?></div>
        <input type="search" class="oe-tix-lsearch oe-vol-search" placeholder="<?php esc_attr_e('Search name, email, opportunity…', 'october-events'); ?>" aria-label="<?php esc_attr_e('Search signups', 'october-events'); ?>">
    </div>

    <?php if (! $rows) : ?>
        <div class="oe-ad-card"><strong><?php esc_html_e('No signups yet.', 'october-events'); ?></strong><br>
            <span class="description"><?php esc_html_e('Signups appear here as volunteers claim shifts. Create opportunities and shifts in the Opportunities lens.', 'october-events'); ?></span>
        </div>
    <?php else : ?>
    <div class="oe-ad-card" style="padding:0;">
        <table class="oe-ad-table oe-vol-signups">
            <thead><tr>
                <th><?php esc_html_e('Volunteer', 'october-events'); ?></th>
                <th><?php esc_html_e('Contact', 'october-events'); ?></th>
                <th><?php esc_html_e('Opportunity', 'october-events'); ?></th>
                <th><?php esc_html_e('Shift', 'october-events'); ?></th>
                <th><?php esc_html_e('Status', 'october-events'); ?></th>
                <th><?php esc_html_e('Actions', 'october-events'); ?></th>
            </tr></thead>
            <tbody>
            <?php foreach ($rows as $r) :
                $s     = $r['s'];
                $opp   = $r['opp'];
                $shift = $r['shift'];
                $hay   = strtolower(trim((string) $s->name . ' ' . (string) $s->email . ' ' . (string) ($opp['title'] ?? '')));
            ?>
                <tr data-search="<?php echo esc_attr($hay); ?>">
                    <td><strong><?php echo esc_html($s->name); ?></strong>
                        <?php if (! empty($clash_ids[(int) $s->id])) : ?>
                            <span class="oe-clash" title="<?php esc_attr_e('Booked into another shift that overlaps in time.', 'october-events'); ?>">⚠ <?php esc_html_e('clash', 'october-events'); ?></span>
                        <?php endif; ?>
                    </td>
                    <td><?php echo esc_html($s->email); ?><?php echo $s->phone ? '<br><span class="description">' . esc_html($s->phone) . ($s->sms_opt_in ? ' · SMS ✓' : '') . '</span>' : ''; ?></td>
                    <td><?php echo esc_html((string) ($opp['title'] ?? '—')); ?></td>
                    <td><?php echo esc_html((string) ($shift['label'] ?? '—')); ?></td>
                    <td><span class="oe-status oe-status-<?php echo esc_attr($s->status); ?>"><?php echo esc_html(ucwords(str_replace('_', ' ', (string) $s->status))); ?></span></td>
                    <td>
                        <a class="button button-small button-primary" href="<?php echo esc_url(oe_vol_action_url((int) $s->id, 'confirmed')); ?>"><?php esc_html_e('Confirm', 'october-events'); ?></a>
                        <a class="button button-small" href="<?php echo esc_url(oe_vol_action_url((int) $s->id, 'declined')); ?>"><?php esc_html_e('Decline', 'october-events'); ?></a>
                        <a class="button button-small" href="<?php echo esc_url(oe_vol_action_url((int) $s->id, 'no_show')); ?>"><?php esc_html_e('No-show', 'october-events'); ?></a>
                        <a class="button button-small button-link-delete" href="<?php echo esc_url(oe_vol_delete_url((int) $s->id)); ?>" onclick="return confirm('<?php echo esc_js(__('Permanently remove this signup? This frees the slot and does NOT email the volunteer.', 'october-events')); ?>');"><?php esc_html_e('Delete', 'october-events'); ?></a>
                    </td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    </div>
    <?php endif; ?>
</div>

<script>
(function () {
    var box = document.querySelector('.oe-vol-search');
    var rows = Array.prototype.slice.call(document.querySelectorAll('.oe-vol-signups tbody tr'));
    if (!box) { return; }
    box.addEventListener('input', function () {
        var q = box.value.trim().toLowerCase();
        rows.forEach(function (tr) {
            tr.hidden = q !== '' && (tr.getAttribute('data-search') || '').indexOf(q) === -1;
        });
    });
})();
</script>
