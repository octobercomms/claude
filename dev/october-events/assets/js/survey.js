/* Post-event survey — one question per screen, answers saved as you go.
 * Progressive capture: each step's answer is POSTed on advance, so an
 * abandoned survey is still recorded; the final step submits + reveals the code.
 * Enhancement only — without JS the whole form posts once (no-JS handler). */
(function () {
    var cfg = window.OE_SURVEY_FORM;
    if (!cfg) { return; }
    var form = document.querySelector('.oe-survey-form');
    if (!form) { return; }

    var steps = Array.prototype.slice.call(form.querySelectorAll('.oe-survey-step'));
    if (!steps.length) { return; }
    var back = form.querySelector('.oe-survey-back');
    var next = form.querySelector('.oe-survey-next');
    var progress = form.querySelector('.oe-survey-progress');
    var i18n = cfg.i18n || {};
    var qmap = {};
    (cfg.questions || []).forEach(function (q) { qmap[q.id] = q; });

    var idx = 0;
    var answers = {};

    if (progress) {
        steps.forEach(function () {
            var d = document.createElement('span');
            d.className = 'oe-survey-dot';
            progress.appendChild(d);
        });
    }

    function show(n) {
        idx = Math.max(0, Math.min(steps.length - 1, n));
        steps.forEach(function (s, i) { s.classList.toggle('is-active', i === idx); });
        if (progress) {
            Array.prototype.forEach.call(progress.children, function (d, i) {
                d.classList.toggle('is-done', i <= idx);
            });
        }
        if (back) { back.hidden = idx === 0; }
        if (next) { next.textContent = idx === steps.length - 1 ? (i18n.finish || 'Finish') : (i18n.next || 'Next'); }
        var el = steps[idx].querySelector('input, textarea');
        if (el) { try { el.focus(); } catch (e) {} }
    }

    function collect(step) {
        var qid = step.getAttribute('data-qid');
        var type = step.getAttribute('data-type');
        var r, c, t, cm, con, txt;
        if (type === 'rating') {
            r = step.querySelector('input[type=radio]:checked');
            return r ? parseInt(r.value, 10) : null;
        }
        if (type === 'choice') {
            c = step.querySelector('input[type=radio]:checked');
            return c ? c.value : null;
        }
        if (type === 'multi') {
            var vals = [];
            Array.prototype.forEach.call(step.querySelectorAll('input[type=checkbox]:checked'), function (x) { vals.push(x.value); });
            return vals.length ? vals : null;
        }
        if (type === 'open') {
            t = step.querySelector('textarea');
            return t && t.value.trim() ? t.value.trim() : null;
        }
        if (type === 'session_rating') {
            var q = qmap[qid] || {};
            var sessions = q.sessions || [];
            var out = {};
            var any = false;
            Array.prototype.forEach.call(step.querySelectorAll('.oe-survey-session'), function (row, i) {
                var rr = row.querySelector('input[type=radio]:checked');
                if (rr && sessions[i] != null) { out[sessions[i]] = parseInt(rr.value, 10); any = true; }
            });
            cm = step.querySelector('textarea');
            if (cm && cm.value.trim()) { out._comment = cm.value.trim(); }
            return any ? out : null;
        }
        if (type === 'testimonial') {
            txt = step.querySelector('textarea');
            if (!txt || !txt.value.trim()) { return null; }
            con = step.querySelector('input[type=radio]:checked');
            return { text: txt.value.trim(), consent: con ? con.value : 'no' };
        }
        return null;
    }

    function post(fields) {
        var body = new URLSearchParams();
        Object.keys(fields).forEach(function (k) { body.set(k, fields[k]); });
        return fetch(cfg.ajax, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        });
    }

    function save(qid, value) {
        if (value === null) { return; }
        post({ action: 'oe_survey_save', nonce: cfg.nonce, token: cfg.token, question: qid, value: JSON.stringify(value) })
            .catch(function () {});
    }

    function required(step) {
        return step.getAttribute('data-type') === 'rating' && idx === 0;
    }

    function submit() {
        if (next) { next.disabled = true; next.textContent = i18n.saving || 'Saving…'; }
        post({ action: 'oe_survey_submit', nonce: cfg.nonce, token: cfg.token, answers: JSON.stringify(answers) })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                if (res && res.success && res.data && res.data.html) {
                    var main = document.querySelector('main.oe-survey');
                    if (main) { main.outerHTML = res.data.html; window.scrollTo(0, 0); }
                } else {
                    form.submit(); // fall back to the no-JS handler
                }
            })
            .catch(function () { if (next) { next.disabled = false; } show(idx); });
    }

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        var step = steps[idx];
        var qid = step.getAttribute('data-qid');
        var val = collect(step);
        if (required(step) && val === null) {
            step.classList.add('oe-survey-needed');
            return;
        }
        step.classList.remove('oe-survey-needed');
        if (val !== null) { answers[qid] = val; save(qid, val); }
        if (idx === steps.length - 1) { submit(); } else { show(idx + 1); }
    });

    if (back) { back.addEventListener('click', function () { show(idx - 1); }); }

    form.classList.add('oe-survey-js');
    show(0);
})();
