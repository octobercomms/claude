<?php if ( ! defined( 'ABSPATH' ) ) exit;

OO_License::require_license();

$types         = OO_Database::get_contact_types();
$settings      = get_option( 'oo_settings', array() );
?>

<div class="oo-page-header">
    <h1 class="oo-page-title">Contact Finder</h1>
    <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-contacts' ) ); ?>" class="oo-btn oo-btn-secondary">← Contacts</a>
</div>

<!-- Wizard Steps Nav -->
<div class="oo-wizard-nav">
    <div class="oo-wizard-step active" data-step="1">
        <span class="oo-step-num">1</span>
        <span class="oo-step-label">Audience</span>
    </div>
    <div class="oo-wizard-divider"></div>
    <div class="oo-wizard-step" data-step="2">
        <span class="oo-step-num">2</span>
        <span class="oo-step-label">Search</span>
    </div>
    <div class="oo-wizard-divider"></div>
    <div class="oo-wizard-step" data-step="3">
        <span class="oo-step-num">3</span>
        <span class="oo-step-label">Verify</span>
    </div>
    <div class="oo-wizard-divider"></div>
    <div class="oo-wizard-step" data-step="4">
        <span class="oo-step-num">4</span>
        <span class="oo-step-label">Save</span>
    </div>
</div>

