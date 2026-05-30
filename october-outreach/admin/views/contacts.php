<?php if ( ! defined( 'ABSPATH' ) ) exit;
global $wpdb;

$action = $_GET['action'] ?? 'list';
if ( $action === 'finder' ) { return; } // handled by contact-finder view

$types = OO_Database::get_contact_types();

// ── Filters ─────────────────────────────────────────────────────────────
$search          = sanitize_text_field( $_GET['s']               ?? '' );
$type_filter     = sanitize_text_field( $_GET['type_filter']     ?? '' );
$verified_filter = sanitize_text_field( $_GET['verified_filter'] ?? '' );
$tag_filter      = array_map( 'sanitize_text_field', (array) ( $_GET['tag_filter'] ?? array() ) );
$tag_filter      = array_filter( $tag_filter );

$where = "WHERE 1=1";
$args  = array();

if ( $type_filter ) {
    $where .= " AND type = %s";
    $args[] = $type_filter;
}
if ( $verified_filter ) {
    $where .= " AND verified_status = %s";
    $args[] = $verified_filter;
}
if ( $search ) {
    $like   = '%' . $wpdb->esc_like( $search ) . '%';
    $where .= " AND (first_name LIKE %s OR last_name LIKE %s OR email LIKE %s OR company LIKE %s)";
    array_push( $args, $like, $like, $like, $like );
}
foreach ( $tag_filter as $tg ) {
    $where .= " AND tags LIKE %s";
    $args[] = '%' . $wpdb->esc_like( '"' . $tg . '"' ) . '%';
}

$total      = (int) $wpdb->get_var( $args
    ? $wpdb->prepare( "SELECT COUNT(*) FROM {$wpdb->prefix}oo_contacts $where", $args )
    : "SELECT COUNT(*) FROM {$wpdb->prefix}oo_contacts $where"
);
$per_page    = 50;
$paged       = max( 1, intval( $_GET['paged'] ?? 1 ) );
$offset      = ( $paged - 1 ) * $per_page;
$total_pages = (int) ceil( $total / $per_page );

$contacts = $args
    ? $wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}oo_contacts $where ORDER BY created_at DESC LIMIT %d OFFSET %d", array_merge( $args, array( $per_page, $offset ) ) ) )
    : $wpdb->get_results( "SELECT * FROM {$wpdb->prefix}oo_contacts $where ORDER BY created_at DESC LIMIT $per_page OFFSET $offset" );

// ── Engagement stats for current page ──────────────────────────────────
$engagement_map = array();
if ( $contacts ) {
    $page_ids = array_map( fn( $c ) => intval( $c->id ), $contacts );
    $ph       = implode( ',', array_fill( 0, count( $page_ids ), '%d' ) );
    $eng_rows = $wpdb->get_results( $wpdb->prepare(
        "SELECT contact_id,
                COUNT(*) AS sent,
                SUM(opened_at IS NOT NULL) AS opened,
                SUM(replied_at IS NOT NULL) AS replied,
                MAX(sent_at) AS last_sent
         FROM {$wpdb->prefix}oo_sends
         WHERE contact_id IN ($ph) AND status IN ('sent','opened','replied')
         GROUP BY contact_id",
        $page_ids
    ), ARRAY_A );
    foreach ( $eng_rows as $r ) {
        $engagement_map[ $r['contact_id'] ] = $r;
    }
}

// ── Workspace tags for filter chips ────────────────────────────────────
$tag_rows = $wpdb->get_col(
    "SELECT tags FROM {$wpdb->prefix}oo_contacts WHERE tags IS NOT NULL AND tags != '' AND tags != '[]' LIMIT 5000"
);
$workspace_tags = array();
foreach ( $tag_rows as $raw ) {
    $arr = json_decode( $raw, true );
    if ( is_array( $arr ) ) {
        foreach ( $arr as $t ) {
            $t = strtolower( trim( $t ) );
            if ( $t ) $workspace_tags[ $t ] = ( $workspace_tags[ $t ] ?? 0 ) + 1;
        }
    }
}
arsort( $workspace_tags );
$workspace_tags = array_keys( $workspace_tags );

