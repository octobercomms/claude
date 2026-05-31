<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class OO_Scraper {

    private $timeout = 10;

    /**
     * Check that a domain resolves and returns a valid HTTP response.
     * Returns true if domain is live, false if dead/unreachable.
     */
    public function domain_is_live( $domain ) {
        $url      = 'https://' . $domain;
        $response = wp_remote_head( $url, array(
            'timeout'     => $this->timeout,
            'redirection' => 5,
            'user-agent'  => 'Mozilla/5.0 (compatible; OctoberOutreach/1.0)',
            'sslverify'   => false,
        ) );

        if ( is_wp_error( $response ) ) {
            // Try http:// as fallback
            $response = wp_remote_head( 'http://' . $domain, array(
                'timeout'     => $this->timeout,
                'redirection' => 5,
                'user-agent'  => 'Mozilla/5.0 (compatible; OctoberOutreach/1.0)',
            ) );
        }

        if ( is_wp_error( $response ) ) {
            return false;
        }

        $code = wp_remote_retrieve_response_code( $response );
        return $code >= 200 && $code < 600; // Anything other than a connection failure
    }

    /**
     * Scrape a domain's contact/about/team pages for email addresses.
     * Returns array of contact records.
     */
    public function scrape_domain( $domain ) {
        $paths = array( '', '/contact', '/contact-us', '/about', '/about-us', '/team', '/people', '/staff' );
        $found_emails = array();

        foreach ( $paths as $path ) {
            $url     = 'https://' . $domain . $path;
            $emails  = $this->extract_emails_from_url( $url, $domain );
            foreach ( $emails as $email ) {
                $found_emails[ $email ] = true;
            }
            // Limit to avoid too many requests
            if ( count( $found_emails ) >= 5 ) break;
        }

        $contacts = array();
        foreach ( array_keys( $found_emails ) as $email ) {
            if ( ! is_email( $email ) ) continue;
            $contacts[] = array(
                'first_name'   => '',
                'last_name'    => '',
                'email'        => $email,
                'company'      => $domain,
                'title'        => 'Contact',
                'linkedin_url' => '',
                'location'     => '',
                'domain'       => $domain,
                'confidence'   => 65,
                'source'       => 'web-scrape',
            );
        }

        return $contacts;
    }

    /**
     * Fetch a URL and extract all email addresses from mailto: links and text.
     */
    private function extract_emails_from_url( $url, $domain ) {
        $response = wp_remote_get( $url, array(
            'timeout'     => $this->timeout,
            'redirection' => 5,
            'user-agent'  => 'Mozilla/5.0 (compatible; OctoberOutreach/1.0)',
            'sslverify'   => false,
        ) );

        if ( is_wp_error( $response ) ) {
            return array();
        }

        $code = wp_remote_retrieve_response_code( $response );
        if ( $code < 200 || $code >= 400 ) {
            return array();
        }

        $body   = wp_remote_retrieve_body( $response );
        $emails = array();

        // Extract from mailto: links
        if ( preg_match_all( '/mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i', $body, $matches ) ) {
            foreach ( $matches[1] as $email ) {
                $email = strtolower( $email );
                if ( $this->email_belongs_to_domain( $email, $domain ) ) {
                    $emails[] = $email;
                }
            }
        }

        // Extract plain email addresses in text (common obfuscations handled)
        $body_text = strip_tags( $body );
        if ( preg_match_all( '/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/', $body_text, $matches ) ) {
            foreach ( $matches[0] as $email ) {
                $email = strtolower( $email );
                if ( $this->email_belongs_to_domain( $email, $domain ) ) {
                    $emails[] = $email;
                }
            }
        }

        return array_unique( $emails );
    }

    /**
     * Check an email address belongs to the target domain.
     * Accepts exact match or common subdomains like mail.domain.com.
     */
    private function email_belongs_to_domain( $email, $domain ) {
        $parts     = explode( '@', $email );
        $email_dom = $parts[1] ?? '';
        return $email_dom === $domain || substr( $email_dom, -strlen( '.' . $domain ) ) === '.' . $domain;
    }

    /**
     * Scrape a directory listing page for external firm website links.
     * Filters out the directory's own domain and known aggregators.
     * Returns array of domain strings.
     */
    public function scrape_directory_page( $url, $directory_domain = '' ) {
        $response = wp_remote_get( $url, array(
            'timeout'     => $this->timeout,
            'redirection' => 5,
            'user-agent'  => 'Mozilla/5.0 (compatible; OctoberOutreach/1.0)',
            'sslverify'   => false,
        ) );

        if ( is_wp_error( $response ) ) return array();
        $code = wp_remote_retrieve_response_code( $response );
        if ( $code < 200 || $code >= 400 ) return array();

        $body = wp_remote_retrieve_body( $response );

        // Extract all hrefs
        preg_match_all( '/href=["\']([^"\']+)["\']/', $body, $matches );
        $links = $matches[1] ?? array();

        $skip = array(
            'google.', 'facebook.', 'linkedin.', 'twitter.', 'instagram.',
            'youtube.', 'pinterest.', 'houzz.', 'yelp.', 'amazon.',
            'archdaily.', 'dezeen.', 'wikipedia.',
        );

        $found = array();
        foreach ( $links as $link ) {
            // Must be absolute with http
            if ( strpos( $link, 'http' ) !== 0 ) continue;

            $parsed = wp_parse_url( $link );
            $host   = strtolower( $parsed['host'] ?? '' );
            $domain = preg_replace( '/^www\./', '', $host );

            if ( ! $domain ) continue;
            if ( $directory_domain && strpos( $domain, $directory_domain ) !== false ) continue;

            $bad = false;
            foreach ( $skip as $s ) {
                if ( strpos( $domain, $s ) !== false ) { $bad = true; break; }
            }
            if ( $bad ) continue;

            // Must look like a real domain (TLD present)
            if ( ! preg_match( '/\.[a-z]{2,}$/', $domain ) ) continue;

            $found[ $domain ] = true;
        }

        return array_keys( $found );
    }

    /**
     * Generate a set of generic pattern-based email guesses for a domain.
     * These are unverified — flagged with confidence 30 and source 'pattern'.
     */
    public function pattern_contacts( $domain ) {
        $patterns = array( 'info', 'contact', 'hello', 'hi', 'studio', 'team', 'office', 'mail' );
        $contacts = array();

        foreach ( $patterns as $prefix ) {
            $email = $prefix . '@' . $domain;
            $contacts[] = array(
                'first_name'   => '',
                'last_name'    => '',
                'email'        => $email,
                'company'      => $domain,
                'title'        => 'Generic contact',
                'linkedin_url' => '',
                'location'     => '',
                'domain'       => $domain,
                'confidence'   => 30,
                'source'       => 'pattern',
            );
        }

        return $contacts;
    }
}
