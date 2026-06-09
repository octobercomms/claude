<?php if ( ! defined( 'ABSPATH' ) ) exit;

global $wpdb;
$cli_t = $wpdb->prefix . 'oo_clients';
$log_t = $wpdb->prefix . 'oo_editorial_log';

$action = $_GET['action'] ?? 'list';
$cid    = intval( $_GET['id'] ?? 0 );
$client = ( $action === 'edit' && $cid ) ? $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$cli_t} WHERE id = %d", $cid ) ) : null;
if ( $action === 'edit' && ! $client ) $action = 'list';
$cadences = array( 'off' => 'Off', 'weekly' => 'Weekly', 'monthly' => 'Monthly' );
?>

<?php if ( $action === 'new' || $action === 'edit' ) : ?>
<div class="oo-page-header">
    <h1 class="oo-page-title"><?php echo $action === 'new' ? 'New Client' : 'Edit Client'; ?></h1>
    <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-clients' ) ); ?>" class="oo-btn oo-btn-secondary">← Back</a>
</div>
<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
    <?php wp_nonce_field( 'oo_save_client' ); ?>
    <input type="hidden" name="action" value="oo_save_client">
    <input type="hidden" name="client_id" value="<?php echo esc_attr( $cid ); ?>">
    <div class="oo-card" style="max-width:560px">
        <div class="oo-field">
            <label class="oo-label">Client Name</label>
            <input type="text" name="name" class="oo-input" value="<?php echo esc_attr( $client->name ?? '' ); ?>" required placeholder="e.g. Forgeworks">
            <p class="oo-hint">Must match the client name used in the Editorial Log.</p>
        </div>
        <div class="oo-field">
            <label class="oo-label">Alert / Report Email</label>
            <input type="email" name="alert_email" class="oo-input" value="<?php echo esc_attr( $client->alert_email ?? '' ); ?>" placeholder="client@example.com">
            <p class="oo-hint">Where weekly reports and coverage alerts will be sent (Phase 4b).</p>
        </div>
        <div class="oo-field">
            <label class="oo-label">Report Cadence</label>
            <select name="report_cadence" class="oo-select" style="max-width:200px">
                <?php foreach ( $cadences as $val => $lbl ) : ?>
                <option value="<?php echo esc_attr( $val ); ?>" <?php selected( $client->report_cadence ?? 'off', $val ); ?>><?php echo esc_html( $lbl ); ?></option>
                <?php endforeach; ?>
            </select>
        </div>
    </div>
    <div class="oo-wizard-actions" style="padding-top:0">
        <button type="submit" class="oo-btn oo-btn-primary oo-btn-lg">Save Client</button>
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-clients' ) ); ?>" class="oo-btn oo-btn-secondary oo-btn-lg">Cancel</a>
    </div>
</form>
<?php return; endif; ?>

<?php
$clients = $wpdb->get_results( "SELECT * FROM {$cli_t} ORDER BY name ASC" );
// published coverage counts per client name
$counts = array();
foreach ( $wpdb->get_results( "SELECT client, SUM(status IN ('published','download')) AS published, COUNT(*) AS total FROM {$log_t} WHERE client != '' GROUP BY client" ) as $r ) {
    $counts[ $r->client ] = $r;
}
$unlinked = (int) $wpdb->get_var( "SELECT COUNT(DISTINCT l.client) FROM {$log_t} l LEFT JOIN {$cli_t} c ON c.name = l.client WHERE l.client != '' AND c.id IS NULL" );
?>

<div class="oo-page-header">
    <h1 class="oo-page-title">Clients</h1>
    <div class="oo-page-actions" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-clients&action=new' ) ); ?>" class="oo-btn oo-btn-primary">+ New Client</a>
        <?php if ( $unlinked > 0 ) : ?>
        <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline">
            <?php wp_nonce_field( 'oo_sync_clients' ); ?>
            <input type="hidden" name="action" value="oo_sync_clients">
            <button type="submit" class="oo-btn oo-btn-secondary">Create records for <?php echo $unlinked; ?> log client(s)</button>
        </form>
        <?php endif; ?>
    </div>
</div>

<?php if ( isset( $_GET['saved'] ) ) : ?><div class="oo-notice oo-notice-success">Client saved.</div><?php endif; ?>
<?php if ( isset( $_GET['deleted'] ) ) : ?><div class="oo-notice oo-notice-success">Client deleted.</div><?php endif; ?>
<?php if ( isset( $_GET['synced'] ) ) : ?><div class="oo-notice oo-notice-success"><?php echo intval( $_GET['synced'] ); ?> client record(s) created.</div><?php endif; ?>
<?php if ( isset( $_GET['error'] ) ) : ?><div class="oo-notice oo-notice-warning">Client name is required.</div><?php endif; ?>

<p class="oo-muted" style="margin-bottom:14px">Each client gets a private link showing their published coverage and pipeline (never internal notes). Share it — no login needed.</p>

<?php if ( $clients ) : ?>
<div class="oo-table-wrap">
    <table class="oo-table">
        <thead><tr><th>Client</th><th>Published</th><th>Portal Link</th><th>Report Email</th><th>Cadence</th><th>Actions</th></tr></thead>
        <tbody>
        <?php foreach ( $clients as $c ) :
            $url = OO_Portal::portal_url( $c->token );
            $cnt = $counts[ $c->name ] ?? null;
        ?>
        <tr>
            <td><strong><?php echo esc_html( $c->name ); ?></strong></td>
            <td><?php echo $cnt ? (int) $cnt->published : 0; ?></td>
            <td style="max-width:280px">
                <input type="text" class="oo-input" readonly value="<?php echo esc_attr( $url ); ?>" onclick="this.select();document.execCommand('copy');" title="Click to copy" style="font-size:12px;padding:4px 8px">
            </td>
            <td class="oo-muted"><?php echo esc_html( $c->alert_email ?: '—' ); ?></td>
            <td><span class="oo-badge oo-badge-<?php echo $c->report_cadence === 'off' ? 'grey' : 'blue'; ?>"><?php echo esc_html( $cadences[ $c->report_cadence ] ?? 'Off' ); ?></span></td>
            <td>
                <div class="oo-row-actions">
                    <a href="<?php echo esc_url( $url ); ?>" target="_blank">Open</a>
                    <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-clients&action=edit&id=' . $c->id ) ); ?>">Edit</a>
                    <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" onsubmit="return confirm('Delete this client (the portal link will stop working)?')">
                        <?php wp_nonce_field( 'oo_delete_client' ); ?>
                        <input type="hidden" name="action" value="oo_delete_client">
                        <input type="hidden" name="client_id" value="<?php echo esc_attr( $c->id ); ?>">
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
    <h3>No clients yet</h3>
    <p>Create a client, or generate records for every client already in your editorial log.</p>
</div></div>
<?php endif; ?>
