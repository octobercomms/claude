<?php if ( ! defined( 'ABSPATH' ) ) exit;

global $wpdb;
$pr_t  = $wpdb->prefix . 'oo_press_releases';
$action = $_GET['action'] ?? 'list';
$pr_id  = intval( $_GET['id'] ?? 0 );
$pr     = null;

if ( ( $action === 'edit' ) && $pr_id ) {
    $pr = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$pr_t} WHERE id = %d", $pr_id ) );
    if ( ! $pr ) $action = 'list';
}

$statuses = array( 'draft' => 'Draft', 'in_review' => 'In review', 'approved' => 'Approved', 'sent' => 'Sent' );
$badge = function( $s ) {
    return array( 'draft' => 'grey', 'in_review' => 'blue', 'approved' => 'green', 'sent' => 'green' )[ $s ] ?? 'grey';
};

// Client suggestions
$clients = $wpdb->get_col( "SELECT name FROM {$wpdb->prefix}oo_clients ORDER BY name ASC" );
if ( ! $clients ) $clients = $wpdb->get_col( "SELECT DISTINCT client FROM {$wpdb->prefix}oo_editorial_log WHERE client != '' ORDER BY client ASC" );
$brands = OO_Database::get_brands();
?>

<?php if ( $action === 'new' || $action === 'edit' ) : ?>

<div class="oo-page-header">
    <h1 class="oo-page-title"><?php echo $action === 'new' ? 'New Press Release' : 'Edit Press Release'; ?></h1>
    <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-press' ) ); ?>" class="oo-btn oo-btn-secondary">← All Releases</a>
</div>

<?php if ( isset( $_GET['saved'] ) ) : ?><div class="oo-notice oo-notice-success">Saved.</div><?php endif; ?>
<div id="oo-pr-notice" class="oo-notice" style="display:none"></div>

<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
    <?php wp_nonce_field( 'oo_save_press_release' ); ?>
    <input type="hidden" name="action" value="oo_save_press_release">
    <input type="hidden" name="pr_id" value="<?php echo esc_attr( $pr_id ); ?>">

    <div class="oo-settings-grid">
        <div class="oo-card">
            <h2 class="oo-card-title">Brief</h2>
            <div class="oo-field">
                <label class="oo-label">Headline / working title</label>
                <input type="text" id="pr-title" name="title" class="oo-input" value="<?php echo esc_attr( $pr->title ?? '' ); ?>" required placeholder="e.g. Forgeworks unveils House of Wood Shingle">
            </div>
            <div class="oo-field">
                <label class="oo-label">Client</label>
                <input type="text" name="client" id="pr-client" class="oo-input" list="pr-clients" value="<?php echo esc_attr( $pr->client ?? '' ); ?>" placeholder="e.g. Forgeworks">
                <datalist id="pr-clients"><?php foreach ( $clients as $c ) : ?><option value="<?php echo esc_attr( $c ); ?>"><?php endforeach; ?></datalist>
            </div>
            <div class="oo-field">
                <label class="oo-label">Brand</label>
                <input type="text" name="brand" class="oo-input" list="pr-brands" value="<?php echo esc_attr( $pr->brand ?? '' ); ?>">
                <datalist id="pr-brands"><?php foreach ( $brands as $b ) : ?><option value="<?php echo esc_attr( $b ); ?>"><?php endforeach; ?></datalist>
            </div>
            <div class="oo-field">
                <label class="oo-label">Angle / why it's newsworthy</label>
                <textarea name="angle" id="pr-angle" class="oo-textarea" rows="2" placeholder="The hook a journalist would care about."><?php echo esc_textarea( $pr->angle ?? '' ); ?></textarea>
            </div>
            <div class="oo-field">
                <label class="oo-label">Key facts</label>
                <textarea name="key_facts" id="pr-key-facts" class="oo-textarea" rows="4" placeholder="Bullet the must-include facts: who, what, where, when, numbers, quotes…"><?php echo esc_textarea( $pr->key_facts ?? '' ); ?></textarea>
            </div>
            <button type="button" class="oo-btn oo-btn-primary" id="pr-draft-btn">
                <span class="oo-btn-text">✍️ Draft with Claude →</span>
                <span class="oo-btn-loading" style="display:none">Writing…</span>
            </button>
        </div>

        <div class="oo-card">
            <h2 class="oo-card-title">Sign-off</h2>
            <div class="oo-field">
                <label class="oo-label">Status</label>
                <select name="status" class="oo-select">
                    <?php foreach ( $statuses as $val => $lbl ) : ?>
                    <option value="<?php echo esc_attr( $val ); ?>" <?php selected( $pr->status ?? 'draft', $val ); ?>><?php echo esc_html( $lbl ); ?></option>
                    <?php endforeach; ?>
                </select>
                <p class="oo-hint">Set to <strong>In review</strong> to generate a client approval link.</p>
            </div>
            <?php if ( $pr && $pr->review_token && in_array( $pr->status, array( 'in_review', 'approved', 'sent' ), true ) ) : ?>
            <div class="oo-field">
                <label class="oo-label">Client approval link</label>
                <input type="text" class="oo-input" readonly value="<?php echo esc_attr( OO_Portal::review_url( $pr->review_token ) ); ?>" onclick="this.select();document.execCommand('copy');" style="font-size:12px">
                <p class="oo-hint">Send this to the client — they can approve without logging in.</p>
            </div>
            <?php endif; ?>
            <?php if ( $pr && $pr->approved_at ) : ?>
            <p class="oo-muted" style="font-size:13px">✓ Approved by <strong><?php echo esc_html( $pr->approved_by ?: 'client' ); ?></strong> on <?php echo esc_html( date( 'd M Y', strtotime( $pr->approved_at ) ) ); ?>.</p>
            <?php endif; ?>
            <div class="oo-field">
                <label class="oo-label">Embargo until <span class="oo-muted" style="font-weight:400">(optional)</span></label>
                <input type="datetime-local" name="embargo_at" class="oo-input" value="<?php echo $pr && $pr->embargo_at ? esc_attr( date( 'Y-m-d\TH:i', strtotime( $pr->embargo_at ) ) ) : ''; ?>">
            </div>
            <div class="oo-field">
                <label class="oo-label">Published URL <span class="oo-muted" style="font-weight:400">(once live)</span></label>
                <input type="url" name="url" class="oo-input" value="<?php echo esc_attr( $pr->url ?? '' ); ?>" placeholder="https://...">
            </div>
        </div>

        <div class="oo-card" style="grid-column:1/-1">
            <h2 class="oo-card-title">Release body</h2>
            <p class="oo-muted" style="margin-bottom:8px">Edit freely. Claude marks assumptions in [brackets] for you to fill.</p>
            <textarea name="body_html" id="pr-body" class="oo-textarea" rows="18" style="font-family:ui-monospace,monospace;font-size:13px"><?php echo esc_textarea( $pr->body_html ?? '' ); ?></textarea>
        </div>
    </div>

    <div class="oo-wizard-actions" style="padding-top:0">
        <button type="submit" class="oo-btn oo-btn-primary oo-btn-lg">Save</button>
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-press' ) ); ?>" class="oo-btn oo-btn-secondary oo-btn-lg">Cancel</a>
    </div>
