<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Form schema helpers + question-type registry.
 *
 * A form schema is JSON stored on the CPT post in meta `_ocf_schema`. Shape:
 *
 * {
 *   "version": 1,
 *   "theme": { "primary": "#000", "accent": "#f59e0b", "font": "Inter", "logo": "https://...", "radius": "8px", "background": "#f5f5f5" },
 *   "brevo": { "list_ids": [4], "attribute_map": { "q_email": "EMAIL", ... }, "event_name": "lead_form_completed", "event_properties_map": { "q_budget": "budget" } },
 *   "spam":  { "turnstile": true, "honeypot": true, "rate_limit": 5 },
 *   "settings": { "submit_label": "Submit", "next_label": "Continue", "skip_label": "Skip", "back_label": "Back", "show_progress": true },
 *   "endings": { "default": { "heading": "Thanks!", "body": "We'll be in touch.", "cta_label": "", "cta_url": "" } },
 *   "steps": [
 *     {
 *       "id": "s_intro",
 *       "title": "Project type",
 *       "questions": [
 *         { "id": "q_type", "type": "image_cards", "label": "...", "required": true, "options": [ { "label":"House Extension", "value":"extension", "image":"https://..." } ], "show_if": [...] }
 *       ]
 *     }
 *   ]
 * }
 */
class OCF_Schema {

	const META_KEY = '_ocf_schema';

	public static function types() {
		return array(
			'heading'      => array( 'label' => 'Heading',      'storable' => false ),
			'paragraph'    => array( 'label' => 'Paragraph',    'storable' => false ),
			'short_text'   => array( 'label' => 'Short answer', 'storable' => true ),
			'long_text'    => array( 'label' => 'Long answer',  'storable' => true ),
			'email'        => array( 'label' => 'Email',        'storable' => true ),
			'phone'        => array( 'label' => 'Phone',        'storable' => true ),
			'url'          => array( 'label' => 'URL',          'storable' => true ),
			'number'       => array( 'label' => 'Number',       'storable' => true ),
			'choice'       => array( 'label' => 'Single choice', 'storable' => true ),
			'multi_choice' => array( 'label' => 'Multiple choice', 'storable' => true ),
			'image_cards'  => array( 'label' => 'Image cards (single)', 'storable' => true ),
			'image_cards_multi' => array( 'label' => 'Image cards (multiple)', 'storable' => true ),
			'dropdown'     => array( 'label' => 'Dropdown',     'storable' => true ),
			'grid'         => array( 'label' => 'Grid select',  'storable' => true ),
			'file_upload'  => array( 'label' => 'File upload',  'storable' => true ),
			'address'      => array( 'label' => 'Address',      'storable' => true ),
			'date'         => array( 'label' => 'Date',         'storable' => true ),
		);
	}

	public static function default_schema() {
		return array(
			'version'  => 1,
			'theme'    => array(
				'primary'    => '#111111',
				'accent'     => '#f59e0b',
				'font'       => 'Inter',
				'logo'       => '',
				'radius'     => '8px',
				'background' => '#f5f5f5',
			),
			'brevo'    => array(
				'enabled'              => true,
				'list_ids'             => array(),
				'attribute_map'        => new stdClass(),
				'send_event'           => true,
				'event_name'           => 'lead_form_completed',
				'event_properties_map' => new stdClass(),
			),
			'spam'     => array(
				'turnstile' => true,
				'honeypot'  => true,
				'rate_limit' => 5,
			),
			'settings' => array(
				'submit_label' => 'Submit',
				'next_label'   => 'Continue',
				'skip_label'   => 'Skip',
				'back_label'   => 'Back',
				'show_progress' => true,
			),
			'endings'  => array(
				'default' => array(
					'heading'   => 'Thanks — we got it.',
					'body'      => 'We will be in touch shortly.',
					'cta_label' => '',
					'cta_url'   => '',
				),
			),
			'steps'    => array(),
		);
	}

	public static function get( $form_id ) {
		$raw = get_post_meta( $form_id, self::META_KEY, true );
		if ( ! $raw ) {
			return self::default_schema();
		}
		$decoded = json_decode( $raw, true );
		if ( ! is_array( $decoded ) ) {
			return self::default_schema();
		}
		return wp_parse_args( $decoded, self::default_schema() );
	}

	public static function save( $form_id, $schema ) {
		$schema = self::sanitize( $schema );
		update_post_meta( $form_id, self::META_KEY, wp_slash( wp_json_encode( $schema ) ) );
		return $schema;
	}

