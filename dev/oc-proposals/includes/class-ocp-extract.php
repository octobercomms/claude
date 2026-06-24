<?php
/**
 * Extract plain text from an uploaded file so Claude can work from it —
 * PDFs (Smalot\PdfParser), Word .docx (zip → document.xml), and plain
 * text/markdown/csv. Used by the case-study drafter and the discovery chat.
 *
 * Degrades gracefully: returns '' (and an optional reason) when the format
 * isn't supported or the PDF parser vendor is missing.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCP_Extract {

	/** Accepted upload extensions. */
	public static function accepts() {
		return array( 'pdf', 'txt', 'md', 'markdown', 'csv', 'docx' );
	}

	/**
	 * Extract text from a validated uploaded file array ($_FILES[...] entry).
	 *
	 * @return array{text:string, error:string}
	 */
	public static function from_upload( array $file ) {
		if ( empty( $file['tmp_name'] ) || ! is_uploaded_file( $file['tmp_name'] ) ) {
			return array( 'text' => '', 'error' => __( 'No file uploaded.', 'oc-proposals' ) );
		}
		$name = isset( $file['name'] ) ? (string) $file['name'] : '';
		$ext  = strtolower( pathinfo( $name, PATHINFO_EXTENSION ) );
		if ( ! in_array( $ext, self::accepts(), true ) ) {
			return array( 'text' => '', 'error' => __( 'Unsupported file type.', 'oc-proposals' ) );
		}
		// Cap to keep prompts (and memory) sane.
		if ( ( $file['size'] ?? 0 ) > 15 * MB_IN_BYTES ) {
			return array( 'text' => '', 'error' => __( 'File too large (max 15MB).', 'oc-proposals' ) );
		}

		switch ( $ext ) {
			case 'pdf':
				return self::from_pdf( $file['tmp_name'] );
			case 'docx':
				return self::from_docx( $file['tmp_name'] );
			default:
				$raw = file_get_contents( $file['tmp_name'] ); // phpcs:ignore WordPress.WP.AlternativeFunctions
				return array( 'text' => self::tidy( (string) $raw ), 'error' => '' );
		}
	}

	private static function from_pdf( $path ) {
		$autoload = OCP_PATH . 'vendor/autoload.php';
		if ( file_exists( $autoload ) ) {
			require_once $autoload;
		}
		if ( ! class_exists( '\\Smalot\\PdfParser\\Parser' ) ) {
			return array( 'text' => '', 'error' => __( 'PDF support not installed — run composer install or use the release zip.', 'oc-proposals' ) );
		}
		try {
			$parser = new \Smalot\PdfParser\Parser();
			$pdf    = $parser->parseFile( $path );
			$text   = $pdf->getText();
		} catch ( \Throwable $e ) {
			return array( 'text' => '', 'error' => __( 'Could not read that PDF (it may be scanned images rather than text).', 'oc-proposals' ) );
		}
		$text = self::tidy( (string) $text );
		if ( '' === $text ) {
			return array( 'text' => '', 'error' => __( 'No selectable text found — the PDF may be scanned images.', 'oc-proposals' ) );
		}
		return array( 'text' => $text, 'error' => '' );
	}

	private static function from_docx( $path ) {
		if ( ! class_exists( 'ZipArchive' ) ) {
			return array( 'text' => '', 'error' => __( 'Word support unavailable on this server.', 'oc-proposals' ) );
		}
		$zip = new ZipArchive();
		if ( true !== $zip->open( $path ) ) {
			return array( 'text' => '', 'error' => __( 'Could not open the Word file.', 'oc-proposals' ) );
		}
		$xml = $zip->getFromName( 'word/document.xml' );
		$zip->close();
		if ( false === $xml ) {
			return array( 'text' => '', 'error' => __( 'Could not read the Word file.', 'oc-proposals' ) );
		}
		// Paragraph + break tags → newlines, then strip the rest.
		$xml  = preg_replace( '/<\/w:p>/', "\n", $xml );
		$xml  = preg_replace( '/<w:br\/?>/', "\n", $xml );
		$text = wp_strip_all_tags( $xml );
		return array( 'text' => self::tidy( html_entity_decode( $text ) ), 'error' => '' );
	}

	/** Collapse whitespace and trim; cap length so prompts stay reasonable. */
	private static function tidy( $text ) {
		$text = preg_replace( "/[ \t]+/", ' ', $text );
		$text = preg_replace( "/\n{3,}/", "\n\n", $text );
		$text = trim( $text );
		if ( strlen( $text ) > 60000 ) {
			$text = substr( $text, 0, 60000 );
		}
		return $text;
	}
}
