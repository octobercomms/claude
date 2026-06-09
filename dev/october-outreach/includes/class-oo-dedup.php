<?php
/**
 * Outlet (publication) deduplication engine.
 *
 * Stage 1 — mechanical normalisation (this file): folds case/punctuation/
 *           diacritics, strips "DO NOT USE", and reduces URL/domain forms
 *           (Dezeen.com → dezeen) to a canonical key.
 * Stage 2 — fuzzy blocking (this file): groups records sharing a key, then
 *           clusters near-misses (typos, minor word diffs) by edit distance.
 * Stage 3 — Claude adjudication (OO_Claude::adjudicate_duplicates) + a human
 *           "do you mean X?" review run from the Media Database page.
 *
 * The normalise()/build_clusters() methods are pure (no WP) so they can be
 * unit-tested against the real export.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class OO_Dedup {

    /** Tokens dropped when a value is a bare domain / URL. */
    const TLDS = array( 'com', 'co', 'uk', 'net', 'org', 'io', 'mx', 'de', 'fr', 'es', 'it', 'cn', 'ru', 'eu', 'us', 'au', 'nl', 'se', 'ch', 'at', 'be', 'ie', 'info', 'online', 'news', 'mag' );

    /**
     * Does this name carry a "do not use" marker?
     */
    public static function is_do_not_use( $name ) {
        return stripos( (string) $name, 'do not use' ) !== false;
    }

    /**
     * Reduce a publication name to a canonical match key (lowercase alnum, no
     * spaces). Returns '' when nothing usable remains.
     */
    public static function normalise( $name ) {
        $s = strtolower( trim( (string) $name ) );
        if ( $s === '' ) return '';

        // Strip the "do not use" marker — it's a flag, not part of the name.
        $s = trim( preg_replace( '/\bdo not use\b/i', '', $s ) );

        // Fold common diacritics to ASCII.
        $s = self::fold_diacritics( $s );

        // & → and
        $s = str_replace( '&', ' and ', $s );

        $looks_like_url = preg_match( '#^(https?://|www\.)#', $s )
            || preg_match( '#^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(/|$)#', $s );

        if ( $looks_like_url ) {
            // Take the host, drop scheme/path, then drop TLD tokens.
            $s = preg_replace( '#^https?://#', '', $s );
            $s = preg_replace( '#^www\.#', '', $s );
            $s = preg_replace( '#[/?].*$#', '', $s ); // drop path/query
            $parts = array_filter( preg_split( '/[^a-z0-9]+/', $s ) );
            $parts = array_filter( $parts, fn( $p ) => ! in_array( $p, self::TLDS, true ) );
            return implode( '', $parts );
        }

        // Plain name: tokenise, drop a leading "the", join.
        $parts = array_values( array_filter( preg_split( '/[^a-z0-9]+/', $s ) ) );
        if ( $parts && $parts[0] === 'the' ) array_shift( $parts );
        return implode( '', $parts );
    }

    private static function fold_diacritics( $s ) {
        if ( function_exists( 'iconv' ) ) {
            $t = @iconv( 'UTF-8', 'ASCII//TRANSLIT//IGNORE', $s );
            if ( $t !== false ) return strtolower( $t );
        }
        $map = array(
            'á'=>'a','à'=>'a','â'=>'a','ä'=>'a','ã'=>'a','å'=>'a','é'=>'e','è'=>'e','ê'=>'e','ë'=>'e',
            'í'=>'i','ì'=>'i','î'=>'i','ï'=>'i','ó'=>'o','ò'=>'o','ô'=>'o','ö'=>'o','õ'=>'o',
            'ú'=>'u','ù'=>'u','û'=>'u','ü'=>'u','ñ'=>'n','ç'=>'c','ß'=>'ss','ø'=>'o','å'=>'a','æ'=>'ae',
        );
        return strtr( $s, $map );
    }

    /**
     * Build duplicate clusters from a list of records [ ['id'=>, 'name'=>], … ].
     * Returns clusters (each an array of records, size >= 2) tagged with a
     * `method` (exact|fuzzy) and `confidence` heuristic.
     *
     * @param float $threshold similarity 0–1 for fuzzy matching (default 0.86)
     */
    public static function build_clusters( array $records, $threshold = 0.86 ) {
        // 1) Group by exact normalised key.
        $by_key = array();
        foreach ( $records as $r ) {
            $key = self::normalise( $r['name'] );
            if ( $key === '' ) continue;
            $r['_key'] = $key;
            $by_key[ $key ][] = $r;
        }

        // 2) Fuzzy-link distinct keys within the same first-character block.
        $keys = array_keys( $by_key );
        $parent = array();
        foreach ( $keys as $k ) $parent[ $k ] = $k;
        $find = function( $x ) use ( &$parent, &$find ) {
            while ( $parent[ $x ] !== $x ) { $parent[ $x ] = $parent[ $parent[ $x ] ]; $x = $parent[ $x ]; }
            return $x;
        };
        $union = function( $a, $b ) use ( &$parent, $find ) { $parent[ $find( $a ) ] = $find( $b ); };

        $blocks = array();
        foreach ( $keys as $k ) { $blocks[ substr( $k, 0, 1 ) ][] = $k; }
        foreach ( $blocks as $bucket ) {
            $n = count( $bucket );
            for ( $i = 0; $i < $n; $i++ ) {
                for ( $j = $i + 1; $j < $n; $j++ ) {
                    if ( self::similar( $bucket[ $i ], $bucket[ $j ] ) >= $threshold ) {
                        $union( $bucket[ $i ], $bucket[ $j ] );
                    }
                }
            }
        }

        // 3) Collect members by union-find root.
        $groups = array();
        foreach ( $keys as $k ) {
            $root = $find( $k );
            foreach ( $by_key[ $k ] as $rec ) $groups[ $root ][] = $rec;
        }

        // 4) Keep clusters with >1 member; tag method/confidence.
        $clusters = array();
        foreach ( $groups as $members ) {
            if ( count( $members ) < 2 ) continue;
            $distinct_keys = count( array_unique( array_map( fn( $m ) => $m['_key'], $members ) ) );
            $method     = $distinct_keys === 1 ? 'exact' : 'fuzzy';
            $confidence = $method === 'exact' ? 0.99 : 0.8;
            $clusters[] = array(
                'method'     => $method,
                'confidence' => $confidence,
                'members'    => array_map( fn( $m ) => array( 'id' => $m['id'], 'name' => $m['name'] ), $members ),
            );
        }
        return $clusters;
    }

    /** Normalised similarity 0–1 (edit-distance based). */
    public static function similar( $a, $b ) {
        if ( $a === $b ) return 1.0;
        $len = max( strlen( $a ), strlen( $b ) );
        if ( $len === 0 ) return 0.0;
        // One contained in the other (e.g. selfbuild ⊂ selfbuilddesign): partial credit.
        if ( strpos( $a, $b ) !== false || strpos( $b, $a ) !== false ) {
            return min( strlen( $a ), strlen( $b ) ) / $len;
        }
        if ( $len > 40 ) return 0.0; // levenshtein() caps at 255; keep it cheap
        $dist = levenshtein( $a, $b );
        return 1.0 - ( $dist / $len );
    }

    // ── WordPress-side operations ─────────────────────────────────────────

    /**
     * Candidate clusters across all live outlets.
     */
    public static function scan_outlets() {
        global $wpdb;
        $rows = $wpdb->get_results(
            "SELECT id, name FROM {$wpdb->prefix}oo_outlets WHERE status != 'merged'",
            ARRAY_A
        );
        return self::build_clusters( $rows );
    }

    /**
     * Merge member outlets into the canonical one: repoint every editorial-log
     * and contact FK, fold member names into the canonical's aliases, and
     * tombstone the members (status=merged, merged_into=canonical).
     */
    public static function merge_outlets( $canonical_id, array $member_ids ) {
        global $wpdb;
        $canonical_id = (int) $canonical_id;
        $member_ids   = array_values( array_filter( array_map( 'intval', $member_ids ), fn( $id ) => $id && $id !== $canonical_id ) );
        if ( ! $canonical_id || ! $member_ids ) return 0;

        $log_t = $wpdb->prefix . 'oo_editorial_log';
        $con_t = $wpdb->prefix . 'oo_contacts';
        $out_t = $wpdb->prefix . 'oo_outlets';

        // Gather existing canonical aliases.
        $canon       = $wpdb->get_row( $wpdb->prepare( "SELECT name, aliases FROM {$out_t} WHERE id = %d", $canonical_id ), ARRAY_A );
        if ( ! $canon ) return 0;
        $aliases     = json_decode( $canon['aliases'] ?? '[]', true );
        if ( ! is_array( $aliases ) ) $aliases = array();

        foreach ( $member_ids as $mid ) {
            $member = $wpdb->get_row( $wpdb->prepare( "SELECT name, aliases FROM {$out_t} WHERE id = %d", $mid ), ARRAY_A );
            if ( ! $member ) continue;

            $wpdb->update( $log_t, array( 'outlet_id' => $canonical_id ), array( 'outlet_id' => $mid ) );
            $wpdb->update( $con_t, array( 'outlet_id' => $canonical_id ), array( 'outlet_id' => $mid ) );

            $aliases[] = $member['name'];
            $member_aliases = json_decode( $member['aliases'] ?? '[]', true );
            if ( is_array( $member_aliases ) ) $aliases = array_merge( $aliases, $member_aliases );

            $wpdb->update( $out_t, array( 'status' => 'merged', 'merged_into' => $canonical_id ), array( 'id' => $mid ) );
        }

        // Persist unique aliases (excluding the canonical's own name).
        $aliases = array_values( array_unique( array_filter( array_map( 'trim', $aliases ), fn( $a ) => $a !== '' && $a !== $canon['name'] ) ) );
        $wpdb->update( $out_t, array( 'aliases' => wp_json_encode( $aliases ) ), array( 'id' => $canonical_id ) );

        return count( $member_ids );
    }

    /**
     * Alias-aware find-or-create — the duplicate guard used by every importer.
     * Resolves to an existing outlet by exact name, by stored alias, or by
     * normalised-key match before creating a new one. Returns the outlet id.
     */
    public static function resolve_outlet( $name ) {
        global $wpdb;
        $name = trim( (string) $name );
        if ( $name === '' ) return 0;
        $out_t = $wpdb->prefix . 'oo_outlets';

        // 1) Exact (live) name.
        $id = (int) $wpdb->get_var( $wpdb->prepare(
            "SELECT id FROM {$out_t} WHERE name = %s AND status != 'merged' LIMIT 1", $name
        ) );
        if ( $id ) return $id;

        // 2) Stored alias contains this exact name.
        $id = (int) $wpdb->get_var( $wpdb->prepare(
            "SELECT id FROM {$out_t} WHERE status != 'merged' AND aliases LIKE %s LIMIT 1",
            '%' . $wpdb->esc_like( '"' . $name . '"' ) . '%'
        ) );
        if ( $id ) return $id;

        // 3) Normalised-key match against existing live outlets.
        $key = self::normalise( $name );
        if ( $key !== '' ) {
            $rows = $wpdb->get_results( "SELECT id, name FROM {$out_t} WHERE status != 'merged'", ARRAY_A );
            foreach ( $rows as $r ) {
                if ( self::normalise( $r['name'] ) === $key ) return (int) $r['id'];
            }
        }

        // 4) Create.
        $wpdb->insert( $out_t, array(
            'name'           => sanitize_text_field( $name ),
            'canonical_name' => sanitize_text_field( $name ),
            'status'         => self::is_do_not_use( $name ) ? 'do_not_use' : 'active',
        ) );
        return (int) $wpdb->insert_id;
    }
}
