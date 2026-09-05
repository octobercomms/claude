<?php
declare(strict_types=1);

namespace OE;


defined('ABSPATH') || exit;

/**
 * Volunteer opportunities + signups.
 *
 * Mirrors how the festival actually works (and how events work): each
 * `volunteer` CPT post is an OPPORTUNITY listing (e.g. "Blueprints & BBQ —
 * Meet & Greet Host") carrying a role, location and a set of time SHIFTS, each
 * with a fixed slot capacity. People sign up to one or more shifts; bookings
 * live in the {@see VolunteerSignups} table and capacity is enforced per shift.
 *
 * ADF now owns this end-to-end (replacing the Sign-up Sheets plugin). Confirmed
 * signups drive email + SMS reminders via {@see Reminders} to cut no-shows.
 */
final class Volunteers {

    public const ROLES = ['front_of_house', 'setup_breakdown', 'registration', 'tour_guide', 'general', 'other'];

    public static function slug(): string {
        return PostTypes::slug('volunteer'); // adopted `volunteer` CPT
    }

    /**
     * The configured "locations" post type (tour stops/homes), or '' if none set
     * or it doesn't exist. When set, each location gets a one-click "Needs
     * volunteers" box that creates/links an opportunity.
     */
    public static function location_post_type(): string {
        $pt = (string) Settings::get('location_post_type', '');
        return ($pt !== '' && post_type_exists($pt)) ? $pt : '';
    }

    public function init(): void {
        add_action('init', [$this, 'register_meta'], 30);

        // Whole module can be switched off per-site (Settings → Features).
        if (! Features::enabled('volunteers')) {
            return;
        }
        // Front-end signup widget for the opportunity page (hybrid: Elementor
        // renders the listing, this shortcode provides the signup table).
        add_shortcode('oe_volunteer_signup', [$this, 'render_signup_widget']);
        // Surfaces an event's linked volunteer opportunities on its public page.
        add_shortcode('oe_event_volunteers', [$this, 'render_event_volunteers']);
        // Lists all location-linked volunteer opportunities (local or pulled from a
        // partner tours site) — put on the festival page that hosts sign-ups.
        add_shortcode('oe_location_volunteers', [$this, 'render_location_volunteers']);

        // Daily pull of a partner volunteer feed (no-op unless configured).
        add_action(\OE\Cron::HOOK_DAILY, [self::class, 'sync_partner_feed']);

        if (is_admin()) {
            add_action('add_meta_boxes', [$this, 'add_meta_box']);
            add_action('add_meta_boxes', [$this, 'add_event_meta_box']);
            add_action('save_post_' . self::slug(), [$this, 'save_meta']);
            // Manual "refresh tour locations" button in the volunteer editor.
            add_action('wp_ajax_oe_refresh_partner_locs', [self::class, 'ajax_refresh_partner_locs']);

            // One-click "Needs volunteers" on each tour location. Always hook —
            // the callbacks resolve the configured location post type at
            // admin-load/save time, because CPTs (e.g. the JetEngine "location"
            // type) aren't registered yet at plugins_loaded, when this init runs.
            add_action('add_meta_boxes', [$this, 'add_location_meta_box']);
            add_action('save_post', [$this, 'save_location_meta'], 20, 2);
        }
    }

    /* ------------------------------------------------------------------ *
     * Admin: shift editor meta box on the volunteer (opportunity) CPT
     * ------------------------------------------------------------------ */

    public function add_meta_box(): void {
        add_meta_box(
            'oe_volunteer_shifts',
            __('ADF — Role, location & shifts', 'october-events'),
            [$this, 'render_meta_box'],
            self::slug(),
            'normal',
            'high'
        );
    }

