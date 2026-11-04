<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ATWP_REST_Tours {

	private $namespace = 'architourian/v1';

	public function register_routes() {
		register_rest_route( $this->namespace, '/tours', array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'list_tours' ),
				'permission_callback' => function( $request ) {
					return ATWP_Auth::check_permission( $request, 'read' );
				},
				'args'                => $this->get_list_args(),
			),
		) );

		register_rest_route( $this->namespace, '/tours/(?P<id>\d+)', array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_tour' ),
				'permission_callback' => function( $request ) {
					return ATWP_Auth::check_permission( $request, 'read' );
				},
			),
			array(
				'methods'             => 'PATCH',
				'callback'            => array( $this, 'update_tour' ),
				'permission_callback' => function( $request ) {
					return ATWP_Auth::check_permission( $request, 'write' );
				},
			),
			array(
				'methods'             => WP_REST_Server::DELETABLE,
				'callback'            => array( $this, 'delete_tour' ),
				'permission_callback' => function( $request ) {
					return ATWP_Auth::check_permission( $request, 'admin' );
				},
			),
		) );

		register_rest_route( $this->namespace, '/tours', array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => array( $this, 'create_tour' ),
			'permission_callback' => function( $request ) {
				return ATWP_Auth::check_permission( $request, 'write' );
			},
		) );

		register_rest_route( $this->namespace, '/tours/schema', array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => array( $this, 'get_schema' ),
			'permission_callback' => function( $request ) {
				return ATWP_Auth::check_permission( $request, 'read' );
			},
		) );
	}

	private function get_tour_post_type() {
		return get_option( 'atwp_tour_cpt', 'post' );
	}

	private function get_list_args() {
		return array(
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
			'orderby'  => array(
				'default'           => 'date',
				'sanitize_callback' => 'sanitize_text_field',
				'validate_callback' => function( $val ) {
					return in_array( $val, array( 'date', 'title', 'modified', 'ID' ), true );
				},
			),
			'order'    => array(
				'default'           => 'desc',
				'sanitize_callback' => 'sanitize_text_field',
				'validate_callback' => function( $val ) {
					return in_array( strtolower( $val ), array( 'asc', 'desc' ), true );
				},
			),
			'date_from' => array(
				'default'           => '',
				'sanitize_callback' => 'sanitize_text_field',
			),
			'date_to'   => array(
				'default'           => '',
				'sanitize_callback' => 'sanitize_text_field',
			),
		);
	}

	public function list_tours( $request ) {
		$post_type = $this->get_tour_post_type();
		$status    = $request->get_param( 'status' );
		$per_page  = $request->get_param( 'per_page' );
		$page      = $request->get_param( 'page' );

		$args = array(
			'post_type'      => $post_type,
			'post_status'    => 'any' === $status ? array( 'publish', 'draft', 'pending', 'private' ) : $status,
			'posts_per_page' => $per_page,
			'paged'          => $page,
			'orderby'        => $request->get_param( 'orderby' ),
			'order'          => strtoupper( $request->get_param( 'order' ) ),
		);

		$search = $request->get_param( 'search' );
		if ( ! empty( $search ) ) {
			$args['s'] = $search;
		}

		$date_from = $request->get_param( 'date_from' );
		$date_to   = $request->get_param( 'date_to' );
		if ( ! empty( $date_from ) || ! empty( $date_to ) ) {
			$date_query = array();
			if ( ! empty( $date_from ) ) {
				$date_query['after'] = $date_from;
			}
			if ( ! empty( $date_to ) ) {
				$date_query['before'] = $date_to;
			}
			$date_query['inclusive'] = true;
			$args['date_query'] = array( $date_query );
		}

		$query = new WP_Query( $args );
		$tours = array();

		foreach ( $query->posts as $post ) {
			$tours[] = $this->format_tour( $post );
		}

		return new WP_REST_Response( array(
			'tours'       => $tours,
			'total'       => $query->found_posts,
			'total_pages' => $query->max_num_pages,
			'page'        => $page,
			'per_page'    => $per_page,
		), 200 );
	}

	public function get_tour( $request ) {
		$post_type = $this->get_tour_post_type();
		$post      = get_post( $request->get_param( 'id' ) );

		if ( ! $post || $post->post_type !== $post_type ) {
			return new WP_Error(
				'atwp_not_found',
				__( 'Tour not found.', 'architourian-wordpress' ),
				array( 'status' => 404 )
			);
		}

		return new WP_REST_Response( $this->format_tour( $post, true ), 200 );
	}

	public function create_tour( $request ) {
		$post_type = $this->get_tour_post_type();
		$body      = $request->get_json_params();

		if ( empty( $body['title'] ) ) {
			return new WP_Error(
				'atwp_missing_title',
				__( 'Title is required.', 'architourian-wordpress' ),
				array( 'status' => 400 )
			);
		}

		$post_data = array(
			'post_type'   => $post_type,
			'post_title'  => sanitize_text_field( $body['title'] ),
			'post_status' => isset( $body['status'] ) ? sanitize_text_field( $body['status'] ) : 'draft',
		);

		if ( isset( $body['content'] ) ) {
			$post_data['post_content'] = wp_kses_post( $body['content'] );
		}
		if ( isset( $body['excerpt'] ) ) {
			$post_data['post_excerpt'] = sanitize_textarea_field( $body['excerpt'] );
		}

		$post_id = wp_insert_post( $post_data, true );
		if ( is_wp_error( $post_id ) ) {
			return $post_id;
		}

		if ( isset( $body['featured_image_id'] ) ) {
			set_post_thumbnail( $post_id, absint( $body['featured_image_id'] ) );
		}

		if ( isset( $body['meta'] ) && is_array( $body['meta'] ) ) {
			$this->update_meta_fields( $post_id, $post_type, $body['meta'] );
		}

		ATWP_Auth::log_request(
			$request->get_param( '_atwp_key_id' ),
			'/tours',
			'POST',
			sprintf( 'Created tour: %s (ID %d)', $body['title'], $post_id ),
			201
		);

		$post = get_post( $post_id );
		return new WP_REST_Response( $this->format_tour( $post, true ), 201 );
	}

	public function update_tour( $request ) {
		$post_type = $this->get_tour_post_type();
		$post_id   = $request->get_param( 'id' );
		$post      = get_post( $post_id );

		if ( ! $post || $post->post_type !== $post_type ) {
			return new WP_Error(
				'atwp_not_found',
				__( 'Tour not found.', 'architourian-wordpress' ),
				array( 'status' => 404 )
			);
		}

		$body     = $request->get_json_params();
		$updates  = array( 'ID' => $post_id );
		$changed  = array();

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
		if ( isset( $body['slug'] ) ) {
			$updates['post_name'] = sanitize_title( $body['slug'] );
			$changed[] = 'slug';
		}

		if ( count( $updates ) > 1 ) {
			$result = wp_update_post( $updates, true );
			if ( is_wp_error( $result ) ) {
				return $result;
			}
		}

		if ( isset( $body['featured_image_id'] ) ) {
			if ( empty( $body['featured_image_id'] ) ) {
				delete_post_thumbnail( $post_id );
			} else {
				set_post_thumbnail( $post_id, absint( $body['featured_image_id'] ) );
			}
			$changed[] = 'featured_image';
		}

		if ( isset( $body['meta'] ) && is_array( $body['meta'] ) ) {
			$this->update_meta_fields( $post_id, $post_type, $body['meta'] );
			$changed[] = 'meta(' . implode( ',', array_keys( $body['meta'] ) ) . ')';
		}

		ATWP_Auth::log_request(
			$request->get_param( '_atwp_key_id' ),
			'/tours/' . $post_id,
			'PATCH',
			sprintf( 'Updated tour ID %d: %s', $post_id, implode( ', ', $changed ) ),
			200
		);

		$post = get_post( $post_id );
		return new WP_REST_Response( $this->format_tour( $post, true ), 200 );
	}

	public function delete_tour( $request ) {
		$post_type = $this->get_tour_post_type();
		$post_id   = $request->get_param( 'id' );
		$post      = get_post( $post_id );

		if ( ! $post || $post->post_type !== $post_type ) {
			return new WP_Error(
				'atwp_not_found',
				__( 'Tour not found.', 'architourian-wordpress' ),
				array( 'status' => 404 )
			);
		}

		$title = $post->post_title;
		wp_trash_post( $post_id );

		ATWP_Auth::log_request(
			$request->get_param( '_atwp_key_id' ),
			'/tours/' . $post_id,
			'DELETE',
			sprintf( 'Trashed tour: %s (ID %d)', $title, $post_id ),
			200
		);

		return new WP_REST_Response( array(
			'deleted' => true,
			'id'      => $post_id,
			'title'   => $title,
		), 200 );
	}

	public function get_schema( $request ) {
		$post_type  = $this->get_tour_post_type();
		$type_obj   = get_post_type_object( $post_type );
		$fields     = ATWP_JetEngine::get_meta_fields( $post_type );

		$field_mapping = get_option( 'atwp_field_mapping', array() );

		return new WP_REST_Response( array(
			'post_type'     => $post_type,
			'label'         => $type_obj ? $type_obj->label : $post_type,
			'fields'        => $fields,
			'field_mapping' => $field_mapping,
			'jetengine'     => ATWP_JetEngine::is_active(),
			'acf'           => ATWP_JetEngine::is_acf_active(),
		), 200 );
	}

	private function format_tour( $post, $full = false ) {
		$post_type = $this->get_tour_post_type();
		$thumb_id  = get_post_thumbnail_id( $post->ID );
		$image     = null;

		if ( $thumb_id ) {
			$image = array(
				'id'  => $thumb_id,
				'url' => wp_get_attachment_url( $thumb_id ),
				'alt' => get_post_meta( $thumb_id, '_wp_attachment_image_alt', true ),
			);
		}

		$data = array(
			'id'        => $post->ID,
			'title'     => $post->post_title,
			'slug'      => $post->post_name,
			'status'    => $post->post_status,
			'date'      => $post->post_date,
			'modified'  => $post->post_modified,
			'permalink' => get_permalink( $post->ID ),
			'excerpt'   => $post->post_excerpt,
			'author'    => get_the_author_meta( 'display_name', $post->post_author ),
			'featured_image' => $image,
		);

		if ( $full ) {
			$data['content'] = $post->post_content;
			$data['meta']    = ATWP_JetEngine::get_post_meta_with_labels( $post->ID, $post_type );
		} else {
			$raw_meta    = get_post_meta( $post->ID );
			$mapped      = get_option( 'atwp_field_mapping', array() );
			$summary     = array();

			foreach ( $mapped as $role => $field_name ) {
				if ( ! empty( $field_name ) && isset( $raw_meta[ $field_name ] ) ) {
					$summary[ $role ] = $raw_meta[ $field_name ][0];
				}
			}
			if ( ! empty( $summary ) ) {
				$data['tour_fields'] = $summary;
			}
		}

		return $data;
	}

	private function update_meta_fields( $post_id, $post_type, $meta ) {
		$schema    = ATWP_JetEngine::get_meta_fields( $post_type );
		$field_map = array();
		foreach ( $schema as $field ) {
			$field_map[ $field['name'] ] = $field;
		}

		foreach ( $meta as $key => $value ) {
			$key = sanitize_key( $key );
			if ( isset( $field_map[ $key ] ) ) {
				$value = ATWP_JetEngine::sanitize_field_value( $value, $field_map[ $key ]['type'] );
			} else {
				$value = sanitize_text_field( $value );
			}
			update_post_meta( $post_id, $key, $value );
		}
	}
}
