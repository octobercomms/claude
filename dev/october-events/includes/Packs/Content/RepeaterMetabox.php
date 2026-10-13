<?php
declare(strict_types=1);

namespace OE\Packs\Content;

use OE\Packs\Registry;
use OE\PostTypes;

defined('ABSPATH') || exit;

/**
 * Shared pack-content entry metabox (FRONTEND-BUILD slices B/C/E).
 *
 * A base for any pack that enters repeater content on the event editor. A
 * subclass declares its box id/title, its pack id and its repeaters; this base
 * renders the add/remove repeaters with media pickers, saves them via Store, and
 * prints its styles + JS once per request (the JS delegates on `document`, so any
 * number of these boxes coexist on one screen). All boxes post under one
 * namespaced field, `oe_rep[{pack}][{key}][{idx}][{col}]`.
 */
abstract class RepeaterMetabox {

    private static bool $styles_printed = false;
    private static bool $script_printed = false;

    /** The metabox DOM id, e.g. 'oe-conference'. */
    abstract protected static function box_id(): string;

    /** The metabox title. */
    abstract protected static function box_title(): string;

    /** The pack id this content belongs to, e.g. 'conference'. */
    abstract protected static function pack(): string;

    /**
     * Repeater spec: key => [label, columns] where columns = col => [label, type]
     * and type is text|textarea|url|image.
     *
     * @return array<string,array{0:string,1:array<string,array{0:string,1:string}>}>
     */
    abstract protected static function repeaters(): array;

    /** Optional lead paragraph; $enabled is whether the pack is on. */
    protected static function intro(bool $enabled): string {
        return '';
    }

    public static function init(): void {
        add_action('add_meta_boxes', [static::class, 'add']);
        add_action('save_post', [static::class, 'save'], 10, 2);
        add_action('admin_enqueue_scripts', [static::class, 'assets']);
    }

    public static function add(): void {
        $pt = PostTypes::slug('event');
        if ($pt === '' || ! post_type_exists($pt)) {
            return;
        }
        add_meta_box(static::box_id(), static::box_title(), [static::class, 'render'], $pt, 'normal', 'default');
    }

    public static function assets(string $hook): void {
        if ($hook !== 'post.php' && $hook !== 'post-new.php') {
            return;
        }
        $screen = get_current_screen();
        if ($screen && $screen->post_type === PostTypes::slug('event')) {
            wp_enqueue_media();
        }
    }

    protected static function nonce_key(): string {
        return static::box_id() . '_save';
    }

    public static function render(\WP_Post $post): void {
        $id = (int) $post->ID;
        wp_nonce_field(static::nonce_key(), static::nonce_key());

        $intro = static::intro(Registry::enabled($id, static::pack()));
        if ($intro !== '') {
            echo '<p class="description" style="margin:0 0 10px">' . esc_html($intro) . '</p>';
        }

        self::print_styles_once();
        echo '<div class="oe-rep-wrap">';
        foreach (static::repeaters() as $key => [$label, $cols]) {
            self::repeater($id, static::pack(), (string) $key, (string) $label, $cols);
        }
        echo '</div>';
        self::print_script_once();
    }

    private static function repeater(int $post_id, string $pack, string $key, string $label, array $cols): void {
        $rows = Store::get($post_id, $pack, $key);
        echo '<div class="oe-rep" data-pack="' . esc_attr($pack) . '" data-key="' . esc_attr($key) . '">';
        echo '<h4 class="oe-rep__h">' . esc_html($label) . '</h4>';
        echo '<div class="oe-rep__rows">';
        $i = 0;
        foreach ($rows as $row) {
            self::row($pack, $key, (string) $i, $cols, is_array($row) ? $row : []);
            $i++;
        }
        echo '</div>';
        echo '<script type="text/html" class="oe-rep__tpl">';
        self::row($pack, $key, '__i__', $cols, []);
        echo '</script>';
        echo '<p><button type="button" class="button oe-rep-add">' . esc_html(sprintf(__('Add %s', 'october-events'), $label)) . '</button></p>';
        echo '</div>';
    }

    private static function row(string $pack, string $key, string $idx, array $cols, array $values): void {
        echo '<div class="oe-rep-row">';
        foreach ($cols as $col => $meta) {
            $clabel = (string) $meta[0];
            $type   = (string) $meta[1];
            $name   = sprintf('oe_rep[%s][%s][%s][%s]', esc_attr($pack), esc_attr($key), $idx, esc_attr((string) $col));
            $val    = $values[$col] ?? '';
            echo '<label class="oe-rep-field oe-rep-field--' . esc_attr($type) . '"><span>' . esc_html($clabel) . '</span>';
            if ($type === 'image') {
                $att = (int) $val;
                $src = $att ? wp_get_attachment_image_url($att, 'thumbnail') : '';
                echo '<span class="oe-rep-img">';
                echo '<img src="' . esc_url((string) $src) . '" alt=""' . ($src ? '' : ' style="display:none"') . '>';
                echo '<input type="hidden" name="' . $name . '" value="' . esc_attr((string) $att) . '">';
                echo '<button type="button" class="button button-small oe-rep-pick">' . esc_html__('Choose', 'october-events') . '</button>';
                echo '<button type="button" class="button-link oe-rep-clear"' . ($att ? '' : ' style="display:none"') . '>' . esc_html__('Remove', 'october-events') . '</button>';
                echo '</span>';
            } elseif ($type === 'textarea') {
                echo '<textarea name="' . $name . '" rows="2">' . esc_textarea((string) $val) . '</textarea>';
            } else {
                $input_type = $type === 'url' ? 'url' : 'text';
                echo '<input type="' . esc_attr($input_type) . '" name="' . $name . '" value="' . esc_attr((string) $val) . '">';
            }
            echo '</label>';
        }
        echo '<button type="button" class="button-link oe-rep-remove" aria-label="' . esc_attr__('Remove row', 'october-events') . '">&times;</button>';
        echo '</div>';
    }

