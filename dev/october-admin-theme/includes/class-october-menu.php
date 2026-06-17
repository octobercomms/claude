<?php
/**
 * The admin menu — grouped, Squarespace-style, with a collapsible "Advanced".
 *
 * Instead of one flat list, the sidebar is organised into labelled groups
 * ("Website Content", "Analytics", "Settings") with a small grey header above
 * each — mirroring Squarespace's "Main Navigation / Not Linked" pattern. Bigger
 * nav text, smaller sub-nav, more breathing room (the spacing is in the CSS).
 *
 * Anything not placed in a group is folded into a collapsible "Advanced" section
 * at the bottom, and "View Site" / "Log Out" sit below that (the WordPress
 * toolbar is removed, so this is where those live now).
 *
 * Nothing is destroyed — items are only reordered, grouped, or hidden behind
 * Advanced. Everything is filterable so each client site can tune its own shape.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class October_Admin_Menu {

	public function __construct() {
		// Run dead last so every plugin (incl. Crocoblock/JetEngine) has already
		// registered its menu items and separators before we reshape the menu.
		add_action( 'admin_menu', [ $this, 'reorganize' ], PHP_INT_MAX );
	}

	/**
	 * Group definitions: an ordered list of [ label, slugs ]. The first group's
	 * empty label keeps the Dashboard header-less at the very top. Items are
	 * emitted in the order their slugs appear here.
	 *
	 * Custom post types use 'edit.php?post_type=<slug>' — add the site's CPTs
	 * (e.g. 'edit.php?post_type=tour') via the filter.
	 */
	private function groups() {
		$defaults = [
			[
				'label' => '',
				'slugs' => [ 'index.php' ],
			],
			[
				'label' => __( 'Website Content', 'october-admin-theme' ),
				'slugs' => [
					'edit.php?post_type=page',
					'edit.php',
					'upload.php',
					'edit-comments.php',
					'gf_edit_forms',
					'edit.php?post_type=product',
				],
			],
			[
				'label' => __( 'Analytics', 'october-admin-theme' ),
				'slugs' => [
					'googlesitekit-dashboard',
					'wpseo_dashboard',
					'wc-admin&path=/analytics/overview',
				],
			],
			[
				'label' => __( 'Settings', 'october-admin-theme' ),
				'slugs' => [
					'options-general.php',
					'users.php',
				],
			],
		];

		return (array) apply_filters( 'october_admin_menu_groups', $defaults );
	}

	/**
	 * Top-level slugs to remove from the menu entirely (not just fold into
	 * Advanced). Use for vendor labels you never want to see. Filterable.
	 */
	private function remove_slugs() {
		return (array) apply_filters( 'october_admin_remove_menus', [] );
	}

	public function reorganize() {
		global $menu;

		if ( empty( $menu ) || ! is_array( $menu ) ) {
			return;
		}

		if ( ! apply_filters( 'october_admin_simplify_menu', true ) ) {
			return;
		}

		$groups  = $this->groups();
		$remove  = $this->remove_slugs();

		// Index the real menu items by slug, dropping separators (incl. the dark
		// vendor "PLUGINS / POST TYPES" labels Crocoblock injects as separators)
		// and any explicitly removed slugs.
		$items = [];
		foreach ( $menu as $item ) {
			if ( isset( $item[4] ) && false !== strpos( $item[4], 'wp-menu-separator' ) ) {
				continue;
			}
			$slug = isset( $item[2] ) ? $item[2] : '';
			if ( '' === $slug || in_array( $slug, $remove, true ) ) {
				continue;
			}
			$items[ $slug ] = $item;
		}

		$new     = [];
		$pos     = 1;
		$used    = [];

		// Emit each group: a header row (when labelled) then its items in order.
		foreach ( $groups as $group ) {
			$group_items = [];
			foreach ( $group['slugs'] as $slug ) {
				if ( isset( $items[ $slug ] ) ) {
					$group_items[ $slug ] = $items[ $slug ];
				}
			}
			if ( empty( $group_items ) ) {
				continue;
			}

			if ( ! empty( $group['label'] ) ) {
				$new[ $pos++ ] = $this->header_row( $group['label'], $pos );
			}
			foreach ( $group_items as $slug => $item ) {
				$new[ $pos++ ] = $item;
				$used[ $slug ] = true;
			}
		}

		// Whatever is left over becomes the Advanced section.
		$advanced = [];
		foreach ( $items as $slug => $item ) {
			if ( isset( $used[ $slug ] ) ) {
				continue;
			}
			$item[4]    = trim( ( isset( $item[4] ) ? $item[4] : '' ) . ' oc-advanced-item' );
			$advanced[] = $item;
		}

		if ( ! empty( $advanced ) ) {
			$new[ $pos++ ] = [
				__( 'Advanced', 'october-admin-theme' ),
				'read',
				'#oc-advanced',
				'',
				'menu-top oc-advanced-toggle',
				'oc-advanced-toggle',
				'',
			];
			foreach ( $advanced as $item ) {
				$new[ $pos++ ] = $item;
			}
		}

		// Utility links at the very bottom (toolbar is gone, so logout lives here).
		// Slugs are placeholders; admin-script.js sets the real hrefs (passing a
		// full URL as a menu slug isn't reliable across WP versions).
		$new[ $pos++ ] = [
			__( 'View Site', 'october-admin-theme' ),
			'read',
			'#oc-view-site',
			'',
			'menu-top oc-utility oc-utility-first oc-view-site-item',
			'oc-view-site',
			'dashicons-external',
		];
		$new[ $pos++ ] = [
			__( 'Log Out', 'october-admin-theme' ),
			'read',
			'#oc-log-out',
			'',
			'menu-top oc-utility oc-log-out-item',
			'oc-log-out',
			'dashicons-exit',
		];

		$menu = $new;
	}

	/**
	 * Build a non-clickable group-header menu row.
	 */
	private function header_row( $label, $pos ) {
		return [
			$label,
			'read',
			'#oc-group-' . $pos,
			'',
			'menu-top oc-group-header',
			'oc-group-' . $pos,
			'',
		];
	}
}
