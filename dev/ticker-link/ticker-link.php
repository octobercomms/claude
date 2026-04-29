// Ticker: wrap ticker_text in a link when ticker_link is set
add_filter( 'jet-engine/listing/dynamic-field/result', function ( $result, $settings, $tag ) {
	if (
		empty( $settings['dynamic_field_post_meta_custom'] ) ||
		$settings['dynamic_field_post_meta_custom'] !== 'ticker_text'
	) {
		return $result;
	}

	$object = jet_engine()->listings->data->get_current_object();

	if ( is_array( $object ) && ! empty( $object['ticker_link'] ) ) {
		$result = '<a href="' . esc_url( $object['ticker_link'] ) . '">' . $result . '</a>';
	}

	return $result;
}, 10, 3 );
