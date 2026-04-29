<?php
/**
 * Plugin Name: WebP Image Optimizer
 * Plugin URI:  https://github.com/octobercomms/claude
 * Description: Automatically converts uploaded images to WebP, scales them to a max dimension, and serves them transparently via .htaccess rules. Includes a bulk converter for existing media.
 * Version:     1.1.0
 * Author:      OctoberComms
 * License:     GPL-2.0-or-later
 * Text Domain: webp-image-optimizer
 */

defined( 'ABSPATH' ) || exit;

define( 'WIO_VERSION', '1.1.0' );
define( 'WIO_PLUGIN_FILE', __FILE__ );
define( 'WIO_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );

// ─── Options ───────────────────────────────────────────────────────────────

function wio_defaults(): array {
	return [
		'quality'          => 82,
		'max_width'        => 1920,
		'max_height'       => 1920,
		'keep_originals'   => true,
		'convert_existing' => false,
	];
}

function wio_option( string $key ) {
	$opts = get_option( 'wio_settings', [] );
	$defs = wio_defaults();
	return $opts[ $key ] ?? $defs[ $key ] ?? null;
}

// ─── Activation / Deactivation ─────────────────────────────────────────────

register_activation_hook( WIO_PLUGIN_FILE, 'wio_activate' );
function wio_activate(): void {
	if ( ! get_option( 'wio_settings' ) ) {
		update_option( 'wio_settings', wio_defaults() );
	}
	wio_write_htaccess();
}

register_deactivation_hook( WIO_PLUGIN_FILE, 'wio_deactivate' );
function wio_deactivate(): void {
	wio_remove_htaccess_rules();
}

// ─── .htaccess: serve .webp transparently when browser supports it ──────────

function wio_htaccess_rules(): string {
	return <<<'HTACCESS'

# BEGIN WebP Image Optimizer
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteCond %{HTTP_ACCEPT} image/webp
  RewriteCond %{REQUEST_FILENAME} \.(jpe?g|png|gif)$
  RewriteCond %{REQUEST_FILENAME}\.webp -f
  RewriteRule ^(.+)\.(jpe?g|png|gif)$ $1.$2.webp [T=image/webp,L]
</IfModule>
<IfModule mod_headers.c>
  <FilesMatch "\.(jpe?g|png|gif)\.webp$">
    Header set Vary "Accept"
  </FilesMatch>
</IfModule>
# END WebP Image Optimizer

HTACCESS;
}

function wio_write_htaccess(): void {
	$htaccess = get_home_path() . '.htaccess';
	if ( ! is_writable( $htaccess ) && ! is_writable( dirname( $htaccess ) ) ) {
		return;
	}
	$current = file_exists( $htaccess ) ? file_get_contents( $htaccess ) : '';
	if ( strpos( $current, '# BEGIN WebP Image Optimizer' ) !== false ) {
		return; // already present
	}
	insert_with_markers( $htaccess, 'WebP Image Optimizer', explode( "\n", trim( wio_htaccess_rules() ) ) );
}

function wio_remove_htaccess_rules(): void {
	$htaccess = get_home_path() . '.htaccess';
	if ( file_exists( $htaccess ) ) {
		insert_with_markers( $htaccess, 'WebP Image Optimizer', [] );
	}
}

// ─── Core conversion ───────────────────────────────────────────────────────

/**
 * Convert a single image file to WebP.
 *
 * @param string $source      Absolute path to source image.
 * @param string $destination Absolute path for the WebP output (defaults to $source . '.webp').
 * @param int    $quality     WebP quality 0-100.
 * @param int    $max_w       Max width in pixels (0 = no limit).
 * @param int    $max_h       Max height in pixels (0 = no limit).
 * @return bool
 */
function wio_convert_to_webp( string $source, string $destination = '', int $quality = 82, int $max_w = 0, int $max_h = 0 ): bool {
	if ( ! file_exists( $source ) ) {
		return false;
	}

	if ( $destination === '' ) {
		$destination = $source . '.webp';
	}

	// Prefer Imagick for better colour accuracy; fall back to GD.
	if ( extension_loaded( 'imagick' ) ) {
		return wio_convert_imagick( $source, $destination, $quality, $max_w, $max_h );
	}
	if ( extension_loaded( 'gd' ) ) {
		return wio_convert_gd( $source, $destination, $quality, $max_w, $max_h );
	}

	return false;
}

function wio_convert_imagick( string $source, string $destination, int $quality, int $max_w, int $max_h ): bool {
	try {
		$img = new Imagick( $source );
		$img->setImageFormat( 'WEBP' );
		$img->setImageCompressionQuality( $quality );
		$img->stripImage(); // remove EXIF / metadata

		if ( $max_w > 0 || $max_h > 0 ) {
			$w = $img->getImageWidth();
			$h = $img->getImageHeight();
			[ $new_w, $new_h ] = wio_scaled_dimensions( $w, $h, $max_w ?: PHP_INT_MAX, $max_h ?: PHP_INT_MAX );
			if ( $new_w < $w || $new_h < $h ) {
				$img->resizeImage( $new_w, $new_h, Imagick::FILTER_LANCZOS, 1 );
			}
		}

		$result = $img->writeImage( $destination );
		$img->destroy();
		return (bool) $result;
	} catch ( Exception $e ) {
		return false;
	}
}

function wio_convert_gd( string $source, string $destination, int $quality, int $max_w, int $max_h ): bool {
	$mime = mime_content_type( $source );
	$img  = match ( $mime ) {
		'image/jpeg' => imagecreatefromjpeg( $source ),
		'image/png'  => imagecreatefrompng( $source ),
		'image/gif'  => imagecreatefromgif( $source ),
		default      => false,
	};

	if ( ! $img ) {
		return false;
	}

	// Preserve transparency for PNG / GIF.
	if ( in_array( $mime, [ 'image/png', 'image/gif' ], true ) ) {
		imagepalettetotruecolor( $img );
		imagealphablending( $img, true );
		imagesavealpha( $img, true );
	}

	if ( $max_w > 0 || $max_h > 0 ) {
		$w = imagesx( $img );
		$h = imagesy( $img );
		[ $new_w, $new_h ] = wio_scaled_dimensions( $w, $h, $max_w ?: PHP_INT_MAX, $max_h ?: PHP_INT_MAX );

		if ( $new_w < $w || $new_h < $h ) {
			$resized = imagecreatetruecolor( $new_w, $new_h );
			if ( in_array( $mime, [ 'image/png', 'image/gif' ], true ) ) {
				imagealphablending( $resized, false );
				imagesavealpha( $resized, true );
				$transparent = imagecolorallocatealpha( $resized, 0, 0, 0, 127 );
				imagefilledrectangle( $resized, 0, 0, $new_w, $new_h, $transparent );
			}
			imagecopyresampled( $resized, $img, 0, 0, 0, 0, $new_w, $new_h, $w, $h );
			imagedestroy( $img );
			$img = $resized;
		}
	}

	$result = imagewebp( $img, $destination, $quality );
	imagedestroy( $img );
	return $result;
}

/**
 * Return [width, height] scaled proportionally to fit within $max_w x $max_h.
 */
function wio_scaled_dimensions( int $w, int $h, int $max_w, int $max_h ): array {
	if ( $w <= $max_w && $h <= $max_h ) {
		return [ $w, $h ];
	}
	$ratio    = min( $max_w / $w, $max_h / $h );
	return [ (int) round( $w * $ratio ), (int) round( $h * $ratio ) ];
}

// ─── Auto-convert on upload ────────────────────────────────────────────────

add_filter( 'wp_generate_attachment_metadata', 'wio_on_upload', 10, 2 );
function wio_on_upload( array $metadata, int $attachment_id ): array {
	$mime = get_post_mime_type( $attachment_id );
	if ( ! in_array( $mime, [ 'image/jpeg', 'image/png', 'image/gif' ], true ) ) {
		return $metadata;
	}

	$quality  = (int) wio_option( 'quality' );
	$max_w    = (int) wio_option( 'max_width' );
	$max_h    = (int) wio_option( 'max_height' );
	$uploads  = wp_upload_dir();
	$base_dir = $uploads['basedir'];

	// Convert the full-size original.
	if ( ! empty( $metadata['file'] ) ) {
		$abs = $base_dir . '/' . $metadata['file'];
		wio_convert_to_webp( $abs, '', $quality, $max_w, $max_h );
	}

	// Convert every generated thumbnail size.
	if ( ! empty( $metadata['sizes'] ) ) {
		$dir = dirname( $base_dir . '/' . $metadata['file'] );
		foreach ( $metadata['sizes'] as $size ) {
			$abs = $dir . '/' . $size['file'];
			wio_convert_to_webp( $abs, '', $quality ); // thumbnails: no dimension cap
		}
	}

	return $metadata;
}

// ─── Rewrite image URLs in HTML output ────────────────────────────────────
//
// Rewrites src/srcset attributes to point to .webp files directly in the page
// HTML. Browsers request the .webp by name — no server-side magic required.
// Only rewrites URLs where the corresponding .webp file actually exists on disk.

add_filter( 'wp_get_attachment_image_src',   'wio_rewrite_image_src',    10, 1 );
add_filter( 'wp_calculate_image_srcset',     'wio_rewrite_srcset',       10, 1 );
add_filter( 'the_content',                   'wio_rewrite_content_urls', 20    );
add_filter( 'wp_get_attachment_url',         'wio_rewrite_single_url',   10, 1 );

/**
 * Map a single URL to its .webp equivalent if the file exists on disk.
 */
function wio_maybe_webp_url( string $url ): string {
	if ( ! preg_match( '/\.(jpe?g|png|gif)(\?.*)?$/i', $url ) ) {
		return $url;
	}

	$uploads  = wp_upload_dir();
	$base_url = $uploads['baseurl'];
	$base_dir = $uploads['basedir'];

	// Only rewrite URLs that live inside the uploads directory.
	if ( strpos( $url, $base_url ) === false ) {
		return $url;
	}

	// Strip query string before checking disk.
	$url_clean = strtok( $url, '?' );
	$rel       = str_replace( $base_url, '', $url_clean );
	$webp_path = $base_dir . $rel . '.webp';

	return file_exists( $webp_path ) ? $url_clean . '.webp' : $url;
}

function wio_rewrite_image_src( $image ) {
	if ( is_array( $image ) && isset( $image[0] ) ) {
		$image[0] = wio_maybe_webp_url( $image[0] );
	}
	return $image;
}

function wio_rewrite_srcset( $sources ) {
	if ( ! is_array( $sources ) ) {
		return $sources;
	}
	foreach ( $sources as &$source ) {
		if ( isset( $source['url'] ) ) {
			$source['url'] = wio_maybe_webp_url( $source['url'] );
		}
	}
	return $sources;
}

function wio_rewrite_single_url( string $url ): string {
	return wio_maybe_webp_url( $url );
}

function wio_rewrite_content_urls( string $content ): string {
	// Match src and srcset attributes containing image URLs in the uploads dir.
	$uploads  = wp_upload_dir();
	$base_url = preg_quote( $uploads['baseurl'], '/' );

	// Rewrite src="..." for jpg/png/gif.
	$content = preg_replace_callback(
		'/\b(src=["\'])(' . $base_url . '[^"\']+\.(jpe?g|png|gif))(["\'])/i',
		function ( $m ) {
			return $m[1] . wio_maybe_webp_url( $m[2] ) . $m[4];
		},
		$content
	);

	// Rewrite individual URLs inside srcset="..." attributes.
	$content = preg_replace_callback(
		'/\bsrcset=["\']([^"\']+)["\']/i',
		function ( $m ) {
			$parts = array_map( 'trim', explode( ',', $m[1] ) );
			$parts = array_map( function ( $part ) {
				// Each part is "URL [descriptor]" e.g. "image.jpg 800w"
				$pieces    = preg_split( '/\s+/', $part, 2 );
				$pieces[0] = wio_maybe_webp_url( $pieces[0] );
				return implode( ' ', $pieces );
			}, $parts );
			return 'srcset="' . implode( ', ', $parts ) . '"';
		},
		$content
	);

	return $content;
}

// ─── Admin menu & settings page ────────────────────────────────────────────

add_action( 'admin_menu', function () {
	add_options_page(
		__( 'WebP Image Optimizer', 'webp-image-optimizer' ),
		__( 'WebP Optimizer', 'webp-image-optimizer' ),
		'manage_options',
		'webp-image-optimizer',
		'wio_render_settings_page'
	);
} );

add_action( 'admin_init', 'wio_register_settings' );
function wio_register_settings(): void {
	register_setting( 'wio_settings_group', 'wio_settings', [
		'sanitize_callback' => 'wio_sanitize_settings',
	] );
}

function wio_sanitize_settings( $input ): array {
	$defs = wio_defaults();
	return [
		'quality'        => max( 1, min( 100, (int) ( $input['quality'] ?? $defs['quality'] ) ) ),
		'max_width'      => max( 0, (int) ( $input['max_width'] ?? $defs['max_width'] ) ),
		'max_height'     => max( 0, (int) ( $input['max_height'] ?? $defs['max_height'] ) ),
		'keep_originals' => ! empty( $input['keep_originals'] ),
	];
}

function wio_render_settings_page(): void {
	$has_gd      = extension_loaded( 'gd' ) && function_exists( 'imagewebp' );
	$has_imagick = extension_loaded( 'imagick' );
	$can_convert = $has_gd || $has_imagick;
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'WebP Image Optimizer', 'webp-image-optimizer' ); ?></h1>

		<?php if ( ! $can_convert ) : ?>
			<div class="notice notice-error"><p>
				<?php esc_html_e( 'Neither GD (with WebP support) nor Imagick is available on this server. WebP conversion will not work until one is enabled.', 'webp-image-optimizer' ); ?>
			</p></div>
		<?php else : ?>
			<div class="notice notice-success is-dismissible"><p>
				<?php printf(
					esc_html__( 'Server support: %s', 'webp-image-optimizer' ),
					$has_imagick ? 'Imagick (preferred)' : 'GD'
				); ?>
			</p></div>
		<?php endif; ?>

		<form method="post" action="options.php">
			<?php settings_fields( 'wio_settings_group' ); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="wio_quality"><?php esc_html_e( 'WebP Quality', 'webp-image-optimizer' ); ?></label></th>
					<td>
						<input type="number" id="wio_quality" name="wio_settings[quality]"
							value="<?php echo esc_attr( wio_option( 'quality' ) ); ?>"
							min="1" max="100" step="1" class="small-text" />
						<p class="description"><?php esc_html_e( '1 (smallest file) – 100 (best quality). 80–85 is a good balance.', 'webp-image-optimizer' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Max Dimensions (px)', 'webp-image-optimizer' ); ?></th>
					<td>
						<label>
							<?php esc_html_e( 'Width', 'webp-image-optimizer' ); ?>
							<input type="number" name="wio_settings[max_width]"
								value="<?php echo esc_attr( wio_option( 'max_width' ) ); ?>"
								min="0" step="1" class="small-text" />
						</label>
						&nbsp;&nbsp;
						<label>
							<?php esc_html_e( 'Height', 'webp-image-optimizer' ); ?>
							<input type="number" name="wio_settings[max_height]"
								value="<?php echo esc_attr( wio_option( 'max_height' ) ); ?>"
								min="0" step="1" class="small-text" />
						</label>
						<p class="description"><?php esc_html_e( 'Images larger than these dimensions are scaled down proportionally. Set to 0 for no limit.', 'webp-image-optimizer' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Keep Originals', 'webp-image-optimizer' ); ?></th>
					<td>
						<label>
							<input type="checkbox" name="wio_settings[keep_originals]" value="1"
								<?php checked( wio_option( 'keep_originals' ) ); ?> />
							<?php esc_html_e( 'Keep original JPG/PNG/GIF files alongside .webp versions', 'webp-image-optimizer' ); ?>
						</label>
						<p class="description"><?php esc_html_e( 'Recommended: keeps originals as fallback for browsers/editors that do not support WebP.', 'webp-image-optimizer' ); ?></p>
					</td>
				</tr>
			</table>
			<?php submit_button(); ?>
		</form>

		<hr>

		<h2><?php esc_html_e( 'Bulk Convert Existing Images', 'webp-image-optimizer' ); ?></h2>
		<p><?php esc_html_e( 'Convert all existing JPG, PNG, and GIF images in your Media Library to WebP. Large libraries may take a while — the process runs in batches so it will not time out.', 'webp-image-optimizer' ); ?></p>

		<?php if ( ! $can_convert ) : ?>
			<p><em><?php esc_html_e( 'Bulk conversion is unavailable because this server lacks GD/Imagick WebP support.', 'webp-image-optimizer' ); ?></em></p>
		<?php else : ?>
			<div id="wio-bulk-wrap">
				<button id="wio-bulk-start" class="button button-primary"><?php esc_html_e( 'Start Bulk Convert', 'webp-image-optimizer' ); ?></button>
				<button id="wio-bulk-stop" class="button" style="display:none;"><?php esc_html_e( 'Stop', 'webp-image-optimizer' ); ?></button>
				<span id="wio-bulk-status" style="margin-left:12px;"></span>
				<div id="wio-bulk-bar-wrap" style="margin-top:8px;display:none;">
					<div style="background:#e0e0e0;border-radius:4px;height:20px;width:400px;overflow:hidden;">
						<div id="wio-bulk-bar" style="background:#0073aa;height:100%;width:0%;transition:width .3s;"></div>
					</div>
				</div>
				<div id="wio-bulk-log" style="margin-top:12px;max-height:200px;overflow-y:auto;font-family:monospace;font-size:12px;background:#f6f7f7;padding:8px;border:1px solid #ccc;display:none;"></div>
			</div>

			<script>
			(function(){
				const nonce   = <?php echo wp_json_encode( wp_create_nonce( 'wio_bulk_nonce' ) ); ?>;
				const ajaxUrl = <?php echo wp_json_encode( admin_url( 'admin-ajax.php' ) ); ?>;
				let running   = false;
				let offset    = 0;
				const batch   = 10;

				const startBtn  = document.getElementById('wio-bulk-start');
				const stopBtn   = document.getElementById('wio-bulk-stop');
				const statusEl  = document.getElementById('wio-bulk-status');
				const barWrap   = document.getElementById('wio-bulk-bar-wrap');
				const bar       = document.getElementById('wio-bulk-bar');
				const logEl     = document.getElementById('wio-bulk-log');

				function log(msg){ logEl.style.display='block'; logEl.innerHTML += msg + '<br>'; logEl.scrollTop = logEl.scrollHeight; }
				function setStatus(msg){ statusEl.textContent = msg; }
				function setBar(pct){ bar.style.width = pct + '%'; }

				startBtn.addEventListener('click', function(){
					if(running) return;
					running = true; offset = 0;
					startBtn.style.display='none'; stopBtn.style.display='';
					barWrap.style.display=''; logEl.innerHTML='';
					setStatus('Starting…'); setBar(0);
					runBatch();
				});

				stopBtn.addEventListener('click', function(){ running=false; setStatus('Stopped.'); startBtn.style.display=''; stopBtn.style.display='none'; });

				function runBatch(){
					if(!running) return;
					fetch(ajaxUrl, {
						method:'POST',
						headers:{'Content-Type':'application/x-www-form-urlencoded'},
						body: new URLSearchParams({ action:'wio_bulk_convert', nonce, offset, batch })
					})
					.then(r=>r.json())
					.then(data=>{
						if(!data.success){ setStatus('Error: '+(data.data||'unknown')); running=false; startBtn.style.display=''; stopBtn.style.display='none'; return; }
						const d = data.data;
						d.log.forEach(l=>log(l));
						setBar(d.total>0 ? Math.round((d.offset/d.total)*100) : 100);
						setStatus('Converted '+d.offset+' / '+d.total+' images');
						if(d.done || !running){
							running=false;
							setStatus(d.done ? 'Done! Converted '+d.converted+' images.' : 'Stopped at '+d.offset+'/'+d.total);
							startBtn.style.display=''; stopBtn.style.display='none';
						} else {
							offset = d.offset;
							setTimeout(runBatch, 200);
						}
					})
					.catch(e=>{ setStatus('Network error: '+e.message); running=false; startBtn.style.display=''; stopBtn.style.display='none'; });
				}
			})();
			</script>
		<?php endif; ?>

		<hr>

		<h2><?php esc_html_e( '.htaccess Status', 'webp-image-optimizer' ); ?></h2>
		<?php
		$htaccess = get_home_path() . '.htaccess';
		$content  = file_exists( $htaccess ) ? file_get_contents( $htaccess ) : '';
		$present  = strpos( $content, '# BEGIN WebP Image Optimizer' ) !== false;
		if ( $present ) {
			echo '<p style="color:green;">&#10003; ' . esc_html__( 'WebP rewrite rules are present in .htaccess.', 'webp-image-optimizer' ) . '</p>';
		} else {
			echo '<p style="color:orange;">&#9888; ' . esc_html__( '.htaccess rules not detected. They are added on plugin activation. If missing, your .htaccess may not be writable.', 'webp-image-optimizer' ) . '</p>';
			echo '<details><summary>' . esc_html__( 'Add these rules manually', 'webp-image-optimizer' ) . '</summary>';
			echo '<pre style="background:#f6f7f7;padding:12px;overflow:auto;">' . esc_html( wio_htaccess_rules() ) . '</pre></details>';
		}
		?>
	</div>
	<?php
}

// ─── AJAX: bulk converter ──────────────────────────────────────────────────

add_action( 'wp_ajax_wio_bulk_convert', 'wio_ajax_bulk_convert' );
function wio_ajax_bulk_convert(): void {
	check_ajax_referer( 'wio_bulk_nonce', 'nonce' );
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_send_json_error( 'Forbidden' );
	}

	$offset  = max( 0, (int) ( $_POST['offset'] ?? 0 ) );
	$batch   = max( 1, min( 50, (int) ( $_POST['batch'] ?? 10 ) ) );
	$quality = (int) wio_option( 'quality' );
	$max_w   = (int) wio_option( 'max_width' );
	$max_h   = (int) wio_option( 'max_height' );

	$total_query = new WP_Query( [
		'post_type'      => 'attachment',
		'post_mime_type' => [ 'image/jpeg', 'image/png', 'image/gif' ],
		'post_status'    => 'inherit',
		'posts_per_page' => -1,
		'fields'         => 'ids',
	] );
	$total = $total_query->post_count;

	$query = new WP_Query( [
		'post_type'      => 'attachment',
		'post_mime_type' => [ 'image/jpeg', 'image/png', 'image/gif' ],
		'post_status'    => 'inherit',
		'posts_per_page' => $batch,
		'offset'         => $offset,
		'fields'         => 'ids',
	] );

	$log       = [];
	$converted = 0;

	foreach ( $query->posts as $id ) {
		$meta     = wp_get_attachment_metadata( $id );
		$uploads  = wp_upload_dir();
		$base_dir = $uploads['basedir'];

		if ( empty( $meta['file'] ) ) {
			$log[] = "#{$id}: no metadata, skipped";
			continue;
		}

		$abs = $base_dir . '/' . $meta['file'];
		$ok  = wio_convert_to_webp( $abs, '', $quality, $max_w, $max_h );
		$log[] = "#{$id} " . basename( $abs ) . ': ' . ( $ok ? 'converted' : 'failed/already webp' );
		if ( $ok ) {
			$converted++;
		}

		// Also convert all registered thumbnail sizes.
		if ( ! empty( $meta['sizes'] ) ) {
			$dir = dirname( $abs );
			foreach ( $meta['sizes'] as $size ) {
				$thumb = $dir . '/' . $size['file'];
				wio_convert_to_webp( $thumb, '', $quality );
			}
		}
	}

	$new_offset = $offset + $query->post_count;

	wp_send_json_success( [
		'total'     => $total,
		'offset'    => $new_offset,
		'converted' => $converted,
		'done'      => $new_offset >= $total,
		'log'       => $log,
	] );
}
