<?php
/**
 * REST API for the PR module — the shared gateway for external surfaces
 * (the nvelope front-end at platform.octobercomms.com, and the Gmail add-on).
 *
 * Namespace: oo/v1. Auth: a logged-in manage_options user, OR an `X-OO-Key`
 * header matching the key in Settings (for off-site apps like nvelope).
 * The WordPress plugin stays the single source of truth; these endpoints just
 * expose/accept its data so the logic isn't duplicated elsewhere.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class OO_REST {

    const NS = 'oo/v1';

    public static function init() {
        // Ensure an API key exists for external callers.
        if ( ! get_option( 'oo_api_key' ) ) {
            add_option( 'oo_api_key', wp_generate_password( 40, false, false ) );
        }
        add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
    }

    public static function register_routes() {
        $perm = array( __CLASS__, 'permit' );

        register_rest_route( self::NS, '/stats', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'stats' ),
            'permission_callback' => $perm,
        ) );

        register_rest_route( self::NS, '/editorial-log', array(
            array(
                'methods'             => 'GET',
                'callback'            => array( __CLASS__, 'log_list' ),
                'permission_callback' => $perm,
            ),
            array(
                'methods'             => 'POST',
                'callback'            => array( __CLASS__, 'log_create' ),
                'permission_callback' => $perm,
            ),
        ) );

        register_rest_route( self::NS, '/journalists', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'journalists' ),
            'permission_callback' => $perm,
        ) );

        register_rest_route( self::NS, '/journalists/(?P<id>\d+)', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'journalist' ),
            'permission_callback' => $perm,
        ) );

        register_rest_route( self::NS, '/outlets', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'outlets' ),
            'permission_callback' => $perm,
        ) );

        register_rest_route( self::NS, '/clients', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'clients' ),
            'permission_callback' => $perm,
        ) );
    }

    /** Auth: logged-in admin, or a matching X-OO-Key header. */
    public static function permit( $request ) {
        if ( current_user_can( 'manage_options' ) ) return true;
        $key    = (string) $request->get_header( 'x-oo-key' );
        $stored = (string) get_option( 'oo_api_key', '' );
        if ( $stored !== '' && hash_equals( $stored, $key ) ) return true;
        return new WP_Error( 'oo_forbidden', 'Invalid or missing API key.', array( 'status' => 401 ) );
    }

    // ── Endpoints ──────────────────────────────────────────

    public static function stats() {
        global $wpdb;
        $log = $wpdb->prefix . 'oo_editorial_log';
        return array(
            'log_entries'    => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$log} WHERE status NOT IN ('new','dismissed')" ),
            'published'      => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$log} WHERE status IN ('published','download')" ),
            'pending_review' => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$log} WHERE status = 'new'" ),
            'journalists'    => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->prefix}oo_contacts WHERE segment = 'media'" ),
            'outlets'        => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->prefix}oo_outlets WHERE status != 'merged'" ),
            'clients'        => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->prefix}oo_clients" ),
        );
    }

    public static function log_list( $request ) {
        global $wpdb;
        $log = $wpdb->prefix . 'oo_editorial_log';
        $statuses = OO_Database::get_editorial_statuses();

        $where = "WHERE l.status NOT IN ('new','dismissed')";
        $args  = array();
        if ( $c = sanitize_text_field( (string) $request->get_param( 'client' ) ) ) { $where .= " AND l.client = %s"; $args[] = $c; }
        if ( $s = sanitize_text_field( (string) $request->get_param( 'status' ) ) ) { if ( isset( $statuses[ $s ] ) ) { $where = str_replace( "l.status NOT IN ('new','dismissed')", 'l.status = %s', $where ); $args[] = $s; } }
        if ( $q = sanitize_text_field( (string) $request->get_param( 'search' ) ) ) { $where .= " AND l.story_title LIKE %s"; $args[] = '%' . $wpdb->esc_like( $q ) . '%'; }

        $per_page = min( 100, max( 1, (int) ( $request->get_param( 'per_page' ) ?: 50 ) ) );
        $page     = max( 1, (int) ( $request->get_param( 'page' ) ?: 1 ) );
        $offset   = ( $page - 1 ) * $per_page;

        $total = (int) ( $args
            ? $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$log} l {$where}", $args ) )
            : $wpdb->get_var( "SELECT COUNT(*) FROM {$log} l {$where}" ) );

        $sql = "SELECT l.id, l.client, l.story_title, l.status, l.country, l.issue_date,
                       l.story_url, l.notes_outcome, o.name AS outlet,
                       TRIM(CONCAT(c.first_name,' ',c.last_name)) AS journalist
                FROM {$log} l
                LEFT JOIN {$wpdb->prefix}oo_outlets o ON o.id = l.outlet_id
                LEFT JOIN {$wpdb->prefix}oo_contacts c ON c.id = l.contact_id
                {$where}
                ORDER BY COALESCE(l.issue_date, l.request_date) DESC, l.id DESC
                LIMIT %d OFFSET %d";
        $rows = $wpdb->get_results( $wpdb->prepare( $sql, array_merge( $args, array( $per_page, $offset ) ) ) );

        $items = array_map( function ( $r ) use ( $statuses ) {
            return array(
                'id'           => (int) $r->id,
                'client'       => $r->client,
                'story_title'  => $r->story_title,
                'status'       => $r->status,
                'status_label' => $statuses[ $r->status ] ?? $r->status,
                'country'      => $r->country,
                'issue_date'   => $r->issue_date,
                'story_url'    => $r->story_url,
                'outlet'       => $r->outlet,
                'journalist'   => $r->journalist,
                'notes'        => $r->notes_outcome,
            );
        }, $rows );

        return array( 'total' => $total, 'page' => $page, 'per_page' => $per_page, 'items' => $items );
    }

    public static function log_create( $request ) {
        global $wpdb;
        $p = $request->get_json_params();
        if ( ! is_array( $p ) ) $p = $request->get_params();

        $outlet_id  = ! empty( $p['publication'] ) ? OO_Dedup::resolve_outlet( sanitize_text_field( $p['publication'] ) ) : 0;
        $contact_id = 0;
        if ( ! empty( $p['press_contact'] ) ) {
            $parts = preg_split( '/\s+/', trim( sanitize_text_field( $p['press_contact'] ) ), 2 );
            $contact_id = OO_Dedup::resolve_contact( array(
                'first_name' => $parts[0] ?? '',
                'last_name'  => $parts[1] ?? '',
                'email'      => sanitize_email( $p['email'] ?? '' ),
                'outlet_id'  => $outlet_id,
                'source'     => 'API',
            ) );
        }

        $statuses = OO_Database::get_editorial_statuses();
        $status   = sanitize_text_field( $p['status'] ?? 'pitched' );
        if ( ! isset( $statuses[ $status ] ) ) $status = 'pitched';

        $date = '';
        if ( ! empty( $p['issue_date'] ) ) { $ts = strtotime( $p['issue_date'] ); if ( $ts ) $date = gmdate( 'Y-m-d', $ts ); }

        $wpdb->insert( $wpdb->prefix . 'oo_editorial_log', array(
            'client'        => sanitize_text_field( $p['client'] ?? '' ),
            'story_title'   => sanitize_text_field( $p['story_title'] ?? '' ),
            'contact_id'    => $contact_id ?: null,
            'outlet_id'     => $outlet_id ?: null,
            'country'       => sanitize_text_field( $p['country'] ?? '' ),
            'status'        => $status,
            'pitch_request' => sanitize_textarea_field( $p['pitch_request'] ?? '' ),
            'issue_date'    => $date ?: null,
            'story_url'     => esc_url_raw( $p['story_url'] ?? '' ),
            'notes_outcome' => sanitize_textarea_field( $p['notes_outcome'] ?? '' ),
            'source'        => 'api',
        ) );
        return new WP_REST_Response( array( 'id' => (int) $wpdb->insert_id, 'created' => true ), 201 );
    }

    public static function journalists( $request ) {
        global $wpdb;
        $con = $wpdb->prefix . 'oo_contacts';
        $log = $wpdb->prefix . 'oo_editorial_log';
        $out = $wpdb->prefix . 'oo_outlets';

        $join_cond = 'l.contact_id = c.id';
        $args = array();
        if ( $client = sanitize_text_field( (string) $request->get_param( 'client' ) ) ) {
            $join_cond .= ' AND l.client = %s'; $args[] = $client;
        }
        $having = $client ? 'HAVING total > 0' : '';

        $sql = "SELECT c.id, TRIM(CONCAT(c.first_name,' ',c.last_name)) AS name, o.name AS outlet,
                       COUNT(l.id) AS total,
                       SUM(l.status='published') AS published,
                       SUM(l.status='pitched')   AS pitched,
                       SUM(l.status='declined')  AS declined,
                       MAX(CASE WHEN l.status='published' THEN COALESCE(l.issue_date,l.request_date) END) AS last_featured
                FROM {$con} c
                LEFT JOIN {$log} l ON {$join_cond}
                LEFT JOIN {$out} o ON o.id = c.outlet_id
                WHERE c.segment = 'media'
                GROUP BY c.id {$having}
                ORDER BY published DESC, total DESC
                LIMIT 200";
        $rows = $args ? $wpdb->get_results( $wpdb->prepare( $sql, $args ) ) : $wpdb->get_results( $sql );

        $items = array_map( function ( $r ) {
            $ts  = $r->last_featured ? strtotime( $r->last_featured ) : null;
            $str = OO_Analytics::relationship_strength( $r->published, $ts );
            return array(
                'id'            => (int) $r->id,
                'name'          => $r->name,
                'outlet'        => $r->outlet,
                'published'     => (int) $r->published,
                'pitched'       => (int) $r->pitched,
                'hit_rate'      => OO_Analytics::hit_rate( $r->published, $r->pitched, $r->declined ),
                'last_featured' => $r->last_featured,
                'strength'      => $str['score'],
                'strength_label'=> $str['label'],
                'gone_quiet'    => OO_Analytics::is_gone_quiet( $r->published, $ts ),
            );
        }, $rows );

        return array( 'items' => $items );
    }

    public static function journalist( $request ) {
        global $wpdb;
        $id = (int) $request['id'];
        $c  = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}oo_contacts WHERE id = %d", $id ) );
        if ( ! $c ) return new WP_Error( 'not_found', 'Journalist not found.', array( 'status' => 404 ) );

        $coverage = $wpdb->get_results( $wpdb->prepare(
            "SELECT l.client, l.story_title, l.status, l.issue_date, l.story_url, o.name AS outlet
             FROM {$wpdb->prefix}oo_editorial_log l
             LEFT JOIN {$wpdb->prefix}oo_outlets o ON o.id = l.outlet_id
             WHERE l.contact_id = %d
             ORDER BY COALESCE(l.issue_date,l.request_date) DESC", $id
        ) );
        $real_email = $c->email && ! str_ends_with( $c->email, '@import.local' );

        return array(
            'id'        => (int) $c->id,
            'name'      => trim( $c->first_name . ' ' . $c->last_name ),
            'email'     => $real_email ? $c->email : null,
            'location'  => $c->location,
            'bio_link'  => $c->bio_link,
            'coverage'  => array_map( function ( $r ) {
                return array(
                    'client'      => $r->client,
                    'outlet'      => $r->outlet,
                    'story_title' => $r->story_title,
                    'status'      => $r->status,
                    'issue_date'  => $r->issue_date,
                    'story_url'   => $r->story_url,
                );
            }, $coverage ),
        );
    }

    public static function outlets( $request ) {
        global $wpdb;
        $rows = $wpdb->get_results(
            "SELECT o.id, o.name, o.domain, o.status,
                    ( SELECT COUNT(*) FROM {$wpdb->prefix}oo_editorial_log l WHERE l.outlet_id = o.id ) AS coverage
             FROM {$wpdb->prefix}oo_outlets o
             WHERE o.status != 'merged'
             ORDER BY coverage DESC, o.name ASC
             LIMIT 500"
        );
        return array( 'items' => array_map( function ( $r ) {
            return array( 'id' => (int) $r->id, 'name' => $r->name, 'domain' => $r->domain, 'status' => $r->status, 'coverage' => (int) $r->coverage );
        }, $rows ) );
    }

    public static function clients() {
        global $wpdb;
        $rows = $wpdb->get_results( "SELECT * FROM {$wpdb->prefix}oo_clients ORDER BY name ASC" );
        return array( 'items' => array_map( function ( $r ) use ( $wpdb ) {
            $published = (int) $wpdb->get_var( $wpdb->prepare(
                "SELECT COUNT(*) FROM {$wpdb->prefix}oo_editorial_log WHERE client = %s AND status IN ('published','download')", $r->name
            ) );
            return array(
                'id'         => (int) $r->id,
                'name'       => $r->name,
                'portal_url' => OO_Portal::portal_url( $r->token ),
                'published'  => $published,
                'cadence'    => $r->report_cadence,
            );
        }, $rows ) );
    }
}
