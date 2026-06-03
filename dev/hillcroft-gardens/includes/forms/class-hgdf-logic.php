<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Server-side evaluator for conditional logic rules. Mirrors the client-side
 * logic in assets/forms/js/frontend.js so a malicious actor can't bypass branching
 * by submitting answers for hidden questions.
 */
class HGDF_Logic {

	public static function evaluate( $rules, $answers ) {
		if ( empty( $rules ) || ! is_array( $rules ) ) {
			return true;
		}
		$result = null;
		foreach ( $rules as $rule ) {
			$match = self::match( $rule, $answers );
			$join  = $rule['join'] ?? 'and';
			if ( $result === null ) {
				$result = $match;
				continue;
			}
			$result = ( $join === 'or' ) ? ( $result || $match ) : ( $result && $match );
		}
		return (bool) $result;
	}

	private static function match( $rule, $answers ) {
		$qid   = $rule['question'] ?? '';
		$op    = $rule['op'] ?? 'is';
		$value = $rule['value'] ?? '';
		$ans   = $answers[ $qid ] ?? null;

		switch ( $op ) {
			case 'is':
				return is_array( $ans ) ? in_array( $value, $ans, true ) : (string) $ans === (string) $value;
			case 'is_not':
				return is_array( $ans ) ? ! in_array( $value, $ans, true ) : (string) $ans !== (string) $value;
			case 'contains':
				if ( is_array( $ans ) ) {
					return in_array( $value, $ans, true );
				}
				return $ans !== null && stripos( (string) $ans, (string) $value ) !== false;
			case 'not_contains':
				if ( is_array( $ans ) ) {
					return ! in_array( $value, $ans, true );
				}
				return $ans === null || stripos( (string) $ans, (string) $value ) === false;
			case 'is_set':
				return $ans !== null && $ans !== '' && $ans !== array();
			case 'is_empty':
				return $ans === null || $ans === '' || $ans === array();
			case 'gt':
				return is_numeric( $ans ) && is_numeric( $value ) && (float) $ans > (float) $value;
			case 'lt':
				return is_numeric( $ans ) && is_numeric( $value ) && (float) $ans < (float) $value;
		}
		return false;
	}

	/**
	 * Strip answers for questions that are hidden by logic given the current
	 * answers map. Useful when persisting partial state and when normalizing
	 * the payload before submitting to Brevo.
	 */
	public static function filter_visible( $schema, $answers ) {
		$visible = array();
		foreach ( (array) ( $schema['steps'] ?? array() ) as $step ) {
			if ( ! self::evaluate( $step['show_if'] ?? array(), $answers ) ) {
				continue;
			}
			foreach ( (array) ( $step['questions'] ?? array() ) as $q ) {
				if ( ! HGDF_Schema::type_is_storable( $q['type'] ) ) {
					continue;
				}
				if ( ! self::evaluate( $q['show_if'] ?? array(), $answers ) ) {
					continue;
				}
				$qid = $q['id'];
				if ( array_key_exists( $qid, $answers ) ) {
					$visible[ $qid ] = $answers[ $qid ];
				}
			}
		}
		return $visible;
	}
}
