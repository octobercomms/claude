<?php if ( ! defined( 'ABSPATH' ) ) exit;

global $wpdb;
$statuses = OO_Database::get_editorial_statuses();
$action   = $_GET['action'] ?? 'list';
$entry_id = intval( $_GET['id'] ?? 0 );
$entry    = null;

$log_t    = $wpdb->prefix . 'oo_editorial_log';
$out_t    = $wpdb->prefix . 'oo_outlets';
$con_t    = $wpdb->prefix . 'oo_contacts';

if ( $action === 'edit' && $entry_id ) {
    $entry = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$log_t} WHERE id = %d", $entry_id ) );
    if ( ! $entry ) $action = 'list';
}

// Status badge colour
$badge = function( $status ) {
    $map = array(
        'published' => 'green', 'confirmed' => 'blue', 'pitched' => 'grey',
        'pending' => 'grey', 'no_response' => 'grey', 'interview_prep' => 'blue',
        'download' => 'blue', 'declined' => 'grey', 'new' => 'blue',
    );
    return $map[ $status ] ?? 'grey';
};

// Pre-fill names for edit form
$entry_contact = '';
$entry_outlet  = '';
if ( $entry ) {
    if ( $entry->contact_id ) {
        $c = $wpdb->get_row( $wpdb->prepare( "SELECT first_name, last_name FROM {$con_t} WHERE id = %d", $entry->contact_id ) );
        if ( $c ) $entry_contact = trim( $c->first_name . ' ' . $c->last_name );
    }
    if ( $entry->outlet_id ) {
        $entry_outlet = (string) $wpdb->get_var( $wpdb->prepare( "SELECT name FROM {$out_t} WHERE id = %d", $entry->outlet_id ) );
    }
}
?>

<?php if ( $action === 'new' || $action === 'edit' ) : ?>

<div class="oo-page-header">
    <h1 class="oo-page-title"><?php echo $action === 'new' ? 'New Log Entry' : 'Edit Log Entry'; ?></h1>
    <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-pr' ) ); ?>" class="oo-btn oo-btn-secondary">← Back to Log</a>
</div>

<div class="oo-card" id="oo-log-autofill" style="margin-bottom:16px;background:#f8f9ff;border:1px solid #e0e3ff">
    <h2 class="oo-card-title">⚡ Quick add from a link</h2>
    <p class="oo-muted" style="margin-bottom:10px">Paste a story URL and Claude will read the page and fill in the publication, journalist, title, date and sentiment below.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input type="url" id="oo-autofill-url" class="oo-input" style="flex:1;min-width:240px" placeholder="https://www.dezeen.com/2026/…">
        <button type="button" class="oo-btn oo-btn-primary" id="oo-autofill-btn">
            <span class="oo-btn-text">Auto-fill ↓</span>
            <span class="oo-btn-loading" style="display:none">Reading…</span>
        </button>
    </div>
    <p id="oo-autofill-msg" class="oo-muted" style="font-size:13px;margin-top:8px;display:none"></p>
</div>

