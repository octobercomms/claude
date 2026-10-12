<?php
declare(strict_types=1);

namespace OE\Planning;

use OE\Settings;

defined('ABSPATH') || exit;

/**
 * Event details metabox (BUILD-PLAN M1.2 — the headline blocker).
 *
 * The one thing that lets a plain WordPress + October Events install hold and
 * edit an event with no JetEngine present. Writes the plugin's own `_oe_plan_*`
 * meta via Planning\Events, so it never touches foreign meta and is safe to run
 * additively over a live site (adoption mode).
 *
 * Carries the base event fields plus the second-tenant base fields (reference
 * number, per-listing brand colour + image, external ticket link). The richer
 * structured fields (link-aware credits, availability, status badge) land in a
 * follow-on; this is the core that unblocks a native install.
 */
final class Metabox {

    private const NONCE = 'oe_event_details_save';

    public static function init(): void {
        add_action('add_meta_boxes', [self::class, 'add']);
        add_action('save_post', [self::class, 'save'], 10, 2);
        add_action('admin_enqueue_scripts', [self::class, 'assets']);
    }

    public static function add(): void {
        $pt = Events::slug();
        if ($pt === '' || ! post_type_exists($pt)) {
            return;
        }
        add_meta_box('oe-event-details', __('Event details', 'october-events'), [self::class, 'render'], $pt, 'normal', 'high');
    }

    /** The media library is needed for the brand-colour image picker. */
    public static function assets(string $hook): void {
        if ($hook !== 'post.php' && $hook !== 'post-new.php') {
            return;
        }
        $screen = get_current_screen();
        if (! $screen || $screen->post_type !== Events::slug()) {
            return;
        }
        wp_enqueue_media();
    }

    public static function render(\WP_Post $post): void {
        $id = (int) $post->ID;
        wp_nonce_field(self::NONCE, self::NONCE);
        $v = static fn(string $f): string => (string) get_post_meta($id, Events::key($f), true);

        $adoption = Settings::adoption_mode();
        if ($adoption) {
            echo '<p class="description" style="margin:0 0 12px">'
                . esc_html__('Adoption mode: these fields are additive. Leave one blank to keep reading the existing (e.g. JetEngine) value.', 'october-events')
                . '</p>';
        }

        echo '<style>.oe-ed-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 18px}.oe-ed-grid .wide{grid-column:1/-1}.oe-ed label{display:block;font-weight:600;margin:0 0 4px}.oe-ed input[type=text],.oe-ed input[type=url],.oe-ed textarea{width:100%}.oe-ed textarea{min-height:80px}.oe-ed .hint{font-weight:400;color:#777}.oe-ed-img{display:flex;align-items:center;gap:10px;margin-top:6px}.oe-ed-img img{max-width:72px;height:auto;border:1px solid #ddd;border-radius:4px}</style>';
        echo '<div class="oe-ed">';
        echo '<div class="oe-ed-grid">';

        self::text('name', __('Event name', 'october-events'), $v('name'), 'e.g. Creative Futures Conference');
        self::text('organiser', __('Organiser', 'october-events'), $v('organiser'), '');
        self::text('start_datetime', __('Start', 'october-events'), $v('start_datetime'), 'YYYY-MM-DD HH:MM');
        self::text('end_datetime', __('End', 'october-events'), $v('end_datetime'), 'YYYY-MM-DD HH:MM');
        self::text('start_time', __('Daily start time (optional)', 'october-events'), $v('start_time'), 'HH:MM');
        self::text('end_time', __('Daily end time (optional)', 'october-events'), $v('end_time'), 'HH:MM');
        self::text('location', __('Location', 'october-events'), $v('location'), '');
        self::text('price', __('Display price', 'october-events'), $v('price'), 'e.g. Free, $45, From $10');

        // Description (wide).
        echo '<p class="wide"><label>' . esc_html__('Description', 'october-events') . '</label>';
        printf('<textarea name="oe_event[description]">%s</textarea></p>', esc_textarea($v('description')));

        echo '</div>'; // grid

        // Second-tenant base fields.
        echo '<hr style="margin:16px 0"><p style="font-weight:700;margin:0 0 8px">' . esc_html__('Listing fields', 'october-events') . '</p>';
        echo '<div class="oe-ed-grid">';
        self::text('event_number', __('Reference number', 'october-events'), $v('event_number'), 'e.g. 013');
        self::color('brand_colour', __('Brand colour', 'october-events'), $v('brand_colour'));
        self::text('ticket_link', __('External ticket link (optional)', 'october-events'), $v('ticket_link'), 'https://…  (blank = native checkout)', 'url');
        self::text('ticket_link_text', __('External link button text', 'october-events'), $v('ticket_link_text'), 'e.g. Book tickets');
        echo '</div>';

        // Structured: availability + preset status badge (no pasted HTML).
        echo '<div class="oe-ed-grid" style="margin-top:12px">';
        echo '<p><label>' . esc_html__('Availability', 'october-events') . '</label>';
        echo '<select name="oe_event[availability]"><option value="">' . esc_html__('Not specified', 'october-events') . '</option>';
        foreach (Events::AVAILABILITY as $k => $lbl) {
            printf('<option value="%s"%s>%s</option>', esc_attr($k), selected($v('availability'), $k, false), esc_html($lbl));
        }
        echo '</select></p>';
        echo '<p><label>' . esc_html__('Status badge (exceptions only)', 'october-events') . '</label>';
        echo '<select name="oe_event[status_preset]"><option value="">' . esc_html__('None (routine)', 'october-events') . '</option>';
        foreach (Events::STATUS_PRESETS as $k => $preset) {
            printf('<option value="%s"%s>%s</option>', esc_attr($k), selected($v('status_preset'), $k, false), esc_html($preset[0]));
        }
        echo '</select></p>';
        echo '</div>';
        echo '<p class="description" style="margin:4px 0 0">' . esc_html__('The preset carries a brand colour and readable text — no pasted HTML. Leave the status as None for a routine listing; availability renders its own note.', 'october-events') . '</p>';

        // Brand colour image.
        $img_id  = (int) $v('brand_colour_image');
        $img_src = $img_id ? wp_get_attachment_image_url($img_id, 'thumbnail') : '';
        echo '<p style="margin-top:12px"><label style="font-weight:600">' . esc_html__('Brand colour image', 'october-events') . '</label>';
        echo '<span class="oe-ed-img" id="oe-ed-img">';
        echo '<img src="' . esc_url((string) $img_src) . '" alt=""' . ($img_src ? '' : ' style="display:none"') . '>';
        echo '<input type="hidden" name="oe_event[brand_colour_image]" id="oe-ed-img-id" value="' . esc_attr((string) ($img_id ?: '')) . '">';
        echo '<button type="button" class="button" id="oe-ed-img-pick">' . esc_html__('Choose image', 'october-events') . '</button>';
        echo '<button type="button" class="button-link" id="oe-ed-img-clear"' . ($img_id ? '' : ' style="display:none"') . '>' . esc_html__('Remove', 'october-events') . '</button>';
        echo '</span></p>';

        // Internal notes.
        echo '<p style="margin-top:12px"><label style="font-weight:600">' . esc_html__('Internal notes (never published)', 'october-events') . '</label>';
        printf('<textarea name="oe_event[notes]" style="width:100%%;min-height:60px">%s</textarea></p>', esc_textarea($v('notes')));

        // Ticket-required flag.
        printf(
            '<p><label><input type="checkbox" name="oe_event[ticket_required]" value="1"%s> %s</label></p>',
            checked($v('ticket_required') === '1', true, false),
            esc_html__('A ticket is required to attend this event', 'october-events')
        );

        echo '</div>'; // .oe-ed

        self::media_script();
    }

