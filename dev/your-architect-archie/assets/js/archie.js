/* ============================================================
   Your Architect – Archie — front-end client (talks to yaa/v1 REST).

   The server owns the conversation + pricing: each turn returns the
   assistant message and the full recomputed package, so this file is a
   thin renderer + input handler. Session is a server cookie (resume is
   automatic). Voice uses the Web Speech API where available.
   ============================================================ */
(function () {
  'use strict';

  var D = window.yaaData || {};
  var REST = D.rest || '';
  var NONCE = D.nonce || '';
  var PRICING = D.pricing || {};
  var ICON = D.iconUrl || '';
  var BOT = ICON
    ? '<img class="a-ico" src="' + ICON + '" alt="Archie" aria-hidden="true">'
    : '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><circle cx="24" cy="24" r="23" fill="#E4EFF7"/><path d="M11 20c0-8 6-13 13-13s13 5 13 13" stroke="#253E94" stroke-width="3.4" stroke-linecap="round"/><path d="M12 21c2.5-2 6-3 6-3M36 21c-2.5-2-6-3-6-3" stroke="#253E94" stroke-width="2.2" stroke-linecap="round"/><circle cx="18.5" cy="25" r="4.4" stroke="#253E94" stroke-width="2.4"/><circle cx="30" cy="25" r="4.4" stroke="#253E94" stroke-width="2.4"/><path d="M22.9 25h2.2" stroke="#253E94" stroke-width="2.4" stroke-linecap="round"/><path d="M19 34c2 1.8 8 1.8 10 0" stroke="#253E94" stroke-width="2.6" stroke-linecap="round"/></svg>';

  var el = function (id) { return document.getElementById(id); };
  var msgList = el('msgList'), messages = el('messages'), input = el('textInput'),
      sendBtn = el('sendBtn'), micBtn = el('micBtn'), nodes = el('nodes'), nodesEmpty = el('nodesEmpty'),
      totalAmt = el('totalAmt'), toggleTotal = el('toggleTotal'), londonChip = el('londonChip'),
      redirectBanner = el('redirectBanner'), quoteMeta = el('quoteMeta'), mValidity = el('mValidity'),
      mDelivery = el('mDelivery'), mRevisions = el('mRevisions'), submitBtn = el('submitBtn'),
      restartBtn = el('restartBtn'), panelToggle = el('panelToggle'), panel = el('packagePanel'),
      quick = el('quickReplies'), photoBtn = el('photoBtn'), photoInput = el('photoInput');

  if (!msgList) return; // Archie not on this page.

  var busy = false, done = false, hasService = false;

  function money(n) { return '£' + Number(n || 0).toLocaleString('en-GB'); }
  function post(path, body) {
    // Send the nonce in the header AND the body: page caches (StackCache) can
    // serve a stale localised nonce and CDNs can strip the custom header, so the
    // body copy (server checks it as a fallback) keeps writes working.
    var payload = body || {};
    payload.nonce = NONCE;
    return fetch(REST + path, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-YAA-Nonce': NONCE },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); });
  }

  // ---- Rendering ----
  function addMsg(who, text, kind) {
    var div = document.createElement('div');
    div.className = 'msg ' + who + (kind ? ' ' + kind : '');
    div.innerHTML = (who === 'bot' ? '<div class="avatar">' + BOT + '</div>' : '') + '<div class="text">' + text + '</div>';
    msgList.appendChild(div);
    requestAnimationFrame(function () { messages.scrollTop = messages.scrollHeight; });
  }
  var typingEl = null;
  function typing(on) {
    if (typingEl) { typingEl.remove(); typingEl = null; }
    if (on) {
      typingEl = document.createElement('div');
      typingEl.className = 'msg bot';
      typingEl.innerHTML = '<div class="avatar">' + BOT + '</div><div class="text typing"><span></span><span></span><span></span></div>';
      msgList.appendChild(typingEl);
      requestAnimationFrame(function () { messages.scrollTop = messages.scrollHeight; });
    }
  }

  function validityDate(days) {
    var d = new Date(); d.setDate(d.getDate() + (days || 30));
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function renderPackage(pkg) {
    pkg = pkg || { nodes: [], total: 0 };
    hasService = (pkg.nodes || []).some(function (n) { return n.id === 'service'; });
    nodes.innerHTML = '';
    if (!pkg.nodes || !pkg.nodes.length) {
      nodes.appendChild(nodesEmpty);
    } else {
      pkg.nodes.forEach(function (n) {
        var div = document.createElement('div');
        div.className = 'node' + (n.kind ? ' ' + n.kind : '');
        if (n.kind === 'info') {
          div.innerHTML = '<div class="n-main"><div class="n-label">' + n.label + '</div></div>';
        } else {
          var price = n.price === null ? '<span class="n-price">' + (n.kind === 'consultant' ? 'quote to follow' : '') + '</span>'
                                       : '<span class="n-price">' + money(n.price) + '</span>';
          var rm = n.removable ? '<button class="n-remove" data-remove="' + n.id + '" aria-label="Remove">✕</button>' : '';
          div.innerHTML = '<div class="n-main"><div class="n-label">' + n.label + '</div>' +
                          (n.sub ? '<div class="n-sub">' + n.sub + '</div>' : '') + '</div>' + price + rm;
        }
        nodes.appendChild(div);
      });
    }
    totalAmt.textContent = money(pkg.total);
    if (toggleTotal) toggleTotal.textContent = money(pkg.total);
    londonChip.classList.toggle('show', !!pkg.london);
    redirectBanner.classList.toggle('show', !!pkg.redirect);
    submitBtn.textContent = pkg.redirect ? 'Contact Tiam Architects' : 'Save & submit project';
    submitBtn.disabled = !hasService;
    var meta = pkg.meta || {};
    if (mDelivery && meta.delivery) mDelivery.textContent = meta.delivery;
    if (mRevisions && meta.revisions) mRevisions.textContent = meta.revisions + ' revisions included';
    if (mValidity) mValidity.textContent = validityDate(meta.validityDays || PRICING.quoteValidityDays);
    quoteMeta.hidden = !hasService;
  }

  // ---- Quick replies (tap-or-type) ----
  // Archie proposes short answer buttons each turn; the composer always stays open,
  // so the person can tap one OR type their own.
  function clearOptions() { if (quick) quick.innerHTML = ''; }
  function renderOptions(options) {
    if (!quick) return;
    clearOptions();
    if (!options || !options.length || done) return;
    options.forEach(function (label) {
      var b = document.createElement('button');
      b.className = 'chip'; b.type = 'button'; b.textContent = label;
      b.addEventListener('click', function () { if (!busy && !done) send(label); });
      quick.appendChild(b);
    });
  }

  // ---- Input ----
  function setBusy(b) {
    busy = b;
    input.disabled = b || done;
    sendBtn.disabled = b || done;
  }
  // `preset` is the label of a tapped quick reply; otherwise we read the text box.
  function send(preset) {
    var text = typeof preset === 'string' ? preset : (input.value || '').trim();
    if (!text || busy || done) return;
    if (typeof preset !== 'string') { input.value = ''; autoGrow(); }
    clearOptions();
    addMsg('user', escapeHtml(text));
    setBusy(true); typing(true);
    post('message', { text: text }).then(function (res) {
      typing(false);
      if (!res.ok) {
        addMsg('bot', (res.body && res.body.message) || 'Sorry — something went wrong. Please try again.', 'note');
        setBusy(false); return;
      }
      addMsg('bot', escapeHtml(res.body.message));
      renderPackage(res.body.package);
      renderOptions(res.body.options);
      if (res.body.done) { done = true; clearOptions(); input.placeholder = 'All set — submit your project on the right.'; }
      setBusy(false);
      if (!done) input.focus({ preventScroll: true });
      // If they clicked submit before giving an email, Archie asked for it; now
      // that we have one, finish the submission for them automatically.
      if (pendingSubmit && res.body.hasEmail) { pendingSubmit = false; doSubmit(); }
    }).catch(function () { typing(false); addMsg('bot', 'We couldn’t reach Archie. Please try again in a moment.', 'note'); setBusy(false); });
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } autoGrow(); });
  input.addEventListener('input', autoGrow);
  function autoGrow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; }
  function escapeHtml(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  // Node remove
  nodes.addEventListener('click', function (e) {
    var b = e.target.closest('[data-remove]'); if (!b || busy) return;
    setBusy(true);
    post('remove', { id: b.getAttribute('data-remove') }).then(function (res) {
      renderPackage(res.body && res.body.package); setBusy(false);
      addMsg('bot', 'Done — I’ve taken that off. Your total’s updated on the right.', 'note');
    }).catch(function () { setBusy(false); });
  });

  // Submit — needs an email so the studio can reply. If none yet, the server
  // returns needEmail and Archie asks for it in the chat; once the person gives
  // it, the message handler above auto-retries this for them.
  var pendingSubmit = false, submitOriginal = submitBtn.textContent;
  function doSubmit() {
    if (submitBtn.disabled) return;
    submitBtn.disabled = true; submitOriginal = submitBtn.textContent; submitBtn.textContent = 'Saving…';
    post('submit', {}).then(function (res) {
      var d = res.body || {};
      if (d.needEmail) {
        pendingSubmit = true;
        addMsg('bot', escapeHtml(d.message || 'What’s the best email address to send your quote to?'), 'note');
        submitBtn.disabled = false; submitBtn.textContent = submitOriginal;
        if (!done) input.focus({ preventScroll: true });
        return;
      }
      if (d.checkoutUrl) { window.location.href = d.checkoutUrl; return; }
      pendingSubmit = false;
      addMsg('bot', escapeHtml(d.message || 'Project saved.') + (d.ref ? ' <strong>(ref ' + d.ref + ')</strong>' : ''), 'note');
      submitBtn.textContent = 'Submitted ✓';
    }).catch(function () { submitBtn.disabled = false; submitBtn.textContent = submitOriginal; });
  }
  submitBtn.addEventListener('click', doSubmit);

  // Start over
  if (restartBtn) restartBtn.addEventListener('click', function () {
    post('reset', {}).then(function () { window.location.reload(); });
  });

  // Mobile panel toggle
  if (panelToggle && panel) panelToggle.addEventListener('click', function () { panel.classList.toggle('open'); });

  // Voice (Web Speech API)
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR && micBtn) { micBtn.disabled = true; micBtn.title = 'Voice input needs a supported browser'; }
  var rec = null, recording = false;
  if (micBtn && SR) micBtn.addEventListener('click', function () {
    if (recording) { rec && rec.stop(); return; }
    rec = new SR(); rec.lang = 'en-GB'; rec.interimResults = true;
    var base = input.value ? input.value + ' ' : '';
    rec.onstart = function () { recording = true; micBtn.classList.add('recording'); };
    rec.onend = function () { recording = false; micBtn.classList.remove('recording'); };
    rec.onerror = function () { recording = false; micBtn.classList.remove('recording'); };
    rec.onresult = function (e) { var t = ''; for (var i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; input.value = base + t; autoGrow(); };
    rec.start();
  });

  // ---- Photo / file upload ----
  // Tapping the camera opens the file picker; on choose we show a thumbnail bubble,
  // send the file (multipart, nonce in header + body) to /upload, then render
  // Archie's acknowledgement. Images/PDFs only; the server re-checks the type.
  if (photoBtn && photoInput) {
    photoBtn.addEventListener('click', function () { if (!busy && !done) photoInput.click(); });
    photoInput.addEventListener('change', function () {
      var file = photoInput.files && photoInput.files[0];
      photoInput.value = ''; // let the same file be re-picked later
      if (!file || busy || done) return;
      var isImg = /^image\//.test(file.type);
      var thumb = isImg
        ? '<img class="up-thumb" src="' + URL.createObjectURL(file) + '" alt="">'
        : '<span class="up-file">📄</span>';
      addMsg('user', thumb + '<span class="up-name">' + escapeHtml(file.name) + '</span>', 'upload');
      clearOptions();
      setBusy(true); typing(true);
      var fd = new FormData();
      fd.append('file', file);
      fd.append('nonce', NONCE);
      fetch(REST + 'upload', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'X-YAA-Nonce': NONCE },
        body: fd
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
        .then(function (res) {
          typing(false);
          addMsg('bot', escapeHtml((res.body && res.body.message) ||
            (res.ok ? 'Thanks — I’ve saved that with your project.' : 'Sorry — I couldn’t save that file. Please try a JPG, PNG or PDF.')), 'note');
          setBusy(false);
          if (!done) input.focus({ preventScroll: true });
        }).catch(function () {
          typing(false);
          addMsg('bot', 'We couldn’t upload that just now. Please try again in a moment.', 'note');
          setBusy(false);
        });
    });
  }

  // ---- Boot ----
  post('start', {}).then(function (res) {
    var d = res.body || {};
    if (d.nonce) { NONCE = d.nonce; } // adopt the fresh, uncached nonce for all writes.
    (d.messages || []).forEach(function (m) { addMsg(m.role === 'assistant' ? 'bot' : 'user', escapeHtml(m.text)); });
    renderPackage(d.package);
    if (d.configured === false) {
      addMsg('bot', 'Archie isn’t connected yet — add a Claude API key in <em>Archie → Settings</em> to go live.', 'note');
      setBusy(true);
    } else {
      renderOptions(d.options);
      input.focus({ preventScroll: true });
    }
  }).catch(function () { addMsg('bot', 'Archie couldn’t start. Please refresh.', 'note'); });
})();
