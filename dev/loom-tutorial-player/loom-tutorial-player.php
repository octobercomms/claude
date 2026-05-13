<?php
/**
 * Plugin Name: Video Tutorials
 * Description: Add Loom tutorial videos to client pages and a welcome video to the WordPress dashboard.
 * Version: 1.1.0
 * License: GPL2
 */

if ( ! defined( 'ABSPATH' ) ) exit;

class Loom_Tutorial_Player {

	public function __construct() {
		// Per-post video meta box
		add_action( 'add_meta_boxes', [ $this, 'add_meta_box' ] );
		add_action( 'save_post',      [ $this, 'save_meta' ] );
		add_filter( 'the_content',    [ $this, 'append_videos' ] );

		// Global dashboard welcome video
		add_action( 'admin_menu',    [ $this, 'add_settings_page' ] );
		add_action( 'admin_init',    [ $this, 'register_settings' ] );
		add_action( 'admin_notices', [ $this, 'render_dashboard_video' ] );

		// Admin JS/CSS
		add_action( 'admin_footer',  [ $this, 'admin_scripts' ] );
	}

	// =========================================================================
	// Per-post meta box
	// =========================================================================

	public function add_meta_box() {
		$post_types = get_post_types( [ 'show_ui' => true ], 'names' );
		add_meta_box(
			'loom_tutorial_videos',
			'Video Tutorials',
			[ $this, 'render_meta_box' ],
			array_values( $post_types ),
			'normal',
			'high'
		);
	}

	public function render_meta_box( $post ) {
		wp_nonce_field( 'loom_tutorial_nonce_action', 'loom_tutorial_nonce' );
		$videos = get_post_meta( $post->ID, '_loom_tutorial_videos', true );
		if ( empty( $videos ) ) {
			$videos = [ [ 'title' => '', 'url' => '' ] ];
		}
		?>
		<p style="color:#666;margin-top:0;margin-bottom:16px;">
			Paste Loom share links below. Add a title so your client knows what each video covers.
			Videos appear at the bottom of the page automatically.
		</p>
		<div id="loom-videos-container">
			<?php foreach ( $videos as $video ) : ?>
			<div class="loom-video-row">
				<div class="loom-row-header">
					<input
						type="text"
						name="loom_titles[]"
						placeholder="Video title (e.g. How to edit your homepage hero)"
						class="loom-title-input"
						value="<?php echo esc_attr( $video['title'] ?? '' ); ?>"
					>
					<button type="button" class="button loom-remove-btn">&#x2715; Remove</button>
				</div>
				<input
					type="text"
					name="loom_urls[]"
					placeholder="https://www.loom.com/share/..."
					class="loom-url-input widefat"
					value="<?php echo esc_attr( $video['url'] ?? '' ); ?>"
				>
				<div class="loom-preview"></div>
				<hr class="loom-divider">
			</div>
			<?php endforeach; ?>
		</div>
		<button type="button" class="button button-secondary" id="loom-add-btn">+ Add Another Video</button>
		<?php
	}

	public function save_meta( $post_id ) {
		if ( ! isset( $_POST['loom_tutorial_nonce'] ) ) return;
		if ( ! wp_verify_nonce( $_POST['loom_tutorial_nonce'], 'loom_tutorial_nonce_action' ) ) return;
		if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) return;
		if ( ! current_user_can( 'edit_post', $post_id ) ) return;

		$videos = [];
		$urls   = $_POST['loom_urls']   ?? [];
		$titles = $_POST['loom_titles'] ?? [];

		foreach ( $urls as $i => $url ) {
			$url = esc_url_raw( sanitize_text_field( trim( $url ) ) );
			if ( ! empty( $url ) ) {
				$videos[] = [
					'url'   => $url,
					'title' => sanitize_text_field( $titles[ $i ] ?? '' ),
				];
			}
		}

