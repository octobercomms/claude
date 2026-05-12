<?php if ( ! defined( 'ABSPATH' ) ) exit;
global $wpdb;
$brands = OO_Database::get_brands();
$types  = OO_Database::get_campaign_types();
$colours = array( 'draft' => 'grey', 'active' => 'green', 'paused' => 'orange', 'complete' => 'blue' );
?>

<div class="oo-page-header">
    <h1 class="oo-page-title">Campaigns</h1>
    <div class="oo-page-actions">
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-campaigns&action=wizard' ) ); ?>" class="oo-btn oo-btn-primary">+ New Campaign</a>
    </div>
</div>

<?php if ( isset( $_GET['saved'] ) ) : ?>
<div class="oo-notice oo-notice-success">Campaign saved.</div>
<?php endif; ?>
<?php if ( isset( $_GET['deleted'] ) ) : ?>
<div class="oo-notice oo-notice-success">Campaign deleted.</div>
<?php endif; ?>

<?php $campaigns = $wpdb->get_results( "SELECT * FROM {$wpdb->prefix}oo_campaigns ORDER BY created_at DESC" ); ?>

<?php if ( $campaigns ) : ?>
<div class="oo-table-wrap">
    <table class="oo-table">
        <thead><tr>
            <th>Campaign</th><th>Brand</th><th>Type</th><th>From</th><th>Status</th><th>Created</th><th>Actions</th>
        </tr></thead>
        <tbody>
        <?php foreach ( $campaigns as $c ) : ?>
        <tr>
            <td>
                <strong><?php echo esc_html( $c->name ); ?></strong>
                <?php if ( $c->audience_description ) : ?>
                <br><span class="oo-muted"><?php echo esc_html( wp_trim_words( $c->audience_description, 10 ) ); ?></span>
                <?php endif; ?>
            </td>
            <td><?php echo esc_html( $brands[ $c->brand ] ?? $c->brand ); ?></td>
            <td><?php echo esc_html( $types[ $c->type ] ?? $c->type ); ?></td>
            <td class="oo-muted"><?php echo esc_html( $c->from_email ?: '—' ); ?></td>
            <td><span class="oo-badge oo-badge-<?php echo esc_attr( $colours[ $c->status ] ?? 'grey' ); ?>"><?php echo esc_html( ucfirst( $c->status ) ); ?></span></td>
            <td class="oo-muted"><?php echo esc_html( date( 'd M Y', strtotime( $c->created_at ) ) ); ?></td>
            <td>
                <div class="oo-row-actions">
                    <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-campaigns&action=wizard&id=' . $c->id ) ); ?>">Open Wizard</a>
                    <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" onsubmit="return confirm('Delete this campaign?')">
                        <?php wp_nonce_field( 'oo_delete_campaign' ); ?>
                        <input type="hidden" name="action" value="oo_delete_campaign">
                        <input type="hidden" name="campaign_id" value="<?php echo esc_attr( $c->id ); ?>">
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
        <h3>No campaigns yet</h3>
        <p>The wizard guides you through finding contacts, writing emails with Claude, and launching your outreach.</p>
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-campaigns&action=wizard' ) ); ?>" class="oo-btn oo-btn-primary">Start Your First Campaign</a>
    </div>
</div>
<?php endif; ?>
