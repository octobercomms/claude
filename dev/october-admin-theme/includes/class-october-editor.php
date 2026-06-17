<?php
/**
 * Bundles the "Classic Editor" behaviour so the standalone Classic Editor plugin
 * is no longer needed. This forces the classic TinyMCE editor everywhere and
 * turns the block editor (Gutenberg) off — for posts, pages, every custom post
 * type, and the widgets screen.
 *
 * It's the same set of filters the official Classic Editor plugin uses for its
 * "classic editor for all users, no switching" mode, so behaviour matches and
 * existing content keeps opening in the classic editor.
 *
 * Reversible: filter `october_admin_disable_block_editor` => false to turn the
 * block editor back on without deactivating the whole theme.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class October_Admin_Editor {

	public function __construct() {
		if ( ! apply_filters( 'october_admin_disable_block_editor', true ) ) {
			return;
		}

		// Disable the block editor for posts, pages and all custom post types.
		add_filter( 'use_block_editor_for_post', '__return_false', 100 );
		add_filter( 'use_block_editor_for_post_type', '__return_false', 100 );

		// Disable the block-based widgets screen (classic widgets instead).
		add_filter( 'use_widgets_block_editor', '__return_false' );
		add_filter( 'gutenberg_use_widgets_block_editor', '__return_false' );

		// Don't load block-editor assets/styles on the front end when unused.
		add_action( 'wp_enqueue_scripts', [ $this, 'dequeue_block_assets' ], 100 );

		// Remove the "Try Gutenberg" dashboard prompt on older installs.
		remove_action( 'try_gutenberg_panel', 'wp_try_gutenberg_panel' );
	}

	/**
	 * Strip the global block-library CSS from the front end. Classic content
	 * doesn't need it, and it's a needless render-blocking request.
	 */
	public function dequeue_block_assets() {
		wp_dequeue_style( 'wp-block-library' );
		wp_dequeue_style( 'wp-block-library-theme' );
		wp_dequeue_style( 'global-styles' );
	}
}
