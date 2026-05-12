<?php if ( ! defined( 'ABSPATH' ) ) exit; ?>

<?php
global $wpdb;
$action = $_GET['action'] ?? 'list';
$campaign_id = intval( $_GET['id'] ?? 0 );
$campaign = null;

if ( in_array( $action, array( 'edit' ) ) && $campaign_id ) {
    $campaign = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}oo_campaigns WHERE id = %d", $campaign_id ) );
    if ( ! $campaign ) {
        $action = 'list';
    }
}

$brands = OO_Database::get_brands();
$types  = OO_Database::get_campaign_types();
?>

<div class="wrap oo-wrap">

<?php if ( $action === 'new' || $action === 'edit' ) : ?>

    <h1 class="oo-page-title"><?php echo $action === 'new' ? 'New Campaign' : 'Edit Campaign'; ?></h1>
    <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-campaigns' ) ); ?>" class="page-title-action">Back to Campaigns</a>

    <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="oo-form">
        <?php wp_nonce_field( 'oo_save_campaign' ); ?>
        <input type="hidden" name="action" value="oo_save_campaign">
        <input type="hidden" name="campaign_id" value="<?php echo esc_attr( $campaign_id ); ?>">

        <div class="oo-form-grid">

            <div class="oo-card">
                <h2>Campaign Details</h2>
                <table class="form-table">
                    <tr>
                        <th><label for="name">Campaign Name</label></th>
                        <td><input type="text" id="name" name="name" value="<?php echo esc_attr( $campaign->name ?? '' ); ?>" class="regular-text" required placeholder="e.g. ADF 2025 — Project Submissions"></td>
                    </tr>
                    <tr>
                        <th><label for="brand">Brand</label></th>
                        <td>
                            <select id="brand" name="brand" required>
                                <option value="">— Select brand —</option>
                                <?php foreach ( $brands as $val => $label ) : ?>
                                <option value="<?php echo esc_attr( $val ); ?>" <?php selected( $campaign->brand ?? '', $val ); ?>><?php echo esc_html( $label ); ?></option>
                                <?php endforeach; ?>
                            </select>
                        </td>
                    </tr>
                    <tr>
                        <th><label for="type">Campaign Type</label></th>
                        <td>
                            <select id="type" name="type">
                                <?php foreach ( $types as $val => $label ) : ?>
                                <option value="<?php echo esc_attr( $val ); ?>" <?php selected( $campaign->type ?? 'outreach', $val ); ?>><?php echo esc_html( $label ); ?></option>
                                <?php endforeach; ?>
                            </select>
                        </td>
                    </tr>
                    <tr>
                        <th><label for="status">Status</label></th>
                        <td>
                            <select id="status" name="status">
                                <option value="draft" <?php selected( $campaign->status ?? 'draft', 'draft' ); ?>>Draft</option>
                                <option value="active" <?php selected( $campaign->status ?? '', 'active' ); ?>>Active</option>
                                <option value="paused" <?php selected( $campaign->status ?? '', 'paused' ); ?>>Paused</option>
                                <option value="complete" <?php selected( $campaign->status ?? '', 'complete' ); ?>>Complete</option>
                            </select>
                        </td>
                    </tr>
                </table>
            </div>

            <div class="oo-card">
                <h2>Sending Identity</h2>
                <p class="description">Emails will appear to come from this name and address. Replies go to your reply-to address.</p>
                <table class="form-table">
                    <tr>
                        <th><label for="from_name">From Name</label></th>
                        <td><input type="text" id="from_name" name="from_name" value="<?php echo esc_attr( $campaign->from_name ?? '' ); ?>" class="regular-text" placeholder="e.g. James at October Comms"></td>
                    </tr>
                    <tr>
                        <th><label for="from_email">From Email</label></th>
                        <td>
                            <input type="email" id="from_email" name="from_email" value="<?php echo esc_attr( $campaign->from_email ?? '' ); ?>" class="regular-text" placeholder="outreach@your-sister-domain.com">
                            <p class="description">Use a sister domain address — not your main domain.</p>
                        </td>
                    </tr>
                    <tr>
                        <th><label for="reply_to">Reply-To Email</label></th>
                        <td>
                            <input type="email" id="reply_to" name="reply_to" value="<?php echo esc_attr( $campaign->reply_to ?? '' ); ?>" class="regular-text" placeholder="you@octobercomms.com">
                            <p class="description">Where replies will be delivered to you.</p>
                        </td>
                    </tr>
                    <tr>
                        <th><label for="sending_domain">Sending Domain</label></th>
                        <td>
                            <input type="text" id="sending_domain" name="sending_domain" value="<?php echo esc_attr( $campaign->sending_domain ?? '' ); ?>" class="regular-text" placeholder="e.g. octobercomms-mail.com">
                            <p class="description">The domain used for this campaign. Must be verified in Amazon SES.</p>
                        </td>
                    </tr>
                </table>
            </div>

            <div class="oo-card oo-card-full">
                <h2>Audience</h2>
                <p class="description">Describe your target audience in plain English. Claude will use this to find contacts and write personalised emails in Stage 2.</p>
                <table class="form-table">
                    <tr>
                        <th><label for="audience_description">Audience Description</label></th>
                        <td>
                            <textarea id="audience_description" name="audience_description" rows="5" class="large-text" placeholder="e.g. Architects and interior designers based in Atlanta, Georgia and surrounding states. Principals or directors at firms with 5-50 staff. Interested in design competitions and industry events."><?php echo esc_textarea( $campaign->audience_description ?? '' ); ?></textarea>
                        </td>
                    </tr>
                    <tr>
                        <th><label for="claude_prompt">Additional Instructions for Claude</label></th>
                        <td>
                            <textarea id="claude_prompt" name="claude_prompt" rows="5" class="large-text" placeholder="e.g. Tone should be warm and collegial, not salesy. Mention the Atlanta Design Festival's reputation. Ask them to submit a project they're proud of. Keep emails under 150 words."><?php echo esc_textarea( $campaign->claude_prompt ?? '' ); ?></textarea>
                            <p class="description">Optional extra guidance for how Claude should write emails for this campaign.</p>
                        </td>
                    </tr>
                </table>
            </div>

        </div>

        <p class="submit">
            <button type="submit" class="button button-primary button-large">Save Campaign</button>
            <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-campaigns' ) ); ?>" class="button button-large">Cancel</a>
        </p>
    </form>