<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
    <?php wp_nonce_field( 'oo_save_editorial_entry' ); ?>
    <input type="hidden" name="action" value="oo_save_editorial_entry">
    <input type="hidden" name="entry_id" value="<?php echo esc_attr( $entry_id ); ?>">
    <datalist id="oo-publication-list"></datalist>
    <datalist id="oo-contact-list"></datalist>

    <div class="oo-settings-grid">
        <div class="oo-card">
            <h2 class="oo-card-title">Story</h2>
            <div class="oo-field">
                <label class="oo-label">Client</label>
                <input type="text" name="client" class="oo-input" value="<?php echo esc_attr( $entry->client ?? '' ); ?>" placeholder="e.g. Forgeworks">
            </div>
            <div class="oo-field">
                <label class="oo-label">Story Title</label>
                <input type="text" id="oo-f-story_title" name="story_title" class="oo-input" value="<?php echo esc_attr( $entry->story_title ?? '' ); ?>" placeholder="e.g. House of Wood Shingle">
            </div>
            <div class="oo-field">
                <label class="oo-label">Press Contact</label>
                <input type="text" id="oo-f-press_contact" name="press_contact" class="oo-input" list="oo-contact-list" autocomplete="off" value="<?php echo esc_attr( $entry_contact ); ?>" placeholder="Journalist name">
                <p class="oo-hint">Matched to your media database by name (created if new).</p>
            </div>
            <div class="oo-field">
                <label class="oo-label">Publication</label>
                <input type="text" id="oo-f-publication" name="publication" class="oo-input" list="oo-publication-list" autocomplete="off" value="<?php echo esc_attr( $entry_outlet ); ?>" placeholder="Publication name">
                <p class="oo-hint">Start typing — existing publications (and their aliases) are suggested to avoid duplicates.</p>
            </div>
            <div class="oo-field">
                <label class="oo-label">Country</label>
                <input type="text" id="oo-f-country" name="country" class="oo-input" value="<?php echo esc_attr( $entry->country ?? '' ); ?>" placeholder="e.g. UK">
            </div>
        </div>

        <div class="oo-card">
            <h2 class="oo-card-title">Status &amp; Dates</h2>
            <div class="oo-field">
                <label class="oo-label">Status</label>
                <select name="status" class="oo-select">
                    <?php foreach ( $statuses as $val => $label ) : ?>
                    <option value="<?php echo esc_attr( $val ); ?>" <?php selected( $entry->status ?? 'pitched', $val ); ?>><?php echo esc_html( $label ); ?></option>
                    <?php endforeach; ?>
                </select>
            </div>
            <div class="oo-field">
                <label class="oo-label">Request Date</label>
                <input type="date" name="request_date" class="oo-input" value="<?php echo esc_attr( $entry->request_date ?? '' ); ?>">
            </div>
            <div class="oo-field">
                <label class="oo-label">Interview Date</label>
                <input type="date" name="interview_date" class="oo-input" value="<?php echo esc_attr( $entry->interview_date ?? '' ); ?>">
            </div>
            <div class="oo-field">
                <label class="oo-label">Issue Date</label>
                <input type="date" id="oo-f-issue_date" name="issue_date" class="oo-input" value="<?php echo esc_attr( $entry->issue_date ?? '' ); ?>">
            </div>
            <div class="oo-field">
                <label class="oo-label">Link to Story</label>
                <input type="url" id="oo-f-story_url" name="story_url" class="oo-input" value="<?php echo esc_attr( $entry->story_url ?? '' ); ?>" placeholder="https://...">
            </div>
        </div>

        <div class="oo-card" style="grid-column:1/-1">
            <h2 class="oo-card-title">Pitch &amp; Notes</h2>
            <div class="oo-field">
                <label class="oo-label">Pitch / Request</label>
                <textarea name="pitch_request" class="oo-textarea" rows="2"><?php echo esc_textarea( $entry->pitch_request ?? '' ); ?></textarea>
            </div>
            <div class="oo-field">
                <label class="oo-label">Notes / Outcome <span class="oo-muted" style="font-weight:400">(internal — never shown to clients)</span></label>
                <textarea name="notes_outcome" class="oo-textarea" rows="3"><?php echo esc_textarea( $entry->notes_outcome ?? '' ); ?></textarea>
            </div>
        </div>
    </div>

    <div class="oo-wizard-actions" style="padding-top:0">
        <button type="submit" class="oo-btn oo-btn-primary oo-btn-lg">Save Entry</button>
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-pr' ) ); ?>" class="oo-btn oo-btn-secondary oo-btn-lg">Cancel</a>
    </div>
</form>

<?php return; endif; ?>

<?php
// ── List view ──────────────────────────────────────────────────────────
$client_filter = sanitize_text_field( $_GET['client_filter'] ?? '' );
$status_filter = sanitize_text_field( $_GET['status_filter'] ?? '' );
$search        = sanitize_text_field( $_GET['s'] ?? '' );

$where = "WHERE 1=1";
$args  = array();
if ( $client_filter ) { $where .= " AND l.client = %s"; $args[] = $client_filter; }
if ( $status_filter && isset( $statuses[ $status_filter ] ) ) {
    $where .= " AND l.status = %s";
    $args[] = $status_filter;
} else {
    // Hide auto-found (unconfirmed) and dismissed rows by default — those live
    // in the Coverage Monitor review queue, not the main log.
    $where .= " AND l.status NOT IN ('new','dismissed')";
}
if ( $search ) {
    $like = '%' . $wpdb->esc_like( $search ) . '%';
    $where .= " AND (l.story_title LIKE %s OR l.pitch_request LIKE %s)";
    array_push( $args, $like, $like );
}

