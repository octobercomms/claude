<?php if ( ! defined( 'ABSPATH' ) ) exit;
global $wpdb;
$action     = $_GET['action'] ?? 'list';
$contact_id = intval( $_GET['id'] ?? 0 );
$contact    = null;
$types      = OO_Database::get_contact_types();

if ( in_array( $action, array( 'edit', 'new' ) ) && $contact_id ) {
    $contact = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}oo_contacts WHERE id = %d", $contact_id ) );
    if ( ! $contact ) $action = 'list';
}
?>

<?php if ( $action === 'new' || $action === 'edit' ) : ?>

<div class="oo-page-header">
    <h1 class="oo-page-title"><?php echo $action === 'new' ? 'Add Contact' : 'Edit Contact'; ?></h1>
    <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-contacts' ) ); ?>" class="oo-btn oo-btn-secondary">← Back</a>
</div>

<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
    <?php wp_nonce_field( 'oo_save_contact' ); ?>
    <input type="hidden" name="action" value="oo_save_contact">
    <input type="hidden" name="contact_id" value="<?php echo esc_attr( $contact_id ); ?>">

    <div class="oo-form-grid">
        <div class="oo-card">
            <h2 class="oo-card-title">Contact Details</h2>
            <div class="oo-field"><label class="oo-label">First Name</label><input type="text" name="first_name" class="oo-input" value="<?php echo esc_attr( $contact->first_name ?? '' ); ?>" required></div>
            <div class="oo-field"><label class="oo-label">Last Name</label><input type="text" name="last_name" class="oo-input" value="<?php echo esc_attr( $contact->last_name ?? '' ); ?>"></div>
            <div class="oo-field"><label class="oo-label">Email</label><input type="email" name="email" class="oo-input" value="<?php echo esc_attr( $contact->email ?? '' ); ?>" required></div>
            <div class="oo-field"><label class="oo-label">Company / Practice</label><input type="text" name="company" class="oo-input" value="<?php echo esc_attr( $contact->company ?? '' ); ?>"></div>
            <div class="oo-field">
                <label class="oo-label">Contact Type</label>
                <select name="type" class="oo-select">
                    <option value="">— Select —</option>
                    <?php foreach ( $types as $val => $label ) : ?>
                    <option value="<?php echo esc_attr( $val ); ?>" <?php selected( $contact->type ?? '', $val ); ?>><?php echo esc_html( $label ); ?></option>
                    <?php endforeach; ?>
                </select>
            </div>
        </div>
        <div class="oo-card">
            <h2 class="oo-card-title">More Info</h2>
            <div class="oo-field"><label class="oo-label">Location</label><input type="text" name="location" class="oo-input" value="<?php echo esc_attr( $contact->location ?? '' ); ?>" placeholder="e.g. London, UK"></div>
            <div class="oo-field"><label class="oo-label">LinkedIn URL</label><input type="url" name="linkedin_url" class="oo-input" value="<?php echo esc_attr( $contact->linkedin_url ?? '' ); ?>"></div>
            <div class="oo-field"><label class="oo-label">Source</label><input type="text" name="source" class="oo-input" value="<?php echo esc_attr( $contact->source ?? '' ); ?>" placeholder="Hunter.io, Manual, Import..."></div>
            <div class="oo-field">
                <label class="oo-label">Status</label>
                <select name="status" class="oo-select">
                    <?php foreach ( array( 'active' => 'Active', 'unsubscribed' => 'Unsubscribed', 'bounced' => 'Bounced', 'do_not_contact' => 'Do Not Contact' ) as $val => $lbl ) : ?>
                    <option value="<?php echo esc_attr( $val ); ?>" <?php selected( $contact->status ?? 'active', $val ); ?>><?php echo esc_html( $lbl ); ?></option>
                    <?php endforeach; ?>
                </select>
            </div>
            <div class="oo-field"><label class="oo-label">Notes</label><textarea name="notes" class="oo-textarea"><?php echo esc_textarea( $contact->notes ?? '' ); ?></textarea></div>
        </div>
    </div>

    <div class="oo-wizard-actions">
        <button type="submit" class="oo-btn oo-btn-primary oo-btn-lg">Save Contact</button>
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-contacts' ) ); ?>" class="oo-btn oo-btn-secondary oo-btn-lg">Cancel</a>
    </div>
