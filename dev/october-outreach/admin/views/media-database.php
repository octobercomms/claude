<?php if ( ! defined( 'ABSPATH' ) ) exit;

global $wpdb;
$out_t = $wpdb->prefix . 'oo_outlets';
$log_t = $wpdb->prefix . 'oo_editorial_log';
$con_t = $wpdb->prefix . 'oo_contacts';

// ── Outlet profile ─────────────────────────────────────────────────────
if ( ( $_GET['action'] ?? '' ) === 'view' && intval( $_GET['id'] ?? 0 ) ) {
    $oid = intval( $_GET['id'] );
    $o   = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$out_t} WHERE id = %d", $oid ) );
    if ( ! $o ) { echo '<div class="oo-notice oo-notice-warning">Publication not found.</div>'; return; }

    $coverage = $wpdb->get_results( $wpdb->prepare(
        "SELECT l.client, l.story_title, l.status, l.issue_date, l.story_url,
                TRIM(CONCAT(c.first_name,' ',c.last_name)) AS journalist
         FROM {$log_t} l LEFT JOIN {$con_t} c ON c.id = l.contact_id
         WHERE l.outlet_id = %d ORDER BY COALESCE(l.issue_date,l.request_date) DESC LIMIT 200", $oid
    ) );
    $journos = $wpdb->get_results( $wpdb->prepare(
        "SELECT id, TRIM(CONCAT(first_name,' ',last_name)) AS name FROM {$con_t} WHERE outlet_id = %d AND segment='media' ORDER BY last_name ASC LIMIT 100", $oid
    ) );
    $pub_count = 0; foreach ( $coverage as $cv ) { if ( in_array( $cv->status, array( 'published', 'download' ), true ) ) $pub_count++; }
    $stat = OO_Database::get_editorial_statuses();
    ?>
    <div class="oo-page-header">
        <h1 class="oo-page-title"><?php echo esc_html( $o->name ); ?></h1>
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-media' ) ); ?>" class="oo-btn oo-btn-secondary">← Media Database</a>
    </div>
    <?php if ( isset( $_GET['saved'] ) ) : ?><div class="oo-notice oo-notice-success">Saved.</div><?php endif; ?>
    <div id="oo-prof-notice" class="oo-notice" style="display:none"></div>

    <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" id="oo-outlet-meta" data-id="<?php echo esc_attr( $o->id ); ?>">
        <?php wp_nonce_field( 'oo_save_outlet_meta' ); ?>
        <input type="hidden" name="action" value="oo_save_outlet_meta">
        <input type="hidden" name="outlet_id" value="<?php echo esc_attr( $o->id ); ?>">
        <div class="oo-settings-grid" style="margin-bottom:18px">
            <div class="oo-card">
                <h2 class="oo-card-title">About
                    <button type="button" class="oo-btn oo-btn-secondary oo-btn-sm" id="oo-gen-summary" style="float:right">
                        <span class="oo-btn-text">✨ Generate</span><span class="oo-btn-loading" style="display:none">…</span>
                    </button>
                </h2>
                <div class="oo-field">
                    <textarea name="summary" id="oo-outlet-summary" class="oo-textarea" rows="3" placeholder="Who they are — Claude can draft this from your coverage."><?php echo esc_textarea( $o->summary ?? '' ); ?></textarea>
                </div>
                <div class="oo-field" style="display:flex;gap:10px">
                    <div style="flex:1"><label class="oo-label">Tier</label><input type="text" name="tier" class="oo-input" value="<?php echo esc_attr( $o->tier ); ?>" placeholder="e.g. National, Trade"></div>
                    <div style="flex:1"><label class="oo-label">Region</label><input type="text" name="region" class="oo-input" value="<?php echo esc_attr( $o->region ); ?>" placeholder="e.g. UK"></div>
                </div>
                <div class="oo-field"><label class="oo-label">Notes</label><textarea name="notes" class="oo-textarea" rows="2"><?php echo esc_textarea( $o->notes ?? '' ); ?></textarea></div>
                <button type="submit" class="oo-btn oo-btn-primary">Save</button>
            </div>
            <div class="oo-card">
                <h2 class="oo-card-title">At a glance</h2>
                <p style="margin:4px 0"><strong><?php echo (int) $pub_count; ?></strong> published · <strong><?php echo count( $coverage ); ?></strong> tracked</p>
                <p style="margin:4px 0" class="oo-muted">Domain: <?php echo esc_html( $o->domain ?: '—' ); ?> · <?php echo $o->status === 'do_not_use' ? '<span class="oo-badge oo-badge-grey">Do not use</span>' : 'Active'; ?></p>
                <?php if ( $journos ) : ?>
                <p style="margin:10px 0 4px"><strong>Journalists here</strong></p>
                <div style="display:flex;flex-wrap:wrap;gap:6px">
                    <?php foreach ( $journos as $j ) : ?>
                    <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-journalists&action=view&id=' . $j->id ) ); ?>" class="oo-badge oo-badge-blue" style="text-decoration:none"><?php echo esc_html( $j->name ); ?></a>
                    <?php endforeach; ?>
                </div>
                <?php endif; ?>
            </div>
        </div>
    </form>

    <h2 class="oo-card-title" style="margin-bottom:10px">Coverage with <?php echo esc_html( $o->name ); ?> (<?php echo count( $coverage ); ?>)</h2>
    <?php if ( $coverage ) : ?>
    <div class="oo-table-wrap"><table class="oo-table">
        <thead><tr><th>Client</th><th>Journalist</th><th>Status</th><th>Date</th><th>Story</th></tr></thead>
        <tbody>
        <?php foreach ( $coverage as $cv ) : ?>
        <tr>
            <td><?php echo esc_html( $cv->client ?: '—' ); ?></td>
            <td class="oo-muted"><?php echo esc_html( $cv->journalist ?: '—' ); ?></td>
            <td><span class="oo-badge oo-badge-<?php echo $cv->status === 'published' ? 'green' : 'grey'; ?>"><?php echo esc_html( $stat[ $cv->status ] ?? $cv->status ); ?></span></td>
            <td class="oo-muted"><?php echo $cv->issue_date ? esc_html( date( 'd M Y', strtotime( $cv->issue_date ) ) ) : '—'; ?></td>
            <td><?php echo $cv->story_url ? '<a href="' . esc_url( $cv->story_url ) . '" target="_blank" rel="noopener">' . esc_html( wp_trim_words( $cv->story_title ?: 'View', 7 ) ) . '</a>' : esc_html( wp_trim_words( $cv->story_title ?: '—', 7 ) ); ?></td>
        </tr>
        <?php endforeach; ?>
        </tbody>
    </table></div>
    <?php else : ?><div class="oo-card"><p class="oo-muted">No coverage logged with this publication yet.</p></div><?php endif; ?>
    <?php
    return;
}

