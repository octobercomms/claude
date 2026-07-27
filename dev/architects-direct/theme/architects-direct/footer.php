<?php
/**
 * Site footer.
 *
 * @package Architects_Direct
 */

?>
	<footer class="site-footer">
		<div class="wrap footer-inner">
			<div class="footer-brand">
				<span class="logo-mark">AD</span>
				<p><?php esc_html_e( 'Fixed-price architectural drawings for standard residential works. Planning, building control, permitted development and tender packages — priced and delivered online.', 'architects-direct' ); ?></p>
			</div>
			<nav class="footer-nav" aria-label="<?php esc_attr_e( 'Footer', 'architects-direct' ); ?>">
				<?php if ( has_nav_menu( 'footer' ) ) : ?>
					<?php
					wp_nav_menu(
						array(
							'theme_location' => 'footer',
							'container'      => false,
							'depth'          => 2,
						)
					);
					?>
				<?php else : ?>
					<div>
						<h4><?php esc_html_e( 'Service', 'architects-direct' ); ?></h4>
						<a href="#how"><?php esc_html_e( 'How it works', 'architects-direct' ); ?></a>
						<a href="#services"><?php esc_html_e( 'Services', 'architects-direct' ); ?></a>
						<a href="#pricing"><?php esc_html_e( 'Pricing', 'architects-direct' ); ?></a>
					</div>
					<div>
						<h4><?php esc_html_e( 'Company', 'architects-direct' ); ?></h4>
						<a href="#consultants"><?php esc_html_e( 'Consultants', 'architects-direct' ); ?></a>
						<a href="#faq"><?php esc_html_e( 'FAQ', 'architects-direct' ); ?></a>
						<a href="#start"><?php esc_html_e( 'Start a project', 'architects-direct' ); ?></a>
					</div>
				<?php endif; ?>
			</nav>
		</div>
		<div class="wrap footer-legal">
			<p>&copy; <?php echo esc_html( gmdate( 'Y' ) ); ?> <?php bloginfo( 'name' ); ?>. <?php esc_html_e( 'A sister service to Tiam Architects.', 'architects-direct' ); ?></p>
			<p class="footer-small"><?php esc_html_e( 'Complex, listed and premium residential work is handled by Tiam Architects.', 'architects-direct' ); ?></p>
		</div>
	</footer>

	<?php wp_footer(); ?>
</body>
</html>
