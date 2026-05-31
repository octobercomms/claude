<?php
/**
 * Closed-loop bridge between the ported Forms engine and Hillcroft's CRM.
 *
 * On a completed form submission (the `hgd_form_after_submit` action) this
 * turns the answers into a Hillcroft client + an "enquiry" project so leads
 * captured by a form flow straight into the Projects/Clients pipeline.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Form_Bridge {

	public static function init() {
		add_action( 'hgd_form_after_submit', array( __CLASS__, 'handle' ), 10, 3 );
	}

	/**
	 * @param int   $submission_id Completed submission row id.
	 * @param int   $form_id       Form CPT id.
	 * @param array $answers       Sanitised answers keyed by question id.
	 */
	public static function handle( $submission_id, $form_id, $answers ) {
		// Be defensive: never let a CRM hiccup break the submission response.
		try {
			self::process( (int) $submission_id, (int) $form_id, is_array( $answers ) ? $answers : array() );
		} catch ( \Throwable $e ) {
			error_log( 'HGD_Form_Bridge: ' . $e->getMessage() );
		}
	}

	private static function process( $submission_id, $form_id, $answers ) {
		if ( ! class_exists( 'HGDF_Schema' ) || ! class_exists( 'HGD_Client' ) || ! class_exists( 'HGD_Project' ) ) {
			return;
		}

		// Prefer the stored submission row (authoritative), fall back to the
		// answers passed to the hook.
		$row = class_exists( 'HGDF_Submission' ) ? HGDF_Submission::find( $submission_id ) : null;
		if ( $row && empty( $answers ) && ! empty( $row['payload'] ) ) {
			$decoded = json_decode( $row['payload'], true );
			if ( is_array( $decoded ) ) {
				$answers = $decoded;
			}
		}

		$schema    = HGDF_Schema::get( $form_id );
		$questions = self::index_questions( $schema );

		$email = self::extract_email( $answers, $questions );
		if ( ! $email && $row && ! empty( $row['email'] ) ) {
			$email = sanitize_email( $row['email'] );
		}

		// Without an email we can't dedupe or meaningfully create a client.
		if ( ! $email || ! is_email( $email ) ) {
			return;
		}

		$name     = self::extract_name( $answers, $questions );
		$phone    = self::extract_by_nature( $answers, $questions, array( 'phone' ), array( 'phone', 'mobile', 'tel' ) );
		$postcode = self::extract_postcode( $answers, $questions );
		$budget   = self::extract_budget( $answers, $questions );
		$summary  = self::build_summary( $schema, $answers );

		list( $first, $last ) = self::split_name( $name );

		$client_id = HGD_Client::find_or_create( array(
			'first_name' => $first,
			'last_name'  => $last,
			'email'      => $email,
			'phone'      => $phone,
			'postcode'   => $postcode,
		) );

		if ( ! $client_id ) {
			return;
		}

		$display = trim( $name );
		if ( $display === '' ) {
			$display = $email;
		}

		HGD_Project::insert( array(
			'client_id'    => (int) $client_id,
			'title'        => $display . ' — form enquiry',
			'status'       => 'enquiry',
			'source'       => 'enquiry_form',
			'postcode'     => $postcode,
			'budget_range' => $budget,
			'brief_notes'  => $summary,
		) );
	}

	/**
	 * Flatten the schema into [ question_id => question ] for quick lookups.
	 */
	private static function index_questions( $schema ) {
		$out = array();
		foreach ( (array) ( $schema['steps'] ?? array() ) as $step ) {
			foreach ( (array) ( $step['questions'] ?? array() ) as $q ) {
				if ( ! empty( $q['id'] ) ) {
					$out[ $q['id'] ] = $q;
				}
			}
		}
		return $out;
	}

	/**
	 * First answer to an `email`-type question, else first valid-looking email.
	 */
	private static function extract_email( $answers, $questions ) {
		foreach ( $answers as $qid => $val ) {
			$type = $questions[ $qid ]['type'] ?? '';
			if ( $type === 'email' && is_string( $val ) && is_email( $val ) ) {
				return sanitize_email( $val );
			}
		}
		foreach ( $answers as $val ) {
			if ( is_string( $val ) && is_email( $val ) ) {
				return sanitize_email( $val );
			}
		}
		return '';
	}

	/**
	 * Best-effort name: the first short_text whose label looks like a name,
	 * else the first short_text answer.
	 */
	private static function extract_name( $answers, $questions ) {
		$first_short = '';
		foreach ( $answers as $qid => $val ) {
			$q = $questions[ $qid ] ?? null;
			if ( ! $q || ( $q['type'] ?? '' ) !== 'short_text' ) {
				continue;
			}
			$value = is_string( $val ) ? trim( $val ) : '';
			if ( $value === '' ) {
				continue;
			}
			$label = strtolower( wp_strip_all_tags( $q['label'] ?? '' ) . ' ' . ( $q['id'] ?? '' ) );
			if ( preg_match( '/\b(name|full name|first name|last name)\b/', $label ) ) {
				return $value;
			}
			if ( $first_short === '' ) {
				$first_short = $value;
			}
		}
		return $first_short;
	}

	private static function split_name( $name ) {
		$name = trim( (string) $name );
		if ( $name === '' ) {
			return array( '', '' );
		}
		$parts = preg_split( '/\s+/', $name, 2 );
		$first = $parts[0] ?? '';
		$last  = $parts[1] ?? '';
		return array( $first, $last );
	}

	/**
	 * Pull a value by question type and/or label/id keyword match.
	 */
	private static function extract_by_nature( $answers, $questions, $types, $keywords ) {
		// Type match first.
		foreach ( $answers as $qid => $val ) {
			$type = $questions[ $qid ]['type'] ?? '';
			if ( in_array( $type, $types, true ) && is_scalar( $val ) && (string) $val !== '' ) {
				return sanitize_text_field( (string) $val );
			}
		}
		// Keyword match on label/id.
		foreach ( $answers as $qid => $val ) {
			$q = $questions[ $qid ] ?? null;
			if ( ! $q || ! is_scalar( $val ) || (string) $val === '' ) {
				continue;
			}
			$label = strtolower( wp_strip_all_tags( $q['label'] ?? '' ) . ' ' . ( $q['id'] ?? '' ) );
			foreach ( $keywords as $kw ) {
				if ( strpos( $label, $kw ) !== false ) {
					return sanitize_text_field( (string) $val );
				}
			}
		}
		return '';
	}

	private static function extract_postcode( $answers, $questions ) {
		$pc = self::extract_by_nature( $answers, $questions, array(), array( 'postcode', 'postal', 'zip', 'post code' ) );
		if ( $pc !== '' ) {
			return $pc;
		}
		// Address-type answers carry a structured zip.
		foreach ( $answers as $qid => $val ) {
			if ( ( $questions[ $qid ]['type'] ?? '' ) === 'address' && is_array( $val ) && ! empty( $val['zip'] ) ) {
				return sanitize_text_field( $val['zip'] );
			}
		}
		return '';
	}

	private static function extract_budget( $answers, $questions ) {
		return self::extract_by_nature( $answers, $questions, array(), array( 'budget', 'spend', 'price range', 'investment' ) );
	}

	/**
	 * Human-readable summary of all storable answers, one per line.
	 */
	private static function build_summary( $schema, $answers ) {
		$lines = array();
		foreach ( (array) ( $schema['steps'] ?? array() ) as $step ) {
			foreach ( (array) ( $step['questions'] ?? array() ) as $q ) {
				if ( empty( $q['type'] ) || ! HGDF_Schema::type_is_storable( $q['type'] ) ) {
					continue;
				}
				$qid = $q['id'] ?? '';
				$v   = $answers[ $qid ] ?? null;
				if ( $v === null || $v === '' || $v === array() ) {
					continue;
				}
				$label = wp_strip_all_tags( $q['label'] ?? '' );
				if ( $label === '' ) {
					$label = $qid;
				}
				if ( is_array( $v ) ) {
					$v = implode( ', ', array_map( function ( $x ) {
						return is_scalar( $x ) ? (string) $x : wp_json_encode( $x );
					}, $v ) );
				}
				$lines[] = $label . ': ' . (string) $v;
			}
		}
		return sanitize_textarea_field( implode( "\n", $lines ) );
	}
}
