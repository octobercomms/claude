<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class OO_Serper {

    private $api_key;
    private $base_url = 'https://google.serper.dev/search';

    // Domains to exclude from business results — aggregators, social, directories, etc.
    private $skip_domains = array(
        'google.', 'google.com', 'facebook.com', 'linkedin.com', 'instagram.com',
        'twitter.com', 'x.com', 'youtube.com', 'tiktok.com',
        'yelp.com', 'yellowpages.com', 'houzz.com', 'trulia.com', 'zillow.com',
        'archdaily.com', 'dezeen.com', 'architecturaldigest.com', 'dwell.com',
        'wikipedia.org', 'wikimedia.org',
        'indeed.com', 'seek.com.au', 'glassdoor.com', 'linkedin.com',
        'amazon.com', 'amazon.com.au', 'ebay.com',
        'yelp.com.au', 'truelocal.com.au', 'localsearch.com.au',
        'architectureau.com', 'architectureandesign.com.au',
        'archello.com', 'architizer.com', 'arch2o.com',
        'homestars.com', 'angi.com', 'thumbtack.com',
        'homeadvisor.com', 'builderscrack.co.nz',
    );

    public function __construct() {
        $settings      = get_option( 'oo_settings', array() );
        $this->api_key = trim( $settings['serper_api_key'] ?? '' );
    }

    public function is_configured() {
        return ! empty( $this->api_key );
    }

    private function search( $query, $num = 10 ) {
        $response = wp_remote_post( $this->base_url, array(
            'timeout' => 15,
            'headers' => array(
                'X-API-KEY'    => $this->api_key,
                'Content-Type' => 'application/json',
            ),
            'body' => wp_json_encode( array( 'q' => $query, 'num' => $num ) ),
        ) );

        if ( is_wp_error( $response ) ) {
            return $response;
        }

        $code = wp_remote_retrieve_response_code( $response );
        $data = json_decode( wp_remote_retrieve_body( $response ), true );

        if ( $code !== 200 ) {
            $msg = $data['message'] ?? 'Serper API error (HTTP ' . $code . ')';
            return new WP_Error( 'serper_error', $msg );
        }

        return $data['organic'] ?? array();
    }

    /**
     * Search for real business domains matching the audience criteria.
     * Runs multiple targeted queries and deduplicates results.
     */
    public function find_business_domains( $industry_type, $location, $specialisation, $exclude_domains = array() ) {
        $queries = array();

        $subject = trim( $specialisation ?: $industry_type );
        if ( $location ) {
            $queries[] = '"' . $subject . '" ' . $location;
            $queries[] = $subject . ' firm ' . $location;
            if ( $specialisation && $industry_type ) {
                $queries[] = $industry_type . ' ' . $location;
            }
        } else {
            $queries[] = $subject . ' firm';
            $queries[] = '"' . $subject . '"';
        }

        $domains = array();

        foreach ( $queries as $query ) {
            $results = $this->search( $query, 10 );
            if ( is_wp_error( $results ) ) continue;

            foreach ( $results as $r ) {
                $domain = $this->extract_domain( $r['link'] ?? '' );
                if ( ! $domain ) continue;
                if ( $this->is_skippable( $domain ) ) continue;
                if ( in_array( $domain, $exclude_domains, true ) ) continue;
                $domains[ $domain ] = true;
            }
        }

        return array_keys( $domains );
    }

    /**
     * Search for firm listings within a known directory domain.
     * E.g. search site:archello.com "Melbourne" "architecture"
     */
    public function search_within_directory( $directory_domain, $location, $industry_type, $num = 10 ) {
        $query = 'site:' . $directory_domain;
        if ( $location )      $query .= ' "' . $location . '"';
        if ( $industry_type ) $query .= ' ' . $industry_type;

        $results = $this->search( $query, $num );
        if ( is_wp_error( $results ) ) {
            return array();
        }

        // Collect the snippets/links — the directory listing pages themselves
        // (caller will scrape these for firm website links)
        $pages = array();
        foreach ( $results as $r ) {
            if ( ! empty( $r['link'] ) ) {
                $pages[] = $r['link'];
            }
        }

        return $pages;
    }

    private function extract_domain( $url ) {
        if ( ! $url ) return '';
        $parsed = wp_parse_url( $url );
        $host   = strtolower( $parsed['host'] ?? '' );
        return preg_replace( '/^www\./', '', $host );
    }

    private function is_skippable( $domain ) {
        foreach ( $this->skip_domains as $skip ) {
            if ( $domain === $skip || substr( $domain, -strlen( '.' . $skip ) ) === '.' . $skip ) {
                return true;
            }
            // Partial match for TLD-agnostic entries like 'google.'
            if ( strpos( $domain, $skip ) !== false ) {
                return true;
            }
        }
        return false;
    }
}
