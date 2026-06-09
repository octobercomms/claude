<?php if ( ! defined( 'ABSPATH' ) ) exit;

global $wpdb;
$con_t = $wpdb->prefix . 'oo_contacts';
$log_t = $wpdb->prefix . 'oo_editorial_log';
$out_t = $wpdb->prefix . 'oo_outlets';
$statuses = OO_Database::get_editorial_statuses();

$action     = $_GET['action'] ?? 'list';
$contact_id = intval( $_GET['id'] ?? 0 );

// ── Single journalist drill-down ───────────────────────────────────────
if ( $action === 'view' && $contact_id ) {
    $c = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$con_t} WHERE id = %d", $contact_id ) );
    if ( ! $c ) { echo '<div class="oo-notice oo-notice-warning">Contact not found.</div>'; return; }

    $outlet = $c->outlet_id ? (string) $wpdb->get_var( $wpdb->prepare( "SELECT name FROM {$out_t} WHERE id = %d", $c->outlet_id ) ) : '';
    $agg = $wpdb->get_row( $wpdb->prepare(
        "SELECT COUNT(*) AS total,
                SUM(status='published') AS published,
                SUM(status='pitched')   AS pitched,
                SUM(status='declined')  AS declined,
                COUNT(DISTINCT client)  AS clients,
                MAX(CASE WHEN status='published' THEN COALESCE(issue_date, request_date) END) AS last_featured
         FROM {$log_t} WHERE contact_id = %d", $contact_id
    ) );
    $rows = $wpdb->get_results( $wpdb->prepare(
        "SELECT l.*, o.name AS outlet_name FROM {$log_t} l
         LEFT JOIN {$out_t} o ON o.id = l.outlet_id
         WHERE l.contact_id = %d
         ORDER BY COALESCE(l.issue_date, l.request_date) DESC, l.id DESC", $contact_id
    ) );

    $last_ts  = $agg->last_featured ? strtotime( $agg->last_featured ) : null;
    $strength = OO_Analytics::relationship_strength( $agg->published, $last_ts );
    $hit      = OO_Analytics::hit_rate( $agg->published, $agg->pitched, $agg->declined );
    $quiet    = OO_Analytics::is_gone_quiet( $agg->published, $last_ts );
    $real_email = $c->email && ! str_ends_with( $c->email, '@import.local' );
    ?>
    <div class="oo-page-header">
        <h1 class="oo-page-title"><?php echo esc_html( trim( $c->first_name . ' ' . $c->last_name ) ); ?></h1>
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-journalists' ) ); ?>" class="oo-btn oo-btn-secondary">← All Journalists</a>
    </div>

    <div class="oo-settings-grid" style="margin-bottom:18px">
        <div class="oo-card">
            <h2 class="oo-card-title">Profile</h2>
            <p style="margin:4px 0"><strong>Outlet:</strong> <?php echo esc_html( $outlet ?: '—' ); ?></p>
            <p style="margin:4px 0"><strong>Email:</strong> <?php echo $real_email ? esc_html( $c->email ) : '<span class="oo-muted">unknown</span>'; ?></p>
            <p style="margin:4px 0"><strong>Location:</strong> <?php echo esc_html( $c->location ?: '—' ); ?></p>
            <?php if ( $c->bio_link ) : ?><p style="margin:4px 0"><strong>Bio:</strong> <a href="<?php echo esc_url( $c->bio_link ); ?>" target="_blank">link</a></p><?php endif; ?>
            <?php if ( $c->last_contacted ) : ?><p style="margin:4px 0"><strong>Last contacted:</strong> <?php echo esc_html( date( 'd M Y', strtotime( $c->last_contacted ) ) ); ?></p><?php endif; ?>
        </div>
        <div class="oo-card">
            <h2 class="oo-card-title">Relationship</h2>
            <p style="margin:4px 0;font-size:24px;font-weight:700"><?php echo (int) $strength['score']; ?><span class="oo-muted" style="font-size:14px;font-weight:400">/100 · <?php echo esc_html( $strength['label'] ); ?></span>
                <?php if ( $quiet ) : ?> <span class="oo-badge oo-badge-grey">Gone quiet</span><?php endif; ?>
            </p>
            <p style="margin:8px 0 0"><strong><?php echo (int) $agg->published; ?></strong> published · <strong><?php echo (int) $agg->pitched; ?></strong> pitched · <strong><?php echo $hit === null ? '—' : round( $hit * 100 ) . '%'; ?></strong> hit rate</p>
            <p style="margin:4px 0" class="oo-muted">Covers <?php echo (int) $agg->clients; ?> client(s) · last featured <?php echo $last_ts ? esc_html( date( 'd M Y', $last_ts ) ) : 'never'; ?></p>
        </div>
    </div>

    <?php if ( isset( $_GET['saved'] ) ) : ?><div class="oo-notice oo-notice-success">Profile saved.</div><?php endif; ?>
    <div id="oo-prof-notice" class="oo-notice" style="display:none"></div>
    <?php
    $avail_statuses = OO_Database::get_availability_statuses();
    $cur_tags = json_decode( $c->tags ?? '[]', true );
    $cur_tags = is_array( $cur_tags ) ? implode( ', ', $cur_tags ) : '';
    ?>
    <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" id="oo-journalist-meta" data-id="<?php echo esc_attr( $c->id ); ?>">
        <?php wp_nonce_field( 'oo_save_journalist_meta' ); ?>
        <input type="hidden" name="action" value="oo_save_journalist_meta">
        <input type="hidden" name="contact_id" value="<?php echo esc_attr( $c->id ); ?>">
        <div class="oo-settings-grid" style="margin-bottom:18px">
            <div class="oo-card">
                <h2 class="oo-card-title">Editable details</h2>
                <div class="oo-field" style="display:flex;gap:14px;align-items:flex-start">
                    <?php if ( $c->photo_url ) : ?><img id="oo-prof-photo" src="<?php echo esc_url( $c->photo_url ); ?>" alt="" style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:1px solid var(--oo-border,#e5e7eb)"><?php else : ?><div id="oo-prof-photo-ph" style="width:64px;height:64px;border-radius:50%;background:#eef2ff;display:flex;align-items:center;justify-content:center;color:#6366f1;font-weight:700"><?php echo esc_html( strtoupper( substr( $c->first_name, 0, 1 ) . substr( $c->last_name, 0, 1 ) ) ); ?></div><?php endif; ?>
                    <div style="flex:1">
                        <label class="oo-label">Photo URL</label>
                        <input type="url" name="photo_url" class="oo-input" value="<?php echo esc_attr( $c->photo_url ); ?>" placeholder="https://… (paste a headshot URL)">
                    </div>
                </div>
                <div class="oo-field">
                    <label class="oo-label">Availability</label>
                    <select name="availability_status" class="oo-select" id="oo-avail">
                        <?php foreach ( $avail_statuses as $val => $lbl ) : ?>
                        <option value="<?php echo esc_attr( $val ); ?>" <?php selected( $c->availability_status ?? 'active', $val ); ?>><?php echo esc_html( $lbl ); ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="oo-field" id="oo-return-wrap" style="<?php echo ( $c->availability_status ?? 'active' ) === 'active' ? 'display:none' : ''; ?>">
                    <label class="oo-label">Back / review on <span class="oo-muted" style="font-weight:400">(e.g. end of maternity leave)</span></label>
                    <input type="date" name="available_from" class="oo-input" value="<?php echo esc_attr( $c->available_from ?? '' ); ?>">
                </div>
            </div>
            <div class="oo-card">
                <h2 class="oo-card-title">Beats &amp; notes</h2>
                <div class="oo-field">
                    <label class="oo-label">Beats / topics
                        <button type="button" class="oo-btn oo-btn-secondary oo-btn-sm" id="oo-suggest-beats" style="float:right">
                            <span class="oo-btn-text">✨ Suggest from coverage</span>
                            <span class="oo-btn-loading" style="display:none">…</span>
                        </button>
                    </label>
                    <input type="text" name="tags" id="oo-beats" class="oo-input" value="<?php echo esc_attr( $cur_tags ); ?>" placeholder="architecture, interiors, sustainability">
                    <p class="oo-hint">Comma-separated. Claude can suggest these from the stories they've covered.</p>
                </div>
                <div class="oo-field">
                    <label class="oo-label">Notes</label>
                    <textarea name="notes" class="oo-textarea" rows="4" placeholder="Anything useful — preferences, history, do/don't…"><?php echo esc_textarea( $c->notes ?? '' ); ?></textarea>
                </div>
            </div>
        </div>
        <div class="oo-wizard-actions" style="padding-top:0;margin-bottom:8px">
            <button type="submit" class="oo-btn oo-btn-primary">Save profile</button>
        </div>
    </form>

    <h2 class="oo-card-title" style="margin-bottom:10px">Coverage history (<?php echo count( $rows ); ?>)</h2>
    <?php if ( $rows ) : ?>
    <div class="oo-table-wrap"><table class="oo-table">
        <thead><tr><th>Client</th><th>Publication</th><th>Status</th><th>Issue Date</th><th>Story</th></tr></thead>
        <tbody>
        <?php foreach ( $rows as $r ) : ?>
        <tr>
            <td><?php echo esc_html( $r->client ?: '—' ); ?></td>
            <td><?php echo esc_html( $r->outlet_name ?: '—' ); ?></td>
            <td><span class="oo-badge oo-badge-<?php echo $r->status === 'published' ? 'green' : ( $r->status === 'declined' ? 'grey' : 'blue' ); ?>"><?php echo esc_html( $statuses[ $r->status ] ?? $r->status ); ?></span></td>
            <td class="oo-muted"><?php echo $r->issue_date ? esc_html( date( 'd M Y', strtotime( $r->issue_date ) ) ) : '—'; ?></td>
            <td><?php echo $r->story_url ? '<a href="' . esc_url( $r->story_url ) . '" target="_blank">' . esc_html( wp_trim_words( $r->story_title ?: 'View', 6 ) ) . '</a>' : esc_html( wp_trim_words( $r->story_title ?: '—', 6 ) ); ?></td>
        </tr>
        <?php endforeach; ?>
        </tbody>
    </table></div>
    <?php else : ?>
    <div class="oo-card"><p class="oo-muted">No coverage logged for this journalist yet.</p></div>
    <?php endif; ?>
    <?php
    return;
}

