<?php
/**
 * Proposal "types" — presets that pre-load the wizard with the right sections in
 * the audit's recommended order (proof before price) and a default pricing shape.
 *
 * Section keys are shared with the public portal renderer and the PDF template.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCP_Types {

	/** All section keys the renderer understands, with human labels. */
	public static function sections() {
		return array(
			'cover'        => __( 'Cover', 'oc-proposals' ),
			'intro'        => __( 'Introduction', 'oc-proposals' ),
			'situation'    => __( 'Your situation', 'oc-proposals' ),
			'proof'        => __( 'Proof (case studies)', 'oc-proposals' ),
			'objectives'   => __( 'Objectives & strategy', 'oc-proposals' ),
			'process'      => __( 'How we work', 'oc-proposals' ),
			'investment'   => __( 'Investment (pricing)', 'oc-proposals' ),
			'next_step'    => __( 'Next step', 'oc-proposals' ),
			'appendix'     => __( 'Appendix (about, services, clients, awards)', 'oc-proposals' ),
		);
	}

	/**
	 * Type presets. `sections` is the default enabled order; `cadences` hints which
	 * pricing cadences the type usually uses.
	 */
	public static function all() {
		$core = array( 'cover', 'intro', 'situation', 'proof', 'objectives', 'process', 'investment', 'next_step', 'appendix' );
		return array(
			'retainer' => array(
				'label'    => __( 'Marketing / PR retainer', 'oc-proposals' ),
				'sections' => $core,
				'cadences' => array( 'oneoff', 'monthly' ),
			),
			'website' => array(
				'label'    => __( 'Website rebuild', 'oc-proposals' ),
				'sections' => $core,
				'cadences' => array( 'project', 'monthly' ),
			),
			'event' => array(
				'label'    => __( 'Event PR', 'oc-proposals' ),
				'sections' => $core,
				'cadences' => array( 'project' ),
			),
		);
	}

	public static function label( $key ) {
		$all = self::all();
		return isset( $all[ $key ] ) ? $all[ $key ]['label'] : ucfirst( (string) $key );
	}

	public static function default_sections( $key ) {
		$all = self::all();
		return isset( $all[ $key ] ) ? $all[ $key ]['sections'] : array_keys( self::sections() );
	}

	/** Pricing cadences and their labels. */
	public static function cadences() {
		return array(
			'oneoff'  => __( 'One-off', 'oc-proposals' ),
			'monthly' => __( 'Monthly', 'oc-proposals' ),
			'project' => __( 'Project / milestone', 'oc-proposals' ),
		);
	}
}
