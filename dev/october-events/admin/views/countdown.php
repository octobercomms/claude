<?php
/**
 * Countdown image generator — a small tool to build, preview and download the
 * countdown GIF without hand-writing the /?oe_countdown= URL.
 */
defined('ABSPATH') || exit;

$base = home_url('/');
$tz   = wp_timezone_string();
// A sensible default deadline: 5 days out at 10:00, in the site's timezone,
// formatted for <input type="datetime-local"> (no offset — the endpoint reads
// a bare datetime in the site timezone, DST-correct for the chosen date).
$default = (new DateTimeImmutable('+5 days', wp_timezone()))->setTime(10, 0)->format('Y-m-d\TH:i');
?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('Countdown image', 'october-events'); ?></h1>
    <?php \OE\Admin\Admin::bento('countdown'); ?>

    <p class="description" style="max-width:640px">
        <?php echo esc_html(sprintf(
            /* translators: %s: timezone name */
            __('Set a deadline and copy the image URL into your email as an <img>, or download the GIF. The deadline is read in the timezone you pick below (defaults to the site’s, %s).', 'october-events'),
            $tz
        )); ?>
    </p>

    <div style="display:flex;gap:28px;flex-wrap:wrap;align-items:flex-start;margin-top:12px">
        <div style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:18px;min-width:320px">
            <table class="form-table" role="presentation"><tbody>
                <tr>
                    <th scope="row"><label for="oe-cd-deadline"><?php esc_html_e('Deadline', 'october-events'); ?></label></th>
                    <td><input type="datetime-local" id="oe-cd-deadline" value="<?php echo esc_attr($default); ?>"></td>
                </tr>
                <tr>
                    <th scope="row"><label for="oe-cd-tz"><?php esc_html_e('Timezone', 'october-events'); ?></label></th>
                    <td><select id="oe-cd-tz">
                        <?php
                        $common = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'Europe/London', 'UTC'];
                        foreach (array_values(array_unique(array_merge([$tz], $common))) as $z) {
                            printf('<option value="%s"%s>%s</option>', esc_attr($z), selected($z, $tz, false), esc_html($z));
                        }
                        ?>
                    </select></td>
                </tr>
                <tr>
                    <th scope="row"><label for="oe-cd-units"><?php esc_html_e('Show', 'october-events'); ?></label></th>
                    <td><select id="oe-cd-units">
                        <option value="dh"><?php esc_html_e('Days + hours', 'october-events'); ?></option>
                        <option value="dhm"><?php esc_html_e('Days + hours + minutes', 'october-events'); ?></option>
                        <option value="dhms"><?php esc_html_e('Days + hours + minutes + seconds', 'october-events'); ?></option>
                    </select></td>
                </tr>
                <tr>
                    <th scope="row"><label for="oe-cd-label"><?php esc_html_e('Label', 'october-events'); ?></label></th>
                    <td><input type="text" id="oe-cd-label" class="regular-text" placeholder="<?php esc_attr_e('none (optional, e.g. OFFER ENDS IN)', 'october-events'); ?>"></td>
                </tr>
                <tr>
                    <th scope="row"><label for="oe-cd-accent"><?php esc_html_e('Accent colour', 'october-events'); ?></label></th>
                    <td><input type="color" id="oe-cd-accent" value="#C15A2C"></td>
                </tr>
                <tr>
                    <th scope="row"><?php esc_html_e('Style', 'october-events'); ?></th>
                    <td>
                        <label><input type="radio" name="oe-cd-style" value="static" checked> <?php esc_html_e('Static numbers', 'october-events'); ?></label><br>
                        <label><input type="radio" name="oe-cd-style" value="anim"> <?php esc_html_e('Animated clock', 'october-events'); ?></label>
                    </td>
                </tr>
            </tbody></table>
        </div>

        <div style="flex:1;min-width:340px">
            <p><strong><?php esc_html_e('Preview', 'october-events'); ?></strong></p>
            <div style="background:#f3eee1;border:1px solid #e3ded3;border-radius:12px;padding:16px;display:inline-block">
                <img id="oe-cd-preview" alt="<?php esc_attr_e('Countdown preview', 'october-events'); ?>" style="display:block;max-width:100%;width:560px;height:auto">
            </div>

            <p style="margin-top:16px"><strong><?php esc_html_e('Image URL', 'october-events'); ?></strong> <span class="description"><?php esc_html_e('(paste into your email as an image)', 'october-events'); ?></span></p>
            <div style="display:flex;gap:8px;align-items:center;max-width:640px">
                <input type="text" id="oe-cd-url" readonly onfocus="this.select()" style="flex:1;font-size:12px" aria-label="<?php esc_attr_e('Countdown image URL', 'october-events'); ?>">
                <button type="button" class="button" id="oe-cd-copy"><?php esc_html_e('Copy', 'october-events'); ?></button>
                <a class="button button-primary" id="oe-cd-download" download="countdown.gif" href="#"><?php esc_html_e('Download GIF', 'october-events'); ?></a>
            </div>
        </div>
    </div>

    <script>
    (function () {
        var BASE = <?php echo wp_json_encode($base); ?>;
        var el = function (id) { return document.getElementById(id); };
        var deadline = el('oe-cd-deadline'), units = el('oe-cd-units'), label = el('oe-cd-label'),
            accent = el('oe-cd-accent'), tz = el('oe-cd-tz'), img = el('oe-cd-preview'), urlBox = el('oe-cd-url'),
            dl = el('oe-cd-download'), copy = el('oe-cd-copy');

        function style() {
            var r = document.querySelector('input[name="oe-cd-style"]:checked');
            return r ? r.value : 'static';
        }
        // Build the endpoint URL from the form. Bare datetime (no offset) — the
        // endpoint reads it in the site timezone.
        function build(bust) {
            if (!deadline.value) { return ''; }
            var dt = deadline.value.length === 16 ? deadline.value + ':00' : deadline.value;
            var p = new URLSearchParams();
            p.set('oe_countdown', '1');
            p.set('deadline', dt);
            if (units.value) { p.set('units', units.value); }
            if (tz.value) { p.set('tz', tz.value); }
            if (label.value.trim()) { p.set('label', label.value.trim()); }
            if (accent.value) { p.set('accent', accent.value); }
            if (style() === 'anim') { p.set('anim', '1'); }
            if (bust) { p.set('_', String(Date.now())); }
            return BASE + '?' + p.toString();
        }
        function refresh() {
            var clean = build(false);
            urlBox.value = clean;
            var bust = build(true);
            img.src = bust;
            dl.href = bust; // fresh render on download
        }
        [deadline, units, label, accent, tz].forEach(function (n) {
            n.addEventListener('input', refresh);
            n.addEventListener('change', refresh);
        });
        Array.prototype.forEach.call(document.querySelectorAll('input[name="oe-cd-style"]'), function (n) {
            n.addEventListener('change', refresh);
        });
        copy.addEventListener('click', function () {
            var t = urlBox.value; if (!t) { return; }
            var done = function () { var o = copy.textContent; copy.textContent = '<?php echo esc_js(__('Copied', 'october-events')); ?>'; setTimeout(function () { copy.textContent = o; }, 1200); };
            if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t).then(done).catch(function () {}); }
            else { urlBox.focus(); urlBox.select(); try { document.execCommand('copy'); } catch (e) {} done(); }
        });
        refresh();
    })();
    </script>
</div>
