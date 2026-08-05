<?php
/**
 * Structured data (JSON-LD) for generated posts.
 *
 * Emits Article/BlogPosting + a real Person author + Organization publisher, and
 * a FAQPage when the post carries generated Q&A. This is the "chain of
 * accountability" AI answer engines and Google reward, and it's what makes a
 * post eligible for rich results and AI citation.
 *
 * Only fires for posts this plugin generated (flagged with _octobermi_generated).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OctoberMI_Blog_Schema {

	const META_GENERATED = '_octobermi_generated';
	const META_FAQ       = '_octobermi_faq';
	const META_METADESC  = '_octobermi_meta_description';

	public static function init() {
		add_action( 'wp_head', array( __CLASS__, 'render' ), 20 );
	}

	public static function render() {
		if ( ! is_singular( 'post' ) ) {
			return;
		}
		$post = get_queried_object();
		if ( ! $post || ! get_post_meta( $post->ID, self::META_GENERATED, true ) ) {
			return;
		}
		$graph = self::build( $post );
		if ( empty( $graph ) ) {
			return;
		}
		echo "\n<script type=\"application/ld+json\">" . wp_json_encode( array(
			'@context' => 'https://schema.org',
			'@graph'   => $graph,
		) ) . "</script>\n";
	}

	private static function build( $post ) {
		$permalink = get_permalink( $post );
		$author    = get_userdata( (int) $post->post_author );
		$site_name = get_bloginfo( 'name' );

		$article = array(
			'@type'            => 'BlogPosting',
			'@id'              => $permalink . '#article',
			'headline'         => get_the_title( $post ),
			'datePublished'    => get_post_time( 'c', true, $post ),
			'dateModified'     => get_post_modified_time( 'c', true, $post ),
			'mainEntityOfPage' => array( '@type' => 'WebPage', '@id' => $permalink ),
			'publisher'        => array( '@type' => 'Organization', 'name' => $site_name, '@id' => home_url( '/#organization' ) ),
		);

		$desc = get_post_meta( $post->ID, self::META_METADESC, true );
		if ( $desc ) {
			$article['description'] = (string) $desc;
		}

		if ( has_post_thumbnail( $post ) ) {
			$img = wp_get_attachment_image_url( get_post_thumbnail_id( $post ), 'full' );
			if ( $img ) {
				$article['image'] = $img;
			}
		}

		$graph = array();

		if ( $author ) {
			$author_url = get_author_posts_url( $author->ID );
			$person = array(
				'@type' => 'Person',
				'@id'   => $author_url . '#person',
				'name'  => $author->display_name,
				'url'   => $author_url,
			);
			if ( $author->description ) {
				$person['description'] = $author->description;
			}
			// sameAs from the user's site URL + any stored profile links.
			$same = array();
			if ( $author->user_url ) {
				$same[] = $author->user_url;
			}
			$stored = get_user_meta( $author->ID, 'octobermi_sameas', true );
			if ( is_array( $stored ) ) {
				$same = array_merge( $same, array_filter( array_map( 'esc_url_raw', $stored ) ) );
			}
			if ( $same ) {
				$person['sameAs'] = array_values( array_unique( $same ) );
			}
			$article['author'] = array( '@id' => $person['@id'] );
			$graph[] = $person;
		}

		$graph[] = $article;

		// FAQ, if the post carries generated Q&A.
		$faq = get_post_meta( $post->ID, self::META_FAQ, true );
		if ( is_array( $faq ) && ! empty( $faq ) ) {
			$entities = array();
			foreach ( $faq as $qa ) {
				if ( empty( $qa['q'] ) || empty( $qa['a'] ) ) {
					continue;
				}
				$entities[] = array(
					'@type'          => 'Question',
					'name'           => (string) $qa['q'],
					'acceptedAnswer' => array( '@type' => 'Answer', 'text' => (string) $qa['a'] ),
				);
			}
			if ( $entities ) {
				$graph[] = array(
					'@type'      => 'FAQPage',
					'@id'        => $permalink . '#faq',
					'mainEntity' => $entities,
				);
			}
		}

		return $graph;
	}
}
