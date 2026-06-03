<?php
/**
 * Optional second render engine: Flux + ControlNet via fal.ai.
 *
 * Where Gemini composes a render from a text prompt + loose reference images,
 * this engine uses ControlNet *structural conditioning*: the approved top-down
 * plan (or the sketch) is fed in as a control image so the generated render
 * follows that exact layout — bed shapes, paths and structures land where the
 * plan puts them. It's optional: nothing here runs until a fal.ai key is set,
 * and the UI degrades gracefully without one.
 *
 * Uses fal.ai's synchronous endpoint (https://fal.run/<model>) which blocks
 * until the image is ready and returns a hosted image URL we then download.
 * The control image is passed by URL, so fal must be able to reach the media
 * file — i.e. this works on a live, publicly-reachable site.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Flux {

	const ENDPOINT_BASE = 'https://fal.run/';
	const DEFAULT_MODEL = 'fal-ai/flux-control-lora-canny';

	public static function is_configured() {
		return '' !== trim( (string) HGD_Settings::get( 'flux_api_key', '' ) );
	}

	/**
	 * Generate a structurally-conditioned render.
	 *
	 * @param string $prompt               Text prompt (the design + style).
	 * @param int    $control_attachment_id Attachment id used as the ControlNet guide (plan/sketch).
	 * @param int    $project_id
	 * @return array|WP_Error { bytes, mime } on success.
	 */
	public static function generate_image( $prompt, $control_attachment_id, $project_id = null ) {
		$key = trim( (string) HGD_Settings::get( 'flux_api_key', '' ) );
		if ( '' === $key ) {
			return new WP_Error( 'hgd_flux_no_key', __( 'No fal.ai (Flux) API key configured.', 'hillcroft-garden-designer' ) );
		}

		$model = trim( (string) HGD_Settings::get( 'flux_model', self::DEFAULT_MODEL ) );
		if ( '' === $model ) {
			$model = self::DEFAULT_MODEL;
		}

		$control_url = (string) wp_get_attachment_image_url( (int) $control_attachment_id, 'full' );
		if ( '' === $control_url ) {
			return new WP_Error( 'hgd_flux_no_control', __( 'No plan or sketch is available to guide the structural render. Generate a plan first.', 'hillcroft-garden-designer' ) );
		}

		// fal ControlNet models commonly accept control_image_url; we also send
		// image_url for img2img variants. Extra keys are ignored by fal.
		$body = array(
			'prompt'              => (string) $prompt,
			'control_image_url'   => $control_url,
			'image_url'           => $control_url,
			'num_inference_steps' => 28,
			'guidance_scale'      => 3.5,
			'num_images'          => 1,
			'enable_safety_checker' => true,
		);

		$response = wp_remote_post( self::ENDPOINT_BASE . $model, array(
			'timeout' => 180,
			'headers' => array(
				'authorization' => 'Key ' . $key,
				'content-type'  => 'application/json',
			),
			'body'    => wp_json_encode( $body ),
		) );

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		$raw  = wp_remote_retrieve_body( $response );
		$data = json_decode( $raw, true );

		if ( 200 !== $code ) {
			if ( 401 === $code || 403 === $code ) {
				return new WP_Error( 'hgd_flux_auth', __( 'fal.ai rejected the API key. Check the key under Settings.', 'hillcroft-garden-designer' ), array( 'status' => $code ) );
			}
			$msg = '';
			if ( is_array( $data ) ) {
				if ( isset( $data['detail'] ) && is_string( $data['detail'] ) ) {
					$msg = $data['detail'];
				} elseif ( isset( $data['detail'][0]['msg'] ) ) {
					$msg = (string) $data['detail'][0]['msg'];
				} elseif ( isset( $data['error'] ) && is_string( $data['error'] ) ) {
					$msg = $data['error'];
				}
			}
			if ( '' === $msg ) {
				$msg = sprintf( /* translators: %d HTTP code */ __( 'The Flux (fal.ai) API returned HTTP %d.', 'hillcroft-garden-designer' ), $code );
			}
			return new WP_Error( 'hgd_flux_http', $msg, array( 'status' => $code ) );
		}

		// Locate the result image URL.
		$image_url = '';
		$mime      = 'image/jpeg';
		if ( is_array( $data ) ) {
			if ( ! empty( $data['images'][0]['url'] ) ) {
				$image_url = (string) $data['images'][0]['url'];
				if ( ! empty( $data['images'][0]['content_type'] ) ) {
					$mime = (string) $data['images'][0]['content_type'];
				}
			} elseif ( ! empty( $data['image']['url'] ) ) {
				$image_url = (string) $data['image']['url'];
				if ( ! empty( $data['image']['content_type'] ) ) {
					$mime = (string) $data['image']['content_type'];
				}
			}
		}

		if ( '' === $image_url ) {
			return new WP_Error( 'hgd_flux_no_image', __( 'Flux returned no image. Try a different model under Settings, or adjust the prompt.', 'hillcroft-garden-designer' ) );
		}

		// Download the hosted image bytes.
		$img = wp_remote_get( $image_url, array( 'timeout' => 120 ) );
		if ( is_wp_error( $img ) ) {
			return $img;
		}
		if ( 200 !== (int) wp_remote_retrieve_response_code( $img ) ) {
			return new WP_Error( 'hgd_flux_fetch', __( 'Could not download the image Flux produced.', 'hillcroft-garden-designer' ) );
		}
		$bytes = wp_remote_retrieve_body( $img );
		if ( '' === $bytes ) {
			return new WP_Error( 'hgd_flux_empty', __( 'Flux returned an empty image.', 'hillcroft-garden-designer' ) );
		}
		// Prefer the real content-type header from the download when present.
		$ct = wp_remote_retrieve_header( $img, 'content-type' );
		if ( $ct && false !== strpos( (string) $ct, 'image/' ) ) {
			$mime = trim( explode( ';', (string) $ct )[0] );
		}

		// Log cost in GBP for the banner.
		$rate     = (float) HGD_Settings::get( 'rate_flux_per_image_usd', 0.05 );
		$usd2gbp  = (float) HGD_Settings::get( 'usd_to_gbp', 0.79 );
		$cost_gbp = $rate * $usd2gbp;
		HGD_API_Usage::log( 'flux', 1, 'image', $cost_gbp, $project_id, array( 'model' => $model ) );

		return array(
			'bytes' => $bytes,
			'mime'  => $mime,
		);
	}
}
