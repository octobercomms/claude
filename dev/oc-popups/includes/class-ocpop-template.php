<?php
/**
 * Renders the "Simple template" popup layout: an image plus heading, text and
 * a call-to-action button, arranged image-left / image-right / image-top /
 * text-only. A reliable alternative to hand-building the layout in a page
 * builder — the plugin owns the responsive behaviour.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCPOP_Template {

	/**
	 * @param int   $popup_id
	 * @param array $s Merged settings.
	 * @return string HTML.
	 */
	public static function render( $popup_id, $s ) {
		$layout   = $s['tpl_layout'];
		$has_image = ( 'text-only' !== $layout && ! empty( $s['tpl_image_id'] ) );

		$classes = array( 'ocpop-tpl', 'ocpop-tpl--' . $layout );
		if ( ! $has_image ) {
			$classes[] = 'ocpop-tpl--no-image';
		}
		if ( $has_image && empty( $s['tpl_show_image_mobile'] ) ) {
			$classes[] = 'ocpop-tpl--hide-image-mobile';
		}

		// Container background.
		$wrap_style = '';
		if ( ! empty( $s['tpl_bg'] ) ) {
			$wrap_style = 'background:' . esc_attr( $s['tpl_bg'] ) . ';';
		}

		ob_start();
		?>
		<div class="<?php echo esc_attr( implode( ' ', $classes ) ); ?>" style="<?php echo esc_attr( $wrap_style ); ?>">
			<?php if ( $has_image ) : ?>
				<div class="ocpop-tpl__media">
					<?php
					echo wp_get_attachment_image(
						(int) $s['tpl_image_id'],
						'large',
						false,
						array( 'class' => 'ocpop-tpl__img', 'loading' => 'lazy' )
					);
					?>
				</div>
			<?php endif; ?>

			<?php
			$content_style = 'padding:' . (int) $s['tpl_padding'] . 'px;';
			?>
			<div class="ocpop-tpl__content" style="<?php echo esc_attr( $content_style ); ?>">
				<?php if ( '' !== $s['tpl_heading'] ) : ?>
					<?php
					$head_style = 'font-size:' . (int) $s['tpl_heading_size'] . 'px;';
					if ( ! empty( $s['tpl_heading_color'] ) ) {
						$head_style .= 'color:' . $s['tpl_heading_color'] . ';';
					}
					?>
					<h2 class="ocpop-tpl__heading" style="<?php echo esc_attr( $head_style ); ?>">
						<?php echo esc_html( $s['tpl_heading'] ); ?>
					</h2>
				<?php endif; ?>

				<?php if ( '' !== $s['tpl_text'] ) : ?>
					<?php
					$text_style = 'font-size:' . (int) $s['tpl_text_size'] . 'px;';
					if ( ! empty( $s['tpl_text_color'] ) ) {
						$text_style .= 'color:' . $s['tpl_text_color'] . ';';
					}
					?>
					<div class="ocpop-tpl__text" style="<?php echo esc_attr( $text_style ); ?>">
						<?php echo wpautop( wp_kses_post( $s['tpl_text'] ) ); ?>
					</div>
				<?php endif; ?>

				<?php if ( '' !== $s['tpl_button_text'] ) : ?>
					<?php
					$btn_style = 'border-radius:' . (int) $s['tpl_button_radius'] . 'px;';
					if ( ! empty( $s['tpl_button_bg'] ) ) {
						$btn_style .= 'background:' . $s['tpl_button_bg'] . ';';
					}
					if ( ! empty( $s['tpl_button_color'] ) ) {
						$btn_style .= 'color:' . $s['tpl_button_color'] . ';';
					}
					if ( ! empty( $s['tpl_button_font'] ) ) {
						$btn_style .= 'font-family:' . $s['tpl_button_font'] . ';';
					}
					$href = $s['tpl_button_url'] ? $s['tpl_button_url'] : '#';
					?>
					<a class="ocpop-tpl__btn ocpop-cta" href="<?php echo esc_url( $href ); ?>" style="<?php echo esc_attr( $btn_style ); ?>">
						<?php echo esc_html( $s['tpl_button_text'] ); ?>
					</a>
				<?php endif; ?>
			</div>
		</div>
		<?php
		return ob_get_clean();
	}
}