	public static function sanitize( $schema ) {
		$schema = is_array( $schema ) ? $schema : array();
		$schema = wp_parse_args( $schema, self::default_schema() );

		// Theme: hex-ish strings + safe URLs.
		$schema['theme'] = array_map( 'sanitize_text_field', (array) $schema['theme'] );
		if ( ! empty( $schema['theme']['logo'] ) ) {
			$schema['theme']['logo'] = esc_url_raw( $schema['theme']['logo'] );
		}

		// Steps + questions.
		$steps_clean = array();
		foreach ( (array) ( $schema['steps'] ?? array() ) as $step ) {
			if ( ! is_array( $step ) ) {
				continue;
			}
			$step_clean = array(
				'id'        => self::clean_id( $step['id'] ?? '' ),
				'title'     => sanitize_text_field( $step['title'] ?? '' ),
				'show_if'   => self::sanitize_logic( $step['show_if'] ?? array() ),
				'questions' => array(),
			);
			foreach ( (array) ( $step['questions'] ?? array() ) as $q ) {
				if ( ! is_array( $q ) || empty( $q['type'] ) ) {
					continue;
				}
				$types = self::types();
				if ( ! isset( $types[ $q['type'] ] ) ) {
					continue;
				}
				$qc = array(
					'id'          => self::clean_id( $q['id'] ?? '' ),
					'type'        => $q['type'],
					'label'       => wp_kses_post( $q['label'] ?? '' ),
					'help'        => wp_kses_post( $q['help'] ?? '' ),
					'placeholder' => sanitize_text_field( $q['placeholder'] ?? '' ),
					'required'    => ! empty( $q['required'] ),
					'skippable'   => ! empty( $q['skippable'] ),
					'show_if'     => self::sanitize_logic( $q['show_if'] ?? array() ),
				);
				if ( isset( $q['options'] ) && is_array( $q['options'] ) ) {
					$qc['options'] = array();
					foreach ( $q['options'] as $opt ) {
						if ( ! is_array( $opt ) ) {
							continue;
						}
						$qc['options'][] = array(
							'label' => sanitize_text_field( $opt['label'] ?? '' ),
							'value' => sanitize_text_field( $opt['value'] ?? $opt['label'] ?? '' ),
							'image' => isset( $opt['image'] ) ? esc_url_raw( $opt['image'] ) : '',
						);
					}
				}
				if ( isset( $q['grid'] ) && is_array( $q['grid'] ) ) {
					$qc['grid'] = array(
						'columns' => array_map( 'sanitize_text_field', (array) ( $q['grid']['columns'] ?? array() ) ),
						'rows'    => array_map( 'sanitize_text_field', (array) ( $q['grid']['rows'] ?? array() ) ),
					);
				}
				if ( isset( $q['accept'] ) ) {
					$qc['accept'] = sanitize_text_field( $q['accept'] );
				}
				if ( isset( $q['max_size_mb'] ) ) {
					$qc['max_size_mb'] = absint( $q['max_size_mb'] );
				}
				if ( isset( $q['multiple'] ) ) {
					$qc['multiple'] = (bool) $q['multiple'];
				}
				$step_clean['questions'][] = $qc;
			}
			$steps_clean[] = $step_clean;
		}
		$schema['steps'] = $steps_clean;

		// Brevo.
		$schema['brevo']['enabled']    = ! empty( $schema['brevo']['enabled'] );
		$schema['brevo']['send_event'] = ! empty( $schema['brevo']['send_event'] );
		$schema['brevo']['list_ids']   = array_values( array_filter( array_map( 'absint', (array) ( $schema['brevo']['list_ids'] ?? array() ) ) ) );
		$schema['brevo']['event_name'] = sanitize_text_field( $schema['brevo']['event_name'] ?? '' );
		$schema['brevo']['attribute_map']        = self::clean_map( $schema['brevo']['attribute_map'] ?? array() );
		$schema['brevo']['event_properties_map'] = self::clean_map( $schema['brevo']['event_properties_map'] ?? array() );

		// Spam.
		$schema['spam']['turnstile']  = ! empty( $schema['spam']['turnstile'] );
		$schema['spam']['honeypot']   = ! empty( $schema['spam']['honeypot'] );
		$schema['spam']['rate_limit'] = max( 1, absint( $schema['spam']['rate_limit'] ?? 5 ) );

		return $schema;
	}

	public static function clean_id( $id ) {
		$id = preg_replace( '/[^a-zA-Z0-9_]/', '', (string) $id );
		if ( ! $id ) {
			$id = 'id_' . wp_generate_password( 8, false, false );
		}
		return substr( $id, 0, 64 );
	}

	public static function sanitize_logic( $rules ) {
		if ( ! is_array( $rules ) ) {
			return array();
		}
		$clean = array();
		foreach ( $rules as $rule ) {
			if ( ! is_array( $rule ) || empty( $rule['question'] ) || empty( $rule['op'] ) ) {
				continue;
			}
			$clean[] = array(
				'question' => self::clean_id( $rule['question'] ),
				'op'       => in_array( $rule['op'], array( 'is', 'is_not', 'contains', 'not_contains', 'is_set', 'is_empty', 'gt', 'lt' ), true ) ? $rule['op'] : 'is',
				'value'    => is_array( $rule['value'] ?? null ) ? array_map( 'sanitize_text_field', $rule['value'] ) : sanitize_text_field( $rule['value'] ?? '' ),
				'join'     => ( ( $rule['join'] ?? 'and' ) === 'or' ) ? 'or' : 'and',
			);
		}
		return $clean;
	}

	public static function clean_map( $map ) {
		if ( is_object( $map ) ) {
			$map = (array) $map;
		}
		if ( ! is_array( $map ) ) {
			return array();
		}
		$clean = array();
		foreach ( $map as $k => $v ) {
			$clean[ self::clean_id( $k ) ] = sanitize_text_field( $v );
		}
		return $clean;
	}

	public static function find_question( $schema, $question_id ) {
		foreach ( (array) ( $schema['steps'] ?? array() ) as $step ) {
			foreach ( (array) ( $step['questions'] ?? array() ) as $q ) {
				if ( ( $q['id'] ?? '' ) === $question_id ) {
					return $q;
				}
			}
		}
		return null;
	}

	public static function type_is_storable( $type ) {
		$types = self::types();
		return ! empty( $types[ $type ]['storable'] );
	}
}
