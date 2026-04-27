<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ACC_Calculator {

	public static function get_project_types(): array {
		return [
			'single_storey_rear'  => 'Single storey rear extension',
			'double_storey'       => 'Double storey extension',
			'loft_conversion'     => 'Loft conversion',
			'new_build'           => 'New build (single dwelling)',
			'basement_conversion' => 'Basement conversion',
			'full_refurbishment'  => 'Full refurbishment',
		];
	}

	public static function get_spec_levels(): array {
		return [
			'standard' => 'Standard',
			'mid'      => 'Mid-range',
			'high'     => 'High specification',
		];
	}

	public static function get_defaults(): array {
		return [
			'cost_rates' => [
				'single_storey_rear'  => [ 'standard' => 1800, 'mid' => 2400, 'high' => 3200 ],
				'double_storey'       => [ 'standard' => 1600, 'mid' => 2200, 'high' => 3000 ],
				'loft_conversion'     => [ 'standard' => 1500, 'mid' => 2000, 'high' => 2800 ],
				'new_build'           => [ 'standard' => 2000, 'mid' => 2800, 'high' => 4000 ],
				'basement_conversion' => [ 'standard' => 3000, 'mid' => 3800, 'high' => 5000 ],
				'full_refurbishment'  => [ 'standard' => 1200, 'mid' => 1800, 'high' => 2600 ],
			],
			'fee_rates' => [
				'single_storey_rear'  => 12,
				'double_storey'       => 12,
				'loft_conversion'     => 12,
				'new_build'           => 12,
				'basement_conversion' => 12,
				'full_refurbishment'  => 12,
			],
			'display' => [
				'cta_label' => 'Get in touch',
				'cta_url'   => '',
				'heading'   => 'Estimate your project cost',
				'show_fees' => '1',
				'currency'  => '£',
			],
		];
	}

	public static function get_settings(): array {
		$saved = get_option( 'acc_settings', [] );
		return array_replace_recursive( self::get_defaults(), is_array( $saved ) ? $saved : [] );
	}
}
