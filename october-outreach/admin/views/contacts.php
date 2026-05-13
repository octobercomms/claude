<?php if ( ! defined( 'ABSPATH' ) ) exit;
global $wpdb;
$action     = $_GET['action'] ?? 'list';
$contact_id = intval( $_GET['id'] ?? 0 );
$contact    = null;
$types      = OO_Database::get_contact_types();

if ( in_array( $action, array( 'edit', 'new' ) ) && $contact_id ) {
    $contact = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}oo_contacts WHERE id = %d", $contact_id ) );
    if ( ! $contact ) $action = 'list';
}
?>

<?php if ( $action === 'new' || $action === 'edit' ) : ?>

<div class="oo-page-header">
    <h1 class="oo-page-title"><?php echo $action === 'new' ? 'Add Contact' : 'Edit Contact'; ?></h1>
    <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-contacts' ) ); ?>" class="oo-btn oo-btn-secondary">← Back</a>
</div>

<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
    <?php wp_nonce_field( 'oo_save_contact' ); ?>
    <input type="hidden" name="action" value="oo_save_contact">
    <input type="hidden" name="contact_id" value="<?php echo esc_attr( $contact_id ); ?>">

    <div class="oo-form-grid">
        <div class="oo-card">
            <h2 class="oo-card-title">Contact Details</h2>
            <div class="oo-field"><label class="oo-label">First Name</label><input type="text" name="first_name" class="oo-input" value="<?php echo esc_attr( $contact->first_name ?? '' ); ?>" required></div>
            <div class="oo-field"><label class="oo-label">Last Name</label><input type="text" name="last_name" class="oo-input" value="<?php echo esc_attr( $contact->last_name ?? '' ); ?>"></div>
            <div class="oo-field"><label class="oo-label">Email</label><input type="email" name="email" class="oo-input" value="<?php echo esc_attr( $contact->email ?? '' ); ?>" required></div>
            <div class="oo-field"><label class="oo-label">Company / Practice</label><input type="text" name="company" class="oo-input" value="<?php echo esc_attr( $contact->company ?? '' ); ?>"></div>
            <div class="oo-field">
                <label class="oo-label">Contact Type</label>
                <select name="type" class="oo-select">
                    <option value="">— Select —</option>
                    <?php foreach ( $types as $val => $label ) : ?>
                    <option value="<?php echo esc_attr( $val ); ?>" <?php selected( $contact->type ?? '', $val ); ?>><?php echo esc_html( $label ); ?></option>
                    <?php endforeach; ?>
                </select>
            </div>
        </div>
        <div class="oo-card">
            <h2 class="oo-card-title">More Info</h2>
            <div class="oo-field"><label class="oo-label">Location</label><input type="text" name="location" class="oo-input" value="<?php echo esc_attr( $contact->location ?? '' ); ?>" placeholder="e.g. London, UK"></div>
            <div class="oo-field"><label class="oo-label">LinkedIn URL</label><input type="url" name="linkedin_url" class="oo-input" value="<?php echo esc_attr( $contact->linkedin_url ?? '' ); ?>"></div>
            <div class="oo-field"><label class="oo-label">Source</label><input type="text" name="source" class="oo-input" value="<?php echo esc_attr( $contact->source ?? '' ); ?>" placeholder="Hunter.io, Manual, Import..."></div>
            <div class="oo-field">
                <label class="oo-label">Status</label>
                <select name="status" class="oo-select">
                    <?php foreach ( array( 'active' => 'Active', 'unsubscribed' => 'Unsubscribed', 'bounced' => 'Bounced', 'do_not_contact' => 'Do Not Contact' ) as $val => $lbl ) : ?>
                    <option value="<?php echo esc_attr( $val ); ?>" <?php selected( $contact->status ?? 'active', $val ); ?>><?php echo esc_html( $lbl ); ?></option>
                    <?php endforeach; ?>
                </select>
            </div>
            <div class="oo-field"><label class="oo-label">Notes</label><textarea name="notes" class="oo-textarea"><?php echo esc_textarea( $contact->notes ?? '' ); ?></textarea></div>
        </div>
    </div>

    <div class="oo-wizard-actions">
        <button type="submit" class="oo-btn oo-btn-primary oo-btn-lg">Save Contact</button>
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-contacts' ) ); ?>" class="oo-btn oo-btn-secondary oo-btn-lg">Cancel</a>
    </div>
