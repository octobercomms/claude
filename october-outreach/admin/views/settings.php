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

<style>
.oo-secret-wrap { position:relative; display:flex; align-items:center; }
.oo-secret-wrap .oo-input { padding-right:40px; flex:1; }
.oo-eye-btn { position:absolute; right:10px; background:none; border:none; cursor:pointer; color:var(--oo-muted); padding:0; line-height:1; }
.oo-eye-btn:hover { color:var(--oo-text); }
.oo-eye-btn svg { display:block; width:18px; height:18px; }
</style>

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
                <div class="oo-secret-wrap">
                    <input type="password" name="claude_api_key" class="oo-input" value="<?php echo esc_attr( $settings['claude_api_key'] ?? '' ); ?>" placeholder="sk-ant-...">
                    <?php if ( ! empty( $settings['claude_api_key'] ) ) : ?><button type="button" class="oo-eye-btn" aria-label="Show/hide"><?php echo oo_eye_icon(); ?></button><?php endif; ?>
                </div>
                <?php if ( ! empty( $settings['claude_api_key'] ) ) : ?><span class="oo-badge oo-badge-green" style="margin-top:6px;display:inline-block">Configured</span><?php endif; ?>
            </div>
        </div>

        <div class="oo-card">
            <h2 class="oo-card-title">Hunter.io</h2>
            <p class="oo-muted" style="margin-bottom:14px">Finds and verifies contact email addresses. Get your key from hunter.io/api-keys.</p>
            <div class="oo-field">
                <label class="oo-label">API Key</label>
                <div class="oo-secret-wrap">
                    <input type="password" name="hunter_api_key" class="oo-input" value="<?php echo esc_attr( $settings['hunter_api_key'] ?? '' ); ?>">
                    <?php if ( ! empty( $settings['hunter_api_key'] ) ) : ?><button type="button" class="oo-eye-btn" aria-label="Show/hide"><?php echo oo_eye_icon(); ?></button><?php endif; ?>
                </div>
                <?php if ( ! empty( $settings['hunter_api_key'] ) ) : ?><span class="oo-badge oo-badge-green" style="margin-top:6px;display:inline-block">Configured</span><?php endif; ?>
            </div>
        </div>

        <div class="oo-card">
            <h2 class="oo-card-title">Amazon SES</h2>
            <div class="oo-field">
                <label class="oo-label">Access Key ID</label>
                <div class="oo-secret-wrap">
                    <input type="password" name="ses_key" class="oo-input" value="<?php echo esc_attr( $settings['ses_key'] ?? '' ); ?>">
                    <?php if ( ! empty( $settings['ses_key'] ) ) : ?><button type="button" class="oo-eye-btn" aria-label="Show/hide"><?php echo oo_eye_icon(); ?></button><?php endif; ?>
                </div>
            </div>
            <div class="oo-field">
                <label class="oo-label">Secret Access Key</label>
                <div class="oo-secret-wrap">
                    <input type="password" name="ses_secret" class="oo-input" value="<?php echo esc_attr( $settings['ses_secret'] ?? '' ); ?>">
                    <?php if ( ! empty( $settings['ses_secret'] ) ) : ?><button type="button" class="oo-eye-btn" aria-label="Show/hide"><?php echo oo_eye_icon(); ?></button><?php endif; ?>
                </div>
            </div>
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
            <div class="oo-field">
                <label class="oo-label">API Key (Personal Access Token)</label>
                <div class="oo-secret-wrap">
                    <input type="password" name="airtable_api_key" class="oo-input" value="<?php echo esc_attr( $settings['airtable_api_key'] ?? '' ); ?>" placeholder="pat...">
                    <?php if ( ! empty( $settings['airtable_api_key'] ) ) : ?><button type="button" class="oo-eye-btn" aria-label="Show/hide"><?php echo oo_eye_icon(); ?></button><?php endif; ?>
                </div>
            </div>
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

<script>
document.querySelectorAll('.oo-eye-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
        var input = this.previousElementSibling;
        input.type = input.type === 'password' ? 'text' : 'password';
    });
});
</script>

<?php
function oo_eye_icon() {
    return '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.641 0-8.573-3.007-9.964-7.178Z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>';
}
?>
