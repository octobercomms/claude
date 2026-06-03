<?php if ( ! defined( 'ABSPATH' ) ) exit;

global $wpdb;
$action = $_GET['action'] ?? 'list';
$pr_id  = intval( $_GET['id'] ?? 0 );
$pr     = null;

if ( $action === 'edit' && $pr_id ) {
    $pr = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}oo_press_releases WHERE id = %d", $pr_id ) );
    if ( ! $pr ) $action = 'list';
}
?>

<?php if ( $action === 'new' || $action === 'edit' ) : ?>

<div class="oo-page-header">
    <h1 class="oo-page-title"><?php echo $action === 'new' ? 'New Press Release' : 'Edit Press Release'; ?></h1>
    <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-press' ) ); ?>" class="oo-btn oo-btn-secondary">← Back</a>
</div>

<div class="oo-notice oo-notice-info" style="margin-bottom:20px">
    <strong>How this works:</strong> Paste the URL of a press release hosted on downloadfor.press. Claude will read the page, define the right journalist audience, find their contacts, and generate personalised pitch emails.
</div>

<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
    <?php wp_nonce_field( 'oo_save_press_release' ); ?>
    <input type="hidden" name="action" value="oo_save_press_release">
    <input type="hidden" name="pr_id" value="<?php echo esc_attr( $pr_id ); ?>">

    <div class="oo-settings-grid">
        <div class="oo-card">
            <h2 class="oo-card-title">Press Release Details</h2>
            <div class="oo-field">
                <label class="oo-label">Title</label>
                <input type="text" name="title" class="oo-input" value="<?php echo esc_attr( $pr->title ?? '' ); ?>" required placeholder="e.g. October Comms Launches New Outreach Platform for Architects">
            </div>
            <div class="oo-field">
                <label class="oo-label">Press Release URL</label>
                <input type="url" name="url" class="oo-input" value="<?php echo esc_attr( $pr->url ?? '' ); ?>" required placeholder="https://downloadfor.press/your-release">
                <p class="oo-hint">The URL of the press release on downloadfor.press (or any public URL).</p>
            </div>
            <div class="oo-field">
                <label class="oo-label">Status</label>
                <select name="status" class="oo-select">
                    <option value="draft" <?php selected( $pr->status ?? 'draft', 'draft' ); ?>>Draft</option>
                    <option value="ready" <?php selected( $pr->status ?? '', 'ready' ); ?>>Ready to Send</option>
                    <option value="sent" <?php selected( $pr->status ?? '', 'sent' ); ?>>Sent</option>
                </select>
            </div>
        </div>
    </div>

    <div class="oo-wizard-actions" style="padding-top:0">
        <button type="submit" class="oo-btn oo-btn-primary oo-btn-lg">Save Press Release</button>
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-press' ) ); ?>" class="oo-btn oo-btn-secondary oo-btn-lg">Cancel</a>
    </div>
</form>

<?php else : ?>

<div class="oo-page-header">
    <h1 class="oo-page-title">Press Releases</h1>
    <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-press&action=new' ) ); ?>" class="oo-btn oo-btn-secondary">+ New Press Release</a>
</div>

<?php if ( isset( $_GET['saved'] ) ) : ?><div class="oo-notice oo-notice-success">Press release saved.</div><?php endif; ?>
<?php if ( isset( $_GET['deleted'] ) ) : ?><div class="oo-notice oo-notice-success">Press release deleted.</div><?php endif; ?>

<?php $releases = $wpdb->get_results( "SELECT * FROM {$wpdb->prefix}oo_press_releases ORDER BY created_at DESC" ); ?>

<?php if ( $releases ) : ?>
<div class="oo-table-wrap">
    <table class="oo-table">
        <thead><tr>
            <th>Title</th><th>URL</th><th>Status</th><th>Audience</th><th>Created</th><th>Actions</th>
        </tr></thead>
        <tbody>
        <?php foreach ( $releases as $r ) : ?>
        <tr>
            <td><strong><?php echo esc_html( $r->title ?: '(untitled)' ); ?></strong></td>
            <td><a href="<?php echo esc_url( $r->url ); ?>" target="_blank" class="oo-muted"><?php echo esc_html( wp_trim_words( $r->url, 6 ) ); ?></a></td>
            <td><span class="oo-badge oo-badge-<?php echo $r->status === 'sent' ? 'green' : ( $r->status === 'ready' ? 'blue' : 'grey' ); ?>"><?php echo esc_html( ucfirst( $r->status ) ); ?></span></td>
            <td><?php echo $r->audience_defined ? '<span class="oo-badge oo-badge-green">Defined</span>' : '<span class="oo-badge oo-badge-grey">Pending</span>'; ?></td>
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
<div class="oo-card">
    <div class="oo-empty-state">
        <h3>No press releases yet</h3>
        <p>Paste a URL from downloadfor.press and Claude will define the journalist audience, find contacts, and write the pitch.</p>
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-press&action=new' ) ); ?>" class="oo-btn oo-btn-secondary">Add Your First Press Release</a>
    </div>
</div>
<?php endif; ?>

<?php endif; ?>