$dead_count       = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->prefix}oo_contacts WHERE verified_status IN ('invalid','dead')" );
$no_location_count = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->prefix}oo_contacts WHERE (location = '' OR location IS NULL)" );

$settings = get_option( 'oo_settings', array() );
?>

<div class="oo-page-header">
    <h1 class="oo-page-title">Contacts</h1>
    <div class="oo-page-actions" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-contacts&action=finder' ) ); ?>" class="oo-btn oo-btn-primary">+ Find New Contacts</a>
        <button class="oo-btn oo-btn-secondary" id="oo-add-contact-btn">+ Add Manually</button>
        <button class="oo-btn oo-btn-secondary" id="oo-import-btn">↑ Import CSV</button>
        <a href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=oo_export_contacts' ), 'oo_export_contacts' ) ); ?>" class="oo-btn oo-btn-secondary">↓ Export CSV</a>
        <?php if ( ! empty( $settings['airtable_api_key'] ) ) : ?>
        <button class="oo-btn oo-btn-secondary" id="oo-airtable-push-btn">Sync Airtable</button>
        <?php endif; ?>
        <?php if ( $total > 0 ) : ?>
        <button class="oo-btn oo-btn-secondary" id="oo-delete-all-btn" style="color:#c0392b;border-color:#c0392b">Delete All <?php echo number_format( $total ); ?></button>
        <?php endif; ?>
    </div>
</div>

<!-- Delete All confirm modal -->
<div id="oo-delete-all-modal" class="oo-modal-overlay" style="display:none">
    <div class="oo-modal" style="max-width:440px">
        <div class="oo-modal-head">
            <h2>Delete All Contacts</h2>
            <button class="oo-modal-close" id="oo-delete-all-modal-close">×</button>
        </div>
        <div style="padding:20px">
            <p style="margin-bottom:12px">This will permanently delete all <strong><?php echo number_format( $total ); ?> contacts</strong> and cannot be undone.</p>
            <p style="margin-bottom:16px">Type <strong>DELETE</strong> to confirm:</p>
            <input type="text" id="oo-delete-all-confirm-input" class="oo-input" placeholder="Type DELETE here" style="width:100%;margin-bottom:16px">
            <div style="display:flex;gap:8px">
                <button class="oo-btn oo-btn-secondary" id="oo-delete-all-cancel-btn">Cancel</button>
                <button class="oo-btn oo-btn-primary" id="oo-delete-all-confirm-btn" style="background:#c0392b;border-color:#c0392b" disabled>Delete All Contacts</button>
                <span id="oo-delete-all-status" class="oo-muted" style="align-self:center;font-size:13px"></span>
            </div>
        </div>
    </div>
</div>

<div id="oo-contacts-notices"></div>
<div id="oo-airtable-push-result" class="oo-notice" style="display:none"></div>

<?php if ( isset( $_GET['imported'] ) ) : ?>
<div class="oo-notice oo-notice-success"><?php echo intval( $_GET['imported'] ); ?> contacts imported, <?php echo intval( $_GET['merged'] ?? 0 ); ?> merged, <?php echo intval( $_GET['skipped'] ?? 0 ); ?> skipped.</div>
<?php endif; ?>

<!-- ── Tag filter chips ──────────────────────────────────────────────── -->
<?php if ( ! empty( $workspace_tags ) ) : ?>
<div class="oo-tag-filter-bar" id="oo-tag-filter-bar">
    <span class="oo-muted" style="font-size:12px;white-space:nowrap">Filter by tag:</span>
    <?php foreach ( array_slice( $workspace_tags, 0, 40 ) as $wt ) :
        $active = in_array( $wt, $tag_filter, true );
        $new_tags = $active ? array_values( array_diff( $tag_filter, array( $wt ) ) ) : array_merge( $tag_filter, array( $wt ) );
        $chip_url = add_query_arg( array_filter( array(
            'page'            => 'oo-contacts',
            's'               => $search ?: null,
            'type_filter'     => $type_filter ?: null,
            'verified_filter' => $verified_filter ?: null,
            'tag_filter'      => $new_tags ?: null,
        ) ), admin_url( 'admin.php' ) );
    ?>
    <a href="<?php echo esc_url( $chip_url ); ?>"
       class="oo-tag-filter-chip<?php echo $active ? ' active' : ''; ?>">
        <?php echo esc_html( $wt ); ?>
        <?php if ( $active ) echo '<span>×</span>'; ?>
    </a>
    <?php endforeach; ?>
    <?php if ( count( $workspace_tags ) > 40 ) : ?>
    <span class="oo-muted" style="font-size:11px">+<?php echo count( $workspace_tags ) - 40; ?> more — use search</span>
    <?php endif; ?>
