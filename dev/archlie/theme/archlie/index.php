<?php
/**
 * Fallback template (archives, search, blog index).
 * The landing page is front-page.php.
 *
 * @package Archlie
 */

get_header();
?>
<main id="content" class="section">
	<div class="wrap wrap-narrow page-content">
		<?php if ( have_posts() ) : ?>
			<?php if ( is_home() && ! is_front_page() ) : ?>
				<div class="section-head left"><h1><?php single_post_title(); ?></h1></div>
			<?php endif; ?>
			<?php while ( have_posts() ) : the_post(); ?>
				<article <?php post_class( 'entry' ); ?>>
					<div class="section-head left"><h2><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h2></div>
					<div class="entry-content"><?php the_content(); ?></div>
				</article>
			<?php endwhile; ?>
			<?php the_posts_pagination(); ?>
		<?php else : ?>
			<div class="section-head left">
				<h1><?php esc_html_e( 'Nothing here', 'archlie' ); ?></h1>
				<p><?php esc_html_e( 'That page could not be found.', 'archlie' ); ?> <a href="<?php echo esc_url( home_url( '/' ) ); ?>"><?php esc_html_e( 'Back to home →', 'archlie' ); ?></a></p>
			</div>
		<?php endif; ?>
	</div>
</main>
<?php
get_footer();
