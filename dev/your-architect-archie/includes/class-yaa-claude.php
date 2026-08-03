<?php
/**
 * Anthropic Claude Messages API client (server-side).
 *
 * A thin wrapper: sends the conversation + a system prompt + a single tool
 * ("set_fields") that Claude calls to emit the structured fields it extracted
 * this turn. Returns the assistant's text plus the tool input, so the server —
 * not the model's prose — owns pricing. Token spend is metered. Mirrors
 * HGD_Claude's shape (endpoint, api-version, model setting, usage logging).
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_Claude {

	const ENDPOINT = 'https://api.anthropic.com/v1/messages';
	const API_VER  = '2023-06-01';

	public static function is_configured() {
		return '' !== trim( (string) YAA_Settings::get( 'claude_api_key', '' ) );
	}

	/**
	 * One turn.
	 *
	 * @param string $system   System prompt.
	 * @param array  $messages [{role:'user'|'assistant', text:string}, ...].
	 * @param array  $tools    Anthropic tool definitions.
	 * @return array|WP_Error { text, tool:{name,input}|null, input_tokens, output_tokens }.
	 */
	public static function turn( $system, array $messages, array $tools = array() ) {
		$key = trim( (string) YAA_Settings::get( 'claude_api_key', '' ) );
		if ( '' === $key ) {
			return new WP_Error( 'yaa_no_key', __( 'No Claude API key configured.', 'your-architect-archie' ) );
		}
		$model = trim( (string) YAA_Settings::get( 'claude_model', 'claude-sonnet-4-6' ) );

		$api_messages = array();
		foreach ( $messages as $m ) {
			$role = ( isset( $m['role'] ) && 'assistant' === $m['role'] ) ? 'assistant' : 'user';
			$api_messages[] = array(
				'role'    => $role,
				'content' => array( array( 'type' => 'text', 'text' => (string) $m['text'] ) ),
			);
		}

		$body = array(
			'model'      => $model ? $model : 'claude-sonnet-4-6',
			'max_tokens' => (int) YAA_Settings::get( 'max_output_tokens', 700 ),
			'system'     => (string) $system,
			'messages'   => $api_messages,
		);
		if ( ! empty( $tools ) ) {
			$body['tools'] = $tools;
		}

		$res = wp_remote_post(
			self::ENDPOINT,
			array(
				'timeout' => 30, // non-streaming; safe on shared hosting.
				'headers' => array(
					'content-type'      => 'application/json',
					'x-api-key'         => $key,
					'anthropic-version' => self::API_VER,
				),
				'body'    => wp_json_encode( $body ),
			)
		);

		if ( is_wp_error( $res ) ) {
			return $res;
		}
		$code = wp_remote_retrieve_response_code( $res );
		$json = json_decode( wp_remote_retrieve_body( $res ), true );
		if ( 200 !== (int) $code || ! is_array( $json ) ) {
			$msg = isset( $json['error']['message'] ) ? $json['error']['message'] : ( 'HTTP ' . $code );
			YAA_Log::debug( 'Claude error', array( 'code' => $code, 'msg' => $msg ) );
			return new WP_Error( 'yaa_claude_http', $msg );
		}

		$text = '';
		$tool = null;
		foreach ( (array) $json['content'] as $block ) {
			if ( 'text' === $block['type'] && '' === $text ) {
				$text = (string) $block['text'];
			} elseif ( 'tool_use' === $block['type'] ) {
				$tool = array( 'name' => $block['name'], 'input' => (array) $block['input'] );
			}
		}

		$in  = isset( $json['usage']['input_tokens'] ) ? (int) $json['usage']['input_tokens'] : 0;
		$out = isset( $json['usage']['output_tokens'] ) ? (int) $json['usage']['output_tokens'] : 0;
		YAA_Rate_Limit::add_tokens( $in + $out );

		return array( 'text' => $text, 'tool' => $tool, 'input_tokens' => $in, 'output_tokens' => $out );
	}
}
