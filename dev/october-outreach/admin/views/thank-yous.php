<?php if ( ! defined( 'ABSPATH' ) ) exit;

global $wpdb;
$log_t  = $wpdb->prefix . 'oo_editorial_log';
$out_t  = $wpdb->prefix . 'oo_outlets';
$con_t  = $wpdb->prefix . 'oo_contacts';
$snt_t  = $wpdb->prefix . 'oo_sent_thanks';
$fb_t   = $wpdb->prefix . 'oo_thank_feedback';

// Opportunities: published pieces with a linked journalist who has a real
// email, that we haven't already thanked for or explicitly skipped.
$rows = $wpdb->get_results(
    "SELECT l.id, l.story_title, l.story_url, l.client, l.issue_date,
            o.name AS outlet, c.first_name, c.last_name, c.email
     FROM {$log_t} l
     JOIN {$con_t} c ON c.id = l.contact_id
     LEFT JOIN {$out_t} o ON o.id = l.outlet_id
     WHERE l.status IN ('published','download')
       AND c.email <> '' AND c.email NOT LIKE '%@import.local'
       AND NOT EXISTS ( SELECT 1 FROM {$snt_t} s WHERE s.editorial_log_id = l.id )
       AND NOT EXISTS ( SELECT 1 FROM {$fb_t} f WHERE f.editorial_log_id = l.id AND f.decision = 'rejected' )
     ORDER BY COALESCE(l.issue_date, l.created_at) DESC
     LIMIT 100"
);
$sent_total = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$snt_t}" );
$from_set   = ! empty( get_option( 'oo_settings', array() )['default_reply_to'] );
?>

<div class="oo-page-header">
    <h1 class="oo-page-title">Thank-yous</h1>
    <span class="oo-muted" style="align-self:center;font-size:13px"><?php echo number_format( $sent_total ); ?> sent all-time</span>
</div>

<div id="oo-thanks-notice" class="oo-notice" style="display:none"></div>

<?php if ( ! $from_set ) : ?>
<div class="oo-notice oo-notice-warning">Set a <strong>Default Reply-To</strong> address in Settings — thank-yous send from there (so replies reach you).</div>
<?php endif; ?>

<p class="oo-muted" style="margin-bottom:14px">Published coverage with a known journalist email, not yet thanked. Claude drafts a fresh note each time (never the same one twice to the same journalist) — review, edit if you like, and send. This is the assisted stage; auto-send comes later.</p>

<?php if ( $rows ) : ?>
<div id="oo-thanks-list">
    <?php foreach ( $rows as $r ) :
        $name = trim( $r->first_name . ' ' . $r->last_name );
    ?>
    <div class="oo-card oo-thank-row" data-id="<?php echo esc_attr( $r->id ); ?>" style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
            <div>
                <strong><?php echo esc_html( $name ); ?></strong>
                <span class="oo-muted">· <?php echo esc_html( $r->outlet ?: '—' ); ?><?php echo $r->client ? ' · ' . esc_html( $r->client ) : ''; ?></span>
                <div class="oo-muted" style="font-size:13px;margin-top:2px">
                    <?php echo $r->story_url ? '<a href="' . esc_url( $r->story_url ) . '" target="_blank" rel="noopener">' . esc_html( wp_trim_words( $r->story_title ?: 'View story', 10 ) ) . '</a>' : esc_html( $r->story_title ?: '' ); ?>
                    <?php echo $r->issue_date ? ' · ' . esc_html( date( 'd M Y', strtotime( $r->issue_date ) ) ) : ''; ?>
                </div>
            </div>
            <div class="oo-thank-actions" style="display:flex;gap:8px">
                <button class="oo-btn oo-btn-primary oo-btn-sm oo-thank-draft">
                    <span class="oo-btn-text">✍️ Draft thank-you</span>
                    <span class="oo-btn-loading" style="display:none">Writing…</span>
                </button>
                <button class="oo-btn oo-btn-secondary oo-btn-sm oo-thank-skip">Skip</button>
            </div>
        </div>
        <div class="oo-thank-editor" style="display:none;margin-top:12px;border-top:1px solid var(--oo-border,#e5e7eb);padding-top:12px">
            <div class="oo-field" style="margin:0 0 8px">
                <label class="oo-label">Subject</label>
                <input type="text" class="oo-input oo-thank-subject">
            </div>
            <div class="oo-field" style="margin:0 0 8px">
                <label class="oo-label">Message <span class="oo-muted" style="font-weight:400">— edit freely before sending</span></label>
                <textarea class="oo-textarea oo-thank-body" rows="6"></textarea>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
                <button class="oo-btn oo-btn-primary oo-btn-sm oo-thank-send">
                    <span class="oo-btn-text">Send thank-you</span>
                    <span class="oo-btn-loading" style="display:none">Sending…</span>
                </button>
                <button class="oo-btn oo-btn-secondary oo-btn-sm oo-thank-regen">Re-draft</button>
                <span class="oo-muted oo-thank-tone" style="font-size:12px"></span>
            </div>
        </div>
    </div>
    <?php endforeach; ?>
</div>
<?php else : ?>
<div class="oo-card"><div class="oo-empty-state">
    <h3>No thank-yous waiting</h3>
    <p>When a published piece is logged against a journalist who has an email on file, it'll appear here ready to thank.</p>
</div></div>
<?php endif; ?>