</form>

<?php else : ?>

<div class="oo-page-header">
    <h1 class="oo-page-title">Contacts</h1>
    <div class="oo-page-actions" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-contacts&action=finder' ) ); ?>" class="oo-btn oo-btn-primary">+ Find New Contacts</a>
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-contacts&action=new' ) ); ?>" class="oo-btn oo-btn-secondary">+ Add Manually</a>
        <button class="oo-btn oo-btn-secondary" id="oo-import-toggle-btn">↑ Import CSV</button>
        <a href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=oo_export_contacts' ), 'oo_export_contacts' ) ); ?>" class="oo-btn oo-btn-secondary">↓ Export CSV</a>
        <?php if ( ! empty( get_option( 'oo_settings', [] )['airtable_api_key'] ) ) : ?>
        <button class="oo-btn oo-btn-secondary" id="oo-airtable-push-btn">Sync Airtable</button>
        <?php endif; ?>
    </div>
</div>

<?php if ( isset( $_GET['imported'] ) ) : ?>
<div class="oo-notice oo-notice-success"><?php echo intval( $_GET['imported'] ); ?> contacts imported<?php if ( isset( $_GET['skipped'] ) ) echo ', ' . intval( $_GET['skipped'] ) . ' skipped (duplicates or invalid email)'; ?>.</div>
<?php endif; ?>
<?php if ( isset( $_GET['import_error'] ) ) : ?>
<?php $import_errors = array( 'no_file' => 'No file uploaded.', 'unreadable' => 'Could not read file.', 'empty' => 'File appears empty.', 'no_email_column' => 'CSV must have an "email" column.' ); ?>
<div class="oo-notice oo-notice-error"><?php echo esc_html( $import_errors[ $_GET['import_error'] ] ?? 'Import failed.' ); ?></div>
<?php endif; ?>

<!-- CSV Import panel (hidden by default) -->
<div id="oo-import-panel" class="oo-card" style="display:none;margin-bottom:16px">
    <h2 class="oo-card-title">Import Contacts from CSV</h2>
    <p class="oo-muted" style="margin-bottom:12px">Upload a CSV file with your contacts. Duplicate emails are automatically skipped. <a href="<?php echo esc_url( admin_url( 'admin-post.php?action=oo_export_contacts&template=1&_wpnonce=' . wp_create_nonce( 'oo_export_contacts' ) ) ); ?>" id="oo-csv-template-link">Download template →</a></p>
    <p class="oo-muted" style="margin-bottom:14px;font-size:12px">Accepted columns: <code>first_name, last_name, email, company, type, title, location, linkedin_url, notes</code></p>
    <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" enctype="multipart/form-data">
        <?php wp_nonce_field( 'oo_import_contacts' ); ?>
        <input type="hidden" name="action" value="oo_import_contacts">
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
            <input type="file" name="csv_file" accept=".csv,text/csv" class="oo-input" style="max-width:320px" required>
            <button type="submit" class="oo-btn oo-btn-primary">Import</button>
        </div>
    </form>
</div>

<?php if ( isset( $_GET['saved'] ) ) : ?><div class="oo-notice oo-notice-success">Contact saved.</div><?php endif; ?>
<?php if ( isset( $_GET['deleted'] ) ) : ?><div class="oo-notice oo-notice-success"><?php echo intval($_GET['deleted']); ?> contact(s) deleted.</div><?php endif; ?>
<div id="oo-airtable-push-result" class="oo-notice" style="display:none"></div>

<?php
$type_filter     = sanitize_text_field( $_GET['type_filter']     ?? '' );
$verified_filter = sanitize_text_field( $_GET['verified_filter'] ?? '' );
$search = sanitize_text_field( $_GET['s'] ?? '' );
$where  = "WHERE 1=1";
if ( $type_filter )     $where .= $wpdb->prepare( " AND type = %s", $type_filter );
if ( $verified_filter ) $where .= $wpdb->prepare( " AND verified_status = %s", $verified_filter );
if ( $search ) {
    $like = '%' . $wpdb->esc_like( $search ) . '%';
    $where .= $wpdb->prepare( " AND (first_name LIKE %s OR last_name LIKE %s OR email LIKE %s OR company LIKE %s)", $like, $like, $like, $like );
}
$contacts = $wpdb->get_results( "SELECT * FROM {$wpdb->prefix}oo_contacts $where ORDER BY created_at DESC LIMIT 200" );
$total    = $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->prefix}oo_contacts $where" );
$dead_count = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->prefix}oo_contacts WHERE verified_status IN ('invalid','dead')" );
?>

