<?php
/**
 * Site footer.
 *
 * @package Archlie
 */

?>
	<footer class="site-foot">
		<div class="band">
			<div class="foot-top">
				<div class="foot-brand">
					<?php archlie_logo(); ?>
					<div class="tagline-sm"><?php esc_html_e( 'Architecture priced upfront.', 'archlie' ); ?></div>
					<p><?php esc_html_e( 'Fixed-price planning, building control, permitted development and listed building drawings for standard residential projects.', 'archlie' ); ?></p>
				</div>
				<div class="foot-col">
					<h4><?php esc_html_e( 'Service', 'archlie' ); ?></h4>
					<a href="<?php echo esc_url( home_url( '/#archie' ) ); ?>"><?php esc_html_e( 'Talk to Archie', 'archlie' ); ?></a>
					<a href="<?php echo esc_url( home_url( '/#pricing' ) ); ?>"><?php esc_html_e( 'Pricing', 'archlie' ); ?></a>
					<a href="<?php echo esc_url( home_url( '/#how' ) ); ?>"><?php esc_html_e( 'How it works', 'archlie' ); ?></a>
				</div>
				<div class="foot-col">
					<h4><?php esc_html_e( 'Company', 'archlie' ); ?></h4>
					<a href="<?php echo esc_url( home_url( '/#compare' ) ); ?>"><?php esc_html_e( 'How we compare', 'archlie' ); ?></a>
					<a href="<?php echo esc_url( home_url( '/#pricing' ) ); ?>"><?php esc_html_e( 'Larger projects', 'archlie' ); ?></a>
				</div>
			</div>
			<div class="foot-legal">
				<p>
					<strong><?php esc_html_e( 'Your Architect is a trading name of Tiam Architects Ltd.', 'archlie' ); ?></strong>
					<?php
					printf(
						/* translators: 1: ARB number, 2: company number */
						esc_html__( 'ARB-registered · RIBA chartered practice · ARB reg. no. %1$s · Company no. %2$s.', 'archlie' ),
						esc_html( archlie_get( 'archlie_arb_no' ) ),
						esc_html( archlie_get( 'archlie_company_no' ) )
					);
					?>
				</p>
				<p>&copy; <?php echo esc_html( gmdate( 'Y' ) ); ?> <?php esc_html_e( 'Tiam Architects Ltd trading as Your Architect. Invoices are issued in the name of Tiam Architects Ltd.', 'archlie' ); ?></p>
			</div>
		</div>
	</footer>

	<?php wp_footer(); ?>
</body>
</html>
