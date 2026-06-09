<?php if ( ! defined( 'ABSPATH' ) ) exit;

global $wpdb;
$out_t = $wpdb->prefix . 'oo_outlets';
$log_t = $wpdb->prefix . 'oo_editorial_log';

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
        <button class="oo-btn oo-btn-primary" id="oo-dedup-scan">
            <span class="oo-btn-text">🔍 Find Duplicate Publications</span>
            <span class="oo-btn-loading" style="display:none">Scanning…</span>
        </button>
    </div>
</div>

<div id="oo-media-notice" class="oo-notice" style="display:none"></div>

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
            <td><strong><?php echo esc_html( $o->name ); ?></strong></td>
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