		update_post_meta( $post_id, '_loom_tutorial_videos', $videos );
	}

	// =========================================================================
	// Dashboard welcome video — Settings page
	// =========================================================================

	public function add_settings_page() {
		add_options_page(
			'Video Tutorials',
			'Video Tutorials',
			'manage_options',
			'video-tutorials',
			[ $this, 'render_settings_page' ]
		);
	}

	public function register_settings() {
		register_setting( 'loom_dashboard_group', 'loom_dashboard_video', [
			'sanitize_callback' => [ $this, 'sanitize_dashboard_option' ],
		] );
	}

	public function sanitize_dashboard_option( $input ) {
		return [
			'title' => sanitize_text_field( $input['title'] ?? '' ),
			'url'   => esc_url_raw( sanitize_text_field( $input['url'] ?? '' ) ),
		];
	}

	public function render_settings_page() {
		if ( ! current_user_can( 'manage_options' ) ) return;
		$saved = get_option( 'loom_dashboard_video', [ 'title' => '', 'url' => '' ] );
		$id    = $this->extract_loom_id( $saved['url'] );
		?>
		<div class="wrap">
			<h1>Video Tutorials — Dashboard Welcome Video</h1>
			<p>This video appears at the top of the WordPress dashboard for every user — useful as a welcome / site orientation video for new clients.</p>
			<p>Leave the URL blank to hide it.</p>

			<form method="post" action="options.php">
				<?php settings_fields( 'loom_dashboard_group' ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="loom_dash_title">Video title</label></th>
						<td>
							<input
								type="text"
								id="loom_dash_title"
								name="loom_dashboard_video[title]"
								value="<?php echo esc_attr( $saved['title'] ); ?>"
								class="regular-text"
								placeholder="Welcome to your new website!"
							>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="loom_dash_url">Loom video URL</label></th>
						<td>
							<input
								type="text"
								id="loom_dash_url"
								name="loom_dashboard_video[url]"
								value="<?php echo esc_attr( $saved['url'] ); ?>"
								class="regular-text"
								placeholder="https://www.loom.com/share/..."
							>
						</td>
					</tr>
				</table>

				<div id="loom-dash-preview" style="max-width:640px;margin:0 0 20px 0;">
					<?php if ( $id ) : ?>
					<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:8px;">
						<iframe
							src="https://www.loom.com/embed/<?php echo esc_attr( $id ); ?>"
							frameborder="0"
							allowfullscreen
							style="position:absolute;top:0;left:0;width:100%;height:100%;border-radius:8px;"
						></iframe>
					</div>
					<?php endif; ?>
				</div>

				<?php submit_button( 'Save Dashboard Video' ); ?>
			</form>
		</div>

		<script>
		(function ($) {
			function getLoomId(url) {
				var m = url.match(/loom\.com\/share\/([a-zA-Z0-9]+)/);
				return m ? m[1] : null;
			}
			$('#loom_dash_url').on('input', function () {
				var id = getLoomId($(this).val().trim());
				var $p = $('#loom-dash-preview');
				if (id) {
					$p.html(
						'<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:8px;">' +
							'<iframe src="https://www.loom.com/embed/' + id + '" frameborder="0" allowfullscreen ' +
							'style="position:absolute;top:0;left:0;width:100%;height:100%;border-radius:8px;"></iframe>' +
						'</div>'
					);
				} else {
					$p.html('');
				}
			});
		}(jQuery));
		</script>
		<?php
	}

	// =========================================================================
	// Dashboard welcome video — display
	// =========================================================================

	public function render_dashboard_video() {
		$screen = get_current_screen();
		if ( ! $screen || $screen->id !== 'dashboard' ) return;

		$saved = get_option( 'loom_dashboard_video', [] );
		if ( empty( $saved['url'] ) ) return;

		$id = $this->extract_loom_id( $saved['url'] );
		if ( ! $id ) return;
		?>
		<div style="background:#fff;border:1px solid #c3c4c7;border-radius:4px;padding:24px;margin-bottom:20px;">
			<?php if ( ! empty( $saved['title'] ) ) : ?>
			<h2 style="margin-top:0;margin-bottom:16px;"><?php echo esc_html( $saved['title'] ); ?></h2>
			<?php endif; ?>
			<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:8px;">
				<iframe
					src="https://www.loom.com/embed/<?php echo esc_attr( $id ); ?>"
					frameborder="0"
					allowfullscreen
					style="position:absolute;top:0;left:0;width:100%;height:100%;border-radius:8px;"
				></iframe>
			</div>
		</div>
		<?php
	}

	// =========================================================================
	// Admin JS + CSS (meta box editor screens only)
	// =========================================================================

	public function admin_scripts() {
		$screen = get_current_screen();
		if ( ! $screen ) return;
		$post_types = get_post_types( [ 'show_ui' => true ], 'names' );
		if ( ! in_array( $screen->id, array_values( $post_types ), true ) ) return;
		?>
		<style>
			.loom-video-row { margin-bottom: 8px; }
			.loom-row-header { display:flex; gap:8px; align-items:center; margin-bottom:6px; }
			.loom-title-input { flex: 1; }
			.loom-remove-btn { flex-shrink: 0; }
			.loom-preview { margin: 10px 0 0; }
			.loom-embed-wrap { position:relative; padding-bottom:56.25%; height:0; overflow:hidden; border-radius:8px; }
			.loom-embed-wrap iframe { position:absolute; top:0; left:0; width:100%; height:100%; border-radius:8px; }
			.loom-divider { border:none; border-top:1px solid #eee; margin:16px 0; }
			#loom-add-btn { margin-top: 4px; }
		</style>
		<script>
		(function ($) {
			var rowTemplate =
				'<div class="loom-video-row">' +
					'<div class="loom-row-header">' +
						'<input type="text" name="loom_titles[]" placeholder="Video title (e.g. How to edit your homepage hero)" class="loom-title-input">' +
						'<button type="button" class="button loom-remove-btn">&#x2715; Remove</button>' +
					'</div>' +
					'<input type="text" name="loom_urls[]" placeholder="https://www.loom.com/share/..." class="loom-url-input widefat">' +
					'<div class="loom-preview"></div>' +
					'<hr class="loom-divider">' +
				'</div>';

			function getLoomId(url) {
				var m = url.match(/loom\.com\/share\/([a-zA-Z0-9]+)/);
				return m ? m[1] : null;
			}

			function renderPreview($row) {
				var id = getLoomId($row.find('.loom-url-input').val().trim());
				var $preview = $row.find('.loom-preview');
				if (id) {
					$preview.html('<div class="loom-embed-wrap"><iframe src="https://www.loom.com/embed/' + id + '" frameborder="0" allowfullscreen></iframe></div>');
				} else {
					$preview.html('');
				}
			}

			$('.loom-video-row').each(function () { renderPreview($(this)); });

			$(document).on('input', '.loom-url-input', function () {
				renderPreview($(this).closest('.loom-video-row'));
			});

			$('#loom-add-btn').on('click', function () {
				var $row = $(rowTemplate);
				$('#loom-videos-container').append($row);
				$row.find('.loom-url-input').focus();
			});

			$(document).on('click', '.loom-remove-btn', function () {
				var $container = $('#loom-videos-container');
				var $row = $(this).closest('.loom-video-row');
				if ($container.find('.loom-video-row').length > 1) {
					$row.remove();
				} else {
					$row.find('.loom-url-input').val('').trigger('input');
					$row.find('.loom-title-input').val('');
				}
			});
		}(jQuery));
		</script>
		<?php
	}

	// =========================================================================
	// Frontend rendering
	// =========================================================================

	private function extract_loom_id( $url ) {
		preg_match( '/loom\.com\/share\/([a-zA-Z0-9]+)/', $url, $m );
		return $m[1] ?? null;
	}

	private function render_videos( $post_id ) {
		$videos = get_post_meta( $post_id, '_loom_tutorial_videos', true );
		if ( empty( $videos ) ) return '';

		$out = '<div class="loom-tutorials" style="margin-top:40px;">';
		foreach ( $videos as $video ) {
			$id = $this->extract_loom_id( $video['url'] );
			if ( ! $id ) continue;

			$out .= '<div class="loom-tutorial-item" style="margin-bottom:36px;">';
			if ( ! empty( $video['title'] ) ) {
				$out .= '<h3 style="margin-bottom:12px;">' . esc_html( $video['title'] ) . '</h3>';
			}
			$out .= '<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:8px;">';
			$out .= '<iframe'
				. ' src="https://www.loom.com/embed/' . esc_attr( $id ) . '"'
				. ' frameborder="0"'
				. ' allowfullscreen'
				. ' style="position:absolute;top:0;left:0;width:100%;height:100%;border-radius:8px;"'
				. '></iframe>';
			$out .= '</div></div>';
		}
		$out .= '</div>';

		return $out;
	}

	public function append_videos( $content ) {
		if ( ! is_singular() || ! in_the_loop() || ! is_main_query() ) {
			return $content;
		}
		return $content . $this->render_videos( get_the_ID() );
	}
}

new Loom_Tutorial_Player();