    private static function text(string $field, string $label, string $value, string $placeholder, string $type = 'text'): void {
        printf(
            '<p><label>%s</label><input type="%s" name="oe_event[%s]" value="%s" placeholder="%s"></p>',
            esc_html($label),
            esc_attr($type === 'url' ? 'url' : 'text'),
            esc_attr($field),
            esc_attr($value),
            esc_attr($placeholder)
        );
    }

    private static function color(string $field, string $label, string $value): void {
        printf(
            '<p><label>%s</label><input type="text" class="oe-ed-color" name="oe_event[%s]" value="%s" placeholder="#000000" maxlength="7" style="max-width:120px"></p>',
            esc_html($label),
            esc_attr($field),
            esc_attr($value)
        );
    }

    private static function media_script(): void {
        ?>
        <script>
        (function(){
          var pick=document.getElementById('oe-ed-img-pick'),clear=document.getElementById('oe-ed-img-clear'),
              idEl=document.getElementById('oe-ed-img-id'),wrap=document.getElementById('oe-ed-img'),
              img=wrap?wrap.querySelector('img'):null,frame;
          if(!pick||!window.wp||!wp.media)return;
          pick.addEventListener('click',function(e){e.preventDefault();
            frame=frame||wp.media({title:'Select image',multiple:false});
            frame.off('select').on('select',function(){
              var a=frame.state().get('selection').first().toJSON();
              idEl.value=a.id;
              if(img){img.src=(a.sizes&&a.sizes.thumbnail?a.sizes.thumbnail.url:a.url);img.style.display='';}
              if(clear)clear.style.display='';
            });
            frame.open();
          });
          if(clear)clear.addEventListener('click',function(e){e.preventDefault();idEl.value='';if(img){img.src='';img.style.display='none';}clear.style.display='none';});
        })();
        </script>
        <?php
    }

    public static function save(int $post_id, \WP_Post $post): void {
        if ($post->post_type !== Events::slug()) {
            return;
        }
        if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
            return;
        }
        $nonce = isset($_POST[self::NONCE]) ? sanitize_text_field(wp_unslash((string) $_POST[self::NONCE])) : '';
        if ($nonce === '' || ! wp_verify_nonce($nonce, self::NONCE)) {
            return;
        }
        if (! current_user_can('edit_post', $post_id)) {
            return;
        }
        $input = isset($_POST['oe_event']) && is_array($_POST['oe_event']) ? wp_unslash($_POST['oe_event']) : [];
        Events::save_fields($post_id, $input);
    }
}