$count_sql = "SELECT COUNT(*) FROM {$log_t} l {$where}";
$total     = (int) ( $args ? $wpdb->get_var( $wpdb->prepare( $count_sql, $args ) ) : $wpdb->get_var( $count_sql ) );

$per_page = 100;
$paged    = max( 1, intval( $_GET['paged'] ?? 1 ) );
$offset   = ( $paged - 1 ) * $per_page;
$pages    = (int) ceil( $total / $per_page );

$sql = "SELECT l.*, o.name AS outlet_name, c.first_name, c.last_name
        FROM {$log_t} l
        LEFT JOIN {$out_t} o ON o.id = l.outlet_id
        LEFT JOIN {$con_t} c ON c.id = l.contact_id
        {$where}
        ORDER BY COALESCE(l.issue_date, l.request_date) DESC, l.id DESC
        LIMIT %d OFFSET %d";
$rows = $wpdb->get_results( $wpdb->prepare( $sql, array_merge( $args, array( $per_page, $offset ) ) ) );

$clients = $wpdb->get_col( "SELECT DISTINCT client FROM {$log_t} WHERE client != '' ORDER BY client ASC" );
?>

<div class="oo-page-header">
    <h1 class="oo-page-title">Editorial Log</h1>
    <div class="oo-page-actions" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-pr&action=new' ) ); ?>" class="oo-btn oo-btn-primary">+ New Entry</a>
        <button type="button" class="oo-btn oo-btn-secondary" onclick="document.getElementById('oo-el-import').style.display = document.getElementById('oo-el-import').style.display === 'none' ? 'block' : 'none'">↑ Import CSV</button>
    </div>
</div>

<?php if ( isset( $_GET['saved'] ) ) : ?><div class="oo-notice oo-notice-success">Entry saved.</div><?php endif; ?>
<?php if ( isset( $_GET['deleted'] ) ) : ?><div class="oo-notice oo-notice-success">Entry deleted.</div><?php endif; ?>
<?php if ( isset( $_GET['imported'] ) ) : ?><div class="oo-notice oo-notice-success"><?php echo intval( $_GET['imported'] ); ?> rows imported into the log.</div><?php endif; ?>
<?php if ( isset( $_GET['import_error'] ) ) : ?><div class="oo-notice oo-notice-warning">Import failed: <?php echo esc_html( $_GET['import_error'] ); ?>.</div><?php endif; ?>

<div class="oo-card" id="oo-el-import" style="display:none;margin-bottom:16px">
    <h2 class="oo-card-title">Import Editorial Log CSV</h2>
    <p class="oo-muted" style="margin-bottom:12px">Upload the Notion export (<code>Story Title, Client, Country, Interview Date, Issue Date, Link to story, Notes / Outcome, Pitch / Request, Press Contact, Publication name, Request Date, Status</code>). Press contacts and publications are matched/created automatically.</p>
    <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" enctype="multipart/form-data" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <?php wp_nonce_field( 'oo_import_editorial_log' ); ?>
        <input type="hidden" name="action" value="oo_import_editorial_log">
        <input type="file" name="csv_file" accept=".csv" required>
        <button type="submit" class="oo-btn oo-btn-primary">Import</button>
    </form>
</div>

<form method="get" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px">
    <input type="hidden" name="page" value="oo-pr">
    <div class="oo-field" style="margin:0">
        <label class="oo-label">Client</label>
        <select name="client_filter" class="oo-select" style="width:180px">
            <option value="">All Clients</option>
            <?php foreach ( $clients as $cl ) : ?>
            <option value="<?php echo esc_attr( $cl ); ?>" <?php selected( $client_filter, $cl ); ?>><?php echo esc_html( $cl ); ?></option>
            <?php endforeach; ?>
        </select>
    </div>
    <div class="oo-field" style="margin:0">
        <label class="oo-label">Status</label>
        <select name="status_filter" class="oo-select" style="width:160px">
            <option value="">Any Status</option>
            <?php foreach ( $statuses as $val => $label ) : ?>
            <option value="<?php echo esc_attr( $val ); ?>" <?php selected( $status_filter, $val ); ?>><?php echo esc_html( $label ); ?></option>
            <?php endforeach; ?>
        </select>
    </div>
    <div class="oo-field" style="margin:0">
        <label class="oo-label">Search</label>
        <input type="text" name="s" class="oo-input" style="width:200px" value="<?php echo esc_attr( $search ); ?>" placeholder="Story or pitch…">
    </div>
    <button class="oo-btn oo-btn-secondary">Filter</button>
    <span class="oo-muted" style="align-self:center;font-size:13px"><?php echo number_format( $total ); ?> entries</span>
