<?php if ( ! defined( 'ABSPATH' ) ) exit;

global $wpdb;
$srch_t = $wpdb->prefix . 'oo_coverage_searches';
$log_t  = $wpdb->prefix . 'oo_editorial_log';
$out_t  = $wpdb->prefix . 'oo_outlets';

$action = $_GET['action'] ?? 'list';
$sid    = intval( $_GET['id'] ?? 0 );
$search = ( $action === 'edit' && $sid ) ? $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$srch_t} WHERE id = %d", $sid ) ) : null;
if ( $action === 'edit' && ! $search ) $action = 'list';

$serper_ok = ! empty( get_option( 'oo_settings', array() )['serper_api_key'] );
$clients   = $wpdb->get_col( "SELECT DISTINCT client FROM {$log_t} WHERE client != '' ORDER BY client ASC" );
?>

<?php if ( $action === 'new' || $action === 'edit' ) :
    $src = explode( ',', $search->sources ?? 'serper' );
?>
<div class="oo-page-header">
    <h1 class="oo-page-title"><?php echo $action === 'new' ? 'New Coverage Search' : 'Edit Coverage Search'; ?></h1>
    <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-monitor' ) ); ?>" class="oo-btn oo-btn-secondary">← Back</a>
</div>
<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
    <?php wp_nonce_field( 'oo_save_search' ); ?>
    <input type="hidden" name="action" value="oo_save_search">
    <input type="hidden" name="search_id" value="<?php echo esc_attr( $sid ); ?>">
    <div class="oo-card" style="max-width:620px">
        <div class="oo-field">
            <label class="oo-label">Client</label>
            <input type="text" name="client" class="oo-input" list="oo-mon-clients" value="<?php echo esc_attr( $search->client ?? '' ); ?>" required placeholder="e.g. Forgeworks">
            <datalist id="oo-mon-clients"><?php foreach ( $clients as $cl ) : ?><option value="<?php echo esc_attr( $cl ); ?>"><?php endforeach; ?></datalist>
            <p class="oo-hint">Found coverage is logged against this client.</p>
        </div>
        <div class="oo-field">
            <label class="oo-label">Search query (Google News)</label>
            <input type="text" name="query" class="oo-input" value="<?php echo esc_attr( $search->query ?? '' ); ?>" placeholder='e.g. "Forgeworks" architecture'>
            <p class="oo-hint">Quote brand names for exact matches. Used by the Serper source.</p>
        </div>
        <div class="oo-field">
            <label class="oo-label">Sources</label>
            <label style="display:flex;align-items:center;gap:8px;font-size:14px;margin-bottom:6px"><input type="checkbox" name="src_serper" value="1" <?php checked( in_array( 'serper', $src, true ) ); ?> style="width:auto"> Serper (Google News)<?php if ( ! $serper_ok ) : ?> <span class="oo-muted">— needs a Serper key in Settings</span><?php endif; ?></label>
            <label style="display:flex;align-items:center;gap:8px;font-size:14px"><input type="checkbox" name="src_alerts" value="1" <?php checked( in_array( 'alerts', $src, true ) ); ?> style="width:auto"> Google Alerts (RSS feed)</label>
        </div>
        <div class="oo-field">
            <label class="oo-label">Google Alerts RSS URL <span class="oo-muted" style="font-weight:400">(optional)</span></label>
            <input type="url" name="alerts_rss" class="oo-input" value="<?php echo esc_attr( $search->alerts_rss ?? '' ); ?>" placeholder="https://www.google.com/alerts/feeds/...">
            <p class="oo-hint">In Google Alerts, set "Deliver to" → RSS feed, then paste the feed URL here.</p>
        </div>
        <div class="oo-field">
            <label class="oo-label">Check frequency</label>
            <select name="cadence" class="oo-select" style="max-width:180px">
                <option value="daily" <?php selected( $search->cadence ?? 'daily', 'daily' ); ?>>Daily</option>
                <option value="weekly" <?php selected( $search->cadence ?? '', 'weekly' ); ?>>Weekly</option>
            </select>
        </div>
    </div>
    <div class="oo-wizard-actions" style="padding-top:0">
        <button type="submit" class="oo-btn oo-btn-primary oo-btn-lg">Save Search</button>
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-monitor' ) ); ?>" class="oo-btn oo-btn-secondary oo-btn-lg">Cancel</a>
    </div>
</form>
<?php return; endif; ?>

<?php
$searches = $wpdb->get_results( "SELECT * FROM {$srch_t} ORDER BY client ASC" );
$queue = $wpdb->get_results(
    "SELECT l.*, o.name AS outlet_name FROM {$log_t} l
     LEFT JOIN {$out_t} o ON o.id = l.outlet_id
     WHERE l.status = 'new'
     ORDER BY l.created_at DESC LIMIT 200"
);
?>

<div class="oo-page-header">
    <h1 class="oo-page-title">Coverage Monitor</h1>
    <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-monitor&action=new' ) ); ?>" class="oo-btn oo-btn-primary">+ New Search</a>
</div>

<?php if ( isset( $_GET['saved'] ) ) : ?><div class="oo-notice oo-notice-success">Search saved.</div><?php endif; ?>
<?php if ( isset( $_GET['deleted'] ) ) : ?><div class="oo-notice oo-notice-success">Search deleted.</div><?php endif; ?>
<?php if ( isset( $_GET['found'] ) ) : ?><div class="oo-notice oo-notice-success">Run complete — <?php echo intval( $_GET['found'] ); ?> new item(s) added to the review queue.</div><?php endif; ?>
<?php if ( isset( $_GET['confirmed'] ) ) : ?><div class="oo-notice oo-notice-success">Coverage confirmed and published to the log.</div><?php endif; ?>
<?php if ( isset( $_GET['dismissed'] ) ) : ?><div class="oo-notice oo-notice-success">Item dismissed.</div><?php endif; ?>
<?php if ( ! $serper_ok ) : ?><div class="oo-notice oo-notice-warning">Add a <strong>Serper</strong> API key in Settings to enable Google News monitoring. Google Alerts RSS works without it.</div><?php endif; ?>

