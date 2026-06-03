<?php if ( ! defined( 'ABSPATH' ) ) exit;
global $wpdb;

// Aggregate tags from all contacts
$rows = $wpdb->get_results(
    "SELECT tags FROM {$wpdb->prefix}oo_contacts WHERE tags IS NOT NULL AND tags != '' AND tags != '[]'",
    ARRAY_A
);

$tags_map = array();
foreach ( $rows as $r ) {
    $arr = json_decode( $r['tags'], true );
    if ( is_array( $arr ) ) {
        foreach ( $arr as $t ) {
            $t = trim( $t );
            if ( $t ) $tags_map[ $t ] = ( $tags_map[ $t ] ?? 0 ) + 1;
        }
    }
}

$sort = $_GET['sort'] ?? 'count';
if ( $sort === 'alpha' ) {
    ksort( $tags_map );
} else {
    arsort( $tags_map );
}

$search = sanitize_text_field( $_GET['s'] ?? '' );
if ( $search ) {
    $tags_map = array_filter( $tags_map, fn( $k ) => stripos( $k, $search ) !== false, ARRAY_FILTER_USE_KEY );
}

$settings = get_option( 'oo_settings', array() );
$has_claude = ! empty( $settings['claude_api_key'] );
?>

<div class="oo-page-header">
    <h1 class="oo-page-title">Tags <span class="oo-muted" style="font-size:14px;font-weight:400"><?php echo number_format( count( $tags_map ) ); ?> tags</span></h1>
    <div class="oo-page-actions" style="display:flex;gap:8px;align-items:center">
        <?php if ( $has_claude ) : ?>
        <button class="oo-btn oo-btn-primary" id="oo-tidy-btn">✨ Tidy with Claude</button>
        <?php else : ?>
        <span class="oo-muted" style="font-size:12px">Add a Claude API key in Settings to enable Tidy.</span>
        <?php endif; ?>
    </div>
</div>

<div id="oo-tags-notice" class="oo-notice" style="display:none;margin-bottom:12px"></div>

<!-- ── Tidy with Claude panel ─────────────────────────────────────── -->
<div id="oo-tidy-panel" class="oo-card" style="display:none;margin-bottom:20px">
    <div id="oo-tidy-loading" style="padding:20px;text-align:center;color:var(--oo-text-muted)">
        <div>Analysing <?php echo count( $tags_map ); ?> tags with Claude…</div>
        <div style="margin-top:8px;font-size:12px">This usually takes 5–15 seconds.</div>
    </div>
    <div id="oo-tidy-results" style="display:none">
        <div style="padding:16px 20px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between">
            <div>
                <strong id="oo-tidy-op-count"></strong>
                <span class="oo-muted" style="font-size:13px"> suggested changes — untick any you disagree with, then Apply.</span>
            </div>
            <div style="display:flex;gap:8px">
                <button class="oo-btn oo-btn-secondary oo-btn-sm" id="oo-tidy-select-all">Select all</button>
                <button class="oo-btn oo-btn-secondary oo-btn-sm" id="oo-tidy-select-none">Select none</button>
                <button class="oo-btn oo-btn-primary" id="oo-tidy-apply-btn">Apply Selected</button>
                <span id="oo-tidy-apply-status" class="oo-muted" style="align-self:center;font-size:13px"></span>
            </div>
        </div>
        <div id="oo-tidy-ops-list" style="max-height:500px;overflow-y:auto"></div>
    </div>
    <div id="oo-tidy-error" style="display:none;padding:20px;color:#c0392b"></div>
</div>

<!-- ── Filter / sort bar ──────────────────────────────────────────── -->
<div class="oo-filters" style="margin-bottom:12px">
    <form method="get" style="display:flex;align-items:center;gap:8px">
        <input type="hidden" name="page" value="oo-tags">
        <input type="search" name="s" class="oo-input" value="<?php echo esc_attr( $search ); ?>" placeholder="Search tags…" style="width:200px">
        <button type="submit" class="oo-btn oo-btn-secondary">Search</button>
        <?php if ( $search ) : ?>
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-tags' ) ); ?>" class="oo-btn oo-btn-secondary">✕ Clear</a>
        <?php endif; ?>
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-tags&s=' . urlencode( $search ) . '&sort=count' ) ); ?>"
           class="oo-btn oo-btn-sm <?php echo $sort !== 'alpha' ? 'oo-btn-primary' : 'oo-btn-secondary'; ?>">By count</a>
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-tags&s=' . urlencode( $search ) . '&sort=alpha' ) ); ?>"
           class="oo-btn oo-btn-sm <?php echo $sort === 'alpha' ? 'oo-btn-primary' : 'oo-btn-secondary'; ?>">A → Z</a>
    </form>
</div>

<!-- ── Tags table ─────────────────────────────────────────────────── -->
<?php if ( $tags_map ) : ?>
<div class="oo-table-wrap">
    <table class="oo-table" id="oo-tags-table">
        <thead><tr>
            <th>Tag</th>
            <th style="width:100px;text-align:right">Contacts</th>
            <th style="width:200px">Actions</th>
        </tr></thead>
        <tbody>
        <?php foreach ( $tags_map as $tag => $count ) : ?>
        <tr data-tag="<?php echo esc_attr( $tag ); ?>">
            <td><strong class="oo-tag-name"><?php echo esc_html( $tag ); ?></strong></td>
            <td style="text-align:right"><?php echo number_format( $count ); ?></td>
            <td>
                <div class="oo-row-actions">
                    <button class="oo-btn oo-btn-secondary oo-btn-sm oo-tag-rename-btn" data-tag="<?php echo esc_attr( $tag ); ?>">Rename</button>
                    <button class="oo-btn oo-btn-sm oo-tag-delete-btn" data-tag="<?php echo esc_attr( $tag ); ?>" style="color:#c0392b;border-color:#c0392b">Delete</button>
                </div>
            </td>
        </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
</div>
<?php else : ?>
<div class="oo-card">
    <div class="oo-empty-state">
        <h3>No tags yet</h3>
        <p>Import contacts with tags, or add tags to contacts from the Contacts page.</p>
    </div>
</div>
<?php endif; ?>

<!-- Inline rename form (injected into rows by JS) -->
<template id="oo-rename-tpl">
    <div class="oo-rename-inline" style="display:flex;gap:6px;align-items:center">
        <input type="text" class="oo-input oo-rename-input" style="max-width:180px">
        <button type="button" class="oo-btn oo-btn-primary oo-btn-sm oo-rename-save">Save</button>
        <button type="button" class="oo-btn oo-btn-secondary oo-btn-sm oo-rename-cancel">Cancel</button>
        <span class="oo-rename-status oo-muted" style="font-size:12px"></span>
    </div>
</template>

<script>
window.ooTagsData = {
    nonce:   <?php echo wp_json_encode( wp_create_nonce( 'oo_nonce' ) ); ?>,
    ajaxUrl: <?php echo wp_json_encode( admin_url( 'admin-ajax.php' ) ); ?>,
    hasClaude: <?php echo $has_claude ? 'true' : 'false'; ?>
};
</script>
