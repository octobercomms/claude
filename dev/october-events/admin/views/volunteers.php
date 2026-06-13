<?php
/** @var \WP_Post[] $opportunities */
defined('ABSPATH') || exit;
use OE\Volunteers;
use OE\VolunteerSignups;
$export = wp_nonce_url(admin_url('admin.php?page=oe-volunteers&oe_export=volunteers'), 'oe_export');

function oe_vol_action_url(int $signup_id, string $status): string {
    return wp_nonce_url(
        admin_url('admin-post.php?action=oe_volunteer_status&status=' . $status . '&id=' . $signup_id),
        'oe_volunteer_status_' . $signup_id
    );
}
?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('Volunteers', 'october-events'); ?>
        <a href="<?php echo esc_url($export); ?>" class="page-title-action"><?php esc_html_e('Export CSV', 'october-events'); ?></a>
    </h1>
    <?php \OE\Admin\Admin::bento('volunteers'); ?>

    <div class="oe-actionbar">
        <a class="button button-primary" href="<?php echo esc_url(admin_url('post-new.php?post_type=' . Volunteers::slug())); ?>"><?php esc_html_e('+ New opportunity', 'october-events'); ?></a>
        <span class="description"><?php esc_html_e('Each opportunity has time shifts with limited slots. Confirmed volunteers get email + SMS reminders automatically.', 'october-events'); ?></span>
    </div>

    <?php if (! $opportunities) : ?>
        <p><?php esc_html_e('No volunteer opportunities yet. Create one under the Volunteer post type.', 'october-events'); ?></p>
    <?php endif; ?>

    <?php foreach ($opportunities as $opp) :
        $shifts = Volunteers::shifts($opp->ID);
        if (! $shifts) {
            continue;
        }
    ?>
        <h2 style="margin-top:28px">
            <a href="<?php echo esc_url(get_edit_post_link($opp->ID)); ?>"><?php echo esc_html(get_the_title($opp)); ?></a>
            <span class="description"><?php echo esc_html((string) get_post_meta($opp->ID, '_oe_role', true)); ?></span>
        </h2>

        <?php foreach ($shifts as $shift) :
            $signups = VolunteerSignups::for_shift($opp->ID, $shift['id']);
            $left    = Volunteers::spots_left($opp->ID, $shift['id']);
        ?>
            <h3 style="margin:12px 0 4px"><?php echo esc_html($shift['label']); ?>
                <span class="description">— <?php echo (int) $left; ?>/<?php echo (int) $shift['capacity']; ?> <?php esc_html_e('open', 'october-events'); ?></span>
            </h3>
            <table class="widefat striped" style="max-width:900px">
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
                        <td><strong><?php echo esc_html($s->name); ?></strong></td>
                        <td><?php echo esc_html($s->email); ?><?php echo $s->phone ? '<br><span class="description">' . esc_html($s->phone) . ($s->sms_opt_in ? ' · SMS ✓' : '') . '</span>' : ''; ?></td>
                        <td><span class="oe-status oe-status-<?php echo esc_attr($s->status); ?>"><?php echo esc_html(ucwords(str_replace('_', ' ', $s->status))); ?></span></td>
                        <td><?php echo esc_html($s->reminders_sent ?: '—'); ?></td>
                        <td>
                            <a class="button button-small button-primary" href="<?php echo esc_url(oe_vol_action_url((int) $s->id, 'confirmed')); ?>"><?php esc_html_e('Confirm', 'october-events'); ?></a>
                            <a class="button button-small" href="<?php echo esc_url(oe_vol_action_url((int) $s->id, 'declined')); ?>"><?php esc_html_e('Decline', 'october-events'); ?></a>
                            <a class="button button-small" href="<?php echo esc_url(oe_vol_action_url((int) $s->id, 'no_show')); ?>"><?php esc_html_e('No-show', 'october-events'); ?></a>
                        </td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        <?php endforeach; ?>
    <?php endforeach; ?>
</div>
