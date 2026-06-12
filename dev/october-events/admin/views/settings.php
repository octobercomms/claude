<?php
/** @var array $cfg @var array $secrets */
defined('ABSPATH') || exit;
use OE\PostTypes;
?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('October Events — Settings', 'october-events'); ?></h1>
    <?php if (! empty($_GET['updated'])) : ?>
        <div class="notice notice-success is-dismissible"><p><?php esc_html_e('Settings saved.', 'october-events'); ?></p></div>
    <?php endif; ?>

    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
        <input type="hidden" name="action" value="oe_save_settings">
        <?php wp_nonce_field('oe_save_settings'); ?>

        <h2><?php esc_html_e('Brand', 'october-events'); ?></h2>
        <p class="description"><?php esc_html_e('Shown as this site\'s menu name and in the UI (this plugin runs on multiple sites).', 'october-events'); ?></p>
        <p><label><?php esc_html_e('Brand / site name', 'october-events'); ?>
            <input type="text" name="brand_name" class="regular-text" value="<?php echo esc_attr((string) ($cfg['brand_name'] ?? 'October Events')); ?>"></label></p>

        <h2><?php esc_html_e('Event readiness', 'october-events'); ?></h2>
        <p class="description"><?php esc_html_e('An event can only be confirmed (go green & publish) once these fields are filled.', 'october-events'); ?></p>
        <?php
        $req = (array) ($cfg['event_required_fields'] ?? ['name', 'start_datetime', 'price', 'location']);
        $candidates = [
            'name' => __('Event title', 'october-events'), 'start_datetime' => __('Dates & times', 'october-events'),
            'end_datetime' => __('End date & time', 'october-events'), 'price' => __('Price', 'october-events'),
            'location' => __('Location', 'october-events'), 'description' => __('Description', 'october-events'),
            'organiser' => __('Organiser', 'october-events'), 'image' => __('Image', 'october-events'),
        ];
        foreach ($candidates as $k => $label) : ?>
            <label style="display:inline-block;margin:0 16px 6px 0"><input type="checkbox" name="event_required_fields[]" value="<?php echo esc_attr($k); ?>" <?php checked(in_array($k, $req, true)); ?>> <?php echo esc_html($label); ?></label>
        <?php endforeach; ?>

        <h2><?php esc_html_e('API keys', 'october-events'); ?></h2>
        <p class="description"><?php esc_html_e('Enter your keys here, or define them as constants in wp-config.php (a constant always wins and locks the field). Stored keys are saved to the database.', 'october-events'); ?></p>
        <?php
        $labels = [
            'stripe_publishable_key' => __('Stripe publishable key', 'october-events'),
            'stripe_secret_key'      => __('Stripe secret key', 'october-events'),
            'stripe_webhook_secret'  => __('Stripe webhook secret', 'october-events'),
            'claude_api_key'         => __('Claude API key', 'october-events'),
            'google_maps_key'        => __('Google Maps key', 'october-events'),
        ];
        ?>
        <table class="form-table" style="max-width:720px">
            <?php foreach ($secrets as $key => $const) :
                $is_const = \OE\Settings::secret_is_constant($key);
                $value    = $is_const ? '' : (string) \OE\Settings::get($key, '');
                ?>
                <tr>
                    <th scope="row"><label for="oe-sec-<?php echo esc_attr($key); ?>"><?php echo esc_html($labels[$key] ?? $key); ?></label></th>
                    <td>
                        <?php if ($is_const) : ?>
                            <input type="text" class="regular-text" value="••••••••••" disabled>
                            <p class="description"><?php printf(/* translators: %s: constant */ esc_html__('Locked — defined by the %s constant in wp-config.php.', 'october-events'), '<code>' . esc_html($const) . '</code>'); ?></p>
                        <?php else : ?>
                            <span class="oe-secret-wrap">
                                <input type="password" id="oe-sec-<?php echo esc_attr($key); ?>" class="regular-text oe-secret" name="secret_<?php echo esc_attr($key); ?>" value="<?php echo esc_attr($value); ?>" autocomplete="off" spellcheck="false">
                                <button type="button" class="button oe-secret-toggle" aria-label="<?php esc_attr_e('Show / hide', 'october-events'); ?>" title="<?php esc_attr_e('Show / hide', 'october-events'); ?>"><span class="dashicons dashicons-visibility"></span></button>
                            </span>
                        <?php endif; ?>
                    </td>
                </tr>
            <?php endforeach; ?>
        </table>

        <h2><?php esc_html_e('Tier pricing', 'october-events'); ?></h2>
        <p class="description"><?php esc_html_e('Amounts in your chosen currency. Leave 0 for free.', 'october-events'); ?></p>
        <table class="widefat striped" style="max-width:640px">
            <thead><tr><th><?php esc_html_e('Type', 'october-events'); ?></th><th><?php esc_html_e('Featured', 'october-events'); ?></th><th><?php esc_html_e('Premium', 'october-events'); ?></th></tr></thead>
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
        <p><label><?php esc_html_e('Currency', 'october-events'); ?> <input type="text" name="currency" value="<?php echo esc_attr((string) ($cfg['currency'] ?? 'usd')); ?>" size="5"></label></p>

        <h2 id="voice"><?php esc_html_e('AI Stories connector', 'october-events'); ?></h2>
        <p><label><?php esc_html_e('Model', 'october-events'); ?><br><input type="text" name="ai_model" class="regular-text" value="<?php echo esc_attr((string) ($cfg['ai_model'] ?? '')); ?>"></label></p>
        <p><label><?php esc_html_e('Source URLs (one per line, RSS preferred)', 'october-events'); ?><br>
            <textarea name="ai_source_urls" rows="5" class="large-text"><?php echo esc_textarea(implode("\n", (array) ($cfg['ai_source_urls'] ?? []))); ?></textarea></label></p>

        <h3><?php esc_html_e('Tone of voice training', 'october-events'); ?></h3>
        <p class="description"><?php esc_html_e('This is how you "train" the AI. The style guide and examples below are sent to Claude with every story it writes, steering it to sound like ADF. Be specific about voice, rhythm, vocabulary, and what to avoid.', 'october-events'); ?></p>
        <p><label><strong><?php esc_html_e('House style guide', 'october-events'); ?></strong><br>
            <textarea name="ai_voice_guide" rows="8" class="large-text" placeholder="<?php esc_attr_e('e.g. Write in third person. Lead with the design idea, not the event. Favour concrete nouns over adjectives. Never use words like “stunning”, “must-see”, “game-changing”. UK/US spelling: US. Reference Atlanta neighbourhoods by name where relevant…', 'october-events'); ?>"><?php echo esc_textarea((string) ($cfg['ai_voice_guide'] ?? '')); ?></textarea></label></p>
        <p><label><strong><?php esc_html_e('Example pieces', 'october-events'); ?></strong> — <?php esc_html_e('paste 1–4 published pieces that exemplify the voice, separated by a line containing only ---', 'october-events'); ?><br>
            <textarea name="ai_examples" rows="12" class="large-text" placeholder="<?php esc_attr_e("Headline of a great ADF piece\nFull body text in the ADF voice…\n---\nAnother example headline\nIts body text…", 'october-events'); ?>"><?php echo esc_textarea(implode("\n---\n", (array) ($cfg['ai_examples'] ?? []))); ?></textarea></label></p>
        <p class="description"><?php echo esc_html(sprintf(/* translators: %d: count */ __('Currently %d example(s) saved.', 'october-events'), count((array) ($cfg['ai_examples'] ?? [])))); ?></p>

        <h2><?php esc_html_e('Rejection email copy', 'october-events'); ?></h2>
        <p class="description"><?php esc_html_e('Optional per-type overrides. Variables: {listing_name}, {listing_type}, {refund_amount}. Leave blank to use the default copy.', 'october-events'); ?></p>
        <?php foreach (PostTypes::listing_types() as $type) : ?>
            <p><label><strong><?php echo esc_html(PostTypes::TYPES[$type]['label']); ?></strong><br>
                <textarea name="rejection_copy[<?php echo esc_attr($type); ?>]" rows="3" class="large-text"><?php echo esc_textarea((string) ($cfg['rejection_copy'][$type] ?? '')); ?></textarea></label></p>
        <?php endforeach; ?>

        <h2><?php esc_html_e('Volunteer reminders', 'october-events'); ?></h2>
        <p class="description"><?php esc_html_e('Email reminders always send via Brevo. SMS is optional (Brevo transactional SMS) and only goes to volunteers who provided a mobile and opted in.', 'october-events'); ?></p>
        <p><label><input type="checkbox" name="sms_enabled" value="1" <?php checked(! empty($cfg['sms_enabled'])); ?>> <?php esc_html_e('Enable SMS reminders (requires Brevo SMS credits)', 'october-events'); ?></label></p>
        <p><label><?php esc_html_e('SMS sender name', 'october-events'); ?> <input type="text" name="sms_sender" value="<?php echo esc_attr((string) ($cfg['sms_sender'] ?? 'ADF')); ?>" maxlength="11" size="12"></label> <span class="description"><?php esc_html_e('Max 11 characters, must be approved in Brevo.', 'october-events'); ?></span></p>
        <p><strong><?php esc_html_e('Send reminders:', 'october-events'); ?></strong></p>
        <?php $offsets = (array) ($cfg['reminder_offsets'] ?? []); ?>
        <p>
            <label><input type="checkbox" name="reminder_offsets[week]" value="1" <?php checked(in_array('week', $offsets, true)); ?>> <?php esc_html_e('1 week before', 'october-events'); ?></label><br>
            <label><input type="checkbox" name="reminder_offsets[48h]" value="1" <?php checked(in_array('48h', $offsets, true)); ?>> <?php esc_html_e('48 hours before', 'october-events'); ?></label><br>
            <label><input type="checkbox" name="reminder_offsets[morning]" value="1" <?php checked(in_array('morning', $offsets, true)); ?>> <?php esc_html_e('Morning of (≈3h before)', 'october-events'); ?></label>
        </p>
        <p class="description"><?php esc_html_e('A confirmation always sends immediately on signup.', 'october-events'); ?></p>

        <h2><?php esc_html_e('Digest & reports', 'october-events'); ?></h2>
        <p><label><input type="checkbox" name="digest_enabled" value="1" <?php checked(! empty($cfg['digest_enabled'])); ?>> <?php esc_html_e('Send the monthly digest automatically (first Monday).', 'october-events'); ?></label></p>
        <p><label><?php esc_html_e('Daily ticket sales report to', 'october-events'); ?> <input type="email" name="report_email" value="<?php echo esc_attr((string) ($cfg['report_email'] ?? '')); ?>" class="regular-text" placeholder="<?php echo esc_attr(get_option('admin_email')); ?>"></label> <span class="description"><?php esc_html_e('Blank = site admin. Only sends on days with sales.', 'october-events'); ?></span></p>

        <h2 id="updates"><?php esc_html_e('Updates (GitHub)', 'october-events'); ?></h2>
        <p class="description"><?php esc_html_e('New versions are published as GitHub Releases tagged oe-v<version> and offered in Dashboard → Updates. Provide a fine-grained token with Contents: read (or define OE_GITHUB_TOKEN in wp-config.php).', 'october-events'); ?></p>
        <p><label><?php esc_html_e('Repository', 'october-events'); ?> <input type="text" name="github_repo" class="regular-text" value="<?php echo esc_attr((string) ($cfg['github_repo'] ?? 'octobercomms/claude')); ?>"></label></p>
        <?php $token_const = defined('OE_GITHUB_TOKEN') && OE_GITHUB_TOKEN; ?>
        <p><label><?php esc_html_e('GitHub token', 'october-events'); ?></label><br>
            <span class="oe-secret-wrap">
                <input type="password" name="github_token" class="regular-text oe-secret" autocomplete="off" value="<?php echo esc_attr(\OE\Crypto::decrypt((string) ($cfg['github_token'] ?? ''))); ?>" <?php echo $token_const ? 'disabled placeholder="Set via OE_GITHUB_TOKEN constant"' : ''; ?>>
                <?php if (! $token_const) : ?><button type="button" class="button oe-secret-toggle" aria-label="<?php esc_attr_e('Show / hide', 'october-events'); ?>"><span class="dashicons dashicons-visibility"></span></button><?php endif; ?>
            </span></p>

        <h2 id="platform"><?php esc_html_e('Planning platform (CORS)', 'october-events'); ?></h2>
        <p class="description"><?php esc_html_e('Origins allowed to call this site\'s oe/v1 REST API from the browser — i.e. the planning platform SPA. One per line, scheme + host with no trailing slash (e.g. https://october-platform.pages.dev and https://platform.atlantadesignfestival.net). Leave the defaults if unsure.', 'october-events'); ?></p>
        <?php $origins = (array) ($cfg['platform_origins'] ?? []); ?>
        <p><textarea name="platform_origins" rows="3" class="large-text code" placeholder="https://october-platform.pages.dev"><?php echo esc_textarea(implode("\n", $origins)); ?></textarea></p>

        <h2 id="email"><?php esc_html_e('Email sending (Amazon SES)', 'october-events'); ?></h2>
        <p class="description"><?php esc_html_e('Route all site email through Amazon SES (SMTP). Off by default — until enabled and fully configured, the site keeps using its current mail transport. Generate SMTP credentials in the SES console (they are not your AWS keys).', 'october-events'); ?></p>
        <?php $ses_pw_const = \OE\Settings::secret_is_constant('ses_smtp_password'); ?>
        <table class="form-table" role="presentation"><tbody>
            <tr>
                <th scope="row"><?php esc_html_e('Enable SES', 'october-events'); ?></th>
                <td><label><input type="checkbox" name="ses_enabled" value="1" <?php checked((bool) ($cfg['ses_enabled'] ?? false)); ?>> <?php esc_html_e('Send all site email via Amazon SES', 'october-events'); ?></label></td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('AWS region', 'october-events'); ?></label></th>
                <td><input type="text" name="ses_region" value="<?php echo esc_attr((string) ($cfg['ses_region'] ?? 'us-east-1')); ?>" placeholder="us-east-1" class="regular-text"></td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('SMTP username', 'october-events'); ?></label></th>
                <td><input type="text" name="ses_smtp_user" value="<?php echo esc_attr((string) ($cfg['ses_smtp_user'] ?? '')); ?>" autocomplete="off" class="regular-text"></td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('SMTP password', 'october-events'); ?></label></th>
                <td><span class="oe-secret-wrap">
                    <input type="password" name="ses_smtp_password" class="regular-text oe-secret" autocomplete="off" value="<?php echo esc_attr(\OE\Crypto::decrypt((string) ($cfg['ses_smtp_password'] ?? ''))); ?>" <?php echo $ses_pw_const ? 'disabled placeholder="Set via OE_SES_SMTP_PASSWORD constant"' : ''; ?>>
                    <?php if (! $ses_pw_const) : ?><button type="button" class="button oe-secret-toggle" aria-label="<?php esc_attr_e('Show / hide', 'october-events'); ?>"><span class="dashicons dashicons-visibility"></span></button><?php endif; ?>
                </span></td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('From address', 'october-events'); ?></label></th>
                <td><input type="email" name="mail_from_email" value="<?php echo esc_attr((string) ($cfg['mail_from_email'] ?? '')); ?>" placeholder="hello@news.atlantadesignfestival.net" class="regular-text">
                    <p class="description"><?php esc_html_e('Must be a verified SES sender/domain.', 'october-events'); ?></p></td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('From name', 'october-events'); ?></label></th>
                <td><input type="text" name="mail_from_name" value="<?php echo esc_attr((string) ($cfg['mail_from_name'] ?? '')); ?>" placeholder="Atlanta Design Festival" class="regular-text"></td>
            </tr>
        </tbody></table>

        <h2 id="branding"><?php esc_html_e('Branding (platform theme)', 'october-events'); ?></h2>
        <p class="description"><?php esc_html_e('Override the planning platform\'s look for this site. Leave any field blank to use the built-in October defaults (Brockmann + brand yellow). The site display name comes from Brand, above.', 'october-events'); ?></p>
        <table class="form-table" role="presentation"><tbody>
            <tr>
                <th scope="row"><label><?php esc_html_e('Accent colour', 'october-events'); ?></label></th>
                <td><input type="text" name="theme_accent" value="<?php echo esc_attr((string) ($cfg['theme_accent'] ?? '')); ?>" placeholder="#E7CD41" class="regular-text">
                    <p class="description"><?php esc_html_e('Buttons, active nav, highlights.', 'october-events'); ?></p></td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('Text on accent', 'october-events'); ?></label></th>
                <td><input type="text" name="theme_accent_on" value="<?php echo esc_attr((string) ($cfg['theme_accent_on'] ?? '')); ?>" placeholder="#1a1a1a" class="regular-text"></td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('Sidebar colour', 'october-events'); ?></label></th>
                <td><input type="text" name="theme_sidebar_bg" value="<?php echo esc_attr((string) ($cfg['theme_sidebar_bg'] ?? '')); ?>" placeholder="#0b0b0c" class="regular-text"></td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('Page background', 'october-events'); ?></label></th>
                <td><input type="text" name="theme_page_bg" value="<?php echo esc_attr((string) ($cfg['theme_page_bg'] ?? '')); ?>" placeholder="#faf9f5" class="regular-text"></td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('Logo — light surfaces', 'october-events'); ?></label></th>
                <td><input type="url" name="theme_logo_light" value="<?php echo esc_attr((string) ($cfg['theme_logo_light'] ?? '')); ?>" placeholder="https://…/logo-dark.png" class="regular-text">
                    <p class="description"><?php esc_html_e('Shown on the white login card. Paste a Media Library URL.', 'october-events'); ?></p></td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('Logo — dark sidebar', 'october-events'); ?></label></th>
                <td><input type="url" name="theme_logo_dark" value="<?php echo esc_attr((string) ($cfg['theme_logo_dark'] ?? '')); ?>" placeholder="https://…/logo-light.png" class="regular-text">
                    <p class="description"><?php esc_html_e('Shown in the dark sidebar (use a light/white version).', 'october-events'); ?></p></td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('Custom font', 'october-events'); ?></label></th>
                <td><input type="text" name="theme_font_family" value="<?php echo esc_attr((string) ($cfg['theme_font_family'] ?? '')); ?>" placeholder="Inter" class="regular-text">
                    <input type="url" name="theme_font_css" value="<?php echo esc_attr((string) ($cfg['theme_font_css'] ?? '')); ?>" placeholder="https://fonts.googleapis.com/css2?family=Inter…" class="regular-text" style="margin-top:6px">
                    <p class="description"><?php esc_html_e('Family name + a stylesheet URL that loads it (e.g. Google Fonts). Blank = Brockmann.', 'october-events'); ?></p></td>
            </tr>
        </tbody></table>

        <?php submit_button(); ?>
    </form>

    <hr>
    <h2><?php esc_html_e('Test the voice', 'october-events'); ?></h2>
    <p class="description"><?php esc_html_e('Paste a sample source article (or any text) and run it through the trained editorial prompt to preview how a generated story would read. Save your style guide above first.', 'october-events'); ?></p>
    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
        <input type="hidden" name="action" value="oe_test_voice">
        <?php wp_nonce_field('oe_test_voice'); ?>
        <p><textarea name="oe_voice_sample" rows="6" class="large-text" placeholder="<?php esc_attr_e('Paste a source article here…', 'october-events'); ?>"></textarea></p>
        <?php submit_button(__('Generate preview', 'october-events'), 'primary', 'submit', false); ?>
    </form>
    <?php $voice = get_transient('oe_voice_test'); if (is_array($voice)) { delete_transient('oe_voice_test'); ?>
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
    <h2 id="update-test"><?php esc_html_e('Updates', 'october-events'); ?></h2>
    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="margin-top:-8px">
        <input type="hidden" name="action" value="oe_test_updater">
        <?php wp_nonce_field('oe_test_updater'); ?>
        <?php submit_button(__('Test update connection', 'october-events'), 'secondary', 'submit', false); ?>
    </form>
    <?php $diag = get_transient('oe_updater_diag'); if (is_array($diag)) { delete_transient('oe_updater_diag'); ?>
        <div class="notice <?php echo $diag['ok'] ? 'notice-success' : 'notice-error'; ?>" style="margin-top:10px"><p><?php echo esc_html($diag['message']); ?></p></div>
    <?php } ?>

    <style>
        .oe-secret-wrap { display: inline-flex; align-items: center; gap: 4px; }
        .oe-secret-toggle { display: inline-flex !important; align-items: center; padding: 0 6px !important; }
        .oe-secret-toggle .dashicons { width: 18px; height: 18px; font-size: 18px; }
    </style>
    <script>
    (function () {
        document.querySelectorAll('.oe-secret-toggle').forEach(function (btn) {
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
