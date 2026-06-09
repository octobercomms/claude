<?php
/**
 * Public client portal — a token-gated, front-end view of a client's coverage.
 *
 * Reachable at /?oo_pr=<token> with no login. Shows Published + the positive
 * pipeline only (OO_Database::get_client_visible_statuses) and NEVER the
 * internal notes/outcome or declined pitches. Also serves a CSV download.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class OO_Portal {

    public static function init() {
        add_action( 'template_redirect', array( __CLASS__, 'maybe_render' ) );
    }

    public static function portal_url( $token ) {
        return home_url( '/?oo_pr=' . rawurlencode( $token ) );
    }

    public static function review_url( $token ) {
        return home_url( '/?oo_pr_review=' . rawurlencode( $token ) );
    }

    /** Public press-release approval page (token-gated, no login). */
    private static function render_review( $token ) {
        global $wpdb;
        if ( $token === '' ) { status_header( 404 ); self::shell( 'Not found', '<p>Invalid link.</p>' ); return; }
        $pr = $wpdb->get_row( $wpdb->prepare(
            "SELECT * FROM {$wpdb->prefix}oo_press_releases WHERE review_token = %s", $token
        ) );
        if ( ! $pr ) { status_header( 404 ); self::shell( 'Not found', '<p>This approval link is invalid or has expired.</p>' ); return; }

        // Handle approval submit (the token is the authorisation).
        if ( ! empty( $_POST['oo_approve'] ) ) {
            $by = sanitize_text_field( wp_unslash( $_POST['approver'] ?? '' ) ) ?: 'Client';
            $wpdb->update( $wpdb->prefix . 'oo_press_releases', array(
                'status'      => 'approved',
                'approved_at' => current_time( 'mysql' ),
                'approved_by' => $by,
            ), array( 'id' => $pr->id ) );
            $pr->status = 'approved';
        }

        $approved = ( $pr->status === 'approved' || $pr->status === 'sent' );
        ob_start();
        echo '<div class="oo-pr-head"><h1>' . esc_html( $pr->title ) . '</h1>';
        echo '<p class="oo-pr-sub">' . ( $pr->client ? esc_html( $pr->client ) . ' · ' : '' ) . 'Press release for approval</p></div>';
        echo '<div style="font-size:15px">' . wp_kses_post( $pr->body_html ?: '<p><em>Draft not written yet.</em></p>' ) . '</div>';
        echo '<hr style="margin:22px 0;border:none;border-top:1px solid #e5e7eb">';
        if ( $approved ) {
            echo '<p class="oo-pr-badge is-pub" style="display:inline-block">✓ Approved' . ( $pr->approved_by ? ' by ' . esc_html( $pr->approved_by ) : '' ) . '</p>';
        } else {
            echo '<form method="post" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">';
            echo '<input type="text" name="approver" placeholder="Your name" style="padding:8px 12px;border:1px solid #d1d5db;border-radius:8px">';
            echo '<button type="submit" name="oo_approve" value="1" style="background:#166534;color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:15px">Approve this release</button>';
            echo '</form><p class="oo-pr-empty" style="font-size:13px;margin-top:10px">Spotted something? Reply to the email this link came from and we\'ll revise it.</p>';
        }
        self::shell( esc_html( $pr->title ) . ' — Approval', ob_get_clean() );
    }

    public static function maybe_render() {
        if ( ! empty( $_GET['oo_pr_review'] ) ) {
            self::render_review( sanitize_text_field( wp_unslash( $_GET['oo_pr_review'] ) ) );
            exit;
        }
        if ( empty( $_GET['oo_pr'] ) ) return;
        $token = sanitize_text_field( wp_unslash( $_GET['oo_pr'] ) );

        global $wpdb;
        $client = $wpdb->get_row( $wpdb->prepare(
            "SELECT * FROM {$wpdb->prefix}oo_clients WHERE token = %s", $token
        ) );
        if ( ! $client ) {
            status_header( 404 );
            self::shell( 'Not found', '<p>This coverage link is invalid or has expired.</p>' );
            exit;
        }

        $statuses = OO_Database::get_client_visible_statuses();
        $keys     = array_keys( $statuses );
        $ph       = implode( ',', array_fill( 0, count( $keys ), '%s' ) );
        $rows = $wpdb->get_results( $wpdb->prepare(
            "SELECT l.story_title, l.status, l.country, l.issue_date, l.story_url,
                    o.name AS outlet, c.first_name, c.last_name
             FROM {$wpdb->prefix}oo_editorial_log l
             LEFT JOIN {$wpdb->prefix}oo_outlets o ON o.id = l.outlet_id
             LEFT JOIN {$wpdb->prefix}oo_contacts c ON c.id = l.contact_id
             WHERE l.client = %s AND l.status IN ($ph)
             ORDER BY ( l.status = 'published' ) DESC, COALESCE( l.issue_date, l.request_date ) DESC, l.id DESC",
            array_merge( array( $client->name ), $keys )
        ) );

        if ( isset( $_GET['download'] ) ) {
            self::download_csv( $client, $rows, $statuses );
            exit;
        }
        self::render_report( $client, $rows, $statuses );
        exit;
    }

    private static function download_csv( $client, $rows, $statuses ) {
        nocache_headers();
        header( 'Content-Type: text/csv; charset=utf-8' );
        header( 'Content-Disposition: attachment; filename="coverage-' . sanitize_title( $client->name ) . '-' . date( 'Y-m-d' ) . '.csv"' );
        $out = fopen( 'php://output', 'w' );
        fputcsv( $out, array( 'Publication', 'Journalist', 'Country', 'Status', 'Issue Date', 'Link' ) );
        foreach ( $rows as $r ) {
            fputcsv( $out, array(
                $r->outlet ?: '',
                trim( ( $r->first_name ?? '' ) . ' ' . ( $r->last_name ?? '' ) ),
                $r->country ?: '',
                $statuses[ $r->status ] ?? $r->status,
                $r->issue_date ?: '',
                $r->story_url ?: '',
            ) );
        }
        fclose( $out );
    }

    private static function render_report( $client, $rows, $statuses ) {
        $published = 0;
        foreach ( $rows as $r ) { if ( in_array( $r->status, array( 'published', 'download' ), true ) ) $published++; }

        ob_start();
        ?>
        <div class="oo-pr-head">
            <h1><?php echo esc_html( $client->name ); ?></h1>
            <p class="oo-pr-sub">Press coverage report · <?php echo esc_html( date( 'd M Y' ) ); ?></p>
            <div class="oo-pr-stats">
                <span><strong><?php echo (int) $published; ?></strong> published</span>
                <span><strong><?php echo count( $rows ); ?></strong> total tracked</span>
            </div>
            <a class="oo-pr-dl" href="<?php echo esc_url( add_query_arg( 'download', '1' ) ); ?>">↓ Download CSV</a>
        </div>
        <?php if ( $rows ) : ?>
        <table class="oo-pr-table">
            <thead><tr><th>Publication</th><th>Journalist</th><th>Country</th><th>Status</th><th>Date</th><th></th></tr></thead>
            <tbody>
            <?php foreach ( $rows as $r ) :
                $name = trim( ( $r->first_name ?? '' ) . ' ' . ( $r->last_name ?? '' ) );
                $pub  = in_array( $r->status, array( 'published', 'download' ), true );
            ?>
            <tr>
                <td><strong><?php echo esc_html( $r->outlet ?: '—' ); ?></strong></td>
                <td><?php echo esc_html( $name ?: '—' ); ?></td>
                <td><?php echo esc_html( $r->country ?: '' ); ?></td>
                <td><span class="oo-pr-badge <?php echo $pub ? 'is-pub' : 'is-pipe'; ?>"><?php echo esc_html( $statuses[ $r->status ] ?? $r->status ); ?></span></td>
                <td><?php echo $r->issue_date ? esc_html( date( 'd M Y', strtotime( $r->issue_date ) ) ) : ''; ?></td>
                <td><?php echo $r->story_url ? '<a href="' . esc_url( $r->story_url ) . '" target="_blank" rel="noopener">Read →</a>' : ''; ?></td>
            </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
        <?php else : ?>
        <p class="oo-pr-empty">No coverage to show yet — check back soon.</p>
        <?php endif; ?>
        <?php
        self::shell( esc_html( $client->name ) . ' — Coverage', ob_get_clean() );
    }

    /** Render a standalone, theme-free HTML page (clean for clients & printing). */
    private static function shell( $title, $body ) {
        ?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title><?php echo esc_html( $title ); ?></title>
<style>
:root{--ink:#111;--muted:#6b7280;--line:#e5e7eb;--accent:#111}
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);margin:0;background:#f7f7f8;line-height:1.5}
.oo-pr-wrap{max-width:920px;margin:0 auto;padding:40px 20px}
.oo-pr-card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:28px 28px 8px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.oo-pr-head h1{margin:0 0 2px;font-size:26px}
.oo-pr-sub{margin:0 0 14px;color:var(--muted);font-size:14px}
.oo-pr-stats{display:flex;gap:18px;margin-bottom:14px;font-size:14px;color:var(--muted)}
.oo-pr-stats strong{color:var(--ink);font-size:18px}
.oo-pr-dl{display:inline-block;font-size:13px;color:var(--accent);text-decoration:none;border:1px solid var(--line);padding:6px 12px;border-radius:8px;margin-bottom:18px}
.oo-pr-table{width:100%;border-collapse:collapse;font-size:14px}
.oo-pr-table th{text-align:left;color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.03em;padding:8px 10px;border-bottom:2px solid var(--line)}
.oo-pr-table td{padding:10px;border-bottom:1px solid var(--line);vertical-align:top}
.oo-pr-table a{color:var(--accent)}
.oo-pr-badge{font-size:12px;padding:2px 8px;border-radius:20px;white-space:nowrap}
.oo-pr-badge.is-pub{background:#dcfce7;color:#166534}
.oo-pr-badge.is-pipe{background:#eef2ff;color:#3730a3}
.oo-pr-empty{color:var(--muted);padding:20px 0}
.oo-pr-foot{text-align:center;color:var(--muted);font-size:12px;margin-top:18px}
@media print{body{background:#fff}.oo-pr-card{border:none;box-shadow:none}.oo-pr-dl{display:none}}
</style>
</head>
<body>
<div class="oo-pr-wrap">
  <div class="oo-pr-card">
    <?php echo $body; // already escaped above ?>
  </div>
  <p class="oo-pr-foot">Coverage tracked by October Comms.</p>
</div>
</body>
</html><?php
    }
}
