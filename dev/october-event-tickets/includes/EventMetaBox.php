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

        $ticket_types   = $this->get_ticket_types($post->ID);
        $venues         = $this->get_venues($post->ID);
        $checkin_pin    = get_post_meta($post->ID, '_oct_checkin_pin', true);
        ?>
        <div id="oct-metabox-wrap">

            <!-- Ticket Types -->
            <div class="oct-section">
                <h3><?php esc_html_e('Ticket Types', 'october-event-tickets'); ?></h3>
                <p class="description"><?php esc_html_e('Define the ticket types available for this event. Qty Per Purchase is useful for group tickets (e.g., set 2 for "Couples Ticket").', 'october-event-tickets'); ?></p>
                <div id="oct-ticket-types">
                    <?php foreach ($ticket_types as $i => $tt) : ?>
                        <?php $this->render_ticket_type_row($i, $tt); ?>
                    <?php endforeach; ?>
                </div>
                <button type="button" class="button oct-add-ticket-type"><?php esc_html_e('+ Add Ticket Type', 'october-event-tickets'); ?></button>
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
                       value="<?php echo esc_attr((string) $checkin_pin); ?>"
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
        // Nonce check
        if (!isset($_POST['oct_ticket_config_nonce']) ||
            !wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['oct_ticket_config_nonce'])), 'oct_ticket_config_save')) {
            return;
        }

        // Capability check
        if (!current_user_can('edit_post', $post_id)) {
            return;
        }

        // Skip autosave / revisions
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
            $ticket_types[] = [
                'key'              => $key,
                'label'            => $label,
                'description'      => sanitize_textarea_field($tt['description'] ?? ''),
                'price'            => round(floatval($tt['price'] ?? 0), 2),
                'sale_price'       => strlen($tt['sale_price'] ?? '') ? round(floatval($tt['sale_price']), 2) : null,
                'qty_per_purchase' => max(1, intval($tt['qty_per_purchase'] ?? 1)),
                'capacity'         => strlen($tt['capacity'] ?? '') ? max(0, intval($tt['capacity'])) : null,
                'active'           => !empty($tt['active']),
            ];
        }
        update_post_meta($post_id, '_oct_ticket_types', wp_json_encode($ticket_types));

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
}
