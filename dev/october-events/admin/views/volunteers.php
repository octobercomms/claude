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
?>
<div class="wrap oe-admin oe-vol">
    <h1><?php esc_html_e('Volunteers', 'october-events'); ?>
        <a href="<?php echo esc_url($export); ?>" class="page-title-action"><?php esc_html_e('Export CSV', 'october-events'); ?></a>
    </h1>

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
        <details class="oe-acc oe-vol-opp"<?php echo $ocolor === 'red' ? ' open' : ''; ?>>
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
                                    </td>
                                </tr>
                            <?php endforeach; ?>
                            </tbody>
                        </table>
                    </div>
                <?php endforeach; ?>
            </div>
        </details>
    <?php endforeach; ?>
</div>