</div>
<?php endif; ?>

<!-- ── Filter bar ───────────────────────────────────────────────────── -->
<div class="oo-filters">
    <form method="get" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <input type="hidden" name="page" value="oo-contacts">
        <?php foreach ( $tag_filter as $tg ) : ?>
        <input type="hidden" name="tag_filter[]" value="<?php echo esc_attr( $tg ); ?>">
        <?php endforeach; ?>
        <input type="search" name="s" class="oo-input" value="<?php echo esc_attr( $search ); ?>" placeholder="Search contacts…" style="width:220px">
        <select name="type_filter" class="oo-select" style="width:160px">
            <option value="">All Types</option>
            <?php foreach ( $types as $val => $label ) : ?>
            <option value="<?php echo esc_attr( $val ); ?>" <?php selected( $type_filter, $val ); ?>><?php echo esc_html( $label ); ?></option>
            <?php endforeach; ?>
        </select>
        <select name="verified_filter" class="oo-select" style="width:150px">
            <option value="">All Statuses</option>
            <option value="unverified" <?php selected( $verified_filter, 'unverified' ); ?>>Unverified</option>
            <option value="valid"      <?php selected( $verified_filter, 'valid' ); ?>>Valid</option>
            <option value="risky"      <?php selected( $verified_filter, 'risky' ); ?>>Risky</option>
            <option value="invalid"    <?php selected( $verified_filter, 'invalid' ); ?>>Invalid</option>
            <option value="dead"       <?php selected( $verified_filter, 'dead' ); ?>>Dead</option>
        </select>
        <button type="submit" class="oo-btn oo-btn-secondary">Filter</button>
        <?php if ( $search || $type_filter || $verified_filter || $tag_filter ) : ?>
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-contacts' ) ); ?>" class="oo-btn oo-btn-secondary">✕ Clear</a>
        <?php endif; ?>
        <span class="oo-count">
            <?php if ( $total_pages > 1 ) :
                echo 'Showing ' . ( $offset + 1 ) . '–' . min( $offset + $per_page, $total ) . ' of ' . number_format( $total ) . ' contacts';
            else :
                echo number_format( $total ) . ' contact' . ( $total !== 1 ? 's' : '' );
            endif; ?>
        </span>
    </form>
    <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <?php if ( $no_location_count > 0 ) : ?>
        <button class="oo-btn oo-btn-secondary" id="oo-enrich-locations-btn">
            <span id="oo-enrich-btn-text">Enrich Locations (<?php echo $no_location_count; ?> missing)</span>
        </button>
        <?php endif; ?>
        <?php if ( $dead_count > 0 ) : ?>
        <button class="oo-btn oo-btn-secondary" id="oo-delete-dead-btn" style="color:#c0392b;border-color:#c0392b">
            Delete <?php echo $dead_count; ?> Dead / Invalid
        </button>
        <?php endif; ?>
    </div>
</div>
<div id="oo-enrich-result" class="oo-notice" style="display:none;margin-bottom:8px"></div>
<div id="oo-dead-result"   class="oo-notice" style="display:none;margin-bottom:8px"></div>