<h2 class="oo-card-title" style="margin-bottom:10px">Saved searches</h2>
<?php if ( $searches ) : ?>
<div class="oo-table-wrap" style="margin-bottom:28px">
    <table class="oo-table">
        <thead><tr><th>Client</th><th>Query</th><th>Sources</th><th>Frequency</th><th>Last run</th><th>Actions</th></tr></thead>
        <tbody>
        <?php foreach ( $searches as $s ) : ?>
        <tr>
            <td><strong><?php echo esc_html( $s->client ); ?></strong></td>
            <td class="oo-muted"><?php echo esc_html( $s->query ?: '—' ); ?></td>
            <td class="oo-muted"><?php echo esc_html( str_replace( array( 'serper', 'alerts' ), array( 'News', 'Alerts' ), $s->sources ) ); ?></td>
            <td><span class="oo-badge oo-badge-blue"><?php echo esc_html( ucfirst( $s->cadence ) ); ?></span></td>
            <td class="oo-muted"><?php echo $s->last_run_at ? esc_html( date( 'd M H:i', strtotime( $s->last_run_at ) ) ) : 'never'; ?></td>
            <td>
                <div class="oo-row-actions">
                    <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline">
                        <?php wp_nonce_field( 'oo_run_search' ); ?>
                        <input type="hidden" name="action" value="oo_run_search">
                        <input type="hidden" name="search_id" value="<?php echo esc_attr( $s->id ); ?>">
                        <button type="submit" class="oo-linklike" style="background:none;border:none;padding:0;color:var(--oo-accent,#6366f1);cursor:pointer">Run now</button>
                    </form>
                    <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-monitor&action=edit&id=' . $s->id ) ); ?>">Edit</a>
                    <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" onsubmit="return confirm('Delete this search?')" style="display:inline">
                        <?php wp_nonce_field( 'oo_delete_search' ); ?>
                        <input type="hidden" name="action" value="oo_delete_search">
                        <input type="hidden" name="search_id" value="<?php echo esc_attr( $s->id ); ?>">
                        <button type="submit" class="oo-delete-btn">Delete</button>
                    </form>
                </div>
            </td>
        </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
</div>
<?php else : ?>
<div class="oo-card" style="margin-bottom:28px"><div class="oo-empty-state">
    <h3>No coverage searches yet</h3>
    <p>Add a search per client — Claude/Serper checks Google News and your Google Alerts feeds on a schedule and drops new coverage into the review queue below.</p>
</div></div>
<?php endif; ?>

<h2 class="oo-card-title" style="margin-bottom:10px">Review queue <?php if ( $queue ) : ?><span class="oo-badge oo-badge-blue"><?php echo count( $queue ); ?></span><?php endif; ?></h2>
<p class="oo-muted" style="margin-bottom:10px">Auto-found coverage awaiting confirmation. Confirm to publish it to the editorial log (and the client portal), or dismiss it.</p>
<?php if ( $queue ) : ?>
<div class="oo-table-wrap">
    <table class="oo-table">
        <thead><tr><th>Client</th><th>Publication</th><th>Story</th><th>Date</th><th>Source</th><th>Actions</th></tr></thead>
        <tbody>
        <?php foreach ( $queue as $r ) : ?>
        <tr>
            <td><?php echo esc_html( $r->client ?: '—' ); ?></td>
            <td><?php echo esc_html( $r->outlet_name ?: '—' ); ?></td>
            <td><?php echo $r->story_url ? '<a href="' . esc_url( $r->story_url ) . '" target="_blank" rel="noopener">' . esc_html( wp_trim_words( $r->story_title ?: 'View', 8 ) ) . '</a>' : esc_html( wp_trim_words( $r->story_title ?: '—', 8 ) ); ?></td>
            <td class="oo-muted"><?php echo $r->issue_date ? esc_html( date( 'd M Y', strtotime( $r->issue_date ) ) ) : '—'; ?></td>
            <td class="oo-muted"><?php echo esc_html( $r->source === 'alerts' ? 'Alerts' : 'News' ); ?></td>
            <td>
                <div class="oo-row-actions">
                    <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline">
                        <?php wp_nonce_field( 'oo_confirm_coverage' ); ?>
                        <input type="hidden" name="action" value="oo_confirm_coverage">
                        <input type="hidden" name="entry_id" value="<?php echo esc_attr( $r->id ); ?>">
                        <button type="submit" class="oo-linklike" style="background:none;border:none;padding:0;color:#166534;cursor:pointer;font-weight:600">✓ Confirm</button>
                    </form>
                    <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline">
                        <?php wp_nonce_field( 'oo_dismiss_coverage' ); ?>
                        <input type="hidden" name="action" value="oo_dismiss_coverage">
                        <input type="hidden" name="entry_id" value="<?php echo esc_attr( $r->id ); ?>">
                        <button type="submit" class="oo-delete-btn">Dismiss</button>
                    </form>
                </div>
            </td>
        </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
</div>
<?php else : ?>
<div class="oo-card"><p class="oo-muted">Nothing awaiting review. Run a search or wait for the scheduled check.</p></div>
<?php endif; ?>
