<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Endings: which screen a visitor lands on, and whether that counts as a
 * conversion.
 *
 * The schema has carried an `endings` map since 1.0, but only ever held and
 * served `endings['default']`. OCF_Schema::sanitize() rebuilt the map from the
 * default key alone, so any other ending was silently deleted on save, and
 * every read in the REST API was hardcoded to `['default']`. The result: a
 * seven-step form that asks for budget and timing, and then thanks everyone
 * identically.
 *
 * That is the gap this closes. The qualification data was already being
 * collected; nothing was being done with it.
 *
 * Two things hang off an ending:
 *
 *   `outcome`        a slug naming what happened — qualified, not_ready,
 *                    out_of_scope — which becomes the analytics event
 *                    `sbm_{outcome}`, matching the convention the theme
 *                    already uses for `sbm_{step}`.
 *   `is_conversion`  whether the ad platforms should be told this is a
 *                    conversion. This is the control that matters. Reporting
 *                    every completion as a Lead tells Meta and Google to buy
 *                    whoever will fill in a form, which is the opposite of
 *                    qualifying. Mark only the endings worth paying for.
 *
 * Selection is ordered and first-match-wins, so the order endings appear in
 * the builder is the order they are tested. `default` is the fallback and is
 * never matched by rule.
 *
 * Rules use OCF_Logic, the same evaluator as step and question visibility, and
 * run against answers that OCF_Logic::filter_visible() has already pruned — so
 * an answer to a question the visitor never saw cannot pick their ending.
 */
class OCF_Endings {

	/** Endings a visitor can be routed to, beyond the fallback. */
	const DEFAULT_KEY = 'default';

	/**
	 * Sanitise the whole map, not just the default.
	 *
	 * Order is preserved: PHP keeps string keys in insertion order, and that
	 * order is the evaluation order, so re-ordering in the builder changes
	 * behaviour and must survive a save.
	 */
	public static function sanitize_all( $endings ) {
		$endings = is_array( $endings ) ? $endings : array();
		$out     = array();

		foreach ( $endings as $key => $ending ) {
			$slug = sanitize_key( $key );
			if ( $slug === '' ) {
				continue;
			}
			$out[ $slug ] = self::sanitize_one( is_array( $ending ) ? $ending : array(), $slug );
		}

		// The fallback always exists, whatever arrived.
		if ( ! isset( $out[ self::DEFAULT_KEY ] ) ) {
			$out[ self::DEFAULT_KEY ] = self::sanitize_one( array(), self::DEFAULT_KEY );
		}

		return $out;
	}

	private static function sanitize_one( $ending, $slug ) {
		$clean = array(
			'label'        => sanitize_text_field( $ending['label']    ?? '' ),
			'heading'      => sanitize_text_field( $ending['heading']  ?? '' ),
			'body'         => sanitize_textarea_field( $ending['body'] ?? '' ),
			'cta_label'    => sanitize_text_field( $ending['cta_label'] ?? '' ),
			'cta_url'      => esc_url_raw( $ending['cta_url']           ?? '' ),
			'redirect_url' => esc_url_raw( $ending['redirect_url']      ?? '' ),
			// Falls back to the key, so an ending called `qualified` reports
			// `sbm_qualified` without anything else being filled in.
			'outcome'      => sanitize_key( $ending['outcome'] ?? '' ) ?: $slug,
			'is_conversion' => ! empty( $ending['is_conversion'] ),
		);

		// The fallback is reached by exhaustion, never by rule. Storing rules
		// on it would imply otherwise.
		if ( $slug !== self::DEFAULT_KEY ) {
			$clean['rules'] = self::sanitize_rules( $ending['rules'] ?? array() );
		}

		return $clean;
	}

	/**
	 * Rules in OCF_Logic's shape. Kept deliberately narrow: a rule with no
	 * question is dropped, because OCF_Logic::match() would read a null answer
	 * and an `is_not` comparison against null is true for everybody.
	 */
	private static function sanitize_rules( $rules ) {
		if ( ! is_array( $rules ) ) {
			return array();
		}
		$out = array();
		foreach ( $rules as $rule ) {
			if ( ! is_array( $rule ) ) {
				continue;
			}
			$question = sanitize_text_field( $rule['question'] ?? '' );
			if ( $question === '' ) {
				continue;
			}
			$value = $rule['value'] ?? '';
			$out[] = array(
				'question' => $question,
				'op'       => sanitize_key( $rule['op'] ?? 'is' ) ?: 'is',
				'value'    => is_array( $value ) ? array_map( 'sanitize_text_field', $value ) : sanitize_text_field( $value ),
				'join'     => ( ( $rule['join'] ?? 'and' ) === 'or' ) ? 'or' : 'and',
			);
		}
		return $out;
	}

	/**
	 * Pick the ending for a set of answers. Returns [ key, ending ].
	 *
	 * A non-default ending with no rules is skipped rather than matched.
	 * OCF_Logic::evaluate() returns true for an empty rule set — correct for
	 * "show this step unless told otherwise", wrong here, where it would make
	 * the first half-configured ending swallow every visitor and shadow
	 * everything below it.
	 */
	public static function select( $schema, $answers ) {
		$endings = isset( $schema['endings'] ) && is_array( $schema['endings'] ) ? $schema['endings'] : array();
		$answers = is_array( $answers ) ? $answers : array();

		foreach ( $endings as $key => $ending ) {
			if ( $key === self::DEFAULT_KEY || ! is_array( $ending ) ) {
				continue;
			}
			$rules = $ending['rules'] ?? array();
			if ( empty( $rules ) ) {
				continue;
			}
			if ( OCF_Logic::evaluate( $rules, $answers ) ) {
				return array( $key, $ending );
			}
		}

		return array( self::DEFAULT_KEY, $endings[ self::DEFAULT_KEY ] ?? array() );
	}

	/**
	 * The wire shape the browser gets. `outcome` and `is_conversion` travel
	 * with it so the page can fire the right analytics without a second call.
	 */
	public static function shape( $ending, $key = self::DEFAULT_KEY ) {
		$ending = is_array( $ending ) ? $ending : array();
		return array(
			'key'           => $key,
			'heading'       => ( isset( $ending['heading'] ) && $ending['heading'] !== '' ) ? $ending['heading'] : 'Thanks!',
			'body'          => $ending['body']          ?? '',
			'cta_label'     => $ending['cta_label']     ?? '',
			'cta_url'       => $ending['cta_url']       ?? '',
			'redirect_url'  => $ending['redirect_url']  ?? '',
			'outcome'       => $ending['outcome']       ?? $key,
			'is_conversion' => ! empty( $ending['is_conversion'] ),
		);
	}

	/** Select and shape in one step, for the REST layer. */
	public static function resolve( $schema, $answers ) {
		list( $key, $ending ) = self::select( $schema, $answers );
		return self::shape( $ending, $key );
	}
}
