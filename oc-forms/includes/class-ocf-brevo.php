<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Thin Brevo (Sendinblue) API client. Contacts upsert + events.
 * Docs: https://developers.brevo.com/reference/createcontact and /trackevent (events.brevo.com).
 */
class OCF_Brevo {

	const API_BASE   = 'https://api.brevo.com/v3';
	const EVENT_BASE = 'https://in-automate.brevo.com/api/v2'; // Brevo "track event" endpoint

	public static function api_key() {
		$key = get_option( 'ocf_brevo_api_key', '' );
		return is_string( $key ) ? trim( $key ) : '';
	}

	public static function event_key() {
		$key = get_option( 'ocf_brevo_event_key', '' );
		return is_string( $key ) ? trim( $key ) : '';
	}

	public static function is_configured() {
		return self::api_key() !== '';
	}

	/**
	 * Upsert a contact and optionally add to list(s).
	 *
	 * @return array{ok:bool, status:int, body:mixed}
	 */
	public static function upsert_contact( $email, $attributes = array(), $list_ids = array() ) {
		if ( ! self::is_configured() ) {
			return array( 'ok' => false, 'status' => 0, 'body' => 'Brevo API key not configured' );
		}
		$email = sanitize_email( $email );
		if ( ! is_email( $email ) ) {
			return array( 'ok' => false, 'status' => 0, 'body' => 'Invalid email' );
		}

		$body = array(
			'email'          => $email,
			'updateEnabled'  => true,
		);
		if ( ! empty( $attributes ) ) {
			$body['attributes'] = $attributes;
		}
		if ( ! empty( $list_ids ) ) {
			$body['listIds'] = array_values( array_map( 'absint', $list_ids ) );
		}

		$res = wp_remote_post( self::API_BASE . '/contacts', array(
			'timeout' => 15,
			'headers' => array(
				'api-key'      => self::api_key(),
				'content-type' => 'application/json',
				'accept'       => 'application/json',
			),
			'body'    => wp_json_encode( $body ),
		) );

		return self::interpret( $res );
	}

	/**
	 * Send a "track event" to Brevo Automation. This is a separate API and key.
	 *
	 * @return array{ok:bool, status:int, body:mixed}
	 */
	public static function track_event( $email, $event_name, $properties = array(), $event_data = array() ) {
		$key = self::event_key();
		if ( ! $key ) {
			// Fall back to standard API key — many setups share it.
			$key = self::api_key();
		}
		if ( ! $key ) {
			return array( 'ok' => false, 'status' => 0, 'body' => 'Brevo event key not configured' );
		}

		$body = array(
			'event_name' => sanitize_text_field( $event_name ),
			'identifiers' => array( 'email_id' => sanitize_email( $email ) ),
		);
		if ( ! empty( $properties ) ) {
			$body['contact_properties'] = $properties;
		}
		if ( ! empty( $event_data ) ) {
			$body['event_properties'] = $event_data;
		}

		$res = wp_remote_post( self::EVENT_BASE . '/trackEvent', array(
			'timeout' => 15,
			'headers' => array(
				'ma-key'       => $key,
				'content-type' => 'application/json',
				'accept'       => 'application/json',
			),
			'body'    => wp_json_encode( $body ),
		) );

		return self::interpret( $res );
	}

	private static function interpret( $res ) {
		if ( is_wp_error( $res ) ) {
			return array( 'ok' => false, 'status' => 0, 'body' => $res->get_error_message() );
		}
		$code = (int) wp_remote_retrieve_response_code( $res );
		$body = wp_remote_retrieve_body( $res );
		$decoded = json_decode( $body, true );
		return array(
			'ok'     => $code >= 200 && $code < 300,
			'status' => $code,
			'body'   => $decoded !== null ? $decoded : $body,
		);
	}

