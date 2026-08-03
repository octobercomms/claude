<?php
/**
 * Single page template (Terms, Privacy, …).
 *
 * @package Archlie
 */

get_header();
?>
<section class="zone pad">
	<div class="band band--narrow">
		<?php while ( have_posts() ) : the_post(); ?>
			<article <?php post_class( 'entry' ); ?>>
				<div class="sec-head"><h2><?php the_title(); ?></h2></div>
				<div class="entry-content"><?php the_content(); ?><?php wp_link_pages(); ?></div>
			</article>
		<?php endwhile; ?>
	</div>
</section>
<?php
get_footer();
