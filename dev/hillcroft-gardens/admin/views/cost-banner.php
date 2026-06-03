<?php
/**
 * Persistent cost banner. Expects $state (array) and $cap (string) in scope.
 *
 * @var array  $state
 * @var string $cap
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?>
<div class="hgd-cost-banner hgd-level-<?php echo esc_attr( $state['level'] ); ?>">
	<span class="hgd-cost-dot" aria-hidden="true"></span>
	<span class="hgd-cost-item">
		<strong><?php esc_html_e( 'API spend this month', 'hillcroft-garden-designer' ); ?>:</strong>
		£<?php echo esc_html( number_format( $state['spend'], 2 ) ); ?>
		<span class="hgd-cost-sub"><?php echo esc_html( sprintf( /* translators: %s soft cap */ __( 'of %s cap', 'hillcroft-garden-designer' ), $cap ) ); ?></span>
	</span>
	<span class="hgd-cost-item">
		<strong><?php esc_html_e( 'Plant-ID credits', 'hillcroft-garden-designer' ); ?>:</strong>
		<?php echo esc_html( number_format( $state['credits'], 0 ) ); ?>
	</span>
	<?php if ( 'green' !== $state['level'] ) : ?>
		<a class="hgd-pill hgd-pill-ghost hgd-cost-action" href="<?php echo esc_url( admin_url( 'admin.php?page=hgd-settings' ) ); ?>">
			<?php esc_html_e( 'Top up / review', 'hillcroft-garden-designer' ); ?>
		</a>
	<?php endif; ?>
</div>
