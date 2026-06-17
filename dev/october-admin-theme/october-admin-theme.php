<?php
/**
 * Plugin Name: October Admin Theme
 * Plugin URI:  https://octobercomms.com
 * Description: Makes the WordPress admin calm and Squarespace-simple — a monochrome black/white/grey skin with underline accents, a grouped sidebar with labelled sections, generous whitespace, a collapsible "Advanced" group, no WordPress toolbar, and the classic editor (no Gutenberg). Fast: one small stylesheet, one tiny script, system fonts, no external requests.
 * Version:     2.2.3
 * Author:      October Comms
 * Author URI:  https://octobercomms.com
 * License:     GPL-2.0-or-later
 * Text Domain: october-admin-theme
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'OCTOBER_THEME_VERSION', '2.2.3' );
define( 'OCTOBER_THEME_URL', plugin_dir_url( __FILE__ ) );
define( 'OCTOBER_THEME_PATH', plugin_dir_path( __FILE__ ) );

require_once OCTOBER_THEME_PATH . 'includes/class-october-assets.php';
require_once OCTOBER_THEME_PATH . 'includes/class-october-menu.php';
require_once OCTOBER_THEME_PATH . 'includes/class-october-dashboard.php';
require_once OCTOBER_THEME_PATH . 'includes/class-october-cleanup.php';
require_once OCTOBER_THEME_PATH . 'includes/class-october-editor.php';

/**
 * Boot the plugin once on `plugins_loaded` so every piece hooks in predictably.
 */
function october_admin_theme_init() {
	new October_Admin_Assets();
	new October_Admin_Menu();
	new October_Admin_Dashboard();
	new October_Admin_Cleanup();
	new October_Admin_Editor();
}
add_action( 'plugins_loaded', 'october_admin_theme_init' );