<!-- ── Bulk toolbar ─────────────────────────────────────────────────── -->
<div class="oo-bulk-toolbar" id="oo-bulk-toolbar" style="display:none">
    <span id="oo-bulk-count" class="oo-muted" style="font-size:13px"></span>
    <button class="oo-btn oo-btn-secondary oo-btn-sm" id="oo-bulk-tag-btn">+ Add Tags</button>
    <button class="oo-btn oo-btn-secondary oo-btn-sm" id="oo-bulk-delete-btn" style="color:#c0392b;border-color:#c0392b">Delete Selected</button>
</div>

<!-- ── Table ────────────────────────────────────────────────────────── -->
<?php if ( $contacts ) : ?>
<div class="oo-table-wrap">
    <table class="oo-table" id="oo-contacts-table">
        <thead><tr>
            <th style="width:36px"><input type="checkbox" id="oo-select-all" title="Select all"></th>
            <th>Name</th><th>Email</th><th>Company</th><th>Type</th><th>Tags</th><th>Location</th><th>Engagement</th><th>Status</th><th style="width:36px"></th>
        </tr></thead>
        <tbody>
        <?php foreach ( $contacts as $c ) :
            $tags   = json_decode( $c->tags ?? '[]', true );
            $tags   = is_array( $tags ) ? $tags : array();
            $eng    = $engagement_map[ $c->id ] ?? null;
            $eng_str = $eng
                ? $eng['sent'] . ' sent · ' . $eng['opened'] . ' opened'
                : '—';
            $eng_tip = $eng
                ? sprintf( 'Sent %d · Opened %d · Replied %d · Last sent %s',
                    $eng['sent'], $eng['opened'], $eng['replied'],
                    $eng['last_sent'] ? date( 'd M Y', strtotime( $eng['last_sent'] ) ) : 'never'
                  )
                : '';
        ?>
        <tr class="oo-contact-row" data-id="<?php echo esc_attr( $c->id ); ?>">
            <td class="oo-cb-cell"><input type="checkbox" class="oo-row-cb" value="<?php echo esc_attr( $c->id ); ?>"></td>
            <td><strong><?php echo esc_html( trim( $c->first_name . ' ' . $c->last_name ) ?: '—' ); ?></strong></td>
            <td class="oo-muted"><?php echo esc_html( $c->email ); ?></td>
            <td><?php echo esc_html( $c->company ?: '—' ); ?></td>
            <td><?php echo esc_html( $types[ $c->type ] ?? $c->type ?: '—' ); ?></td>
            <td>
                <?php foreach ( array_slice( $tags, 0, 3 ) as $tag ) : ?>
                <span class="oo-badge oo-badge-blue" style="margin:1px 2px;font-size:10.5px"><?php echo esc_html( $tag ); ?></span>
                <?php endforeach; ?>
                <?php if ( count( $tags ) > 3 ) echo '<span class="oo-muted" style="font-size:11px">+' . ( count( $tags ) - 3 ) . '</span>'; ?>
            </td>
            <td class="oo-muted"><?php echo esc_html( $c->location ?: '—' ); ?></td>
            <td class="oo-muted" <?php if ( $eng_tip ) echo 'title="' . esc_attr( $eng_tip ) . '"'; ?>><?php echo esc_html( $eng_str ); ?></td>
            <td><span class="oo-badge oo-badge-<?php echo $c->status === 'active' ? 'green' : 'grey'; ?>"><?php echo esc_html( ucfirst( str_replace( '_', ' ', $c->status ) ) ); ?></span></td>
            <td class="oo-delete-cell"><button class="oo-row-delete-btn" data-id="<?php echo esc_attr( $c->id ); ?>" title="Delete">×</button></td>
        </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
</div>

<?php if ( $total_pages > 1 ) :
    $base_url = add_query_arg( array_filter( array(
        'page'            => 'oo-contacts',
        's'               => $search ?: null,
        'type_filter'     => $type_filter ?: null,
        'verified_filter' => $verified_filter ?: null,
        'tag_filter'      => $tag_filter ?: null,
    ) ), admin_url( 'admin.php' ) );
