<?php
declare(strict_types=1);

namespace OctoberTickets;

defined('ABSPATH') || exit;

/**
 * Adds "Ticket Configuration" meta box to the events CPT (JetEngine slug: events).
 */
class EventMetaBox {

    private static ?EventMetaBox $instance = null;

    private function __construct() {}

    public static function get_instance(): self {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function init(): void {
        add_action('add_meta_boxes', [$this, 'register_meta_boxes']);
        add_action('save_post_events', [$this, 'save_meta_box'], 10, 2);
        add_action('admin_enqueue_scripts', [$this, 'enqueue_admin_assets']);
    }

    public function enqueue_admin_assets(string $hook): void {
        global $post;
        if (!in_array($hook, ['post.php', 'post-new.php'], true)) {
            return;
        }
        if (!$post || $post->post_type !== 'events') {
            return;
        }

        wp_enqueue_style(
            'oct-admin-metabox',
            OCT_TICKETS_URL . 'assets/css/admin-metabox.css',
            [],
            OCT_TICKETS_VERSION
        );

        wp_enqueue_script(
            'oct-admin-metabox',
            OCT_TICKETS_URL . 'assets/js/admin-metabox.js',
            ['jquery'],
            OCT_TICKETS_VERSION,
            true
        );
    }

    public function register_meta_boxes(): void {
        add_meta_box(
            'oct_ticket_config',
            __('Ticket Configuration', 'october-event-tickets'),
            [$this, 'render_meta_box'],
            'events',
            'normal',
            'high'
        );
    }

    public function render_meta_box(\WP_Post $post): void {
        wp_nonce_field('oct_ticket_config_save', 'oct_ticket_config_nonce');

        $ticket_types    = $this->get_ticket_types($post->ID);
        $venues          = $this->get_venues($post->ID);
        $checkin_pin     = get_post_meta($post->ID, '_oct_checkin_pin', true);
        $event_sale_until = get_post_meta($post->ID, '_oct_tickets_sale_until', true);

        // Format datetime-local value (Y-m-d\TH:i)
        $event_sale_until_fmt = $event_sale_until
            ? date('Y-m-d\TH:i', strtotime($event_sale_until))
            : '';
        ?>
        <div id="oct-metabox-wrap">

            <!-- Ticket Types -->
            <div class="oct-section">
                <h3><?php esc_html_e('Ticket Types', 'october-event-tickets'); ?></h3>
                <p class="description"><?php esc_html_e('Define the ticket types available for this event. Qty Per Purchase is useful for group tickets (e.g., set 2 for "Couples Ticket"). Sale Opens/Closes control when each ticket type is purchasable — if Opens is in the future the buyer sees "Opens [date]" instead of the buy button.', 'october-event-tickets'); ?></p>
                <div id="oct-ticket-types">
                    <?php foreach ($ticket_types as $i => $tt) : ?>
                        <?php $this->render_ticket_type_row($i, $tt); ?>
                    <?php endforeach; ?>
                </div>
                <button type="button" class="button oct-add-ticket-type"><?php esc_html_e('+ Add Ticket Type', 'october-event-tickets'); ?></button>
            </div>

            <hr>

            <!-- Event-wide ticket sale period -->
            <div class="oct-section">
                <h3><?php esc_html_e('Event Sale Close', 'october-event-tickets'); ?></h3>
                <p class="description"><?php esc_html_e('After this date and time the entire checkout form closes, regardless of individual ticket type settings. Leave blank to keep sales open indefinitely.', 'october-event-tickets'); ?></p>
                <label>
                    <?php esc_html_e('Stop selling tickets on:', 'october-event-tickets'); ?>
                    <input type="datetime-local"
                           name="oct_tickets_sale_until"
                           id="oct_tickets_sale_until"
                           value="<?php echo esc_attr($event_sale_until_fmt); ?>"
                           style="margin-left:8px;" />
                </label>
            </div>

            <hr>

            <!-- Check-in Venues -->
            <div class="oct-section">
                <h3><?php esc_html_e('Check-in Venues', 'october-event-tickets'); ?></h3>
                <p class="description"><?php esc_html_e('Add venue names (e.g. "Home 1 - 123 Peachtree St"). Staff select one when using the check-in app.', 'october-event-tickets'); ?></p>
                <div id="oct-venues">
                    <?php foreach ($venues as $i => $venue) : ?>
                        <?php $this->render_venue_row($i, $venue); ?>
                    <?php endforeach; ?>
                </div>
                <button type="button" class="button oct-add-venue"><?php esc_html_e('+ Add Venue', 'october-event-tickets'); ?></button>
            </div>

            <hr>

            <!-- Check-in PIN -->
            <div class="oct-section">
                <h3><?php esc_html_e('Check-in PIN', 'october-event-tickets'); ?></h3>
                <p class="description"><?php esc_html_e('4–6 digit PIN that staff must enter to access the check-in app for this event.', 'october-event-tickets'); ?></p>
                <input type="text"
                       name="oct_checkin_pin"
                       id="oct_checkin_pin"
                       value="<?php echo esc_attr($checkin_pin !== '' && $checkin_pin !== false ? (string) $checkin_pin : (string) $post->ID); ?>"
                       maxlength="6"
                       pattern="[0-9]{4,6}"
                       placeholder="e.g. 1234"
                       class="small-text"
                />
            </div>

        </div>

        <!-- Hidden template for JS repeaters -->
        <script type="text/html" id="oct-ticket-type-template">
            <?php $this->render_ticket_type_row('{{INDEX}}', []); ?>
        </script>
        <script type="text/html" id="oct-venue-template">
            <?php $this->render_venue_row('{{INDEX}}', []); ?>
        </script>
        <?php
    }

    private function render_ticket_type_row($index, array $tt): void {
        $key         = esc_attr($tt['key'] ?? '');
        $label       = esc_attr($tt['label'] ?? '');
        $description = esc_attr($tt['description'] ?? '');
        $price       = esc_attr($tt['price'] ?? '');
        $sale_price  = esc_attr($tt['sale_price'] ?? '');
        $qty_pp      = esc_attr($tt['qty_per_purchase'] ?? '1');
        $capacity    = esc_attr($tt['capacity'] ?? '');
        $active      = isset($tt['active']) ? (bool) $tt['active'] : true;
        $idx         = $index;

        // Format datetime-local values (Y-m-d\TH:i)
        $sale_from_fmt  = !empty($tt['sale_from'])
            ? esc_attr(date('Y-m-d\TH:i', strtotime($tt['sale_from'])))
            : '';
        $sale_until_fmt = !empty($tt['sale_until'])
            ? esc_attr(date('Y-m-d\TH:i', strtotime($tt['sale_until'])))
            : '';
        ?>
        <div class="oct-repeater-row oct-ticket-type-row" data-index="<?php echo esc_attr((string)$idx); ?>">
            <div class="oct-row-handle">&#9776;</div>
            <div class="oct-row-fields">
                <div class="oct-field-grid">
                    <label><?php esc_html_e('Label', 'october-event-tickets'); ?>
                        <input type="text" name="oct_ticket_types[<?php echo $idx; ?>][label]"
                               value="<?php echo $label; ?>" placeholder="e.g. General Admission"
                               class="oct-tt-label" required />
                    </label>
                    <label><?php esc_html_e('Key', 'october-event-tickets'); ?>
                        <input type="text" name="oct_ticket_types[<?php echo $idx; ?>][key]"
                               value="<?php echo $key; ?>" placeholder="auto-generated"
                               class="oct-tt-key" />
                    </label>
                    <label><?php esc_html_e('Price ($)', 'october-event-tickets'); ?>
                        <input type="number" name="oct_ticket_types[<?php echo $idx; ?>][price]"
                               value="<?php echo $price; ?>" min="0" step="0.01" placeholder="0.00" />
                    </label>
                    <label><?php esc_html_e('Sale Price ($)', 'october-event-tickets'); ?>
                        <input type="number" name="oct_ticket_types[<?php echo $idx; ?>][sale_price]"
                               value="<?php echo $sale_price; ?>" min="0" step="0.01" placeholder="Optional" />
                    </label>
                    <label><?php esc_html_e('Qty Per Purchase', 'october-event-tickets'); ?>
                        <input type="number" name="oct_ticket_types[<?php echo $idx; ?>][qty_per_purchase]"
                               value="<?php echo $qty_pp; ?>" min="1" max="20" />
                    </label>
                    <label><?php esc_html_e('Capacity', 'october-event-tickets'); ?>
                        <input type="number" name="oct_ticket_types[<?php echo $idx; ?>][capacity]"
                               value="<?php echo $capacity; ?>" min="0" placeholder="Unlimited" />
                    </label>
                    <label><?php esc_html_e('Sale Opens', 'october-event-tickets'); ?>
                        <input type="datetime-local" name="oct_ticket_types[<?php echo $idx; ?>][sale_from]"
                               value="<?php echo $sale_from_fmt; ?>" />
                        <span class="description"><?php esc_html_e('Leave blank = on sale immediately', 'october-event-tickets'); ?></span>
                    </label>
                    <label><?php esc_html_e('Sale Closes', 'october-event-tickets'); ?>
                        <input type="datetime-local" name="oct_ticket_types[<?php echo $idx; ?>][sale_until]"
                               value="<?php echo $sale_until_fmt; ?>" />
                        <span class="description"><?php esc_html_e('Leave blank = no end date', 'october-event-tickets'); ?></span>
                    </label>
                </div>
                <label><?php esc_html_e('Description', 'october-event-tickets'); ?>
                    <textarea name="oct_ticket_types[<?php echo $idx; ?>][description]"
                              rows="2" class="large-text"><?php echo $description; ?></textarea>
                </label>
                <label class="oct-toggle">
                    <input type="checkbox" name="oct_ticket_types[<?php echo $idx; ?>][active]"
                           value="1" <?php checked($active); ?> />
                    <?php esc_html_e('Active', 'october-event-tickets'); ?>
                </label>
            </div>
            <button type="button" class="button-link oct-remove-row" title="<?php esc_attr_e('Remove', 'october-event-tickets'); ?>">&#10005;</button>
        </div>
        <?php
    }

    private function render_venue_row($index, $venue): void {
        $name = is_array($venue) ? esc_attr($venue['name'] ?? '') : esc_attr((string)$venue);
        $idx  = $index;
        ?>
        <div class="oct-repeater-row oct-venue-row" data-index="<?php echo esc_attr((string)$idx); ?>">
            <div class="oct-row-handle">&#9776;</div>
            <div class="oct-row-fields">
                <input type="text" name="oct_venues[<?php echo $idx; ?>][name]"
                       value="<?php echo $name; ?>"
                       placeholder="<?php esc_attr_e('Venue name, e.g. Home 1 - 123 Peachtree St', 'october-event-tickets'); ?>"
                       class="large-text" />
            </div>
            <button type="button" class="button-link oct-remove-row" title="<?php esc_attr_e('Remove', 'october-event-tickets'); ?>">&#10005;</button>
        </div>
        <?php
    }

    public function save_meta_box(int $post_id, \WP_Post $post): void {
        if (!isset($_POST['oct_ticket_config_nonce']) ||
            !wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['oct_ticket_config_nonce'])), 'oct_ticket_config_save')) {
            return;
        }

        if (!current_user_can('edit_post', $post_id)) {
            return;
        }

        if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
            return;
        }
        if ($post->post_status === 'auto-draft') {
            return;
        }

        // Save ticket types
        $raw_types = isset($_POST['oct_ticket_types']) ? (array) $_POST['oct_ticket_types'] : [];
        $ticket_types = [];
        foreach ($raw_types as $tt) {
            if (empty($tt['label'])) {
                continue;
            }
            $label = sanitize_text_field($tt['label']);
            $key   = !empty($tt['key']) ? sanitize_title($tt['key']) : sanitize_title($label);

            // Parse and validate datetime-local values → store as Y-m-d H:i:s
            $sale_from  = $this->parse_datetime_local($tt['sale_from'] ?? '');
            $sale_until = $this->parse_datetime_local($tt['sale_until'] ?? '');

            $ticket_types[] = [
                'key'              => $key,
                'label'            => $label,
                'description'      => sanitize_textarea_field($tt['description'] ?? ''),
                'price'            => round(floatval($tt['price'] ?? 0), 2),
                'sale_price'       => strlen($tt['sale_price'] ?? '') ? round(floatval($tt['sale_price']), 2) : null,
                'qty_per_purchase' => max(1, intval($tt['qty_per_purchase'] ?? 1)),
                'capacity'         => strlen($tt['capacity'] ?? '') ? max(0, intval($tt['capacity'])) : null,
                'active'           => !empty($tt['active']),
                'sale_from'        => $sale_from,
                'sale_until'       => $sale_until,
            ];
        }
        update_post_meta($post_id, '_oct_ticket_types', wp_json_encode($ticket_types));

        // Save event-wide sale close date
        $event_sale_until = $this->parse_datetime_local(sanitize_text_field($_POST['oct_tickets_sale_until'] ?? ''));
        update_post_meta($post_id, '_oct_tickets_sale_until', $event_sale_until);

        // Save venues
        $raw_venues = isset($_POST['oct_venues']) ? (array) $_POST['oct_venues'] : [];
        $venues = [];
        foreach ($raw_venues as $v) {
            $name = sanitize_text_field($v['name'] ?? '');
            if ($name !== '') {
                $venues[] = ['name' => $name];
            }
        }
        update_post_meta($post_id, '_oct_checkin_venues', wp_json_encode($venues));

        // Save PIN
        $pin = preg_replace('/[^0-9]/', '', sanitize_text_field($_POST['oct_checkin_pin'] ?? ''));
        if (strlen($pin) >= 4 && strlen($pin) <= 6) {
            update_post_meta($post_id, '_oct_checkin_pin', $pin);
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * Convert a datetime-local string (Y-m-d\TH:i) to MySQL datetime (Y-m-d H:i:s).
     * Returns empty string if invalid or blank.
     */
    private function parse_datetime_local(string $value): string {
        $value = trim($value);
        if ($value === '') {
            return '';
        }
        $ts = strtotime($value);
        return $ts ? date('Y-m-d H:i:s', $ts) : '';
    }

    public function get_ticket_types(int $post_id): array {
        $raw = get_post_meta($post_id, '_oct_ticket_types', true);
        if (!$raw) {
            return [];
        }
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }

    public function get_venues(int $post_id): array {
        $raw = get_post_meta($post_id, '_oct_checkin_venues', true);
        if (!$raw) {
            return [];
        }
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }

    public function get_ticket_type_by_key(int $post_id, string $key): ?array {
        foreach ($this->get_ticket_types($post_id) as $tt) {
            if ($tt['key'] === $key) {
                return $tt;
            }
        }
        return null;
    }

    /**
     * Get event-wide sale close datetime string (MySQL format), or '' if not set.
     */
    public function get_event_sale_until(int $post_id): string {
        return (string) get_post_meta($post_id, '_oct_tickets_sale_until', true);
    }

    /**
     * Compute the availability status of a ticket type.
     *
     * Returns array with:
     *   status: 'available' | 'coming_soon' | 'sale_ended' | 'sold_out' | 'unavailable'
     *   opens_formatted: (only when coming_soon) human-readable opening date
     */
    public function get_ticket_availability(array $tt, int $event_id): array {
        if (empty($tt['active'])) {
            return ['status' => 'unavailable'];
        }

        $now = current_time('timestamp');

        if (!empty($tt['sale_from'])) {
            $sale_from = strtotime($tt['sale_from']);
            if ($sale_from && $now < $sale_from) {
                return [
                    'status'          => 'coming_soon',
                    'opens_formatted' => date_i18n(
                        get_option('date_format') . ' ' . get_option('time_format'),
                        $sale_from
                    ),
                ];
            }
        }

        if (!empty($tt['sale_until'])) {
            $sale_until = strtotime($tt['sale_until']);
            if ($sale_until && $now > $sale_until) {
                return ['status' => 'sale_ended'];
            }
        }

        if (!empty($tt['capacity'])) {
            $sold = DB::get_tickets_sold_count($event_id, $tt['key']);
            if ($sold >= (int) $tt['capacity']) {
                return ['status' => 'sold_out'];
            }
        }

        return ['status' => 'available'];
    }
}
