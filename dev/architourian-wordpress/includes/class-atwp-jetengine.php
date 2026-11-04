<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ATWP_JetEngine {

	public static function is_active() {
		return class_exists( 'Jet_Engine' );
	}

	public static function is_acf_active() {
		return class_exists( 'ACF' ) || function_exists( 'acf_get_field_groups' );
	}

	public static function get_meta_fields( $post_type ) {
		$fields = array();

		if ( self::is_active() ) {
			$fields = array_merge( $fields, self::get_jetengine_fields( $post_type ) );
		}

		if ( self::is_acf_active() ) {
			$fields = array_merge( $fields, self::get_acf_fields( $post_type ) );
		}

		if ( empty( $fields ) ) {
			$fields = self::get_registered_meta_fields( $post_type );
		}

		return $fields;
	}

	private static function get_jetengine_fields( $post_type ) {
		$fields = array();

		if ( ! function_exists( 'jet_engine' ) ) {
			return $fields;
		}

		$meta_boxes = jet_engine()->meta_boxes;
		if ( ! $meta_boxes || ! method_exists( $meta_boxes, 'get_registered_fields' ) ) {
			$raw = get_option( 'jet_engine_meta_boxes', array() );
			if ( ! is_array( $raw ) ) {
				return $fields;
			}

			foreach ( $raw as $box ) {
				$args = isset( $box['args'] ) ? $box['args'] : array();
				if ( ! isset( $args['object_type'] ) || 'post' !== $args['object_type'] ) {
					continue;
				}
				$allowed = isset( $args['allowed_post_type'] ) ? (array) $args['allowed_post_type'] : array();
				if ( ! in_array( $post_type, $allowed, true ) ) {
					continue;
				}
				$box_fields = isset( $box['meta_fields'] ) ? $box['meta_fields'] : array();
				foreach ( $box_fields as $f ) {
					$fields[] = self::normalize_jetengine_field( $f );
				}
			}
			return $fields;
		}

		$registered = $meta_boxes->get_registered_fields();
		if ( ! empty( $registered[ $post_type ] ) ) {
			foreach ( $registered[ $post_type ] as $f ) {
				$fields[] = self::normalize_jetengine_field( $f );
			}
		}

		return $fields;
	}

	private static function normalize_jetengine_field( $field ) {
		$type_map = array(
			'text'      => 'text',
			'textarea'  => 'textarea',
			'wysiwyg'   => 'html',
			'number'    => 'number',
			'date'      => 'date',
			'time'      => 'time',
			'datetime'  => 'datetime',
			'datetime-local' => 'datetime',
			'select'    => 'select',
			'radio'     => 'select',
			'checkbox'  => 'checkbox',
			'switcher'  => 'boolean',
			'media'     => 'media',
			'gallery'   => 'gallery',
			'repeater'  => 'repeater',
			'colorpicker' => 'color',
			'iconpicker'  => 'text',
			'posts'     => 'relation',
		);

		$raw_type = isset( $field['type'] ) ? $field['type'] : 'text';
		$options  = array();

		if ( ! empty( $field['options'] ) && is_array( $field['options'] ) ) {
			foreach ( $field['options'] as $opt ) {
				if ( is_array( $opt ) ) {
					$options[] = array(
						'value' => isset( $opt['key'] ) ? $opt['key'] : '',
						'label' => isset( $opt['value'] ) ? $opt['value'] : '',
					);
				}
			}
		}

		$repeater_fields = array();
		if ( 'repeater' === $raw_type && ! empty( $field['repeater-fields'] ) ) {
			foreach ( $field['repeater-fields'] as $rf ) {
				$repeater_fields[] = self::normalize_jetengine_field( $rf );
			}
		}

		$result = array(
			'name'     => isset( $field['name'] ) ? $field['name'] : '',
			'label'    => isset( $field['title'] ) ? $field['title'] : ( isset( $field['name'] ) ? $field['name'] : '' ),
			'type'     => isset( $type_map[ $raw_type ] ) ? $type_map[ $raw_type ] : 'text',
			'raw_type' => $raw_type,
			'required' => ! empty( $field['is_required'] ),
			'source'   => 'jetengine',
		);

		if ( ! empty( $options ) ) {
			$result['options'] = $options;
		}
		if ( ! empty( $repeater_fields ) ) {
			$result['repeater_fields'] = $repeater_fields;
		}

		return $result;
	}

	private static function get_acf_fields( $post_type ) {
		$fields = array();

		if ( ! function_exists( 'acf_get_field_groups' ) || ! function_exists( 'acf_get_fields' ) ) {
			return $fields;
		}

		$groups = acf_get_field_groups( array( 'post_type' => $post_type ) );
		foreach ( $groups as $group ) {
			$group_fields = acf_get_fields( $group['key'] );
			if ( ! is_array( $group_fields ) ) {
				continue;
			}
			foreach ( $group_fields as $f ) {
				$fields[] = array(
					'name'     => isset( $f['name'] ) ? $f['name'] : '',
					'label'    => isset( $f['label'] ) ? $f['label'] : '',
					'type'     => self::map_acf_type( isset( $f['type'] ) ? $f['type'] : 'text' ),
					'raw_type' => isset( $f['type'] ) ? $f['type'] : 'text',
					'required' => ! empty( $f['required'] ),
					'source'   => 'acf',
				);
			}
		}

		return $fields;
	}

	private static function map_acf_type( $type ) {
		$map = array(
			'text'          => 'text',
			'textarea'      => 'textarea',
			'wysiwyg'       => 'html',
			'number'        => 'number',
			'date_picker'   => 'date',
			'time_picker'   => 'time',
			'date_time_picker' => 'datetime',
			'select'        => 'select',
			'radio'         => 'select',
			'checkbox'      => 'checkbox',
			'true_false'    => 'boolean',
			'image'         => 'media',
			'gallery'       => 'gallery',
			'repeater'      => 'repeater',
			'color_picker'  => 'color',
			'relationship'  => 'relation',
			'post_object'   => 'relation',
			'email'         => 'text',
			'url'           => 'text',
		);
		return isset( $map[ $type ] ) ? $map[ $type ] : 'text';
	}

	private static function get_registered_meta_fields( $post_type ) {
		$registered = get_registered_meta_keys( 'post', $post_type );
		$fields     = array();

		foreach ( $registered as $key => $args ) {
			if ( 0 === strpos( $key, '_' ) ) {
				continue;
			}
			$fields[] = array(
				'name'     => $key,
				'label'    => str_replace( array( '_', '-' ), ' ', ucfirst( $key ) ),
				'type'     => isset( $args['type'] ) ? $args['type'] : 'text',
				'raw_type' => isset( $args['type'] ) ? $args['type'] : 'string',
				'required' => false,
				'source'   => 'wordpress',
			);
		}

		return $fields;
	}

	public static function get_post_meta_with_labels( $post_id, $post_type ) {
		$schema = self::get_meta_fields( $post_type );
		$meta   = get_post_meta( $post_id );
		$result = array();

		$field_map = array();
		foreach ( $schema as $field ) {
			$field_map[ $field['name'] ] = $field;
		}

		foreach ( $meta as $key => $values ) {
			if ( 0 === strpos( $key, '_' ) ) {
				continue;
			}

			$value = count( $values ) === 1 ? $values[0] : $values;
			$info  = isset( $field_map[ $key ] ) ? $field_map[ $key ] : null;

			$entry = array(
				'key'   => $key,
				'value' => $value,
			);

			if ( $info ) {
				$entry['label'] = $info['label'];
				$entry['type']  = $info['type'];
				$entry['value'] = self::format_field_value( $value, $info['type'] );
			}

			$result[ $key ] = $entry;
		}

		return $result;
	}

	public static function format_field_value( $value, $field_type ) {
		switch ( $field_type ) {
			case 'date':
				$ts = strtotime( $value );
				return false !== $ts ? gmdate( 'Y-m-d', $ts ) : $value;

			case 'datetime':
				$ts = strtotime( $value );
				return false !== $ts ? gmdate( 'c', $ts ) : $value;

			case 'time':
				$ts = strtotime( $value );
				return false !== $ts ? gmdate( 'H:i', $ts ) : $value;

			case 'number':
				return is_numeric( $value ) ? floatval( $value ) : $value;

			case 'boolean':
				return filter_var( $value, FILTER_VALIDATE_BOOLEAN );

			case 'media':
				if ( is_numeric( $value ) ) {
					$url = wp_get_attachment_url( intval( $value ) );
					return $url ? array( 'id' => intval( $value ), 'url' => $url ) : $value;
				}
				return $value;

			case 'gallery':
				if ( is_string( $value ) ) {
					$ids = array_filter( array_map( 'intval', explode( ',', $value ) ) );
				} elseif ( is_array( $value ) ) {
					$ids = array_map( 'intval', $value );
				} else {
					return $value;
				}
				$items = array();
				foreach ( $ids as $id ) {
					$url = wp_get_attachment_url( $id );
					if ( $url ) {
						$items[] = array( 'id' => $id, 'url' => $url );
					}
				}
				return $items;

			case 'repeater':
				$decoded = maybe_unserialize( $value );
				return is_array( $decoded ) ? $decoded : $value;

			default:
				return $value;
		}
	}

	public static function sanitize_field_value( $value, $field_type ) {
		switch ( $field_type ) {
			case 'text':
			case 'color':
				return sanitize_text_field( $value );

			case 'textarea':
				return sanitize_textarea_field( $value );

			case 'html':
				return wp_kses_post( $value );

			case 'number':
				return is_numeric( $value ) ? floatval( $value ) : 0;

			case 'date':
				$ts = strtotime( $value );
				return false !== $ts ? gmdate( 'Y-m-d', $ts ) : '';

			case 'datetime':
				$ts = strtotime( $value );
				return false !== $ts ? gmdate( 'Y-m-d H:i:s', $ts ) : '';

			case 'time':
				$ts = strtotime( $value );
				return false !== $ts ? gmdate( 'H:i', $ts ) : '';

			case 'boolean':
				return filter_var( $value, FILTER_VALIDATE_BOOLEAN ) ? '1' : '';

			case 'select':
				return sanitize_text_field( $value );

			case 'media':
				return absint( $value );

			case 'gallery':
				if ( is_array( $value ) ) {
					return array_map( 'absint', $value );
				}
				return sanitize_text_field( $value );

			case 'repeater':
				return is_array( $value ) ? $value : array();

			default:
				return sanitize_text_field( $value );
		}
	}
}