?>
<div style="display:flex;align-items:center;gap:6px;margin-top:14px;flex-wrap:wrap">
    <?php if ( $paged > 1 ) : ?>
    <a href="<?php echo esc_url( add_query_arg( 'paged', $paged - 1, $base_url ) ); ?>" class="oo-btn oo-btn-secondary oo-btn-sm">← Prev</a>
    <?php endif; ?>
    <?php for ( $p = max( 1, $paged - 3 ); $p <= min( $total_pages, $paged + 3 ); $p++ ) : ?>
    <a href="<?php echo esc_url( add_query_arg( 'paged', $p, $base_url ) ); ?>"
       class="oo-btn oo-btn-sm <?php echo $p === $paged ? 'oo-btn-primary' : 'oo-btn-secondary'; ?>">
        <?php echo $p; ?>
    </a>
    <?php endfor; ?>
    <?php if ( $paged < $total_pages ) : ?>
    <a href="<?php echo esc_url( add_query_arg( 'paged', $paged + 1, $base_url ) ); ?>" class="oo-btn oo-btn-secondary oo-btn-sm">Next →</a>
    <?php endif; ?>
    <span class="oo-muted" style="font-size:12px">Page <?php echo $paged; ?> of <?php echo $total_pages; ?></span>
</div>
<?php endif; ?>

<?php else : ?>
<div class="oo-card">
    <div class="oo-empty-state">
        <h3>No contacts yet</h3>
        <p>Use the Contact Finder to search for contacts automatically via Hunter.io and Icypeas, or add them manually.</p>
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-contacts&action=finder' ) ); ?>" class="oo-btn oo-btn-primary" style="margin-right:8px">Find New Contacts</a>
        <button class="oo-btn oo-btn-secondary" id="oo-add-contact-btn-empty">Add Manually</button>
    </div>
</div>
<?php endif; ?>

<!-- ══════════════════════════════════════════════════════════════════════
     MODAL: Edit / Add Contact
═══════════════════════════════════════════════════════════════════════ -->
<div id="oo-edit-modal" class="oo-modal-overlay" style="display:none">
    <div class="oo-modal oo-modal-wide">
        <div class="oo-modal-head">
            <h2 id="oo-edit-modal-title">Edit Contact</h2>
            <button class="oo-modal-close" id="oo-edit-modal-close">×</button>
        </div>
        <div class="oo-modal-tabs">
            <button class="oo-tab-btn active" data-tab="details">Details</button>
            <button class="oo-tab-btn" data-tab="activity">Activity</button>
        </div>
        <div id="oo-edit-tab-details" class="oo-tab-panel">
            <form id="oo-edit-form">
                <input type="hidden" id="oo-edit-contact-id" name="contact_id" value="">
                <div class="oo-form-grid" style="gap:12px 20px">
                    <div class="oo-field"><label class="oo-label">First Name</label><input type="text" name="first_name" id="oo-edit-first_name" class="oo-input"></div>
                    <div class="oo-field"><label class="oo-label">Last Name</label><input type="text" name="last_name" id="oo-edit-last_name" class="oo-input"></div>
                    <div class="oo-field"><label class="oo-label">Email *</label><input type="email" name="email" id="oo-edit-email" class="oo-input" required></div>
                    <div class="oo-field"><label class="oo-label">Company</label><input type="text" name="company" id="oo-edit-company" class="oo-input"></div>
                    <div class="oo-field"><label class="oo-label">Contact Type</label>
                        <select name="type" id="oo-edit-type" class="oo-select">
                            <option value="">— Select —</option>
                            <?php foreach ( $types as $val => $label ) : ?>
                            <option value="<?php echo esc_attr( $val ); ?>"><?php echo esc_html( $label ); ?></option>
                            <?php endforeach; ?>
                        </select>
                    </div>
                    <div class="oo-field"><label class="oo-label">Job Title</label><input type="text" name="title" id="oo-edit-title" class="oo-input"></div>
                    <div class="oo-field"><label class="oo-label">Website</label><input type="url" name="website" id="oo-edit-website" class="oo-input" placeholder="https://"></div>
                    <div class="oo-field"><label class="oo-label">Location</label><input type="text" name="location" id="oo-edit-location" class="oo-input"></div>
                    <div class="oo-field"><label class="oo-label">LinkedIn URL</label><input type="url" name="linkedin_url" id="oo-edit-linkedin_url" class="oo-input" placeholder="https://"></div>
                    <div class="oo-field"><label class="oo-label">Source</label><input type="text" name="source" id="oo-edit-source" class="oo-input"></div>
                    <div class="oo-field"><label class="oo-label">Status</label>
                        <select name="status" id="oo-edit-status" class="oo-select">
                            <option value="active">Active</option>
                            <option value="unsubscribed">Unsubscribed</option>
                            <option value="bounced">Bounced</option>
                            <option value="do_not_contact">Do Not Contact</option>
                        </select>
                    </div>
                    <div class="oo-field oo-field-full"><label class="oo-label">Notes</label><textarea name="notes" id="oo-edit-notes" class="oo-textarea" rows="3"></textarea></div>
                    <div class="oo-field oo-field-full">
                        <label class="oo-label">Tags</label>
                        <div class="oo-chip-list" id="oo-edit-tag-chips"></div>
                        <div style="display:flex;gap:6px;margin-top:6px">
                            <input type="text" id="oo-edit-tag-input" class="oo-input" placeholder="Add tag…" style="max-width:200px">
                            <button type="button" class="oo-btn oo-btn-secondary oo-btn-sm" id="oo-edit-tag-add-btn">Add</button>
                        </div>
                        <div class="oo-tag-suggest-row" id="oo-edit-tag-suggestions"></div>
                    </div>
                </div>
                <div style="display:flex;gap:8px;margin-top:16px;padding-top:16px;border-top:1px solid #e2e8f0">
                    <button type="submit" class="oo-btn oo-btn-primary" id="oo-edit-save-btn">Save</button>
                    <button type="button" class="oo-btn oo-btn-secondary" id="oo-edit-cancel-btn">Cancel</button>
                    <span id="oo-edit-status-msg" style="font-size:13px;align-self:center"></span>
                </div>
            </form>
        </div>
        <div id="oo-edit-tab-activity" class="oo-tab-panel" style="display:none">
            <div id="oo-activity-list" style="max-height:480px;overflow-y:auto"></div>
        </div>
    </div>
