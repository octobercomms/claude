<?php if ( ! defined( 'ABSPATH' ) ) exit; ?>

<div class="wrap oo-wrap">
    <h1 class="oo-page-title">October Outreach</h1>

    <?php
    global $wpdb;
    $total_contacts = $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->prefix}oo_contacts WHERE status = 'active'" );
    $total_campaigns = $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->prefix}oo_campaigns" );
    $active_campaigns = $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->prefix}oo_campaigns WHERE status = 'active'" );
    $total_sent = $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->prefix}oo_sends WHERE status = 'sent'" );
    $total_replied = $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->prefix}oo_sends WHERE status = 'replied'" );
    $license = OO_License::get_status_label();
    ?>

    <div class="oo-stats-grid">
        <div class="oo-stat-card">
            <span class="oo-stat-number"><?php echo intval( $total_contacts ); ?></span>
            <span class="oo-stat-label">Active Contacts</span>
        </div>
        <div class="oo-stat-card">
            <span class="oo-stat-number"><?php echo intval( $active_campaigns ); ?></span>
            <span class="oo-stat-label">Active Campaigns</span>
        </div>
        <div class="oo-stat-card">
            <span class="oo-stat-number"><?php echo intval( $total_sent ); ?></span>
            <span class="oo-stat-label">Emails Sent</span>
        </div>
        <div class="oo-stat-card">
            <span class="oo-stat-number"><?php echo intval( $total_replied ); ?></span>
            <span class="oo-stat-label">Replies</span>
        </div>
    </div>

    <div class="oo-dashboard-grid">

        <div class="oo-card">
            <h2>Quick Actions</h2>
            <div class="oo-quick-actions">
                <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-contacts&action=new' ) ); ?>" class="button button-primary">+ Add Contact</a>
                <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-campaigns&action=new' ) ); ?>" class="button button-primary">+ New Campaign</a>
                <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-press&action=new' ) ); ?>" class="button">+ Press Release</a>
                <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-settings' ) ); ?>" class="button">Settings</a>
            </div>
        </div>

        <div class="oo-card">
            <h2>System Status</h2>
            <table class="oo-status-table">
                <tr>
                    <td>License</td>
                    <td><span class="oo-badge oo-badge-<?php echo esc_attr( $license['color'] ); ?>"><?php echo esc_html( $license['label'] ); ?></span></td>
                </tr>
                <?php
                $settings = get_option( 'oo_settings', array() );
                $checks = array(
                    'Claude API'    => ! empty( $settings['claude_api_key'] ),
                    'Hunter.io'     => ! empty( $settings['hunter_api_key'] ),
                    'Amazon SES'    => ! empty( $settings['ses_key'] ) && ! empty( $settings['ses_secret'] ),
                    'Airtable'      => ! empty( $settings['airtable_api_key'] ),
                );
                foreach ( $checks as $label => $connected ) : ?>
                <tr>
                    <td><?php echo esc_html( $label ); ?></td>
                    <td>
                        <?php if ( $connected ) : ?>
                            <span class="oo-badge oo-badge-green">Connected</span>
                        <?php else : ?>
                            <span class="oo-badge oo-badge-grey">Not configured</span>
                        <?php endif; ?>
                    </td>
                </tr>
                <?php endforeach; ?>
            </table>
        </div>

        <div class="oo-card oo-card-full">
            <h2>Recent Campaigns</h2>
            <?php
            $campaigns = $wpdb->get_results( "SELECT * FROM {$wpdb->prefix}oo_campaigns ORDER BY created_at DESC LIMIT 5" );
            $brands = OO_Database::get_brands();
            $types = OO_Database::get_campaign_types();
            if ( $campaigns ) : ?>
            <table class="wp-list-table widefat fixed striped">
                <thead>
                    <tr>
                        <th>Campaign</th>
                        <th>Brand</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Created</th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ( $campaigns as $campaign ) : ?>
                    <tr>
                        <td><a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-campaigns&action=edit&id=' . $campaign->id ) ); ?>"><?php echo esc_html( $campaign->name ); ?></a></td>
                        <td><?php echo esc_html( $brands[ $campaign->brand ] ?? $campaign->brand ); ?></td>
                        <td><?php echo esc_html( $types[ $campaign->type ] ?? $campaign->type ); ?></td>
                        <td><span class="oo-badge oo-badge-<?php echo $campaign->status === 'active' ? 'green' : 'grey'; ?>"><?php echo esc_html( ucfirst( $campaign->status ) ); ?></span></td>
                        <td><?php echo esc_html( date( 'd M Y', strtotime( $campaign->created_at ) ) ); ?></td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
            <?php else : ?>
            <p class="oo-empty">No campaigns yet. <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-campaigns&action=new' ) ); ?>">Create your first campaign</a>.</p>
            <?php endif; ?>
        </div>

    </div>
</div>