    public function render_meta_box(\WP_Post $post): void {
        wp_nonce_field('oe_save_volunteer', 'oe_volunteer_nonce');
        $role     = (string) get_post_meta($post->ID, '_oe_role', true);
        $location = (string) get_post_meta($post->ID, '_oe_location', true);
        $open     = get_post_meta($post->ID, '_oe_signups_open', true);
        $open     = ($open === '' || $open === '1') ? 1 : 0;
        // Linked event — default from ?oe_link_event when creating from an event.
        $linked = self::linked_event($post->ID);
        if (! $linked && isset($_GET['oe_link_event'])) {
            $linked = absint($_GET['oe_link_event']);
        }
        $events = get_posts([
            'post_type'      => \OE\PostTypes::slug('event'),
            'post_status'    => ['publish', 'draft', 'pending', 'private'],
            'posts_per_page' => 200,
            'orderby'        => 'title',
            'order'          => 'ASC',
        ]);
        $event_loc = $linked ? (string) \OE\Planning\Events::get($linked, 'location', '') : '';
        $shifts    = self::shifts($post->ID);
        // Tour locations pulled from a partner site — pickable alongside events.
        $feed_locs  = self::feed_locations();
        $linked_ref = (string) get_post_meta($post->ID, '_oe_linked_location_ref', true);
        $feed_host  = (string) Settings::get('volunteer_feed_url', '');
        $feed_label = $feed_host !== '' ? (string) wp_parse_url($feed_host, PHP_URL_HOST) : __('partner site', 'october-events');
        ?>
        <p><label><strong><?php esc_html_e('Linked event or tour location', 'october-events'); ?></strong> — <span class="description"><?php esc_html_e('optional; reuses the location and shows a “Volunteer” call-out on the event/location page', 'october-events'); ?></span><br>
            <select name="oe_linked_event" id="oe-linked-select" class="widefat">
                <option value="0"><?php esc_html_e('— Not linked —', 'october-events'); ?></option>
                <?php if ($events) : ?>
                <optgroup label="<?php esc_attr_e('Events', 'october-events'); ?>">
                    <?php foreach ($events as $ev) : ?>
                        <option value="<?php echo (int) $ev->ID; ?>" <?php selected($linked, (int) $ev->ID); ?>><?php echo esc_html(get_the_title($ev)); ?></option>
                    <?php endforeach; ?>
                </optgroup>
                <?php endif; ?>
                <optgroup id="oe-loc-optgroup" label="<?php echo esc_attr(sprintf(__('Tour locations (%s)', 'october-events'), $feed_label)); ?>">
                    <?php foreach ($feed_locs as $fl) : $rv = 'loc:' . (string) ($fl['ref'] ?? ''); ?>
                        <option value="<?php echo esc_attr($rv); ?>" <?php selected('loc:' . $linked_ref, $rv); ?>><?php echo esc_html((string) ($fl['title'] ?? '')); ?></option>
                    <?php endforeach; ?>
                </optgroup>
            </select></label>
            <button type="button" class="button button-small" id="oe-loc-refresh" style="margin-top:6px"><?php esc_html_e('↻ Refresh tour locations', 'october-events'); ?></button>
            <span class="description" id="oe-loc-refresh-msg" style="margin-left:6px"></span></p>
        <p><label><strong><?php esc_html_e('Role', 'october-events'); ?></strong><br>
            <input type="text" name="oe_role" class="widefat" value="<?php echo esc_attr($role); ?>" placeholder="e.g. Meet &amp; Greet Host"></label></p>
        <p><label><strong><?php esc_html_e('Location', 'october-events'); ?></strong><br>
            <input type="text" name="oe_location" id="oe-location-input" class="widefat" value="<?php echo esc_attr($location); ?>" placeholder="<?php echo $event_loc !== '' ? esc_attr(sprintf(__('Inherits from event: %s', 'october-events'), $event_loc)) : ''; ?>"></label>
            <?php if ($event_loc !== '') : ?><span class="description"><?php esc_html_e('Leave blank to use the linked event\'s location.', 'october-events'); ?></span><?php endif; ?></p>
        <p><label><input type="checkbox" name="oe_signups_open" value="1" <?php checked($open, 1); ?>> <?php esc_html_e('Signups open', 'october-events'); ?></label></p>

        <p><strong><?php esc_html_e('Shifts', 'october-events'); ?></strong></p>
        <table class="widefat" id="oe-shift-table">
            <thead><tr>
                <th><?php esc_html_e('Label', 'october-events'); ?></th>
                <th><?php esc_html_e('Start', 'october-events'); ?></th>
                <th><?php esc_html_e('End', 'october-events'); ?></th>
                <th style="width:80px"><?php esc_html_e('Capacity', 'october-events'); ?></th>
                <th></th>
            </tr></thead>
            <tbody>
            <?php foreach (($shifts ?: [[]]) as $i => $s) { $this->shift_row((int) $i, $s); } ?>
            </tbody>
        </table>
        <p><button type="button" class="button" id="oe-shift-add"><?php esc_html_e('+ Add another shift', 'october-events'); ?></button></p>
        <p class="description"><?php esc_html_e('Capacity is how many volunteers each shift needs. Changing a shift label keeps existing signups attached.', 'october-events'); ?></p>

        <script type="text/html" id="oe-shift-tpl"><?php $this->shift_row(9999, []); ?></script>
        <script>
        (function(){
            // Next shift index = max existing + 1, so rows seeded from a tour date
            // never collide with rows added by hand.
            function nextIdx(){
                var max = -1;
                document.querySelectorAll('#oe-shift-table tbody tr [name^="oe_shift["]').forEach(function(inp){
                    var m = inp.name.match(/oe_shift\[(\d+)\]/); if (m) { max = Math.max(max, parseInt(m[1], 10)); }
                });
                return max + 1;
            }
            document.getElementById('oe-shift-add').addEventListener('click', function(){
                var html = document.getElementById('oe-shift-tpl').innerHTML.replace(/9999/g, nextIdx());
                document.querySelector('#oe-shift-table tbody').insertAdjacentHTML('beforeend', html);
            });
            document.querySelector('#oe-shift-table').addEventListener('click', function(e){
                if (e.target.classList.contains('oe-shift-del')) { e.target.closest('tr').remove(); }
            });
        })();
        </script>
        <script>
        (function(){
            var sel = document.getElementById('oe-linked-select');
            if (!sel) { return; }
            var LOCS = <?php echo wp_json_encode(self::feed_locations()); ?>;
            var ajax = <?php echo wp_json_encode(admin_url('admin-ajax.php')); ?>;
            var nonce = <?php echo wp_json_encode(wp_create_nonce('oe_refresh_partner_locs')); ?>;
            var defaultRole = <?php echo wp_json_encode((string) Settings::get('location_default_role', 'Docent')); ?>;
            var byRef = {};
            function indexLocs(){ byRef = {}; LOCS.forEach(function(l){ byRef['loc:' + l.ref] = l; }); }
            indexLocs();
            var MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
            var ABBR   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            var WDS    = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
            function pad(n){ return (n < 10 ? '0' : '') + n; }
            function t12(hm){ var p = hm.split(':'); var h = parseInt(p[0], 10); var ap = h < 12 ? 'am' : 'pm'; var h12 = (h % 12) || 12; return h12 + ':' + p[1] + ap; }
            // Parse a human tour date ("October 3—4, 2026" or "October 3, 2026")
            // into the individual days it covers.
            function parseDays(str){
                if (!str) { return []; }
                var m = String(str).toLowerCase().match(/([a-z]+)\s+(\d{1,2})(?:\s*[–—-]\s*(\d{1,2}))?,?\s*(\d{4})/);
                if (!m) { return []; }
                var mon = MONTHS.indexOf(m[1]);
                if (mon < 0) { mon = ABBR.findIndex(function(a){ return a.toLowerCase() === m[1].slice(0, 3); }); }
                if (mon < 0) { return []; }
                var d1 = parseInt(m[2], 10), d2 = m[3] ? parseInt(m[3], 10) : d1, y = parseInt(m[4], 10);
                if (d2 < d1) { d2 = d1; }
                var out = [];
                for (var d = d1; d <= d2 && d < d1 + 14; d++) {
                    var dt = new Date(y, mon, d);
                    out.push({ y: y, m: mon + 1, d: d, wd: WDS[dt.getDay()], mon: ABBR[mon] });
                }
                return out;
            }
            // True when no shift row has been filled in yet (safe to auto-seed).
            function tableIsEmpty(){
                var rows = document.querySelectorAll('#oe-shift-table tbody tr');
                for (var i = 0; i < rows.length; i++) {
                    var l = rows[i].querySelector('[name$="[label]"]'), s = rows[i].querySelector('[name$="[start]"]');
                    if ((l && l.value.trim()) || (s && s.value)) { return false; }
                }
                return true;
            }
            function rowFor(i, vals){
                var tmp = document.createElement('tbody');
                tmp.innerHTML = document.getElementById('oe-shift-tpl').innerHTML.replace(/9999/g, i);
                var tr = tmp.firstElementChild;
                tr.querySelector('[name$="[label]"]').value    = vals.label || '';
                tr.querySelector('[name$="[start]"]').value    = vals.start || '';
                tr.querySelector('[name$="[end]"]').value      = vals.end || '';
                tr.querySelector('[name$="[capacity]"]').value = (vals.capacity != null ? vals.capacity : '');
                return tr;
            }
            // Build an AM (10–1) + PM (1–4) shift for each day of the tour.
            // Falls back to putting the raw date in the first shift label when the
            // date string can't be parsed, so the info is never lost.
            function seedShifts(loc){
                var days = parseDays(loc.date);
                if (!days.length) {
                    var firstLabel = document.querySelector('#oe-shift-table tbody tr [name$="[label]"]');
                    if (firstLabel && !firstLabel.value) { firstLabel.value = (loc.title ? loc.title + ' — ' : '') + loc.date; }
                    return;
                }
                var tbody = document.querySelector('#oe-shift-table tbody');
                tbody.innerHTML = '';
                var slots = [['10:00','13:00'], ['13:00','16:00']];
                var i = 0;
                days.forEach(function(day){
                    slots.forEach(function(sl){
                        var date = day.y + '-' + pad(day.m) + '-' + pad(day.d);
                        tbody.appendChild(rowFor(i++, {
                            label: day.wd + ' ' + day.mon + ' ' + day.d + ' — ' + t12(sl[0]) + '–' + t12(sl[1]),
                            start: date + 'T' + sl[0],
                            end:   date + 'T' + sl[1],
                            capacity: loc.capacity || ''
                        }));
                    });
                });
            }
            function applyLoc(){
                var loc = byRef[sel.value];
                if (!loc) { return; }
                var locInput = document.getElementById('oe-location-input');
                // Fill when empty; also upgrade a title-fallback to the real address
                // once a refresh brings the address through.
                if (locInput && (!locInput.value || locInput.value === loc.title)) {
                    locInput.value = loc.address || loc.title || '';
                }
                var roleInput = document.querySelector('[name="oe_role"]');
                if (roleInput && !roleInput.value && defaultRole) { roleInput.value = defaultRole; }
                if (loc.date && tableIsEmpty()) { seedShifts(loc); }
            }
            sel.addEventListener('change', applyLoc);
            var btn = document.getElementById('oe-loc-refresh');
            var msg = document.getElementById('oe-loc-refresh-msg');
            if (btn) {
                btn.addEventListener('click', function(){
                    btn.disabled = true; msg.textContent = '<?php echo esc_js(__('Refreshing…', 'october-events')); ?>';
                    var body = new URLSearchParams({ action: 'oe_refresh_partner_locs', _wpnonce: nonce });
                    fetch(ajax, { method: 'POST', credentials: 'same-origin', headers: {'Content-Type':'application/x-www-form-urlencoded'}, body: body.toString() })
                        .then(function(r){ return r.json(); })
                        .then(function(res){
                            btn.disabled = false;
                            if (!res || !res.success) { msg.textContent = (res && res.data && res.data.error) ? res.data.error : '<?php echo esc_js(__('Refresh failed', 'october-events')); ?>'; return; }
                            LOCS = res.data.locations || []; indexLocs();
                            var og = document.getElementById('oe-loc-optgroup');
                            var keep = sel.value;
                            og.innerHTML = '';
                            LOCS.forEach(function(l){
                                var o = document.createElement('option');
                                o.value = 'loc:' + l.ref; o.textContent = l.title || '';
                                og.appendChild(o);
                            });
                            if (byRef[keep]) { sel.value = keep; applyLoc(); }
                            // Diagnostic readout: shows whether the feed is actually
                            // carrying address / date / image, so a blank pull-through
                            // is easy to pin on the source site's config vs. here.
                            var wA = LOCS.filter(function(l){ return l.address; }).length;
                            var wD = LOCS.filter(function(l){ return l.date; }).length;
                            var wI = LOCS.filter(function(l){ return l.image; }).length;
                            msg.textContent = LOCS.length + ' <?php echo esc_js(__('locations', 'october-events')); ?> · ' + wA + ' address · ' + wD + ' date · ' + wI + ' image';
                        })
                        .catch(function(){ btn.disabled = false; msg.textContent = '<?php echo esc_js(__('Refresh failed', 'october-events')); ?>'; });
                });
            }
        })();
        </script>
        <?php
    }