</div>

<!-- ══════════════════════════════════════════════════════════════════════
     MODAL: Import Wizard
═══════════════════════════════════════════════════════════════════════ -->
<div id="oo-import-modal" class="oo-modal-overlay" style="display:none">
    <div class="oo-modal oo-modal-wide">
        <div class="oo-modal-head">
            <h2>Import Contacts</h2>
            <button class="oo-modal-close" id="oo-import-modal-close">×</button>
        </div>
        <!-- Step indicators -->
        <div class="oo-import-steps">
            <div class="oo-import-step active" id="oo-istep-1">1 · Upload</div>
            <div class="oo-import-step-arrow">›</div>
            <div class="oo-import-step" id="oo-istep-2">2 · Map columns</div>
            <div class="oo-import-step-arrow">›</div>
            <div class="oo-import-step" id="oo-istep-3">3 · Confirm</div>
        </div>

        <!-- Step 1: file picker -->
        <div id="oo-import-panel-1" class="oo-import-panel">
            <div class="oo-dropzone" id="oo-dropzone">
                <div id="oo-dropzone-text">Drop a CSV here or <label for="oo-csv-file-input" style="color:var(--oo-accent);cursor:pointer;text-decoration:underline">browse</label></div>
                <input type="file" id="oo-csv-file-input" accept=".csv,text/csv" style="display:none">
                <div id="oo-dropzone-filename" class="oo-muted" style="margin-top:6px;font-size:12px"></div>
            </div>
            <p class="oo-muted" style="margin-top:12px;font-size:12px">Need a template? <a href="<?php echo esc_url( admin_url( 'admin-post.php?action=oo_export_contacts&template=1&_wpnonce=' . wp_create_nonce( 'oo_export_contacts' ) ) ); ?>">Download CSV template →</a></p>
            <div style="margin-top:16px"><button class="oo-btn oo-btn-primary" id="oo-import-next-1" disabled>Next →</button></div>
        </div>

        <!-- Step 2: column mapping + tag picker -->
        <div id="oo-import-panel-2" class="oo-import-panel" style="display:none">
            <div style="overflow-x:auto">
                <table class="oo-table oo-mapping-table" id="oo-mapping-table">
                    <thead><tr><th>CSV Column</th><th>Map to field</th><th>Preview (first 3 rows)</th></tr></thead>
                    <tbody id="oo-mapping-tbody"></tbody>
                </table>
            </div>
            <div style="margin-top:20px">
                <label class="oo-label">Apply tags to every imported row</label>
                <div class="oo-chip-list" id="oo-import-tag-chips"></div>
                <div style="display:flex;gap:6px;margin-top:6px">
                    <input type="text" id="oo-import-tag-input" class="oo-input" placeholder="Add tag…" style="max-width:200px">
                    <button type="button" class="oo-btn oo-btn-secondary oo-btn-sm" id="oo-import-tag-add-btn">Add</button>
                </div>
                <div class="oo-tag-suggest-row" id="oo-import-tag-suggestions"></div>
            </div>
            <div id="oo-mapping-error" class="oo-notice oo-notice-error" style="display:none;margin-top:12px"></div>
            <div style="margin-top:16px;display:flex;gap:8px">
                <button class="oo-btn oo-btn-secondary" id="oo-import-back-2">← Back</button>
                <button class="oo-btn oo-btn-primary" id="oo-import-next-2">Next →</button>
            </div>
        </div>

        <!-- Step 3: confirm + import -->
        <div id="oo-import-panel-3" class="oo-import-panel" style="display:none">
            <div id="oo-import-summary"></div>
            <div style="margin-top:16px;display:flex;gap:8px">
                <button class="oo-btn oo-btn-secondary" id="oo-import-back-3">← Back</button>
                <button class="oo-btn oo-btn-primary" id="oo-import-do-btn">Import</button>
                <span id="oo-import-progress" class="oo-muted" style="align-self:center;font-size:13px"></span>
            </div>
        </div>
    </div>
