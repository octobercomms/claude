<?php
/**
 * Elementor "Archie" widget — a thin wrapper that renders the [archie] shortcode
 * so it can be dropped onto any Jupiter X / Elementor page.
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_Elementor_Widget extends \Elementor\Widget_Base {

	public function get_name() {
		return 'yaa_archie';
	}
	public function get_title() {
		return __( 'Archie', 'your-architect-archie' );
	}
	public function get_icon() {
		return 'eicon-chat';
	}
	public function get_categories() {
		return array( 'general' );
	}
	public function get_keywords() {
		return array( 'archie', 'architect', 'quote', 'chat', 'price' );
	}

	protected function render() {
		echo do_shortcode( '[archie]' );
	}

	/** Static preview note in the editor (Archie boots on the live page). */
	protected function content_template() {
		echo '<div style="padding:24px;border:1.5px dashed #D9D5CE;border-radius:16px;font-family:sans-serif;color:#8A857D">Archie — the fixed-price project builder. Renders on the live page.</div>';
	}
}
