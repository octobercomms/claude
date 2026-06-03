<?php
/**
 * Google Static Maps client — fetches a top-down satellite photo of the actual
 * plot to sit alongside the Gemini 'masterplan' in the render pack.
 *
 * The satellite image is the REAL aerial photo of the site (current planting and
 * structures); the 'masterplan' pack view is a Gemini render of the *designed*
 * scheme from above. They are deliberately kept as two separate pack views.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Maps {

	const STATICMAP_ENDPOINT = 'https://maps.googleapis.com/maps/api/staticmap';

	/** Is a Google Maps API key configured? */
	public static function is_configured() {
		return '' !== trim( (string) HGD_Settings::get( 'google_maps_api_key', '' ) );
	}

	/**
	 * Fetch a satellite image for an address / postcode.
	 *
	 * @param string $address_or_postcode Free-text address or postcode to centre on.
	 * @param int    $project_id          Optional project association for cost logging.
	 * @return array|WP_Error array( 'bytes', 'mime' ) on success, WP_Error otherwise.
	 */
	public static function fetch_satellite( $address_or_postcode, $project_id = null ) {
		$key = trim( (string) HGD_Settings::get( 'google_maps_api_key', '' ) );
		if ( '' === $key ) {
			return new WP_Error( 'hgd_maps_no_key', __( 'No Google Maps API key configured.', 'hillcroft-garden-designer' ) );
		}

		$center = trim( (string) $address_or_postcode );
		if ( '' === $center ) {
			return new WP_Error( 'hgd_maps_no_location', __( 'No address or postcode to look up.', 'hillcroft-garden-designer' ) );
		}

		$url = add_query_arg( array(
			'center'  => rawurlencode( $center ),
			'zoom'    => 20,
			'size'    => '640x640',
			'scale'   => 2,
			'maptype' => 'satellite',
			'key'     => rawurlencode( $key ),
		), self::STATICMAP_ENDPOINT );

		$response = wp_remote_get( $url, array( 'timeout' => 30 ) );
		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		$mime = (string) wp_remote_retrieve_header( $response, 'content-type' );
		$body = wp_remote_retrieve_body( $response );

		if ( 200 !== $code || 0 !== strpos( $mime, 'image/' ) || '' === $body ) {
			$msg = '';
			if ( 0 !== strpos( $mime, 'image/' ) && '' !== $body ) {
				// Google returns a plain-text error body for bad requests.
				$msg = trim( wp_strip_all_tags( $body ) );
			}
			if ( '' === $msg ) {
				$msg = sprintf( /* translators: %d HTTP code */ __( 'Google Static Maps returned HTTP %d.', 'hillcroft-garden-designer' ), $code );
			}
			return new WP_Error( 'hgd_maps_http', $msg, array( 'status' => $code ) );
		}

		// Log cost in GBP for the banner: rate is per 1,000 calls.
		$rate_per_1k = (float) HGD_Settings::get( 'rate_maps_per_1k_usd', 7.0 );
		$usd2gbp     = (float) HGD_Settings::get( 'usd_to_gbp', 0.79 );
		$cost_gbp    = ( $rate_per_1k / 1000 ) * $usd2gbp;
		HGD_API_Usage::log( 'maps', 1, 'staticmap', $cost_gbp, $project_id, array( 'maptype' => 'satellite' ) );

		// Normalise mime (header may carry charset etc.).
		$clean_mime = 'image/png';
		if ( 0 === strpos( $mime, 'image/jpeg' ) || 0 === strpos( $mime, 'image/jpg' ) ) {
			$clean_mime = 'image/jpeg';
		} elseif ( 0 === strpos( $mime, 'image/png' ) ) {
			$clean_mime = 'image/png';
		} elseif ( 0 === strpos( $mime, 'image/webp' ) ) {
			$clean_mime = 'image/webp';
		} elseif ( 0 === strpos( $mime, 'image/gif' ) ) {
			$clean_mime = 'image/gif';
		}

		return array(
			'bytes' => $body,
			'mime'  => $clean_mime,
		);
	}

	/**
	 * Fetch the satellite image for a project (using its address, falling back to
	 * postcode), save it to the media library and link it as a 'satellite' pack view.
	 *
	 * @param int $project_id
	 * @return int|WP_Error Asset row id on success, WP_Error otherwise.
	 */
	public static function save_satellite_asset( $project_id ) {
		$project_id = (int) $project_id;
		$project    = HGD_Project::get( $project_id );
		if ( ! $project ) {
			return new WP_Error( 'hgd_maps_no_project', __( 'Project not found.', 'hillcroft-garden-designer' ) );
		}

		$location = trim( (string) ( isset( $project['address'] ) ? $project['address'] : '' ) );
		if ( '' === $location ) {
			$location = trim( (string) ( isset( $project['postcode'] ) ? $project['postcode'] : '' ) );
		}
		if ( '' === $location ) {
			return new WP_Error( 'hgd_maps_no_location', __( 'This project has no address or postcode to look up.', 'hillcroft-garden-designer' ) );
		}

		$result = self::fetch_satellite( $location, $project_id );
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		$att_id = HGD_Gemini::save_image_as_attachment( $result['bytes'], $result['mime'], $project_id, 'satellite' );
		if ( is_wp_error( $att_id ) ) {
			return $att_id;
		}

		$asset_id = HGD_Project_Asset::add( $project_id, $att_id, 'pack', 'satellite', __( 'Satellite view', 'hillcroft-garden-designer' ) );
		return (int) $asset_id;
	}
}
