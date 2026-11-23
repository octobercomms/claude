<?php
/**
 * Endings: routing a visitor by their answers, and deciding what counts as a
 * conversion.
 *
 * Why this file exists. The schema had carried an `endings` map since 1.0 and
 * nothing could reach it: OCF_Schema::sanitize() rebuilt the map from the
 * `default` key alone, so a second ending was deleted the moment the form was
 * saved, and all five reads in the REST API were hardcoded to `['default']`.
 * The live nvelope.co forms asked seven steps about budget and timing and then
 * thanked everyone identically, which is the opposite of qualifying a buyer.
 *
 * The two things most worth guarding are the ones that fail quietly:
 *
 *   An ending with no rules must be SKIPPED, not matched. OCF_Logic::evaluate()
 *   returns true for an empty rule set, which is right for "show this step
 *   unless told otherwise" and catastrophic here: a half-configured ending
 *   would swallow every visitor and shadow everything below it, and the form
 *   would still look like it worked.
 *
 *   is_conversion must stay per-ending. If every ending reports a Lead, Meta
 *   and Google are told to buy whoever will fill in a form, and the reporting
 *   says results improved while enquiry quality falls.
 *
 *   php tests/endings.test.php
 */

define( 'ABSPATH', __DIR__ );

// The handful of WordPress functions these two classes touch. Deliberately
// close to the real behaviour: sanitize_key lowercases and strips, which is
// what makes an outcome safe to use as an event name.
function sanitize_key( $k ) { return preg_replace( '/[^a-z0-9_\-]/', '', strtolower( (string) $k ) ); }
function sanitize_text_field( $v ) { return is_scalar( $v ) ? trim( strip_tags( (string) $v ) ) : ''; }
function sanitize_textarea_field( $v ) { return is_scalar( $v ) ? trim( strip_tags( (string) $v ) ) : ''; }
function esc_url_raw( $v ) { return is_scalar( $v ) ? filter_var( (string) $v, FILTER_SANITIZE_URL ) : ''; }

require_once __DIR__ . '/../includes/class-ocf-logic.php';
require_once __DIR__ . '/../includes/class-ocf-endings.php';

$passed = 0;
$failed = 0;

function ok( $what, callable $fn ) {
	global $passed, $failed;
	try {
		$fn();
		$passed++;
		echo "PASS  $what\n";
	} catch ( \Throwable $e ) {
		$failed++;
		echo "FAIL  $what\n      " . $e->getMessage() . "\n";
	}
}
function assert_that( $cond, $msg ) { if ( ! $cond ) { throw new \Exception( $msg ); } }
function assert_same( $expected, $actual, $msg ) {
	if ( $expected !== $actual ) {
		throw new \Exception( $msg . "\n      expected: " . var_export( $expected, true ) . "\n      actual:   " . var_export( $actual, true ) );
	}
}

// A form shaped like the live Tiam one: budget and timing collected, three
// outcomes worth telling apart.
function form_schema() {
	return array(
		'endings' => OCF_Endings::sanitize_all( array(
			'out_of_scope' => array(
				'heading'       => 'Not a fit',
				'outcome'       => 'out_of_scope',
				'is_conversion' => false,
				'rules'         => array( array( 'question' => 'q_budget', 'op' => 'is', 'value' => 'under_50k' ) ),
			),
			'not_ready' => array(
				'heading'       => 'Worth talking later',
				'outcome'       => 'not_ready',
				'is_conversion' => false,
				'rules'         => array( array( 'question' => 'q_timing', 'op' => 'is', 'value' => 'someday' ) ),
			),
			'qualified' => array(
				'heading'       => 'Book a call',
				'outcome'       => 'qualified',
				'is_conversion' => true,
				'rules'         => array(
					array( 'question' => 'q_budget', 'op' => 'is', 'value' => 'over_250k' ),
					array( 'question' => 'q_timing', 'op' => 'is', 'value' => 'now', 'join' => 'and' ),
				),
			),
			'default' => array( 'heading' => 'Thanks — we got it.', 'outcome' => 'lead' ),
		) ),
	);
}

// ── sanitising ───────────────────────────────────────────────────────────────

ok( 'a non-default ending survives being saved', function () {
	$clean = OCF_Endings::sanitize_all( array(
		'default'   => array( 'heading' => 'Thanks' ),
		'qualified' => array( 'heading' => 'Book a call', 'rules' => array( array( 'question' => 'q1', 'value' => 'yes' ) ) ),
	) );
	assert_that( isset( $clean['qualified'] ),
		'the qualified ending was dropped on save, which is the original bug: the sanitiser rebuilt the map from the default key alone' );
	assert_same( 'Book a call', $clean['qualified']['heading'], 'the ending survived but lost its content' );
} );

