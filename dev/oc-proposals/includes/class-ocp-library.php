<?php
/**
 * Reusable content library — case studies, testimonials, services, awards and
 * showcase clients. Each entity is described by a fields registry so one generic
 * admin screen (list + edit) serves them all.
 *
 * Case studies carry sector/service tags so proposals can auto-filter proof to
 * the client's sector. A file-upload → Claude draft hook is exposed for the
 * AI build (PR7) to populate a study from raw data; here it's a plain editor.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCP_Library {

	/**
	 * Entity registry: key => [ table, singular, plural, list_columns, fields ].
	 * Field types: text, textarea, richtext, url, image, number, select.
	 */
	public static function entities() {
		return array(
			'case_study' => array(
				'table'   => OCP_DB::case_studies_table(),
				'singular' => __( 'Case study', 'oc-proposals' ),
				'plural'   => __( 'Case studies', 'oc-proposals' ),
				'list'     => array( 'title', 'sector', 'services' ),
				'fields'   => array(
					'title'    => array( 'label' => __( 'Title', 'oc-proposals' ), 'type' => 'text' ),
					'client'   => array( 'label' => __( 'Client', 'oc-proposals' ), 'type' => 'text' ),
					'sector'   => array( 'label' => __( 'Sector tag', 'oc-proposals' ), 'type' => 'text' ),
					'services' => array( 'label' => __( 'Service tags (comma-sep)', 'oc-proposals' ), 'type' => 'text' ),
					'summary'  => array( 'label' => __( 'Summary', 'oc-proposals' ), 'type' => 'textarea' ),
					'body'     => array( 'label' => __( 'Body', 'oc-proposals' ), 'type' => 'richtext' ),
					'stats'    => array( 'label' => __( 'Headline stats (one per line: 454% | Return on investment)', 'oc-proposals' ), 'type' => 'textarea' ),
					'video_url' => array( 'label' => __( 'Loom video URL', 'oc-proposals' ), 'type' => 'url' ),
					'link_url' => array( 'label' => __( 'Live coverage / project URL', 'oc-proposals' ), 'type' => 'url' ),
					'image'    => array( 'label' => __( 'Image URL', 'oc-proposals' ), 'type' => 'url' ),
				),
			),
			'testimonial' => array(
				'table'   => OCP_DB::testimonials_table(),
				'singular' => __( 'Testimonial', 'oc-proposals' ),
				'plural'   => __( 'Testimonials', 'oc-proposals' ),
				'list'     => array( 'company', 'person', 'sector' ),
				'fields'   => array(
					'company' => array( 'label' => __( 'Company', 'oc-proposals' ), 'type' => 'text' ),
					'person'  => array( 'label' => __( 'Person', 'oc-proposals' ), 'type' => 'text' ),
					'role'    => array( 'label' => __( 'Role', 'oc-proposals' ), 'type' => 'text' ),
					'quote'   => array( 'label' => __( 'Quote', 'oc-proposals' ), 'type' => 'textarea' ),
					'logo'    => array( 'label' => __( 'Company logo URL', 'oc-proposals' ), 'type' => 'url' ),
					'link_url' => array( 'label' => __( 'Link URL', 'oc-proposals' ), 'type' => 'url' ),
					'sector'  => array( 'label' => __( 'Sector tag', 'oc-proposals' ), 'type' => 'text' ),
				),
			),
			'service' => array(
				'table'   => OCP_DB::services_table(),
				'singular' => __( 'Service', 'oc-proposals' ),
				'plural'   => __( 'Services', 'oc-proposals' ),
				'list'     => array( 'name', 'slug' ),
				'fields'   => array(
					'name' => array( 'label' => __( 'Name', 'oc-proposals' ), 'type' => 'text' ),
					'slug' => array( 'label' => __( 'Slug', 'oc-proposals' ), 'type' => 'text' ),
					'body' => array( 'label' => __( 'Description (canonical boilerplate)', 'oc-proposals' ), 'type' => 'richtext' ),
					'icon' => array( 'label' => __( 'Icon URL', 'oc-proposals' ), 'type' => 'url' ),
				),
			),
			'award' => array(
				'table'   => OCP_DB::awards_table(),
				'singular' => __( 'Award', 'oc-proposals' ),
				'plural'   => __( 'Awards', 'oc-proposals' ),
				'list'     => array( 'title' ),
				'fields'   => array(
					'title' => array( 'label' => __( 'Title', 'oc-proposals' ), 'type' => 'text' ),
					'body'  => array( 'label' => __( 'Description', 'oc-proposals' ), 'type' => 'textarea' ),
					'logo'  => array( 'label' => __( 'Logo URL', 'oc-proposals' ), 'type' => 'url' ),
				),
			),
			'client' => array(
				'table'   => OCP_DB::clients_table(),
				'singular' => __( 'Showcase client', 'oc-proposals' ),
				'plural'   => __( 'Showcase clients', 'oc-proposals' ),
				'list'     => array( 'name', 'category' ),
				'fields'   => array(
					'name'     => array( 'label' => __( 'Name', 'oc-proposals' ), 'type' => 'text' ),
					'category' => array( 'label' => __( 'Category (Design, Architecture, Property, Events…)', 'oc-proposals' ), 'type' => 'text' ),
					'logo'     => array( 'label' => __( 'Logo URL', 'oc-proposals' ), 'type' => 'url' ),
				),
			),
		);
	}

	public static function entity( $key ) {
		$all = self::entities();
		return isset( $all[ $key ] ) ? $all[ $key ] : null;
	}

	/** Case studies whose sector/service tags match a proposal's sector. */
	public static function case_studies_for_sector( $sector, $limit = 3 ) {
		$all = OCP_Repo::all( OCP_DB::case_studies_table(), 'created_at DESC' );
		if ( ! $sector ) {
			return array_slice( $all, 0, $limit );
		}
		$sector = strtolower( $sector );
		$matched = array_filter( $all, function ( $cs ) use ( $sector ) {
			return false !== strpos( strtolower( $cs['sector'] . ' ' . $cs['services'] ), $sector );
		} );
		$matched = array_slice( array_values( $matched ), 0, $limit );
		return $matched ? $matched : array_slice( $all, 0, $limit );
	}

	/**
	 * Parse a stats textarea ("454% | Return on investment" per line) into pairs.
	 *
	 * @return array<int,array{value:string,label:string}>
	 */
	public static function parse_stats( $raw ) {
		$out = array();
		foreach ( preg_split( '/\r?\n/', (string) $raw ) as $line ) {
			$line = trim( $line );
			if ( '' === $line ) {
				continue;
			}
			$parts = array_map( 'trim', explode( '|', $line, 2 ) );
			$out[] = array( 'value' => $parts[0], 'label' => isset( $parts[1] ) ? $parts[1] : '' );
		}
		return $out;
	}
}