// ── List / leaderboard ─────────────────────────────────────────────────
$client_filter = sanitize_text_field( $_GET['client_filter'] ?? '' );
$search        = sanitize_text_field( $_GET['s'] ?? '' );

// Client filter scopes the stats to that client's rows (and hides journalists
// with none); otherwise we count across all clients.
$join_cond = "l.contact_id = c.id";
$join_args = array();
if ( $client_filter ) {
    $join_cond .= " AND l.client = %s";
    $join_args[] = $client_filter;
}

$where = "WHERE c.segment = 'media'";
$where_args = array();
if ( $search ) {
    $where .= " AND (c.first_name LIKE %s OR c.last_name LIKE %s)";
    $like = '%' . $wpdb->esc_like( $search ) . '%';
    array_push( $where_args, $like, $like );
}
$having = $client_filter ? "HAVING total > 0" : "";

$sql = "SELECT c.id, c.first_name, c.last_name, o.name AS outlet,
               COUNT(l.id) AS total,
               SUM(l.status='published') AS published,
               SUM(l.status='pitched')   AS pitched,
               SUM(l.status='declined')  AS declined,
               COUNT(DISTINCT l.client)  AS clients,
               MAX(CASE WHEN l.status='published' THEN COALESCE(l.issue_date, l.request_date) END) AS last_featured
        FROM {$con_t} c
        LEFT JOIN {$log_t} l ON {$join_cond}
        LEFT JOIN {$out_t} o ON o.id = c.outlet_id
        {$where}
        GROUP BY c.id
        {$having}
        ORDER BY published DESC, total DESC, c.last_name ASC
        LIMIT 300";