<div id="oo-dead-result" class="oo-notice" style="display:none;margin-bottom:8px"></div>

<div class="oo-filters">
    <form method="get" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <input type="hidden" name="page" value="oo-contacts">
        <input type="search" name="s" class="oo-input" value="<?php echo esc_attr( $search ); ?>" placeholder="Search contacts..." style="width:220px">
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
        <span class="oo-count"><?php echo intval( $total ); ?> contacts</span>
    </form>
    <?php if ( $dead_count > 0 ) : ?>
    <div style="margin-top:8px">
        <button class="oo-btn oo-btn-secondary" id="oo-delete-dead-btn" style="color:#c0392b;border-color:#c0392b">
            Delete <?php echo $dead_count; ?> Dead / Invalid Emails
        </button>
    </div>
    <?php endif; ?>
</div>

<?php if ( $contacts ) : ?>
<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" id="oo-bulk-form">
    <?php wp_nonce_field( 'oo_bulk_delete_contacts' ); ?>
    <input type="hidden" name="action" value="oo_bulk_delete_contacts">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <button type="submit" class="oo-btn oo-btn-secondary" onclick="return confirm('Delete all selected contacts? This cannot be undone.')">Delete Selected</button>
        <span class="oo-muted" id="oo-selected-count" style="font-size:13px"></span>
    </div>
    <div class="oo-table-wrap">
        <table class="oo-table">
            <thead><tr>
                <th style="width:36px"><input type="checkbox" id="oo-select-all" title="Select all"></th>
                <th>Name</th><th>Email</th><th>Company</th><th>Type</th><th>Location</th><th>Status</th><th>Verified</th><th>Added</th><th>Actions</th>
            </tr></thead>
            <tbody>
            <?php
            $verified_badge = array(
                'valid'      => array( 'green',  'Valid' ),
                'risky'      => array( 'orange', 'Risky' ),
                'invalid'    => array( 'red',    'Invalid' ),
                'dead'       => array( 'grey',   'Dead' ),
                'unverified' => array( 'grey',   '—' ),
            );
            foreach ( $contacts as $c ) :
                $vs     = $c->verified_status ?? 'unverified';
                $vb     = $verified_badge[ $vs ] ?? array( 'grey', $vs );
            ?>
            <tr>
                <td><input type="checkbox" name="contact_ids[]" value="<?php echo esc_attr( $c->id ); ?>" class="oo-row-cb"></td>
                <td><strong><?php echo esc_html( trim( $c->first_name . ' ' . $c->last_name ) ?: '—' ); ?></strong></td>
                <td><?php echo esc_html( $c->email ); ?></td>
                <td><?php echo esc_html( $c->company ?: '—' ); ?></td>
                <td><?php echo esc_html( $types[ $c->type ] ?? $c->type ); ?></td>
                <td class="oo-muted"><?php echo esc_html( $c->location ?: '—' ); ?></td>
                <td><span class="oo-badge oo-badge-<?php echo $c->status === 'active' ? 'green' : 'grey'; ?>"><?php echo esc_html( ucfirst( str_replace( '_', ' ', $c->status ) ) ); ?></span></td>
                <td><span class="oo-badge oo-badge-<?php echo esc_attr( $vb[0] ); ?>"><?php echo esc_html( $vb[1] ); ?></span></td>
                <td class="oo-muted"><?php echo esc_html( date( 'd M Y', strtotime( $c->created_at ) ) ); ?></td>
                <td>
                    <div class="oo-row-actions">
                        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-contacts&action=edit&id=' . $c->id ) ); ?>">Edit</a>
                        <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" onsubmit="return confirm('Delete this contact?')">
                            <?php wp_nonce_field( 'oo_delete_contact' ); ?>
                            <input type="hidden" name="action" value="oo_delete_contact">
                            <input type="hidden" name="contact_id" value="<?php echo esc_attr( $c->id ); ?>">
                            <button type="submit" class="oo-delete-btn">Delete</button>
                        </form>
                    </div>
                </td>
            </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    </div>
