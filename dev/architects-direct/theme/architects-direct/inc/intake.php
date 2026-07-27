<?php
/**
 * Architects Direct — self-service intake.
 *
 * Seeds Phase 1 of the brief: registers a `ad_project` custom post type (the
 * "project account"), and handles the intake form over admin-ajax with a nonce.
 * On submit it validates, opens a project account, notifies the studio and the
 * client, and returns JSON.
 *
 * What is intentionally still TODO for the full Phase 1 build (documented so the
 * next pass has clear seams): drawing upload + watermarked preview, the payment
 * gate before release, and the scheduled follow-up email for partial submissions
 * (the account + captured fields this creates are what that job would act on).
 *
 * @package Architects_Direct
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Register the "project account" custom post type.
 */
function ad_register_project_cpt() {
	register_post_type(
		'ad_project',
		array(
			'labels' => array(
				'name'          => __( 'Projects', 'architects-direct' ),
				'singular_name' => __( 'Project', 'architects-direct' ),
				'menu_name'     => __( 'AD Projects', 'architects-direct' ),
				'add_new_item'  => __( 'Add New Project', 'architects-direct' ),
				'edit_item'     => __( 'Edit Project', 'architects-direct' ),
				'search_items'  => __( 'Search Projects', 'architects-direct' ),
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
add_action( 'init', 'ad_register_project_cpt' );

/**
 * The email that should receive new-project notifications.
 *
 * @return string
 */
function ad_notify_email() {
	$email = get_theme_mod( 'ad_notify_email', get_option( 'admin_email' ) );
	return is_email( $email ) ? $email : get_option( 'admin_email' );
}

/**
 * AJAX: handle an intake submission.
 */
function ad_handle_intake() {
	check_ajax_referer( 'ad_intake', 'nonce' );

	$in = wp_unslash( $_POST );

	$name     = isset( $in['name'] ) ? sanitize_text_field( $in['name'] ) : '';
	$email    = isset( $in['email'] ) ? sanitize_email( $in['email'] ) : '';
	$phone    = isset( $in['phone'] ) ? sanitize_text_field( $in['phone'] ) : '';
	$postcode = isset( $in['postcode'] ) ? sanitize_text_field( $in['postcode'] ) : '';
	$service  = isset( $in['service'] ) ? sanitize_key( $in['service'] ) : '';
	$band     = isset( $in['band'] ) ? sanitize_key( $in['band'] ) : '';
	$brief    = isset( $in['brief'] ) ? sanitize_textarea_field( $in['brief'] ) : '';
	$terms    = ! empty( $in['terms'] );

	// Validate the essentials. Everything else can be filled in later — a
	// partial submission still opens an account (see brief §3.4).
	$errors = array();
	if ( '' === $name ) {
		$errors['name'] = __( 'Please tell us your name.', 'architects-direct' );
	}
	if ( ! is_email( $email ) ) {
		$errors['email'] = __( 'A valid email lets us reach you about your project.', 'architects-direct' );
	}
	if ( '' === $postcode ) {
		$errors['postcode'] = __( 'We need the project postcode.', 'architects-direct' );
	}
	if ( ! $terms ) {
		$errors['terms'] = __( 'Please confirm you understand how consultants are appointed.', 'architects-direct' );
	}

	if ( $errors ) {
		wp_send_json_error(
			array(
				'message' => __( 'Please check the highlighted fields — we just need a few essentials to open your project.', 'architects-direct' ),
				'fields'  => $errors,
			),
			422
		);
	}

	// Resolve a friendly service label for the record + emails.
	$table         = ad_pricing_table();
	$service_label = isset( $table['services'][ $service ]['label'] )
		? $table['services'][ $service ]['label']
		: ( 'unsure' === $service ? __( 'Not sure yet', 'architects-direct' ) : __( 'Not specified', 'architects-direct' ) );

	// Open the project account.
	$post_id = wp_insert_post(
		array(
			'post_type'   => 'ad_project',
			'post_status' => 'pending',
			/* translators: 1: client name, 2: postcode. */
			'post_title'  => sprintf( __( '%1$s — %2$s', 'architects-direct' ), $name, $postcode ? strtoupper( $postcode ) : __( 'no postcode', 'architects-direct' ) ),
		),
		true
	);

	if ( is_wp_error( $post_id ) ) {
		wp_send_json_error(
			array( 'message' => __( 'Something went wrong opening your project. Please try again in a moment.', 'architects-direct' ) ),
			500
		);
	}

	$meta = array(
		'_ad_name'     => $name,
		'_ad_email'    => $email,
		'_ad_phone'    => $phone,
		'_ad_postcode' => $postcode,
		'_ad_service'  => $service,
		'_ad_band'     => $band,
		'_ad_brief'    => $brief,
		'_ad_source'   => isset( $in['source'] ) ? sanitize_text_field( wp_unslash( $in['source'] ) ) : 'website',
		'_ad_created'  => current_time( 'mysql' ),
	);
	foreach ( $meta as $key => $value ) {
		update_post_meta( $post_id, $key, $value );
	}

	/**
	 * Fires after a project account is opened from an intake submission.
	 * Hook point for Phase 1/2 automation (payments, follow-up scheduling, CRM).
	 *
	 * @param int   $post_id The new project post ID.
	 * @param array $meta    The captured field data.
	 */
	do_action( 'ad_project_created', $post_id, $meta );

	ad_send_intake_emails( $name, $email, $service_label, $post_id );

	$first = strtok( $name, ' ' );
	wp_send_json_success(
		array(
			'message'   => sprintf(
				/* translators: %s: client first name. */
				__( 'Thanks, %s! Your project account is open. We\'ll get started on your drawings and only ask for payment once you can preview the work.', 'architects-direct' ),
				$first ? $first : $name
			),
			'projectId' => $post_id,
		)
	);
}
add_action( 'wp_ajax_ad_intake', 'ad_handle_intake' );
add_action( 'wp_ajax_nopriv_ad_intake', 'ad_handle_intake' );

/**
 * Send the studio notification and the client auto-reply.
 *
 * @param string $name          Client name.
 * @param string $email         Client email.
 * @param string $service_label Human-readable service.
 * @param int    $post_id       Project post ID.
 */
function ad_send_intake_emails( $name, $email, $service_label, $post_id ) {
	$site    = wp_specialchars_decode( get_bloginfo( 'name' ), ENT_QUOTES );
	$headers = array( 'Content-Type: text/plain; charset=UTF-8' );

	// Studio notification.
	$admin_link = admin_url( 'post.php?post=' . $post_id . '&action=edit' );
	wp_mail(
		ad_notify_email(),
		/* translators: %s: service label. */
		sprintf( __( '[New project] %s', 'architects-direct' ), $service_label ),
		sprintf(
			"A new project account has been opened.\n\nName: %s\nEmail: %s\nService: %s\n\nOpen it: %s\n",
			$name,
			$email,
			$service_label,
			$admin_link
		),
		$headers
	);

	// Client auto-reply.
	wp_mail(
		$email,
		/* translators: %s: site name. */
		sprintf( __( 'Your %s project is open', 'architects-direct' ), $site ),
		sprintf(
			"Hi %s,\n\nThanks for sending your brief to %s. Your project account is open and we're getting started on your %s drawings.\n\nYou'll only be asked to pay once you can preview the finished work. If we need anything to complete your drawings, we'll be in touch.\n\n— %s\n",
			strtok( $name, ' ' ) ? strtok( $name, ' ' ) : $name,
			$site,
			strtolower( $service_label ),
			$site
		),
		$headers
	);
}

/**
 * Surface the captured fields on the project edit screen (read-only).
 */
function ad_project_meta_box() {
	add_meta_box(
		'ad_project_details',
		__( 'Project brief', 'architects-direct' ),
		'ad_project_meta_box_render',
		'ad_project',
		'normal',
		'high'
	);
}
add_action( 'add_meta_boxes', 'ad_project_meta_box' );

/**
 * Render the read-only project brief meta box.
 *
 * @param WP_Post $post Current post.
 */
function ad_project_meta_box_render( $post ) {
	$rows = array(
		__( 'Name', 'architects-direct' )     => get_post_meta( $post->ID, '_ad_name', true ),
		__( 'Email', 'architects-direct' )    => get_post_meta( $post->ID, '_ad_email', true ),
		__( 'Phone', 'architects-direct' )    => get_post_meta( $post->ID, '_ad_phone', true ),
		__( 'Postcode', 'architects-direct' ) => get_post_meta( $post->ID, '_ad_postcode', true ),
		__( 'Service', 'architects-direct' )  => get_post_meta( $post->ID, '_ad_service', true ),
		__( 'Floor area', 'architects-direct' ) => get_post_meta( $post->ID, '_ad_band', true ),
		__( 'Source', 'architects-direct' )   => get_post_meta( $post->ID, '_ad_source', true ),
		__( 'Received', 'architects-direct' ) => get_post_meta( $post->ID, '_ad_created', true ),
	);
	echo '<table class="widefat striped"><tbody>';
	foreach ( $rows as $label => $value ) {
		printf(
			'<tr><th style="width:160px">%s</th><td>%s</td></tr>',
			esc_html( $label ),
			esc_html( $value ? $value : '—' )
		);
	}
	echo '</tbody></table>';
	$brief = get_post_meta( $post->ID, '_ad_brief', true );
	if ( $brief ) {
		echo '<p><strong>' . esc_html__( 'Brief', 'architects-direct' ) . '</strong></p>';
		echo '<p>' . nl2br( esc_html( $brief ) ) . '</p>';
	}
}
