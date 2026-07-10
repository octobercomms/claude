<?php
/**
 * Composite-back — the exactness guarantee for the correction loop.
 *
 * fal inpaint models don't guarantee that pixels OUTSIDE the mask stay identical;
 * they can subtly re-render the whole frame. That's the "can't get it exact"
 * problem. So after an edit we paste the model's result back over the original
 * ONLY inside the mask, with a soft (feathered) edge to avoid a visible seam.
 * Everything outside the feather is byte-for-byte the original.
 *
 * out = original * (1 - a) + result * a,  where a = feathered mask (white = change).
 *
 * Uses GD (near-universally available in WordPress).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Image_Composite {

	/**
	 * @param string $original_bytes The base image (locked/active render).
	 * @param string $result_bytes   The inpaint model's output.
	 * @param string $mask_bytes     Binary mask PNG (white = change, black = keep).
	 * @return array|WP_Error { bytes (png), mime }.
	 */
	public static function composite( $original_bytes, $result_bytes, $mask_bytes ) {
		if ( ! function_exists( 'imagecreatefromstring' ) ) {
			return new WP_Error( 'hgd_composite_no_gd', __( 'Image compositing requires the GD extension.', 'hillcroft-garden-designer' ) );
		}

		$orig = @imagecreatefromstring( $original_bytes );
		$res  = @imagecreatefromstring( $result_bytes );
		$mask = @imagecreatefromstring( $mask_bytes );
		if ( ! $orig || ! $res || ! $mask ) {
			foreach ( array( $orig, $res, $mask ) as $im ) {
				if ( $im ) { imagedestroy( $im ); }
			}
			return new WP_Error( 'hgd_composite_decode', __( 'Could not read one of the images to composite.', 'hillcroft-garden-designer' ) );
		}

		$w = imagesx( $orig );
		$h = imagesy( $orig );

		// Normalise result + mask to the original's dimensions.
		$res  = self::fit( $res, $w, $h );
		$mask = self::fit( $mask, $w, $h );

		// Feather the mask edge so the composite has no hard seam.
		if ( function_exists( 'imagefilter' ) ) {
			for ( $i = 0; $i < 6; $i++ ) {
				imagefilter( $mask, IMG_FILTER_GAUSSIAN_BLUR );
			}
		}

		$out = imagecreatetruecolor( $w, $h );
		for ( $y = 0; $y < $h; $y++ ) {
			for ( $x = 0; $x < $w; $x++ ) {
				$m = imagecolorat( $mask, $x, $y ) & 0xFF; // blue channel ≈ luminance for grey mask
				if ( 0 === $m ) {
					// Fully outside the mask — copy the original pixel verbatim.
					imagesetpixel( $out, $x, $y, imagecolorat( $orig, $x, $y ) );
					continue;
				}
				$a  = $m / 255;
				$oc = imagecolorat( $orig, $x, $y );
				$rc = imagecolorat( $res, $x, $y );
				$or = ( $oc >> 16 ) & 0xFF; $og = ( $oc >> 8 ) & 0xFF; $ob = $oc & 0xFF;
				$rr = ( $rc >> 16 ) & 0xFF; $rg = ( $rc >> 8 ) & 0xFF; $rb = $rc & 0xFF;
				$nr = (int) round( $or * ( 1 - $a ) + $rr * $a );
				$ng = (int) round( $og * ( 1 - $a ) + $rg * $a );
				$nb = (int) round( $ob * ( 1 - $a ) + $rb * $a );
				imagesetpixel( $out, $x, $y, ( $nr << 16 ) | ( $ng << 8 ) | $nb );
			}
		}

		ob_start();
		imagepng( $out );
		$bytes = ob_get_clean();

		imagedestroy( $orig );
		imagedestroy( $res );
		imagedestroy( $mask );
		imagedestroy( $out );

		if ( '' === $bytes ) {
			return new WP_Error( 'hgd_composite_encode', __( 'Could not encode the composited image.', 'hillcroft-garden-designer' ) );
		}
		return array( 'bytes' => $bytes, 'mime' => 'image/png' );
	}

	/** Return $img resized to w×h (or the original handle if already that size). */
	private static function fit( $img, $w, $h ) {
		if ( imagesx( $img ) === $w && imagesy( $img ) === $h ) {
			return $img;
		}
		$dst = imagecreatetruecolor( $w, $h );
		imagecopyresampled( $dst, $img, 0, 0, 0, 0, $w, $h, imagesx( $img ), imagesy( $img ) );
		imagedestroy( $img );
		return $dst;
	}
}
