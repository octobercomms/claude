<?php
/** @var \WP_Post[] $opportunities */
defined('ABSPATH') || exit;
use ADF\Volunteers;
use ADF\VolunteerSignups;
$export = wp_nonce_url(admin_url('admin.php?page=adf-volunteers&adf_export=volunteers'), 'adf_export');

function adf_vol_action_url(int $signup_id, string $status): string {
    return wp_nonce_url(
        admin_url('admin-post.php?action=adf_volunteer_status&status=' . $status . '&id=' . $signup_id),
        'adf_volunteer_status_' . $signup_id
    );
}
?>
<div class="wrap adf-admin">
    <h1><?php esc_html_e('Volunteers', 'adf-festival'); ?>
        <a href="<?php echo esc_url($export); ?>" class="page-title-action"><?php esc_html_e('Export CSV', 'adf-festival'); ?></a>
    </h1>
    <p class="description"><?php esc_html_e('Each opportunity has time shifts with limited slots. Confirmed volunteers receive email + SMS reminders automatically.', 'adf-festival'); ?></p>

    <?php if (! $opportunities) : ?>
        <p><?php esc_html_e('No volunteer opportunities yet. Create one under the Volunteer post type.', 'adf-festival'); ?></p>
    <?php endif; ?>

    <?php foreach ($opportunities as $opp) :
        $shifts = Volunteers::shifts($opp->ID);
        if (! $shifts) {
            continue;
        }
    ?>
        <h2 style="margin-top:28px">
            <a href="<?php echo esc_url(get_edit_post_link($opp->ID)); ?>"><?php echo esc_html(get_the_title($opp)); ?></a>
            <span class="description"><?php echo esc_html((string) get_post_meta($opp->ID, '_adf_role', true)); ?></span>
        </h2>

        <?php foreach ($shifts as $shift) :
            $signups = VolunteerSignups::for_shift($opp->ID, $shift['id']);
            $left    = Volunteers::spots_left($opp->ID, $shift['id']);
        ?>
            <h3 style="margin:12px 0 4px"><?php echo esc_html($shift['label']); ?>
                <span class="description">— <?php echo (int) $left; ?>/<?php echo (int) $shift['capacity']; ?> <?php esc_html_e('open', 'adf-festival'); ?></span>
            </h3>
            <table class="widefat striped" style="max-width:900px">
                <thead><tr>
                    <th><?php esc_html_e('Name', 'adf-festival'); ?></th>
                    <th><?php esc_html_e('Contact', 'adf-festival'); ?></th>
                    <th><?php esc_html_e('Status', 'adf-festival'); ?></th>
                    <th><?php esc_html_e('Reminders', 'adf-festival'); ?></th>
                    <th><?php esc_html_e('Actions', 'adf-festival'); ?></th>
                </tr></thead>
                <tbody>
                <?php if (! $signups) : ?>
                    <tr><td colspan="5"><?php esc_html_e('No signups yet.', 'adf-festival'); ?></td></tr>
                <?php endif; ?>
                <?php foreach ($signups as $s) : ?>
                    <tr>
                        <td><strong><?php echo esc_html($s->name); ?></strong></td>
                        <td><?php echo esc_html($s->email); ?><?php echo $s->phone ? '<br><span class="description">' . esc_html($s->phone) . ($s->sms_opt_in ? ' · SMS ✓' : '') . '</span>' : ''; ?></td>
                        <td><span class="adf-status adf-status-<?php echo esc_attr($s->status); ?>"><?php echo esc_html(ucwords(str_replace('_', ' ', $s->status))); ?></span></td>
                        <td><?php echo esc_html($s->reminders_sent ?: '—'); ?></td>
                        <td>
                            <a class="button button-small button-primary" href="<?php echo esc_url(adf_vol_action_url((int) $s->id, 'confirmed')); ?>"><?php esc_html_e('Confirm', 'adf-festival'); ?></a>
                            <a class="button button-small" href="<?php echo esc_url(adf_vol_action_url((int) $s->id, 'declined')); ?>"><?php esc_html_e('Decline', 'adf-festival'); ?></a>
                            <a class="button button-small" href="<?php echo esc_url(adf_vol_action_url((int) $s->id, 'no_show')); ?>"><?php esc_html_e('No-show', 'adf-festival'); ?></a>
                        </td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        <?php endforeach; ?>
    <?php endforeach; ?>
</div>
