<?php
/**
 * Uninstall cleanup for Another Country Lead Times.
 *
 * Removes the plugin's settings option. Supplier terms and their lead-time meta
 * are intentionally left in place — they are product taxonomy data the store may
 * still want even if the display plugin is removed.
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

delete_option( 'aclt_settings' );
