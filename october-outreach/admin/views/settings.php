<?php if ( ! defined( 'ABSPATH' ) ) exit;
$settings = get_option( 'oo_settings', array() );
$license  = OO_License::get_status_label();
?>

<div class="oo-page-header">
    <h1 class="oo-page-title">Settings</h1>
</div>

<?php if ( isset( $_GET['saved'] ) ) : ?>
<div class="oo-notice oo-notice-success">Settings saved.</div>
<?php endif; ?>

<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
    <?php wp_nonce_field( 'oo_save_settings' ); ?>
    <input type="hidden" name="action" value="oo_save_settings">

    <div class="oo-settings-grid">

        <div class="oo-card">
            <h2 class="oo-card-title">License</h2>
            <p class="oo-muted" style="margin-bottom:14px">Status: <span class="oo-badge oo-badge-<?php echo esc_attr( $license['color'] ); ?>"><?php echo esc_html( $license['label'] ); ?></span></p>
            <div class="oo-field">
                <label class="oo-label">License Key</label>
                <input type="text" name="license_key" class="oo-input" value="<?php echo esc_attr( $settings['license_key'] ?? '' ); ?>" placeholder="OO-XXXX-XXXX-XXXX">
            </div>
        </div>

        <div class="oo-card">
            <h2 class="oo-card-title">Claude API</h2>
            <p class="oo-muted" style="margin-bottom:14px">Powers contact research, email writing, and reply classification. Get your key from console.anthropic.com.</p>
            <div class="oo-field">
                <label class="oo-label">API Key</label>
                <input type="password" name="claude_api_key" class="oo-input" value="<?php echo esc_attr( $settings['claude_api_key'] ?? '' ); ?>" placeholder="sk-ant-...">
                <?php if ( ! empty( $settings['claude_api_key'] ) ) : ?><span class="oo-badge oo-badge-green" style="margin-top:6px;display:inline-block">Configured</span><?php endif; ?>
            </div>
        </div>

        <div class="oo-card">
            <h2 class="oo-card-title">Hunter.io</h2>
            <p class="oo-muted" style="margin-bottom:14px">Finds and verifies contact email addresses. Get your key from hunter.io/api-keys.</p>
            <div class="oo-field">
                <label class="oo-label">API Key</label>
                <input type="password" name="hunter_api_key" class="oo-input" value="<?php echo esc_attr( $settings['hunter_api_key'] ?? '' ); ?>">
                <?php if ( ! empty( $settings['hunter_api_key'] ) ) : ?><span class="oo-badge oo-badge-green" style="margin-top:6px;display:inline-block">Configured</span><?php endif; ?>
            </div>
        </div>

        <div class="oo-card">
            <h2 class="oo-card-title">Amazon SES</h2>
            <div class="oo-field"><label class="oo-label">Access Key ID</label><input type="password" name="ses_key" class="oo-input" value="<?php echo esc_attr( $settings['ses_key'] ?? '' ); ?>"></div>
            <div class="oo-field"><label class="oo-label">Secret Access Key</label><input type="password" name="ses_secret" class="oo-input" value="<?php echo esc_attr( $settings['ses_secret'] ?? '' ); ?>"></div>
            <div class="oo-field">
                <label class="oo-label">Region</label>
                <select name="ses_region" class="oo-select">
                    <?php foreach ( array( 'eu-west-1' => 'EU (Ireland)', 'eu-west-2' => 'EU (London)', 'eu-central-1' => 'EU (Frankfurt)', 'us-east-1' => 'US East', 'us-west-2' => 'US West' ) as $val => $lbl ) : ?>
                    <option value="<?php echo esc_attr( $val ); ?>" <?php selected( $settings['ses_region'] ?? 'eu-west-1', $val ); ?>><?php echo esc_html( $lbl ); ?></option>
                    <?php endforeach; ?>
                </select>
                <?php if ( ! empty( $settings['ses_key'] ) ) : ?><span class="oo-badge oo-badge-green" style="margin-top:6px;display:inline-block">Configured</span><?php endif; ?>
            </div>
            <div class="oo-field">
                <label class="oo-label">Default Reply-To</label>
                <input type="email" name="default_reply_to" class="oo-input" value="<?php echo esc_attr( $settings['default_reply_to'] ?? '' ); ?>" placeholder="you@yourdomain.com">
                <p class="oo-hint">All outreach replies will be delivered to this address.</p>
            </div>
        </div>

        <div class="oo-card">
            <h2 class="oo-card-title">Airtable</h2>
            <p class="oo-muted" style="margin-bottom:14px">Syncs contacts so you can view and edit them outside WordPress.</p>
            <div class="oo-field"><label class="oo-label">API Key (Personal Access Token)</label><input type="password" name="airtable_api_key" class="oo-input" value="<?php echo esc_attr( $settings['airtable_api_key'] ?? '' ); ?>" placeholder="pat..."></div>
            <div class="oo-field">
                <label class="oo-label">Base ID</label>
                <input type="text" name="airtable_base_id" class="oo-input" value="<?php echo esc_attr( $settings['airtable_base_id'] ?? '' ); ?>" placeholder="app...">
                <p class="oo-hint">Found in your Airtable base URL: airtable.com/<strong>appXXXXXX</strong>/...</p>
                <?php if ( ! empty( $settings['airtable_api_key'] ) && ! empty( $settings['airtable_base_id'] ) ) : ?><span class="oo-badge oo-badge-green" style="margin-top:6px;display:inline-block">Configured</span><?php endif; ?>
            </div>
        </div>

    </div>

    <div class="oo-wizard-actions" style="padding-top:0">
        <button type="submit" class="oo-btn oo-btn-primary oo-btn-lg">Save Settings</button>
    </div>
</form>