$args = array_merge( $join_args, $where_args );
$rows = $args ? $wpdb->get_results( $wpdb->prepare( $sql, $args ) ) : $wpdb->get_results( $sql );

$clients = $wpdb->get_col( "SELECT DISTINCT client FROM {$log_t} WHERE client != '' ORDER BY client ASC" );
$media_total = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$con_t} WHERE segment = 'media'" );
?>

<div class="oo-page-header">
    <h1 class="oo-page-title">Journalists</h1>
    <span class="oo-muted" style="align-self:center;font-size:13px"><?php echo number_format( $media_total ); ?> in media database</span>
</div>

<form method="get" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px">
    <input type="hidden" name="page" value="oo-journalists">
    <div class="oo-field" style="margin:0">
        <label class="oo-label">Coverage for client</label>
        <select name="client_filter" class="oo-select" style="width:200px">
            <option value="">All clients</option>
            <?php foreach ( $clients as $cl ) : ?>
            <option value="<?php echo esc_attr( $cl ); ?>" <?php selected( $client_filter, $cl ); ?>><?php echo esc_html( $cl ); ?></option>
            <?php endforeach; ?>
        </select>
    </div>
    <div class="oo-field" style="margin:0">
        <label class="oo-label">Search name</label>
        <input type="text" name="s" class="oo-input" style="width:200px" value="<?php echo esc_attr( $search ); ?>">
    </div>
    <button class="oo-btn oo-btn-secondary">Filter</button>
    <?php if ( $client_filter ) : ?>
    <span class="oo-muted" style="align-self:center;font-size:13px">Showing journalists who have covered <strong><?php echo esc_html( $client_filter ); ?></strong>, ranked by published pieces.</span>
    <?php endif; ?>
