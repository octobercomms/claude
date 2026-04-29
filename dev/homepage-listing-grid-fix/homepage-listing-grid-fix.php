<?php
/**
 * Plugin Name: Architourian Homepage Listing Grid Fix
 * Description: Fixes JetEngine Listing Grid showing "No data was found" on the static front page by removing page-context query args that prevent CPT posts from loading.
 * Version: 1.0.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_filter( 'jet-engine/listing/grid/query-args', function ( $args ) {
	if ( ! is_front_page() ) {
		return $args;
	}

	// On the static front page WordPress injects page_id/p into the main query,
	// which causes the Listing Grid (legacy query mode) to return no CPT posts.
	unset( $args['page_id'] );
	unset( $args['p'] );
	unset( $args['pagename'] );

	return $args;
} );
