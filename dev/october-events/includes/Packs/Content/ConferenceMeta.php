<?php
declare(strict_types=1);

namespace OE\Packs\Content;

use OE\Packs\Registry;
use OE\PostTypes;

defined('ABSPATH') || exit;

/**
 * Conference pack entry UI (FRONTEND-BUILD slice B).
 *
 * A "Conference content" metabox on the event editor with four repeaters:
 * speakers, past speakers, schedule sessions and accommodation. Stores clean
 * structured rows via Packs\Content\Store (`_oe_conference_*`). The content
 * renders publicly only when the Conference pack is switched on; the box is
 * always available so the data can be prepared first.
 */
final class ConferenceMeta {

    private const NONCE = 'oe_conference_save';
    private const PACK  = 'conference';

    /** Repeater key => [label, columns], columns = col => [label, type]. */
    private static function repeaters(): array {
        return [
            'speakers' => [__('Speakers', 'october-events'), [
                'name'      => [__('Name', 'october-events'), 'text'],
                'title'     => [__('Title / role', 'october-events'), 'text'],
                'photo'     => [__('Photo', 'october-events'), 'image'],
                'linkedin'  => [__('LinkedIn URL', 'october-events'), 'url'],
                'instagram' => [__('Instagram URL', 'october-events'), 'url'],
                'website'   => [__('Website URL', 'october-events'), 'url'],
            ]],
            'past_speakers' => [__('Past speakers', 'october-events'), [
                'name'  => [__('Name', 'october-events'), 'text'],
                'title' => [__('Title / role', 'october-events'), 'text'],
                'photo' => [__('Photo', 'october-events'), 'image'],
            ]],
            'sessions' => [__('Schedule', 'october-events'), [
                'day'   => [__('Day label (e.g. Sat 10 Oct)', 'october-events'), 'text'],
                'time'  => [__('Time', 'october-events'), 'text'],
                'title' => [__('Session', 'october-events'), 'text'],
                'desc'  => [__('Description', 'october-events'), 'textarea'],
            ]],
            'accommodation' => [__('Accommodation', 'october-events'), [
                'name'  => [__('Name', 'october-events'), 'text'],
                'image' => [__('Image', 'october-events'), 'image'],
                'desc'  => [__('Description', 'october-events'), 'textarea'],
                'link'  => [__('Link', 'october-events'), 'url'],
            ]],
        ];
    }

    public static function init(): void {
        add_action('add_meta_boxes', [self::class, 'add']);
        add_action('save_post', [self::class, 'save'], 10, 2);
        add_action('admin_enqueue_scripts', [self::class, 'assets']);
    }

    public static function add(): void {
        $pt = PostTypes::slug('event');
        if ($pt === '' || ! post_type_exists($pt)) {
            return;
        }
        add_meta_box('oe-conference', __('Conference content', 'october-events'), [self::class, 'render'], $pt, 'normal', 'default');
    }

    public static function assets(string $hook): void {
        if ($hook !== 'post.php' && $hook !== 'post-new.php') {
            return;
        }
        $screen = get_current_screen();
        if (! $screen || $screen->post_type !== PostTypes::slug('event')) {
            return;
        }
        wp_enqueue_media();
    }

    public static function render(\WP_Post $post): void {
        $id = (int) $post->ID;
        wp_nonce_field(self::NONCE, self::NONCE);

        echo '<p class="description" style="margin:0 0 10px">';
        echo Registry::enabled($id, self::PACK)
            ? esc_html__('The Conference pack is on, so this content shows on the event page.', 'october-events')
            : esc_html__('Fill this in now; it shows on the event page once the Conference pack is switched on under Capabilities.', 'october-events');
        echo '</p>';

        self::styles();
        echo '<div class="oe-rep-wrap">';
        foreach (self::repeaters() as $key => [$label, $cols]) {
            self::repeater($id, $key, (string) $label, $cols);
        }
        echo '</div>';
        self::script();
    }

