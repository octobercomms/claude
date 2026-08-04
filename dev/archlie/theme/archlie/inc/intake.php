<?php
/**
 * Archlie — project records + intake (AJAX).
 *
 * Registers the `archlie_project` custom post type (the "project record" from
 * Brief v3 §6) and handles the builder's submit over admin-ajax with a nonce.
 * On submit it opens a project record with the full package/state and emails
 * the studio and the client.
 *
 * Scope note: the brief's full spec creates the record on the FIRST message and
 * persists anonymously in PostgreSQL. That belongs to the React/Postgres build
 * (§11). Here the client-side builder persists to localStorage as you chat, and
 * this handler opens the WordPress record at submit — the natural WP analogue.
 *
 * @package Archlie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Register the project-record post type.
 */
function archlie_register_project_cpt() {
	register_post_type(
		'archlie_project',
		array(
			'labels' => array(
				'name'          => __( 'Projects', 'archlie' ),
				'singular_name' => __( 'Project', 'archlie' ),
				'menu_name'     => __( 'Your Architect Projects', 'archlie' ),
				'edit_item'     => __( 'Project record', 'archlie' ),
				'search_items'  => __( 'Search projects', 'archlie' ),
			),
			'public'              => false,
			'show_ui'             => true,
			'show_in_menu'        => true,
			'menu_icon'           => 'dashicons-portfolio',
			'menu_position'       => 25,
			'capability_type'     => 'post',
			'map_meta_cap'        => true,
			'supports'            => array( 'title' ),
			'exclude_from_search' => true,
			'has_archive'         => false,
			'rewrite'             => false,
		)
	);
}
add_action( 'init', 'archlie_register_project_cpt' );

/**
 * Where new-project notifications are sent.
 *
 * @return string
 */
function archlie_notify_email() {
	$email = get_theme_mod( 'archlie_notify_email', get_option( 'admin_email' ) );
	return is_email( $email ) ? $email : get_option( 'admin_email' );
}

/**
 * AJAX: handle a builder submission.
 */
function archlie_handle_intake() {
	check_ajax_referer( 'archlie_intake', 'nonce' );

	$raw     = isset( $_POST['payload'] ) ? wp_unslash( $_POST['payload'] ) : '';
	$payload = json_decode( $raw, true );
	if ( ! is_array( $payload ) ) {
		wp_send_json_error( array( 'message' => __( 'We couldn’t read your project. Please try again.', 'archlie' ) ), 400 );
	}

	// Sanitise the fields we store.
	$name     = isset( $payload['name'] ) ? sanitize_text_field( $payload['name'] ) : '';
	$email    = isset( $payload['email'] ) ? sanitize_email( $payload['email'] ) : '';
	$postcode = isset( $payload['postcode'] ) ? sanitize_text_field( $payload['postcode'] ) : '';
	$package     = isset( $payload['package'] ) ? sanitize_key( $payload['package'] ) : '';
	$projectType = isset( $payload['projectType'] ) ? sanitize_key( $payload['projectType'] ) : '';
	$storeys     = isset( $payload['storeys'] ) ? sanitize_key( $payload['storeys'] ) : '';
	$total       = isset( $payload['total'] ) ? (int) $payload['total'] : 0;
	$redirect    = ! empty( $payload['redirect'] ) || 'riba' === $package;

	$flags = array();
	foreach ( array( 'london', 'submitApp', 'siteVisit', 'survey', 'structural' ) as $k ) {
		$flags[ $k ] = ! empty( $payload[ $k ] );
	}
	$timeframe = isset( $payload['timeframe'] ) ? sanitize_text_field( $payload['timeframe'] ) : '';
	$brief     = isset( $payload['brief'] ) ? sanitize_textarea_field( $payload['brief'] ) : '';
	$photoDesc = isset( $payload['photoDesc'] ) ? sanitize_textarea_field( $payload['photoDesc'] ) : '';

	$title = ( $name ? $name : __( 'Anonymous', 'archlie' ) ) . ' — ' . ( $postcode ? strtoupper( $postcode ) : __( 'no postcode', 'archlie' ) );
	$post_id = wp_insert_post(
		array(
			'post_type'   => 'archlie_project',
			'post_status' => 'pending',
			'post_title'  => $title,
		),
		true
	);
	if ( is_wp_error( $post_id ) ) {
		wp_send_json_error( array( 'message' => __( 'Something went wrong saving your project. Please try again.', 'archlie' ) ), 500 );
	}

	update_post_meta( $post_id, '_archlie_name', $name );
	update_post_meta( $post_id, '_archlie_email', $email );
	update_post_meta( $post_id, '_archlie_postcode', $postcode );
	update_post_meta( $post_id, '_archlie_package', $package );
	update_post_meta( $post_id, '_archlie_project_type', $projectType );
	update_post_meta( $post_id, '_archlie_storeys', $storeys );
	update_post_meta( $post_id, '_archlie_total', $total );
	update_post_meta( $post_id, '_archlie_redirect', $redirect ? '1' : '0' );
	update_post_meta( $post_id, '_archlie_timeframe', $timeframe );
	update_post_meta( $post_id, '_archlie_brief', $brief );
	update_post_meta( $post_id, '_archlie_photo_desc', $photoDesc );
	update_post_meta( $post_id, '_archlie_flags', $flags );
	// Store the full package/state JSON for the record.
	update_post_meta( $post_id, '_archlie_payload', wp_json_encode( $payload ) );
	update_post_meta( $post_id, '_archlie_created', current_time( 'mysql' ) );

	/** Hook for Phase-1/2 automation (Stripe, portal, follow-ups). */
	do_action( 'archlie_project_created', $post_id, $payload );

	archlie_send_intake_emails( $name, $email, $total, $redirect, $post_id );

	$ref   = 'ARCH-' . strtoupper( substr( wp_hash( (string) $post_id . $email ), 0, 6 ) );
	$first = $name ? strtok( $name, ' ' ) : '';
	wp_send_json_success(
		array(
			'ref'      => $ref,
			'redirect' => $redirect,
			'message'  => $redirect
				? sprintf( /* translators: %s: reference */ __( 'Thanks — I’ve flagged this for a Tiam Architects consultation (ref %s). The team will be in touch.', 'archlie' ), $ref )
				: sprintf( /* translators: 1: name, 2: reference */ __( 'Project saved%1$s ✓ (ref %2$s). We’ll prepare your drawings and send a watermarked preview — you only pay to release the full package.', 'archlie' ), $first ? ', ' . $first : '', $ref ),
		)
	);
}
add_action( 'wp_ajax_archlie_intake', 'archlie_handle_intake' );
add_action( 'wp_ajax_nopriv_archlie_intake', 'archlie_handle_intake' );