ok( 'the order endings were written in is the order they are kept', function () {
	$clean = OCF_Endings::sanitize_all( array(
		'first'   => array( 'rules' => array( array( 'question' => 'q1', 'value' => 'a' ) ) ),
		'second'  => array( 'rules' => array( array( 'question' => 'q1', 'value' => 'b' ) ) ),
		'default' => array(),
	) );
	$keys = array_keys( $clean );
	assert_same( array( 'first', 'second', 'default' ), $keys,
		'order was not preserved; order is the evaluation order, so re-ordering in the builder would silently do nothing' );
} );

ok( 'the fallback is created even when it was never sent', function () {
	$clean = OCF_Endings::sanitize_all( array( 'qualified' => array( 'rules' => array( array( 'question' => 'q1', 'value' => 'y' ) ) ) ) );
	assert_that( isset( $clean['default'] ), 'no fallback, so a visitor matching nothing would get no ending at all' );
} );

ok( 'a rule with no question is dropped', function () {
	$clean = OCF_Endings::sanitize_all( array(
		'x' => array( 'rules' => array(
			array( 'question' => '', 'op' => 'is_not', 'value' => 'anything' ),
			array( 'question' => 'q_real', 'op' => 'is', 'value' => 'yes' ),
		) ),
		'default' => array(),
	) );
	assert_same( 1, count( $clean['x']['rules'] ),
		'a rule naming no question was kept; OCF_Logic reads a null answer for it, and "is_not" against null is true for everybody' );
	assert_same( 'q_real', $clean['x']['rules'][0]['question'], 'the wrong rule was dropped' );
} );

ok( 'the fallback carries no rules', function () {
	$clean = OCF_Endings::sanitize_all( array( 'default' => array( 'rules' => array( array( 'question' => 'q1', 'value' => 'y' ) ) ) ) );
	assert_that( ! isset( $clean['default']['rules'] ),
		'the fallback kept rules, which implies it can be matched; it is reached by exhaustion and nothing else' );
} );

ok( 'outcome falls back to the ending name, and is safe as an event name', function () {
	$clean = OCF_Endings::sanitize_all( array(
		'not_ready' => array( 'rules' => array( array( 'question' => 'q1', 'value' => 'y' ) ) ),
		'messy'     => array( 'outcome' => 'Out Of Scope!!', 'rules' => array( array( 'question' => 'q1', 'value' => 'n' ) ) ),
		'default'   => array(),
	) );
	assert_same( 'not_ready', $clean['not_ready']['outcome'], 'an ending with no outcome set should report under its own name' );
	assert_same( 'outofscope', $clean['messy']['outcome'], 'the outcome was not reduced to something usable as an analytics event name' );
} );

ok( 'is_conversion is a real boolean, not whatever was posted', function () {
	$clean = OCF_Endings::sanitize_all( array(
		'a' => array( 'is_conversion' => 'yes', 'rules' => array( array( 'question' => 'q', 'value' => '1' ) ) ),
		'b' => array( 'is_conversion' => '0',   'rules' => array( array( 'question' => 'q', 'value' => '2' ) ) ),
		'default' => array(),
	) );
	assert_same( true,  $clean['a']['is_conversion'], 'a truthy value did not become true' );
	assert_same( false, $clean['b']['is_conversion'], 'the string "0" did not become false' );
} );

// ── selecting ────────────────────────────────────────────────────────────────

ok( 'a serious buyer reaches the qualified ending', function () {
	$schema = form_schema();
	list( $key, $ending ) = OCF_Endings::select( $schema, array( 'q_budget' => 'over_250k', 'q_timing' => 'now' ) );
	assert_same( 'qualified', $key, 'a visitor with budget and urgency did not reach the qualified ending' );
	assert_same( true, $ending['is_conversion'], 'the qualified ending does not count as a conversion, so the ad platforms learn nothing' );
} );

ok( 'a small budget is out of scope and is NOT a conversion', function () {
	$schema = form_schema();
	list( $key, $ending ) = OCF_Endings::select( $schema, array( 'q_budget' => 'under_50k', 'q_timing' => 'now' ) );
	assert_same( 'out_of_scope', $key, 'an under-budget enquiry was not routed out of scope' );
	assert_same( false, $ending['is_conversion'],
		'an out-of-scope enquiry reported as a conversion; Meta and Google would optimise towards finding more of them' );
} );

ok( 'first match wins, in the order the endings are listed', function () {
	$schema = form_schema();
	// Under budget AND someday: both the first and second ending match. The
	// first listed must win, or ordering in the builder means nothing.
	list( $key ) = OCF_Endings::select( $schema, array( 'q_budget' => 'under_50k', 'q_timing' => 'someday' ) );
	assert_same( 'out_of_scope', $key, 'a later ending overtook an earlier one that also matched' );
} );

ok( 'matching nothing lands on the fallback', function () {
	$schema = form_schema();
	list( $key, $ending ) = OCF_Endings::select( $schema, array( 'q_budget' => 'over_250k', 'q_timing' => 'six_months' ) );
	assert_same( 'default', $key, 'a visitor matching no rule did not reach the fallback' );
	assert_same( false, $ending['is_conversion'], 'the fallback counts as a conversion by default' );
} );

