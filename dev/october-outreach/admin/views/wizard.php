<?php if ( ! defined( 'ABSPATH' ) ) exit;

OO_License::require_license();

if ( isset( $_GET['duplicated'] ) ) {
    echo '<div class="oo-notice oo-notice-success">Campaign duplicated — update the details below and save.</div>';
}

global $wpdb;
$campaign_id = intval( $_GET['id'] ?? 0 );
$campaign    = null;

if ( $campaign_id ) {
    $campaign = $wpdb->get_row( $wpdb->prepare(
        "SELECT * FROM {$wpdb->prefix}oo_campaigns WHERE id = %d", $campaign_id
    ) );
}

$brands   = OO_Database::get_brands();
$types    = OO_Database::get_email_campaign_types(); // press releases are created from the PR module, not here
$settings = get_option( 'oo_settings', array() );

// Load existing sequences and contact count so JS can pre-populate step 3
$existing_sequences = array();
$contact_count      = 0;
if ( $campaign_id ) {
    $seq_rows = $wpdb->get_results( $wpdb->prepare(
        "SELECT step_number, subject, body, delay_days FROM {$wpdb->prefix}oo_sequences
         WHERE campaign_id = %d AND status = 'active' ORDER BY step_number ASC",
        $campaign_id
    ) );
    foreach ( $seq_rows as $row ) {
        $existing_sequences[] = array(
            'step'       => intval( $row->step_number ),
            'subject'    => $row->subject,
            'body'       => $row->body,
            'delay_days' => intval( $row->delay_days ),
        );
    }
    $contact_count = (int) $wpdb->get_var( $wpdb->prepare(
        "SELECT COUNT(*) FROM {$wpdb->prefix}oo_campaign_contacts WHERE campaign_id = %d",
        $campaign_id
    ) );
}

// Module visibility
$enable_outreach       = ( $settings['enable_outreach']       ?? '1' ) === '1';
$enable_press          = ( $settings['enable_press_releases'] ?? '1' ) === '1';
$single_module         = $enable_outreach xor $enable_press;
$forced_type           = $enable_outreach ? 'outreach' : 'press_release';
// A press-release pitch campaign (created from the PR module) keeps its type on
// edit even though Email no longer offers it in the dropdown.
$is_press_campaign     = ( $campaign->type ?? '' ) === 'press_release';
$hidden_type           = $single_module ? $forced_type : ( $is_press_campaign ? 'press_release' : '' );
$show_press_card_init  = ( $hidden_type === 'press_release' ) || ( ! $single_module && $is_press_campaign );
?>

<div class="oo-page-header">
    <h1 class="oo-page-title">
        <?php echo $campaign ? esc_html( $campaign->name ) : 'New Campaign'; ?>
    </h1>
    <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-campaigns' ) ); ?>" class="oo-btn oo-btn-secondary">← Campaigns</a>
</div>

<!-- Wizard Steps Nav -->
<div class="oo-wizard-nav">
    <div class="oo-wizard-step active" data-step="1">
        <span class="oo-step-num">1</span>
        <span class="oo-step-label">Campaign</span>
    </div>
    <div class="oo-wizard-divider"></div>
    <div class="oo-wizard-step" data-step="2">
        <span class="oo-step-num">2</span>
        <span class="oo-step-label">Contacts</span>
    </div>
    <div class="oo-wizard-divider"></div>
    <div class="oo-wizard-step" data-step="3">
        <span class="oo-step-num">3</span>
        <span class="oo-step-label">Emails</span>
    </div>
    <div class="oo-wizard-divider"></div>
    <div class="oo-wizard-step" data-step="4">
        <span class="oo-step-num">4</span>
        <span class="oo-step-label">Launch</span>
    </div>
</div>

