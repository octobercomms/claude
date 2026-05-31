<?php if ( ! defined( 'ABSPATH' ) ) exit;

$current_page = $current_page ?? '';
?>
<div class="oo-main">
    <?php if ( ! OO_License::is_active() && $current_page !== 'settings' ) : ?>
    <div class="oo-license-banner">
        <strong>No active license.</strong>
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-settings' ) ); ?>">Enter your license key →</a>
    </div>
    <?php endif; ?>
    <div class="oo-content">