ok( 'an ending with no rules is skipped, never matched', function () {
	$schema = array( 'endings' => OCF_Endings::sanitize_all( array(
		'half_built' => array( 'heading' => 'Work in progress' ),
		'qualified'  => array( 'heading' => 'Book a call', 'is_conversion' => true,
			'rules' => array( array( 'question' => 'q_budget', 'op' => 'is', 'value' => 'over_250k' ) ) ),
		'default'    => array( 'heading' => 'Thanks' ),
	) ) );
	list( $key ) = OCF_Endings::select( $schema, array( 'q_budget' => 'over_250k' ) );
	assert_same( 'qualified', $key,
		'a half-configured ending with no rules swallowed the visitor and shadowed every ending below it; '
		. 'OCF_Logic::evaluate() returns true for an empty rule set, which is correct for step visibility and wrong here' );
} );

ok( 'an empty answer set still resolves', function () {
	$schema = form_schema();
	list( $key ) = OCF_Endings::select( $schema, array() );
	assert_same( 'default', $key, 'a submission with no answers did not resolve to the fallback' );
	list( $key2 ) = OCF_Endings::select( array(), array() );
	assert_same( 'default', $key2, 'a schema with no endings at all threw instead of falling back' );
} );

ok( 'only the answers passed in can choose an ending', function () {
	// The REST layer runs OCF_Logic::filter_visible() before this, so an
	// answer to a question the visitor never saw is already gone. This pins
	// that select() adds nothing of its own on top.
	$schema = form_schema();
	list( $key ) = OCF_Endings::select( $schema, array( 'q_timing' => 'now' ) );
	assert_same( 'default', $key, 'an ending matched on an answer that was not supplied' );
} );

// ── the wire shape ───────────────────────────────────────────────────────────

ok( 'the browser is told the outcome and whether it converts', function () {
	$schema = form_schema();
	$shaped = OCF_Endings::resolve( $schema, array( 'q_budget' => 'over_250k', 'q_timing' => 'now' ) );
	foreach ( array( 'key', 'heading', 'body', 'cta_label', 'cta_url', 'redirect_url', 'outcome', 'is_conversion' ) as $field ) {
		assert_that( array_key_exists( $field, $shaped ), "the shaped ending has no $field, so the page cannot act on it" );
	}
	assert_same( 'qualified', $shaped['outcome'], 'the outcome did not reach the browser, so no event can name it' );
	assert_same( true, $shaped['is_conversion'], 'is_conversion did not reach the browser, so the Lead event never fires' );
} );

ok( 'an ending with no heading still renders something', function () {
	$shaped = OCF_Endings::shape( array() );
	assert_same( 'Thanks!', $shaped['heading'], 'a blank ending would render an empty screen' );
} );

// ── the outcome has to be stored, not just rendered ─────────────────────────

ok( 'the resolved outcome is a storable label, not a sentence', function () {
	// It goes into a VARCHAR(40) and is read back by OMI to answer "how many
	// qualified enquiries did this client have". A label that varies by
	// punctuation cannot be grouped.
	$schema = form_schema();
	foreach ( array(
		array( 'q_budget' => 'over_250k', 'q_timing' => 'now' ),
		array( 'q_budget' => 'under_50k' ),
		array( 'q_timing' => 'someday' ),
		array(),
	) as $answers ) {
		$shaped = OCF_Endings::resolve( $schema, $answers );
		assert_that( is_string( $shaped['outcome'] ) && $shaped['outcome'] !== '',
			'an outcome resolved to nothing, so the submission row would carry no label' );
		assert_that( strlen( $shaped['outcome'] ) <= 40,
			'the outcome is longer than the column that stores it: ' . $shaped['outcome'] );
		assert_that( (bool) preg_match( '/^[a-z0-9_\-]+$/', $shaped['outcome'] ),
			'the outcome is not groupable: ' . $shaped['outcome'] );
	}
} );

ok( 'the four endings resolve to four distinct labels', function () {
	$schema = form_schema();
	$seen = array();
	foreach ( array(
		array( 'q_budget' => 'over_250k', 'q_timing' => 'now' ),
		array( 'q_budget' => 'under_50k' ),
		array( 'q_timing' => 'someday' ),
		array( 'q_budget' => 'mid', 'q_timing' => 'six_months' ),
	) as $answers ) {
		$seen[] = OCF_Endings::resolve( $schema, $answers )['outcome'];
	}
	assert_same( 4, count( array_unique( $seen ) ),
		'two different endings reported the same outcome, so they cannot be told apart in reporting: ' . implode( ', ', $seen ) );
} );

echo "\n$passed passed, $failed failed\n";
exit( $failed > 0 ? 1 : 0 );