    private static function print_styles_once(): void {
        if (self::$styles_printed) {
            return;
        }
        self::$styles_printed = true;
        echo '<style>'
            . '.oe-rep{margin:0 0 20px;padding:0 0 12px;border-bottom:1px solid #e2e4e7}'
            . '.oe-rep:last-child{border-bottom:0}'
            . '.oe-rep__h{margin:0 0 8px;font-size:13px}'
            . '.oe-rep-row{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:flex-start;padding:10px;margin:0 0 8px;background:#f6f7f7;border-radius:6px;position:relative}'
            . '.oe-rep-field{display:flex;flex-direction:column;gap:3px;font-size:11px;font-weight:600;color:#555;flex:1 1 160px}'
            . '.oe-rep-field--textarea{flex-basis:100%}'
            . '.oe-rep-field input,.oe-rep-field textarea{width:100%;font-weight:400}'
            . '.oe-rep-img{display:flex;align-items:center;gap:6px;flex-wrap:wrap}'
            . '.oe-rep-img img{max-width:48px;height:auto;border:1px solid #ddd;border-radius:4px}'
            . '.oe-rep-remove{position:absolute;top:6px;right:8px;text-decoration:none;color:#b32d2e;font-size:18px;line-height:1}'
            . '</style>';
    }

    private static function print_script_once(): void {
        if (self::$script_printed) {
            return;
        }
        self::$script_printed = true;
        ?>
        <script>
        (function(){
          if (window.__oeRepBound) return;
          window.__oeRepBound = true;
          document.addEventListener('click', function(e){
            var t = e.target;
            if (t.classList.contains('oe-rep-add')) {
              e.preventDefault();
              var rep = t.closest('.oe-rep'); if(!rep) return;
              var next = parseInt(rep.getAttribute('data-next') || '1000', 10) + 1;
              rep.setAttribute('data-next', next);
              var html = rep.querySelector('.oe-rep__tpl').innerHTML.replace(/__i__/g, next);
              var holder = document.createElement('div');
              holder.innerHTML = html.trim();
              rep.querySelector('.oe-rep__rows').appendChild(holder.firstChild);
            } else if (t.classList.contains('oe-rep-remove')) {
              e.preventDefault();
              var row = t.closest('.oe-rep-row'); if(row) row.remove();
            } else if (t.classList.contains('oe-rep-pick')) {
              e.preventDefault();
              if(!window.wp || !wp.media) return;
              var field = t.closest('.oe-rep-img');
              var frame = wp.media({title:'Select image', multiple:false});
              frame.on('select', function(){
                var a = frame.state().get('selection').first().toJSON();
                field.querySelector('input[type=hidden]').value = a.id;
                var img = field.querySelector('img');
                img.src = (a.sizes && a.sizes.thumbnail ? a.sizes.thumbnail.url : a.url);
                img.style.display = '';
                var clr = field.querySelector('.oe-rep-clear'); if(clr) clr.style.display='';
              });
              frame.open();
            } else if (t.classList.contains('oe-rep-clear')) {
              e.preventDefault();
              var f = t.closest('.oe-rep-img');
              f.querySelector('input[type=hidden]').value = '';
              var im = f.querySelector('img'); im.src=''; im.style.display='none';
              t.style.display = 'none';
            }
          });
        })();
        </script>
        <?php
    }

    public static function save(int $post_id, \WP_Post $post): void {
        if ($post->post_type !== PostTypes::slug('event')) {
            return;
        }
        if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
            return;
        }
        $nonce = isset($_POST[static::nonce_key()]) ? sanitize_text_field(wp_unslash((string) $_POST[static::nonce_key()])) : '';
        if ($nonce === '' || ! wp_verify_nonce($nonce, static::nonce_key())) {
            return;
        }
        if (! current_user_can('edit_post', $post_id)) {
            return;
        }
        $all  = isset($_POST['oe_rep']) && is_array($_POST['oe_rep']) ? wp_unslash($_POST['oe_rep']) : [];
        $mine = isset($all[static::pack()]) && is_array($all[static::pack()]) ? $all[static::pack()] : [];
        foreach (static::repeaters() as $key => [$label, $cols]) {
            $spec = [];
            foreach ($cols as $col => $meta) {
                $spec[$col] = (string) $meta[1];
            }
            Store::save($post_id, static::pack(), (string) $key, $mine[$key] ?? [], $spec);
        }
    }
}