</form>

<?php if ( $rows ) : ?>
<div class="oo-table-wrap">
    <table class="oo-table">
        <thead><tr>
            <th>Journalist</th><th>Outlet</th><th>Published</th><th>Pitched</th><th>Hit rate</th><th>Last featured</th><th>Clients</th><th>Relationship</th>
        </tr></thead>
        <tbody>
        <?php foreach ( $rows as $r ) :
            $name    = trim( $r->first_name . ' ' . $r->last_name );
            $last_ts = $r->last_featured ? strtotime( $r->last_featured ) : null;
            $str     = OO_Analytics::relationship_strength( $r->published, $last_ts );
            $hit     = OO_Analytics::hit_rate( $r->published, $r->pitched, $r->declined );
            $quiet   = OO_Analytics::is_gone_quiet( $r->published, $last_ts );
            $sc      = $str['score'];
            $color   = $sc >= 80 ? 'green' : ( $sc >= 50 ? 'blue' : 'grey' );
        ?>
        <tr>
            <td><strong><a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-journalists&action=view&id=' . $r->id ) ); ?>"><?php echo esc_html( $name ?: '(unnamed)' ); ?></a></strong></td>
            <td class="oo-muted"><?php echo esc_html( $r->outlet ?: '—' ); ?></td>
            <td><strong><?php echo (int) $r->published; ?></strong></td>
            <td class="oo-muted"><?php echo (int) $r->pitched; ?></td>
            <td><?php echo $hit === null ? '<span class="oo-muted">—</span>' : round( $hit * 100 ) . '%'; ?></td>
            <td class="oo-muted"><?php echo $last_ts ? esc_html( date( 'd M Y', $last_ts ) ) : '—'; ?></td>
            <td class="oo-muted"><?php echo (int) $r->clients; ?></td>
            <td>
                <span class="oo-badge oo-badge-<?php echo $color; ?>"><?php echo $sc; ?> · <?php echo esc_html( $str['label'] ); ?></span>
                <?php if ( $quiet ) : ?><span class="oo-badge oo-badge-grey" title="No coverage in over a year">quiet</span><?php endif; ?>
            </td>
        </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
</div>
<p class="oo-hint" style="margin-top:8px">Top 300 by published coverage. Relationship score blends published volume with recency.</p>
<?php else : ?>
<div class="oo-card"><div class="oo-empty-state">
    <h3>No journalists yet</h3>
    <p>Import your editorial log and master contacts (PR → Media Database) to populate this.</p>
</div></div>
<?php endif; ?>
