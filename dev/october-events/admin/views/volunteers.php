<?php
/**
 * Volunteers admin dashboard.
 *
 * @var array<string,mixed> $dash  from \OE\Volunteers::dashboard():
 *   'kpis' => [opportunities, shifts, slots, filled, pct, needing]
 *   'opportunities' => [ {id,title,role,location,edit_url,open,capacity,filled,pct,shifts:[{id,label,start,end,capacity,active,left,pct,signups:[row]}]} ]
 *   'clashes' => [ {name,email,count,overlap,items:[{opp_title,shift_label,...}]} ]
 *   'clash_ids' => [ signup_id => true ]
 */
defined('ABSPATH') || exit;
use OE\Volunteers;

$export = wp_nonce_url(admin_url('admin.php?page=oe-volunteers&oe_export=volunteers'), 'oe_export');

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

$kpis      = (array) ($dash['kpis'] ?? []);
$opps      = (array) ($dash['opportunities'] ?? []);
$clashes   = (array) ($dash['clashes'] ?? []);
$clash_ids = (array) ($dash['clash_ids'] ?? []);

// Distinct past/present volunteers, for the "choose an existing volunteer"
// picker on each shift's Add form (pre-fills name/email/phone).
$known = Volunteers::known_volunteers();

// Every shift with room, as move targets: value "oppId:shiftId".
$move_opts = [];
foreach ($opps as $mo) {
    foreach ((array) ($mo['shifts'] ?? []) as $msh) {
        if ((int) ($msh['left'] ?? 0) > 0) {
            $label = (string) ($msh['label'] ?? '') !== '' ? (string) $msh['label'] : (string) $msh['id'];
            $move_opts[] = [
                'value' => (int) $mo['id'] . ':' . (string) $msh['id'],
                'label' => (string) $mo['title'] . ' — ' . $label . ' (' . (int) $msh['left'] . ' ' . __('left', 'october-events') . ')',
            ];
        }
    }
}
?>
<div class="wrap oe-admin oe-vol">
    <h1><?php esc_html_e('Volunteers', 'october-events'); ?>
        <a href="<?php echo esc_url($export); ?>" class="page-title-action"><?php esc_html_e('Export CSV', 'october-events'); ?></a>
    </h1>

    <?php if (isset($_GET['oe_msg'])) : // phpcs:ignore WordPress.Security.NonceVerification -- read-only notice
        $m = sanitize_key((string) $_GET['oe_msg']);
        if ($m === 'vmove_ok') : ?>
            <div class="notice notice-success is-dismissible inline"><p><?php esc_html_e('Volunteer moved. They’ve been emailed their new shift.', 'october-events'); ?></p></div>
        <?php elseif ($m === 'vmove_fail') : ?>
            <div class="notice notice-error is-dismissible inline"><p><?php esc_html_e('Couldn’t move them — the target shift may be full or already theirs.', 'october-events'); ?></p></div>
        <?php elseif ($m === 'vadd_ok') : ?>
            <div class="notice notice-success is-dismissible inline"><p><?php esc_html_e('Volunteer added to the shift. They’ve been emailed a confirmation.', 'october-events'); ?></p></div>
        <?php elseif ($m === 'vadd_fail') : ?>
            <div class="notice notice-error is-dismissible inline"><p><?php esc_html_e('Couldn’t add them — check the name and email, or they may already be on that shift.', 'october-events'); ?></p></div>
        <?php endif;
    endif; ?>

    <?php
    $k_pct     = (int) ($kpis['pct'] ?? 0);
    $k_dot     = Volunteers::fill_color($k_pct);
    $k_needing = (int) ($kpis['needing'] ?? 0);
    ?>
    <div class="oe-kpis">
        <div class="oe-kpi dark">
            <div class="k"><?php esc_html_e('Live opportunities', 'october-events'); ?></div>
            <div class="v"><?php echo (int) ($kpis['opportunities'] ?? 0); ?></div>
            <div class="s"><?php echo esc_html(sprintf(_n('%d shift', '%d shifts', (int) ($kpis['shifts'] ?? 0), 'october-events'), (int) ($kpis['shifts'] ?? 0))); ?></div>
        </div>
        <div class="oe-kpi">
            <div class="k"><?php esc_html_e('Total slots', 'october-events'); ?></div>
            <div class="v"><?php echo (int) ($kpis['slots'] ?? 0); ?></div>
            <div class="s"><?php esc_html_e('across all shifts', 'october-events'); ?></div>
        </div>
        <div class="oe-kpi">
            <div class="k"><?php esc_html_e('Filled', 'october-events'); ?></div>
            <div class="v"><?php echo (int) ($kpis['filled'] ?? 0); ?></div>
            <div class="s"><i class="dot <?php echo esc_attr($k_dot); ?>"></i><?php echo esc_html(sprintf(__('%d%% of slots filled', 'october-events'), $k_pct)); ?></div>
        </div>
        <div class="oe-kpi">
            <div class="k"><?php esc_html_e('Shifts needing help', 'october-events'); ?></div>
            <div class="v"><?php echo (int) $k_needing; ?></div>
            <div class="s"><?php esc_html_e('under half full', 'october-events'); ?></div>
        </div>
    </div>

    <div class="oe-actionbar">
        <a class="button button-primary" href="<?php echo esc_url(admin_url('post-new.php?post_type=' . Volunteers::slug())); ?>"><?php esc_html_e('+ New opportunity', 'october-events'); ?></a>
        <a class="button" href="<?php echo esc_url(admin_url('admin.php?page=oe-volunteers&view=compose')); ?>"><?php esc_html_e('✉ Message volunteers', 'october-events'); ?></a>
        <span class="description"><?php esc_html_e('Each opportunity has time shifts with limited slots. Green = full, amber = half, red = needs volunteers.', 'october-events'); ?></span>
    </div>

    <?php if ($clashes) : ?>
        <?php
        $overlaps = array_filter($clashes, static fn($c) => ! empty($c['overlap']));
        $multi    = array_filter($clashes, static fn($c) => empty($c['overlap']));
        ?>
        <?php if ($overlaps) : ?>
        <div class="notice notice-error inline oe-clash-box">
            <p><strong><?php esc_html_e('Time clashes — same volunteer, overlapping shifts:', 'october-events'); ?></strong></p>
            <ul>
            <?php foreach ($overlaps as $c) : ?>
                <li>
                    <strong><?php echo esc_html($c['name']); ?></strong>
                    <span class="description"><?php echo esc_html($c['email']); ?></span> —
                    <?php
                    $bits = [];
                    foreach ((array) $c['items'] as $it) {
                        $bits[] = $it['opp_title'] . ' (' . $it['shift_label'] . ')';
                    }
                    echo esc_html(implode('  ·  ', $bits));
                    ?>
                </li>
            <?php endforeach; ?>
            </ul>
            <p class="description"><?php esc_html_e('These overlap in time — check they aren’t double-booked in two places at once.', 'october-events'); ?></p>
        </div>
        <?php endif; ?>
        <?php if ($multi) : ?>
        <div class="notice notice-warning inline oe-clash-box">
            <p><strong><?php esc_html_e('Volunteering for more than one shift (no time overlap detected):', 'october-events'); ?></strong></p>
            <ul>
            <?php foreach ($multi as $c) : ?>
                <li>
                    <strong><?php echo esc_html($c['name']); ?></strong>
                    <span class="description"><?php echo esc_html($c['email']); ?></span> —
                    <?php echo esc_html(sprintf(_n('%d shift', '%d shifts', (int) $c['count'], 'october-events'), (int) $c['count'])); ?>
                </li>
            <?php endforeach; ?>
            </ul>
        </div>
        <?php endif; ?>
    <?php endif; ?>

    <?php if (! $opps) : ?>
        <p><?php esc_html_e('No volunteer opportunities yet. Create one under the Volunteer post type.', 'october-events'); ?></p>
    <?php endif; ?>

    <?php foreach ($opps as $opp) :
        $ocolor = Volunteers::fill_color((int) $opp['pct']);
    ?>
        <details class="oe-acc oe-vol-opp">
            <summary>
                <span class="oe-vol-title">
                    <?php echo esc_html($opp['title']); ?>
                    <?php if (! empty($opp['role'])) : ?><span class="description"><?php echo esc_html($opp['role']); ?></span><?php endif; ?>
                    <?php if (empty($opp['open'])) : ?><span class="oe-status" style="margin-left:6px"><?php esc_html_e('signups closed', 'october-events'); ?></span><?php endif; ?>
                </span>
                <span class="oe-vol-sum">
                    <span class="oe-fillbar fill-<?php echo esc_attr($ocolor); ?>" aria-hidden="true"><span style="width:<?php echo (int) $opp['pct']; ?>%"></span></span>
                    <span class="oe-vol-count"><?php echo (int) $opp['filled']; ?>/<?php echo (int) $opp['capacity']; ?></span>
                    <span class="oe-vol-dot <?php echo esc_attr($ocolor); ?>"></span>
                </span>
            </summary>
            <div class="oe-acc-body">
                <p><a href="<?php echo esc_url($opp['edit_url']); ?>" class="button button-small"><?php esc_html_e('Edit opportunity', 'october-events'); ?></a>
                    <?php if (! empty($opp['location'])) : ?><span class="description" style="margin-left:8px"><?php echo esc_html($opp['location']); ?></span><?php endif; ?>
                </p>

                <?php foreach ((array) $opp['shifts'] as $shift) :
                    $scolor  = Volunteers::fill_color((int) $shift['pct']);
                    $signups = (array) $shift['signups'];
                ?>
                    <div class="oe-vol-shift">
                        <div class="oe-vol-shift-head">
                            <strong><?php echo esc_html($shift['label']); ?></strong>
                            <span class="oe-fillbar fill-<?php echo esc_attr($scolor); ?>"><span style="width:<?php echo (int) $shift['pct']; ?>%"></span></span>
                            <span class="oe-vol-count"><?php echo (int) $shift['active']; ?>/<?php echo (int) $shift['capacity']; ?>
                                <span class="description">— <?php echo (int) $shift['left']; ?> <?php esc_html_e('open', 'october-events'); ?></span>
                            </span>
                        </div>
                        <table class="widefat striped oe-vol-table">
                            <thead><tr>
                                <th><?php esc_html_e('Name', 'october-events'); ?></th>
                                <th><?php esc_html_e('Contact', 'october-events'); ?></th>
                                <th><?php esc_html_e('Status', 'october-events'); ?></th>
                                <th><?php esc_html_e('Reminders', 'october-events'); ?></th>
                                <th><?php esc_html_e('Actions', 'october-events'); ?></th>
                            </tr></thead>
                            <tbody>
                            <?php if (! $signups) : ?>
                                <tr><td colspan="5"><?php esc_html_e('No signups yet.', 'october-events'); ?></td></tr>
                            <?php endif; ?>
                            <?php foreach ($signups as $s) : ?>
                                <tr>
                                    <td><strong><?php echo esc_html($s->name); ?></strong>
                                        <?php if (! empty($clash_ids[(int) $s->id])) : ?>
                                            <span class="oe-clash" title="<?php esc_attr_e('This volunteer is booked into another shift that overlaps in time.', 'october-events'); ?>">⚠ <?php esc_html_e('clash', 'october-events'); ?></span>
                                        <?php endif; ?>
                                    </td>
                                    <td><?php echo esc_html($s->email); ?><?php echo $s->phone ? '<br><span class="description">' . esc_html($s->phone) . ($s->sms_opt_in ? ' · SMS ✓' : '') . '</span>' : ''; ?></td>
                                    <td><span class="oe-status oe-status-<?php echo esc_attr($s->status); ?>"><?php echo esc_html(ucwords(str_replace('_', ' ', $s->status))); ?></span></td>
                                    <td><?php echo esc_html($s->reminders_sent ?: '—'); ?></td>
                                    <td>
                                        <a class="button button-small button-primary" href="<?php echo esc_url(oe_vol_action_url((int) $s->id, 'confirmed')); ?>"><?php esc_html_e('Confirm', 'october-events'); ?></a>
                                        <a class="button button-small" href="<?php echo esc_url(oe_vol_action_url((int) $s->id, 'declined')); ?>" title="<?php esc_attr_e('Emails the volunteer to say the shift didn\'t go ahead.', 'october-events'); ?>"><?php esc_html_e('Decline', 'october-events'); ?></a>
                                        <a class="button button-small" href="<?php echo esc_url(oe_vol_action_url((int) $s->id, 'no_show')); ?>"><?php esc_html_e('No-show', 'october-events'); ?></a>
                                        <a class="button button-small button-link-delete" href="<?php echo esc_url(oe_vol_delete_url((int) $s->id)); ?>" onclick="return confirm('<?php echo esc_js(__('Permanently remove this signup? This frees the slot and does NOT email the volunteer.', 'october-events')); ?>');" title="<?php esc_attr_e('Removes the signup silently — no email is sent.', 'october-events'); ?>"><?php esc_html_e('Delete', 'october-events'); ?></a>
                                        <?php
                                        $cur = (int) $s->opportunity_id . ':' . (string) $s->shift_id;
                                        $movable  = in_array($s->status, [\OE\VolunteerSignups::STATUS_PENDING, \OE\VolunteerSignups::STATUS_CONFIRMED], true);
                                        $row_opts = $movable ? array_values(array_filter($move_opts, static fn($o): bool => $o['value'] !== $cur)) : [];
                                        if ($row_opts) : ?>
                                            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="oe-vol-move" title="<?php esc_attr_e('Move this volunteer to a shift that has room. They’ll be emailed the new details.', 'october-events'); ?>">
                                                <input type="hidden" name="action" value="oe_volunteer_move">
                                                <input type="hidden" name="id" value="<?php echo (int) $s->id; ?>">
                                                <?php wp_nonce_field('oe_volunteer_move_' . (int) $s->id); ?>
                                                <select name="to" required aria-label="<?php esc_attr_e('Move to shift', 'october-events'); ?>">
                                                    <option value=""><?php esc_html_e('Move to…', 'october-events'); ?></option>
                                                    <?php foreach ($row_opts as $o) : ?>
                                                        <option value="<?php echo esc_attr($o['value']); ?>"><?php echo esc_html($o['label']); ?></option>
                                                    <?php endforeach; ?>
                                                </select>
                                                <button type="submit" class="button button-small"><?php esc_html_e('Move', 'october-events'); ?></button>
                                            </form>
                                        <?php endif; ?>
                                    </td>
                                </tr>
                            <?php endforeach; ?>
                            </tbody>
                        </table>
                        <?php $add_target = (int) $opp['id'] . ':' . (string) $shift['id']; ?>
                        <div class="oe-vol-add">
                            <button type="button" class="button button-small oe-vol-add-toggle" aria-expanded="false"><?php esc_html_e('+ Add volunteer', 'october-events'); ?></button>
                            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="oe-vol-add-form" hidden>
                                <input type="hidden" name="action" value="oe_volunteer_add">
                                <input type="hidden" name="to" value="<?php echo esc_attr($add_target); ?>">
                                <?php wp_nonce_field('oe_volunteer_add'); ?>
                                <?php if ($known) : ?>
                                    <label class="oe-vol-add-field"><?php esc_html_e('Existing volunteer', 'october-events'); ?>
                                        <select class="oe-vol-add-pick" aria-label="<?php esc_attr_e('Choose an existing volunteer', 'october-events'); ?>">
                                            <option value=""><?php esc_html_e('— type in new, or pick —', 'october-events'); ?></option>
                                        </select>
                                    </label>
                                <?php endif; ?>
                                <label class="oe-vol-add-field"><?php esc_html_e('Name', 'october-events'); ?>
                                    <input type="text" name="name" required></label>
                                <label class="oe-vol-add-field"><?php esc_html_e('Email', 'october-events'); ?>
                                    <input type="email" name="email" required></label>
                                <label class="oe-vol-add-field"><?php esc_html_e('Mobile (optional)', 'october-events'); ?>
                                    <input type="tel" name="phone"></label>
                                <label class="oe-vol-add-sms"><input type="checkbox" name="sms_opt_in" value="1"> <?php esc_html_e('SMS reminders', 'october-events'); ?></label>
                                <button type="submit" class="button button-small button-primary"><?php esc_html_e('Add to shift', 'october-events'); ?></button>
                            </form>
                        </div>
                    </div>
                <?php endforeach; ?>
            </div>
        </details>
    <?php endforeach; ?>

    <?php if ($known) : ?>
    <template id="oe-vol-known-opts"><?php foreach ($known as $kv) : ?><option value="<?php echo esc_attr($kv['email']); ?>" data-name="<?php echo esc_attr($kv['name']); ?>" data-phone="<?php echo esc_attr($kv['phone']); ?>" data-sms="<?php echo (int) $kv['sms_opt_in']; ?>"><?php echo esc_html($kv['name'] !== '' ? $kv['name'] . ' · ' . $kv['email'] : $kv['email']); ?></option><?php endforeach; ?></template>
    <?php endif; ?>

    <style>
    .oe-vol-add { margin: 8px 0 2px; }
    .oe-vol-add-form { display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: flex-end; margin-top: 10px; padding: 12px 14px; background: #fff; border: 1px solid #dcdcde; border-radius: 8px; }
    .oe-vol-add-field { display: flex; flex-direction: column; gap: 3px; font-weight: 600; font-size: 12px; }
    .oe-vol-add-field input, .oe-vol-add-pick { min-width: 180px; }
    .oe-vol-add-sms { display: flex; align-items: center; gap: 5px; font-size: 12px; }
    </style>
    <script>
    (function () {
        var tpl = document.getElementById('oe-vol-known-opts');
        function fillPick(pick) {
            if (!pick || !tpl || pick.dataset.filled) { return; }
            pick.appendChild(tpl.content.cloneNode(true));
            pick.dataset.filled = '1';
        }
        document.querySelectorAll('.oe-vol-add').forEach(function (box) {
            var toggle = box.querySelector('.oe-vol-add-toggle');
            var form   = box.querySelector('.oe-vol-add-form');
            if (!toggle || !form) { return; }
            var pick = form.querySelector('.oe-vol-add-pick');
            toggle.addEventListener('click', function () {
                var open = form.hidden;
                form.hidden = !open;
                toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
                if (open) { fillPick(pick); var n = form.querySelector('[name="name"]'); if (n) { n.focus(); } }
            });
            if (pick) {
                pick.addEventListener('change', function () {
                    var o = pick.options[pick.selectedIndex];
                    if (!o || !o.value) { return; }
                    form.querySelector('[name="name"]').value  = o.getAttribute('data-name') || '';
                    form.querySelector('[name="email"]').value = o.value;
                    form.querySelector('[name="phone"]').value = o.getAttribute('data-phone') || '';
                    var sms = form.querySelector('[name="sms_opt_in"]');
                    if (sms) { sms.checked = o.getAttribute('data-sms') === '1'; }
                });
            }
        });
    })();
    </script>
</div>
