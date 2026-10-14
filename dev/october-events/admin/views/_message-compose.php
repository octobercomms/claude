<?php
/**
 * Shared "Message attendees" compose form — used by the Tickets slide-in and
 * the standalone message screen. Emails everyone registered for one event;
 * sends only on click (never auto-send). Posts to oe_event_broadcast.
 *
 * @var array       $events    [['id','title','count'], …] ticketed events + counts
 * @var array|false $result    flash result from a send/test (with 'draft')
 * @var int         $selected  pre-selected event id
 */
defined('ABSPATH') || exit;
$selected = isset($selected) ? (int) $selected : (isset($_GET['event']) ? absint($_GET['event']) : 0); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
?>
<p class="description" style="max-width:820px"><?php esc_html_e('Email everyone registered for an event — a change of venue, an added tour location, or any update. It goes to each registration’s email once; canceled and refunded orders are excluded.', 'october-events'); ?></p>

<?php if (is_array($result)) :
    if (isset($result['error'])) : ?>
        <div class="notice notice-error is-dismissible inline"><p><?php echo esc_html($result['error']); ?></p></div>
    <?php elseif (! empty($result['test'])) : ?>
        <div class="notice notice-success is-dismissible inline"><p><?php echo esc_html(sprintf(__('Test sent: %1$d delivered, %2$d failed.', 'october-events'), (int) $result['sent'], (int) $result['failed'])); ?></p></div>
    <?php else : ?>
        <div class="notice notice-success is-dismissible inline"><p><?php echo esc_html(sprintf(__('Message sent to %1$d registrations (%2$d failed) for “%3$s”.', 'october-events'), (int) $result['sent'], (int) $result['failed'], (string) ($result['event'] ?? ''))); ?></p></div>
    <?php endif;
endif; ?>

<?php if (! $events) : ?>
    <div class="notice notice-info inline"><p><?php esc_html_e('No ticketed events yet. Add ticket types to an event and it’ll appear here once it has registrations.', 'october-events'); ?></p></div>
<?php else :
    $draft = (is_array($result) && ! empty($result['draft']) && is_array($result['draft'])) ? $result['draft'] : [];
    ?>
    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="display:grid;gap:12px" id="oe-evt-msg-form">
        <input type="hidden" name="action" value="oe_event_broadcast">
        <input type="hidden" name="_wp_http_referer" value="<?php echo esc_attr(admin_url('admin.php?page=oe-tickets')); ?>">
        <?php wp_nonce_field('oe_event_broadcast'); ?>
        <label><?php esc_html_e('Event', 'october-events'); ?>
            <select name="event_id" id="oe-evt-select" required style="width:100%">
                <option value="0"><?php esc_html_e('— choose an event —', 'october-events'); ?></option>
                <?php foreach ($events as $e) : ?>
                    <option value="<?php echo (int) $e['id']; ?>" data-count="<?php echo (int) $e['count']; ?>" <?php selected($selected, (int) $e['id']); ?>>
                        <?php echo esc_html(sprintf(_n('%1$s (%2$d registered)', '%1$s (%2$d registered)', (int) $e['count'], 'october-events'), $e['title'], (int) $e['count'])); ?>
                    </option>
                <?php endforeach; ?>
            </select>
            <span class="description" id="oe-evt-count"></span>
        </label>
        <label><?php esc_html_e('Subject', 'october-events'); ?>
            <input type="text" name="subject" id="oe-evt-subject" style="width:100%" value="<?php echo esc_attr((string) ($draft['subject'] ?? '')); ?>" required></label>
        <label><?php esc_html_e('Message', 'october-events'); ?>
            <textarea name="body" id="oe-evt-body" rows="9" style="width:100%" required><?php echo esc_textarea((string) ($draft['body'] ?? '')); ?></textarea>
            <span class="description"><?php esc_html_e('Plain text; line breaks kept. Merge tags: {name}, {event}. Wrapped in your brand template.', 'october-events'); ?></span></label>
        <label><?php esc_html_e('Send a test first', 'october-events'); ?>
            <span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <input type="email" name="test_to" id="oe-evt-test" placeholder="you@example.com" value="<?php echo esc_attr((string) ($draft['test_to'] ?? '')); ?>" style="flex:1;min-width:180px">
                <button type="submit" class="button" name="oe_do" value="test"><?php esc_html_e('Send test', 'october-events'); ?></button>
            </span></label>
        <p style="margin:0"><button type="submit" class="button button-primary" name="oe_do" value="send" id="oe-evt-send"><?php esc_html_e('Send to all registrations', 'october-events'); ?></button></p>
    </form>
    <script>
    (function () {
        var sel = document.getElementById('oe-evt-select'), out = document.getElementById('oe-evt-count'),
            form = document.getElementById('oe-evt-msg-form'), sendBtn = document.getElementById('oe-evt-send');
        if (!sel || !form) { return; }
        function count(){ var o = sel.options[sel.selectedIndex]; return o ? parseInt(o.getAttribute('data-count') || '0', 10) : 0; }
        function refresh(){ var n = count(); out.textContent = (sel.value !== '0' && sel.value !== '') ? (<?php echo wp_json_encode(__('This message will go to', 'october-events')); ?> + ' ' + n + ' ' + (n === 1 ? <?php echo wp_json_encode(__('person.', 'october-events')); ?> : <?php echo wp_json_encode(__('people.', 'october-events')); ?>)) : ''; }
        sel.addEventListener('change', refresh); refresh();
        form.addEventListener('submit', function (e) {
            var submitter = e.submitter || document.activeElement;
            if (submitter !== sendBtn) { return; }
            if (sel.value === '0' || sel.value === '') { return; }
            var msg = <?php echo wp_json_encode(__('Send this message to', 'october-events')); ?> + ' ' + count() + ' ' + <?php echo wp_json_encode(__('registered attendees? This cannot be undone.', 'october-events')); ?>;
            if (! window.confirm(msg)) { e.preventDefault(); }
        });
    })();
    </script>
<?php endif; ?>
