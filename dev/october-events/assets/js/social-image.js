/* Social image suite: from an event's featured image, render branded graphics at
 * each platform size on a <canvas> and offer each as a PNG download. All client
 * side — no server image libraries, no external API.
 */
(function () {
    'use strict';

    var SIZES = [
        { key: 'ig-square',   w: 1080, h: 1080, label: 'Instagram square' },
        { key: 'ig-portrait', w: 1080, h: 1350, label: 'Instagram portrait' },
        { key: 'story',       w: 1080, h: 1920, label: 'Story (IG / FB / LinkedIn)' },
        { key: 'landscape',   w: 1200, h: 630,  label: 'Facebook / LinkedIn' }
    ];

    function ready(fn) {
        if (document.readyState !== 'loading') { fn(); }
        else { document.addEventListener('DOMContentLoaded', fn); }
    }

    ready(function () {
        var box = document.getElementById('oe-imgsuite');
        if (!box) { return; }
        var btn = document.getElementById('oe-imgsuite-build');
        var msg = document.getElementById('oe-imgsuite-msg');
        var out = document.getElementById('oe-imgsuite-out');
        if (!btn) { return; }

        var cfg = {
            img:       box.getAttribute('data-img') || '',
            title:     box.getAttribute('data-title') || '',
            date:      box.getAttribute('data-date') || '',
            accent:    box.getAttribute('data-accent') || '#111111',
            accentOn:  box.getAttribute('data-accent-on') || '#ffffff',
            site:      (box.getAttribute('data-site') || '').toUpperCase()
        };

        var objectUrls = [];
        function clearCards() {
            objectUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
            objectUrls = [];
            out.innerHTML = '';
        }

        btn.addEventListener('click', function () {
            if (!cfg.img) { setMsg('Set a featured image on the event first, then save.', true); return; }
            btn.disabled = true; setMsg('Building…', false);
            var img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = function () {
                clearCards();
                SIZES.forEach(function (s) { renderCard(img, s); });
                setMsg('Done. Download each below.', false);
                btn.disabled = false;
            };
            img.onerror = function () {
                btn.disabled = false;
                setMsg('Couldn’t load the featured image (it may be on another domain). Try a media-library image.', true);
            };
            img.src = cfg.img;
        });

        function setMsg(t, err) {
            msg.textContent = t;
            msg.style.color = err ? '#b32d2e' : '#50575e';
        }

        function renderCard(img, size) {
            var cv = document.createElement('canvas');
            cv.width = size.w; cv.height = size.h;
            var ctx = cv.getContext('2d');
            drawCover(ctx, img, size.w, size.h);
            drawScrim(ctx, size.w, size.h);
            drawText(ctx, size.w, size.h);

            var wrap = document.createElement('div');
            wrap.className = 'oe-imgsuite-item';
            var prev = document.createElement('img');
            prev.className = 'oe-imgsuite-prev';
            prev.alt = size.label;
            cv.toBlob(function (blob) {
                var url;
                if (blob) {
                    url = URL.createObjectURL(blob);
                    objectUrls.push(url);
                } else {
                    try { url = cv.toDataURL('image/png'); }
                    catch (e) { setMsg('Couldn’t export the image (the featured image may be on another domain without CORS).', true); return; }
                }
                prev.src = url;
                dl.href = url;
            }, 'image/png');
            var cap = document.createElement('div');
            cap.className = 'oe-imgsuite-cap';
            cap.textContent = size.label + ' · ' + size.w + '×' + size.h;
            var dl = document.createElement('a');
            dl.className = 'button button-small oe-imgsuite-dl';
            dl.textContent = 'Download';
            dl.download = slug(cfg.title) + '-' + size.key + '.png';
            // The href is set once the PNG has encoded (toBlob is async); until
            // then a click would just navigate the editor, so swallow it.
            dl.addEventListener('click', function (e) { if (!dl.getAttribute('href')) { e.preventDefault(); } });
            wrap.appendChild(prev);
            wrap.appendChild(cap);
            wrap.appendChild(dl);
            out.appendChild(wrap);
        }

        /* cover-fit the photo across the whole canvas */
        function drawCover(ctx, img, w, h) {
            var ir = img.width / img.height, cr = w / h, dw, dh, dx, dy;
            if (ir > cr) { dh = h; dw = h * ir; dx = (w - dw) / 2; dy = 0; }
            else { dw = w; dh = w / ir; dx = 0; dy = (h - dh) / 2; }
            ctx.drawImage(img, dx, dy, dw, dh);
        }

        /* dark gradient at the foot so text is always legible */
        function drawScrim(ctx, w, h) {
            var g = ctx.createLinearGradient(0, h * 0.35, 0, h);
            g.addColorStop(0, 'rgba(0,0,0,0)');
            g.addColorStop(1, 'rgba(0,0,0,0.78)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, w, h);
        }

        function drawText(ctx, w, h) {
            var pad = Math.round(w * 0.07);
            var maxW = w - pad * 2;

            // Site tag, top-left.
            if (cfg.site) {
                ctx.textBaseline = 'top';
                ctx.textAlign = 'left';
                ctx.font = '700 ' + Math.round(w * 0.026) + "px 'Helvetica Neue', Arial, sans-serif";
                ctx.fillStyle = 'rgba(255,255,255,0.92)';
                ctx.fillText(spaced(cfg.site), pad, pad);
            }

            // Title: wrap + shrink to fit the lower area.
            var titleSize = Math.round(w * 0.072);
            var lines, lineH;
            for (; titleSize > w * 0.03; titleSize -= 2) {
                ctx.font = '800 ' + titleSize + "px 'Helvetica Neue', Arial, sans-serif";
                lines = wrap(ctx, cfg.title, maxW);
                lineH = Math.round(titleSize * 1.12);
                if (lines.length * lineH <= h * 0.42 && lines.length <= 5) { break; }
            }

            var dateSize = Math.round(w * 0.036);
            var barH = Math.max(3, Math.round(w * 0.012));
            var barW = Math.round(w * 0.12);
            var gap  = Math.round(w * 0.03);

            var titleBlock = lines.length * lineH;
            var dateBlock  = cfg.date ? dateSize + gap : 0;
            var barBlock   = barH + gap;
            var bottom = h - pad;
            var titleTop = bottom - titleBlock;
            var dateTop  = titleTop - dateBlock;
            var barTop   = dateTop - barBlock;

            // Accent bar.
            ctx.fillStyle = cfg.accent;
            ctx.fillRect(pad, barTop, barW, barH);

            // Date, in the accent colour.
            if (cfg.date) {
                ctx.textBaseline = 'top';
                ctx.textAlign = 'left';
                ctx.font = '700 ' + dateSize + "px 'Helvetica Neue', Arial, sans-serif";
                ctx.fillStyle = cfg.accent;
                ctx.fillText(cfg.date, pad, dateTop);
            }

            // Title, white.
            ctx.font = '800 ' + titleSize + "px 'Helvetica Neue', Arial, sans-serif";
            ctx.fillStyle = '#ffffff';
            ctx.textBaseline = 'top';
            ctx.textAlign = 'left';
            lines.forEach(function (ln, i) { ctx.fillText(ln, pad, titleTop + i * lineH); });
        }

        function wrap(ctx, text, maxW) {
            var words = String(text).split(/\s+/), lines = [], cur = '';
            words.forEach(function (word) {
                // Hard-break a single word too wide for the column, so a long
                // token (a URL, a run-on) can't overflow the canvas edge.
                while (ctx.measureText(word).width > maxW && word.length > 1) {
                    var n = word.length;
                    while (n > 1 && ctx.measureText(word.slice(0, n)).width > maxW) { n--; }
                    if (cur) { lines.push(cur); cur = ''; }
                    lines.push(word.slice(0, n));
                    word = word.slice(n);
                }
                var test = cur ? cur + ' ' + word : word;
                if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = word; }
                else { cur = test; }
            });
            if (cur) { lines.push(cur); }
            return lines.length ? lines : [''];
        }

        function spaced(s) { return s.split('').join('  '); }
        function slug(s) {
            return (String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'event').slice(0, 40);
        }
    });
})();
