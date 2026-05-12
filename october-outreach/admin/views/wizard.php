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

$brands = OO_Database::get_brands();
$types  = OO_Database::get_campaign_types();
$contact_types = OO_Database::get_contact_types();
?>

<div class="wrap oo-wrap">
    <h1 class="oo-page-title">
        <?php echo $campaign ? 'Campaign Wizard — ' . esc_html( $campaign->name ) : 'New Campaign Wizard'; ?>
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-campaigns' ) ); ?>" class="page-title-action">Back to Campaigns</a>
    </h1>

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
            <div class="oo-card">
                <h2>Campaign Details</h2>
                <table class="form-table">
                    <tr>
                        <th><label for="w_name">Campaign Name</label></th>
                        <td><input type="text" id="w_name" class="regular-text" value="<?php echo esc_attr( $campaign->name ?? '' ); ?>" placeholder="e.g. ADF 2025 — Project Submissions" required></td>
                    </tr>
                    <tr>
                        <th><label for="w_brand">Brand</label></th>
                        <td>
                            <select id="w_brand">
                                <option value="">— Select brand —</option>
                                <?php foreach ( $brands as $val => $label ) : ?>
                                <option value="<?php echo esc_attr( $val ); ?>" <?php selected( $campaign->brand ?? '', $val ); ?>><?php echo esc_html( $label ); ?></option>
                                <?php endforeach; ?>
                            </select>
                        </td>
                    </tr>
                    <tr>
                        <th><label for="w_type">Campaign Type</label></th>
                        <td>
                            <select id="w_type">
                                <?php foreach ( $types as $val => $label ) : ?>
                                <option value="<?php echo esc_attr( $val ); ?>" <?php selected( $campaign->type ?? 'outreach', $val ); ?>><?php echo esc_html( $label ); ?></option>
                                <?php endforeach; ?>
                            </select>
                        </td>
                    </tr>
                </table>
            </div>
            <div class="oo-card">
                <h2>Sending Identity</h2>
                <p class="description">Use a sister domain address for From — not your main domain. Replies come to you via Reply-To.</p>
                <table class="form-table">
                    <tr>
                        <th><label for="w_from_name">From Name</label></th>
                        <td><input type="text" id="w_from_name" class="regular-text" value="<?php echo esc_attr( $campaign->from_name ?? '' ); ?>" placeholder="e.g. James at October Comms"></td>
                    </tr>
                    <tr>
                        <th><label for="w_from_email">From Email</label></th>
                        <td><input type="email" id="w_from_email" class="regular-text" value="<?php echo esc_attr( $campaign->from_email ?? '' ); ?>" placeholder="outreach@sister-domain.com"></td>
                    </tr>
                    <tr>
                        <th><label for="w_reply_to">Reply-To</label></th>
                        <td><input type="email" id="w_reply_to" class="regular-text" value="<?php echo esc_attr( $campaign->reply_to ?? get_option( 'oo_settings', [] )['default_reply_to'] ?? '' ); ?>"></td>
                    </tr>
                </table>
            </div>
            <div class="oo-wizard-actions">
                <button class="button button-primary button-large" id="oo-step1-next">Next: Define Audience →</button>
            </div>
        </div>

        <!-- Step 2: Audience -->
        <div class="oo-wizard-panel" id="oo-step-2">
            <div class="oo-card">
                <h2>Describe Your Audience</h2>
                <p class="description">Write in plain English who you want to reach. Claude will refine this into specific search targets.</p>
                <table class="form-table">
                    <tr>
                        <th><label for="w_audience">Audience Description</label></th>
                        <td>
                            <textarea id="w_audience" rows="5" class="large-text" placeholder="e.g. Architects and interior designers based in Atlanta, Georgia and surrounding states. Principals or directors at firms with 5–50 staff. Interested in design competitions and awards."><?php echo esc_textarea( $campaign->audience_description ?? '' ); ?></textarea>
                        </td>
                    </tr>
                    <tr>
                        <th><label for="w_claude_prompt">Extra instructions for Claude</label></th>
                        <td>
                            <textarea id="w_claude_prompt" rows="3" class="large-text" placeholder="e.g. Tone should be warm and collegial. Mention ADF's reputation. Keep emails under 120 words."><?php echo esc_textarea( $campaign->claude_prompt ?? '' ); ?></textarea>
                        </td>
                    </tr>
                    <tr>
                        <th><label for="w_contact_type">Contact Type</label></th>
                        <td>
                            <select id="w_contact_type">
                                <option value="">— Select type —</option>
                                <?php foreach ( $contact_types as $val => $label ) : ?>
                                <option value="<?php echo esc_attr( $val ); ?>"><?php echo esc_html( $label ); ?></option>
                                <?php endforeach; ?>
                            </select>
                            <p class="description">How these contacts will be categorised in your database.</p>
                        </td>
                    </tr>
                </table>
                <div class="oo-wizard-actions">
                    <button class="button button-primary button-large" id="oo-refine-audience">
                        <span class="oo-btn-text">Let Claude Refine This →</span>
                        <span class="oo-btn-loading" style="display:none">Claude is thinking...</span>
                    </button>
                </div>
            </div>

            <div class="oo-card" id="oo-audience-result" style="display:none">
                <h2>Claude's Suggested Targeting</h2>
                <div id="oo-refined-description" class="oo-result-block"></div>
                <div id="oo-rationale" class="oo-muted oo-result-note"></div>

                <h3>Target Domains to Search</h3>
                <p class="description">Edit, add or remove domains. Hunter.io will search each one for contacts.</p>
                <div id="oo-domains-list" class="oo-tag-list"></div>
                <div class="oo-tag-add">
                    <input type="text" id="oo-add-domain" placeholder="Add domain e.g. smitharchitects.com">
                    <button class="button" id="oo-add-domain-btn">Add</button>
                </div>

                <h3>Target Job Titles</h3>
                <div id="oo-titles-list" class="oo-tag-list"></div>

                <div class="oo-wizard-actions">
                    <button class="button" id="oo-step2-back">← Back</button>
                    <button class="button button-primary button-large" id="oo-step2-next">Next: Find Contacts →</button>
                </div>
            </div>
        </div>

        <!-- Step 3: Find Contacts -->
        <div class="oo-wizard-panel" id="oo-step-3">
            <div class="oo-card">
                <h2>Find Contacts</h2>
                <p class="description">Hunter.io will search each domain for contacts. Review and select who to add to your database.</p>
                <div class="oo-wizard-actions">
                    <button class="button button-primary button-large" id="oo-search-contacts">
                        <span class="oo-btn-text">Search Hunter.io →</span>
                        <span class="oo-btn-loading" style="display:none">Searching... this may take a moment</span>
                    </button>
                    <button class="button" id="oo-step3-back">← Back</button>
                </div>
            </div>

            <div id="oo-contacts-results" style="display:none">
                <div class="oo-card">
                    <div class="oo-contacts-header">
                        <h2>Contacts Found <span id="oo-contacts-count" class="oo-badge oo-badge-blue">0</span></h2>
                        <div>
                            <button class="button" id="oo-select-all">Select All</button>
                            <button class="button" id="oo-deselect-all">Deselect All</button>
                        </div>
                    </div>
                    <div id="oo-contacts-table-wrap"></div>
                    <div class="oo-wizard-actions">
                        <button class="button button-primary button-large" id="oo-save-contacts">
                            <span class="oo-btn-text">Add Selected to Database →</span>
                            <span class="oo-btn-loading" style="display:none">Saving...</span>
                        </button>
                        <div id="oo-save-result" class="oo-inline-notice" style="display:none"></div>
                    </div>
                </div>
                <div class="oo-wizard-actions">
                    <button class="button button-large" id="oo-step3-next">Next: Write Emails →</button>
                </div>
            </div>
        </div>

        <!-- Step 4: Write Emails -->
        <div class="oo-wizard-panel" id="oo-step-4">
            <div class="oo-card">
                <h2>Generate Email Sequence</h2>
                <p class="description">Claude will write a 3-email sequence tailored to your campaign and audience. You can edit each email before saving.</p>
                <div class="oo-wizard-actions">
                    <button class="button button-primary button-large" id="oo-generate-emails">
                        <span class="oo-btn-text">Write Emails with Claude →</span>
                        <span class="oo-btn-loading" style="display:none">Claude is writing your emails...</span>
                    </button>
                    <button class="button" id="oo-step4-back">← Back</button>
                </div>
            </div>

            <div id="oo-emails-result" style="display:none">
                <div id="oo-email-sequence"></div>
                <div class="oo-card">
                    <div class="oo-wizard-actions">
                        <button class="button button-primary button-large" id="oo-save-sequence">
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
            <div class="oo-card oo-card-success" id="oo-launch-summary">
                <h2>Ready to Launch</h2>
                <div id="oo-launch-details"></div>
            </div>
            <div class="oo-card">
                <h2>Airtable Sync</h2>
                <p class="description">Push your new contacts to Airtable so you can view and edit them outside WordPress.</p>
                <button class="button" id="oo-sync-airtable">
                    <span class="oo-btn-text">Sync Contacts to Airtable</span>
                    <span class="oo-btn-loading" style="display:none">Syncing...</span>
                </button>
                <span id="oo-airtable-result" class="oo-inline-notice" style="display:none"></span>
            </div>
            <div class="oo-card">
                <h2>Launch Campaign</h2>
                <p class="description">Setting the campaign to Active will enable the email scheduler to start sending. Make sure your sending domain is verified in Amazon SES before launching.</p>
                <div class="oo-wizard-actions">
                    <button class="button button-primary button-large" id="oo-launch-campaign">
                        <span class="oo-btn-text">Launch Campaign</span>
                        <span class="oo-btn-loading" style="display:none">Launching...</span>
                    </button>
                    <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-campaigns' ) ); ?>" class="button button-large">Save as Draft</a>
                </div>
                <div id="oo-launch-result" class="oo-inline-notice" style="display:none"></div>
            </div>
        </div>

    </div><!-- #oo-wizard -->
</div>