    /** One repeater: heading, existing rows, a hidden template, and an Add button. */
    private static function repeater(int $post_id, string $key, string $label, array $cols): void {
        $rows = Store::get($post_id, self::PACK, $key);
        echo '<div class="oe-rep" data-key="' . esc_attr($key) . '">';
        echo '<h4 class="oe-rep__h">' . esc_html($label) . '</h4>';
        echo '<div class="oe-rep__rows">';
        $i = 0;
        foreach ($rows as $row) {
            self::row($key, (int) $i, $cols, is_array($row) ? $row : []);
            $i++;
        }
        echo '</div>';
        // Template row (index placeholder __i__), used by the Add button.
        echo '<script type="text/html" class="oe-rep__tpl">';
        self::row($key, -1, $cols, []);
        echo '</script>';
        echo '<p><button type="button" class="button oe-rep-add">' . esc_html(sprintf(__('Add %s', 'october-events'), $label)) . '</button></p>';
        echo '</div>';
    }

    /** One row of inputs. Index -1 renders the __i__ placeholder (template). */
    private static function row(string $key, int $index, array $cols, array $values): void {
        $idx = $index < 0 ? '__i__' : (string) $index;
        echo '<div class="oe-rep-row">';
        foreach ($cols as $col => [$clabel, $type]) {
            $name = sprintf('oe_conf[%s][%s][%s]', esc_attr($key), $idx, esc_attr($col));
            $val  = $values[$col] ?? '';
            echo '<label class="oe-rep-field oe-rep-field--' . esc_attr($type) . '"><span>' . esc_html((string) $clabel) . '</span>';
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

    private static function styles(): void {
        echo '<style>'
            . '.oe-rep{margin:0 0 20px;padding:0 0 12px;border-bottom:1px solid #e2e4e7}'
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

    private static function script(): void {
        ?>
        <script>
        (function(){
          var wrap = document.querySelector('.oe-rep-wrap');
          if(!wrap) return;
          var counters = {};
          wrap.addEventListener('click', function(e){
            var t = e.target;
            if(t.classList.contains('oe-rep-add')){
              e.preventDefault();
              var rep = t.closest('.oe-rep');
              var key = rep.getAttribute('data-key');
              var tpl = rep.querySelector('.oe-rep__tpl').innerHTML;
              counters[key] = (counters[key]||1000)+1;
              var html = tpl.replace(/__i__/g, counters[key]);
              var holder = document.createElement('div');
              holder.innerHTML = html.trim();
              rep.querySelector('.oe-rep__rows').appendChild(holder.firstChild);
            } else if(t.classList.contains('oe-rep-remove')){
              e.preventDefault();
              var row = t.closest('.oe-rep-row'); if(row) row.remove();
            } else if(t.classList.contains('oe-rep-pick')){
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
            } else if(t.classList.contains('oe-rep-clear')){
              e.preventDefault();
              var f = t.closest('.oe-rep-img');
              f.querySelector('input[type=hidden]').value='';
              var im=f.querySelector('img'); im.src=''; im.style.display='none';
              t.style.display='none';
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
        $nonce = isset($_POST[self::NONCE]) ? sanitize_text_field(wp_unslash((string) $_POST[self::NONCE])) : '';
        if ($nonce === '' || ! wp_verify_nonce($nonce, self::NONCE)) {
            return;
        }
        if (! current_user_can('edit_post', $post_id)) {
            return;
        }
        $input = isset($_POST['oe_conf']) && is_array($_POST['oe_conf']) ? wp_unslash($_POST['oe_conf']) : [];
        foreach (self::repeaters() as $key => [$label, $cols]) {
            $spec = [];
            foreach ($cols as $col => [$clabel, $type]) {
                $spec[$col] = $type;
            }
            Store::save($post_id, self::PACK, $key, $input[$key] ?? [], $spec);
        }
    }
}