<?php else : ?>

    <h1 class="oo-page-title">Campaigns
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-campaigns&action=new' ) ); ?>" class="page-title-action">New Campaign</a>
    </h1>

    <?php if ( isset( $_GET['saved'] ) ) : ?>
    <div class="notice notice-success is-dismissible"><p>Campaign saved.</p></div>
    <?php endif; ?>
    <?php if ( isset( $_GET['deleted'] ) ) : ?>
    <div class="notice notice-success is-dismissible"><p>Campaign deleted.</p></div>
    <?php endif; ?>

    <?php $campaigns = $wpdb->get_results( "SELECT * FROM {$wpdb->prefix}oo_campaigns ORDER BY created_at DESC" ); ?>

    <?php if ( $campaigns ) : ?>
    <table class="wp-list-table widefat fixed striped oo-table">
        <thead>
            <tr>
                <th>Campaign</th>
                <th>Brand</th>
                <th>Type</th>
                <th>From</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody>
            <?php foreach ( $campaigns as $c ) : ?>
            <tr>
                <td><strong><?php echo esc_html( $c->name ); ?></strong>
                    <?php if ( $c->audience_description ) : ?>
                    <br><small class="oo-muted"><?php echo esc_html( wp_trim_words( $c->audience_description, 12 ) ); ?></small>
                    <?php endif; ?>
                </td>
                <td><?php echo esc_html( $brands[ $c->brand ] ?? $c->brand ); ?></td>
                <td><?php echo esc_html( $types[ $c->type ] ?? $c->type ); ?></td>
                <td><?php echo esc_html( $c->from_email ?: '—' ); ?></td>
                <td>
                    <?php
                    $colours = array( 'draft' => 'grey', 'active' => 'green', 'paused' => 'orange', 'complete' => 'blue' );
                    $colour = $colours[ $c->status ] ?? 'grey';
                    ?>
                    <span class="oo-badge oo-badge-<?php echo esc_attr( $colour ); ?>"><?php echo esc_html( ucfirst( $c->status ) ); ?></span>
                </td>
                <td><?php echo esc_html( date( 'd M Y', strtotime( $c->created_at ) ) ); ?></td>
                <td class="oo-actions">
                    <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-campaigns&action=edit&id=' . $c->id ) ); ?>">Edit</a>
                    <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline" onsubmit="return confirm('Delete this campaign?')">
                        <?php wp_nonce_field( 'oo_delete_campaign' ); ?>
                        <input type="hidden" name="action" value="oo_delete_campaign">
                        <input type="hidden" name="campaign_id" value="<?php echo esc_attr( $c->id ); ?>">
                        <button type="submit" class="button-link-delete">Delete</button>
                    </form>
                </td>
            </tr>
            <?php endforeach; ?>
        </tbody>
    </table>
    <?php else : ?>
    <div class="oo-card">
        <p class="oo-empty">No campaigns yet. <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-campaigns&action=new' ) ); ?>">Create your first campaign</a>.</p>
        <p class="oo-muted">Campaigns map to your use cases — ADF project submissions, October Comms outreach, Cubisly course signups, etc.</p>
    </div>
    <?php endif; ?>

<?php endif; ?>
</div>
