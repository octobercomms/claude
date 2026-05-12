<?php if ( ! defined( 'ABSPATH' ) ) exit;

OO_License::require_license();

global $wpdb;
$campaign_id = intval( $_GET['id'] ?? 0 );
$campaign    = null;

if ( $campaign_id ) {
    $campaign = $wpdb->get_row( $wpdb->prepare(
        "SELECT * FROM {$wpdb->prefix}oo_campaigns WHERE id = %d", $campaign_id
    ) );
}

$brands        = OO_Database::get_brands();
$types         = OO_Database::get_campaign_types();
$contact_types = OO_Database::get_contact_types();
$settings      = get_option( 'oo_settings', array() );
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
        <span class="oo-step-label">Audience</span>
    </div>
    <div class="oo-wizard-divider"></div>
    <div class="oo-wizard-step" data-step="3">
        <span class="oo-step-num">3</span>
        <span class="oo-step-label">Contacts</span>
    </div>
    <div class="oo-wizard-divider"></div>
    <div class="oo-wizard-step" data-step="4">
        <span class="oo-step-num">4</span>
        <span class="oo-step-label">Emails</span>
    </div>
    <div class="oo-wizard-divider"></div>
    <div class="oo-wizard-step" data-step="5">
        <span class="oo-step-num">5</span>
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
                <div class="oo-field">
                    <label class="oo-label">Campaign Type</label>
                    <select id="w_type" class="oo-select">
                        <?php foreach ( $types as $val => $label ) : ?>
                        <option value="<?php echo esc_attr( $val ); ?>" <?php selected( $campaign->type ?? 'outreach', $val ); ?>><?php echo esc_html( $label ); ?></option>
                        <?php endforeach; ?>
                    </select>
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

            <div class="oo-card" id="oo-press-card" style="display:none">
                <h2 class="oo-card-title">Press Release</h2>
                <p class="oo-muted" style="margin-bottom:14px">Link to the press release page or PDF. Claude will reference it when writing outreach emails.</p>
                <div class="oo-field">
                    <label class="oo-label">Press Release URL</label>
                    <input type="url" id="w_press_release_url" class="oo-input" value="<?php echo esc_attr( $campaign->press_release_url ?? '' ); ?>" placeholder="https://yourdomain.com/press/your-announcement">
                    <p class="oo-hint">A public URL to the press release. Journalists will be directed here.</p>
                </div>
            </div>

            <div class="oo-card" id="oo-coupon-card" style="display:none">
                <h2 class="oo-card-title">Coupon / Offer Integration</h2>
                <p class="oo-muted" style="margin-bottom:14px">Optional. If this campaign includes a discount or offer code, link to your existing coupon plugin's data source here.</p>
                <div class="oo-field">
                    <label class="oo-label">Coupon Source URL</label>
                    <input type="url" id="w_coupon_url" class="oo-input" value="<?php echo esc_attr( $campaign->coupon_url ?? '' ); ?>" placeholder="https://yourdomain.com/wp-json/your-plugin/v1/coupons">
                    <p class="oo-hint">REST endpoint that returns available coupons from your existing coupon plugin.</p>
                </div>
                <div class="oo-field">
                    <label class="oo-label">Coupon Code Field</label>
                    <input type="text" id="w_coupon_field" class="oo-input" value="<?php echo esc_attr( $campaign->coupon_field ?? '' ); ?>" placeholder="e.g. code">
                    <p class="oo-hint">The JSON key to extract the coupon code from the endpoint response (e.g. <code>code</code>, <code>coupon_code</code>).</p>
                </div>
            </div>

        </div>
        <div class="oo-wizard-actions">
            <button class="oo-btn oo-btn-primary oo-btn-lg" id="oo-step1-next">Next: Define Audience →</button>
        </div>
    </div>

    <!-- Step 2: Audience -->
    <div class="oo-wizard-panel" id="oo-step-2">
        <div class="oo-card">
            <h2 class="oo-card-title">Describe Your Audience</h2>
            <p class="oo-muted" style="margin-bottom:14px">Write in plain English who you want to reach. Claude will refine this into specific search targets.</p>
            <div class="oo-field">
                <label class="oo-label">Audience Description</label>
                <textarea id="w_audience" class="oo-textarea" rows="5" placeholder="e.g. Architects and interior designers based in Atlanta, Georgia and surrounding states. Principals or directors at firms with 5–50 staff. Interested in design competitions and awards."><?php echo esc_textarea( $campaign->audience_description ?? '' ); ?></textarea>
            </div>
            <div class="oo-field">
                <label class="oo-label">Extra instructions for Claude</label>
                <textarea id="w_claude_prompt" class="oo-textarea" rows="3" placeholder="e.g. Tone should be warm and collegial. Mention ADF's reputation. Keep emails under 120 words."><?php echo esc_textarea( $campaign->claude_prompt ?? '' ); ?></textarea>
            </div>
            <div class="oo-field">
                <label class="oo-label">Contact Type</label>
                <input type="text" id="w_contact_type" class="oo-input" list="oo-contact-types-list" placeholder="e.g. Architect">
                <datalist id="oo-contact-types-list">
                    <?php foreach ( $contact_types as $val => $label ) : ?>
                    <option value="<?php echo esc_attr( $label ); ?>">
                    <?php endforeach; ?>
                </datalist>
                <p class="oo-hint">How these contacts will be categorised in your database.</p>
            </div>
            <div class="oo-wizard-actions">
                <button class="oo-btn oo-btn-primary oo-btn-lg" id="oo-refine-audience">
                    <span class="oo-btn-text">Let Claude Refine This →</span>
                    <span class="oo-btn-loading" style="display:none">Claude is thinking...</span>
                </button>
            </div>
        </div>

        <div class="oo-card" id="oo-audience-result" style="display:none">
            <h2 class="oo-card-title">Claude's Suggested Targeting</h2>
            <div id="oo-refined-description" class="oo-result-block"></div>
            <div id="oo-rationale" class="oo-muted" style="margin-top:8px;margin-bottom:20px;font-size:13px;line-height:1.6"></div>

            <h3 style="font-size:14px;font-weight:600;margin:0 0 8px">Target Domains to Search</h3>
            <p class="oo-hint" style="margin-bottom:10px">Edit, add or remove domains. Hunter.io will search each one for contacts.</p>
            <div id="oo-domains-list" class="oo-tag-list"></div>
            <div class="oo-tag-add" style="display:flex;gap:8px;margin-top:10px">
                <input type="text" id="oo-add-domain" class="oo-input" style="flex:1" placeholder="Add domain e.g. smitharchitects.com">
                <button class="oo-btn oo-btn-secondary" id="oo-add-domain-btn">Add</button>
            </div>

            <h3 style="font-size:14px;font-weight:600;margin:20px 0 8px">Target Job Titles</h3>
            <div id="oo-titles-list" class="oo-tag-list"></div>

            <div class="oo-wizard-actions">
                <button class="oo-btn oo-btn-secondary" id="oo-step2-back">← Back</button>
                <button class="oo-btn oo-btn-primary oo-btn-lg" id="oo-step2-next">Next: Find Contacts →</button>
            </div>
        </div>
    </div>

    <!-- Step 3: Find Contacts -->
    <div class="oo-wizard-panel" id="oo-step-3">
        <div class="oo-card">
            <h2 class="oo-card-title">Find Contacts</h2>
            <p class="oo-muted" style="margin-bottom:14px">Hunter.io will search each domain for contacts. Review and select who to add to your database.</p>
            <div class="oo-wizard-actions">
                <button class="oo-btn oo-btn-primary oo-btn-lg" id="oo-search-contacts">
                    <span class="oo-btn-text">Search Hunter.io →</span>
                    <span class="oo-btn-loading" style="display:none">Searching... this may take a moment</span>
                </button>
                <button class="oo-btn oo-btn-secondary" id="oo-step3-back">← Back</button>
            </div>
        </div>

        <div id="oo-contacts-results" style="display:none">
            <div class="oo-card">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
                    <h2 class="oo-card-title" style="margin:0">Contacts Found <span id="oo-contacts-count" class="oo-badge oo-badge-blue">0</span></h2>
                    <div style="display:flex;gap:8px">
                        <button class="oo-btn oo-btn-secondary oo-btn-sm" id="oo-select-all">Select All</button>
                        <button class="oo-btn oo-btn-secondary oo-btn-sm" id="oo-deselect-all">Deselect All</button>
                    </div>
                </div>
                <div id="oo-contacts-table-wrap"></div>
                <div class="oo-wizard-actions">
                    <button class="oo-btn oo-btn-primary oo-btn-lg" id="oo-save-contacts">
                        <span class="oo-btn-text">Add Selected to Database →</span>
                        <span class="oo-btn-loading" style="display:none">Saving...</span>
                    </button>
                    <div id="oo-save-result" class="oo-inline-notice" style="display:none"></div>
                </div>
            </div>
            <div class="oo-wizard-actions">
                <button class="oo-btn oo-btn-primary oo-btn-lg" id="oo-step3-next">Next: Write Emails →</button>
            </div>
        </div>
    </div>

    <!-- Step 4: Write Emails -->
    <div class="oo-wizard-panel" id="oo-step-4">
        <div class="oo-card">
            <h2 class="oo-card-title">Generate Email Sequence</h2>
            <p class="oo-muted" style="margin-bottom:14px">Claude will write a 3-email sequence tailored to your campaign and audience. You can edit each email before saving.</p>
            <div class="oo-wizard-actions">
                <button class="oo-btn oo-btn-primary oo-btn-lg" id="oo-generate-emails">
                    <span class="oo-btn-text">Write Emails with Claude →</span>
                    <span class="oo-btn-loading" style="display:none">Claude is writing your emails...</span>
                </button>
                <button class="oo-btn oo-btn-secondary" id="oo-step4-back">← Back</button>
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

    <!-- Step 5: Launch -->
    <div class="oo-wizard-panel" id="oo-step-5">
        <div class="oo-card" id="oo-launch-summary" style="border-left:4px solid var(--oo-accent)">
            <h2 class="oo-card-title">Ready to Launch</h2>
            <div id="oo-launch-details"></div>
        </div>
        <div class="oo-card">
            <h2 class="oo-card-title">Airtable Sync</h2>
            <p class="oo-muted" style="margin-bottom:14px">Push your new contacts to Airtable so you can view and edit them outside WordPress.</p>
            <button class="oo-btn oo-btn-secondary" id="oo-sync-airtable">
                <span class="oo-btn-text">Sync Contacts to Airtable</span>
                <span class="oo-btn-loading" style="display:none">Syncing...</span>
            </button>
            <span id="oo-airtable-result" class="oo-inline-notice" style="display:none"></span>
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
