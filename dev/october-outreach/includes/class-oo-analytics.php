<?php
/**
 * Journalist ↔ coverage analytics helpers.
 *
 * Pure scoring/labelling logic (no WP calls) so it can be unit-tested. The
 * aggregation SQL lives in the views; this turns the raw counts into a
 * relationship-strength score, labels, and the "gone quiet" flag.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class OO_Analytics {

    /** A journalist with no published coverage in this many months is "gone quiet". */
    const GONE_QUIET_MONTHS = 12;

    /**
     * Relationship-strength score 0–100 from published volume + recency.
     *
     * @param int      $published        count of published pieces
     * @param int|null $last_featured_ts  unix ts of most recent published piece
     * @param int|null $now               unix ts (testable; defaults to now)
     * @return array { score:int, label:string }
     */
    public static function relationship_strength( $published, $last_featured_ts = null, $now = null ) {
        $published = max( 0, (int) $published );
        $now       = $now ?: time();

        // Volume: up to 70 points, 10 per published piece.
        $score = min( 70, $published * 10 );

        // Recency: rewards recent coverage, decays with age.
        if ( $published > 0 && $last_featured_ts ) {
            $months = ( $now - $last_featured_ts ) / ( 30 * DAY_IN_SECONDS );
            if ( $months <= 6 )       $score += 30;
            elseif ( $months <= 12 )  $score += 18;
            elseif ( $months <= 24 )  $score += 8;
        }

        $score = (int) min( 100, $score );
        return array( 'score' => $score, 'label' => self::label_for( $score ) );
    }

    public static function label_for( $score ) {
        if ( $score >= 80 ) return 'Strong';
        if ( $score >= 50 ) return 'Good';
        if ( $score >= 20 ) return 'Warm';
        if ( $score > 0 )   return 'Cool';
        return 'New';
    }

    /**
     * Hit rate = published ÷ (meaningful pitch outcomes). Returns 0–1, or null
     * when there's nothing to rate.
     */
    public static function hit_rate( $published, $pitched, $declined ) {
        $denom = (int) $published + (int) $pitched + (int) $declined;
        if ( $denom <= 0 ) return null;
        return (int) $published / $denom;
    }

    /**
     * Is this journalist "gone quiet" — has published before but not recently?
     */
    public static function is_gone_quiet( $published, $last_featured_ts, $now = null ) {
        if ( (int) $published <= 0 || ! $last_featured_ts ) return false;
        $now = $now ?: time();
        return ( $now - $last_featured_ts ) > self::GONE_QUIET_MONTHS * 30 * DAY_IN_SECONDS;
    }
}
