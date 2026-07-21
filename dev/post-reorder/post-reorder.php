<?php
/**
 * Plugin Name: OC Drag & Drop Post Reorder
 * Description: Adds drag-and-drop reordering to the admin list tables for posts,
 *              pages and custom post types, and makes that order the default
 *              everywhere on the front end.
 * Version:     1.0.0
 * Author:      October
 * License:     GPL-2.0-or-later
 *
 * ---------------------------------------------------------------------------
 * HOW TO USE
 * ---------------------------------------------------------------------------
 * Two options:
 *
 *   1. Drop this whole file into wp-content/plugins/ (or a subfolder) and
 *      activate it from Plugins → Installed Plugins. Recommended.
 *
 *   2. Or paste EVERYTHING BELOW the opening <?php tag into your theme's
 *      functions.php. If you paste it, delete the "Plugin Name:" header block
 *      above so WordPress doesn't try to read it as a plugin.
 *
 * By default every post type with an admin UI becomes reorderable (posts,
 * pages and any public CPT). To limit which post types are draggable, filter
 * 'oc_reorder_post_types' — see the bottom of this file for an example.
 * ---------------------------------------------------------------------------
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // No direct access.
}

if ( ! class_exists( 'OC_Post_Reorder' ) ) :

	class OC_Post_Reorder {

		/** @var string Nonce action name used for the AJAX save. */
		const NONCE = 'oc_post_reorder';

		/** @var string AJAX action name. */
		const ACTION = 'oc_post_reorder_save';

		/**
		 * Boot the feature by wiring up the hooks.
		 */
		public static function init() {
			$self = new self();

			add_action( 'admin_enqueue_scripts', array( $self, 'enqueue' ) );
			add_action( 'wp_ajax_' . self::ACTION, array( $self, 'ajax_save_order' ) );

			// Make menu_order the effective sort order, admin + front end.
			add_action( 'pre_get_posts', array( $self, 'apply_default_order' ) );

			return $self;
		}

		/**
		 * Which post types can be reordered?
		 *
		 * Defaults to every post type that shows an admin UI. Filterable so a
		 * site can opt in/out of specific types.
		 *
		 * @return string[]
		 */
		public function reorderable_post_types() {
			$types = get_post_types( array( 'show_ui' => true ), 'names' );

			// Types that make no sense to hand-order — drop them.
			unset( $types['attachment'] );

			/**
			 * Filter the list of reorderable post types.
			 *
			 * @param string[] $types Array of post type slugs.
			 */
			return (array) apply_filters( 'oc_reorder_post_types', array_values( $types ) );
		}

		/**
		 * Is the current admin list table in a state where drag-and-drop is
		 * meaningful? Reordering only makes sense on an unfiltered list that is
		 * already sorted by menu order — otherwise the visual order doesn't map
		 * cleanly onto menu_order and you'd get surprising results.
		 *
		 * @return bool
		 */
		private function screen_is_sortable() {
			// A search, a specific author filter, pagination beyond page 1, or a
			// non-default sort all break the 1:1 mapping to menu_order.
			if ( ! empty( $_GET['s'] ) || ! empty( $_GET['author'] ) ) {
				return false;
			}

			if ( isset( $_GET['orderby'] ) && 'menu_order title' !== $_GET['orderby'] ) {
				return false;
			}

			if ( isset( $_GET['order'] ) && 'asc' !== strtolower( $_GET['order'] ) ) {
				return false;
			}

			return true;
		}

		/**
		 * Enqueue the sortable UI on the relevant edit.php screens.
		 *
		 * @param string $hook Current admin page hook.
		 */
		public function enqueue( $hook ) {
			if ( 'edit.php' !== $hook ) {
				return;
			}

			$screen = get_current_screen();
			if ( ! $screen || ! in_array( $screen->post_type, $this->reorderable_post_types(), true ) ) {
				return;
			}

			if ( ! current_user_can( get_post_type_object( $screen->post_type )->cap->edit_posts ) ) {
				return;
			}

			wp_enqueue_script( 'jquery-ui-sortable' );

			$handle = 'oc-post-reorder';
			wp_register_script( $handle, '', array( 'jquery', 'jquery-ui-sortable' ), '1.0.0', true );
			wp_enqueue_script( $handle );
			wp_add_inline_script( $handle, $this->inline_js() );

			wp_add_inline_style( 'list-tables', $this->inline_css() );

			wp_localize_script(
				$handle,
				'ocPostReorder',
				array(
					'ajaxUrl'  => admin_url( 'admin-ajax.php' ),
					'action'   => self::ACTION,
					'nonce'    => wp_create_nonce( self::NONCE ),
					'postType' => $screen->post_type,
					'sortable' => $this->screen_is_sortable(),
					'i18n'     => array(
						'error' => __( 'Could not save the new order. Please reload and try again.', 'oc-post-reorder' ),
					),
				)
			);
		}

		/**
		 * Front-end + admin: order by menu_order (then title) unless the query
		 * already asked for a specific order.
		 *
		 * @param WP_Query $query
		 */
		public function apply_default_order( $query ) {
			$post_type = $query->get( 'post_type' );

			// Normalise: a query with no post_type on the main front-end loop is "post".
			if ( empty( $post_type ) ) {
				if ( $query->is_main_query() && ! is_admin() && ( $query->is_home() || $query->is_post_type_archive() ) ) {
					$post_type = 'post';
				} else {
					return;
				}
			}

			// Only single, reorderable post types.
			if ( is_array( $post_type ) ) {
				return;
			}
			if ( ! in_array( $post_type, $this->reorderable_post_types(), true ) ) {
				return;
			}

			// Respect an explicit orderby coming from the query/URL.
			if ( $query->get( 'orderby' ) ) {
				return;
			}

			$query->set( 'orderby', array( 'menu_order' => 'ASC', 'title' => 'ASC' ) );
		}

		/**
		 * AJAX: persist the new order.
		 *
		 * Expects a flat, ordered list of post IDs as they now appear, plus the
		 * page offset so the menu_order values continue correctly across pages.
		 */
		public function ajax_save_order() {
			check_ajax_referer( self::NONCE, 'nonce' );

			$post_type = isset( $_POST['post_type'] ) ? sanitize_key( wp_unslash( $_POST['post_type'] ) ) : '';
			$ids       = isset( $_POST['ids'] ) ? array_map( 'absint', (array) $_POST['ids'] ) : array();
			$start     = isset( $_POST['start'] ) ? absint( $_POST['start'] ) : 0;

			if ( ! $post_type || empty( $ids ) || ! in_array( $post_type, $this->reorderable_post_types(), true ) ) {
				wp_send_json_error( 'invalid_request', 400 );
			}

			$pto = get_post_type_object( $post_type );
			if ( ! $pto || ! current_user_can( $pto->cap->edit_posts ) ) {
				wp_send_json_error( 'forbidden', 403 );
			}

			$order = $start;
			foreach ( $ids as $id ) {
				if ( ! $id ) {
					continue;
				}

				// Type and per-post capability check.
				$post = get_post( $id );
				if ( ! $post || $post->post_type !== $post_type || ! current_user_can( 'edit_post', $id ) ) {
					continue;
				}

				$order++;

				if ( (int) $post->menu_order === $order ) {
					continue; // Already correct — skip the write.
				}

				// Direct, minimal update: only menu_order, no revision churn.
				wp_update_post(
					array(
						'ID'         => $id,
						'menu_order' => $order,
					)
				);
			}

			wp_send_json_success( array( 'next' => $order ) );
		}

		/**
		 * The client-side behaviour, kept inline so the whole feature is one file.
		 *
		 * @return string
		 */
		private function inline_js() {
			return <<<'JS'
( function ( $ ) {
	if ( typeof ocPostReorder === 'undefined' ) {
		return;
	}

	var cfg   = ocPostReorder;
	var $rows = $( '#the-list' );

	if ( ! $rows.length ) {
		return;
	}

	// If the list is filtered/searched/sorted, don't offer dragging — it would
	// write a misleading order. Leave a hint instead.
	if ( ! cfg.sortable ) {
		$rows.closest( 'table' ).before(
			'<div class="notice notice-info inline oc-reorder-hint"><p>' +
			'Drag-and-drop ordering is available when the list is unfiltered and sorted by the default order.' +
			'</p></div>'
		);
		return;
	}

	// Work out the offset of the first row so ordering stays correct on page 2+.
	var perPage = parseInt( $( '#current-page-selector' ).val() || 1, 10 );
	var start   = 0;
	var pageEl  = $( 'input.current-page' );
	if ( pageEl.length ) {
		var page   = parseInt( pageEl.val() || 1, 10 );
		var screen = parseInt( $( '#edit_post_per_page' ).val() || 0, 10 );
		if ( ! screen ) {
			// Fall back to counting the rows currently shown.
			screen = $rows.children( 'tr' ).length;
		}
		start = ( page - 1 ) * screen;
	}

	$rows.sortable( {
		items: '> tr',
		cursor: 'move',
		axis: 'y',
		handle: '.column-title, .row-title',
		helper: function ( e, tr ) {
			// Keep column widths while dragging so the row doesn't collapse.
			var $original = tr.children();
			var $helper   = tr.clone();
			$helper.children().each( function ( i ) {
				$( this ).width( $original.eq( i ).width() );
			} );
			return $helper;
		},
		start: function ( e, ui ) {
			ui.item.css( 'opacity', '0.5' );
		},
		stop: function ( e, ui ) {
			ui.item.css( 'opacity', '1' );
		},
		update: function () {
			var ids = $rows.children( 'tr' ).map( function () {
				// Row IDs look like "post-123".
				var id = this.id.replace( /^post-/, '' );
				return id ? parseInt( id, 10 ) : null;
			} ).get();

			$rows.sortable( 'disable' );

			$.post( cfg.ajaxUrl, {
				action: cfg.action,
				nonce: cfg.nonce,
				post_type: cfg.postType,
				ids: ids,
				start: start
			} ).done( function ( res ) {
				if ( ! res || ! res.success ) {
					window.alert( cfg.i18n.error );
				}
			} ).fail( function () {
				window.alert( cfg.i18n.error );
			} ).always( function () {
				$rows.sortable( 'enable' );
			} );
		}
	} );

	// Visual affordance on hover.
	$rows.on( 'mouseenter', '> tr .row-title, > tr .column-title', function () {
		$( this ).css( 'cursor', 'move' );
	} );
}( jQuery ) );
JS;
		}

		/**
		 * A little CSS to signal the rows are draggable.
		 *
		 * @return string
		 */
		private function inline_css() {
			return '
				.wp-list-table .ui-sortable-helper { display: table; background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,.25); }
				.wp-list-table .ui-sortable-placeholder { visibility: visible !important; background: #f0f6fc; }
				.wp-list-table .ui-sortable-placeholder td { border-bottom: 2px dashed #2271b1; }
				.oc-reorder-hint { margin: 6px 0; }
			';
		}
	}

	OC_Post_Reorder::init();

endif;

/**
 * ---------------------------------------------------------------------------
 * OPTIONAL: limit which post types are draggable.
 * ---------------------------------------------------------------------------
 * Uncomment and edit to restrict reordering to specific post types only.
 *
 * add_filter( 'oc_reorder_post_types', function () {
 *     return array( 'post', 'product', 'team_member' );
 * } );
 */
