<?php
/**
 * Single page template (Terms, Privacy, …).
 *
 * @package Archlie
 */

get_header();
?>
<main id="content" class="section">
	<div class="wrap wrap-narrow page-content">
		<?php while ( have_posts() ) : the_post(); ?>
			<article <?php post_class( 'entry' ); ?>>
				<div class="section-head left"><h1><?php the_title(); ?></h1></div>
				<div class="entry-content"><?php the_content(); ?><?php wp_link_pages(); ?></div>
			</article>
		<?php endwhile; ?>
	</div>
</main>
<?php
get_footer();