/**
 * Studio notification + client auto-reply.
 *
 * @param string $name     Client name.
 * @param string $email    Client email.
 * @param int    $total    Quote total.
 * @param bool   $redirect Whether this is a Tiam redirect.
 * @param int    $post_id  Project record ID.
 */
function archlie_send_intake_emails( $name, $email, $total, $redirect, $post_id ) {
	$site    = wp_specialchars_decode( get_bloginfo( 'name' ), ENT_QUOTES );
	$headers = array( 'Content-Type: text/plain; charset=UTF-8' );
	$link    = admin_url( 'post.php?post=' . $post_id . '&action=edit' );

	wp_mail(
		archlie_notify_email(),
		( $redirect ? __( '[Tiam redirect] ', 'archlie' ) : __( '[New project] ', 'archlie' ) ) . ( $name ? $name : __( 'Anonymous', 'archlie' ) ),
		sprintf(
			"A new project record has been opened.\n\nName: %s\nEmail: %s\nQuote total: %s\n%s\nOpen it: %s\n",
			$name ? $name : '—',
			$email ? $email : '—',
			archlie_money( $total ),
			$redirect ? "Flagged for Tiam consultation.\n" : '',
			$link
		),
		$headers
	);

	if ( is_email( $email ) ) {
		wp_mail(
			$email,
			sprintf( /* translators: %s: site name */ __( 'Your %s project', 'archlie' ), $site ),
			sprintf(
				"Hi %s,\n\nThanks for building your project with %s. Your record is open%s.\n\nYou'll only be asked to pay once you can preview the finished drawings. If we need anything, we'll be in touch.\n\n— %s\n",
				$name ? strtok( $name, ' ' ) : __( 'there', 'archlie' ),
				$site,
				$redirect ? " and we'll arrange a Tiam Architects consultation" : '',
				$site
			),
			$headers
		);
	}
}

/**
 * Read-only project record meta box.
 */
function archlie_project_meta_box() {
	add_meta_box( 'archlie_project_details', __( 'Project record', 'archlie' ), 'archlie_project_meta_box_render', 'archlie_project', 'normal', 'high' );
}
add_action( 'add_meta_boxes', 'archlie_project_meta_box' );

/**
 * Render the read-only project record.
 *
 * @param WP_Post $post Current post.
 */
function archlie_project_meta_box_render( $post ) {
	$rows = array(
		__( 'Name', 'archlie' )       => get_post_meta( $post->ID, '_archlie_name', true ),
		__( 'Email', 'archlie' )      => get_post_meta( $post->ID, '_archlie_email', true ),
		__( 'Postcode', 'archlie' )   => get_post_meta( $post->ID, '_archlie_postcode', true ),
		__( 'Package', 'archlie' )    => get_post_meta( $post->ID, '_archlie_package', true ),
		__( 'Project type', 'archlie' ) => get_post_meta( $post->ID, '_archlie_project_type', true ),
		__( 'Quote total', 'archlie' )=> archlie_money( (int) get_post_meta( $post->ID, '_archlie_total', true ) ),
		__( 'Tiam redirect', 'archlie' ) => get_post_meta( $post->ID, '_archlie_redirect', true ) === '1' ? __( 'Yes', 'archlie' ) : __( 'No', 'archlie' ),
		__( 'Timeframe', 'archlie' )  => get_post_meta( $post->ID, '_archlie_timeframe', true ),
		__( 'Received', 'archlie' )   => get_post_meta( $post->ID, '_archlie_created', true ),
	);
	echo '<table class="widefat striped"><tbody>';
	foreach ( $rows as $label => $value ) {
		printf( '<tr><th style="width:160px">%s</th><td>%s</td></tr>', esc_html( $label ), esc_html( $value ? $value : '—' ) );
	}
	echo '</tbody></table>';
	$photo = get_post_meta( $post->ID, '_archlie_photo_desc', true );
	if ( $photo ) {
		echo '<p><strong>' . esc_html__( 'Photo design prompt', 'archlie' ) . '</strong></p><p>' . nl2br( esc_html( $photo ) ) . '</p>';
	}
	$brief = get_post_meta( $post->ID, '_archlie_brief', true );
	if ( $brief ) {
		echo '<p><strong>' . esc_html__( 'Brief', 'archlie' ) . '</strong></p><p>' . nl2br( esc_html( $brief ) ) . '</p>';
	}
}