<div id="oo-cf-wizard">

    <!-- Step 1: Audience -->
    <div class="oo-wizard-panel active" id="oo-cf-step-1">
        <div class="oo-card">
            <h2 class="oo-card-title">Describe Your Audience</h2>
            <p class="oo-muted" style="margin-bottom:14px">Tell Claude who you want to reach. The more specific you are, the better the domain suggestions will be.</p>
            <div class="oo-field">
                <label class="oo-label">Audience Description</label>
                <textarea id="cf_audience" class="oo-textarea" rows="4" placeholder="e.g. Independent architecture practices and interior design studios in Melbourne. Principals or directors who make decisions about industry publications."></textarea>
            </div>

            <div class="oo-form-grid" style="grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
                <div class="oo-field" style="margin:0">
                    <label class="oo-label">Location / Geography</label>
                    <input type="text" id="cf_location" class="oo-input" placeholder="e.g. Melbourne, Victoria, Australia">
                    <p class="oo-hint">City, state, country — as specific as possible.</p>
                </div>
                <div class="oo-field" style="margin:0">
                    <label class="oo-label">Industry Sub-type</label>
                    <select id="cf_industry_type" class="oo-select">
                        <option value="">— Select if relevant —</option>
                        <optgroup label="Architecture &amp; Design">
                            <option>Architecture practice</option>
                            <option>Interior design studio</option>
                            <option>Landscape architecture</option>
                            <option>Urban planning / urbanism</option>
                            <option>Industrial design studio</option>
                            <option>Graphic design studio</option>
                        </optgroup>
                        <optgroup label="Construction &amp; Built Environment">
                            <option>Construction company</option>
                            <option>Property developer</option>
                            <option>Engineering consultancy</option>
                            <option>Quantity surveying</option>
                        </optgroup>
                        <optgroup label="Media &amp; Publishing">
                            <option>Architecture / design publication</option>
                            <option>Trade magazine</option>
                            <option>Online media outlet</option>
                        </optgroup>
                        <optgroup label="Other">
                            <option>Law firm</option>
                            <option>Accounting firm</option>
                            <option>Marketing agency</option>
                            <option>Technology company</option>
                            <option>Non-profit / association</option>
                        </optgroup>
                    </select>
                </div>
                <div class="oo-field" style="margin:0">
                    <label class="oo-label">Specialisation / Focus</label>
                    <input type="text" id="cf_specialisation" class="oo-input" placeholder="e.g. Residential, hospitality, adaptive reuse">
                    <p class="oo-hint">What kind of projects or work they do.</p>
                </div>
                <div class="oo-field" style="margin:0">
                    <label class="oo-label">Business Size</label>
                    <select id="cf_business_size" class="oo-select">
                        <option value="">— Any size —</option>
                        <option value="sole trader / freelancer">Solo / freelancer</option>
                        <option value="2–10 staff (micro)">2–10 staff (micro)</option>
                        <option value="10–50 staff (small)">10–50 staff (small)</option>
                        <option value="50–200 staff (medium)">50–200 staff (medium)</option>
                        <option value="200+ staff (large)">200+ staff (large)</option>
                    </select>
                </div>
                <div class="oo-field" style="margin:0;grid-column:1/-1">
                    <label class="oo-label">Exclude These Types</label>
                    <input type="text" id="cf_exclude_types" class="oo-input" placeholder="e.g. Government agencies, national chains, franchise groups">
                    <p class="oo-hint">Anything you explicitly don't want Claude to suggest.</p>
                </div>
            </div>

            <div class="oo-field" style="margin-top:16px">
                <label class="oo-label">Contact Type <span class="oo-muted" style="font-weight:400">(how they'll be tagged)</span></label>
                <input type="text" id="cf_contact_type" class="oo-input" list="cf-contact-types-list" placeholder="e.g. Architect">
                <datalist id="cf-contact-types-list">
                    <?php foreach ( $types as $val => $label ) : ?>
                    <option value="<?php echo esc_attr( $label ); ?>">
                    <?php endforeach; ?>
                </datalist>
            </div>
            <div class="oo-field">
                <label class="oo-label">Extra instructions for Claude</label>
                <textarea id="cf_claude_prompt" class="oo-textarea" rows="2" placeholder="e.g. Focus on independent studios with strong portfolios, not franchise offices."></textarea>
            </div>
            <div class="oo-field" style="margin-top:4px">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
                    <input type="checkbox" id="cf_exclude_searched" checked style="width:auto;margin:0">
                    Exclude domains already in my contacts database
                </label>
            </div>
            <div class="oo-wizard-actions">
                <button class="oo-btn oo-btn-primary oo-btn-lg" id="cf-refine-audience">
                    <span class="oo-btn-text">Let Claude Refine This →</span>
                    <span class="oo-btn-loading" style="display:none">Claude is thinking...</span>
                </button>
            </div>
        </div>

        <div class="oo-card" id="cf-audience-result" style="display:none">
            <h2 class="oo-card-title">Claude's Suggested Targeting</h2>
            <div id="cf-refined-description" class="oo-result-block"></div>
            <div id="cf-rationale" class="oo-muted" style="margin-top:8px;margin-bottom:20px;font-size:13px;line-height:1.6"></div>

            <h3 style="font-size:14px;font-weight:600;margin:0 0 8px">Target Domains to Search</h3>
            <p class="oo-hint" style="margin-bottom:10px">Edit, add or remove domains. Hunter.io and/or Icypeas will search each one for contacts.</p>
            <div id="cf-domains-list" class="oo-tag-list"></div>
            <div class="oo-tag-add" style="display:flex;gap:8px;margin-top:10px">
                <input type="text" id="cf-add-domain" class="oo-input" style="flex:1" placeholder="Add domain e.g. smitharchitects.com">
                <button class="oo-btn oo-btn-secondary" id="cf-add-domain-btn">Add</button>
            </div>

            <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;align-items:center">
                <button class="oo-btn oo-btn-secondary oo-btn-sm" id="cf-more-domains-btn">
                    <span class="oo-btn-text">+ Generate More with Claude</span>
                    <span class="oo-btn-loading" style="display:none">Claude is thinking…</span>
                </button>
                <button class="oo-btn oo-btn-secondary oo-btn-sm" id="cf-discover-domains-btn">
                    <span class="oo-btn-text">🔍 Discover via Web Search</span>
                    <span class="oo-btn-loading" style="display:none">Searching web &amp; directories…</span>
                </button>
                <span id="cf-discover-note" class="oo-muted" style="font-size:12px;display:none"></span>
            </div>

            <h3 style="font-size:14px;font-weight:600;margin:20px 0 8px">Target Job Titles</h3>
            <div id="cf-titles-list" class="oo-tag-list"></div>

            <div class="oo-field" style="margin-top:16px">
                <label class="oo-label">Contacts per domain</label>
                <select id="cf_contacts_per_domain" class="oo-select" style="max-width:180px">
                    <option value="10">10 per domain</option>
                    <option value="25" selected>25 per domain</option>
                    <option value="50">50 per domain</option>
                </select>
            </div>

            <div class="oo-wizard-actions">
                <button class="oo-btn oo-btn-primary oo-btn-lg" id="cf-step1-next">Next: Search for Contacts →</button>
            </div>
        </div>
    </div>

    <!-- Step 2: Search -->
    <div class="oo-wizard-panel" id="oo-cf-step-2">
        <div class="oo-card">
            <h2 class="oo-card-title">Find Contacts</h2>
            <p class="oo-muted" style="margin-bottom:14px">Searches each domain using Hunter.io and/or Icypeas, then falls back to web scraping and email patterns. Deselect any you don't want before continuing.</p>

            <div style="display:flex;gap:24px;margin-bottom:14px;flex-wrap:wrap">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:600">
                    <input type="checkbox" id="cf-include-personal" checked style="width:auto;margin:0">
                    Personal contacts (named individuals)
                </label>
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:600">
                    <input type="checkbox" id="cf-include-generic" checked style="width:auto;margin:0">
                    Generic contacts (info@, contact@, studio@…)
                </label>
            </div>

            <div class="oo-wizard-actions" style="padding:0 0 10px">
                <button class="oo-btn oo-btn-secondary" id="cf-step2-back">← Back</button>
                <button class="oo-btn oo-btn-primary" id="cf-search-contacts">
                    <span class="oo-btn-text">Search for Contacts →</span>
                    <span class="oo-btn-loading" style="display:none">Searching…</span>
                </button>
            </div>
            <p id="cf-search-progress" class="oo-muted" style="display:none;font-size:13px;margin-bottom:12px"></p>
            <div id="cf-contacts-results" style="display:none">
                <p class="oo-muted" style="margin-bottom:10px">Found <strong id="cf-contacts-count">0</strong> contacts total. Deselect any you don't want.</p>
                <div style="display:flex;gap:8px;margin-bottom:12px">
                    <button class="oo-btn oo-btn-secondary oo-btn-sm" id="cf-select-all">Select All</button>
                    <button class="oo-btn oo-btn-secondary oo-btn-sm" id="cf-deselect-all">Deselect All</button>
                </div>
                <div id="cf-contacts-table-wrap"></div>
                <div class="oo-wizard-actions" style="padding-top:16px">
                    <button class="oo-btn oo-btn-primary oo-btn-lg" id="cf-step2-next">
                        Next: Verify Emails →
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- Step 3: Verify -->
    <div class="oo-wizard-panel" id="oo-cf-step-3">
        <div class="oo-card">
            <h2 class="oo-card-title">Verify Email Addresses</h2>
            <p class="oo-muted" style="margin-bottom:14px">Checks each email for a valid MX record and (if configured) verifies deliverability via Hunter.io. Dead or invalid addresses are flagged so you can remove them.</p>

            <div class="oo-wizard-actions" style="padding:0 0 10px">
                <button class="oo-btn oo-btn-secondary" id="cf-step3-back">← Back</button>
                <button class="oo-btn oo-btn-primary" id="cf-verify-emails">
                    <span class="oo-btn-text">Verify Emails →</span>
                    <span class="oo-btn-loading" style="display:none">Verifying…</span>
                </button>
                <button class="oo-btn oo-btn-secondary" id="cf-skip-verify">Skip Verification →</button>
            </div>

            <div id="cf-verify-results" style="display:none">
                <div id="cf-verify-summary" class="oo-muted" style="margin-bottom:12px;font-size:13px"></div>
                <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
                    <button class="oo-btn oo-btn-secondary oo-btn-sm" id="cf-verify-select-valid">Select Valid Only</button>
                    <button class="oo-btn oo-btn-secondary oo-btn-sm" id="cf-verify-select-all">Select All</button>
                    <button class="oo-btn oo-btn-secondary oo-btn-sm" id="cf-verify-deselect-dead">Deselect Dead/Invalid</button>
                </div>
                <div id="cf-verify-table-wrap"></div>
                <div class="oo-wizard-actions" style="padding-top:16px">
                    <button class="oo-btn oo-btn-primary oo-btn-lg" id="cf-step3-next">Next: Save Contacts →</button>
                </div>
            </div>
        </div>
    </div>

    <!-- Step 4: Save -->
    <div class="oo-wizard-panel" id="oo-cf-step-4">
        <div class="oo-card">
            <h2 class="oo-card-title">Save to Contacts</h2>
            <p class="oo-muted" style="margin-bottom:14px">The selected contacts will be added to your Contacts database. Duplicates are automatically skipped.</p>

            <div id="cf-save-summary" class="oo-muted" style="margin-bottom:14px;font-size:13px">
                <strong id="cf-selected-count">0</strong> contacts selected to save.
            </div>

            <div class="oo-wizard-actions">
                <button class="oo-btn oo-btn-secondary" id="cf-step4-back">← Back</button>
                <button class="oo-btn oo-btn-primary oo-btn-lg" id="cf-save-contacts">
                    <span class="oo-btn-text">Save Contacts →</span>
                    <span class="oo-btn-loading" style="display:none">Saving…</span>
                </button>
            </div>
            <div id="cf-save-result" class="oo-notice" style="display:none;margin-top:12px"></div>
            <div id="cf-save-done" style="display:none;margin-top:16px">
                <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-contacts' ) ); ?>" class="oo-btn oo-btn-secondary">← View All Contacts</a>
                <button class="oo-btn oo-btn-primary" id="cf-start-over">Find More Contacts</button>
            </div>
        </div>
    </div>

</div><!-- #oo-cf-wizard -->
