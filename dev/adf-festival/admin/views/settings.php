<?php
/** @var array $cfg @var array $secrets */
defined('ABSPATH') || exit;
use ADF\PostTypes;
use ADF\Connectors\BrevoConnector;
?>
<div class="wrap adf-admin">
    <h1><?php esc_html_e('ADF Festival — Settings', 'adf-festival'); ?></h1>
    <?php if (! empty($_GET['updated'])) : ?>
        <div class="notice notice-success is-dismissible"><p><?php esc_html_e('Settings saved.', 'adf-festival'); ?></p></div>
    <?php endif; ?>

    <h2><?php esc_html_e('API keys', 'adf-festival'); ?></h2>
    <p class="description"><?php esc_html_e('For security these are defined as constants in wp-config.php, never stored in the database. Status:', 'adf-festival'); ?></p>
    <table class="widefat striped" style="max-width:640px">
        <tbody>
        <?php foreach ($secrets as $key => $const) :
            $set = defined($const); ?>
            <tr>
                <td><code><?php echo esc_html($const); ?></code></td>
                <td style="color:<?php echo $set ? '#1a7f37' : '#b32d2e'; ?>"><?php echo $set ? esc_html__('Configured', 'adf-festival') : esc_html__('Not set', 'adf-festival'); ?></td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>

    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
        <input type="hidden" name="action" value="adf_save_settings">
        <?php wp_nonce_field('adf_save_settings'); ?>

        <h2><?php esc_html_e('Tier pricing', 'adf-festival'); ?></h2>
        <p class="description"><?php esc_html_e('Amounts in your chosen currency. Leave 0 for free.', 'adf-festival'); ?></p>
        <table class="widefat striped" style="max-width:640px">
            <thead><tr><th><?php esc_html_e('Type', 'adf-festival'); ?></th><th><?php esc_html_e('Featured', 'adf-festival'); ?></th><th><?php esc_html_e('Premium', 'adf-festival'); ?></th></tr></thead>
            <tbody>
            <?php foreach (PostTypes::listing_types() as $type) :
                $featured = (int) ($cfg['pricing'][$type]['featured'] ?? 0) / 100;
                $premium  = (int) ($cfg['pricing'][$type]['premium'] ?? 0) / 100; ?>
                <tr>
                    <td><?php echo esc_html(PostTypes::TYPES[$type]['label']); ?></td>
                    <td><input type="number" step="0.01" min="0" name="pricing[<?php echo esc_attr($type); ?>][featured]" value="<?php echo esc_attr((string) $featured); ?>"></td>
                    <td><input type="number" step="0.01" min="0" name="pricing[<?php echo esc_attr($type); ?>][premium]" value="<?php echo esc_attr((string) $premium); ?>"></td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
        <p><label><?php esc_html_e('Currency', 'adf-festival'); ?> <input type="text" name="currency" value="<?php echo esc_attr((string) ($cfg['currency'] ?? 'usd')); ?>" size="5"></label></p>

        <h2><?php esc_html_e('AI Stories connector', 'adf-festival'); ?></h2>
        <p><label><?php esc_html_e('Model', 'adf-festival'); ?><br><input type="text" name="ai_model" class="regular-text" value="<?php echo esc_attr((string) ($cfg['ai_model'] ?? '')); ?>"></label></p>
        <p><label><?php esc_html_e('Source URLs (one per line, RSS preferred)', 'adf-festival'); ?><br>
            <textarea name="ai_source_urls" rows="5" class="large-text"><?php echo esc_textarea(implode("\n", (array) ($cfg['ai_source_urls'] ?? []))); ?></textarea></label></p>

        <h2><?php esc_html_e('Brevo template IDs', 'adf-festival'); ?></h2>
        <table class="widefat striped" style="max-width:640px"><tbody>
        <?php foreach (BrevoConnector::TRIGGERS as $trigger) : ?>
            <tr>
                <td><code><?php echo esc_html($trigger); ?></code></td>
                <td><input type="number" name="brevo_templates[<?php echo esc_attr($trigger); ?>]" value="<?php echo esc_attr((string) ($cfg['brevo_templates'][$trigger] ?? 0)); ?>"></td>
            </tr>
        <?php endforeach; ?>
        </tbody></table>

        <h2><?php esc_html_e('Brevo list IDs', 'adf-festival'); ?></h2>
        <table class="widefat striped" style="max-width:640px"><tbody>
        <?php foreach (['adf_all_subscribers', 'adf_directory_listed', 'adf_event_attendees', 'adf_volunteers', 'adf_partners', 'adf_monthly_digest'] as $list) : ?>
            <tr>
                <td><code><?php echo esc_html($list); ?></code></td>
                <td><input type="number" name="brevo_lists[<?php echo esc_attr($list); ?>]" value="<?php echo esc_attr((string) ($cfg['brevo_lists'][$list] ?? 0)); ?>"></td>
            </tr>
        <?php endforeach; ?>
        </tbody></table>

        <h2><?php esc_html_e('Rejection email copy', 'adf-festival'); ?></h2>
        <p class="description"><?php esc_html_e('Optional per-type overrides. Variables: {listing_name}, {listing_type}, {refund_amount}. Leave blank to use the default copy.', 'adf-festival'); ?></p>
        <?php foreach (PostTypes::listing_types() as $type) : ?>
            <p><label><strong><?php echo esc_html(PostTypes::TYPES[$type]['label']); ?></strong><br>
                <textarea name="rejection_copy[<?php echo esc_attr($type); ?>]" rows="3" class="large-text"><?php echo esc_textarea((string) ($cfg['rejection_copy'][$type] ?? '')); ?></textarea></label></p>
        <?php endforeach; ?>

        <h2><?php esc_html_e('Volunteer reminders', 'adf-festival'); ?></h2>
        <p class="description"><?php esc_html_e('Email reminders always send via Brevo. SMS is optional (Brevo transactional SMS) and only goes to volunteers who provided a mobile and opted in.', 'adf-festival'); ?></p>
        <p><label><input type="checkbox" name="sms_enabled" value="1" <?php checked(! empty($cfg['sms_enabled'])); ?>> <?php esc_html_e('Enable SMS reminders (requires Brevo SMS credits)', 'adf-festival'); ?></label></p>
        <p><label><?php esc_html_e('SMS sender name', 'adf-festival'); ?> <input type="text" name="sms_sender" value="<?php echo esc_attr((string) ($cfg['sms_sender'] ?? 'ADF')); ?>" maxlength="11" size="12"></label> <span class="description"><?php esc_html_e('Max 11 characters, must be approved in Brevo.', 'adf-festival'); ?></span></p>
        <p><strong><?php esc_html_e('Send reminders:', 'adf-festival'); ?></strong></p>
        <?php $offsets = (array) ($cfg['reminder_offsets'] ?? []); ?>
        <p>
            <label><input type="checkbox" name="reminder_offsets[week]" value="1" <?php checked(in_array('week', $offsets, true)); ?>> <?php esc_html_e('1 week before', 'adf-festival'); ?></label><br>
            <label><input type="checkbox" name="reminder_offsets[48h]" value="1" <?php checked(in_array('48h', $offsets, true)); ?>> <?php esc_html_e('48 hours before', 'adf-festival'); ?></label><br>
            <label><input type="checkbox" name="reminder_offsets[morning]" value="1" <?php checked(in_array('morning', $offsets, true)); ?>> <?php esc_html_e('Morning of (≈3h before)', 'adf-festival'); ?></label>
        </p>
        <p class="description"><?php esc_html_e('A confirmation always sends immediately on signup.', 'adf-festival'); ?></p>

        <h2><?php esc_html_e('Digest', 'adf-festival'); ?></h2>
        <p><label><input type="checkbox" name="digest_enabled" value="1" <?php checked(! empty($cfg['digest_enabled'])); ?>> <?php esc_html_e('Send the monthly digest automatically (first Monday).', 'adf-festival'); ?></label></p>

        <h2 id="updates"><?php esc_html_e('Updates (GitHub)', 'adf-festival'); ?></h2>
        <p class="description"><?php esc_html_e('New versions are published as GitHub Releases tagged adf-v<version> and offered in Dashboard → Updates. Provide a fine-grained token with Contents: read (or define ADF_GITHUB_TOKEN in wp-config.php).', 'adf-festival'); ?></p>
        <p><label><?php esc_html_e('Repository', 'adf-festival'); ?> <input type="text" name="github_repo" class="regular-text" value="<?php echo esc_attr((string) ($cfg['github_repo'] ?? 'octobercomms/claude')); ?>"></label></p>
        <?php $token_const = defined('ADF_GITHUB_TOKEN') && ADF_GITHUB_TOKEN; ?>
        <p><label><?php esc_html_e('GitHub token', 'adf-festival'); ?>
            <input type="password" name="github_token" class="regular-text" autocomplete="off" value="<?php echo esc_attr((string) ($cfg['github_token'] ?? '')); ?>" <?php echo $token_const ? 'disabled placeholder="Set via ADF_GITHUB_TOKEN constant"' : ''; ?>></label></p>

        <?php submit_button(); ?>
    </form>

    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="margin-top:-8px">
        <input type="hidden" name="action" value="adf_test_updater">
        <?php wp_nonce_field('adf_test_updater'); ?>
        <?php submit_button(__('Test update connection', 'adf-festival'), 'secondary', 'submit', false); ?>
    </form>
    <?php $diag = get_transient('adf_updater_diag'); if (is_array($diag)) { delete_transient('adf_updater_diag'); ?>
        <div class="notice <?php echo $diag['ok'] ? 'notice-success' : 'notice-error'; ?>" style="margin-top:10px"><p><?php echo esc_html($diag['message']); ?></p></div>
    <?php } ?>
</div>
