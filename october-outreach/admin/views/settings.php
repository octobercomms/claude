<?php if ( ! defined( 'ABSPATH' ) ) exit;
$settings       = get_option( 'oo_settings', array() );
$license        = OO_License::get_status_label();
$php_timeout    = intval( ini_get( 'max_execution_time' ) );
$timeout_ok     = $php_timeout === 0 || $php_timeout >= 120;
$email_provider = $settings['email_provider'] ?? 'ses';

// attempt to extend timeout for this page load
@set_time_limit( 300 );
?>

<div class="oo-page-header">
    <h1 class="oo-page-title">Settings</h1>
</div>

<?php if ( isset( $_GET['saved'] ) ) : ?>
<div class="oo-notice oo-notice-success">Settings saved.</div>
<?php endif; ?>

<?php if ( ! $timeout_ok ) : ?>
<div class="oo-notice oo-notice-warning" style="background:#fffbeb;border-left:4px solid #f59e0b;color:#92400e;margin-bottom:20px">
    <strong>⚠ Your website has a speed limit that may affect this plugin.</strong>
    <p style="margin:8px 0 4px">Your web hosting is currently set to stop tasks after <strong><?php echo $php_timeout; ?> seconds</strong>. Some features in October Outreach — like searching for contacts and writing emails with AI — can take longer than that. If you hit this limit, a task will stop partway through without warning.</p>
    <p style="margin:4px 0"><strong>You don't need to fix this yourself.</strong> Just forward the email below to your web developer or hosting support and they can sort it in a couple of minutes.</p>
    <details style="margin-top:12px">
        <summary style="cursor:pointer;font-weight:600;color:#78350f">📧 Copy this email to send to your developer or host →</summary>
        <div style="background:#fef3c7;border-radius:6px;padding:16px;margin-top:10px;white-space:pre-wrap;font-family:monospace;font-size:13px;line-height:1.6">Hi,

I've installed a plugin on my WordPress website called October Outreach. It uses AI to write emails and search for contacts, and some of those tasks can take up to 2–3 minutes to complete.

My hosting is currently set to a 60-second limit (max_execution_time = <?php echo $php_timeout; ?>). Could you please increase this to 300 seconds (5 minutes)?

This can usually be done by adding the following line to the .htaccess file in the root of my website:

    php_value max_execution_time 300

Or via php.ini / the hosting control panel. Let me know if you need anything else.

Thanks!</div>
    </details>
</div>
<?php endif; ?>

<style>
.oo-secret-wrap { position:relative; display:flex; align-items:center; }
.oo-secret-wrap .oo-input { padding-right:40px; flex:1; }
.oo-eye-btn { position:absolute; right:10px; background:none; border:none; cursor:pointer; color:var(--oo-muted); padding:0; line-height:1; }
.oo-eye-btn:hover { color:var(--oo-text); }
.oo-eye-btn svg { display:block; width:18px; height:18px; }
.oo-provider-radios { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:20px; }
.oo-provider-radio { display:none; }
.oo-provider-label { display:flex; align-items:center; gap:8px; padding:10px 16px; border:2px solid var(--oo-border); border-radius:8px; cursor:pointer; font-size:14px; font-weight:500; transition:border-color .15s,background .15s; }
.oo-provider-radio:checked + .oo-provider-label { border-color:var(--oo-accent); background:rgba(99,102,241,.06); color:var(--oo-accent); }
.oo-provider-panel { display:none; }
.oo-provider-panel.active { display:block; }
</style>

