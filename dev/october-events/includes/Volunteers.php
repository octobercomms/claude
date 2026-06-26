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

    public function init(): void {
        add_action('init', [$this, 'register_meta'], 30);
        // Front-end signup widget for the opportunity page (hybrid: Elementor
        // renders the listing, this shortcode provides the signup table).
        add_shortcode('oe_volunteer_signup', [$this, 'render_signup_widget']);
        // Surfaces an event's linked volunteer opportunities on its public page.
        add_shortcode('oe_event_volunteers', [$this, 'render_event_volunteers']);

        if (is_admin()) {
            add_action('add_meta_boxes', [$this, 'add_meta_box']);
            add_action('add_meta_boxes', [$this, 'add_event_meta_box']);
            add_action('save_post_' . self::slug(), [$this, 'save_meta']);
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

        $lines = [];
        foreach (self::shifts($post->ID) as $s) {
            $lines[] = implode(' | ', [$s['label'], $s['start'], $s['end'], $s['capacity']]);
        }
        ?>
        <p><label><strong><?php esc_html_e('Linked event', 'october-events'); ?></strong> — <span class="description"><?php esc_html_e('optional; reuses the event\'s location and shows a “Volunteer” call-out on the event page', 'october-events'); ?></span><br>
            <select name="oe_linked_event" class="widefat">
                <option value="0"><?php esc_html_e('— Not linked to an event —', 'october-events'); ?></option>
                <?php foreach ($events as $ev) : ?>
                    <option value="<?php echo (int) $ev->ID; ?>" <?php selected($linked, (int) $ev->ID); ?>><?php echo esc_html(get_the_title($ev)); ?></option>
                <?php endforeach; ?>
            </select></label></p>
        <p><label><strong><?php esc_html_e('Role', 'october-events'); ?></strong><br>
            <input type="text" name="oe_role" class="widefat" value="<?php echo esc_attr($role); ?>" placeholder="e.g. Meet &amp; Greet Host"></label></p>
        <p><label><strong><?php esc_html_e('Location', 'october-events'); ?></strong><br>
            <input type="text" name="oe_location" class="widefat" value="<?php echo esc_attr($location); ?>" placeholder="<?php echo $event_loc !== '' ? esc_attr(sprintf(__('Inherits from event: %s', 'october-events'), $event_loc)) : ''; ?>"></label>
            <?php if ($event_loc !== '') : ?><span class="description"><?php esc_html_e('Leave blank to use the linked event\'s location.', 'october-events'); ?></span><?php endif; ?></p>
        <p><label><input type="checkbox" name="oe_signups_open" value="1" <?php checked($open, 1); ?>> <?php esc_html_e('Signups open', 'october-events'); ?></label></p>
        <p><label><strong><?php esc_html_e('Shifts', 'october-events'); ?></strong> — <?php esc_html_e('one per line:', 'october-events'); ?>
            <code>Label | start datetime | end datetime | capacity</code></label></p>
        <textarea name="oe_shifts" rows="5" class="widefat" placeholder="Sun Sept 28 — 10:30am–1:00pm | 2026-09-28 10:30 | 2026-09-28 13:00 | 3"><?php echo esc_textarea(implode("\n", $lines)); ?></textarea>
        <p class="description"><?php esc_html_e('Start/end accept any clear date-time (used to schedule reminders). Changing a shift label keeps existing signups attached.', 'october-events'); ?></p>
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

        update_post_meta($post_id, '_oe_role', sanitize_text_field((string) ($_POST['oe_role'] ?? '')));
        update_post_meta($post_id, '_oe_location', sanitize_text_field((string) ($_POST['oe_location'] ?? '')));
        update_post_meta($post_id, '_oe_signups_open', empty($_POST['oe_signups_open']) ? '0' : '1');
        update_post_meta($post_id, '_oe_linked_event', absint($_POST['oe_linked_event'] ?? 0));

        // Preserve shift ids by matching labels to the existing set.
        $existing = [];
        foreach (self::shifts($post_id) as $s) {
            $existing[$s['label']] = $s['id'];
        }

        $raw = (string) wp_unslash($_POST['oe_shifts'] ?? '');
        $shifts = [];
        foreach (preg_split('/\r\n|\r|\n/', $raw) as $line) {
            $line = trim($line);
            if ($line === '') {
                continue;
            }
            $parts = array_map('trim', explode('|', $line));
            $label = $parts[0] ?? '';
            if ($label === '') {
                continue;
            }
            $shifts[] = [
                'id'       => $existing[$label] ?? wp_generate_password(8, false),
                'label'    => $label,
                'start'    => $parts[1] ?? '',
                'end'      => $parts[2] ?? '',
                'capacity' => (int) ($parts[3] ?? 0),
            ];
        }
        self::set_shifts($post_id, $shifts);
    }

    public function register_meta(): void {
        $slug = self::slug();
        foreach ([
            '_oe_role'         => 'string',
            '_oe_location'     => 'string',
            '_oe_signups_open' => 'boolean',
            '_oe_linked_event' => 'integer',
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
        return $event ? (string) \OE\Planning\Events::get($event, 'location', '') : '';
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

        $id = VolunteerSignups::insert([
            'opportunity_id' => $opportunity_id,
            'shift_id'       => $shift_id,
            'account_id'     => $account_id ?: null,
            'name'           => $name,
            'email'          => $email,
            'phone'          => sanitize_text_field((string) ($person['phone'] ?? '')),
            'sms_opt_in'     => ! empty($person['sms_opt_in']) ? 1 : 0,
            'status'         => VolunteerSignups::STATUS_PENDING,
            'shift_start'    => self::normalise_datetime((string) $shift['start']),
            'reminders_sent' => '',
        ]);

        AuditLog::record('volunteer_signup', $opportunity_id, 'volunteer', 'shift:' . $shift_id);

        // Native contacts (the Brevo replacement).
        \OE\Mail\Contacts::capture($email, [
            'name'       => $name,
            'phone'      => (string) ($person['phone'] ?? ''),
            'sms_opt_in' => ! empty($person['sms_opt_in']) ? 1 : 0,
            'source'     => 'volunteer',
        ]);

        // "On signup" confirmation + schedule the rest (§reminders).
        Reminders::on_signup($id);

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
        $wpdb->delete(VolunteerSignups::table(), ['id' => $signup_id]);
        AuditLog::record('volunteer_signup_removed', $signup_id, 'volunteer');
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
        ]);

        AuditLog::record('volunteer_signup_manual', $opportunity_id, 'volunteer', 'shift:' . $shift_id);
        Reminders::on_signup($id);
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
        $filled   = 0;
        foreach ($shifts as $s) {
            $capacity += (int) $s['capacity'];
            $filled   += VolunteerSignups::count_for_shift($id, $s['id']);
        }
        $pending = 0;
        foreach (VolunteerSignups::for_opportunity($id) as $row) {
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
        $summary  = self::opportunity_summary($id);
        $by_shift = [];
        foreach (VolunteerSignups::for_opportunity($id) as $row) {
            $by_shift[$row->shift_id][] = self::signup_dto($row);
        }
        $shifts = [];
        foreach (self::shifts($id) as $s) {
            $shifts[] = [
                'id'         => $s['id'],
                'label'      => $s['label'],
                'start'      => $s['start'],
                'end'        => $s['end'],
                'capacity'   => (int) $s['capacity'],
                'spots_left' => self::spots_left($id, $s['id']),
                'full'       => self::shift_full($id, $s['id']),
                'signups'    => $by_shift[$s['id']] ?? [],
            ];
        }
        $summary['shifts_detail'] = $shifts;
        return $summary;
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
        $shift = self::shift((int) $signup->opportunity_id, $signup->shift_id);
        return [
            'name'        => $signup->name,
            'opportunity' => get_the_title((int) $signup->opportunity_id),
            'shift'       => $shift['label'] ?? '',
            'location'    => self::location((int) $signup->opportunity_id),
            'url'         => get_permalink((int) $signup->opportunity_id),
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