<div id="oo-wizard" data-campaign-id="<?php echo esc_attr( $campaign_id ); ?>">

    <!-- Step 1: Campaign Setup -->
    <div class="oo-wizard-panel active" id="oo-step-1">
        <div class="oo-form-grid">

            <div class="oo-card">
                <h2 class="oo-card-title">Campaign Details</h2>
                <div class="oo-field">
                    <label class="oo-label">Campaign Name</label>
                    <input type="text" id="w_name" class="oo-input" value="<?php echo esc_attr( $campaign->name ?? '' ); ?>" placeholder="e.g. ADF 2025 — Project Submissions" required>
                </div>
                <div class="oo-field">
                    <label class="oo-label">Brand</label>
                    <input type="text" id="w_brand" class="oo-input" list="oo-brands-list" value="<?php echo esc_attr( $campaign->brand ?? '' ); ?>" placeholder="e.g. October Comms">
                    <datalist id="oo-brands-list">
                        <?php foreach ( $brands as $val => $label ) : ?>
                        <option value="<?php echo esc_attr( $label ); ?>">
                        <?php endforeach; ?>
                    </datalist>
                    <p class="oo-hint">Type freely or pick from your existing brands.</p>
                </div>
                <?php if ( $hidden_type ) : ?>
                <input type="hidden" id="w_type" value="<?php echo esc_attr( $hidden_type ); ?>">
                <?php else : ?>
                <div class="oo-field">
                    <label class="oo-label">Campaign Type</label>
                    <select id="w_type" class="oo-select">
                        <?php foreach ( $types as $val => $label ) : ?>
                        <option value="<?php echo esc_attr( $val ); ?>" <?php selected( $campaign->type ?? 'outreach', $val ); ?>><?php echo esc_html( $label ); ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <?php endif; ?>
                <div class="oo-field">
                    <label class="oo-label">Audience description <span class="oo-muted" style="font-weight:400">(optional — helps Claude write better emails)</span></label>
                    <textarea id="w_audience" class="oo-textarea" rows="2" placeholder="e.g. Independent architecture practices in Melbourne — principals who value award recognition."><?php echo esc_textarea( $campaign->audience_description ?? '' ); ?></textarea>
                </div>
                <div class="oo-field">
                    <label class="oo-label">Extra instructions for Claude</label>
                    <textarea id="w_claude_prompt" class="oo-textarea" rows="2" placeholder="e.g. Warm, collegial tone. Mention ADF's reputation. Keep emails under 120 words."><?php echo esc_textarea( $campaign->claude_prompt ?? '' ); ?></textarea>
                </div>
            </div>

            <div class="oo-card">
                <h2 class="oo-card-title">Sending Identity</h2>
                <p class="oo-muted" style="margin-bottom:14px">Use a sister domain address for From — not your main domain. Replies come to you via Reply-To.</p>
                <div class="oo-field">
                    <label class="oo-label">From Name</label>
                    <input type="text" id="w_from_name" class="oo-input" value="<?php echo esc_attr( $campaign->from_name ?? '' ); ?>" placeholder="e.g. James at October Comms">
                </div>
                <div class="oo-field">
                    <label class="oo-label">From Email</label>
                    <input type="email" id="w_from_email" class="oo-input" value="<?php echo esc_attr( $campaign->from_email ?? '' ); ?>" placeholder="outreach@sister-domain.com">
                </div>
                <div class="oo-field">
                    <label class="oo-label">Reply-To</label>
                    <input type="email" id="w_reply_to" class="oo-input" value="<?php echo esc_attr( $campaign->reply_to ?? $settings['default_reply_to'] ?? '' ); ?>">
                </div>
            </div>

            <div class="oo-card" id="oo-press-card" style="display:<?php echo $show_press_card_init ? 'block' : 'none'; ?>">
                <h2 class="oo-card-title">Press Release</h2>
                <div class="oo-field">
                    <label class="oo-label">Press Release URL</label>
                    <input type="url" id="w_press_release_url" class="oo-input" value="<?php echo esc_attr( $campaign->press_release_url ?? '' ); ?>" placeholder="https://yourdomain.com/press/your-announcement">
                </div>
            </div>

            <div class="oo-card" id="oo-coupon-card" style="display:none">
                <h2 class="oo-card-title">Coupon / Offer Integration</h2>
                <div class="oo-field">
                    <label class="oo-label">Coupon Source URL</label>
                    <input type="url" id="w_coupon_url" class="oo-input" value="<?php echo esc_attr( $campaign->coupon_url ?? '' ); ?>" placeholder="https://yourdomain.com/wp-json/your-plugin/v1/coupons">
                </div>
                <div class="oo-field">
                    <label class="oo-label">Coupon Code Field</label>
                    <input type="text" id="w_coupon_field" class="oo-input" value="<?php echo esc_attr( $campaign->coupon_field ?? '' ); ?>" placeholder="e.g. code">
                </div>
            </div>

        </div>
        <div class="oo-wizard-actions">
            <button class="oo-btn oo-btn-primary oo-btn-lg" id="oo-step1-next">Next: Select Contacts →</button>
        </div>
    </div>

    <!-- Step 2: Contacts -->
    <div class="oo-wizard-panel" id="oo-step-2">
        <div class="oo-card">
            <h2 class="oo-card-title">Select Contacts</h2>
            <p class="oo-muted" style="margin-bottom:14px">Filter your contact database and add matching contacts to this campaign. <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-contacts&action=finder' ) ); ?>" target="_blank">Find more contacts →</a></p>
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;align-items:flex-end">
                <div class="oo-field" style="margin:0">
                    <label class="oo-label">Contact Type</label>
                    <select id="oo-filter-type" class="oo-select" style="width:160px">
                        <option value="">All Types</option>
                        <?php foreach ( OO_Database::get_contact_types() as $val => $label ) : ?>
                        <option value="<?php echo esc_attr( $val ); ?>"><?php echo esc_html( $label ); ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="oo-field" style="margin:0">
                    <label class="oo-label">Location</label>
                    <input type="text" id="oo-filter-location" class="oo-input" style="width:160px" placeholder="e.g. Atlanta">
                </div>
                <div class="oo-field" style="margin:0">
                    <label class="oo-label">Verified Status</label>
                    <select id="oo-filter-verified" class="oo-select" style="width:140px">
                        <option value="">Any</option>
                        <option value="valid">Valid only</option>
                        <option value="unverified">Unverified</option>
                        <option value="risky">Risky</option>
                    </select>
                </div>
                <button class="oo-btn oo-btn-secondary" id="oo-filter-contacts-btn">Filter</button>
            </div>
            <div id="oo-existing-results" style="display:none">
                <p class="oo-muted" style="margin-bottom:10px">Showing <strong id="oo-existing-count">0</strong> contacts (already linked to this campaign are excluded).</p>
                <div style="display:flex;gap:8px;margin-bottom:10px">
                    <button class="oo-btn oo-btn-secondary oo-btn-sm" id="oo-existing-select-all">Select All</button>
                    <button class="oo-btn oo-btn-secondary oo-btn-sm" id="oo-existing-deselect-all">Deselect All</button>
                </div>
                <div id="oo-existing-table-wrap"></div>
                <div class="oo-wizard-actions" style="padding-top:16px">
                    <button class="oo-btn oo-btn-primary oo-btn-lg" id="oo-link-contacts">
                        <span class="oo-btn-text">Add Selected to Campaign →</span>
                        <span class="oo-btn-loading" style="display:none">Saving…</span>
                    </button>
                    <div id="oo-link-result" class="oo-notice" style="display:none;margin-top:10px"></div>
                </div>
            </div>
        </div>

        <div class="oo-wizard-actions" style="padding-top:16px">
            <button class="oo-btn oo-btn-secondary" id="oo-step2-back">← Back</button>
            <button class="oo-btn oo-btn-primary oo-btn-lg" id="oo-step2-next">Next: Write Emails →</button>
        </div>
    </div>

    <!-- Step 3: Write Emails -->
    <div class="oo-wizard-panel" id="oo-step-3">
        <div class="oo-card">
            <h2 class="oo-card-title">Generate Email Sequence</h2>
            <p class="oo-muted" style="margin-bottom:14px">Claude will write a 3-email sequence tailored to your campaign and audience. You can edit each email before saving.</p>
            <div class="oo-wizard-actions">
                <button class="oo-btn oo-btn-primary oo-btn-lg" id="oo-generate-emails">
                    <span class="oo-btn-text">Write Emails with Claude →</span>
                    <span class="oo-btn-loading" style="display:none">Claude is writing your emails...</span>
                </button>
                <button class="oo-btn oo-btn-secondary" id="oo-step3-back">← Back</button>
            </div>
        </div>

        <div id="oo-emails-result" style="display:none">
            <div id="oo-email-sequence"></div>
            <div class="oo-card">
                <div class="oo-wizard-actions">
                    <button class="oo-btn oo-btn-primary oo-btn-lg" id="oo-save-sequence">
                        <span class="oo-btn-text">Save Email Sequence →</span>
                        <span class="oo-btn-loading" style="display:none">Saving...</span>
                    </button>
                    <div id="oo-sequence-result" class="oo-inline-notice" style="display:none"></div>
                </div>
            </div>
        </div>
    </div>

    <!-- Step 4: Launch -->
    <div class="oo-wizard-panel" id="oo-step-4">
        <div class="oo-card" id="oo-launch-summary" style="border-left:4px solid var(--oo-accent)">
            <h2 class="oo-card-title">Ready to Launch</h2>
            <div id="oo-launch-details"></div>
        </div>
        <div class="oo-card">
            <h2 class="oo-card-title">Launch Campaign</h2>
            <p class="oo-muted" style="margin-bottom:14px">Setting the campaign to Active will enable the email scheduler to start sending. Make sure your sending domain is verified in Amazon SES before launching.</p>
            <div class="oo-wizard-actions">
                <button class="oo-btn oo-btn-primary oo-btn-lg" id="oo-launch-campaign">
                    <span class="oo-btn-text">Launch Campaign</span>
                    <span class="oo-btn-loading" style="display:none">Launching...</span>
                </button>
                <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-campaigns' ) ); ?>" class="oo-btn oo-btn-secondary oo-btn-lg">Save as Draft</a>
            </div>
            <div id="oo-launch-result" class="oo-inline-notice" style="display:none"></div>
        </div>
    </div>

</div><!-- #oo-wizard -->

<script>
window.ooWizardInit = {
    sequences:    <?php echo wp_json_encode( $existing_sequences ); ?>,
    contactCount: <?php echo (int) $contact_count; ?>,
};
</script>
