<?php
/**
 * Site footer.
 *
 * @package Archlie
 */

?>
	<footer class="site-footer">
		<div class="wrap">
			<div class="footer-inner">
				<div class="footer-brand">
					<span class="brand"><span class="brand-mark"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 25 L16 7 L26 25" stroke="white" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></span>Archlie</span>
					<p><?php esc_html_e( 'Fixed-price architectural drawings from ARB-registered, RIBA-chartered architects. Planning, building control, permitted development and listed building consent for standard residential work.', 'archlie' ); ?></p>
					<div class="reg-chips" style="margin-top:16px">
						<span class="reg-chip on-dark"><span class="dot"></span> <?php esc_html_e( 'ARB registered', 'archlie' ); ?></span>
						<span class="reg-chip on-dark"><span class="dot"></span> <?php esc_html_e( 'RIBA chartered', 'archlie' ); ?></span>
					</div>
				</div>
				<?php if ( has_nav_menu( 'footer' ) ) : ?>
					<div class="footer-col">
						<?php wp_nav_menu( array( 'theme_location' => 'footer', 'container' => false, 'depth' => 1, 'menu_class' => '' ) ); ?>
					</div>
				<?php else : ?>
					<div class="footer-col">
						<h4><?php esc_html_e( 'Service', 'archlie' ); ?></h4>
						<a href="<?php echo esc_url( home_url( '/#how' ) ); ?>"><?php esc_html_e( 'How it works', 'archlie' ); ?></a>
						<a href="<?php echo esc_url( home_url( '/#pricing' ) ); ?>"><?php esc_html_e( 'Pricing', 'archlie' ); ?></a>
						<a href="<?php echo esc_url( home_url( '/#services' ) ); ?>"><?php esc_html_e( 'Services', 'archlie' ); ?></a>
						<a href="<?php echo esc_url( archlie_start_url() ); ?>"><?php esc_html_e( 'Start a project', 'archlie' ); ?></a>
					</div>
					<div class="footer-col">
						<h4><?php esc_html_e( 'Company', 'archlie' ); ?></h4>
						<a href="<?php echo esc_url( home_url( '/#registration' ) ); ?>"><?php esc_html_e( 'Registration', 'archlie' ); ?></a>
						<a href="<?php echo esc_url( home_url( '/#tiam' ) ); ?>"><?php esc_html_e( 'Larger projects', 'archlie' ); ?></a>
						<a href="<?php echo esc_url( home_url( '/#faq' ) ); ?>"><?php esc_html_e( 'FAQ', 'archlie' ); ?></a>
					</div>
				<?php endif; ?>
			</div>
			<div class="footer-legal">
				<p>
					<strong><?php esc_html_e( 'Archlie is a trading name of Tiam Architects Ltd.', 'archlie' ); ?></strong>
					<?php
					printf(
						/* translators: 1: ARB number, 2: company number */
						esc_html__( 'ARB registration no. %1$s · RIBA chartered practice · Company no. %2$s.', 'archlie' ),
						esc_html( archlie_get( 'archlie_arb_no' ) ),
						esc_html( archlie_get( 'archlie_company_no' ) )
					);
					?>
				</p>
				<p>&copy; <?php echo esc_html( gmdate( 'Y' ) ); ?> <?php esc_html_e( 'Tiam Architects Ltd trading as Archlie. Invoices are issued in the name of Tiam Architects Ltd.', 'archlie' ); ?></p>
			</div>
		</div>
	</footer>

	<?php wp_footer(); ?>
</body>
</html>
