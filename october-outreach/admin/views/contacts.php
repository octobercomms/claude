<?php if ( ! defined( 'ABSPATH' ) ) exit; ?>

<?php
global $wpdb;
$action = $_GET['action'] ?? 'list';
$contact_id = intval( $_GET['id'] ?? 0 );
$contact = null;

if ( in_array( $action, array( 'edit', 'view' ) ) && $contact_id ) {
    $contact = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}oo_contacts WHERE id = %d", $contact_id ) );
    if ( ! $contact ) {
        $action = 'list';
    }
}

$types = OO_Database::get_contact_types();
?>

<div class="wrap oo-wrap">

<?php if ( $action === 'new' || $action === 'edit' ) : ?>

    <h1 class="oo-page-title"><?php echo $action === 'new' ? 'Add Contact' : 'Edit Contact'; ?></h1>
    <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-contacts' ) ); ?>" class="page-title-action">Back to Contacts</a>

    <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="oo-form">
        <?php wp_nonce_field( 'oo_save_contact' ); ?>
        <input type="hidden" name="action" value="oo_save_contact">
        <input type="hidden" name="contact_id" value="<?php echo esc_attr( $contact_id ); ?>">

        <div class="oo-card">
            <h2>Contact Details</h2>
            <table class="form-table">
                <tr>
                    <th><label for="first_name">First Name</label></th>
                    <td><input type="text" id="first_name" name="first_name" value="<?php echo esc_attr( $contact->first_name ?? '' ); ?>" class="regular-text" required></td>
                </tr>
                <tr>
                    <th><label for="last_name">Last Name</label></th>
                    <td><input type="text" id="last_name" name="last_name" value="<?php echo esc_attr( $contact->last_name ?? '' ); ?>" class="regular-text"></td>
                </tr>
                <tr>
                    <th><label for="email">Email</label></th>
                    <td><input type="email" id="email" name="email" value="<?php echo esc_attr( $contact->email ?? '' ); ?>" class="regular-text" required></td>
                </tr>
                <tr>
                    <th><label for="company">Company / Practice</label></th>
                    <td><input type="text" id="company" name="company" value="<?php echo esc_attr( $contact->company ?? '' ); ?>" class="regular-text"></td>
                </tr>
                <tr>
                    <th><label for="type">Contact Type</label></th>
                    <td>
                        <select id="type" name="type">
                            <option value="">— Select type —</option>
                            <?php foreach ( $types as $val => $label ) : ?>
                            <option value="<?php echo esc_attr( $val ); ?>" <?php selected( $contact->type ?? '', $val ); ?>><?php echo esc_html( $label ); ?></option>
                            <?php endforeach; ?>
                        </select>
                    </td>
                </tr>
                <tr>
                    <th><label for="location">Location</label></th>
                    <td><input type="text" id="location" name="location" value="<?php echo esc_attr( $contact->location ?? '' ); ?>" class="regular-text" placeholder="e.g. London, UK"></td>
                </tr>
                <tr>
                    <th><label for="linkedin_url">LinkedIn URL</label></th>
                    <td><input type="url" id="linkedin_url" name="linkedin_url" value="<?php echo esc_attr( $contact->linkedin_url ?? '' ); ?>" class="regular-text"></td>
                </tr>
                <tr>
                    <th><label for="source">Source</label></th>
                    <td><input type="text" id="source" name="source" value="<?php echo esc_attr( $contact->source ?? '' ); ?>" class="regular-text" placeholder="e.g. Hunter.io, Manual, Import"></td>
                </tr>
                <tr>
                    <th><label for="status">Status</label></th>
                    <td>
                        <select id="status" name="status">
                            <option value="active" <?php selected( $contact->status ?? 'active', 'active' ); ?>>Active</option>
                            <option value="unsubscribed" <?php selected( $contact->status ?? '', 'unsubscribed' ); ?>>Unsubscribed</option>
                            <option value="bounced" <?php selected( $contact->status ?? '', 'bounced' ); ?>>Bounced</option>
                            <option value="do_not_contact" <?php selected( $contact->status ?? '', 'do_not_contact' ); ?>>Do Not Contact</option>
                        </select>
                    </td>
                </tr>
                <tr>
                    <th><label for="notes">Notes</label></th>
                    <td><textarea id="notes" name="notes" rows="4" class="large-text"><?php echo esc_textarea( $contact->notes ?? '' ); ?></textarea></td>
                </tr>
            </table>
        </div>

        <p class="submit">
            <button type="submit" class="button button-primary button-large">Save Contact</button>
            <?php if ( $contact_id ) : ?>
            <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-contacts' ) ); ?>" class="button button-large">Cancel</a>
            <?php endif; ?>
        </p>
    </form>

