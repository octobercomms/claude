<?php
/**
 * Fallback template (archives, search, blog index). Landing page is front-page.php.
 *
 * @package Archlie
 */

get_header();
?>
<section class="zone pad">
	<div class="band band--narrow">
		<?php if ( have_posts() ) : ?>
			<?php if ( is_home() && ! is_front_page() ) : ?>
				<div class="sec-head"><h2><?php single_post_title(); ?></h2></div>
			<?php endif; ?>
			<?php while ( have_posts() ) : the_post(); ?>
				<article <?php post_class( 'entry' ); ?>>
					<div class="sec-head"><h2><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h2></div>
					<div class="entry-content"><?php the_content(); ?></div>
				</article>
			<?php endwhile; ?>
			<?php the_posts_pagination(); ?>
		<?php else : ?>
			<div class="sec-head">
				<h2><?php esc_html_e( 'Nothing here', 'archlie' ); ?></h2>
				<p><?php esc_html_e( 'That page could not be found.', 'archlie' ); ?> <a href="<?php echo esc_url( home_url( '/' ) ); ?>"><?php esc_html_e( 'Back to home →', 'archlie' ); ?></a></p>
			</div>
		<?php endif; ?>
	</div>
</section>
<?php
get_footer();
