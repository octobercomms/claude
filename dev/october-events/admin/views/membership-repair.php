<?php
/**
 * Membership repair: buyers who took a members-only rate but have no active
 * membership. Create the missing subscription on the card they saved at
 * checkout, or (when the off-session charge won't go through) fall back to
 * contacting them.
 *
 * @var array       $candidates  Rows from OE\Membership\Repair::candidates().
 * @var array|false $results     Flash results from the last repair run.
 */

defined('ABSPATH') || exit;

$post_url  = esc_url(admin_url('admin-post.php'));
$has_price = \OE\Membership\Repair::join_price() !== '';
?>
<div class="wrap">
    <h1><?php esc_html_e('Repair memberships', 'october-events'); ?></h1>
    <p class="description" style="max-width:820px"><?php esc_html_e('People who bought a members-only ticket rate but have no active membership — the one-click join didn’t complete at checkout. Creating a membership here charges the $5 first month to the card they saved on their ticket order and starts their subscription. Anyone already a member is skipped automatically.', 'october-events'); ?></p>

    <?php if (! $has_price) : ?>
        <div class="notice notice-error"><p>
            <?php
            printf(
                /* translators: %s: link to settings */
                esc_html__('No valid join price is set. Add a recurring Friend price (starts price_…) under %s before repairing.', 'october-events'),
                '<a href="' . esc_url(admin_url('admin.php?page=oe-settings#membership')) . '">' . esc_html__('Settings → Membership', 'october-events') . '</a>'
            );
            ?>
        </p></div>
    <?php endif; ?>

    <?php if (is_array($results) && $results) : ?>
        <?php
        $created = array_filter($results, static fn($r) => ($r['status'] ?? '') === 'created');
        $failed  = array_filter($results, static fn($r) => empty($r['ok']));
        ?>
        <div class="notice notice-<?php echo $failed ? 'warning' : 'success'; ?> is-dismissible">
            <p><strong><?php echo esc_html(sprintf(
                /* translators: 1: created count, 2: total processed */
                _n('%1$d of %2$d membership created.', '%1$d of %2$d memberships created.', count($results), 'october-events'),
                count($created),
                count($results)
            )); ?></strong></p>
            <ul style="margin:0 0 6px 18px;list-style:disc">
                <?php foreach ($results as $r) : ?>
                    <li>#<?php echo (int) $r['order_id']; ?> — <?php echo esc_html($r['message'] ?? $r['status'] ?? ''); ?></li>
                <?php endforeach; ?>
            </ul>
        </div>
    <?php endif; ?>

    <?php if (! $candidates) : ?>
        <div class="notice notice-info inline"><p><?php esc_html_e('Nothing to repair — every members-only rate buyer has an active membership.', 'october-events'); ?></p></div>
    <?php else : ?>
        <form method="post" action="<?php echo $post_url; ?>" style="margin:14px 0" onsubmit="return confirm('<?php echo esc_js(__('Create memberships for everyone listed? Each will be charged the first month now.', 'october-events')); ?>')">
            <?php wp_nonce_field('oe_membership_repair'); ?>
            <input type="hidden" name="action" value="oe_membership_repair">
            <input type="hidden" name="which" value="all">
            <button class="button button-primary" <?php disabled(! $has_price); ?>><?php echo esc_html(sprintf(
                /* translators: %d: number of people */
                _n('Create membership for %d person', 'Create memberships for all %d people', count($candidates), 'october-events'),
                count($candidates)
            )); ?></button>
        </form>

        <table class="widefat striped" style="max-width:1000px">
            <thead><tr>
                <th><?php esc_html_e('Name', 'october-events'); ?></th>
                <th><?php esc_html_e('Email', 'october-events'); ?></th>
                <th><?php esc_html_e('Ticket rate', 'october-events'); ?></th>
                <th><?php esc_html_e('Bought', 'october-events'); ?></th>
                <th style="width:150px"></th>
            </tr></thead>
            <tbody>
                <?php foreach ($candidates as $c) : ?>
                    <tr>
                        <td><?php echo esc_html($c['name'] ?: '—'); ?></td>
                        <td><?php echo esc_html($c['email']); ?></td>
                        <td><?php echo esc_html($c['label']); ?></td>
                        <td><?php echo esc_html($c['created'] !== '' ? mysql2date(get_option('date_format') . ' g:i a', $c['created']) : ''); ?></td>
                        <td style="text-align:right">
                            <form method="post" action="<?php echo $post_url; ?>" onsubmit="return confirm('<?php echo esc_js(__('Create this membership and charge the first month now?', 'october-events')); ?>')">
                                <?php wp_nonce_field('oe_membership_repair'); ?>
                                <input type="hidden" name="action" value="oe_membership_repair">
                                <input type="hidden" name="which" value="<?php echo (int) $c['order_id']; ?>">
                                <button class="button" <?php disabled(! $has_price); ?>><?php esc_html_e('Create membership', 'october-events'); ?></button>
                            </form>
                        </td>
                    </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
        <p class="description" style="margin-top:10px;max-width:820px"><?php esc_html_e('If a card won’t authorise the off-session charge, that person is left untouched and flagged above — send them the join link instead.', 'october-events'); ?></p>
    <?php endif; ?>
</div>
