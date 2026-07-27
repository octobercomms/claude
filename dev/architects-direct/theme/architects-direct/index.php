<?php
/**
 * Fallback template.
 *
 * The landing experience is in front-page.php; this handles any other view
 * (archives, search, blog index) with a simple, on-brand content column.
 *
 * @package Architects_Direct
 */

get_header();
?>

<main id="content" class="section">
	<div class="wrap wrap-narrow page-content">
		<?php if ( have_posts() ) : ?>
			<?php if ( is_home() && ! is_front_page() ) : ?>
				<div class="section-head"><h1><?php single_post_title(); ?></h1></div>
			<?php endif; ?>

			<?php
			while ( have_posts() ) :
				the_post();
				?>
				<article <?php post_class( 'entry' ); ?>>
					<div class="section-head">
						<h2><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h2>
					</div>
					<div class="entry-content">
						<?php the_content(); ?>
					</div>
				</article>
			<?php endwhile; ?>

			<?php the_posts_pagination(); ?>
		<?php else : ?>
			<div class="section-head">
				<h1><?php esc_html_e( 'Nothing here', 'architects-direct' ); ?></h1>
				<p><?php esc_html_e( 'That page could not be found.', 'architects-direct' ); ?> <a href="<?php echo esc_url( home_url( '/' ) ); ?>"><?php esc_html_e( 'Back to home →', 'architects-direct' ); ?></a></p>
			</div>
		<?php endif; ?>
	</div>
</main>

<?php
get_footer();