</form>
<script>
(function(){
    var all = document.getElementById('oo-select-all');
    var cbs = document.querySelectorAll('.oo-row-cb');
    var count = document.getElementById('oo-selected-count');
    function updateCount(){
        var n = document.querySelectorAll('.oo-row-cb:checked').length;
        count.textContent = n ? n + ' selected' : '';
    }
    all.addEventListener('change', function(){ cbs.forEach(function(cb){ cb.checked = all.checked; }); updateCount(); });
    cbs.forEach(function(cb){ cb.addEventListener('change', function(){ all.checked = Array.from(cbs).every(function(c){ return c.checked; }); updateCount(); }); });
})();
</script>
<?php else : ?>
<div class="oo-card">
    <div class="oo-empty-state">
        <h3>No contacts yet</h3>
        <p>Use the Contact Finder to search for contacts automatically via Hunter.io and Icypeas, or add them manually.</p>
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-contacts&action=finder' ) ); ?>" class="oo-btn oo-btn-primary" style="margin-right:8px">Find New Contacts</a>
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-contacts&action=new' ) ); ?>" class="oo-btn oo-btn-secondary">Add Manually</a>
    </div>
</div>
<?php endif; ?>

<script>
(function(){
    var importBtn = document.getElementById('oo-import-toggle-btn');
    var importPanel = document.getElementById('oo-import-panel');
    if (importBtn && importPanel) {
        importBtn.addEventListener('click', function() {
            var visible = importPanel.style.display !== 'none';
            importPanel.style.display = visible ? 'none' : 'block';
            importBtn.textContent = visible ? '↑ Import CSV' : '✕ Close Import';
        });
        <?php if ( isset( $_GET['import_error'] ) ) : ?>
        importPanel.style.display = 'block';
        importBtn.textContent = '✕ Close Import';
        <?php endif; ?>
    }
})();
(function(){
    var btn = document.getElementById('oo-airtable-push-btn');
    if (!btn) return;
    btn.addEventListener('click', function() {
        btn.disabled = true;
        btn.textContent = 'Syncing…';
        var result = document.getElementById('oo-airtable-push-result');
        fetch(window.ajaxurl || '/wp-admin/admin-ajax.php', {
            method: 'POST',
            headers: {'Content-Type':'application/x-www-form-urlencoded'},
            body: 'action=oo_airtable_push_all&nonce=' + encodeURIComponent(ooData.nonce)
        }).then(function(r){ return r.json(); }).then(function(res){
            btn.disabled = false;
            btn.textContent = 'Sync Airtable';
            result.className = 'oo-notice ' + (res.success ? 'oo-notice-success' : 'oo-notice-error');
            result.textContent = res.success ? (res.data.pushed + ' contacts synced to Airtable.') : (res.data || 'Sync failed');
            result.style.display = 'block';
        }).catch(function(){
            btn.disabled = false; btn.textContent = 'Sync Airtable';
            result.className = 'oo-notice oo-notice-error';
            result.textContent = 'Request failed.';
            result.style.display = 'block';
        });
    });
})();
(function(){
    var btn = document.getElementById('oo-delete-dead-btn');
    if (!btn) return;
    btn.addEventListener('click', function() {
        if (!confirm('Permanently delete all invalid and dead email contacts? This cannot be undone.')) return;
        btn.disabled = true;
        btn.textContent = 'Deleting…';
        var result = document.getElementById('oo-dead-result');
        fetch(window.ajaxurl || '/wp-admin/admin-ajax.php', {
            method: 'POST',
            headers: {'Content-Type':'application/x-www-form-urlencoded'},
            body: 'action=oo_bulk_delete_dead&nonce=' + encodeURIComponent(ooData.nonce)
        }).then(function(r){ return r.json(); }).then(function(res){
            if (res.success) {
                result.className = 'oo-notice oo-notice-success';
                result.textContent = res.data.deleted + ' dead / invalid contacts deleted.';
                result.style.display = 'block';
                btn.parentNode.style.display = 'none';
                setTimeout(function(){ location.reload(); }, 1500);
            } else {
                btn.disabled = false;
                btn.textContent = 'Delete Dead / Invalid Emails';
                result.className = 'oo-notice oo-notice-error';
                result.textContent = res.data || 'Delete failed.';
                result.style.display = 'block';
            }
        }).catch(function(){
            btn.disabled = false;
            btn.textContent = 'Delete Dead / Invalid Emails';
        });
    });
})();
</script>

<?php endif; ?>
