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

    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
        <input type="hidden" name="action" value="adf_save_settings">
        <?php wp_nonce_field('adf_save_settings'); ?>

        <h2><?php esc_html_e('API keys', 'adf-festival'); ?></h2>
        <p class="description"><?php esc_html_e('Enter your keys here, or define them as constants in wp-config.php (a constant always wins and locks the field). Stored keys are saved to the database.', 'adf-festival'); ?></p>
        <?php
        $labels = [
            'stripe_publishable_key' => __('Stripe publishable key', 'adf-festival'),
            'stripe_secret_key'      => __('Stripe secret key', 'adf-festival'),
            'stripe_webhook_secret'  => __('Stripe webhook secret', 'adf-festival'),
            'brevo_api_key'          => __('Brevo API key', 'adf-festival'),
            'claude_api_key'         => __('Claude API key', 'adf-festival'),
            'google_maps_key'        => __('Google Maps key', 'adf-festival'),
        ];
        ?>
        <table class="form-table" style="max-width:720px">
            <?php foreach ($secrets as $key => $const) :
                $is_const = \ADF\Settings::secret_is_constant($key);
                $value    = $is_const ? '' : (string) ($cfg[$key] ?? '');
                ?>
                <tr>
                    <th scope="row"><label for="adf-sec-<?php echo esc_attr($key); ?>"><?php echo esc_html($labels[$key] ?? $key); ?></label></th>
                    <td>
                        <?php if ($is_const) : ?>
                            <input type="text" class="regular-text" value="••••••••••" disabled>
                            <p class="description"><?php printf(/* translators: %s: constant */ esc_html__('Locked — defined by the %s constant in wp-config.php.', 'adf-festival'), '<code>' . esc_html($const) . '</code>'); ?></p>
                        <?php else : ?>
                            <span class="adf-secret-wrap">
                                <input type="password" id="adf-sec-<?php echo esc_attr($key); ?>" class="regular-text adf-secret" name="secret_<?php echo esc_attr($key); ?>" value="<?php echo esc_attr($value); ?>" autocomplete="off" spellcheck="false">
                                <button type="button" class="button adf-secret-toggle" aria-label="<?php esc_attr_e('Show / hide', 'adf-festival'); ?>" title="<?php esc_attr_e('Show / hide', 'adf-festival'); ?>"><span class="dashicons dashicons-visibility"></span></button>
                            </span>
                        <?php endif; ?>
                    </td>
                </tr>
            <?php endforeach; ?>
        </table>

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

        <h2 id="voice"><?php esc_html_e('AI Stories connector', 'adf-festival'); ?></h2>
        <p><label><?php esc_html_e('Model', 'adf-festival'); ?><br><input type="text" name="ai_model" class="regular-text" value="<?php echo esc_attr((string) ($cfg['ai_model'] ?? '')); ?>"></label></p>
        <p><label><?php esc_html_e('Source URLs (one per line, RSS preferred)', 'adf-festival'); ?><br>
            <textarea name="ai_source_urls" rows="5" class="large-text"><?php echo esc_textarea(implode("\n", (array) ($cfg['ai_source_urls'] ?? []))); ?></textarea></label></p>

        <h3><?php esc_html_e('Tone of voice training', 'adf-festival'); ?></h3>
        <p class="description"><?php esc_html_e('This is how you "train" the AI. The style guide and examples below are sent to Claude with every story it writes, steering it to sound like ADF. Be specific about voice, rhythm, vocabulary, and what to avoid.', 'adf-festival'); ?></p>
        <p><label><strong><?php esc_html_e('House style guide', 'adf-festival'); ?></strong><br>
            <textarea name="ai_voice_guide" rows="8" class="large-text" placeholder="<?php esc_attr_e('e.g. Write in third person. Lead with the design idea, not the event. Favour concrete nouns over adjectives. Never use words like “stunning”, “must-see”, “game-changing”. UK/US spelling: US. Reference Atlanta neighbourhoods by name where relevant…', 'adf-festival'); ?>"><?php echo esc_textarea((string) ($cfg['ai_voice_guide'] ?? '')); ?></textarea></label></p>
        <p><label><strong><?php esc_html_e('Example pieces', 'adf-festival'); ?></strong> — <?php esc_html_e('paste 1–4 published pieces that exemplify the voice, separated by a line containing only ---', 'adf-festival'); ?><br>
            <textarea name="ai_examples" rows="12" class="large-text" placeholder="<?php esc_attr_e("Headline of a great ADF piece\nFull body text in the ADF voice…\n---\nAnother example headline\nIts body text…", 'adf-festival'); ?>"><?php echo esc_textarea(implode("\n---\n", (array) ($cfg['ai_examples'] ?? []))); ?></textarea></label></p>
        <p class="description"><?php echo esc_html(sprintf(/* translators: %d: count */ __('Currently %d example(s) saved.', 'adf-festival'), count((array) ($cfg['ai_examples'] ?? [])))); ?></p>

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

        <h2><?php esc_html_e('Digest & reports', 'adf-festival'); ?></h2>
        <p><label><input type="checkbox" name="digest_enabled" value="1" <?php checked(! empty($cfg['digest_enabled'])); ?>> <?php esc_html_e('Send the monthly digest automatically (first Monday).', 'adf-festival'); ?></label></p>
        <p><label><?php esc_html_e('Daily ticket sales report to', 'adf-festival'); ?> <input type="email" name="report_email" value="<?php echo esc_attr((string) ($cfg['report_email'] ?? '')); ?>" class="regular-text" placeholder="<?php echo esc_attr(get_option('admin_email')); ?>"></label> <span class="description"><?php esc_html_e('Blank = site admin. Only sends on days with sales.', 'adf-festival'); ?></span></p>

        <h2><?php esc_html_e('Ad booking packages', 'adf-festival'); ?></h2>
        <p class="description"><?php esc_html_e('One per line: Name | impressions or clicks | quantity | price', 'adf-festival'); ?></p>
        <p><textarea name="ad_packages" rows="4" class="large-text" placeholder="Homepage MPU — 1 month | impressions | 50000 | 299"><?php
            $lines = [];
            foreach ((array) ($cfg['ad_packages'] ?? []) as $p) { $lines[] = ($p['name'] ?? '') . ' | ' . ($p['type'] ?? 'impressions') . ' | ' . ($p['quantity'] ?? 0) . ' | ' . ($p['price'] ?? 0); }
            echo esc_textarea(implode("\n", $lines));
        ?></textarea></p>
        <h2><?php esc_html_e('Ad promo codes', 'adf-festival'); ?></h2>
        <p class="description"><?php esc_html_e('One per line: CODE | percent', 'adf-festival'); ?></p>
        <p><textarea name="ad_promo_codes" rows="3" class="large-text" placeholder="LAUNCH | 20"><?php
            $lines = [];
            foreach ((array) ($cfg['ad_promo_codes'] ?? []) as $code => $pct) { $lines[] = $code . ' | ' . $pct; }
            echo esc_textarea(implode("\n", $lines));
        ?></textarea></p>

        <h2 id="syndication"><?php esc_html_e('Ad syndication (hub / partner)', 'adf-festival'); ?></h2>
        <?php $mode = (string) ($cfg['ad_site_mode'] ?? 'hub'); ?>
        <p>
            <label><input type="radio" name="ad_site_mode" value="hub" <?php checked($mode, 'hub'); ?>> <?php esc_html_e('Hub — this site owns the ads and can syndicate them to partner sites', 'adf-festival'); ?></label><br>
            <label><input type="radio" name="ad_site_mode" value="partner" <?php checked($mode, 'partner'); ?>> <?php esc_html_e('Partner — this site pulls ads from a hub', 'adf-festival'); ?></label>
        </p>
        <p><strong><?php esc_html_e('Hub API key', 'adf-festival'); ?>:</strong> <code><?php echo esc_html((string) ($cfg['ad_api_key'] ?? '') ?: '—'); ?></code>
            <span class="description"><?php esc_html_e('Partners present this key. Saved automatically in hub mode.', 'adf-festival'); ?></span></p>
        <p><label><?php esc_html_e('Hub URL (partner mode)', 'adf-festival'); ?> <input type="url" name="ad_hub_url" class="regular-text" value="<?php echo esc_attr((string) ($cfg['ad_hub_url'] ?? '')); ?>" placeholder="https://atlantadesignfestival.net"></label></p>
        <p><label><?php esc_html_e('Hub API key (partner mode)', 'adf-festival'); ?> <input type="text" name="ad_hub_api_key" class="regular-text" value="<?php echo esc_attr((string) ($cfg['ad_hub_api_key'] ?? '')); ?>"></label></p>
        <?php $partners = (array) ($cfg['ad_known_partners'] ?? []); if ($partners) : ?>
            <p class="description"><?php esc_html_e('Active partner sites:', 'adf-festival'); ?> <?php echo esc_html(implode(', ', $partners)); ?></p>
        <?php endif; ?>

        <h2 id="updates"><?php esc_html_e('Updates (GitHub)', 'adf-festival'); ?></h2>
        <p class="description"><?php esc_html_e('New versions are published as GitHub Releases tagged adf-v<version> and offered in Dashboard → Updates. Provide a fine-grained token with Contents: read (or define ADF_GITHUB_TOKEN in wp-config.php).', 'adf-festival'); ?></p>
        <p><label><?php esc_html_e('Repository', 'adf-festival'); ?> <input type="text" name="github_repo" class="regular-text" value="<?php echo esc_attr((string) ($cfg['github_repo'] ?? 'octobercomms/claude')); ?>"></label></p>
        <?php $token_const = defined('ADF_GITHUB_TOKEN') && ADF_GITHUB_TOKEN; ?>
        <p><label><?php esc_html_e('GitHub token', 'adf-festival'); ?></label><br>
            <span class="adf-secret-wrap">
                <input type="password" name="github_token" class="regular-text adf-secret" autocomplete="off" value="<?php echo esc_attr((string) ($cfg['github_token'] ?? '')); ?>" <?php echo $token_const ? 'disabled placeholder="Set via ADF_GITHUB_TOKEN constant"' : ''; ?>>
                <?php if (! $token_const) : ?><button type="button" class="button adf-secret-toggle" aria-label="<?php esc_attr_e('Show / hide', 'adf-festival'); ?>"><span class="dashicons dashicons-visibility"></span></button><?php endif; ?>
            </span></p>

        <?php submit_button(); ?>
    </form>

    <hr>
    <h2><?php esc_html_e('Test the voice', 'adf-festival'); ?></h2>
    <p class="description"><?php esc_html_e('Paste a sample source article (or any text) and run it through the trained editorial prompt to preview how a generated story would read. Save your style guide above first.', 'adf-festival'); ?></p>
    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
        <input type="hidden" name="action" value="adf_test_voice">
        <?php wp_nonce_field('adf_test_voice'); ?>
        <p><textarea name="adf_voice_sample" rows="6" class="large-text" placeholder="<?php esc_attr_e('Paste a source article here…', 'adf-festival'); ?>"></textarea></p>
        <?php submit_button(__('Generate preview', 'adf-festival'), 'primary', 'submit', false); ?>
    </form>
    <?php $voice = get_transient('adf_voice_test'); if (is_array($voice)) { delete_transient('adf_voice_test'); ?>
        <div class="notice <?php echo $voice['ok'] ? 'notice-success' : 'notice-error'; ?>" style="margin-top:10px;padding:12px">
            <?php if (! empty($voice['skip']) || empty($voice['headline'])) : ?>
                <p><?php echo esc_html($voice['message'] ?? ''); ?></p>
            <?php else : ?>
                <p><strong><?php echo esc_html($voice['headline']); ?></strong></p>
                <div style="white-space:pre-wrap"><?php echo esc_html($voice['body']); ?></div>
            <?php endif; ?>
        </div>
    <?php } ?>

    <hr>
    <h2><?php esc_html_e('Syndication key', 'adf-festival'); ?></h2>
    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" onsubmit="return confirm('<?php echo esc_js(__('Regenerate the hub API key? Partner sites will need the new key.', 'adf-festival')); ?>')">
        <input type="hidden" name="action" value="adf_regen_ad_key">
        <?php wp_nonce_field('adf_regen_ad_key'); ?>
        <?php submit_button(__('Regenerate hub API key', 'adf-festival'), 'secondary', 'submit', false); ?>
    </form>

    <hr>
    <h2 id="update-test"><?php esc_html_e('Updates', 'adf-festival'); ?></h2>
    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="margin-top:-8px">
        <input type="hidden" name="action" value="adf_test_updater">
        <?php wp_nonce_field('adf_test_updater'); ?>
        <?php submit_button(__('Test update connection', 'adf-festival'), 'secondary', 'submit', false); ?>
    </form>
    <?php $diag = get_transient('adf_updater_diag'); if (is_array($diag)) { delete_transient('adf_updater_diag'); ?>
        <div class="notice <?php echo $diag['ok'] ? 'notice-success' : 'notice-error'; ?>" style="margin-top:10px"><p><?php echo esc_html($diag['message']); ?></p></div>
    <?php } ?>

    <style>
        .adf-secret-wrap { display: inline-flex; align-items: center; gap: 4px; }
        .adf-secret-toggle { display: inline-flex !important; align-items: center; padding: 0 6px !important; }
        .adf-secret-toggle .dashicons { width: 18px; height: 18px; font-size: 18px; }
    </style>
    <script>
    (function () {
        document.querySelectorAll('.adf-secret-toggle').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var input = btn.parentNode.querySelector('input');
                var icon = btn.querySelector('.dashicons');
                if (!input) { return; }
                var show = input.type === 'password';
                input.type = show ? 'text' : 'password';
                if (icon) { icon.classList.toggle('dashicons-visibility', !show); icon.classList.toggle('dashicons-hidden', show); }
            });
        });
    })();
    </script>
</div>
