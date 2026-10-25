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
      quick = el('quickReplies'), photoBtn = el('photoBtn'), photoInput = el('photoInput'),
      saveQuote = el('saveQuote'), saveEmail = el('saveEmail'), saveQuoteNote = el('saveQuoteNote'),
      submitConsent = el('submitConsent'), marketingOptIn = el('marketingOptIn'), consentNote = el('consentNote'),
      totalSub = el('totalSub');

  if (!msgList) return; // Archie not on this page.

  var busy = false, done = false, hasService = false;
  var userMsgCount = 0, emailSaved = false; // drives the always-on "Email me my quote" field.
  var lastTotal = 0; // latest quoted total, for the Meta "Lead" conversion value.
  var submitted = false, submitReadyShown = false;
  var termsAccepted = false, countdownTimer = null, submitLabel = 'Save & submit project';
  var TERMS_URL = D.termsUrl || '#', PRIV_URL = D.privacyUrl || '#';

  function money(n) { return '£' + Number(n || 0).toLocaleString('en-GB'); }

  // Consent note (privacy + terms links), shown with the quote at submit.
  if (consentNote) {
    var _t = D.termsUrl || '#', _p = D.privacyUrl || '#';
    consentNote.innerHTML = 'By submitting you agree to us using your details to prepare your quote, as set out in our ' +
      '<a href="' + _p + '" target="_blank" rel="noopener">Privacy Policy</a> and ' +
      '<a href="' + _t + '" target="_blank" rel="noopener">Terms</a>.';
  }
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
    hasService = (pkg.nodes || []).some(function (n) { return n.id && n.id.indexOf('service_') === 0; });
    var isRedirect = !!pkg.redirect;
    lastTotal = Number(pkg.total || 0);
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
    totalAmt.textContent = isRedirect ? 'POA' : money(pkg.total);
    if (toggleTotal) toggleTotal.textContent = isRedirect ? 'POA' : money(pkg.total);
    londonChip.classList.toggle('show', !!pkg.london);
    redirectBanner.classList.toggle('show', isRedirect);
    submitLabel = isRedirect ? 'Contact Tiam Architects' : 'Save & submit project';
    if (!countdownTimer) submitBtn.textContent = submitLabel; // don't clobber a running countdown
    submitBtn.disabled = !hasService;
    var meta = pkg.meta || {};
    if (mDelivery && meta.delivery) mDelivery.textContent = meta.delivery;
    if (mRevisions && meta.revisions) mRevisions.textContent = meta.revisions + ' revisions included';
    if (mValidity) mValidity.textContent = validityDate(meta.validityDays || PRICING.quoteValidityDays);
    // F12: a new-dwelling referral has no fixed price — hide delivery/revisions/validity.
    quoteMeta.hidden = !hasService || isRedirect;
    if (totalSub) totalSub.textContent = isRedirect ? 'Priced on consultation' : 'Fixed price · survey & structural sourced separately';
    // F3: the consent notice appears alongside the quote, before they submit.
    if (submitConsent) submitConsent.hidden = !hasService || isRedirect;
  }

  // ---- Quick replies (tap-or-type) ----
  // Archie proposes short answer buttons each turn; the composer always stays open,
  // so the person can tap one OR type their own.
  function clearOptions() { if (quick) quick.innerHTML = ''; }
  function renderOptions(options) {
    if (!quick) return;
    clearOptions();
    if (!options || !options.length || submitted) return;
    options.forEach(function (label) {
      var b = document.createElement('button');
      b.className = 'chip'; b.type = 'button'; b.textContent = label;
      b.addEventListener('click', function () { if (!busy && !submitted) send(label); });
      quick.appendChild(b);
    });
  }

  // ---- Input ----
  function setBusy(b) {
    busy = b;
    input.disabled = b || submitted;
    sendBtn.disabled = b || submitted;
  }
  // `preset` is the label of a tapped quick reply; otherwise we read the text box.
  function send(preset) {
    var text = typeof preset === 'string' ? preset : (input.value || '').trim();
    if (!text || busy || submitted) return;
    cancelCountdown(); // a new message means they're still editing — don't auto-submit under them
    if (text.length > 1000) text = text.slice(0, 1000);
    if (typeof preset !== 'string') { input.value = ''; autoGrow(); }
    clearOptions();
    addMsg('user', escapeHtml(text));
    userMsgCount++;
    setBusy(true); typing(true);
    deliver(text, 0);
  }
  // Posts a turn; on a throttle (429) it waits briefly and retries once itself,
  // instead of consuming the customer's turn and blaming them.
  function deliver(text, attempt) {
    post('message', { text: text }).then(function (res) {
      if (!res.ok && res.status === 429 && res.body && res.body.error === 'slow_down' && attempt < 1) {
        setTimeout(function () { deliver(text, attempt + 1); }, 1600);
        return;
      }
      typing(false);
      if (!res.ok) {
        addMsg('bot', (res.body && res.body.message) || 'Sorry — something went wrong. Please try again.', 'note');
        setBusy(false);
        var err = res.body && res.body.error;
        if (err === 'busy' || err === 'session_cap') { input.disabled = true; sendBtn.disabled = true; } // won't recover this session
        return;
      }
      addMsg('bot', escapeHtml(res.body.message));
      renderPackage(res.body.package);
      renderOptions(res.body.options);
      if (res.body.placeholder) input.placeholder = res.body.placeholder;
      if (res.body.hasEmail && !emailSaved) markEmailSaved('', 'Saved — we’ll email your quote to you.');
      revealSaveQuote();
      if (res.body.done) {
        done = true;
        showSubmitReady(); // their explicit GO — never auto-send; chat stays open
      }
      setBusy(false);
      if (!submitted) input.focus({ preventScroll: true });
      // If they pressed submit before giving an email, finish it for them now.
      if (pendingSubmit && res.body.hasEmail) { pendingSubmit = false; doSubmit(); }
    }).catch(function () { typing(false); addMsg('bot', 'We couldn’t reach Archie. Please try again in a moment.', 'note'); setBusy(false); });
  }

  // End of chat: surface the consent notice, draw the eye to the submit button, and
  // (on mobile) open the panel so the button is visible.
  function showSubmitReady() {
    if (submitReadyShown) return;
    submitReadyShown = true;
    if (submitConsent && hasService) submitConsent.hidden = false;
    if (!submitBtn.disabled) submitBtn.classList.add('ready');
    addMsg('bot', 'Your quote’s ready. One last thing before I send it to our team — please confirm you’re happy with our ' +
      '<a href="' + TERMS_URL + '" target="_blank" rel="noopener">Terms</a> and ' +
      '<a href="' + PRIV_URL + '" target="_blank" rel="noopener">Privacy Policy</a>. ' +
      'Tap below and I’ll submit your project — or you can keep asking me questions or add another service first.' +
      '<div style="margin-top:12px"><button type="button" class="a-agree" style="background:#253E94;color:#fff;border:0;border-radius:10px;padding:11px 18px;font-weight:700;cursor:pointer;font-size:.95rem">I agree — submit my project</button></div>', 'note');
    if (panel && window.matchMedia && window.matchMedia('(max-width:820px)').matches) panel.classList.add('open');
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
      addMsg('bot', escapeHtml((res.body && res.body.message) || 'Done — I’ve removed that. Your total’s updated.'), 'note');
    }).catch(function () { setBusy(false); });
  });

  // Submit — needs an email so the studio can reply. If none yet, the server
  // returns needEmail and Archie asks for it in the chat; once the person gives
  // it, the message handler above auto-retries this for them.
  var pendingSubmit = false, submitOriginal = submitBtn.textContent;
  function doSubmit() {
    if (submitted) return;
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; } // clicked during the countdown → send now
    submitBtn.disabled = true; submitOriginal = submitLabel; submitBtn.textContent = 'Sending…';
    post('submit', { marketing: (marketingOptIn && marketingOptIn.checked) ? 1 : 0, terms: termsAccepted ? 1 : 0 }).then(function (res) {
      var d = res.body || {};
      if (!res.ok) {
        // Server error (e.g. 500) — don't claim success or dump raw HTML. Let them retry.
        submitBtn.disabled = false; submitBtn.textContent = submitOriginal;
        addMsg('bot', 'Sorry — something went wrong saving your project just then. Please press “' + submitOriginal + '” to try again, or reply here and we’ll sort it.', 'note');
        return;
      }
      if (d.ineligible) {
        addMsg('bot', escapeHtml(d.message || 'Sorry — we only work on properties in the UK.'), 'note');
        submitBtn.disabled = true; submitBtn.textContent = submitOriginal;
        return;
      }
      if (d.needEmail || d.needPostcode || d.needUpload) {
        pendingSubmit = !!d.needEmail; // only the email is auto-retried once captured in chat
        addMsg('bot', escapeHtml(d.message || 'Just one more detail before I can save this.'), 'note');
        submitBtn.disabled = false; submitBtn.textContent = submitOriginal;
        if (!submitted) input.focus({ preventScroll: true });
        return;
      }
      if (d.checkoutUrl) { window.location.href = d.checkoutUrl; return; }
      pendingSubmit = false; submitted = true;
      addMsg('bot', escapeHtml(d.message || 'Project saved.') + (d.ref ? ' <strong>(ref ' + d.ref + ')</strong>' : ''), 'note');
      submitBtn.textContent = 'Submitted ✓';
      setBusy(false); // now that submitted is true, this locks the composer
      // Meta Pixel — a submitted project is a Lead. Guarded: fbq is absent until
      // the visitor consents (Complianz), and must never throw inside submit.
      try {
        if (typeof fbq === 'function') {
          fbq('track', 'Lead', { content_name: 'Archie project submission', value: lastTotal, currency: 'GBP' });
        }
      } catch (e) {}
    }).catch(function () { submitBtn.disabled = false; submitBtn.textContent = submitOriginal; });
  }
  submitBtn.addEventListener('click', doSubmit);

  // Terms-as-a-question → auto-submit with a visible countdown (the button stays,
  // for anyone who'd rather click). Tapping "I agree" starts a short countdown on
  // the submit button; it fires itself at zero, or the instant they click it. Any
  // new message cancels it so they can keep editing their quote.
  function fmtTime(s) { var m = Math.floor(s / 60), r = s % 60; return m + ':' + (r < 10 ? '0' : '') + r; }
  function cancelCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; if (!submitted) submitBtn.textContent = submitLabel; }
  }
  function startCountdown(secs) {
    var left = secs;
    submitBtn.classList.add('ready');
    submitBtn.textContent = 'Submitting in ' + fmtTime(left) + ' · send now';
    countdownTimer = setInterval(function () {
      left--;
      if (left <= 0) { clearInterval(countdownTimer); countdownTimer = null; doSubmit(); return; }
      submitBtn.textContent = 'Submitting in ' + fmtTime(left) + ' · send now';
    }, 1000);
  }
  function acceptTerms(btn) {
    if (termsAccepted || submitted) return;
    if (submitBtn.disabled) { addMsg('bot', 'Add a service to your quote first and I’ll send it right over.', 'note'); return; }
    termsAccepted = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Agreed ✓'; }
    addMsg('bot', 'Great — sending your project to the team now. You can tap the button to send it straight away.', 'note');
    startCountdown(5);
  }
  msgList.addEventListener('click', function (e) {
    var a = e.target.closest('.a-agree');
    if (a) { acceptTerms(a); }
  });

  // ---- Always-on "Email me my quote" (save for later) ----
  // Appears a couple of questions in, so anyone can capture their quote by email
  // at any point without finishing the chat. Saving does NOT submit the project.
  function revealSaveQuote() {
    if (!saveQuote || emailSaved || done) return;
    if (userMsgCount >= 2) saveQuote.hidden = false;
  }
  function markEmailSaved(email, note) {
    emailSaved = true;
    if (!saveQuote) return;
    var row = saveQuote.querySelector('.save-quote-row');
    if (row) row.hidden = true;
    if (saveQuoteNote) { saveQuoteNote.hidden = false; saveQuoteNote.textContent = note || ('Saved — we’ll email your quote to ' + email + '.'); }
    saveQuote.hidden = false;
  }
  if (saveQuote) saveQuote.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = ((saveEmail && saveEmail.value) || '').trim();
    if (!email) return;
    post('save-contact', { email: email }).then(function (res) {
      var d = res.body || {};
      if (!res.ok || d.error) {
        if (saveQuoteNote) { saveQuoteNote.hidden = false; saveQuoteNote.textContent = (d && d.message) || 'That didn’t look like a valid email — please check it.'; }
        return;
      }
      markEmailSaved(email, d.message);
    }).catch(function () {
      if (saveQuoteNote) { saveQuoteNote.hidden = false; saveQuoteNote.textContent = 'Couldn’t save that just now — please try again.'; }
    });
  });

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
    photoBtn.addEventListener('click', function () { if (!busy && !submitted) photoInput.click(); });
    photoInput.addEventListener('change', function () {
      var file = photoInput.files && photoInput.files[0];
      photoInput.value = ''; // let the same file be re-picked later
      if (!file || busy || submitted) return;
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
          if (!submitted) input.focus({ preventScroll: true });
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
    userMsgCount = d.msgCount || 0;
    if (d.hasEmail) emailSaved = true; // already captured — don't offer the save field.
    if (d.placeholder) input.placeholder = d.placeholder;
    if (d.configured === false) {
      addMsg('bot', 'Archie isn’t connected yet — add a Claude API key in <em>Archie → Settings</em> to go live.', 'note');
      setBusy(true);
    } else if (d.busy) {
      addMsg('bot', 'Archie’s very busy right now and has paused new quotes for a short while. Please try again a little later, or email us and we’ll help directly.', 'note');
      input.disabled = true; sendBtn.disabled = true;
    } else {
      renderOptions(d.options);
      revealSaveQuote();
      // Resumed with a finished quote (e.g. from the emailed "Finish & submit"
      // link) — surface the consent + pulsing submit button straight away.
      if (d.done) { done = true; showSubmitReady(); }
      input.focus({ preventScroll: true });
    }
  }).catch(function () { addMsg('bot', 'Archie couldn’t start. Please refresh.', 'note'); });
})();
