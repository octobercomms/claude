<?php if ( ! defined( 'ABSPATH' ) ) exit; ?>

<?php
global $wpdb;
$action = $_GET['action'] ?? 'list';
$pr_id = intval( $_GET['id'] ?? 0 );
$pr = null;

if ( $action === 'edit' && $pr_id ) {
    $pr = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}oo_press_releases WHERE id = %d", $pr_id ) );
    if ( ! $pr ) $action = 'list';
}
?>

<div class="wrap oo-wrap">

<?php if ( $action === 'new' || $action === 'edit' ) : ?>

    <h1 class="oo-page-title"><?php echo $action === 'new' ? 'New Press Release' : 'Edit Press Release'; ?></h1>
    <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-press' ) ); ?>" class="page-title-action">Back</a>

    <div class="oo-card oo-card-info">
        <strong>How this works:</strong> Paste the URL of a press release hosted on downloadfor.press. In Stage 2, Claude will read the page, define the right journalist audience, find their contacts, and generate personalised pitch emails.
    </div>

    <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="oo-form">
        <?php wp_nonce_field( 'oo_save_press_release' ); ?>
        <input type="hidden" name="action" value="oo_save_press_release">
        <input type="hidden" name="pr_id" value="<?php echo esc_attr( $pr_id ); ?>">

        <div class="oo-card">
            <h2>Press Release</h2>
            <table class="form-table">
                <tr>
                    <th><label for="title">Title</label></th>
                    <td><input type="text" id="title" name="title" value="<?php echo esc_attr( $pr->title ?? '' ); ?>" class="large-text" required placeholder="e.g. October Comms Launches New Outreach Platform for Architects"></td>
                </tr>
                <tr>
                    <th><label for="url">Press Release URL</label></th>
                    <td>
                        <input type="url" id="url" name="url" value="<?php echo esc_attr( $pr->url ?? '' ); ?>" class="large-text" required placeholder="https://downloadfor.press/your-release">
                        <p class="description">The URL of the press release on downloadfor.press (or any public URL).</p>
                    </td>
                </tr>
                <tr>
                    <th><label for="status">Status</label></th>
                    <td>
                        <select id="status" name="status">
                            <option value="draft" <?php selected( $pr->status ?? 'draft', 'draft' ); ?>>Draft</option>
                            <option value="ready" <?php selected( $pr->status ?? '', 'ready' ); ?>>Ready to Send</option>
                            <option value="sent" <?php selected( $pr->status ?? '', 'sent' ); ?>>Sent</option>
                        </select>
                    </td>
                </tr>
            </table>
        </div>

        <p class="submit">
            <button type="submit" class="button button-primary button-large">Save</button>
            <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-press' ) ); ?>" class="button button-large">Cancel</a>
        </p>
    </form>

<?php else : ?>

    <h1 class="oo-page-title">Press Releases
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-press&action=new' ) ); ?>" class="page-title-action">New Press Release</a>
    </h1>

    <?php $releases = $wpdb->get_results( "SELECT * FROM {$wpdb->prefix}oo_press_releases ORDER BY created_at DESC" ); ?>

    <?php if ( $releases ) : ?>
    <table class="wp-list-table widefat fixed striped oo-table">
        <thead>
            <tr>
                <th>Title</th>
                <th>URL</th>
                <th>Status</th>
                <th>Audience</th>
                <th>Created</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody>
            <?php foreach ( $releases as $r ) : ?>
            <tr>
                <td><strong><?php echo esc_html( $r->title ?: '(untitled)' ); ?></strong></td>
                <td><a href="<?php echo esc_url( $r->url ); ?>" target="_blank"><?php echo esc_html( wp_trim_words( $r->url, 6 ) ); ?></a></td>
                <td><span class="oo-badge oo-badge-<?php echo $r->status === 'sent' ? 'green' : ( $r->status === 'ready' ? 'blue' : 'grey' ); ?>"><?php echo esc_html( ucfirst( $r->status ) ); ?></span></td>
                <td><?php echo $r->audience_defined ? '<span class="oo-badge oo-badge-green">Defined</span>' : '<span class="oo-badge oo-badge-grey">Pending Claude</span>'; ?></td>
                <td><?php echo esc_html( date( 'd M Y', strtotime( $r->created_at ) ) ); ?></td>
                <td class="oo-actions">
                    <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-press&action=edit&id=' . $r->id ) ); ?>">Edit</a>
                </td>
            </tr>
            <?php endforeach; ?>
        </tbody>
    </table>
    <?php else : ?>
    <div class="oo-card">
        <p class="oo-empty">No press releases yet. <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-press&action=new' ) ); ?>">Add your first</a>.</p>
        <p class="oo-muted">Paste a URL from downloadfor.press and Claude will define the journalist audience, find contacts, and write the pitch.</p>
    </div>
    <?php endif; ?>

<?php endif; ?>
</div>