</form>

<?php if ( $rows ) : ?>
<div class="oo-table-wrap">
    <table class="oo-table">
        <thead><tr>
            <th>Client</th><th>Press Contact</th><th>Publication</th><th>Country</th><th>Status</th><th>Issue Date</th><th>Story</th><th>Actions</th>
        </tr></thead>
        <tbody>
        <?php foreach ( $rows as $r ) :
            $contact_name = trim( ( $r->first_name ?? '' ) . ' ' . ( $r->last_name ?? '' ) );
        ?>
        <tr>
            <td><?php echo $r->client ? '<span class="oo-badge oo-badge-grey">' . esc_html( $r->client ) . '</span>' : '<span class="oo-muted">—</span>'; ?></td>
            <td><?php echo $contact_name ? esc_html( $contact_name ) : '<span class="oo-muted">—</span>'; ?></td>
            <td><?php echo $r->outlet_name ? esc_html( $r->outlet_name ) : '<span class="oo-muted">—</span>'; ?></td>
            <td class="oo-muted"><?php echo esc_html( $r->country ?: '—' ); ?></td>
            <td><span class="oo-badge oo-badge-<?php echo esc_attr( $badge( $r->status ) ); ?>"><?php echo esc_html( $statuses[ $r->status ] ?? ucfirst( $r->status ) ); ?></span></td>
            <td class="oo-muted"><?php echo $r->issue_date ? esc_html( date( 'd M Y', strtotime( $r->issue_date ) ) ) : '—'; ?></td>
            <td>
                <?php if ( $r->story_url ) : ?>
                    <a href="<?php echo esc_url( $r->story_url ); ?>" target="_blank"><?php echo esc_html( wp_trim_words( $r->story_title ?: 'View', 6 ) ); ?></a>
                <?php else : ?>
                    <?php echo esc_html( wp_trim_words( $r->story_title ?: '—', 6 ) ); ?>
                <?php endif; ?>
            </td>
            <td>
                <div class="oo-row-actions">
                    <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-pr&action=edit&id=' . $r->id ) ); ?>">Edit</a>
                    <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" onsubmit="return confirm('Delete this entry?')">
                        <?php wp_nonce_field( 'oo_delete_editorial_entry' ); ?>
                        <input type="hidden" name="action" value="oo_delete_editorial_entry">
                        <input type="hidden" name="entry_id" value="<?php echo esc_attr( $r->id ); ?>">
                        <button type="submit" class="oo-delete-btn">Delete</button>
                    </form>
                </div>
            </td>
        </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
</div>

<?php if ( $pages > 1 ) :
    $base = add_query_arg( array_filter( array(
        'page' => 'oo-pr', 'client_filter' => $client_filter,
        'status_filter' => $status_filter, 's' => $search,
    ) ), admin_url( 'admin.php' ) );
?>
<div class="oo-pagination" style="display:flex;gap:6px;margin-top:16px;align-items:center">
    <?php if ( $paged > 1 ) : ?><a class="oo-btn oo-btn-secondary oo-btn-sm" href="<?php echo esc_url( add_query_arg( 'paged', $paged - 1, $base ) ); ?>">← Prev</a><?php endif; ?>
    <span class="oo-muted" style="font-size:13px">Page <?php echo $paged; ?> of <?php echo $pages; ?></span>
    <?php if ( $paged < $pages ) : ?><a class="oo-btn oo-btn-secondary oo-btn-sm" href="<?php echo esc_url( add_query_arg( 'paged', $paged + 1, $base ) ); ?>">Next →</a><?php endif; ?>
</div>
<?php endif; ?>

<?php else : ?>
<div class="oo-card">
    <div class="oo-empty-state">
        <h3>No log entries yet</h3>
        <p>Import your existing editorial log CSV, or add an entry manually.</p>
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-pr&action=new' ) ); ?>" class="oo-btn oo-btn-secondary">Add Your First Entry</a>
    </div>
</div>
<?php endif; ?>