</form>

<?php else : ?>

<div class="oo-page-header">
    <h1 class="oo-page-title">Contacts</h1>
    <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-contacts&action=new' ) ); ?>" class="oo-btn oo-btn-secondary">+ Add Manually</a>
</div>

<?php if ( isset( $_GET['saved'] ) ) : ?><div class="oo-notice oo-notice-success">Contact saved.</div><?php endif; ?>
<?php if ( isset( $_GET['deleted'] ) ) : ?><div class="oo-notice oo-notice-success">Contact deleted.</div><?php endif; ?>

<?php
$type_filter = sanitize_text_field( $_GET['type_filter'] ?? '' );
$search = sanitize_text_field( $_GET['s'] ?? '' );
$where  = "WHERE 1=1";
if ( $type_filter ) $where .= $wpdb->prepare( " AND type = %s", $type_filter );
if ( $search ) {
    $like = '%' . $wpdb->esc_like( $search ) . '%';
    $where .= $wpdb->prepare( " AND (first_name LIKE %s OR last_name LIKE %s OR email LIKE %s OR company LIKE %s)", $like, $like, $like, $like );
}
$contacts = $wpdb->get_results( "SELECT * FROM {$wpdb->prefix}oo_contacts $where ORDER BY created_at DESC LIMIT 200" );
$total    = $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->prefix}oo_contacts $where" );
?>

<div class="oo-filters">
    <form method="get" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <input type="hidden" name="page" value="oo-contacts">
        <input type="search" name="s" class="oo-input" value="<?php echo esc_attr( $search ); ?>" placeholder="Search contacts..." style="width:220px">
        <select name="type_filter" class="oo-select" style="width:180px">
            <option value="">All Types</option>
            <?php foreach ( $types as $val => $label ) : ?>
            <option value="<?php echo esc_attr( $val ); ?>" <?php selected( $type_filter, $val ); ?>><?php echo esc_html( $label ); ?></option>
            <?php endforeach; ?>
        </select>
        <button type="submit" class="oo-btn oo-btn-secondary">Filter</button>
        <span class="oo-count"><?php echo intval( $total ); ?> contacts</span>
    </form>
</div>

<?php if ( $contacts ) : ?>
<div class="oo-table-wrap">
    <table class="oo-table">
        <thead><tr>
            <th>Name</th><th>Email</th><th>Company</th><th>Type</th><th>Location</th><th>Status</th><th>Added</th><th>Actions</th>
        </tr></thead>
        <tbody>
        <?php foreach ( $contacts as $c ) : ?>
        <tr>
            <td><strong><?php echo esc_html( trim( $c->first_name . ' ' . $c->last_name ) ?: '—' ); ?></strong></td>
            <td><?php echo esc_html( $c->email ); ?></td>
            <td><?php echo esc_html( $c->company ?: '—' ); ?></td>
            <td><?php echo esc_html( $types[ $c->type ] ?? $c->type ); ?></td>
            <td class="oo-muted"><?php echo esc_html( $c->location ?: '—' ); ?></td>
            <td><span class="oo-badge oo-badge-<?php echo $c->status === 'active' ? 'green' : 'grey'; ?>"><?php echo esc_html( ucfirst( str_replace( '_', ' ', $c->status ) ) ); ?></span></td>
            <td class="oo-muted"><?php echo esc_html( date( 'd M Y', strtotime( $c->created_at ) ) ); ?></td>
            <td>
                <div class="oo-row-actions">
                    <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-contacts&action=edit&id=' . $c->id ) ); ?>">Edit</a>
                    <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" onsubmit="return confirm('Delete this contact?')">
                        <?php wp_nonce_field( 'oo_delete_contact' ); ?>
                        <input type="hidden" name="action" value="oo_delete_contact">
                        <input type="hidden" name="contact_id" value="<?php echo esc_attr( $c->id ); ?>">
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
        <h3>No contacts yet</h3>
        <p>Use the Campaign Wizard to find contacts automatically via Hunter.io, or add them manually.</p>
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-contacts&action=new' ) ); ?>" class="oo-btn oo-btn-secondary">Add Manually</a>
    </div>
</div>
<?php endif; ?>

<?php endif; ?>