</div>

<!-- ══════════════════════════════════════════════════════════════════════
     MODAL: Bulk tag
═══════════════════════════════════════════════════════════════════════ -->
<div id="oo-bulk-tag-modal" class="oo-modal-overlay" style="display:none">
    <div class="oo-modal">
        <div class="oo-modal-head">
            <h2>Add Tags to Selected Contacts</h2>
            <button class="oo-modal-close" id="oo-bulk-tag-modal-close">×</button>
        </div>
        <div style="padding:20px">
            <div class="oo-chip-list" id="oo-bulk-tag-chips"></div>
            <div style="display:flex;gap:6px;margin-top:8px">
                <input type="text" id="oo-bulk-tag-input" class="oo-input" placeholder="Add tag…" style="max-width:200px">
                <button type="button" class="oo-btn oo-btn-secondary oo-btn-sm" id="oo-bulk-tag-add-btn">Add</button>
            </div>
            <div class="oo-tag-suggest-row" id="oo-bulk-tag-suggestions"></div>
            <div style="margin-top:16px;display:flex;gap:8px">
                <button class="oo-btn oo-btn-primary" id="oo-bulk-tag-apply-btn">Apply Tags</button>
                <button class="oo-btn oo-btn-secondary" id="oo-bulk-tag-cancel-btn">Cancel</button>
                <span id="oo-bulk-tag-status" class="oo-muted" style="align-self:center;font-size:13px"></span>
            </div>
        </div>
    </div>
</div>

<script>
window.ooContactsData = {
    nonce:         <?php echo wp_json_encode( wp_create_nonce( 'oo_nonce' ) ); ?>,
    ajaxUrl:       <?php echo wp_json_encode( admin_url( 'admin-ajax.php' ) ); ?>,
    workspaceTags: <?php echo wp_json_encode( $workspace_tags ); ?>,
    contactTypes:  <?php echo wp_json_encode( $types ); ?>
};
</script>
