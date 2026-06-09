<?php
/**
 * Coverage Monitor — scheduled searches that auto-find client coverage online
 * and drop it into the editorial log as `new` (unconfirmed) for one-tap review.
 *
 * Sources: Serper (Google News) and Google Alerts RSS/Atom feeds. Hits are
 * matched to an outlet (alias-aware) and de-duped by story URL per client.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class OO_Monitor {

    public static function init() {
        add_action( 'oo_pr_monitor_tick', array( __CLASS__, 'run_due' ) );

        if ( defined( 'OO_HAS_ACTION_SCHEDULER' ) && OO_HAS_ACTION_SCHEDULER
            && function_exists( 'as_has_scheduled_action' )
            && ! as_has_scheduled_action( 'oo_pr_monitor_tick', array(), 'october-outreach' ) ) {
            as_schedule_recurring_action( time() + HOUR_IN_SECONDS, 12 * HOUR_IN_SECONDS, 'oo_pr_monitor_tick', array(), 'october-outreach' );
        }
    }

    private static function window_days( $cadence ) {
        return $cadence === 'weekly' ? 7 : 1;
    }

    /** Run every active saved search that's due. */
    public static function run_due() {
        global $wpdb;
        $searches = $wpdb->get_results( "SELECT * FROM {$wpdb->prefix}oo_coverage_searches WHERE status = 'active'" );
        foreach ( $searches as $s ) {
            $window = self::window_days( $s->cadence );
            $due = ! $s->last_run_at || ( time() - strtotime( $s->last_run_at ) ) >= ( $window - 0.1 ) * DAY_IN_SECONDS;
            if ( $due ) self::run_search( $s );
        }
    }

    /**
     * Run one saved search across its configured sources. Returns the number of
     * new editorial-log rows created.
     */
    public static function run_search( $search ) {
        global $wpdb;
        $sources = array_filter( array_map( 'trim', explode( ',', $search->sources ?: 'serper' ) ) );
        $new = 0;

        if ( in_array( 'serper', $sources, true ) && $search->query ) {
            $serper = new OO_Serper();
            if ( $serper->is_configured() ) {
                $hits = $serper->search_news( $search->query, 20 );
                if ( ! is_wp_error( $hits ) ) {
                    foreach ( $hits as $h ) $new += self::ingest( $search->client, $h, 'serper' );
                }
            }
        }

        if ( in_array( 'alerts', $sources, true ) && $search->alerts_rss ) {
            foreach ( self::fetch_rss( $search->alerts_rss ) as $h ) {
                $new += self::ingest( $search->client, $h, 'alerts' );
            }
        }

        $wpdb->update( $wpdb->prefix . 'oo_coverage_searches', array( 'last_run_at' => current_time( 'mysql' ) ), array( 'id' => $search->id ) );
        return $new;
    }

    /**
     * Insert a hit as a `new` editorial-log row, de-duped by URL per client.
     * @return int 1 if inserted, 0 if skipped.
     */
    private static function ingest( $client, $hit, $source ) {
        global $wpdb;
        $url = esc_url_raw( $hit['link'] ?? '' );
        if ( ! $url ) return 0;

        $exists = $wpdb->get_var( $wpdb->prepare(
            "SELECT id FROM {$wpdb->prefix}oo_editorial_log WHERE client = %s AND story_url = %s LIMIT 1",
            $client, $url
        ) );
        if ( $exists ) return 0;

        // Resolve the outlet from the source name, falling back to the link's host.
        $outlet_name = trim( $hit['source'] ?? '' );
        if ( $outlet_name === '' ) {
            $host = wp_parse_url( $url, PHP_URL_HOST );
            $outlet_name = $host ? preg_replace( '/^www\./', '', $host ) : '';
        }
        $outlet_id = $outlet_name ? OO_Dedup::resolve_outlet( $outlet_name ) : 0;

        $date = '';
        if ( ! empty( $hit['date'] ) ) {
            $ts = strtotime( $hit['date'] );
            if ( $ts ) $date = gmdate( 'Y-m-d', $ts );
        }

        $wpdb->insert( $wpdb->prefix . 'oo_editorial_log', array(
            'client'      => sanitize_text_field( $client ),
            'story_title' => sanitize_text_field( $hit['title'] ?? '' ),
            'outlet_id'   => $outlet_id ?: null,
            'status'      => 'new',
            'issue_date'  => $date ?: null,
            'story_url'   => $url,
            'source'      => $source === 'alerts' ? 'alerts' : 'serper',
        ) );
        return 1;
    }

    /** Parse a Google Alerts (Atom) or generic RSS feed into normalised hits. */
    private static function fetch_rss( $rss_url ) {
        $resp = wp_remote_get( $rss_url, array( 'timeout' => 15, 'redirection' => 3 ) );
        if ( is_wp_error( $resp ) ) return array();
        $body = wp_remote_retrieve_body( $resp );
        if ( ! $body ) return array();

        libxml_use_internal_errors( true );
        $xml = simplexml_load_string( $body );
        libxml_clear_errors();
        if ( ! $xml ) return array();

        $hits = array();

        // Atom (Google Alerts)
        if ( isset( $xml->entry ) ) {
            foreach ( $xml->entry as $e ) {
                $link = '';
                foreach ( $e->link as $l ) {
                    $href = (string) $l['href'];
                    if ( $href ) { $link = $href; break; }
                }
                // Google Alerts wraps the real URL in a google.com/url?...&url= redirect.
                if ( $link && strpos( $link, 'google.com/url' ) !== false ) {
                    parse_str( (string) wp_parse_url( $link, PHP_URL_QUERY ), $q );
                    if ( ! empty( $q['url'] ) ) $link = $q['url'];
                }
                $hits[] = array(
                    'title'   => trim( wp_strip_all_tags( (string) $e->title ) ),
                    'link'    => $link,
                    'source'  => '',
                    'date'    => (string) ( $e->published ?? $e->updated ?? '' ),
                    'snippet' => trim( wp_strip_all_tags( (string) ( $e->content ?? '' ) ) ),
                );
            }
            return $hits;
        }

        // RSS 2.0
        if ( isset( $xml->channel->item ) ) {
            foreach ( $xml->channel->item as $it ) {
                $hits[] = array(
                    'title'   => trim( wp_strip_all_tags( (string) $it->title ) ),
                    'link'    => (string) $it->link,
                    'source'  => '',
                    'date'    => (string) ( $it->pubDate ?? '' ),
                    'snippet' => trim( wp_strip_all_tags( (string) ( $it->description ?? '' ) ) ),
                );
            }
        }
        return $hits;
    }
}
