<?php
/**
 * "Message attendees" screen: send an email to everyone registered for one
 * event — a change of venue, an added tour location, any announcement.
 *
 * @var array $events  [['id'=>int,'title'=>string,'count'=>int], …] ticketed events + counts
 * @var array|false $result  Flash result from a send/test.
 */

defined('ABSPATH') || exit;

$selected = isset($_GET['event']) ? absint($_GET['event']) : 0;
?>
<div class="wrap">
    <h1><?php esc_html_e('October Events', 'october-events'); ?></h1>
    <?php \OE\Admin\Admin::tickets_tabs('message'); ?>

    <h2 style="margin-top:18px"><?php esc_html_e('Message attendees', 'october-events'); ?></h2>
    <p class="description" style="max-width:820px"><?php esc_html_e('Email everyone registered for an event — a change of venue, an added tour location, or any update. It goes to each registration’s email address, once per person. Cancelled and refunded orders are excluded.', 'october-events'); ?></p>

    <?php if (is_array($result)) :
        if (isset($result['error'])) : ?>
            <div class="notice notice-error is-dismissible"><p><?php echo esc_html($result['error']); ?></p></div>
        <?php elseif (! empty($result['test'])) : ?>
            <div class="notice notice-success is-dismissible"><p><?php echo esc_html(sprintf(
                /* translators: 1: sent, 2: failed */
                __('Test sent: %1$d delivered, %2$d failed.', 'october-events'),
                (int) $result['sent'], (int) $result['failed']
            )); ?></p></div>
        <?php else : ?>
            <div class="notice notice-success is-dismissible"><p><?php echo esc_html(sprintf(
                /* translators: 1: sent, 2: failed, 3: event */
                __('Message sent to %1$d registrations (%2$d failed) for “%3$s”.', 'october-events'),
                (int) $result['sent'], (int) $result['failed'], (string) ($result['event'] ?? '')
            )); ?></p></div>
        <?php endif;
    endif; ?>

    <?php if (! $events) : ?>
        <div class="notice notice-info inline"><p><?php esc_html_e('No ticketed events yet. Add ticket types to an event and it’ll appear here once it has registrations.', 'october-events'); ?></p></div>
    <?php else : ?>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="max-width:720px;margin-top:14px" id="oe-evt-msg-form">
            <input type="hidden" name="action" value="oe_event_broadcast">
            <?php wp_nonce_field('oe_event_broadcast'); ?>

            <table class="form-table" role="presentation"><tbody>
                <tr>
                    <th scope="row"><label for="oe-evt-select"><?php esc_html_e('Event', 'october-events'); ?></label></th>
                    <td>
                        <select name="event_id" id="oe-evt-select" required>
                            <option value="0"><?php esc_html_e('— choose an event —', 'october-events'); ?></option>
                            <?php foreach ($events as $e) : ?>
                                <option value="<?php echo (int) $e['id']; ?>" data-count="<?php echo (int) $e['count']; ?>" <?php selected($selected, (int) $e['id']); ?>>
                                    <?php echo esc_html(sprintf(
                                        /* translators: 1: event title, 2: registration count */
                                        _n('%1$s (%2$d registered)', '%1$s (%2$d registered)', (int) $e['count'], 'october-events'),
                                        $e['title'], (int) $e['count']
                                    )); ?>
                                </option>
                            <?php endforeach; ?>
                        </select>
                        <p class="description" id="oe-evt-count"></p>
                    </td>
                </tr>
                <tr>
                    <th scope="row"><label for="oe-evt-subject"><?php esc_html_e('Subject', 'october-events'); ?></label></th>
                    <td><input type="text" name="subject" id="oe-evt-subject" class="regular-text" style="width:100%" required></td>
                </tr>
                <tr>
                    <th scope="row"><label for="oe-evt-body"><?php esc_html_e('Message', 'october-events'); ?></label></th>
                    <td>
                        <textarea name="body" id="oe-evt-body" rows="10" class="large-text" required></textarea>
                        <p class="description"><?php esc_html_e('Plain text — line breaks are kept. Merge tags: {name} (the attendee), {event} (the event title). It’s wrapped in your brand email template automatically.', 'october-events'); ?></p>
                    </td>
                </tr>
                <tr>
                    <th scope="row"><label for="oe-evt-test"><?php esc_html_e('Send a test first', 'october-events'); ?></label></th>
                    <td>
                        <input type="email" name="test_to" id="oe-evt-test" class="regular-text" placeholder="you@example.com">
                        <button type="submit" class="button" name="oe_do" value="test"><?php esc_html_e('Send test', 'october-events'); ?></button>
                        <p class="description"><?php esc_html_e('Sends only to this address, with sample merge values, so you can check it before the real send.', 'october-events'); ?></p>
                    </td>
                </tr>
            </tbody></table>

            <p>
                <button type="submit" class="button button-primary" name="oe_do" value="send" id="oe-evt-send"><?php esc_html_e('Send to all registrations', 'october-events'); ?></button>
            </p>
        </form>

        <script>
        (function () {
            var sel = document.getElementById('oe-evt-select'),
                out = document.getElementById('oe-evt-count'),
                form = document.getElementById('oe-evt-msg-form'),
                sendBtn = document.getElementById('oe-evt-send');
            function count() {
                var o = sel.options[sel.selectedIndex];
                return o ? parseInt(o.getAttribute('data-count') || '0', 10) : 0;
            }
            function refresh() {
                var n = count();
                out.textContent = sel.value !== '0' && sel.value !== ''
                    ? (<?php echo wp_json_encode(__('This message will go to', 'october-events')); ?> + ' ' + n + ' ' + (n === 1 ? <?php echo wp_json_encode(__('person.', 'october-events')); ?> : <?php echo wp_json_encode(__('people.', 'october-events')); ?>))
                    : '';
            }
            sel.addEventListener('change', refresh);
            refresh();
            // Confirm the real send (the test button skips this). Use the
            // submit event's submitter — document.activeElement is unreliable
            // because Safari and Firefox don't focus a button on click, which
            // would silently skip this confirmation for the destructive send.
            form.addEventListener('submit', function (e) {
                var submitter = e.submitter || document.activeElement;
                if (submitter !== sendBtn) { return; }
                var n = count();
                if (sel.value === '0' || sel.value === '') { return; }
                var msg = <?php echo wp_json_encode(__('Send this message to', 'october-events')); ?> + ' ' + n + ' ' +
                    <?php echo wp_json_encode(__('registered attendees? This cannot be undone.', 'october-events')); ?>;
                if (! window.confirm(msg)) { e.preventDefault(); }
            });
        })();
        </script>
    <?php endif; ?>
</div>