$total_live = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$out_t} WHERE status != 'merged'" );
$total_dnu  = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$out_t} WHERE status = 'do_not_use'" );
$total_merged = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$out_t} WHERE status = 'merged'" );

$search = sanitize_text_field( $_GET['s'] ?? '' );
$where  = "WHERE o.status != 'merged'";
$args   = array();
if ( $search ) {
    $where .= " AND o.name LIKE %s";
    $args[] = '%' . $wpdb->esc_like( $search ) . '%';
}

$sql = "SELECT o.id, o.name, o.domain, o.status,
               ( SELECT COUNT(*) FROM {$log_t} l WHERE l.outlet_id = o.id ) AS coverage
        FROM {$out_t} o
        {$where}
        ORDER BY coverage DESC, o.name ASC
        LIMIT 300";
$outlets = $args ? $wpdb->get_results( $wpdb->prepare( $sql, $args ) ) : $wpdb->get_results( $sql );
?>

<div class="oo-page-header">
    <h1 class="oo-page-title">Media Database</h1>
    <div class="oo-page-actions" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button type="button" class="oo-btn oo-btn-secondary" onclick="var e=document.getElementById('oo-master-import');e.style.display=e.style.display==='none'?'block':'none'">↑ Import Master Lists</button>
        <button class="oo-btn oo-btn-primary" id="oo-dedup-scan">
            <span class="oo-btn-text">🔍 Find Duplicate Publications</span>
            <span class="oo-btn-loading" style="display:none">Scanning…</span>
        </button>
    </div>
</div>

<div id="oo-media-notice" class="oo-notice" style="display:none"></div>

