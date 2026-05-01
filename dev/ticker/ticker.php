<?php
/**
 * Plugin Name: Architourian Ticker
 * Description: Scrolling ticker with optional links. Add items under Settings > Ticker, then insert with [architourian_ticker].
 * Version: 1.0.0
 */

if ( ! defined( 'ABSPATH' ) ) exit;

add_action( 'admin_menu', function () {
	add_options_page( 'Ticker', 'Ticker', 'manage_options', 'architourian-ticker', 'at_render_settings' );
} );

add_action( 'admin_init', function () {
	register_setting( 'at_ticker', 'at_ticker_items', [ 'sanitize_callback' => 'at_sanitize' ] );
} );

function at_sanitize( $input ) {
	$clean = [];
	if ( ! is_array( $input ) ) return $clean;
	foreach ( $input as $item ) {
		$text = sanitize_text_field( $item['text'] ?? '' );
		$link = esc_url_raw( $item['link'] ?? '' );
		if ( $text !== '' ) $clean[] = compact( 'text', 'link' );
	}
	return array_slice( $clean, 0, 10 );
}

function at_render_settings() {
	$items = get_option( 'at_ticker_items', [] );
	while ( count( $items ) < 10 ) $items[] = [ 'text' => '', 'link' => '' ];
	?>
	<div class="wrap">
		<h1>Ticker Settings</h1>
		<form method="post" action="options.php">
			<?php settings_fields( 'at_ticker' ); ?>
			<table class="widefat" style="max-width:680px">
				<thead>
					<tr>
						<th style="width:30px">#</th>
						<th>Ticker Text</th>
						<th>Link (optional)</th>
					</tr>
				</thead>
				<tbody>
					<?php foreach ( $items as $i => $item ) : ?>
					<tr>
						<td><?php echo $i + 1; ?></td>
						<td><input type="text" name="at_ticker_items[<?php echo $i; ?>][text]" value="<?php echo esc_attr( $item['text'] ); ?>" style="width:100%"></td>
						<td><input type="url" name="at_ticker_items[<?php echo $i; ?>][link]" value="<?php echo esc_attr( $item['link'] ); ?>" style="width:100%"></td>
					</tr>
					<?php endforeach; ?>
				</tbody>
			</table>
			<?php submit_button( 'Save Ticker Items' ); ?>
		</form>
		<p>Shortcode: <code>[architourian_ticker]</code> &mdash; optional attribute: <code>speed="40"</code> (seconds, default 30)</p>
	</div>
	<?php
}

add_shortcode( 'architourian_ticker', function ( $atts ) {
	$atts  = shortcode_atts( [ 'speed' => 30 ], $atts );
	$speed = absint( $atts['speed'] );
	$items = array_filter( (array) get_option( 'at_ticker_items', [] ), fn( $i ) => $i['text'] !== '' );

	if ( empty( $items ) ) return '';

	$site_host = wp_parse_url( home_url(), PHP_URL_HOST );

	$inner = '';
	foreach ( $items as $item ) {
		$text = esc_html( $item['text'] );
		if ( ! empty( $item['link'] ) ) {
			$link_host = wp_parse_url( $item['link'], PHP_URL_HOST );
			$external  = $link_host && $link_host !== $site_host;
			$target    = $external ? ' target="_blank" rel="noopener noreferrer"' : '';
			$content   = '<a href="' . esc_url( $item['link'] ) . '"' . $target . '>' . $text . '</a>';
		} else {
			$content = $text;
		}
		$inner .= '<span class="at-ticker__item">' . $content . '</span>';
	}

	// Duplicate track for seamless loop
	$track = $inner . $inner;

	return sprintf(
		'<div class="at-ticker"><div class="at-ticker__track" style="animation-duration:%ds">%s</div></div>',
		$speed,
		$track
	);
} );

add_action( 'wp_head', function () {
	if ( ! has_shortcode( get_post()->post_content ?? '', 'architourian_ticker' ) ) return;
	?>
	<style>
	.at-ticker {
		overflow: hidden;
		white-space: nowrap;
		width: 100%;
	}
	.at-ticker__track {
		display: inline-block;
		animation: at-scroll 30s linear infinite;
	}
	.at-ticker__track:hover {
		animation-play-state: paused;
	}
	.at-ticker__item {
		display: inline-block;
		padding: 0 2em;
	}
	.at-ticker__item a {
		color: inherit;
		text-decoration: none;
	}
	.at-ticker__item a:hover {
		text-decoration: underline;
	}
	@keyframes at-scroll {
		from { transform: translateX(0); }
		to   { transform: translateX(-50%); }
	}
	</style>
	<?php
} );
