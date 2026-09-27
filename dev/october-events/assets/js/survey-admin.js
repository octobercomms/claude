/* Survey builder — add/edit/reorder questions, serialise to a hidden field.
 * Four questions recommended, hard ceiling higher (session-ratings + quote
 * blocks are off-cap). */
(function () {
    var cfg = window.OE_SURVEY;
    if (!cfg) { return; }
    var list = document.getElementById('oe-svy-list');
    var json = document.getElementById('oe-svy-json');
    var countEl = document.getElementById('oe-svy-count');
    if (!list || !json) { return; }

    var i18n = cfg.i18n || {};
    var types = i18n.types || {};
    var OFFCAP = ['session_rating', 'testimonial'];
    var RECOMMENDED = cfg.recommended || 4;
    var MAX = cfg.max || 12;

    function fmt(str, n) { return String(str || '').replace('%d', n); }

    var questions = [];
    try { questions = JSON.parse(json.value || '[]'); } catch (e) { questions = []; }
    if (!Array.isArray(questions)) { questions = []; }

    function isOff(t) { return OFFCAP.indexOf(t) !== -1; }
    function coreCount() { return questions.filter(function (q) { return !isOff(q.type); }).length; }
    function hasOff(t) { return questions.some(function (q) { return q.type === t; }); }

    function serialise() {
        json.value = JSON.stringify(questions);
        if (countEl) {
            var n = coreCount();
            var word = n === 1 ? fmt(i18n.countOne, n) : fmt(i18n.countMany, n);
            if (n > RECOMMENDED) {
                countEl.textContent = word + ' · ' + (i18n.ideal || '4 is ideal');
                countEl.classList.add('oe-svy-over');
            } else {
                countEl.textContent = n + ' / ' + RECOMMENDED;
                countEl.classList.remove('oe-svy-over');
            }
        }
    }

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) { e.className = cls; }
        if (text != null) { e.textContent = text; }
        return e;
    }

    function typeSelect(q) {
        var sel = el('select', 'oe-svy-type');
        Object.keys(types).forEach(function (key) {
            var o = el('option', null, types[key]);
            o.value = key;
            if (q.type === key) { o.selected = true; }
            sel.appendChild(o);
        });
        sel.addEventListener('change', function () {
            var want = sel.value;
            if (isOff(want) && q.type !== want && hasOff(want)) {
                alert(i18n.oneOff);
                sel.value = q.type;
                return;
            }
            if (!isOff(want) && isOff(q.type) && coreCount() >= MAX) {
                alert(i18n.capMax);
                sel.value = q.type;
                return;
            }
            q.type = want;
            if ((want === 'choice' || want === 'multi') && !Array.isArray(q.options)) { q.options = ['', '']; }
            if (want === 'session_rating' && !Array.isArray(q.sessions)) { q.sessions = ['']; }
            render();
        });
        return sel;
    }

    function repeater(q, field, addLabel) {
        var wrap = el('div', 'oe-svy-rep');
        (q[field] || []).forEach(function (val, i) {
            var row = el('div', 'oe-svy-rep-row');
            var inp = el('input');
            inp.type = 'text';
            inp.value = val;
            inp.placeholder = field === 'options' ? i18n.option : i18n.session;
            inp.addEventListener('input', function () { q[field][i] = inp.value; serialise(); });
            var rm = el('button', 'button-link oe-svy-rep-rm', '×');
            rm.type = 'button';
            rm.addEventListener('click', function () { q[field].splice(i, 1); render(); });
            row.appendChild(inp);
            row.appendChild(rm);
            wrap.appendChild(row);
        });
        var add = el('button', 'button-link', '+ ' + addLabel);
        add.type = 'button';
        add.addEventListener('click', function () { q[field] = (q[field] || []).concat(['']); render(); });
        wrap.appendChild(add);
        return wrap;
    }

    function card(q, index) {
        var c = el('div', 'oe-svy-card');

        var head = el('div', 'oe-svy-card-head');
        head.appendChild(typeSelect(q));

        var moves = el('div', 'oe-svy-moves');
        var up = el('button', 'button-link', '↑'); up.type = 'button';
        up.addEventListener('click', function () { if (index > 0) { swap(index, index - 1); } });
        var down = el('button', 'button-link', '↓'); down.type = 'button';
        down.addEventListener('click', function () { if (index < questions.length - 1) { swap(index, index + 1); } });
        var rm = el('button', 'button-link oe-svy-rm', i18n.remove); rm.type = 'button';
        rm.addEventListener('click', function () { questions.splice(index, 1); render(); });
        moves.appendChild(up); moves.appendChild(down); moves.appendChild(rm);
        head.appendChild(moves);
        c.appendChild(head);

        if (q.type !== 'session_rating') {
            var label = el('input', 'oe-svy-label');
            label.type = 'text';
            label.value = q.label || '';
            label.placeholder = i18n.label;
            label.addEventListener('input', function () { q.label = label.value; serialise(); });
            c.appendChild(label);
        } else {
            var slabel = el('input', 'oe-svy-label');
            slabel.type = 'text';
            slabel.value = q.label || '';
            slabel.placeholder = i18n.label;
            slabel.addEventListener('input', function () { q.label = slabel.value; serialise(); });
            c.appendChild(slabel);
            c.appendChild(repeater(q, 'sessions', i18n.addSess));
        }

        if (q.type === 'choice' || q.type === 'multi') {
            c.appendChild(repeater(q, 'options', i18n.addOpt));
        }

        return c;
    }

    function swap(a, b) {
        var t = questions[a];
        questions[a] = questions[b];
        questions[b] = t;
        render();
    }

    function render() {
        list.innerHTML = '';
        questions.forEach(function (q, i) { list.appendChild(card(q, i)); });
        serialise();
    }

    document.getElementById('oe-svy-add').addEventListener('click', function () {
        if (coreCount() >= MAX) { alert(i18n.capMax); return; }
        var type = questions.length === 0 ? 'rating' : 'choice';
        var q = { type: type, label: '' };
        if (type === 'choice') { q.options = ['', '']; }
        questions.push(q);
        render();
    });

    var starterBtn = document.getElementById('oe-svy-starter');
    if (starterBtn) {
        starterBtn.addEventListener('click', function () {
            if (questions.length && !confirm('Replace the current questions with a starter set?')) { return; }
            questions = JSON.parse(JSON.stringify(cfg.starter || []));
            render();
        });
    }

    var aiBtn = document.getElementById('oe-svy-ai');
    if (aiBtn) {
        aiBtn.addEventListener('click', function () {
            var orig = aiBtn.textContent;
            aiBtn.disabled = true;
            aiBtn.textContent = i18n.thinking;
            var body = new URLSearchParams();
            body.set('action', 'oe_survey_suggest');
            body.set('nonce', cfg.nonce);
            body.set('event', aiBtn.getAttribute('data-event'));
            fetch(cfg.ajax, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() })
                .then(function (r) { return r.json(); })
                .then(function (res) {
                    if (res && res.success && res.data && res.data.questions) {
                        questions = res.data.questions;
                        render();
                    } else {
                        alert(i18n.aiFail);
                    }
                })
                .catch(function () { alert(i18n.aiFail); })
                .then(function () { aiBtn.disabled = false; aiBtn.textContent = orig; });
        });
    }

    var buildBtn = document.getElementById('oe-svy-build');
    if (buildBtn) {
        buildBtn.addEventListener('click', function () {
            var ta = document.getElementById('oe-svy-notes-text');
            var notes = ta ? ta.value.trim() : '';
            if (!notes) { alert(i18n.notesEmpty); return; }
            if (questions.length && !confirm(i18n.buildConfirm)) { return; }
            var orig = buildBtn.textContent;
            buildBtn.disabled = true;
            buildBtn.textContent = i18n.building;
            var body = new URLSearchParams();
            body.set('action', 'oe_survey_build');
            body.set('nonce', cfg.nonce);
            body.set('event', buildBtn.getAttribute('data-event'));
            body.set('notes', notes);
            fetch(cfg.ajax, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() })
                .then(function (r) { return r.json(); })
                .then(function (res) {
                    if (res && res.success && res.data && res.data.questions) {
                        questions = res.data.questions;
                        render();
                        var det = buildBtn.closest('details');
                        if (det) { det.open = false; }
                    } else {
                        alert((res && res.data && res.data.message) || i18n.buildFail);
                    }
                })
                .catch(function () { alert(i18n.buildFail); })
                .then(function () { buildBtn.disabled = false; buildBtn.textContent = orig; });
        });
    }

    var refineBtn = document.getElementById('oe-svy-refine');
    if (refineBtn) {
        refineBtn.addEventListener('click', function () {
            if (coreCount() === 0) { alert(i18n.refineFail); return; }
            var orig = refineBtn.textContent;
            refineBtn.disabled = true;
            refineBtn.textContent = i18n.refining;
            var body = new URLSearchParams();
            body.set('action', 'oe_survey_refine');
            body.set('nonce', cfg.nonce);
            body.set('event', refineBtn.getAttribute('data-event'));
            body.set('questions', JSON.stringify(questions));
            fetch(cfg.ajax, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() })
                .then(function (r) { return r.json(); })
                .then(function (res) {
                    if (res && res.success && res.data && res.data.questions) {
                        questions = res.data.questions;
                        render();
                    } else {
                        alert((res && res.data && res.data.message) || i18n.refineFail);
                    }
                })
                .catch(function () { alert(i18n.refineFail); })
                .then(function () { refineBtn.disabled = false; refineBtn.textContent = orig; });
        });
    }

    render();
})();
