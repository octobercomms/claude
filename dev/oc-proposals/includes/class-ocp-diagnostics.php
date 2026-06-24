<?php
/**
 * Current-state diagnostics, Tier 1: public SEO metrics for a cold prospect's
 * domain via DataForSEO (no access to their accounts needed). Tier 2 (OMI API,
 * for connected clients) is a separate integration once OMI exposes a read API.
 *
 * Produces a short "where you are now" snapshot the wizard can drop into the
 * Situation section. Degrades to an empty result when credentials are absent.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCP_Diagnostics {

	public static function enabled() {
		return '' !== trim( (string) OCP_Settings::get( 'dataforseo_login' ) )
			&& '' !== trim( (string) OCP_Settings::get( 'dataforseo_password' ) );
	}

	/**
	 * Fetch a domain's headline SEO metrics.
	 *
	 * @return array{domain:string, rank:int, organic_traffic:int, keywords:int}|array
	 */
	public static function domain_snapshot( $domain ) {
		$domain = preg_replace( '#^https?://#', '', trim( (string) $domain ) );
		$domain = preg_replace( '#/.*$#', '', $domain );
		if ( '' === $domain || ! self::enabled() ) {
			return array();
		}
		$login = OCP_Settings::get( 'dataforseo_login' );
		$pass  = OCP_Settings::get( 'dataforseo_password' );
		$auth  = base64_encode( $login . ':' . $pass );

		$res = wp_remote_post( 'https://api.dataforseo.com/v3/dataforseo_labs/google/domain_rank_overview/live', array(
			'headers' => array(
				'Authorization' => 'Basic ' . $auth,
				'Content-Type'  => 'application/json',
			),
			'body'    => wp_json_encode( array( array( 'target' => $domain, 'location_code' => 2826, 'language_code' => 'en' ) ) ),
			'timeout' => 30,
		) );
		if ( is_wp_error( $res ) ) {
			return array();
		}
		$json   = json_decode( wp_remote_retrieve_body( $res ), true );
		$metrics = $json['tasks'][0]['result'][0]['items'][0]['metrics']['organic'] ?? array();
		if ( ! $metrics ) {
			return array( 'domain' => $domain );
		}
		return array(
			'domain'          => $domain,
			'organic_traffic' => (int) ( $metrics['etv'] ?? 0 ),
			'keywords'        => (int) ( $metrics['count'] ?? 0 ),
			'rank'            => (int) ( $metrics['pos_1'] ?? 0 ),
		);
	}

	/** A short prose snapshot, optionally enriched by Claude. */
	public static function snapshot_text( $domain ) {
		$m = self::domain_snapshot( $domain );
		if ( ! $m || empty( $m['domain'] ) ) {
			return '';
		}
		$base = sprintf(
			/* translators: 1: domain 2: keywords 3: traffic */
			__( '%1$s currently ranks for around %2$s organic keywords with an estimated %3$s monthly organic visits.', 'oc-proposals' ),
			$m['domain'],
			number_format_i18n( $m['keywords'] ?? 0 ),
			number_format_i18n( $m['organic_traffic'] ?? 0 )
		);
		if ( OCP_Claude::enabled() ) {
			$enriched = OCP_Claude::message(
				'Turn these SEO metrics into one or two encouraging-but-honest sentences for a proposal’s "your situation" section. British English.',
				array( array( 'role' => 'user', 'content' => wp_json_encode( $m ) ) ),
				OCP_Claude::MODEL_DRAFT,
				200
			);
			if ( ! is_wp_error( $enriched ) && trim( $enriched ) ) {
				return trim( $enriched );
			}
		}
		return $base;
	}
}
