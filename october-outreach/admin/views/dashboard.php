<?php if ( ! defined( 'ABSPATH' ) ) exit;
global $wpdb;
$total_contacts  = $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->prefix}oo_contacts WHERE status = 'active'" );
$active_campaigns = $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->prefix}oo_campaigns WHERE status = 'active'" );
$total_sent      = $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->prefix}oo_sends WHERE status = 'sent'" );
$total_replied   = $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->prefix}oo_sends WHERE status = 'replied'" );
$settings        = get_option( 'oo_settings', array() );
?>

<?php if ( isset( $_GET['deleted'] ) ) : ?><div class="oo-notice oo-notice-success">Campaign deleted.</div><?php endif; ?>

<div class="oo-page-header">
    <h1 class="oo-page-title">Dashboard</h1>
    <div class="oo-page-actions">
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-campaigns&action=wizard' ) ); ?>" class="oo-btn oo-btn-primary">+ New Campaign</a>
    </div>
</div>

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

<div class="oo-grid-2">

    <div class="oo-card">
        <h2 class="oo-card-title">Quick Actions</h2>
        <div class="oo-quick-actions">
            <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-campaigns&action=wizard' ) ); ?>" class="oo-btn oo-btn-primary">+ New Campaign</a>
            <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-contacts&action=new' ) ); ?>" class="oo-btn oo-btn-secondary">+ Add Contact</a>
        </div>
    </div>

    <div class="oo-card">
        <h2 class="oo-card-title">System Status</h2>
        <table class="oo-status-table">
            <?php
            $checks = array(
                'Claude API'      => ! empty( $settings['claude_api_key'] ),
                'Hunter.io'       => ! empty( $settings['hunter_api_key'] ),
                'Icypeas'         => ! empty( $settings['icypeas_api_key'] ),
                'Email Sending'   => ! empty( $settings['ses_key'] ) || ! empty( $settings['sendgrid_api_key'] ) || ! empty( $settings['mailgun_api_key'] ) || ! empty( $settings['smtp_host'] ),
                'Airtable'        => ! empty( $settings['airtable_api_key'] ),
                'Email Scheduler' => OO_HAS_ACTION_SCHEDULER,
            );
            foreach ( $checks as $label => $ok ) : ?>
            <tr>
                <td><?php echo esc_html( $label ); ?></td>
                <td>
                    <?php if ( $ok ) : ?>
                    <span class="oo-badge oo-badge-green"><?php echo $label === 'Email Scheduler' ? 'Action Scheduler' : 'Connected'; ?></span>
                    <?php elseif ( $label === 'Email Scheduler' ) : ?>
                    <span class="oo-badge oo-badge-orange">WP Cron fallback</span>
                    <?php else : ?>
                    <span class="oo-badge oo-badge-grey">Not configured</span>
                    <?php endif; ?>
                </td>
            </tr>
            <?php endforeach; ?>

            <?php
            $sending_domain = trim( $settings['sending_domain'] ?? '' );
            if ( $sending_domain ) :
                // SPF: TXT record on the domain containing "v=spf1"
                $spf   = false;
                $txts  = @dns_get_record( $sending_domain, DNS_TXT );
                if ( is_array( $txts ) ) {
                    foreach ( $txts as $r ) {
                        if ( isset( $r['txt'] ) && strpos( $r['txt'], 'v=spf1' ) !== false ) { $spf = true; break; }
                    }
                }
                // DMARC: TXT record at _dmarc.domain
                $dmarc     = false;
                $dmarc_rec = @dns_get_record( '_dmarc.' . $sending_domain, DNS_TXT );
                if ( is_array( $dmarc_rec ) ) {
                    foreach ( $dmarc_rec as $r ) {
                        if ( isset( $r['txt'] ) && strpos( $r['txt'], 'v=DMARC1' ) !== false ) { $dmarc = true; break; }
                    }
                }
                $help_url = esc_url( admin_url( 'admin.php?page=oo-help#email-auth' ) );
            ?>
            <tr>
                <td>SPF Record <span class="oo-muted" style="font-size:11px">(<?php echo esc_html( $sending_domain ); ?>)</span></td>
                <td>
                    <?php if ( $spf ) : ?>
                    <span class="oo-badge oo-badge-green">Found</span>
                    <?php else : ?>
                    <span class="oo-badge oo-badge-orange">Missing</span> <a href="<?php echo $help_url; ?>" style="font-size:12px;margin-left:4px">Fix this →</a>
                    <?php endif; ?>
                </td>
            </tr>
            <tr>
                <td>DMARC Record <span class="oo-muted" style="font-size:11px">(_dmarc.<?php echo esc_html( $sending_domain ); ?>)</span></td>
                <td>
                    <?php if ( $dmarc ) : ?>
                    <span class="oo-badge oo-badge-green">Found</span>
                    <?php else : ?>
                    <span class="oo-badge oo-badge-orange">Missing</span> <a href="<?php echo $help_url; ?>" style="font-size:12px;margin-left:4px">Fix this →</a>
                    <?php endif; ?>
                </td>
            </tr>
            <?php else : ?>
            <tr>
                <td>SPF / DMARC</td>
                <td><span class="oo-badge oo-badge-grey">Set domain in Settings</span></td>
            </tr>
            <?php endif; ?>
        </table>
    </div>

    <div class="oo-card oo-grid-full">
        <h2 class="oo-card-title">Recent Campaigns</h2>
        <?php
        $campaigns = $wpdb->get_results( "SELECT * FROM {$wpdb->prefix}oo_campaigns ORDER BY created_at DESC LIMIT 6" );
        $brands    = OO_Database::get_brands();
        $types     = OO_Database::get_campaign_types();
        ?>
        <?php if ( $campaigns ) : ?>
        <div class="oo-table-wrap">
            <table class="oo-table">
                <thead><tr>
                    <th>Campaign</th><th>Brand</th><th>Type</th><th>Status</th><th>Created</th><th></th>
                </tr></thead>
                <tbody>
                <?php foreach ( $campaigns as $c ) :
                    $colours = array( 'draft' => 'grey', 'active' => 'green', 'paused' => 'orange', 'complete' => 'blue' );
                ?>
                <tr>
                    <td><strong><?php echo esc_html( $c->name ); ?></strong></td>
                    <td><?php echo esc_html( $brands[ $c->brand ] ?? $c->brand ); ?></td>
                    <td><?php echo esc_html( $types[ $c->type ] ?? $c->type ); ?></td>
                    <td><span class="oo-badge oo-badge-<?php echo esc_attr( $colours[ $c->status ] ?? 'grey' ); ?>"><?php echo esc_html( ucfirst( $c->status ) ); ?></span></td>
                    <td class="oo-muted"><?php echo esc_html( date( 'd M Y', strtotime( $c->created_at ) ) ); ?></td>
                    <td>
                        <div class="oo-row-actions">
                            <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-campaigns&action=wizard&id=' . $c->id ) ); ?>" class="oo-btn oo-btn-sm oo-btn-secondary">Open</a>
                            <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" onsubmit="return confirm('Delete this campaign and all its sequences?')">
                                <?php wp_nonce_field( 'oo_delete_campaign' ); ?>
                                <input type="hidden" name="action" value="oo_delete_campaign">
                                <input type="hidden" name="campaign_id" value="<?php echo esc_attr( $c->id ); ?>">
                                <input type="hidden" name="redirect_to" value="dashboard">
                                <button type="submit" class="oo-delete-btn">Delete</button>
                            </form>
                        </div>
                    </td>
                </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        </div>
        <?php else : ?>
        <div class="oo-empty-state">
            <h3>No campaigns yet</h3>
            <p>Use the wizard to create your first campaign — Claude will find contacts and write the emails.</p>
            <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-campaigns&action=wizard' ) ); ?>" class="oo-btn oo-btn-primary">Start First Campaign</a>
        </div>
        <?php endif; ?>
    </div>

</div>
