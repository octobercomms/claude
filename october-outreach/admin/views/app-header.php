<?php if ( ! defined( 'ABSPATH' ) ) exit;

$current_page = $current_page ?? '';
$license      = OO_License::get_status_label();
$nav_items    = array(
    'dashboard' => array( 'label' => 'Dashboard',      'page' => 'october-outreach', 'icon' => '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>' ),
    'campaigns' => array( 'label' => 'Campaigns',      'page' => 'oo-campaigns',     'icon' => '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>' ),
    'contacts'  => array( 'label' => 'Contacts',       'page' => 'oo-contacts',      'icon' => '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' ),
    'press'     => array( 'label' => 'Press Releases',  'page' => 'oo-press',         'icon' => '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/></svg>' ),
    'settings'  => array( 'label' => 'Settings',        'page' => 'oo-settings',      'icon' => '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>' ),
    'help'      => array( 'label' => 'Help & Support',  'page' => 'oo-help',          'icon' => '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' ),
);
?>
<div class="oo-app">

    <aside class="oo-sidebar">
        <div class="oo-sidebar-brand">
            <?php
            $logo_local = OO_PLUGIN_DIR . 'admin/img/october-logo.gif';
            $logo_src   = file_exists( $logo_local )
                ? OO_PLUGIN_URL . 'admin/img/october-logo.gif'
                : 'https://octobercomms.com/wp-content/uploads/2025/12/October-Logo-Animated-BlackBG.gif';
            ?>
            <img src="<?php echo esc_url( $logo_src ); ?>" alt="October Comms" style="width:100%;height:auto;display:block;border-radius:4px;margin-bottom:10px">
            <div style="font-size:13px;font-weight:700;color:#fff;line-height:1.2">October Outreach</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.35);margin-top:3px;letter-spacing:0.02em">Powered by Claude AI</div>
        </div>

        <nav class="oo-sidebar-nav">
            <?php foreach ( $nav_items as $key => $item ) :
                $is_active = ( $current_page === $key );
                $url = admin_url( 'admin.php?page=' . $item['page'] );
            ?>
            <a href="<?php echo esc_url( $url ); ?>" class="oo-nav-item <?php echo $is_active ? 'active' : ''; ?>">
                <?php echo $item['icon']; ?>
                <span><?php echo esc_html( $item['label'] ); ?></span>
            </a>
            <?php endforeach; ?>
        </nav>

        <div class="oo-sidebar-footer">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,.06)">
                <img src="<?php echo esc_url( OO_PLUGIN_URL . 'admin/img/ai-icon.svg' ); ?>" alt="" class="oo-ai-icon">
                <span style="font-size:11px;color:rgba(255,255,255,0.35);letter-spacing:0.02em">Powered by Claude AI</span>
            </div>
            <div class="oo-sidebar-status">
                <span class="oo-status-dot oo-status-dot--<?php echo $license['color']; ?>"></span>
                <span class="oo-status-label"><?php echo $license['status'] === 'active' ? 'Licensed' : 'No License'; ?></span>
            </div>
            <a href="<?php echo esc_url( admin_url() ); ?>" class="oo-wp-link">← WP Admin</a>
            <div class="oo-version">v<?php echo OO_VERSION; ?></div>
        </div>
    </aside>

    <main class="oo-main">
        <?php if ( ! OO_License::is_active() && $current_page !== 'settings' ) : ?>
        <div class="oo-license-banner">
            <strong>No active license.</strong>
            <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-settings' ) ); ?>">Enter your license key →</a>
        </div>
        <?php endif; ?>
        <div class="oo-content">