    /** One editable shift row in the meta box. */
    private function shift_row(int $i, array $s): void {
        // Stored start/end are "Y-m-d H:i" (local) — present them to the
        // datetime-local input as "Y-m-d\TH:i" without any timezone shift.
        $to_input = static function (string $v): string {
            $v = trim($v);
            if ($v === '') {
                return '';
            }
            if (preg_match('/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/', $v)) {
                return str_replace(' ', 'T', substr($v, 0, 16));
            }
            $t = strtotime($v);
            return $t ? date('Y-m-d\TH:i', $t) : '';
        };
        ?>
        <tr>
            <td><input type="text" name="oe_shift[<?php echo $i; ?>][label]" value="<?php echo esc_attr((string) ($s['label'] ?? '')); ?>" placeholder="<?php esc_attr_e('Sat Oct 3 — 10:00am–1:00pm', 'october-events'); ?>" class="widefat">
                <input type="hidden" name="oe_shift[<?php echo $i; ?>][id]" value="<?php echo esc_attr((string) ($s['id'] ?? '')); ?>"></td>
            <td><input type="datetime-local" name="oe_shift[<?php echo $i; ?>][start]" value="<?php echo esc_attr($to_input((string) ($s['start'] ?? ''))); ?>"></td>
            <td><input type="datetime-local" name="oe_shift[<?php echo $i; ?>][end]" value="<?php echo esc_attr($to_input((string) ($s['end'] ?? ''))); ?>"></td>
            <td><input type="number" min="0" name="oe_shift[<?php echo $i; ?>][capacity]" value="<?php echo esc_attr((string) ($s['capacity'] ?? '')); ?>" style="width:70px"></td>
            <td><button type="button" class="button-link oe-shift-del" title="<?php esc_attr_e('Remove', 'october-events'); ?>">✕</button></td>
        </tr>
        <?php
    }