<?php else : ?>

    <h1 class="oo-page-title">Contacts
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-contacts&action=new' ) ); ?>" class="page-title-action">Add New</a>
    </h1>

    <?php if ( isset( $_GET['saved'] ) ) : ?>
    <div class="notice notice-success is-dismissible"><p>Contact saved.</p></div>
    <?php endif; ?>
    <?php if ( isset( $_GET['deleted'] ) ) : ?>
    <div class="notice notice-success is-dismissible"><p>Contact deleted.</p></div>
    <?php endif; ?>

    <?php
    $type_filter = sanitize_text_field( $_GET['type_filter'] ?? '' );
    $search = sanitize_text_field( $_GET['s'] ?? '' );
    $where = "WHERE 1=1";
    if ( $type_filter ) {
        $where .= $wpdb->prepare( " AND type = %s", $type_filter );
    }
    if ( $search ) {
        $where .= $wpdb->prepare( " AND (first_name LIKE %s OR last_name LIKE %s OR email LIKE %s OR company LIKE %s)",
            '%' . $wpdb->esc_like( $search ) . '%',
            '%' . $wpdb->esc_like( $search ) . '%',
            '%' . $wpdb->esc_like( $search ) . '%',
            '%' . $wpdb->esc_like( $search ) . '%'
        );
    }
    $contacts = $wpdb->get_results( "SELECT * FROM {$wpdb->prefix}oo_contacts $where ORDER BY created_at DESC LIMIT 100" );
    $total = $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->prefix}oo_contacts $where" );
    ?>

    <div class="oo-filters">
        <form method="get">
            <input type="hidden" name="page" value="oo-contacts">
            <input type="search" name="s" value="<?php echo esc_attr( $search ); ?>" placeholder="Search contacts...">
            <select name="type_filter">
                <option value="">All Types</option>
                <?php foreach ( $types as $val => $label ) : ?>
                <option value="<?php echo esc_attr( $val ); ?>" <?php selected( $type_filter, $val ); ?>><?php echo esc_html( $label ); ?></option>
                <?php endforeach; ?>
            </select>
            <button type="submit" class="button">Filter</button>
            <span class="oo-count"><?php echo intval( $total ); ?> contacts</span>
        </form>
    </div>

    <?php if ( $contacts ) : ?>
    <table class="wp-list-table widefat fixed striped oo-table">
        <thead>
            <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Company</th>
                <th>Type</th>
                <th>Location</th>
                <th>Status</th>
                <th>Added</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody>
            <?php foreach ( $contacts as $c ) : ?>
            <tr>
                <td><strong><?php echo esc_html( trim( $c->first_name . ' ' . $c->last_name ) ); ?></strong></td>
                <td><?php echo esc_html( $c->email ); ?></td>
                <td><?php echo esc_html( $c->company ); ?></td>
                <td><?php echo esc_html( $types[ $c->type ] ?? $c->type ); ?></td>
                <td><?php echo esc_html( $c->location ); ?></td>
                <td><span class="oo-badge oo-badge-<?php echo $c->status === 'active' ? 'green' : 'grey'; ?>"><?php echo esc_html( ucfirst( str_replace( '_', ' ', $c->status ) ) ); ?></span></td>
                <td><?php echo esc_html( date( 'd M Y', strtotime( $c->created_at ) ) ); ?></td>
                <td class="oo-actions">
                    <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-contacts&action=edit&id=' . $c->id ) ); ?>">Edit</a>
                    <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline" onsubmit="return confirm('Delete this contact?')">
                        <?php wp_nonce_field( 'oo_delete_contact' ); ?>
                        <input type="hidden" name="action" value="oo_delete_contact">
                        <input type="hidden" name="contact_id" value="<?php echo esc_attr( $c->id ); ?>">
                        <button type="submit" class="button-link-delete">Delete</button>
                    </form>
                </td>
            </tr>
            <?php endforeach; ?>
        </tbody>
    </table>
    <?php else : ?>
    <div class="oo-card">
        <p class="oo-empty">No contacts found. <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-contacts&action=new' ) ); ?>">Add one manually</a> or use a campaign to find contacts automatically.</p>
    </div>
    <?php endif; ?>

<?php endif; ?>
</div>
