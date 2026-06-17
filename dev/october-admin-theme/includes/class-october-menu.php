<?php
/**
 * The "Advanced" section — the heart of making WP feel Squarespace-simple.
 *
 * Strategy: we do NOT delete anything. We reorder the admin menu so the handful
 * of items a client uses every day sit at the top, then drop a collapsible
 * "Advanced" divider, and tag everything else so CSS hides it until the user
 * opens Advanced. Nothing is removed, so power users lose no access and we never
 * break a plugin that expects its menu page to exist.
 *
 * Doing this in PHP (not JS) means the menu arrives already correct — no flash
 * of the cluttered menu, no layout shift. That is both calmer and faster.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class October_Admin_Menu {

	public function __construct() {
		// Late priority so plugins have already registered their menu items.
		add_action( 'admin_menu', [ $this, 'reorganize' ], 9999 );
	}

	/**
	 * Top-level menu slugs that stay visible by default. Everything else is
	 * folded into Advanced. Filterable so each client site can tune its own list.
	 */
	private function essentials() {
		$defaults = [
			'index.php',                      // Dashboard
			'edit.php?post_type=page',        // Pages
			'edit.php',                       // Posts
			'upload.php',                     // Media
			'edit-comments.php',              // Comments
			'woocommerce',                    // WooCommerce
			'gf_edit_forms',                  // Gravity Forms
		];

		/**
		 * Filter the always-visible top-level menu slugs.
		 *
		 * Custom post types use 'edit.php?post_type=<slug>'. For this site that
		 * means e.g. 'edit.php?post_type=tour' and 'edit.php?post_type=travel_tip'.
		 */
		return (array) apply_filters( 'october_admin_essentials', $defaults );
	}

	public function reorganize() {
		global $menu;

		if ( empty( $menu ) || ! is_array( $menu ) ) {
			return;
		}

		// Let admins opt out entirely via filter (e.g. show everything to devs).
		if ( ! apply_filters( 'october_admin_simplify_menu', true ) ) {
			return;
		}

		$essentials = $this->essentials();
		$essential  = [];
		$advanced   = [];

		foreach ( $menu as $item ) {
			// Drop WordPress's own separators; we add our own in the right place.
			if ( isset( $item[4] ) && false !== strpos( $item[4], 'wp-menu-separator' ) ) {
				continue;
			}

			$slug = isset( $item[2] ) ? $item[2] : '';

			if ( in_array( $slug, $essentials, true ) ) {
				$essential[] = $item;
			} else {
				// Tag so CSS can hide it until "Advanced" is expanded.
				$item[4] = trim( ( isset( $item[4] ) ? $item[4] : '' ) . ' oc-advanced-item' );
				$advanced[] = $item;
			}
		}

		// Nothing to fold away — leave the menu untouched.
		if ( empty( $advanced ) ) {
			return;
		}

		$new = [];
		$pos = 3;

		foreach ( $essential as $item ) {
			$new[ $pos++ ] = $item;
		}

		// Divider + the Advanced toggle (a real menu row; JS intercepts the click).
		$new[ $pos++ ] = [ '', 'read', 'oc-advanced-separator', '', 'wp-menu-separator oc-advanced-separator' ];
		$new[ $pos++ ] = [
			__( 'Advanced', 'october-admin-theme' ),
			'read',
			'#oc-advanced',
			'',
			'menu-top oc-advanced-toggle',
			'oc-advanced-toggle',
			'dashicons-ellipsis',
		];

		foreach ( $advanced as $item ) {
			$new[ $pos++ ] = $item;
		}

		$menu = $new;
	}
}