<?php if ( isset( $_GET['pub_imported'] ) ) : ?><div class="oo-notice oo-notice-success"><?php echo intval( $_GET['pub_imported'] ); ?> publications imported (duplicates auto-folded).</div><?php endif; ?>
<?php if ( isset( $_GET['con_imported'] ) ) : ?><div class="oo-notice oo-notice-success"><?php echo intval( $_GET['con_imported'] ); ?> press contacts imported / enriched.</div><?php endif; ?>
<?php if ( isset( $_GET['import_error'] ) ) : ?><div class="oo-notice oo-notice-warning">Import failed: <?php echo esc_html( $_GET['import_error'] ); ?>.</div><?php endif; ?>

<div class="oo-card" id="oo-master-import" style="display:none;margin-bottom:16px">
    <h2 class="oo-card-title">Import Master Lists</h2>
    <p class="oo-muted" style="margin-bottom:14px">Import your Notion master databases. Names are matched against existing records (alias-aware), so re-importing won't create duplicates. Run "Find Duplicate Publications" afterwards to clean any remaining variants.</p>
    <div class="oo-settings-grid">
        <div class="oo-field" style="margin:0">
            <label class="oo-label">Master Publications CSV</label>
            <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" enctype="multipart/form-data" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <?php wp_nonce_field( 'oo_import_publications' ); ?>
                <input type="hidden" name="action" value="oo_import_publications">
                <input type="file" name="csv_file" accept=".csv" required>
                <button type="submit" class="oo-btn oo-btn-primary oo-btn-sm">Import Publications</button>
            </form>
            <p class="oo-hint">Single column: <code>Publication Name</code>.</p>
        </div>
        <div class="oo-field" style="margin:0">
            <label class="oo-label">Master Press Contacts CSV</label>
            <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" enctype="multipart/form-data" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <?php wp_nonce_field( 'oo_import_press_contacts' ); ?>
                <input type="hidden" name="action" value="oo_import_press_contacts">
                <input type="file" name="csv_file" accept=".csv" required>
                <button type="submit" class="oo-btn oo-btn-primary oo-btn-sm">Import Contacts</button>
            </form>
            <p class="oo-hint"><code>Name, Bio Link, Email, Last Contacted, Location, Publication</code>.</p>
        </div>
    </div>
</div>

<p class="oo-muted" style="margin-bottom:16px">
    <strong><?php echo number_format( $total_live ); ?></strong> publications
    <?php if ( $total_dnu ) : ?>· <?php echo number_format( $total_dnu ); ?> flagged "do not use"<?php endif; ?>
    <?php if ( $total_merged ) : ?>· <?php echo number_format( $total_merged ); ?> merged away<?php endif; ?>
</p>

<!-- Dedup results render here -->
<div id="oo-dedup-results" style="display:none;margin-bottom:24px"></div>

<form method="get" style="display:flex;gap:10px;align-items:flex-end;margin-bottom:14px">
    <input type="hidden" name="page" value="oo-media">
    <div class="oo-field" style="margin:0">
        <label class="oo-label">Search publications</label>
        <input type="text" name="s" class="oo-input" style="width:240px" value="<?php echo esc_attr( $search ); ?>" placeholder="e.g. Dezeen">
    </div>
    <button class="oo-btn oo-btn-secondary">Search</button>
</form>

<?php if ( $outlets ) : ?>
<div class="oo-table-wrap">
    <table class="oo-table">
        <thead><tr><th>Publication</th><th>Domain</th><th>Status</th><th>Coverage</th></tr></thead>
        <tbody>
        <?php foreach ( $outlets as $o ) : ?>
        <tr>
            <td><strong><a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-media&action=view&id=' . $o->id ) ); ?>"><?php echo esc_html( $o->name ); ?></a></strong></td>
            <td class="oo-muted"><?php echo esc_html( $o->domain ?: '—' ); ?></td>
            <td><?php echo $o->status === 'do_not_use'
                ? '<span class="oo-badge oo-badge-grey">Do not use</span>'
                : '<span class="oo-badge oo-badge-green">Active</span>'; ?></td>
            <td><?php echo (int) $o->coverage; ?></td>
        </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
</div>
<p class="oo-hint" style="margin-top:8px">Showing up to 300 publications by coverage volume.</p>
<?php else : ?>
<div class="oo-card">
    <div class="oo-empty-state">
        <h3>No publications yet</h3>
        <p>Import your editorial log (PR → Editorial Log → Import CSV) and publications will appear here.</p>
    </div>
</div>
<?php endif; ?>