<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
    <?php wp_nonce_field( 'oo_save_settings' ); ?>
    <input type="hidden" name="action" value="oo_save_settings">

    <div class="oo-settings-grid">

        <!-- License -->
        <div class="oo-card">
            <h2 class="oo-card-title">License</h2>
            <p class="oo-muted" style="margin-bottom:14px">Status: <span class="oo-badge oo-badge-<?php echo esc_attr( $license['color'] ); ?>"><?php echo esc_html( $license['label'] ); ?></span></p>
            <div class="oo-field">
                <label class="oo-label">License Key</label>
                <input type="text" name="license_key" class="oo-input" value="<?php echo esc_attr( $settings['license_key'] ?? '' ); ?>" placeholder="OO-XXXX-XXXX-XXXX">
            </div>
        </div>

        <!-- Claude API -->
        <div class="oo-card">
            <h2 class="oo-card-title">Claude AI</h2>
            <p class="oo-muted" style="margin-bottom:14px">Powers contact research, email writing, and reply classification. <a href="https://console.anthropic.com" target="_blank">Get your key →</a></p>
            <div class="oo-field">
                <label class="oo-label">API Key</label>
                <div class="oo-secret-wrap">
                    <input type="password" name="claude_api_key" class="oo-input" value="<?php echo esc_attr( $settings['claude_api_key'] ?? '' ); ?>" placeholder="sk-ant-...">
                    <?php if ( ! empty( $settings['claude_api_key'] ) ) : ?><button type="button" class="oo-eye-btn" aria-label="Show"><?php echo oo_eye_svg(); ?></button><?php endif; ?>
                </div>
                <?php if ( ! empty( $settings['claude_api_key'] ) ) : ?><span class="oo-badge oo-badge-green" style="margin-top:6px;display:inline-block">Configured</span><?php endif; ?>
            </div>
        </div>

        <!-- Contact Finders -->
        <div class="oo-card">
            <h2 class="oo-card-title">Hunter.io</h2>
            <p class="oo-muted" style="margin-bottom:14px">Finds named contacts by company domain. Free plan includes 50 searches/month — used first when both are configured. <a href="https://hunter.io/api-keys" target="_blank">Get your key →</a></p>
            <div class="oo-field">
                <label class="oo-label">API Key</label>
                <div class="oo-secret-wrap">
                    <input type="password" name="hunter_api_key" class="oo-input" value="<?php echo esc_attr( $settings['hunter_api_key'] ?? '' ); ?>">
                    <?php if ( ! empty( $settings['hunter_api_key'] ) ) : ?><button type="button" class="oo-eye-btn" aria-label="Show"><?php echo oo_eye_svg(); ?></button><?php endif; ?>
                </div>
                <?php if ( ! empty( $settings['hunter_api_key'] ) ) : ?><span class="oo-badge oo-badge-green" style="margin-top:6px;display:inline-block">Configured</span><?php endif; ?>
            </div>
        </div>

        <div class="oo-card">
            <h2 class="oo-card-title">Icypeas</h2>
            <p class="oo-muted" style="margin-bottom:14px">PAYG contact finder — credits roll over and never expire. Used automatically when Hunter.io credits run out or Hunter isn't configured. <a href="https://app.icypeas.com/bo/api" target="_blank">Get your keys →</a></p>
            <div class="oo-field">
                <label class="oo-label">API Key</label>
                <div class="oo-secret-wrap">
                    <input type="password" name="icypeas_api_key" class="oo-input" value="<?php echo esc_attr( $settings['icypeas_api_key'] ?? '' ); ?>">
                    <?php if ( ! empty( $settings['icypeas_api_key'] ) ) : ?><button type="button" class="oo-eye-btn" aria-label="Show"><?php echo oo_eye_svg(); ?></button><?php endif; ?>
                </div>
            </div>
            <div class="oo-field">
                <label class="oo-label">API Secret</label>
                <div class="oo-secret-wrap">
                    <input type="password" name="icypeas_api_secret" class="oo-input" value="<?php echo esc_attr( $settings['icypeas_api_secret'] ?? '' ); ?>">
                    <?php if ( ! empty( $settings['icypeas_api_secret'] ) ) : ?><button type="button" class="oo-eye-btn" aria-label="Show"><?php echo oo_eye_svg(); ?></button><?php endif; ?>
                </div>
            </div>
            <div class="oo-field">
                <label class="oo-label">User ID</label>
                <input type="text" name="icypeas_user_id" class="oo-input" value="<?php echo esc_attr( $settings['icypeas_user_id'] ?? '' ); ?>">
            </div>
            <?php if ( ! empty( $settings['icypeas_api_key'] ) && ! empty( $settings['icypeas_api_secret'] ) ) : ?><span class="oo-badge oo-badge-green" style="margin-top:6px;display:inline-block">Configured</span><?php endif; ?>
        </div>

        <!-- Serper Web Search -->
        <div class="oo-card">
            <h2 class="oo-card-title">Serper (Web Search)</h2>
            <p class="oo-muted" style="margin-bottom:14px">Powers the "Discover via Web Search" feature — finds real businesses by searching Google, then scrapes industry directories for firm domains. ~2,500 free searches/month. <a href="https://serper.dev" target="_blank">Get your key →</a></p>
            <div class="oo-field">
                <label class="oo-label">API Key</label>
                <div class="oo-secret-wrap">
                    <input type="password" name="serper_api_key" class="oo-input" value="<?php echo esc_attr( $settings['serper_api_key'] ?? '' ); ?>" placeholder="...">
                    <?php if ( ! empty( $settings['serper_api_key'] ) ) : ?><button type="button" class="oo-eye-btn" aria-label="Show"><?php echo oo_eye_svg(); ?></button><?php endif; ?>
                </div>
                <?php if ( ! empty( $settings['serper_api_key'] ) ) : ?><span class="oo-badge oo-badge-green" style="margin-top:6px;display:inline-block">Configured</span><?php endif; ?>
            </div>
        </div>

        <!-- Airtable -->
        <div class="oo-card">
            <h2 class="oo-card-title">Airtable</h2>
            <p class="oo-muted" style="margin-bottom:14px">Syncs contacts so you can view and edit them outside WordPress. <a href="https://airtable.com/account" target="_blank">Get your token →</a></p>
            <div class="oo-field">
                <label class="oo-label">Personal Access Token</label>
                <div class="oo-secret-wrap">
                    <input type="password" name="airtable_api_key" class="oo-input" value="<?php echo esc_attr( $settings['airtable_api_key'] ?? '' ); ?>" placeholder="pat...">
                    <?php if ( ! empty( $settings['airtable_api_key'] ) ) : ?><button type="button" class="oo-eye-btn" aria-label="Show"><?php echo oo_eye_svg(); ?></button><?php endif; ?>
                </div>
            </div>
            <div class="oo-field">
                <label class="oo-label">Base ID</label>
                <input type="text" name="airtable_base_id" class="oo-input" value="<?php echo esc_attr( $settings['airtable_base_id'] ?? '' ); ?>" placeholder="app...">
                <p class="oo-hint">Found in your Airtable base URL: airtable.com/<strong>appXXXXXX</strong>/...</p>
                <?php if ( ! empty( $settings['airtable_api_key'] ) && ! empty( $settings['airtable_base_id'] ) ) : ?><span class="oo-badge oo-badge-green" style="margin-top:6px;display:inline-block">Configured</span><?php endif; ?>
            </div>
        </div>

        <!-- Email Sending -->
        <div class="oo-card" style="grid-column:1/-1">
            <h2 class="oo-card-title">Email Sending</h2>
            <p class="oo-muted" style="margin-bottom:16px">Choose how October Outreach sends your campaign emails. All options send on your behalf — replies always come back to you.</p>

            <div class="oo-provider-radios">
                <?php
                $providers = array(
                    'ses'      => array( 'label' => 'Amazon SES',  'badge' => 'Best value' ),
                    'mailgun'  => array( 'label' => 'Mailgun',     'badge' => 'Popular' ),
                    'sendgrid' => array( 'label' => 'SendGrid',    'badge' => '' ),
                    'smtp'     => array( 'label' => 'SMTP',        'badge' => 'Any host' ),
                );
                foreach ( $providers as $key => $p ) : ?>
                <div>
                    <input type="radio" name="email_provider" id="provider_<?php echo $key; ?>" value="<?php echo $key; ?>" class="oo-provider-radio" <?php checked( $email_provider, $key ); ?>>
                    <label for="provider_<?php echo $key; ?>" class="oo-provider-label">
                        <?php echo esc_html( $p['label'] ); ?>
                        <?php if ( $p['badge'] ) : ?><span class="oo-badge oo-badge-blue" style="font-size:10px"><?php echo esc_html( $p['badge'] ); ?></span><?php endif; ?>
                    </label>
                </div>
                <?php endforeach; ?>
            </div>

            <!-- SES -->
            <div class="oo-provider-panel <?php echo $email_provider === 'ses' ? 'active' : ''; ?>" id="panel_ses">
                <div class="oo-field">
                    <label class="oo-label">Access Key ID</label>
                    <div class="oo-secret-wrap">
                        <input type="password" name="ses_key" class="oo-input" value="<?php echo esc_attr( $settings['ses_key'] ?? '' ); ?>">
                        <?php if ( ! empty( $settings['ses_key'] ) ) : ?><button type="button" class="oo-eye-btn" aria-label="Show"><?php echo oo_eye_svg(); ?></button><?php endif; ?>
                    </div>
                </div>
                <div class="oo-field">
                    <label class="oo-label">Secret Access Key</label>
                    <div class="oo-secret-wrap">
                        <input type="password" name="ses_secret" class="oo-input" value="<?php echo esc_attr( $settings['ses_secret'] ?? '' ); ?>">
                        <?php if ( ! empty( $settings['ses_secret'] ) ) : ?><button type="button" class="oo-eye-btn" aria-label="Show"><?php echo oo_eye_svg(); ?></button><?php endif; ?>
                    </div>
                </div>
                <div class="oo-field">
                    <label class="oo-label">Region</label>
                    <select name="ses_region" class="oo-select" style="max-width:240px">
                        <?php foreach ( array( 'eu-west-1' => 'EU (Ireland)', 'eu-west-2' => 'EU (London)', 'eu-central-1' => 'EU (Frankfurt)', 'us-east-1' => 'US East (N. Virginia)', 'us-west-2' => 'US West (Oregon)' ) as $val => $lbl ) : ?>
                        <option value="<?php echo esc_attr( $val ); ?>" <?php selected( $settings['ses_region'] ?? 'eu-west-1', $val ); ?>><?php echo esc_html( $lbl ); ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <?php if ( ! empty( $settings['ses_key'] ) ) : ?><span class="oo-badge oo-badge-green">Configured</span><?php endif; ?>
            </div>

            <!-- Mailgun -->
            <div class="oo-provider-panel <?php echo $email_provider === 'mailgun' ? 'active' : ''; ?>" id="panel_mailgun">
                <div class="oo-field">
                    <label class="oo-label">API Key</label>
                    <div class="oo-secret-wrap">
                        <input type="password" name="mailgun_api_key" class="oo-input" value="<?php echo esc_attr( $settings['mailgun_api_key'] ?? '' ); ?>" placeholder="key-...">
                        <?php if ( ! empty( $settings['mailgun_api_key'] ) ) : ?><button type="button" class="oo-eye-btn" aria-label="Show"><?php echo oo_eye_svg(); ?></button><?php endif; ?>
                    </div>
                </div>
                <div class="oo-field">
                    <label class="oo-label">Sending Domain</label>
                    <input type="text" name="mailgun_domain" class="oo-input" value="<?php echo esc_attr( $settings['mailgun_domain'] ?? '' ); ?>" placeholder="mg.yourdomain.com">
                    <p class="oo-hint">The domain you've verified in your Mailgun account.</p>
                </div>
                <div class="oo-field">
                    <label class="oo-label">Region</label>
                    <select name="mailgun_region" class="oo-select" style="max-width:200px">
                        <option value="us" <?php selected( $settings['mailgun_region'] ?? 'us', 'us' ); ?>>US</option>
                        <option value="eu" <?php selected( $settings['mailgun_region'] ?? '', 'eu' ); ?>>EU</option>
                    </select>
                </div>
                <?php if ( ! empty( $settings['mailgun_api_key'] ) ) : ?><span class="oo-badge oo-badge-green">Configured</span><?php endif; ?>
            </div>

            <!-- SendGrid -->
            <div class="oo-provider-panel <?php echo $email_provider === 'sendgrid' ? 'active' : ''; ?>" id="panel_sendgrid">
                <div class="oo-field">
                    <label class="oo-label">API Key</label>
                    <div class="oo-secret-wrap">
                        <input type="password" name="sendgrid_api_key" class="oo-input" value="<?php echo esc_attr( $settings['sendgrid_api_key'] ?? '' ); ?>" placeholder="SG....">
                        <?php if ( ! empty( $settings['sendgrid_api_key'] ) ) : ?><button type="button" class="oo-eye-btn" aria-label="Show"><?php echo oo_eye_svg(); ?></button><?php endif; ?>
                    </div>
                    <p class="oo-hint">Create a key at app.sendgrid.com → Settings → API Keys. Needs "Mail Send" permission.</p>
                </div>
                <?php if ( ! empty( $settings['sendgrid_api_key'] ) ) : ?><span class="oo-badge oo-badge-green">Configured</span><?php endif; ?>
            </div>

            <!-- SMTP -->
            <div class="oo-provider-panel <?php echo $email_provider === 'smtp' ? 'active' : ''; ?>" id="panel_smtp">
                <p class="oo-muted" style="margin-bottom:14px">Use any email service that provides SMTP credentials — your hosting provider, Gmail (with app password), Zoho, etc.</p>
                <div class="oo-field">
                    <label class="oo-label">SMTP Host</label>
                    <input type="text" name="smtp_host" class="oo-input" value="<?php echo esc_attr( $settings['smtp_host'] ?? '' ); ?>" placeholder="smtp.yourdomain.com">
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
                    <div class="oo-field">
                        <label class="oo-label">Port</label>
                        <input type="text" name="smtp_port" class="oo-input" value="<?php echo esc_attr( $settings['smtp_port'] ?? '587' ); ?>" placeholder="587">
                    </div>
                    <div class="oo-field">
                        <label class="oo-label">Encryption</label>
                        <select name="smtp_encryption" class="oo-select">
                            <option value="tls" <?php selected( $settings['smtp_encryption'] ?? 'tls', 'tls' ); ?>>TLS (recommended)</option>
                            <option value="ssl" <?php selected( $settings['smtp_encryption'] ?? '', 'ssl' ); ?>>SSL</option>
                            <option value="none" <?php selected( $settings['smtp_encryption'] ?? '', 'none' ); ?>>None</option>
                        </select>
                    </div>
                </div>
                <div class="oo-field">
                    <label class="oo-label">Username</label>
                    <input type="text" name="smtp_username" class="oo-input" value="<?php echo esc_attr( $settings['smtp_username'] ?? '' ); ?>" placeholder="you@yourdomain.com">
                </div>
                <div class="oo-field">
                    <label class="oo-label">Password</label>
                    <div class="oo-secret-wrap">
                        <input type="password" name="smtp_password" class="oo-input" value="<?php echo esc_attr( $settings['smtp_password'] ?? '' ); ?>">
                        <?php if ( ! empty( $settings['smtp_password'] ) ) : ?><button type="button" class="oo-eye-btn" aria-label="Show"><?php echo oo_eye_svg(); ?></button><?php endif; ?>
                    </div>
                </div>
                <?php if ( ! empty( $settings['smtp_host'] ) ) : ?><span class="oo-badge oo-badge-green">Configured</span><?php endif; ?>
            </div>

            <div class="oo-field" style="margin-top:20px;padding-top:20px;border-top:1px solid var(--oo-border)">
                <label class="oo-label">Default Reply-To Address</label>
                <input type="email" name="default_reply_to" class="oo-input" value="<?php echo esc_attr( $settings['default_reply_to'] ?? '' ); ?>" placeholder="you@yourdomain.com" style="max-width:320px">
                <p class="oo-hint">All outreach replies will be delivered to this address, regardless of which address emails are sent from.</p>
            </div>

            <div class="oo-field" style="margin-top:16px">
                <label class="oo-label">Outreach Sending Domain</label>
                <input type="text" name="sending_domain" class="oo-input" value="<?php echo esc_attr( $settings['sending_domain'] ?? '' ); ?>" placeholder="outreach.yourdomain.com" style="max-width:320px">
                <p class="oo-hint">The domain your outreach emails are sent from. Used to check your SPF and DMARC records are correctly set up. <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-help#email-auth' ) ); ?>">What are these? →</a></p>
            </div>
        </div>

    </div>

    <div class="oo-wizard-actions" style="padding-top:0">
        <button type="submit" class="oo-btn oo-btn-primary oo-btn-lg">Save Settings</button>
    </div>
</form>

<script>
// Eye toggle
document.querySelectorAll('.oo-eye-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
        var input = this.previousElementSibling;
        input.type = input.type === 'password' ? 'text' : 'password';
    });
});

// Email provider panel switching
document.querySelectorAll('[name="email_provider"]').forEach(function(radio) {
    radio.addEventListener('change', function() {
        document.querySelectorAll('.oo-provider-panel').forEach(function(p) { p.classList.remove('active'); });
        var panel = document.getElementById('panel_' + radio.value);
        if (panel) panel.classList.add('active');
    });
});
</script>

<?php
function oo_eye_svg() {
    return '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.641 0-8.573-3.007-9.964-7.178Z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>';
}
?>
