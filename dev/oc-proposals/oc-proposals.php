<?php
/**
 * Plugin Name: October Proposals
 * Plugin URI: https://octobercomms.com
 * Description: Generates October's client proposals as an on-brand web page (video + animated process + accept/e-sign/pay) and a matching downloadable PDF, from a single source — built as a wizard. Foundation build.
 * Version: 0.5.0
 * Author: October Comms
 * Author URI: https://octobercomms.com
 * License: GPL v2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: oc-proposals
 * Requires at least: 6.0
 * Requires PHP: 7.4
 *
 * Repo app folder: dev/oc-proposals/ — WordPress plugin slug: oc-proposals.
 * Releases are tagged `ocp-v<version>`; the built-in self-updater installs them,
 * so the plugin is installed once and updated in place forever after.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'OCP_VERSION', '0.5.0' );
define( 'OCP_PATH', plugin_dir_path( __FILE__ ) );
define( 'OCP_URL', plugin_dir_url( __FILE__ ) );
define( 'OCP_BASENAME', plugin_basename( __FILE__ ) );
define( 'OCP_TAG_PREFIX', 'ocp-v' );
define( 'OCP_REPO', 'octobercomms/claude' );

require_once OCP_PATH . 'includes/class-ocp-db.php';
require_once OCP_PATH . 'includes/class-ocp-activator.php';
require_once OCP_PATH . 'includes/class-ocp-settings.php';
require_once OCP_PATH . 'includes/class-ocp-updater.php';
require_once OCP_PATH . 'includes/class-ocp-repo.php';
require_once OCP_PATH . 'includes/class-ocp-types.php';
require_once OCP_PATH . 'includes/class-ocp-library.php';
require_once OCP_PATH . 'includes/class-ocp-lead.php';
require_once OCP_PATH . 'includes/class-ocp-proposal.php';
require_once OCP_PATH . 'includes/class-ocp-terms.php';
require_once OCP_PATH . 'includes/class-ocp-render.php';
require_once OCP_PATH . 'includes/class-ocp-portal.php';
require_once OCP_PATH . 'includes/class-ocp-pdf.php';

if ( is_admin() ) {
	require_once OCP_PATH . 'admin/class-ocp-admin.php';
	require_once OCP_PATH . 'admin/class-ocp-admin-library.php';
	require_once OCP_PATH . 'admin/class-ocp-admin-crm.php';
	require_once OCP_PATH . 'admin/class-ocp-admin-proposals.php';
}

register_activation_hook( __FILE__, array( 'OCP_Activator', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'OCP_Activator', 'deactivate' ) );

add_action( 'plugins_loaded', 'ocp_bootstrap' );

/**
 * Wire up runtime services once all plugins are loaded.
 */
function ocp_bootstrap() {
	load_plugin_textdomain( 'oc-proposals', false, dirname( OCP_BASENAME ) . '/languages' );

	// Run a lightweight schema upgrade if the version moved (covers self-updates
	// where the activation hook does not fire).
	OCP_Activator::maybe_upgrade();

	// Public client portal + PDF download (front-end, token-addressed).
	OCP_Portal::init();
	OCP_PDF::init();

	if ( is_admin() ) {
		OCP_Admin::instance();
		OCP_Admin_Library::init();
		OCP_Admin_CRM::init();
		OCP_Admin_Proposals::init();
	}

	// Self-updater (private-repo aware). Only meaningful in admin, but cheap.
	$token = OCP_Settings::get( 'github_token' );
	if ( $token ) {
		new OCP_Updater( OCP_BASENAME, OCP_VERSION, OCP_REPO, $token, OCP_TAG_PREFIX );
	}
}
