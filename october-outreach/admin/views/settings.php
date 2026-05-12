<?php if ( ! defined( 'ABSPATH' ) ) exit; ?>

<div class="wrap oo-wrap">
    <h1 class="oo-page-title">Settings</h1>

    <?php if ( isset( $_GET['saved'] ) ) : ?>
    <div class="notice notice-success is-dismissible"><p>Settings saved.</p></div>
    <?php endif; ?>

    <?php
    $settings = get_option( 'oo_settings', array() );
    $license = OO_License::get_status_label();
    ?>

    <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
        <?php wp_nonce_field( 'oo_save_settings' ); ?>
        <input type="hidden" name="action" value="oo_save_settings">

        <div class="oo-settings-grid">

            <div class="oo-card">
                <h2>License</h2>
                <p class="description">Your current license status: <span class="oo-badge oo-badge-<?php echo esc_attr( $license['color'] ); ?>"><?php echo esc_html( $license['label'] ); ?></span></p>
                <table class="form-table">
                    <tr>
                        <th><label for="license_key">License Key</label></th>
                        <td>
                            <input type="text" id="license_key" name="license_key" value="<?php echo esc_attr( $settings['license_key'] ?? '' ); ?>" class="regular-text" placeholder="OO-XXXX-XXXX-XXXX">
                            <p class="description">Enter your October Outreach license key.</p>
                        </td>
                    </tr>
                </table>
            </div>

            <div class="oo-card">
                <h2>Claude API</h2>
                <p class="description">Powers contact research, email writing, and reply classification. Get your key from <a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a>.</p>
                <table class="form-table">
                    <tr>
                        <th><label for="claude_api_key">API Key</label></th>
                        <td>
                            <input type="password" id="claude_api_key" name="claude_api_key" value="<?php echo esc_attr( $settings['claude_api_key'] ?? '' ); ?>" class="regular-text" placeholder="sk-ant-...">
                            <?php if ( ! empty( $settings['claude_api_key'] ) ) : ?>
                            <span class="oo-badge oo-badge-green">Configured</span>
                            <?php endif; ?>
                        </td>
                    </tr>
                </table>
            </div>

            <div class="oo-card">
                <h2>Hunter.io</h2>
                <p class="description">Finds and verifies contact email addresses. Get your key from <a href="https://hunter.io/api-keys" target="_blank">hunter.io</a>.</p>
                <table class="form-table">
                    <tr>
                        <th><label for="hunter_api_key">API Key</label></th>
                        <td>
                            <input type="password" id="hunter_api_key" name="hunter_api_key" value="<?php echo esc_attr( $settings['hunter_api_key'] ?? '' ); ?>" class="regular-text">
                            <?php if ( ! empty( $settings['hunter_api_key'] ) ) : ?>
                            <span class="oo-badge oo-badge-green">Configured</span>
                            <?php endif; ?>
                        </td>
                    </tr>
                </table>
            </div>

            <div class="oo-card">
                <h2>Amazon SES</h2>
                <p class="description">Sends your emails. Uses your existing SES setup.</p>
                <table class="form-table">
                    <tr>
                        <th><label for="ses_key">Access Key ID</label></th>
                        <td><input type="password" id="ses_key" name="ses_key" value="<?php echo esc_attr( $settings['ses_key'] ?? '' ); ?>" class="regular-text"></td>
                    </tr>
                    <tr>
                        <th><label for="ses_secret">Secret Access Key</label></th>
                        <td><input type="password" id="ses_secret" name="ses_secret" value="<?php echo esc_attr( $settings['ses_secret'] ?? '' ); ?>" class="regular-text"></td>
                    </tr>
                    <tr>
                        <th><label for="ses_region">Region</label></th>
                        <td>
                            <select id="ses_region" name="ses_region">
                                <?php
                                $regions = array(
                                    'eu-west-1'      => 'EU (Ireland)',
                                    'eu-west-2'      => 'EU (London)',
                                    'eu-central-1'   => 'EU (Frankfurt)',
                                    'us-east-1'      => 'US East (N. Virginia)',
                                    'us-west-2'      => 'US West (Oregon)',
                                    'ap-southeast-1' => 'Asia Pacific (Singapore)',
                                );
                                foreach ( $regions as $val => $label ) : ?>
                                <option value="<?php echo esc_attr( $val ); ?>" <?php selected( $settings['ses_region'] ?? 'eu-west-1', $val ); ?>><?php echo esc_html( $label ); ?></option>
                                <?php endforeach; ?>
                            </select>
                            <?php if ( ! empty( $settings['ses_key'] ) && ! empty( $settings['ses_secret'] ) ) : ?>
                            <span class="oo-badge oo-badge-green">Configured</span>
                            <?php endif; ?>
                        </td>
                    </tr>
                    <tr>
                        <th><label for="default_reply_to">Default Reply-To</label></th>
                        <td>
                            <input type="email" id="default_reply_to" name="default_reply_to" value="<?php echo esc_attr( $settings['default_reply_to'] ?? '' ); ?>" class="regular-text" placeholder="you@octobercomms.com">
                            <p class="description">Replies to all outreach emails will go to this address.</p>
                        </td>
                    </tr>
                </table>
            </div>

            <div class="oo-card">
                <h2>Airtable</h2>
                <p class="description">Syncs your contacts to an Airtable base so you can view and edit them outside WordPress. Get your key from <a href="https://airtable.com/account" target="_blank">airtable.com</a>.</p>
                <table class="form-table">
                    <tr>
                        <th><label for="airtable_api_key">API Key</label></th>
                        <td><input type="password" id="airtable_api_key" name="airtable_api_key" value="<?php echo esc_attr( $settings['airtable_api_key'] ?? '' ); ?>" class="regular-text" placeholder="pat..."></td>
                    </tr>
                    <tr>
                        <th><label for="airtable_base_id">Base ID</label></th>
                        <td>
                            <input type="text" id="airtable_base_id" name="airtable_base_id" value="<?php echo esc_attr( $settings['airtable_base_id'] ?? '' ); ?>" class="regular-text" placeholder="app...">
                            <p class="description">Found in your Airtable base URL: airtable.com/<strong>appXXXXXXXX</strong>/...</p>
                            <?php if ( ! empty( $settings['airtable_api_key'] ) && ! empty( $settings['airtable_base_id'] ) ) : ?>
                            <span class="oo-badge oo-badge-green">Configured</span>
                            <?php endif; ?>
                        </td>
                    </tr>
                </table>
            </div>

        </div>

        <p class="submit">
            <button type="submit" class="button button-primary button-large">Save Settings</button>
        </p>

    </form>
</div>
