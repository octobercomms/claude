<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ATWP_REST_Content {

	private $namespace = 'architourian/v1';

	public function register_routes() {
		register_rest_route( $this->namespace, '/content', array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => array( $this, 'list_content' ),
			'permission_callback' => function( $request ) {
				return ATWP_Auth::check_permission( $request, 'read' );
			},
			'args'                => array(
				'type'     => array(
					'default'           => 'any',
					'sanitize_callback' => 'sanitize_text_field',
				),
				'status'   => array(
					'default'           => 'publish',
					'sanitize_callback' => 'sanitize_text_field',
				),
				'per_page' => array(
					'default'           => 20,
					'sanitize_callback' => 'absint',
					'validate_callback' => function( $val ) {
						return $val >= 1 && $val <= 100;
					},
				),
				'page'     => array(
					'default'           => 1,
					'sanitize_callback' => 'absint',
				),
				'search'   => array(
					'default'           => '',
					'sanitize_callback' => 'sanitize_text_field',
				),
			),
		) );

		register_rest_route( $this->namespace, '/content/(?P<id>\d+)', array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_content' ),
				'permission_callback' => function( $request ) {
					return ATWP_Auth::check_permission( $request, 'read' );
				},
			),
			array(
				'methods'             => 'PATCH',
				'callback'            => array( $this, 'update_content' ),
				'permission_callback' => function( $request ) {
					return ATWP_Auth::check_permission( $request, 'write' );
				},
			),
		) );

		register_rest_route( $this->namespace, '/site-info', array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => array( $this, 'site_info' ),
			'permission_callback' => function( $request ) {
				return ATWP_Auth::check_permission( $request, 'read' );
			},
		) );

		register_rest_route( $this->namespace, '/media', array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => array( $this, 'list_media' ),
			'permission_callback' => function( $request ) {
				return ATWP_Auth::check_permission( $request, 'read' );
			},
			'args'                => array(
				'per_page'  => array(
					'default'           => 20,
					'sanitize_callback' => 'absint',
				),
				'page'      => array(
					'default'           => 1,
					'sanitize_callback' => 'absint',
				),
				'search'    => array(
					'default'           => '',
					'sanitize_callback' => 'sanitize_text_field',
				),
				'mime_type' => array(
					'default'           => '',
					'sanitize_callback' => 'sanitize_text_field',
				),
			),
		) );
	}

	public function list_content( $request ) {
		$type     = $request->get_param( 'type' );
		$status   = $request->get_param( 'status' );
		$per_page = $request->get_param( 'per_page' );
		$page     = $request->get_param( 'page' );

		$post_types = array( 'page', 'post' );
		if ( 'any' !== $type && in_array( $type, array( 'page', 'post' ), true ) ) {
			$post_types = array( $type );
		}

		$args = array(
			'post_type'      => $post_types,
			'post_status'    => 'any' === $status ? array( 'publish', 'draft', 'pending', 'private' ) : $status,
			'posts_per_page' => $per_page,
			'paged'          => $page,
			'orderby'        => 'modified',
			'order'          => 'DESC',
		);

		$search = $request->get_param( 'search' );
		if ( ! empty( $search ) ) {
			$args['s'] = $search;
		}

		$query = new WP_Query( $args );
		$items = array();

		foreach ( $query->posts as $post ) {
			$items[] = $this->format_content( $post );
		}

		return new WP_REST_Response( array(
			'items'       => $items,
			'total'       => $query->found_posts,
			'total_pages' => $query->max_num_pages,
			'page'        => $page,
			'per_page'    => $per_page,
		), 200 );
	}

	public function get_content( $request ) {
		$post = get_post( $request->get_param( 'id' ) );

		if ( ! $post || ! in_array( $post->post_type, array( 'page', 'post' ), true ) ) {
			return new WP_Error(
				'atwp_not_found',
				__( 'Content not found.', 'architourian-wordpress' ),
				array( 'status' => 404 )
			);
		}

		return new WP_REST_Response( $this->format_content( $post, true ), 200 );
	}

	public function update_content( $request ) {
		$post_id = $request->get_param( 'id' );
		$post    = get_post( $post_id );

		if ( ! $post || ! in_array( $post->post_type, array( 'page', 'post' ), true ) ) {
			return new WP_Error(
				'atwp_not_found',
				__( 'Content not found.', 'architourian-wordpress' ),
				array( 'status' => 404 )
			);
		}

		$body    = $request->get_json_params();
		$updates = array( 'ID' => $post_id );
		$changed = array();

		if ( isset( $body['title'] ) ) {
			$updates['post_title'] = sanitize_text_field( $body['title'] );
			$changed[] = 'title';
		}
		if ( isset( $body['content'] ) ) {
			$updates['post_content'] = wp_kses_post( $body['content'] );
			$changed[] = 'content';
		}
		if ( isset( $body['excerpt'] ) ) {
			$updates['post_excerpt'] = sanitize_textarea_field( $body['excerpt'] );
			$changed[] = 'excerpt';
		}
		if ( isset( $body['status'] ) ) {
			$updates['post_status'] = sanitize_text_field( $body['status'] );
			$changed[] = 'status';
		}

		if ( count( $updates ) > 1 ) {
			$result = wp_update_post( $updates, true );
			if ( is_wp_error( $result ) ) {
				return $result;
			}
		}

		if ( isset( $body['meta'] ) && is_array( $body['meta'] ) ) {
			foreach ( $body['meta'] as $key => $value ) {
				update_post_meta( $post_id, sanitize_key( $key ), sanitize_text_field( $value ) );
			}
			$changed[] = 'meta';
		}

		ATWP_Auth::log_request(
			$request->get_param( '_atwp_key_id' ),
			'/content/' . $post_id,
			'PATCH',
			sprintf( 'Updated %s ID %d: %s', $post->post_type, $post_id, implode( ', ', $changed ) ),
			200
		);

		$post = get_post( $post_id );
		return new WP_REST_Response( $this->format_content( $post, true ), 200 );
	}

	public function site_info( $request ) {
		$theme = wp_get_theme();

		$active_plugins = get_option( 'active_plugins', array() );
		$plugin_names   = array();
		foreach ( $active_plugins as $plugin_file ) {
			$data = get_plugin_data( WP_PLUGIN_DIR . '/' . $plugin_file, false );
			$plugin_names[] = ! empty( $data['Name'] ) ? $data['Name'] : basename( $plugin_file, '.php' );
		}

		$post_types = get_post_types( array( 'public' => true ), 'objects' );
		$cpt_list   = array();
		foreach ( $post_types as $pt ) {
			$cpt_list[] = array(
				'name'   => $pt->name,
				'label'  => $pt->label,
				'count'  => (int) wp_count_posts( $pt->name )->publish,
			);
		}

		return new WP_REST_Response( array(
			'name'         => get_bloginfo( 'name' ),
			'url'          => home_url(),
			'timezone'     => wp_timezone_string(),
			'theme'        => $theme->get( 'Name' ) . ' ' . $theme->get( 'Version' ),
			'wordpress'    => get_bloginfo( 'version' ),
			'plugins'      => $plugin_names,
			'post_types'   => $cpt_list,
			'jetengine'    => ATWP_JetEngine::is_active(),
			'acf'          => ATWP_JetEngine::is_acf_active(),
			'php'          => phpversion(),
		), 200 );
	}

	public function list_media( $request ) {
		$per_page = $request->get_param( 'per_page' );
		$page     = $request->get_param( 'page' );

		$args = array(
			'post_type'      => 'attachment',
			'post_status'    => 'inherit',
			'posts_per_page' => $per_page,
			'paged'          => $page,
			'orderby'        => 'date',
			'order'          => 'DESC',
		);

		$search = $request->get_param( 'search' );
		if ( ! empty( $search ) ) {
			$args['s'] = $search;
		}

		$mime = $request->get_param( 'mime_type' );
		if ( ! empty( $mime ) ) {
			$args['post_mime_type'] = $mime;
		}

		$query = new WP_Query( $args );
		$items = array();

		foreach ( $query->posts as $post ) {
			$items[] = array(
				'id'        => $post->ID,
				'title'     => $post->post_title,
				'url'       => wp_get_attachment_url( $post->ID ),
				'mime_type' => $post->post_mime_type,
				'date'      => $post->post_date,
				'alt'       => get_post_meta( $post->ID, '_wp_attachment_image_alt', true ),
				'filesize'  => filesize( get_attached_file( $post->ID ) ) ?: null,
			);
		}

		return new WP_REST_Response( array(
			'items'       => $items,
			'total'       => $query->found_posts,
			'total_pages' => $query->max_num_pages,
			'page'        => $page,
			'per_page'    => $per_page,
		), 200 );
	}

	private function format_content( $post, $full = false ) {
		$data = array(
			'id'        => $post->ID,
			'type'      => $post->post_type,
			'title'     => $post->post_title,
			'slug'      => $post->post_name,
			'status'    => $post->post_status,
			'date'      => $post->post_date,
			'modified'  => $post->post_modified,
			'permalink' => get_permalink( $post->ID ),
			'excerpt'   => $post->post_excerpt,
			'author'    => get_the_author_meta( 'display_name', $post->post_author ),
		);

		if ( $full ) {
			$data['content'] = $post->post_content;

			$raw_meta = get_post_meta( $post->ID );
			$meta     = array();
			foreach ( $raw_meta as $key => $values ) {
				if ( 0 === strpos( $key, '_' ) ) {
					continue;
				}
				$meta[ $key ] = count( $values ) === 1 ? $values[0] : $values;
			}
			$data['meta'] = $meta;
		}

		return $data;
	}
}