    public function save_meta(int $post_id): void {
        if (! isset($_POST['oe_volunteer_nonce']) || ! wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['oe_volunteer_nonce'])), 'oe_save_volunteer')) {
            return;
        }
        if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
            return;
        }
        if (! current_user_can('edit_post', $post_id)) {
            return;
        }

        $role = sanitize_text_field((string) ($_POST['oe_role'] ?? ''));
        update_post_meta($post_id, '_oe_location', sanitize_text_field((string) ($_POST['oe_location'] ?? '')));
        update_post_meta($post_id, '_oe_signups_open', empty($_POST['oe_signups_open']) ? '0' : '1');

        // The single dropdown carries either an event ID (numeric) or a pulled
        // tour location ("loc:<site>#<id>"). Store whichever was picked; clear the
        // other so an opportunity is only ever linked to one thing.
        $linked_val = (string) ($_POST['oe_linked_event'] ?? '0');
        if (strpos($linked_val, 'loc:') === 0) {
            $ref = sanitize_text_field(substr($linked_val, 4));
            update_post_meta($post_id, '_oe_linked_location_ref', $ref);
            update_post_meta($post_id, '_oe_linked_event', 0);
            $fl = self::feed_location($ref);
            // Default the role for docent-led tour stops when left blank.
            if ($role === '') {
                $role = (string) Settings::get('location_default_role', '');
            }
            // Reuse the location's featured image, once, if none is set here.
            if ($fl && ! empty($fl['image']) && ! has_post_thumbnail($post_id)) {
                self::sideload_thumbnail($post_id, (string) $fl['image']);
            }
        } else {
            update_post_meta($post_id, '_oe_linked_event', absint($linked_val));
            delete_post_meta($post_id, '_oe_linked_location_ref');
        }
        update_post_meta($post_id, '_oe_role', $role);

        // Structured shift rows. Each carries its id (hidden field) so signups
        // stay attached even if the label changes; fall back to a label match for
        // rows migrated from the old textarea, else mint a new id.
        $existing = [];
        foreach (self::shifts($post_id) as $s) {
            $existing[$s['label']] = $s['id'];
        }
        $rows   = (array) ($_POST['oe_shift'] ?? []);
        $shifts = [];
        foreach ($rows as $r) {
            $label = sanitize_text_field((string) ($r['label'] ?? ''));
            if ($label === '') {
                continue;
            }
            $id = sanitize_key((string) ($r['id'] ?? ''));
            $shifts[] = [
                'id'       => $id !== '' ? $id : ($existing[$label] ?? wp_generate_password(8, false)),
                'label'    => $label,
                // datetime-local posts "Y-m-d\TH:i" — store as "Y-m-d H:i".
                'start'    => str_replace('T', ' ', sanitize_text_field((string) ($r['start'] ?? ''))),
                'end'      => str_replace('T', ' ', sanitize_text_field((string) ($r['end'] ?? ''))),
                'capacity' => max(0, (int) ($r['capacity'] ?? 0)),
            ];
        }
        self::set_shifts($post_id, $shifts);
        // Re-evaluate the fully-booked flag (capacity may have changed).
        self::sync_fully_booked($post_id);
    }

    public function register_meta(): void {
        $slug = self::slug();
        foreach ([
            '_oe_role'            => 'string',
            '_oe_location'        => 'string',
            '_oe_signups_open'    => 'boolean',
            '_oe_linked_event'    => 'integer',
            '_oe_linked_location' => 'integer',
            // A tour location pulled from a partner site, keyed "<site>#<id>".
            '_oe_linked_location_ref' => 'string',
            '_oe_remote_ref'      => 'string',
            '_oe_remote_url'      => 'string',
        ] as $key => $type) {
            register_post_meta($slug, $key, ['type' => $type, 'single' => true, 'show_in_rest' => true]);
        }
    }

    /* ------------------------------------------------------------------ *
     * Optional link to an event — so an opportunity reuses the event's
     * location (and surfaces a "volunteer" call-out on the event page)
     * instead of re-keying it. Opportunities stay their own rich listings.
     * ------------------------------------------------------------------ */

    /** The event this opportunity is attached to (0 if none). */
    public static function linked_event(int $opportunity_id): int {
        return (int) get_post_meta($opportunity_id, '_oe_linked_event', true);
    }

    /**
     * Display location for an opportunity: its own `_oe_location`, falling back to
     * the linked event's location so staff don't re-type it.
     */
    public static function location(int $opportunity_id): string {
        $loc = trim((string) get_post_meta($opportunity_id, '_oe_location', true));
        if ($loc !== '') {
            return $loc;
        }
        $event = self::linked_event($opportunity_id);
        if ($event) {
            return (string) \OE\Planning\Events::get($event, 'location', '');
        }
        $loc = self::linked_location($opportunity_id);
        if ($loc) {
            return (string) get_the_title($loc);
        }
        // A tour location pulled from a partner site.
        $ref = (string) get_post_meta($opportunity_id, '_oe_linked_location_ref', true);
        if ($ref !== '') {
            $fl = self::feed_location($ref);
            if ($fl) {
                return (string) (($fl['address'] ?? '') !== '' ? $fl['address'] : ($fl['title'] ?? ''));
            }
        }
        return '';
    }

    /** The tour location this opportunity is attached to (0 if none). */
    public static function linked_location(int $opportunity_id): int {
        return (int) get_post_meta($opportunity_id, '_oe_linked_location', true);
    }

    /** @return array<int,int> opportunity ids linked to a given location. */
    public static function for_location(int $location_id): array {
        if ($location_id <= 0) {
            return [];
        }
        return array_map('intval', get_posts([
            'post_type'      => self::slug(),
            'post_status'    => ['publish', 'draft', 'pending', 'private'],
            'posts_per_page' => -1,
            'fields'         => 'ids',
            'meta_key'       => '_oe_linked_location',
            'meta_value'     => $location_id,
            'orderby'        => 'ID',
            'order'          => 'ASC',
        ]));
    }

    /**
     * Create (or update) the volunteer opportunity linked to a tour location — the
     * one-click "Needs volunteers" flow. Reuses the existing linked opportunity if
     * there is one (so signups are never orphaned); on first create it gets a
     * single default shift with the given capacity, published and open. Returns the
     * opportunity id (0 on failure).
     */
    public static function create_or_sync_for_location(int $location_id, int $capacity, bool $open): int {
        if ($location_id <= 0 || get_post_status($location_id) === false) {
            return 0;
        }
        $loc_title = get_the_title($location_id) ?: ('#' . $location_id);
        $existing  = self::for_location($location_id);
        $opp_id    = $existing[0] ?? 0;

        if (! $opp_id) {
            $opp_id = (int) wp_insert_post([
                'post_type'   => self::slug(),
                'post_status' => 'publish',
                /* translators: %s: tour location title */
                'post_title'  => sprintf(__('%s — Volunteers', 'october-events'), $loc_title),
            ]);
            if ($opp_id <= 0) {
                return 0;
            }
            update_post_meta($opp_id, '_oe_role', 'general');
            // One default shift to sign up to — staff refine dates/shifts on the
            // opportunity editor. Only ever seeded on first create.
            self::set_shifts($opp_id, [[
                'id'       => wp_generate_password(8, false),
                'label'    => __('Volunteer shift', 'october-events'),
                'start'    => '',
                'end'      => '',
                'capacity' => max(0, $capacity),
            ]]);
        }
        update_post_meta($opp_id, '_oe_linked_location', $location_id);
        update_post_meta($opp_id, '_oe_location', sanitize_text_field($loc_title));
        update_post_meta($opp_id, '_oe_signups_open', $open ? '1' : '0');
        // Keep the capacity in sync while there's still just the one auto shift
        // (once staff add their own shifts we leave shift capacities to them).
        $shifts = self::shifts($opp_id);
        if (count($shifts) === 1) {
            $shifts[0]['capacity'] = max(0, $capacity);
            self::set_shifts($opp_id, $shifts);
        }
        self::sync_fully_booked($opp_id);
        return $opp_id;
    }

    /** Close signups on any opportunity linked to a location (kept, not deleted). */
    public static function close_for_location(int $location_id): void {
        foreach (self::for_location($location_id) as $oid) {
            update_post_meta($oid, '_oe_signups_open', '0');
        }
    }

    /* ------------------------------------------------------------------ *
     * Cross-site: expose partner-hosted locations (source side) + pull them
     * onto a partner site as local opportunities (the ADF festival site).
     * ------------------------------------------------------------------ */

    /**
     * Tour locations flagged "Needs volunteers → Partner site", for the partner
     * site to pull over the REST API and host sign-ups for. Source-side.
     *
     * @return array<int,array{id:int,title:string,url:string,capacity:int,image:string}>
     */
    public static function partner_locations(): array {
        $loc = self::location_post_type();
        if ($loc === '') {
            return [];
        }
        $ids = get_posts([
            'post_type'      => $loc,
            'post_status'    => 'publish',
            'posts_per_page' => 300,
            'fields'         => 'ids',
            'meta_query'     => [
                'relation' => 'AND',
                ['key' => '_oe_loc_needs_volunteers', 'value' => '1'],
                ['key' => '_oe_loc_vol_host', 'value' => 'partner'],
            ],
        ]);
        // Fall back to the tours schema's own field names when unset, so address
        // and date flow through even if the mapping was never configured (or was
        // saved blank). Override in settings only if your fields differ.
        $addr_key = trim((string) Settings::get('location_address_field', '')) ?: 'address';
        $date_key = trim((string) Settings::get('location_date_field', '')) ?: 'date';
        $out = [];
        foreach ($ids as $id) {
            $out[] = [
                'id'       => (int) $id,
                'title'    => (string) (get_the_title($id) ?: ('#' . $id)),
                'url'      => (string) get_permalink($id),
                'address'  => $addr_key !== '' ? (string) get_post_meta($id, $addr_key, true) : '',
                'date'     => $date_key !== '' ? (string) get_post_meta($id, $date_key, true) : '',
                'capacity' => (int) get_post_meta($id, '_oe_loc_vol_capacity', true),
                'image'    => (string) (get_the_post_thumbnail_url($id, 'medium') ?: ''),
            ];
        }
        return $out;
    }

    /**
     * Pull the partner feed (this = the ADF festival site) and cache the tour
     * locations flagged "host on partner" so they can be picked when building a
     * volunteer post here. We deliberately do NOT auto-create posts — staff make
     * the opportunity by hand and link it to the location via the picker.
     *
     * @return array{locations?:int,error?:string}
     */
    public static function sync_partner_feed(): array {
        $url  = trim((string) Settings::get('volunteer_feed_url', ''));
        $user = trim((string) Settings::get('volunteer_feed_user', ''));
        $pass = trim((string) Settings::get('volunteer_feed_app_password', ''));
        if ($url === '' || $user === '' || $pass === '') {
            return ['error' => 'not_configured'];
        }
        $endpoint = rtrim($url, '/') . '/wp-json/oe/v1/volunteers/partner-locations';
        $res = wp_remote_get($endpoint, [
            'timeout' => 20,
            'headers' => ['Authorization' => 'Basic ' . base64_encode($user . ':' . $pass)],
        ]);
        if (is_wp_error($res)) {
            return ['error' => $res->get_error_message()];
        }
        $code = (int) wp_remote_retrieve_response_code($res);
        if ($code !== 200) {
            return ['error' => 'http_' . $code];
        }
        $body = json_decode((string) wp_remote_retrieve_body($res), true);
        if (! is_array($body)) {
            return ['error' => 'bad_response'];
        }
        $site = (string) ($body['site'] ?? $url);
        $locs = is_array($body['locations'] ?? null) ? $body['locations'] : [];

        $list = [];
        foreach ($locs as $l) {
            $rid = (int) ($l['id'] ?? 0);
            if ($rid <= 0) {
                continue;
            }
            $list[] = [
                'ref'      => $site . '#' . $rid,
                'title'    => sanitize_text_field((string) ($l['title'] ?? 'Location')),
                'url'      => esc_url_raw((string) ($l['url'] ?? '')),
                'address'  => sanitize_text_field((string) ($l['address'] ?? '')),
                'date'     => sanitize_text_field((string) ($l['date'] ?? '')),
                'capacity' => max(0, (int) ($l['capacity'] ?? 0)),
                'image'    => esc_url_raw((string) ($l['image'] ?? '')),
            ];
        }
        Settings::update([
            'volunteer_feed_locations' => $list,
            'volunteer_feed_last_sync' => time(),
        ]);
        return ['locations' => count($list)];
    }

    /** Cached pickable tour locations pulled from the partner feed. @return array[] */
    public static function feed_locations(): array {
        $list = Settings::get('volunteer_feed_locations', []);
        return is_array($list) ? $list : [];
    }

    /** One cached feed location by its "<site>#<id>" ref, or null. */
    public static function feed_location(string $ref): ?array {
        foreach (self::feed_locations() as $l) {
            if (($l['ref'] ?? '') === $ref) {
                return $l;
            }
        }
        return null;
    }

    /**
     * Download a remote image into the media library and set it as the post's
     * featured image. Best-effort: failures are swallowed so a save never breaks.
     */
    private static function sideload_thumbnail(int $post_id, string $url): void {
        if ($url === '') {
            return;
        }
        require_once ABSPATH . 'wp-admin/includes/media.php';
        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/image.php';
        $att_id = media_sideload_image($url, $post_id, null, 'id');
        if (! is_wp_error($att_id) && $att_id) {
            set_post_thumbnail($post_id, (int) $att_id);
        }
    }

    /**
     * AJAX: refresh the pickable tour-location list on demand, so a location just
     * created on the tours site is immediately selectable here without waiting for
     * the daily cron. Returns the fresh list for the volunteer-editor dropdown.
     */
    public static function ajax_refresh_partner_locs(): void {
        check_ajax_referer('oe_refresh_partner_locs');
        if (! current_user_can('edit_posts')) {
            wp_send_json_error(['error' => __('Not allowed', 'october-events')], 403);
        }
        $res = self::sync_partner_feed();
        if (! empty($res['error'])) {
            wp_send_json_error(['error' => $res['error']]);
        }
        $locs = self::feed_locations();
        wp_send_json_success(['locations' => array_values($locs), 'count' => count($locs)]);
    }

    /** @return array<int,int> opportunity ids linked to a given event (newest first). */
    public static function for_event(int $event_id): array {
        if ($event_id <= 0) {
            return [];
        }
        return array_map('intval', get_posts([
            'post_type'      => self::slug(),
            'post_status'    => ['publish', 'draft', 'pending', 'private'],
            'posts_per_page' => -1,
            'fields'         => 'ids',
            'meta_key'       => '_oe_linked_event',
            'meta_value'     => $event_id,
            'orderby'        => 'title',
            'order'          => 'ASC',
        ]));
    }

    /* ------------------------------------------------------------------ *
     * Shifts (stored as structured meta on the opportunity)
     * ------------------------------------------------------------------ */

    /**
     * Shifts for an opportunity.
     *
     * @return array<int,array{id:string,label:string,start:string,end:string,capacity:int}>
     */
    public static function shifts(int $opportunity_id): array {
        $shifts = get_post_meta($opportunity_id, '_oe_shifts', true);
        return is_array($shifts) ? $shifts : [];
    }

    public static function set_shifts(int $opportunity_id, array $shifts): void {
        $clean = [];
        foreach ($shifts as $s) {
            $clean[] = [
                'id'       => sanitize_key((string) ($s['id'] ?? wp_generate_password(8, false))),
                'label'    => sanitize_text_field((string) ($s['label'] ?? '')),
                'start'    => sanitize_text_field((string) ($s['start'] ?? '')),
                'end'      => sanitize_text_field((string) ($s['end'] ?? '')),
                'capacity' => max(0, (int) ($s['capacity'] ?? 0)),
            ];
        }
        update_post_meta($opportunity_id, '_oe_shifts', $clean);
    }

    public static function shift(int $opportunity_id, string $shift_id): ?array {
        foreach (self::shifts($opportunity_id) as $s) {
            if ($s['id'] === $shift_id) {
                return $s;
            }
        }
        return null;
    }

    public static function shift_full(int $opportunity_id, string $shift_id): bool {
        $shift = self::shift($opportunity_id, $shift_id);
        if (! $shift) {
            return true;
        }
        return VolunteerSignups::count_for_shift($opportunity_id, $shift_id) >= (int) $shift['capacity'];
    }

    public static function spots_left(int $opportunity_id, string $shift_id): int {
        $shift = self::shift($opportunity_id, $shift_id);
        if (! $shift) {
            return 0;
        }
        return max(0, (int) $shift['capacity'] - VolunteerSignups::count_for_shift($opportunity_id, $shift_id));
    }

    /* ------------------------------------------------------------------ *
     * Fully-booked state
     * ------------------------------------------------------------------ */

    /** True when every shift is full (and there's real capacity to fill). */
    public static function is_fully_booked(int $opportunity_id): bool {
        $shifts = self::shifts($opportunity_id);
        if (! $shifts) {
            return false;
        }
        $capacity = 0;
        $left     = 0;
        foreach ($shifts as $s) {
            $capacity += (int) $s['capacity'];
            $left     += self::spots_left($opportunity_id, $s['id']);
        }
        return $capacity > 0 && $left === 0;
    }

    /**
     * Mirror the fully-booked state onto the `fully-booked` switcher meta (a
     * JetEngine field on the opportunity) so it flips on/off automatically as
     * signups fill or free up. JetEngine switchers default to 'true'/'false';
     * override with the `oe_fully_booked_values` filter if yours differ.
     */
    public static function sync_fully_booked(int $opportunity_id): void {
        $vals = apply_filters('oe_fully_booked_values', ['on' => 'true', 'off' => 'false'], $opportunity_id);
        update_post_meta($opportunity_id, 'fully-booked', self::is_fully_booked($opportunity_id) ? $vals['on'] : $vals['off']);
    }

    /* ------------------------------------------------------------------ *
     * Signups
     * ------------------------------------------------------------------ */

    /**
     * Book a volunteer into a shift.
     *
     * @return int|\WP_Error signup id, or error (e.g. shift full)
     */
    public static function signup(int $opportunity_id, string $shift_id, array $person, int $account_id = 0) {
        if (get_post_type($opportunity_id) !== self::slug()) {
            return new \WP_Error('oe_bad_opportunity', __('Unknown volunteer opportunity.', 'october-events'));
        }
        // Unset is treated as open; only an explicit "0" closes signups.
        if (get_post_meta($opportunity_id, '_oe_signups_open', true) === '0') {
            return new \WP_Error('oe_signups_closed', __('Signups for this opportunity are closed.', 'october-events'));
        }
        $shift = self::shift($opportunity_id, $shift_id);
        if (! $shift) {
            return new \WP_Error('oe_bad_shift', __('That shift no longer exists.', 'october-events'));
        }
        if (self::shift_full($opportunity_id, $shift_id)) {
            return new \WP_Error('oe_shift_full', __('Sorry — that shift is full.', 'october-events'));
        }

        $name  = sanitize_text_field((string) ($person['name'] ?? ''));
        $email = sanitize_email((string) ($person['email'] ?? ''));
        if ($name === '' || ! is_email($email)) {
            return new \WP_Error('oe_invalid_person', __('A name and valid email are required.', 'october-events'));
        }

        // Prevent double-booking the same shift.
        foreach (VolunteerSignups::for_shift($opportunity_id, $shift_id) as $existing) {
            if (strcasecmp($existing->email, $email) === 0 && $existing->status !== VolunteerSignups::STATUS_DECLINED) {
                return new \WP_Error('oe_already_booked', __('You are already signed up for this shift.', 'october-events'));
            }
        }

        // Reminders are mandatory (to cut no-shows): everyone gets email, and
        // providing a mobile opts that number into SMS reminders too.
        $phone = sanitize_text_field((string) ($person['phone'] ?? ''));
        $sms   = $phone !== '' ? 1 : 0;

        $id = VolunteerSignups::insert([
            'opportunity_id' => $opportunity_id,
            'shift_id'       => $shift_id,
            'account_id'     => $account_id ?: null,
            'name'           => $name,
            'email'          => $email,
            'phone'          => $phone,
            'sms_opt_in'     => $sms,
            // Auto-confirmed on signup; staff can still decline/no-show later.
            'status'         => VolunteerSignups::STATUS_CONFIRMED,
            'shift_start'    => self::normalise_datetime((string) $shift['start']),
            'reminders_sent' => '',
            // Secret token that lets the volunteer cancel this shift from the
            // link in their confirmation email (no login).
            'cancel_token'   => self::gen_cancel_token(),
        ]);

        AuditLog::record('volunteer_signup', $opportunity_id, 'volunteer', 'shift:' . $shift_id);
        self::notify_staff('signup', $id);

        // Native contacts (the Brevo replacement).
        \OE\Mail\Contacts::capture($email, [
            'name'       => $name,
            'phone'      => $phone,
            'sms_opt_in' => $sms,
            'source'     => 'volunteer',
        ]);

        // "On signup" confirmation + schedule the rest (§reminders).
        Reminders::on_signup($id);
        self::sync_fully_booked($opportunity_id);

        return $id;
    }

    public static function confirm(int $signup_id): void {
        VolunteerSignups::update($signup_id, ['status' => VolunteerSignups::STATUS_CONFIRMED]);
        $s = VolunteerSignups::get($signup_id);
        if (! $s) {
            return;
        }
        AuditLog::record('volunteer_confirmed', (int) $s->opportunity_id, 'volunteer');
        \OE\Mail\Transactional::send('volunteer_confirmed', ['email' => $s->email, 'name' => $s->name], self::email_params($s));
    }

    public static function decline(int $signup_id): void {
        VolunteerSignups::update($signup_id, ['status' => VolunteerSignups::STATUS_DECLINED]);
        $s = VolunteerSignups::get($signup_id);
        if (! $s) {
            return;
        }
        AuditLog::record('volunteer_declined', (int) $s->opportunity_id, 'volunteer');
        \OE\Mail\Transactional::send('volunteer_declined', ['email' => $s->email, 'name' => $s->name], self::email_params($s));
        self::sync_fully_booked((int) $s->opportunity_id); // a spot just freed
    }

    public static function mark_no_show(int $signup_id): void {
        VolunteerSignups::update($signup_id, ['status' => VolunteerSignups::STATUS_NO_SHOW]);
        AuditLog::record('volunteer_no_show', $signup_id, 'volunteer');
    }

    /**
     * Signups for an account (dashboard Volunteer tab).
     *
     * @return array<int,object>
     */
    public static function for_account(int $account_id): array {
        return VolunteerSignups::for_account($account_id);
    }

    public static function set_checked_in(int $signup_id, bool $checked_in): void {
        VolunteerSignups::update($signup_id, ['checked_in' => $checked_in ? 1 : 0]);
        if ($checked_in) {
            AuditLog::record('volunteer_checked_in', $signup_id, 'volunteer');
        }
    }

    public static function delete_signup(int $signup_id): void {
        global $wpdb;
        $row = VolunteerSignups::get($signup_id);
        $wpdb->delete(VolunteerSignups::table(), ['id' => $signup_id]);
        AuditLog::record('volunteer_signup_removed', $signup_id, 'volunteer');
        if ($row) {
            self::sync_fully_booked((int) $row->opportunity_id); // a spot may have freed
        }
    }

    /**
     * The volunteer cancelled their own shift (via the link in their confirmation
     * email). Frees the slot and alerts staff — but does NOT email the volunteer:
     * they clicked cancel themselves and see an on-screen confirmation, so a
     * "your cancellation is confirmed" email would be noise. Idempotent.
     */
    public static function cancel(int $signup_id): bool {
        $s = VolunteerSignups::get($signup_id);
        if (! $s) {
            return false;
        }
        // Already cancelled/declined — treat as success (link clicked twice).
        if (in_array($s->status, [VolunteerSignups::STATUS_CANCELLED, VolunteerSignups::STATUS_DECLINED], true)) {
            return true;
        }
        VolunteerSignups::update($signup_id, ['status' => VolunteerSignups::STATUS_CANCELLED]);
        AuditLog::record('volunteer_self_cancelled', (int) $s->opportunity_id, 'volunteer', 'shift:' . $s->shift_id);
        self::sync_fully_booked((int) $s->opportunity_id); // a spot just freed
        self::notify_staff('cancel', $signup_id);
        return true;
    }

    /** A random, hard-to-guess token for the self-service cancel link. */
    private static function gen_cancel_token(): string {
        return bin2hex(random_bytes(16)); // 32 hex chars, fits VARCHAR(40)
    }

    /**
     * Email the internal alert lists when a volunteer signs up or cancels.
     * Signups and cancels have SEPARATE recipient lists (different people need
     * to know each), each a comma/newline-separated list in Settings. Sends one
     * plain, branded email per recipient; never touches the volunteer.
     *
     * @param string $event 'signup' | 'cancel'
     */
    private static function notify_staff(string $event, int $signup_id): void {
        $key        = $event === 'cancel' ? 'volunteer_cancel_alert_emails' : 'volunteer_signup_alert_emails';
        $recipients = self::alert_recipients((string) Settings::get($key, ''));
        if (! $recipients) {
            return;
        }
        $s = VolunteerSignups::get($signup_id);
        if (! $s) {
            return;
        }
        $p    = self::email_params($s);
        $opp  = (string) ($p['opportunity'] ?? '');
        $verb = $event === 'cancel' ? __('cancelled', 'october-events') : __('signed up', 'october-events');

        /* translators: 1: volunteer name, 2: signed up/cancelled, 3: opportunity */
        $subject = sprintf(__('Volunteer %2$s: %1$s — %3$s', 'october-events'), $s->name, $verb, $opp);

        $lines = [
            sprintf(__('%1$s has %2$s.', 'october-events'), $s->name, $verb),
            '',
            sprintf(__('Opportunity: %s', 'october-events'), $opp),
            sprintf(__('Shift: %s', 'october-events'), (string) ($p['shift'] ?? '')),
        ];
        if (! empty($p['location'])) {
            $lines[] = sprintf(__('Location: %s', 'october-events'), (string) $p['location']);
        }
        $lines[] = sprintf(__('Email: %s', 'october-events'), $s->email);
        if (! empty($s->phone)) {
            $lines[] = sprintf(__('Phone: %s', 'october-events'), (string) $s->phone);
        }
        $manage = admin_url('admin.php?page=oe-volunteers');
        $lines[] = '';
        $lines[] = sprintf(__('Manage signups: %s', 'october-events'), $manage);

        $html = '';
        foreach ($lines as $ln) {
            $html .= $ln === '' ? '<br>' : '<p style="margin:0 0 6px">' . esc_html($ln) . '</p>';
        }

        foreach ($recipients as $to) {
            \OE\Mail\Transactional::send('volunteer_alert', ['email' => $to, 'name' => ''], [], $subject, $html);
        }
    }

    /**
     * Parse a comma/newline-separated recipient string into unique valid emails.
     *
     * @return array<int,string>
     */
    private static function alert_recipients(string $raw): array {
        $out = [];
        foreach (preg_split('/[\r\n,]+/', $raw) ?: [] as $part) {
            $email = sanitize_email(trim($part));
            if ($email !== '' && is_email($email)) {
                $out[strtolower($email)] = $email;
            }
        }
        return array_values($out);
    }

    /** The public no-login URL a volunteer uses to cancel their own shift. */
    public static function cancel_url(object $signup): string {
        if (empty($signup->cancel_token)) {
            return '';
        }
        return add_query_arg([
            'oe_vcancel' => (int) $signup->id,
            'k'          => (string) $signup->cancel_token,
        ], home_url('/'));
    }

    /**
     * Admin/manual add of a volunteer to a shift (the management surface). Unlike
     * the public {@see signup()}, this bypasses the "signups open" gate and the
     * capacity cap so staff can always place someone, but still de-dupes the
     * person against the shift and fires the on-signup confirmation + reminders.
     *
     * @return int|\WP_Error signup id, or error
     */
    public static function admin_add(int $opportunity_id, string $shift_id, array $person, int $account_id = 0) {
        if (get_post_type($opportunity_id) !== self::slug()) {
            return new \WP_Error('oe_bad_opportunity', __('Unknown volunteer opportunity.', 'october-events'));
        }
        $shift = self::shift($opportunity_id, $shift_id);
        if (! $shift) {
            return new \WP_Error('oe_bad_shift', __('That shift no longer exists.', 'october-events'));
        }
        $name  = sanitize_text_field((string) ($person['name'] ?? ''));
        $email = sanitize_email((string) ($person['email'] ?? ''));
        if ($name === '' || ! is_email($email)) {
            return new \WP_Error('oe_invalid_person', __('A name and valid email are required.', 'october-events'));
        }
        foreach (VolunteerSignups::for_shift($opportunity_id, $shift_id) as $existing) {
            if (strcasecmp($existing->email, $email) === 0 && $existing->status !== VolunteerSignups::STATUS_DECLINED) {
                return new \WP_Error('oe_already_booked', __('That person is already on this shift.', 'october-events'));
            }
        }

        $id = VolunteerSignups::insert([
            'opportunity_id' => $opportunity_id,
            'shift_id'       => $shift_id,
            'account_id'     => $account_id ?: null,
            'name'           => $name,
            'email'          => $email,
            'phone'          => sanitize_text_field((string) ($person['phone'] ?? '')),
            'sms_opt_in'     => ! empty($person['sms_opt_in']) ? 1 : 0,
            // Staff-placed signups start confirmed (they're deliberate).
            'status'         => VolunteerSignups::STATUS_CONFIRMED,
            'shift_start'    => self::normalise_datetime((string) $shift['start']),
            'reminders_sent' => '',
            'cancel_token'   => self::gen_cancel_token(),
        ]);

        AuditLog::record('volunteer_signup_manual', $opportunity_id, 'volunteer', 'shift:' . $shift_id);
        self::notify_staff('signup', $id);
        Reminders::on_signup($id);
        self::sync_fully_booked($opportunity_id);
        return $id;
    }

    /* ------------------------------------------------------------------ *
     * Read models for the management UI (admin + platform Volunteers view)
     * ------------------------------------------------------------------ */

    /** @return array<int,int> all opportunity post ids (newest first). */
    public static function all_opportunity_ids(): array {
        return array_map('intval', get_posts([
            'post_type'      => self::slug(),
            'post_status'    => ['publish', 'draft', 'pending', 'private'],
            'posts_per_page' => -1,
            'fields'         => 'ids',
            'orderby'        => 'title',
            'order'          => 'ASC',
        ]));
    }

    /**
     * Lightweight card for the opportunities list: capacity vs filled across all
     * shifts, plus how many signups still need a decision.
     *
     * @return array<string,mixed>
     */
    public static function opportunity_summary(int $id): array {
        $shifts   = self::shifts($id);
        $capacity = 0;
        foreach ($shifts as $s) {
            $capacity += (int) $s['capacity'];
        }
        // One query for all signups, tallied in PHP — was a COUNT(*) per shift.
        $filled = 0;
        $pending = 0;
        foreach (VolunteerSignups::for_opportunity($id) as $row) {
            if ($row->status === VolunteerSignups::STATUS_PENDING || $row->status === VolunteerSignups::STATUS_CONFIRMED) {
                $filled++;
            }
            if ($row->status === VolunteerSignups::STATUS_PENDING) {
                $pending++;
            }
        }
        return [
            'id'         => $id,
            'title'      => get_the_title($id) ?: '(untitled)',
            'role'       => (string) get_post_meta($id, '_oe_role', true),
            'location'   => self::location($id),
            'event_id'   => self::linked_event($id),
            'open'       => get_post_meta($id, '_oe_signups_open', true) !== '0',
            'shifts'     => count($shifts),
            'capacity'   => $capacity,
            'filled'     => $filled,
            'pending'    => $pending,
        ];
    }

    /**
     * Full detail for one opportunity: each shift with its capacity/spots and the
     * signups attached to it.
     *
     * @return array<string,mixed>
     */
    public static function opportunity_detail(int $id): array {
        // Single signups query; group + tally per shift in PHP (was the summary's
        // query plus a spots_left + shift_full COUNT for every shift).
        $by_shift = [];
        $active   = [];
        $filled   = 0;
        $pending  = 0;
        foreach (VolunteerSignups::for_opportunity($id) as $row) {
            $by_shift[$row->shift_id][] = self::signup_dto($row);
            if ($row->status === VolunteerSignups::STATUS_PENDING || $row->status === VolunteerSignups::STATUS_CONFIRMED) {
                $active[$row->shift_id] = ($active[$row->shift_id] ?? 0) + 1;
                $filled++;
            }
            if ($row->status === VolunteerSignups::STATUS_PENDING) {
                $pending++;
            }
        }
        $capacity = 0;
        $shifts   = self::shifts($id);
        $detail   = [];
        foreach ($shifts as $s) {
            $cap   = (int) $s['capacity'];
            $left  = max(0, $cap - ($active[$s['id']] ?? 0));
            $capacity += $cap;
            $detail[] = [
                'id'         => $s['id'],
                'label'      => $s['label'],
                'start'      => $s['start'],
                'end'        => $s['end'],
                'capacity'   => $cap,
                'spots_left' => $left,
                'full'       => $left === 0,
                'signups'    => $by_shift[$s['id']] ?? [],
            ];
        }
        return [
            'id'            => $id,
            'title'         => get_the_title($id) ?: '(untitled)',
            'role'          => (string) get_post_meta($id, '_oe_role', true),
            'location'      => self::location($id),
            'event_id'      => self::linked_event($id),
            'open'          => get_post_meta($id, '_oe_signups_open', true) !== '0',
            'shifts'        => count($shifts),
            'capacity'      => $capacity,
            'filled'        => $filled,
            'pending'       => $pending,
            'shifts_detail' => $detail,
        ];
    }

    /** @return array<string,mixed> */
    public static function signup_dto(object $s): array {
        return [
            'id'         => (int) $s->id,
            'name'       => $s->name,
            'email'      => $s->email,
            'phone'      => $s->phone,
            'sms_opt_in' => (bool) $s->sms_opt_in,
            'status'     => $s->status,
            'checked_in' => (bool) $s->checked_in,
            'shift_id'   => $s->shift_id,
            'created_at' => $s->created_at,
        ];
    }

    /* ------------------------------------------------------------------ *
     * Email/SMS params + front-end widget
     * ------------------------------------------------------------------ */

    public static function email_params(object $signup): array {
        $oid   = (int) $signup->opportunity_id;
        $shift = self::shift($oid, $signup->shift_id);
        return [
            'name'           => $signup->name,
            'opportunity'    => get_the_title($oid),
            'opportunity_id' => $oid,
            'shift'          => $shift['label'] ?? '',
            'location'       => self::location($oid),
            'url'            => get_permalink($oid),
            // Self-service cancel link for the confirmation/reminder email.
            'cancel_url'     => self::cancel_url($signup),
        ];
    }

    /**
     * SMS body for a reminder/confirmation (kept short).
     */
    public static function sms_body(object $signup, string $context): string {
        $p = self::email_params($signup);
        if ($context === 'on_signup') {
            return sprintf(
                /* translators: 1: opportunity, 2: shift */
                __('ADF: thanks %1$s! You are signed up to volunteer for %2$s (%3$s). Reply STOP to opt out.', 'october-events'),
                $p['name'],
                $p['opportunity'],
                $p['shift']
            );
        }
        return sprintf(
            /* translators: 1: opportunity, 2: shift, 3: location */
            __('ADF reminder: your volunteer shift "%1$s" (%2$s) is coming up at %3$s. See you there!', 'october-events'),
            $p['opportunity'],
            $p['shift'],
            $p['location']
        );
    }

    /**
     * `[oe_volunteer_signup opportunity="123"]` — renders the shift table with
     * remaining slots and a signup form, hydrated against the REST API.
     */
    public function render_signup_widget(array $atts = []): string {
        $atts = shortcode_atts(['opportunity' => get_the_ID()], $atts, 'oe_volunteer_signup');
        $opportunity_id = (int) $atts['opportunity'];
        if (! $opportunity_id || get_post_type($opportunity_id) !== self::slug()) {
            return '';
        }

        wp_enqueue_style('oe-dashboard');
        wp_enqueue_script('oe-dashboard');

        $shifts = [];
        foreach (self::shifts($opportunity_id) as $s) {
            $s['spots_left'] = self::spots_left($opportunity_id, $s['id']);
            $s['full']       = self::shift_full($opportunity_id, $s['id']);
            $shifts[] = $s;
        }

        wp_localize_script('oe-dashboard', 'OE_VOL', [
            'restUrl'       => esc_url_raw(rest_url('oe/v1')),
            'nonce'         => wp_create_nonce('wp_rest'),
            'opportunityId' => $opportunity_id,
            'shifts'        => $shifts,
            'loggedIn'      => is_user_logged_in(),
        ]);

        return '<div class="oe-vol-signup" id="oe-vol-signup" data-opportunity="' . esc_attr((string) $opportunity_id) . '"></div>';
    }

    /* ------------------------------------------------------------------ *
     * Event integration — manage/surface opportunities from the event
     * ------------------------------------------------------------------ */

    public function add_event_meta_box(): void {
        add_meta_box(
            'oe_event_volunteers',
            __('Volunteers', 'october-events'),
            [$this, 'render_event_meta_box'],
            \OE\PostTypes::slug('event'),
            'side',
            'default'
        );
    }

    /** On the event editor: list linked opportunities + a button to add one. */
    public function render_event_meta_box(\WP_Post $post): void {
        $opps = self::for_event($post->ID);
        if ($opps) {
            echo '<ul style="margin:0 0 10px">';
            foreach ($opps as $oid) {
                $s = self::opportunity_summary($oid);
                printf(
                    '<li style="margin:0 0 8px;padding-bottom:8px;border-bottom:1px solid #f0f0f1"><a href="%1$s"><strong>%2$s</strong></a><br><span class="description">%3$s · %4$d/%5$d %6$s%7$s</span></li>',
                    esc_url(get_edit_post_link($oid)),
                    esc_html($s['title']),
                    esc_html($s['role'] ?: __('Volunteer', 'october-events')),
                    (int) $s['filled'],
                    (int) $s['capacity'],
                    esc_html__('filled', 'october-events'),
                    $s['pending'] ? ' · ' . esc_html(sprintf(_n('%d to review', '%d to review', $s['pending'], 'october-events'), $s['pending'])) : ''
                );
            }
            echo '</ul>';
        } else {
            echo '<p class="description">' . esc_html__('No volunteer opportunities linked to this event yet.', 'october-events') . '</p>';
        }
        $new = add_query_arg(['post_type' => self::slug(), 'oe_link_event' => $post->ID], admin_url('post-new.php'));
        echo '<a href="' . esc_url($new) . '" class="button">' . esc_html__('+ New volunteer opportunity', 'october-events') . '</a>';
    }

    /* ------------------------------------------------------------------ *
     * One-click volunteers on a tour location
     * ------------------------------------------------------------------ */

    public function add_location_meta_box(): void {
        $loc = self::location_post_type();
        if ($loc === '') {
            return;
        }
        add_meta_box('oe_location_volunteers', __('Volunteers', 'october-events'), [$this, 'render_location_meta_box'], $loc, 'side', 'default');
    }

    /** "Needs volunteers" one-click box on a location. */
    public function render_location_meta_box(\WP_Post $post): void {
        wp_nonce_field('oe_save_loc_vol', 'oe_loc_vol_nonce');
        $opps  = self::for_location($post->ID);
        $opp   = $opps[0] ?? 0;
        $saved = (string) get_post_meta($post->ID, '_oe_loc_needs_volunteers', true);
        $needs = $saved === '' ? (bool) $opp : ($saved === '1');
        $host  = (string) get_post_meta($post->ID, '_oe_loc_vol_host', true) ?: 'local';
        $cap   = (int) get_post_meta($post->ID, '_oe_loc_vol_capacity', true);
        if (! $cap && $opp) { $sh = self::shifts($opp); $cap = (int) ($sh[0]['capacity'] ?? 0); }
        ?>
        <p><label><input type="checkbox" name="oe_loc_needs" value="1" <?php checked($needs); ?>> <strong><?php esc_html_e('Needs volunteers', 'october-events'); ?></strong></label></p>
        <p><label><?php esc_html_e('Volunteers needed', 'october-events'); ?><br>
            <input type="number" min="0" name="oe_loc_capacity" value="<?php echo esc_attr((string) $cap); ?>" style="width:90px"></label>
            <span class="description"><?php esc_html_e('slots on the default shift', 'october-events'); ?></span></p>
        <p style="margin-bottom:2px"><strong><?php esc_html_e('Host sign-ups on', 'october-events'); ?></strong></p>
        <p style="margin-top:2px">
            <label><input type="radio" name="oe_loc_host" value="local" <?php checked($host, 'local'); ?>> <?php esc_html_e('This site', 'october-events'); ?></label><br>
            <label><input type="radio" name="oe_loc_host" value="partner" <?php checked($host, 'partner'); ?>> <?php esc_html_e('Partner site (e.g. the festival site)', 'october-events'); ?></label>
        </p>
        <?php if ($host === 'partner') : ?>
            <p class="description"><?php esc_html_e('Cross-site partner hosting is set up under Settings → Volunteers. Until that’s connected this just flags the location.', 'october-events'); ?></p>
        <?php endif; ?>
        <?php if ($opp) : $s = self::opportunity_summary($opp); ?>
            <p style="border-top:1px solid #f0f0f1;padding-top:8px;margin-top:8px">
                <a href="<?php echo esc_url((string) get_edit_post_link($opp)); ?>"><?php esc_html_e('Edit the volunteer opportunity →', 'october-events'); ?></a><br>
                <span class="description"><?php echo esc_html(sprintf(__('%1$d/%2$d filled', 'october-events'), (int) $s['filled'], (int) $s['capacity'])); ?></span>
            </p>
        <?php else : ?>
            <p class="description"><?php esc_html_e('Tick “Needs volunteers” and Update — an opportunity is created and linked to this location.', 'october-events'); ?></p>
        <?php endif; ?>
        <?php
    }

    public function save_location_meta(int $post_id, $post = null): void {
        // Generic save_post hook — only act on the configured location post type.
        $loc = self::location_post_type();
        if ($loc === '' || get_post_type($post_id) !== $loc) {
            return;
        }
        if (! isset($_POST['oe_loc_vol_nonce']) || ! wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['oe_loc_vol_nonce'])), 'oe_save_loc_vol')) {
            return;
        }
        if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
            return;
        }
        if (! current_user_can('edit_post', $post_id)) {
            return;
        }
        $needs = ! empty($_POST['oe_loc_needs']);
        $host  = (($_POST['oe_loc_host'] ?? 'local') === 'partner') ? 'partner' : 'local';
        $cap   = max(0, (int) ($_POST['oe_loc_capacity'] ?? 0));
        update_post_meta($post_id, '_oe_loc_needs_volunteers', $needs ? '1' : '0');
        update_post_meta($post_id, '_oe_loc_vol_host', $host);
        update_post_meta($post_id, '_oe_loc_vol_capacity', $cap);

        if ($needs && $host === 'local') {
            self::create_or_sync_for_location($post_id, $cap, true);
        } else {
            // Unticked, or handed to the partner site: close any local signups
            // (kept, not deleted, so nothing is lost if it's re-enabled).
            self::close_for_location($post_id);
        }
    }

    /**
     * Public call-out for an event page: lists the event's volunteer
     * opportunities with a link to each. Place `[oe_event_volunteers]` on the
     * event template (defaults to the current event).
     */
    public function render_event_volunteers(array $atts = []): string {
        $atts = shortcode_atts(['event_id' => get_the_ID(), 'title' => __('Volunteer at this event', 'october-events')], $atts, 'oe_event_volunteers');
        $event_id = (int) $atts['event_id'];
        $opps = self::for_event($event_id);
        // Only show published opportunities that are open for signups.
        $cards = '';
        foreach ($opps as $oid) {
            if (get_post_status($oid) !== 'publish') {
                continue;
            }
            $s = self::opportunity_summary($oid);
            $left = max(0, (int) $s['capacity'] - (int) $s['filled']);
            $meta = $s['role'] ? esc_html($s['role']) : '';
            $avail = $s['open'] && $left > 0
                ? esc_html(sprintf(_n('%d spot left', '%d spots left', $left, 'october-events'), $left))
                : esc_html__('Full', 'october-events');
            $cards .= '<a class="oe-evol-card" href="' . esc_url(get_permalink($oid)) . '">'
                . '<span class="oe-evol-title">' . esc_html($s['title']) . '</span>'
                . ($meta ? '<span class="oe-evol-role">' . $meta . '</span>' : '')
                . '<span class="oe-evol-avail">' . $avail . '</span></a>';
        }
        if ($cards === '') {
            return '';
        }
        static $css_done = false;
        $css = '';
        if (! $css_done) {
            $css_done = true;
            $css = '<style>'
                . '.oe-evol{margin:24px 0}.oe-evol-h{font-size:18px;font-weight:800;margin:0 0 12px}'
                . '.oe-evol-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}'
                . '.oe-evol-card{display:block;border:2px solid #111;padding:14px;text-decoration:none;color:#111;background:#fff}'
                . '.oe-evol-card:hover{background:#faf7ee}'
                . '.oe-evol-title{display:block;font-weight:800;font-size:15px;line-height:1.25}'
                . '.oe-evol-role{display:block;font-size:13px;color:#555;margin-top:3px}'
                . '.oe-evol-avail{display:inline-block;margin-top:8px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}'
                . '</style>';
        }
        return $css . '<div class="oe-evol"><h3 class="oe-evol-h">' . esc_html((string) $atts['title']) . '</h3><div class="oe-evol-grid">' . $cards . '</div></div>';
    }

    /**
     * Public grid of all volunteer opportunities tied to a tour location — local
     * ones (this site's locations) and any pulled from a partner tours site. Drop
     * `[oe_location_volunteers]` on the festival page that hosts sign-ups.
     */
    public function render_location_volunteers(array $atts = []): string {
        $atts = shortcode_atts(['title' => __('Volunteer on the tour', 'october-events')], $atts, 'oe_location_volunteers');
        $ids = get_posts([
            'post_type'      => self::slug(),
            'post_status'    => 'publish',
            'posts_per_page' => 200,
            'fields'         => 'ids',
            'orderby'        => 'title',
            'order'          => 'ASC',
            'meta_query'     => [
                'relation' => 'OR',
                ['key' => '_oe_linked_location', 'compare' => 'EXISTS'],
                ['key' => '_oe_remote_ref', 'compare' => 'EXISTS'],
            ],
        ]);
        $cards = '';
        foreach ($ids as $oid) {
            if (get_post_meta($oid, '_oe_signups_open', true) === '0') {
                continue;
            }
            $s = self::opportunity_summary($oid);
            $left = max(0, (int) $s['capacity'] - (int) $s['filled']);
            $avail = $left > 0
                ? esc_html(sprintf(_n('%d spot left', '%d spots left', $left, 'october-events'), $left))
                : esc_html__('Full', 'october-events');
            $cards .= '<a class="oe-evol-card" href="' . esc_url((string) get_permalink($oid)) . '">'
                . '<span class="oe-evol-title">' . esc_html($s['title']) . '</span>'
                . ($s['location'] ? '<span class="oe-evol-role">' . esc_html($s['location']) . '</span>' : '')
                . '<span class="oe-evol-avail">' . $avail . '</span></a>';
        }
        if ($cards === '') {
            return '';
        }
        static $css_done = false;
        $css = '';
        if (! $css_done) {
            $css_done = true;
            $css = '<style>'
                . '.oe-evol{margin:24px 0}.oe-evol-h{font-size:18px;font-weight:800;margin:0 0 12px}'
                . '.oe-evol-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}'
                . '.oe-evol-card{display:block;border:2px solid #111;padding:14px;text-decoration:none;color:#111;background:#fff}'
                . '.oe-evol-card:hover{background:#faf7ee}'
                . '.oe-evol-title{display:block;font-weight:800;font-size:15px;line-height:1.25}'
                . '.oe-evol-role{display:block;font-size:13px;color:#555;margin-top:3px}'
                . '.oe-evol-avail{display:inline-block;margin-top:8px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}'
                . '</style>';
        }
        return $css . '<div class="oe-evol"><h3 class="oe-evol-h">' . esc_html((string) $atts['title']) . '</h3><div class="oe-evol-grid">' . $cards . '</div></div>';
    }

    /**
     * Best-effort normalisation of a shift start string to MySQL DATETIME so
     * reminders can be scheduled. Returns null when it cannot be parsed.
     */
    private static function normalise_datetime(string $start): ?string {
        $start = trim($start);
        if ($start === '') {
            return null;
        }
        $ts = strtotime($start);
        return $ts ? gmdate('Y-m-d H:i:s', $ts) : null;
    }
}