	/**
	 * Build the attribute payload + event properties for a submission, using
	 * the form schema's brevo config to map question ids to Brevo attribute names.
	 */
	public static function build_payload( $schema, $answers ) {
		$attrs = array();
		$props = array();

		$attr_map = $schema['brevo']['attribute_map'] ?? array();
		if ( is_object( $attr_map ) ) {
			$attr_map = (array) $attr_map;
		}
		foreach ( (array) $attr_map as $qid => $attr_name ) {
			if ( ! $attr_name || ! array_key_exists( $qid, $answers ) ) {
				continue;
			}
			$attrs[ strtoupper( $attr_name ) ] = self::flatten( $answers[ $qid ] );
		}

		$ev_map = $schema['brevo']['event_properties_map'] ?? array();
		if ( is_object( $ev_map ) ) {
			$ev_map = (array) $ev_map;
		}
		foreach ( (array) $ev_map as $qid => $prop_name ) {
			if ( ! $prop_name || ! array_key_exists( $qid, $answers ) ) {
				continue;
			}
			$props[ $prop_name ] = self::flatten( $answers[ $qid ] );
		}

		return array( 'attributes' => $attrs, 'properties' => $props );
	}

	private static function flatten( $value ) {
		if ( is_array( $value ) ) {
			$flat = array();
			foreach ( $value as $v ) {
				if ( is_array( $v ) ) {
					$flat[] = wp_json_encode( $v );
				} else {
					$flat[] = (string) $v;
				}
			}
			return implode( ', ', $flat );
		}
		return is_scalar( $value ) ? (string) $value : wp_json_encode( $value );
	}

	/**
	 * Send everything for a completed submission: contact upsert + optional event.
	 * Records each call as an event row so retries can pick up failures.
	 */
	public static function dispatch( $submission_id, $form_id, $answers ) {
		$schema = OCF_Schema::get( $form_id );
		if ( empty( $schema['brevo']['enabled'] ) ) {
			return;
		}
		$visible = OCF_Logic::filter_visible( $schema, $answers );
		$payload = self::build_payload( $schema, $visible );

		$email = '';
		foreach ( $visible as $v ) {
			if ( is_email( $v ) ) { $email = $v; break; }
		}
		if ( ! $email ) {
			// Look up the canonical email from the submission row.
			$row   = OCF_Submission::find( $submission_id );
			$email = $row['email'] ?? '';
		}
		if ( ! $email ) {
			return;
		}

		// Contact upsert.
		$event_id = OCF_Submission::record_event( $submission_id, 'brevo_contact', array(
			'email'      => $email,
			'attributes' => $payload['attributes'],
			'list_ids'   => $schema['brevo']['list_ids'] ?? array(),
		) );
		self::run_event( $event_id );

		// Track event.
		if ( ! empty( $schema['brevo']['send_event'] ) && ! empty( $schema['brevo']['event_name'] ) ) {
			$event_id = OCF_Submission::record_event( $submission_id, 'brevo_event', array(
				'email'           => $email,
				'event_name'      => $schema['brevo']['event_name'],
				'event_data'      => $payload['properties'],
			) );
			self::run_event( $event_id );
		}
	}

	public static function run_event( $event_id ) {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . OCF_Submission::events_table() . ' WHERE id = %d', $event_id ), ARRAY_A );
		if ( ! $row ) { return; }
		$payload  = json_decode( $row['payload'], true ) ?: array();
		$attempts = (int) $row['attempts'] + 1;
		$result   = array( 'ok' => false, 'body' => 'unknown event' );

		if ( $row['event_type'] === 'brevo_contact' ) {
			$result = self::upsert_contact( $payload['email'] ?? '', $payload['attributes'] ?? array(), $payload['list_ids'] ?? array() );
		} elseif ( $row['event_type'] === 'brevo_event' ) {
			$result = self::track_event( $payload['email'] ?? '', $payload['event_name'] ?? '', array(), $payload['event_data'] ?? array() );
		}

		$status = $result['ok'] ? 'sent' : ( $attempts >= 5 ? 'failed' : 'pending' );
		OCF_Submission::update_event( $event_id, $status, $result, $attempts );
	}
}

add_action( 'ocf_retry_events', function () {
	$pending = OCF_Submission::pending_events( 25 );
	foreach ( $pending as $ev ) {
		OCF_Brevo::run_event( (int) $ev['id'] );
	}
} );
