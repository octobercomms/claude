<?php
/**
 * Volunteer profiles — year-over-year participation per person (by email), with
 * a manual "abuse flag" for anyone who no-showed or cancelled yet still used
 * their free ticket. Reliable volunteers float by Worked count; flagged people
 * sit at the top.
 *
 * @var array<int,array<string,mixed>> $profiles  from \OE\Volunteers\Profiles::all()
 * @var array<string,mixed>            $rates     from \OE\Volunteers\Profiles::rates($year)
 * @var string                         $year
 */
defined('ABSPATH') || exit;

$back = admin_url('admin.php?page=oe-volunteers');
?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('Volunteer profiles', 'october-events'); ?></h1>

    <?php if (! empty($_GET['oe_msg'])) :
        $m = sanitize_key((string) $_GET['oe_msg']);
        $notes = [
            'vflag_on'  => [__('Volunteer flagged.', 'october-events'), 'success'],
            'vflag_off' => [__('Flag cleared.', 'october-events'), 'success'],
        ];
        if (isset($notes[$m])) : ?>
            <div class="notice notice-<?php echo esc_attr($notes[$m][1]); ?> is-dismissible"><p><?php echo esc_html($notes[$m][0]); ?></p></div>
        <?php endif; ?>
    <?php endif; ?>

    <p style="margin:12px 0"><a class="button" href="<?php echo esc_url($back); ?>">&larr; <?php esc_html_e('Back to volunteers', 'october-events'); ?></a></p>

    <?php /* Festival rates — size next year's over-subscription from real numbers. */ ?>
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin:0 0 18px">
        <div class="oe-panel" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:16px 18px;min-width:150px">
            <div class="oe-panel-label" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#888"><?php echo esc_html(sprintf(__('No-show rate (%s)', 'october-events'), $year)); ?></div>
            <div style="font-size:26px;font-weight:800"><?php echo esc_html((string) $rates['no_show_rate']); ?>%</div>
            <div class="description" style="font-size:12px"><?php echo esc_html(sprintf(__('%1$d of %2$d expected', 'october-events'), (int) $rates['no_show'], (int) $rates['worked'] + (int) $rates['no_show'])); ?></div>
        </div>
        <div class="oe-panel" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:16px 18px;min-width:150px">
            <div class="oe-panel-label" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#888"><?php echo esc_html(sprintf(__('Cancel rate (%s)', 'october-events'), $year)); ?></div>
            <div style="font-size:26px;font-weight:800"><?php echo esc_html((string) $rates['cancel_rate']); ?>%</div>
            <div class="description" style="font-size:12px"><?php echo esc_html(sprintf(__('%1$d of %2$d signups', 'october-events'), (int) $rates['cancelled'], (int) $rates['total'])); ?></div>
        </div>
        <div class="oe-panel" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:16px 18px;flex:1;min-width:240px;display:flex;align-items:center">
            <p class="description" style="margin:0"><?php esc_html_e('Add the no-show and cancel rates together to size how far to over-subscribe volunteers next year. Flag anyone who no-showed or cancelled but still used their free ticket — the flag follows their email into future years.', 'october-events'); ?></p>
        </div>
    </div>

    <?php if (! $profiles) : ?>
        <div class="oe-panel" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:18px"><strong><?php esc_html_e('No volunteer signups yet.', 'october-events'); ?></strong></div>
    <?php else : ?>
    <table class="widefat striped">
        <thead><tr>
            <th><?php esc_html_e('Volunteer', 'october-events'); ?></th>
            <th style="text-align:center"><?php esc_html_e('Years', 'october-events'); ?></th>
            <th style="text-align:center"><?php esc_html_e('Signups', 'october-events'); ?></th>
            <th style="text-align:center"><?php esc_html_e('Worked', 'october-events'); ?></th>
            <th style="text-align:center"><?php esc_html_e('No-shows', 'october-events'); ?></th>
            <th style="text-align:center"><?php esc_html_e('Cancels', 'october-events'); ?></th>
            <th><?php esc_html_e('Flag', 'october-events'); ?></th>
        </tr></thead>
        <tbody>
        <?php foreach ($profiles as $p) :
            $flagged = ! empty($p['flagged']);
            $years   = implode(', ', (array) $p['years']);
        ?>
            <tr style="<?php echo $flagged ? 'background:#fdeceb' : ''; ?>">
                <td>
                    <strong><?php echo esc_html((string) $p['name'] ?: (string) $p['email']); ?></strong>
                    <?php if ($flagged) : ?><span title="<?php echo esc_attr((string) $p['flag_note']); ?>" style="margin-left:6px;font-size:11px;font-weight:700;color:#b23c17;border:1px solid #b23c17;border-radius:3px;padding:1px 6px">⚑ <?php esc_html_e('FLAGGED', 'october-events'); ?></span><?php endif; ?>
                    <br><a href="<?php echo esc_url('mailto:' . $p['email']); ?>" class="description" style="font-size:12px"><?php echo esc_html((string) $p['email']); ?></a>
                    <?php if ($flagged && (string) $p['flag_note'] !== '') : ?><div class="description" style="font-size:12px;color:#b23c17;margin-top:2px"><?php echo esc_html((string) $p['flag_note']); ?></div><?php endif; ?>
                </td>
                <td style="text-align:center" title="<?php echo esc_attr($years); ?>"><?php echo (int) $p['years_count']; ?></td>
                <td style="text-align:center"><?php echo (int) $p['signups']; ?></td>
                <td style="text-align:center;font-weight:700;color:#1e7a33"><?php echo (int) $p['worked']; ?></td>
                <td style="text-align:center;<?php echo (int) $p['no_show'] > 0 ? 'font-weight:700;color:#b23c17' : 'color:#999'; ?>"><?php echo (int) $p['no_show']; ?></td>
                <td style="text-align:center;<?php echo (int) $p['cancelled'] > 0 ? 'font-weight:700;color:#8a5a00' : 'color:#999'; ?>"><?php echo (int) $p['cancelled']; ?></td>
                <td>
                    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                        <input type="hidden" name="action" value="oe_volunteer_flag">
                        <input type="hidden" name="email" value="<?php echo esc_attr((string) $p['email']); ?>">
                        <?php wp_nonce_field('oe_volunteer_flag'); ?>
                        <?php if ($flagged) : ?>
                            <input type="hidden" name="flagged" value="">
                            <button type="submit" class="button button-small"><?php esc_html_e('Clear flag', 'october-events'); ?></button>
                        <?php else : ?>
                            <input type="hidden" name="flagged" value="1">
                            <input type="text" name="note" placeholder="<?php esc_attr_e('e.g. 2026: no-show, ticket used', 'october-events'); ?>" style="width:170px;font-size:12px">
                            <button type="submit" class="button button-small" onclick="return confirm('<?php echo esc_js(__('Flag this volunteer as having used a ticket without working their shift?', 'october-events')); ?>')"><?php esc_html_e('Flag', 'october-events'); ?></button>
                        <?php endif; ?>
                    </form>
                </td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
    <p class="description" style="margin-top:12px;max-width:820px"><?php esc_html_e('Worked / no-shows / cancels come from each person\'s signup history (matched by email). Match the scanned-ticket list by hand to decide who to flag. From 2027, shift check-in marks no-shows automatically and a flagged volunteer who signs up again is gated on a card on file.', 'october-events'); ?></p>
    <?php endif; ?>
</div>
