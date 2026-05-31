<?php
/**
 * Bookable-slot calculator.
 *
 * Builds candidate consultation slots from the availability settings
 * (avail_days/start/end, slot_minutes, buffer_minutes, lead/window days) in the
 * site timezone, then removes any slot overlapping an existing booking or — if
 * Google Calendar is connected — a busy interval on the linked calendar.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Availability {

	/**
	 * Compute bookable slots between (now + $days_ahead_from) and (now + $days_ahead_to).
	 *
	 * @return array Map of 'Y-m-d' => list of array{ start: 'Y-m-d H:i:s', end: 'Y-m-d H:i:s', label: 'HH:MM' }.
	 */
	public static function slots( $days_ahead_from, $days_ahead_to ) {
		$s  = HGD_Settings::all();
		$tz = wp_timezone();

		$slot_minutes   = max( 15, (int) $s['slot_minutes'] );
		$buffer_minutes = max( 0, (int) $s['buffer_minutes'] );
		$step           = $slot_minutes + $buffer_minutes;

		$avail_days = array_filter( array_map( 'intval', explode( ',', (string) $s['avail_days'] ) ) );
		if ( ! $avail_days ) {
			return array();
		}

		list( $start_h, $start_m ) = self::parse_time( $s['avail_start'], 9, 0 );
		list( $end_h, $end_m )     = self::parse_time( $s['avail_end'], 17, 0 );

		$now = new DateTimeImmutable( 'now', $tz );

		// Earliest bookable instant: respect both the requested window and the lead time.
		$lead_days = max( (int) $days_ahead_from, (int) $s['booking_lead_days'] );
		$earliest  = $now->modify( '+' . $lead_days . ' days' );

		$range_end = $now->modify( '+' . (int) $days_ahead_to . ' days' )->setTime( 23, 59, 59 );

		// Window we need busy data for.
		$window_from = $earliest->setTime( 0, 0, 0 );
		$booked      = HGD_Booking::booked_slots(
			$window_from->format( 'Y-m-d H:i:s' ),
			$range_end->format( 'Y-m-d H:i:s' )
		);
		$busy = array();
		if ( HGD_Google_Calendar::is_connected() ) {
			$busy = HGD_Google_Calendar::freebusy(
				$window_from->format( DateTimeInterface::RFC3339 ),
				$range_end->format( DateTimeInterface::RFC3339 )
			);
		}

		$out = array();

		$day = $window_from;
		while ( $day <= $range_end ) {
			$dow = (int) $day->format( 'N' ); // 1 (Mon) … 7 (Sun)
			if ( in_array( $dow, $avail_days, true ) ) {
				$slot_start = $day->setTime( $start_h, $start_m );
				$day_end    = $day->setTime( $end_h, $end_m );

				while ( $slot_start < $day_end ) {
					$slot_end = $slot_start->modify( '+' . $slot_minutes . ' minutes' );
					if ( $slot_end > $day_end ) {
						break;
					}
					if ( $slot_start >= $earliest
						&& ! self::clashes( $slot_start, $slot_end, $booked, $tz )
						&& ! self::clashes_busy( $slot_start, $slot_end, $busy ) ) {
						$key = $slot_start->format( 'Y-m-d' );
						if ( ! isset( $out[ $key ] ) ) {
							$out[ $key ] = array();
						}
						$out[ $key ][] = array(
							'start' => $slot_start->format( 'Y-m-d H:i:s' ),
							'end'   => $slot_end->format( 'Y-m-d H:i:s' ),
							'label' => $slot_start->format( 'H:i' ),
						);
					}
					$slot_start = $slot_start->modify( '+' . $step . ' minutes' );
				}
			}
			$day = $day->modify( '+1 day' )->setTime( 0, 0, 0 );
		}

		return $out;
	}

	/** Is a single slot still free? Used to re-check at create time. */
	public static function slot_is_free( $start, $end ) {
		$tz   = wp_timezone();
		$from = ( new DateTimeImmutable( $start, $tz ) );
		$to   = ( new DateTimeImmutable( $end, $tz ) );

		$booked = HGD_Booking::booked_slots( $from->format( 'Y-m-d H:i:s' ), $to->format( 'Y-m-d H:i:s' ) );
		if ( self::clashes( $from, $to, $booked, $tz ) ) {
			return false;
		}
		if ( HGD_Google_Calendar::is_connected() ) {
			$busy = HGD_Google_Calendar::freebusy( $from->format( DateTimeInterface::RFC3339 ), $to->format( DateTimeInterface::RFC3339 ) );
			if ( self::clashes_busy( $from, $to, $busy ) ) {
				return false;
			}
		}
		return true;
	}

	private static function clashes( DateTimeImmutable $start, DateTimeImmutable $end, $booked, $tz ) {
		if ( ! $booked ) {
			return false;
		}
		foreach ( $booked as $b ) {
			$bs = new DateTimeImmutable( $b['slot_start'], $tz );
			$be = new DateTimeImmutable( $b['slot_end'], $tz );
			if ( $start < $be && $end > $bs ) {
				return true;
			}
		}
		return false;
	}

	private static function clashes_busy( DateTimeImmutable $start, DateTimeImmutable $end, $busy ) {
		if ( ! $busy ) {
			return false;
		}
		foreach ( $busy as $b ) {
			if ( empty( $b['start'] ) || empty( $b['end'] ) ) {
				continue;
			}
			try {
				$bs = new DateTimeImmutable( $b['start'] );
				$be = new DateTimeImmutable( $b['end'] );
			} catch ( Exception $e ) {
				continue;
			}
			if ( $start < $be && $end > $bs ) {
				return true;
			}
		}
		return false;
	}

	private static function parse_time( $value, $def_h, $def_m ) {
		if ( preg_match( '/^(\d{1,2}):(\d{2})$/', trim( (string) $value ), $m ) ) {
			return array( min( 23, (int) $m[1] ), min( 59, (int) $m[2] ) );
		}
		return array( $def_h, $def_m );
	}
}
