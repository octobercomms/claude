// Ticker: wrap ticker_text in a link when ticker_link is set
add_filter( 'jet-engine/listing/dynamic-field/result', function ( $result, $settings, $tag ) {
	$field_key = ! empty( $settings['dynamic_field_post_meta_custom'] )
		? $settings['dynamic_field_post_meta_custom']
		: ( ! empty( $settings['dynamic_field_post_meta'] ) ? $settings['dynamic_field_post_meta'] : '' );

	if ( $field_key !== 'ticker_text' ) {
		return $result;
	}

	$object = jet_engine()->listings->data->get_current_object();

	$link = '';
	if ( is_array( $object ) && ! empty( $object['ticker_link'] ) ) {
		$link = $object['ticker_link'];
	} elseif ( is_object( $object ) && ! empty( $object->ticker_link ) ) {
		$link = $object->ticker_link;
	}

	if ( ! empty( $link ) ) {
		$result = '<a href="' . esc_url( $link ) . '">' . $result . '</a>';
	}

	return $result;
}, 10, 3 );