</form>

<?php else : ?>

<div class="oo-page-header">
    <h1 class="oo-page-title">Press Releases</h1>
    <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-press&action=new' ) ); ?>" class="oo-btn oo-btn-primary">+ New Press Release</a>
</div>
<?php if ( isset( $_GET['deleted'] ) ) : ?><div class="oo-notice oo-notice-success">Deleted.</div><?php endif; ?>

<p class="oo-muted" style="margin-bottom:14px">Write a release from a brief, have Claude draft it, then send a client approval link for sign-off. Distribution to journalists comes next.</p>

<?php $releases = $wpdb->get_results( "SELECT * FROM {$pr_t} ORDER BY created_at DESC" ); ?>
<?php if ( $releases ) : ?>
<div class="oo-table-wrap">
    <table class="oo-table">
        <thead><tr><th>Title</th><th>Client</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
        <tbody>
        <?php foreach ( $releases as $r ) : ?>
        <tr>
            <td><strong><?php echo esc_html( $r->title ?: '(untitled)' ); ?></strong></td>
            <td class="oo-muted"><?php echo esc_html( $r->client ?: '—' ); ?></td>
            <td><span class="oo-badge oo-badge-<?php echo esc_attr( $badge( $r->status ) ); ?>"><?php echo esc_html( $statuses[ $r->status ] ?? ucfirst( $r->status ) ); ?></span></td>
            <td class="oo-muted"><?php echo esc_html( date( 'd M Y', strtotime( $r->created_at ) ) ); ?></td>
            <td>
                <div class="oo-row-actions">
                    <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-press&action=edit&id=' . $r->id ) ); ?>">Edit</a>
                    <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" onsubmit="return confirm('Delete this press release?')">
                        <?php wp_nonce_field( 'oo_delete_press_release' ); ?>
                        <input type="hidden" name="action" value="oo_delete_press_release">
                        <input type="hidden" name="pr_id" value="<?php echo esc_attr( $r->id ); ?>">
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
<div class="oo-card"><div class="oo-empty-state">
    <h3>No press releases yet</h3>
    <p>Start from a brief and let Claude draft the release.</p>
    <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-press&action=new' ) ); ?>" class="oo-btn oo-btn-secondary">Write Your First Release</a>
</div></div>
<?php endif; ?>

<?php endif; ?>
