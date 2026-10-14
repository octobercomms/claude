<?php
/**
 * Campaign composer (ADMIN-BUILD). Write, test and send a campaign in the
 * plugin — no planning platform. Saving, sending and tracking run through
 * {@see \OE\Mail\Campaigns}.
 *
 * @var int                 $id         campaign id (0 = new)
 * @var object|null         $campaign   row from Campaigns::get()
 * @var array<int,array>    $audiences  from Campaigns::audiences()
 * @var array<int,string>   $selected   selected audience keys
 */
defined('ABSPATH') || exit;

$name      = $campaign ? (string) $campaign->name : '';
$subject   = $campaign ? (string) $campaign->subject : '';
$preheader = $campaign ? (string) $campaign->preheader : '';
$body      = $campaign ? (string) $campaign->body_html : '';
$status    = $campaign ? (string) $campaign->status : 'draft';
$sent      = $campaign && in_array($status, ['sent', 'sending'], true);
$back      = admin_url('admin.php?page=oe-email');
?>
<div class="wrap oe-admin oe-email">
    <h1 class="wp-heading-inline"><?php echo $id ? esc_html__('Edit campaign', 'october-events') : esc_html__('New campaign', 'october-events'); ?></h1>
    <a class="page-title-action" href="<?php echo esc_url($back); ?>"><?php esc_html_e('Back to Email', 'october-events'); ?></a>
    <hr class="wp-header-end">

    <?php if (isset($_GET['oe_msg'])) : // phpcs:ignore WordPress.Security.NonceVerification
        $m = sanitize_key((string) $_GET['oe_msg']);
        $notes = [
            'camp_saved'     => [__('Campaign saved.', 'october-events'), 'success'],
            'camp_test_ok'   => [__('Test email sent.', 'october-events'), 'success'],
            'camp_test_fail' => [__('Couldn’t send the test — check the address and your sending provider.', 'october-events'), 'error'],
        ];
        if (isset($notes[$m])) : ?>
            <div class="notice notice-<?php echo esc_attr($notes[$m][1]); ?> is-dismissible"><p><?php echo esc_html($notes[$m][0]); ?></p></div>
        <?php endif;
    endif; ?>

    <?php if ($sent) : ?>
        <div class="notice notice-info inline"><p><?php esc_html_e('This campaign has already been sent. Editing it here will not re-send what already went out.', 'october-events'); ?></p></div>
    <?php endif; ?>

    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="oe-camp-form">
        <input type="hidden" name="action" value="oe_campaign_save">
        <input type="hidden" name="campaign_id" value="<?php echo (int) $id; ?>">
        <?php wp_nonce_field('oe_campaign_' . (int) $id); ?>

        <div class="oe-camp-grid">
            <div class="oe-camp-main">
                <p>
                    <label for="oe-camp-name" style="font-weight:600;display:block;margin-bottom:4px"><?php esc_html_e('Campaign name', 'october-events'); ?></label>
                    <input type="text" id="oe-camp-name" name="name" value="<?php echo esc_attr($name); ?>" class="widefat" placeholder="<?php esc_attr_e('Internal name, e.g. October newsletter', 'october-events'); ?>">
                </p>
                <p>
                    <label for="oe-camp-subject" style="font-weight:600;display:block;margin-bottom:4px"><?php esc_html_e('Subject line', 'october-events'); ?></label>
                    <input type="text" id="oe-camp-subject" name="subject" value="<?php echo esc_attr($subject); ?>" class="widefat" required>
                </p>
                <p>
                    <label for="oe-camp-pre" style="font-weight:600;display:block;margin-bottom:4px"><?php esc_html_e('Preview text (preheader)', 'october-events'); ?></label>
                    <input type="text" id="oe-camp-pre" name="preheader" value="<?php echo esc_attr($preheader); ?>" class="widefat" placeholder="<?php esc_attr_e('The grey line shown after the subject in most inboxes.', 'october-events'); ?>">
                </p>
                <p style="font-weight:600;margin:14px 0 4px"><?php esc_html_e('Email body', 'october-events'); ?></p>
                <?php
                wp_editor($body, 'oe_campaign_body', [
                    'textarea_name' => 'body_html',
                    'textarea_rows' => 16,
                    'media_buttons' => true,
                ]);
                ?>
                <p class="description"><?php esc_html_e('An unsubscribe link and your footer address are added automatically. Links are tracked for click stats.', 'october-events'); ?></p>
            </div>

            <div class="oe-camp-side">
                <div class="oe-ad-card">
                    <p style="font-weight:600;margin:0 0 8px"><?php esc_html_e('Audience', 'october-events'); ?></p>
                    <?php if (! $audiences) : ?>
                        <p class="description" style="margin:0"><?php esc_html_e('No audiences yet. Subscribers and lists appear here once you have contacts.', 'october-events'); ?></p>
                    <?php else : ?>
                        <?php foreach ($audiences as $a) : ?>
                            <label style="display:flex;gap:8px;align-items:baseline;margin:0 0 6px">
                                <input type="checkbox" name="audience[]" value="<?php echo esc_attr((string) $a['key']); ?>"<?php checked(in_array((string) $a['key'], $selected, true)); ?>>
                                <span><?php echo esc_html((string) $a['label']); ?> <span class="description">(<?php echo esc_html(number_format_i18n((int) $a['count'])); ?>)</span></span>
                            </label>
                        <?php endforeach; ?>
                    <?php endif; ?>
                    <p class="description" style="margin:8px 0 0"><?php esc_html_e('Recipients are de-duplicated across the audiences you pick. Unsubscribed and suppressed addresses are skipped.', 'october-events'); ?></p>
                </div>

                <div class="oe-ad-card" style="margin-top:14px">
                    <p style="font-weight:600;margin:0 0 8px"><?php esc_html_e('Send', 'october-events'); ?></p>
                    <button type="submit" name="do" value="save" class="button" style="width:100%;margin-bottom:8px"><?php esc_html_e('Save draft', 'october-events'); ?></button>
                    <button type="submit" name="do" value="send" class="button button-primary" style="width:100%" onclick="return confirm('<?php echo esc_js(__('Send this campaign to everyone in the selected audience now?', 'october-events')); ?>');"><?php esc_html_e('Send now', 'october-events'); ?></button>
                </div>

                <div class="oe-ad-card" style="margin-top:14px">
                    <p style="font-weight:600;margin:0 0 8px"><?php esc_html_e('Send a test', 'october-events'); ?></p>
                    <input type="email" name="test_email" value="<?php echo esc_attr((string) wp_get_current_user()->user_email); ?>" class="widefat" style="margin-bottom:8px">
                    <button type="submit" name="do" value="test" class="button" style="width:100%"><?php esc_html_e('Send test', 'october-events'); ?></button>
                </div>
            </div>
        </div>
    </form>
</div>

<style>
.oe-camp-grid{ display:grid; grid-template-columns:1fr 320px; gap:22px; align-items:start; margin-top:16px; }
.oe-camp-side .oe-ad-card{ padding:14px 16px; }
@media (max-width:960px){ .oe-camp-grid{ grid-template-columns:1fr; } }
</style>
