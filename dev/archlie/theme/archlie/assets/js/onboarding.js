/* ============================================================
   Your Architect — Archie (two-panel builder), front-end mock.

   A scripted flow that mirrors Tiam's question logic: project type →
   (extensions) storeys → planning status (picks the package) → submit
   the application yourself or we manage it (+£80) → optional 3D concept
   (£250, where not already included) → London site visit (£350) →
   measured survey & structural engineer (sourced separately, quote to
   follow). Archie never states a price — the panel does. Session persists
   to localStorage; voice uses the Web Speech API where available.

   In production this is the `your-architect-archie` plugin talking to the
   Claude API server-side. This mock proves the interaction design.
   ============================================================ */
(function () {
  'use strict';

  var A = window.ARCHLIE;
  var STORE_KEY = 'archlie_v3_session';
  // Archie's face.
  var BOT_SVG = '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><circle cx="24" cy="24" r="23" fill="#E4EFF7"/><path d="M11 20c0-8 6-13 13-13s13 5 13 13" stroke="#253E94" stroke-width="3.4" stroke-linecap="round"/><path d="M12 21c2.5-2 6-3 6-3M36 21c-2.5-2-6-3-6-3" stroke="#253E94" stroke-width="2.2" stroke-linecap="round"/><circle cx="18.5" cy="25" r="4.4" stroke="#253E94" stroke-width="2.4"/><circle cx="30" cy="25" r="4.4" stroke="#253E94" stroke-width="2.4"/><path d="M22.9 25h2.2" stroke="#253E94" stroke-width="2.4" stroke-linecap="round"/><path d="M19 34c2 1.8 8 1.8 10 0" stroke="#253E94" stroke-width="2.6" stroke-linecap="round"/></svg>';

  // ---- DOM ----
  var elMsgList = document.getElementById('msgList');
  var elMessages = document.getElementById('messages');
  var elQuick = document.getElementById('quickReplies');
  var elText = document.getElementById('textInput');
  var elSend = document.getElementById('sendBtn');
  var elMic = document.getElementById('micBtn');
  var elPhotoBtn = document.getElementById('photoBtn');
  var elPhotoInput = document.getElementById('photoInput');
  var elComposerRow = document.getElementById('composerRow');
  var elNodes = document.getElementById('nodes');
  var elNodesEmpty = document.getElementById('nodesEmpty');
  var elTotal = document.getElementById('totalAmt');
  var elToggleTotal = document.getElementById('toggleTotal');
  var elTotalSub = document.getElementById('totalSub');
  var elLondonChip = document.getElementById('londonChip');
  var elRedirect = document.getElementById('redirectBanner');
  var elQuoteMeta = document.getElementById('quoteMeta');
  var elValidity = document.getElementById('mValidity');
  var elDelivery = document.getElementById('mDelivery');
  var elRevisions = document.getElementById('mRevisions');
  var elSubmit = document.getElementById('submitBtn');
  var elRestart = document.getElementById('restartBtn');
  var elPanel = document.getElementById('packagePanel');
  var elPanelToggle = document.getElementById('panelToggle');
  var elSaveBar = document.getElementById('saveBar');
  var elSaveForm = document.getElementById('saveForm');
  var elSaveEmail = document.getElementById('saveEmail');
  var elSaveClose = document.getElementById('saveClose');
  var elSaveInner = elSaveBar ? elSaveBar.querySelector('.sb-inner') : null;
  var elSaveDone = document.getElementById('saveSaved');

  // ---- State ----
  function freshState() {
    return {
      postcode: '', london: false,
      package: null, projectType: '', storeys: '',
      submitApp: false, concept: false, siteVisit: false,
      survey: false, structural: false,
      timeframe: '', name: '', email: '', photoDesc: '',
      messages: [], stepIndex: 0, done: false, submitted: false, savePromptDismissed: false
    };
  }
  var state = freshState();

  // ---- Persistence ----
  var ready = false;
  function save() {
    if (!ready) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function load() {
    try { var raw = localStorage.getItem(STORE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function clearStore() { try { localStorage.removeItem(STORE_KEY); } catch (e) {} }

  // ---- Message rendering ----
  function pushMessage(who, text, opts) {
    opts = opts || {};
    var m = { who: who, text: text, kind: opts.kind || '', img: opts.img || '' };
    state.messages.push(m);
    renderMessage(m);
    scrollDown();
    save();
  }
  function renderMessage(m) {
    var div = document.createElement('div');
    div.className = 'msg ' + m.who + (m.kind ? ' ' + m.kind : '');
    var avatar = m.who === 'bot' ? '<div class="avatar">' + BOT_SVG + '</div>' : '';
    var body = m.img
      ? '<img src="' + m.img + '" alt="Property photo"> <span>' + m.text + '</span>'
      : m.text;
    div.innerHTML = avatar + '<div class="text">' + body + '</div>';
    elMsgList.appendChild(div);
  }
  function scrollDown() {
    requestAnimationFrame(function () { elMessages.scrollTop = elMessages.scrollHeight; });
  }

  var typingEl = null;
  function showTyping() {
    hideTyping();
    typingEl = document.createElement('div');
    typingEl.className = 'msg bot';
    typingEl.innerHTML = '<div class="avatar">' + BOT_SVG + '</div><div class="text typing"><span></span><span></span><span></span></div>';
    elMsgList.appendChild(typingEl);
    scrollDown();
  }
  function hideTyping() { if (typingEl) { typingEl.remove(); typingEl = null; } }

  function botSay(text, opts, delay) {
    showTyping();
    setTimeout(function () {
      hideTyping();
      pushMessage('bot', text, opts);
      if (opts && opts.then) opts.then();
    }, delay || 650);
  }

  // ---- The conversation script (Tiam's question logic) ----
  // Steps may carry a `when(state)` predicate; those that don't apply are skipped.
  var STEPS = [
    { // Q1 — address (detects London / within the M25)
      ask: "Hi — I'm Archie, Your Architect's project assistant. I'll ask a few short questions and build your fixed price as we go. First, what's the address of the property?",
      input: 'address',
      examples: ['24 Roupell St, London SE1 8TB', '8 Chatsworth Rd, London E5', '14 Elm Grove, Manchester M20'],
      onAnswer: function (val, next) {
        state.postcode = val;
        state.london = /london/i.test(val) || /\b(e|ec|n|nw|se|sw|w|wc|br|cr|da|en|ha|ig|kt|rm|sm|tw|ub)\d/i.test(val);
        rebuild();
        botSay("Thanks, got it." + (state.london ? " That's within the M25, so a site visit can be arranged if you'd like one." : ""), { then: next }, 1000);
      }
    },
    { // Q2 — project type
      ask: "What are you looking to do?",
      input: 'chips',
      chips: [
        { label: 'Rear or side extension', value: 'extension' },
        { label: 'Loft or mansard conversion', value: 'loft' },
        { label: 'Garage conversion', value: 'garage' },
        { label: 'Outbuilding', value: 'outbuilding' },
        { label: 'Internal alterations', value: 'internal' },
        { label: 'New dwelling', value: 'newdwelling' }
      ],
      onAnswer: function (val, next) { state.projectType = val; botSay("Great — thanks.", { then: next }); }
    },
    { // Q3 — storeys (extensions only)
      ask: "How many storeys is the extension?",
      input: 'chips',
      when: function (s) { return s.projectType === 'extension'; },
      chips: [
        { label: 'Single storey', value: 'single' },
        { label: 'Two storey', value: 'two' },
        { label: 'Not sure yet', value: 'unsure' }
      ],
      onAnswer: function (val, next) { state.storeys = val; botSay("Noted.", { then: next }); }
    },
    { // Q4 — planning status → package
      ask: "Where are you up to with planning?",
      input: 'chips',
      chips: [
        { label: 'I still need planning permission', value: 'planning' },
        { label: 'Planning is approved — I need building regs', value: 'buildingregs' },
        { label: "It's a full RIBA / larger commission", value: 'riba' }
      ],
      onAnswer: function (val, next) {
        state.package = val;
        rebuild();
        var line = val === 'planning'
          ? "Great — I've set you up with our full planning package."
          : val === 'buildingregs'
            ? "Perfect — since planning's approved, that's our building regs package."
            : "Understood — a full RIBA commission is handled directly by the Tiam Architects team. I'll show you how to reach them on the right.";
        botSay(line, { then: next });
      }
    },
    { // Q5 — who submits the planning application (planning only) → +£80
      ask: "Would you like us to submit and manage the planning application for you, or will you submit and respond yourself?",
      input: 'chips',
      when: function (s) { return s.package === 'planning'; },
      chips: [
        { label: 'Please submit & manage it for me', value: 'us' },
        { label: "I'll submit it myself", value: 'me' }
      ],
      onAnswer: function (val, next) {
        state.submitApp = (val === 'us');
        rebuild();
        botSay(state.submitApp
          ? "Done — I've added submission & management to your package."
          : "No problem — you'll submit it yourself.", { then: next });
      }
    },
    { // Q6 — 3D concept add-on (building regs only; planning already includes it) → +£250
      ask: "Would a 3D concept visual be useful alongside your drawings? It's optional — clear visuals help people picture the finished design.",
      input: 'chips',
      when: function (s) { return s.package === 'buildingregs'; },
      chips: [
        { label: 'Yes, add a 3D concept', value: 'yes' },
        { label: 'No thanks', value: 'no' }
      ],
      onAnswer: function (val, next) {
        state.concept = (val === 'yes');
        rebuild();
        botSay(state.concept ? "Added — a 3D concept with up to two revisions." : "No problem.", { then: next });
      }
    },
    { // Q7 — site visit (London / within M25 only) → +£350
      ask: "Would you like a site visit? It's available for projects in London boroughs, within the M25.",
      input: 'chips',
      when: function (s) { return s.london && s.package && s.package !== 'riba'; },
      chips: [
        { label: 'Yes, please', value: 'yes' },
        { label: 'No need', value: 'no' }
      ],
      onAnswer: function (val, next) {
        state.siteVisit = (val === 'yes');
        rebuild();
        botSay(state.siteVisit ? "Added a site visit to your package." : "No problem.", { then: next });
      }
    },
    { // Q8 — measured survey (sourced separately)
      ask: "Do you already have a measured survey of the property, or shall we arrange one?",
      input: 'chips',
      when: function (s) { return s.package && s.package !== 'riba'; },
      chips: [
        { label: 'I already have measured drawings', value: 'have' },
        { label: "I'll need a survey", value: 'need' }
      ],
      onAnswer: function (val, next) {
        state.survey = (val === 'need');
        rebuild();
        botSay(state.survey
          ? "No problem. A measured survey isn't part of our fee — we'll source an independent local surveyor and share their quote for your approval first. The drawings are yours; you only pay for the survey, not our time."
          : "Great, that keeps things simple — we'll check them over.", { then: next });
      }
    },
    { // Q9 — structural engineer (sourced separately)
      ask: "Will the work involve structural changes — removing walls, adding steels, that sort of thing?",
      input: 'chips',
      when: function (s) { return s.package && s.package !== 'riba'; },
      chips: [
        { label: 'Yes', value: 'yes' },
        { label: 'No / not sure', value: 'no' }
      ],
      onAnswer: function (val, next) {
        state.structural = (val === 'yes');
        rebuild();
        botSay(state.structural
          ? "Thanks — if a structural engineer is needed we'll tell you straight away, source a local engineer and share their quote for your approval before anything proceeds."
          : "Understood.", { then: next });
      }
    },
    { // Q10 — timeframe
      ask: "What's your rough timeframe — submitting soon, or planning ahead?",
      input: 'chips',
      when: function (s) { return s.package && s.package !== 'riba'; },
      chips: [
        { label: 'Next few weeks', value: 'weeks' },
        { label: 'A few months', value: 'months' },
        { label: 'Just planning ahead', value: 'ahead' }
      ],
      onAnswer: function (val, next) { state.timeframe = val; botSay("Good to know.", { then: next }); }
    },
    { // Q11 — contact (package path)
      ask: "Last thing — a name and email so I can save your project and send the summary? Your price is already set; this just lets you pick up where you left off.",
      input: 'contact',
      when: function (s) { return s.package && s.package !== 'riba'; },
      onAnswer: function (val, next) { state.name = val.name || ''; state.email = val.email || ''; rebuild(); next(); }
    },
    { // Q11b — contact (RIBA redirect path)
      ask: "For a full RIBA commission, the Tiam Architects team looks after you directly. Leave your name and email and I'll pass it on — or email them at info@tiamarchitects.com.",
      input: 'contact',
      when: function (s) { return s.package === 'riba'; },
      onAnswer: function (val, next) { state.name = val.name || ''; state.email = val.email || ''; rebuild(); next(); }
    }
  ];

  // Next applicable step at or after `from` (skips steps whose when() is false).
  function nextStepIndex(from) {
    for (var i = from; i < STEPS.length; i++) {
      var st = STEPS[i];
      if (!st.when || st.when(state)) return i;
    }
    return STEPS.length;
  }

  // ---- Package builder: derive nodes from state ----
  function buildPackage() {
    var nodes = [];
    var total = 0;

    if (state.package === 'planning') {
      total += A.PACKAGES.planning.price;
      nodes.push({ id: 'service', label: 'Planning — full package', sub: '3D concept & submission-ready drawings included', price: A.PACKAGES.planning.price, removable: false });
    } else if (state.package === 'buildingregs') {
      total += A.PACKAGES.buildingregs.price;
      nodes.push({ id: 'service', label: 'Building Regs drawings', sub: 'Planning already approved', price: A.PACKAGES.buildingregs.price, removable: false });
    }

    if (state.package === 'planning' && state.submitApp) {
      total += A.ADDONS.submission.price;
      nodes.push({ id: 'submission', label: A.ADDONS.submission.label, sub: 'Add-on', price: A.ADDONS.submission.price, removable: true, kind: 'addon' });
    }
    if (state.package === 'buildingregs' && state.concept) {
      total += A.ADDONS.concept3d.price;
      nodes.push({ id: 'concept3d', label: A.ADDONS.concept3d.label, sub: 'Add-on', price: A.ADDONS.concept3d.price, removable: true, kind: 'addon' });
    }
    if (state.siteVisit && state.london && state.package && state.package !== 'riba') {
      total += A.ADDONS.siteVisit.price;
      nodes.push({ id: 'siteVisit', label: A.ADDONS.siteVisit.label, sub: 'Add-on', price: A.ADDONS.siteVisit.price, removable: true, kind: 'addon' });
    }
    if (state.survey) {
      nodes.push({ id: 'survey', label: 'Measured survey', sub: 'Sourced separately', price: null, removable: true, kind: 'consultant' });
    }
    if (state.structural) {
      nodes.push({ id: 'structural', label: 'Structural engineer', sub: 'Sourced separately', price: null, removable: true, kind: 'consultant' });
    }
    if (state.london && state.package && state.package !== 'riba') {
      nodes.push({ id: 'london', label: '✓ London project', sub: '', price: null, removable: false, kind: 'info' });
    }
    return { nodes: nodes, total: total };
  }

  function isRedirect() { return state.package === 'riba'; }

  // ---- Render the package panel ----
  function rebuild() {
    var pkg = buildPackage();
    elNodes.innerHTML = '';
    if (!pkg.nodes.length) {
      elNodes.appendChild(elNodesEmpty);
    } else {
      pkg.nodes.forEach(function (n) {
        var div = document.createElement('div');
        div.className = 'node' + (n.kind ? ' ' + n.kind : '');
        var priceHtml = n.price === null
          ? '<span class="n-price">' + (n.kind === 'consultant' ? 'quote to follow' : '') + '</span>'
          : '<span class="n-price">' + A.money(n.price) + '</span>';
        var removeBtn = n.removable ? '<button class="n-remove" data-remove="' + n.id + '" title="Remove" aria-label="Remove ' + n.label + '">✕</button>' : '';
        if (n.kind === 'info') {
          div.innerHTML = '<div class="n-main"><div class="n-label">' + n.label + '</div></div>';
        } else {
          div.innerHTML =
            '<div class="n-main"><div class="n-label">' + n.label + '</div>' +
            (n.sub ? '<div class="n-sub">' + n.sub + '</div>' : '') + '</div>' +
            priceHtml + removeBtn;
        }
        elNodes.appendChild(div);
      });
    }
    elTotal.textContent = A.money(pkg.total);
    elToggleTotal.textContent = A.money(pkg.total);
    elLondonChip.classList.toggle('show', state.london);
    if (elDelivery) elDelivery.textContent = A.DELIVERY;
    if (elRevisions) elRevisions.textContent = A.REVISIONS_INCLUDED + ' revisions included';
    elValidity.textContent = quoteValidityDate();
    var priced = !!state.package && state.package !== 'riba';
    elQuoteMeta.hidden = !priced;
    if (elTotalSub) elTotalSub.textContent = priced ? 'Fixed price · survey & structural quoted separately' : 'Nothing is charged now';
    elRedirect.classList.toggle('show', isRedirect());
    elSubmit.textContent = isRedirect() ? 'Contact Tiam Architects' : 'Save & submit project';
    elSubmit.disabled = !(state.package && state.done);
    maybeShowSaveBar();
    save();
  }

  // ---- Save-progress bar (early, optional email capture) ----
  var SAVE_BAR_AFTER = 3;
  function maybeShowSaveBar() {
    if (!elSaveBar) return;
    var show = !state.done && !state.submitted && !state.email &&
               !state.savePromptDismissed && state.stepIndex >= SAVE_BAR_AFTER;
    elSaveBar.hidden = !show;
  }
  function resetSaveBarUI() {
    if (!elSaveBar) return;
    if (elSaveInner) elSaveInner.hidden = false;
    if (elSaveDone) elSaveDone.hidden = true;
    if (elSaveEmail) { elSaveEmail.value = ''; elSaveEmail.style.borderColor = ''; }
    elSaveBar.classList.remove('saved');
  }
  if (elSaveForm) {
    elSaveForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = (elSaveEmail.value || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { elSaveEmail.style.borderColor = '#e5484d'; elSaveEmail.focus(); return; }
      state.email = v; save();
      if (elSaveInner) elSaveInner.hidden = true;
      if (elSaveDone) elSaveDone.hidden = false;
      elSaveBar.classList.add('saved');
      setTimeout(function () { if (elSaveBar) elSaveBar.hidden = true; }, 2800);
    });
  }
  if (elSaveClose) {
    elSaveClose.addEventListener('click', function () {
      state.savePromptDismissed = true; save();
      if (elSaveBar) elSaveBar.hidden = true;
    });
  }

  // Node remove handler (user edits their package directly)
  elNodes.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-remove]');
    if (!btn) return;
    var id = btn.getAttribute('data-remove');
    if (id === 'submission') state.submitApp = false;
    if (id === 'concept3d') state.concept = false;
    if (id === 'siteVisit') state.siteVisit = false;
    if (id === 'survey') state.survey = false;
    if (id === 'structural') state.structural = false;
    rebuild();
    pushMessage('bot', "Done — I've taken that off. Your total's updated on the right.", { kind: 'note' });
  });

  // ---- Input modes ----
  function clearInputs() {
    elQuick.innerHTML = '';
    elComposerRow.querySelectorAll('.contact-fields').forEach(function (n) { n.remove(); });
  }
  var currentStep = null;

  function showInput(step) {
    currentStep = step;
    clearInputs();
    var textMode = (step.input === 'text' || step.input === 'address');
    setComposerEnabled(textMode);

    if (step.input === 'chips') {
      step.chips.forEach(function (c) {
        var b = document.createElement('button');
        b.className = 'chip'; b.type = 'button'; b.textContent = c.label;
        b.addEventListener('click', function () { answer(c.value, c.label); });
        elQuick.appendChild(b);
      });
    } else if (step.input === 'address' || step.input === 'text') {
      (step.examples || []).forEach(function (ex) {
        var b = document.createElement('button');
        b.className = 'chip example'; b.type = 'button'; b.textContent = ex;
        b.addEventListener('click', function () { elText.value = ex; elText.focus({ preventScroll: true }); });
        elQuick.appendChild(b);
      });
      elText.focus({ preventScroll: true });
    } else if (step.input === 'contact') {
      setComposerEnabled(false);
      var wrap = document.createElement('div');
      wrap.className = 'contact-fields';
      wrap.innerHTML =
        '<input type="text" id="cName" placeholder="Your name" autocomplete="name">' +
        '<input type="email" id="cEmail" placeholder="Email" autocomplete="email">' +
        '<button class="btn btn-primary" id="cSave" type="button">Save</button>' +
        '<button class="btn btn-ghost" id="cSkip" type="button">Skip</button>';
      elComposerRow.appendChild(wrap);
      wrap.querySelector('#cName').value = state.name || '';
      wrap.querySelector('#cEmail').value = state.email || '';
      wrap.querySelector('#cSave').addEventListener('click', function () {
        var nm = wrap.querySelector('#cName').value.trim();
        var em = wrap.querySelector('#cEmail').value.trim();
        answer({ name: nm, email: em }, nm ? (nm + (em ? ' · ' + em : '')) : (em || 'Saved'));
      });
      wrap.querySelector('#cSkip').addEventListener('click', function () {
        answer({ name: '', email: '' }, 'Skip for now');
      });
    }
  }

  function setComposerEnabled(on) {
    elText.disabled = !on;
    elSend.disabled = !on;
    elMic.disabled = !on || !speechSupported;
    elText.placeholder = on ? 'Type your answer…' : 'Choose an option above…';
    if (!on) elText.value = '';
  }

  // ---- Advance the flow ----
  function askStep(i) {
    var idx = nextStepIndex(i);
    var step = STEPS[idx];
    if (!step) return finish();
    state.stepIndex = idx;
    save();
    maybeShowSaveBar();
    botSay(step.ask, { then: function () { showInput(step); } });
  }

  function answer(value, displayText) {
    pushMessage('user', displayText != null ? displayText : String(value));
    clearInputs();
    setComposerEnabled(false);
    var step = STEPS[state.stepIndex];
    step.onAnswer(value, function () {
      var nextI = nextStepIndex(state.stepIndex + 1);
      if (nextI >= STEPS.length) { finish(); }
      else { askStep(nextI); }
    });
  }

  // Free-text send (address / text steps)
  function sendText() {
    var v = elText.value.trim();
    if (!v || elText.disabled) return;
    var step = STEPS[state.stepIndex];
    if (!step || (step.input !== 'text' && step.input !== 'address')) return;
    elText.value = '';
    answer(v, v);
  }
  elSend.addEventListener('click', sendText);
  elText.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); }
    autoGrow();
  });
  elText.addEventListener('input', autoGrow);
  function autoGrow() { elText.style.height = 'auto'; elText.style.height = Math.min(elText.scrollHeight, 120) + 'px'; }

  // ---- Finish ----
  function finish() {
    state.done = true;
    elValidity.textContent = quoteValidityDate();
    rebuild();
    if (isRedirect()) {
      botSay("That's a full RIBA commission, so the Tiam Architects team will take it from here. I've noted your details — you can also reach them at <strong>info@tiamarchitects.com</strong>.");
    } else {
      botSay("That's everything — your fixed quote is on the right, valid for 30 days, with drawings issued <strong>within 7 days</strong> of your survey or requirements being confirmed. When you're ready, hit <strong>Save &amp; submit</strong> and our registered architects take it from there.");
    }
  }

  function quoteValidityDate() {
    var d = new Date();
    d.setDate(d.getDate() + A.QUOTE_VALIDITY_DAYS);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  // ---- Submit ----
  elSubmit.addEventListener('click', function () {
    if (elSubmit.disabled) return;
    state.submitted = true; save();
    var ref = 'YA-' + Math.abs(hashStr(state.postcode + state.email + Date.now())).toString(36).slice(0, 6).toUpperCase();
    if (isRedirect()) {
      pushMessage('bot', "Thanks — I've flagged this for the Tiam Architects team (ref <strong>" + ref + "</strong>). In the live platform this notifies them to be in touch. " + (state.email ? "We'll email " + escapeHtml(state.email) + "." : "Or email info@tiamarchitects.com."), { kind: 'note' });
    } else {
      pushMessage('bot', "Project saved ✓ (ref <strong>" + ref + "</strong>). In the live platform this opens your portal to upload sketches and photos, and you'd receive a watermarked preview — you'd only pay to release the full package. " + (state.email ? "A summary is on its way to " + escapeHtml(state.email) + "." : ""), { kind: 'note' });
    }
    elSubmit.disabled = true;
    elSubmit.textContent = 'Submitted ✓';
  });

  function hashStr(s) { var h = 0; for (var i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; } return h; }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---- Photo upload (example vision design-prompt) ----
  var VISION_SAMPLES = [
    "This looks like a Victorian mid-terrace with a single-storey rear addition. The rear elevation faces south with an existing flat-roof outrigger on the left return — good scope for a wraparound extension.",
    "A 1930s semi-detached house with a hipped roof and bay window. The side passage suggests room for a side-return infill, and the loft looks well-suited to a rear dormer.",
    "An Edwardian end-of-terrace in brick with a two-storey back addition. The garden elevation has plenty of light — a glazed rear extension would work nicely here."
  ];
  elPhotoBtn.addEventListener('click', function () { elPhotoInput.click(); });
  elPhotoInput.addEventListener('change', function () {
    var f = elPhotoInput.files && elPhotoInput.files[0];
    if (!f) return;
    var url = URL.createObjectURL(f);
    pushMessage('user', 'Photo of the property', { kind: 'photo', img: url });
    showTyping();
    setTimeout(function () {
      hideTyping();
      var desc = VISION_SAMPLES[Math.floor(Math.random() * VISION_SAMPLES.length)];
      state.photoDesc = desc;
      pushMessage('bot', "Thanks — that's really helpful. " + desc + " I've saved it with your project so the team has a visual to work from.", { kind: 'note' });
    }, 1400);
  });

  // ---- Voice input (Web Speech API where available) ----
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var speechSupported = !!SR;
  var recog = null, recording = false;
  if (!speechSupported) { elMic.title = 'Voice input needs a supported browser (Chrome/Edge)'; }
  elMic.addEventListener('click', function () {
    if (!speechSupported || elText.disabled) return;
    if (recording) { recog && recog.stop(); return; }
    recog = new SR();
    recog.lang = 'en-GB'; recog.interimResults = true; recog.continuous = false;
    var base = elText.value ? elText.value + ' ' : '';
    recog.onstart = function () { recording = true; elMic.classList.add('recording'); };
    recog.onerror = function () { stopRec(); };
    recog.onend = function () { stopRec(); };
    recog.onresult = function (e) {
      var t = '';
      for (var i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      elText.value = base + t; autoGrow();
    };
    recog.start();
  });
  function stopRec() { recording = false; elMic.classList.remove('recording'); }

  // ---- Mobile panel toggle ----
  elPanelToggle.addEventListener('click', function () { elPanel.classList.toggle('open'); });

  // ---- Restart ----
  elRestart.addEventListener('click', function () {
    clearStore();
    state = freshState();
    elMsgList.innerHTML = '';
    elQuoteMeta.hidden = true;
    resetSaveBarUI();
    rebuild();
    start(true);
  });

  // ---- Resume handling ----
  function offerResume(saved) {
    var banner = document.createElement('div');
    banner.className = 'msg';
    banner.innerHTML =
      '<div class="resume-banner" style="width:100%">' +
      '<p>Welcome back — you have a saved project in progress. Pick up where you left off?</p>' +
      '<button class="btn btn-primary btn-sm" id="rResume">Resume</button>' +
      '<button class="btn btn-ghost btn-sm" id="rNew">Start over</button></div>';
    elMsgList.appendChild(banner);
    banner.querySelector('#rResume').addEventListener('click', function () {
      banner.remove();
      resume(saved);
    });
    banner.querySelector('#rNew').addEventListener('click', function () {
      banner.remove();
      clearStore(); state = freshState(); elMsgList.innerHTML = ''; resetSaveBarUI(); rebuild(); start(true);
    });
  }

  function resume(saved) {
    state = saved;
    elMsgList.innerHTML = '';
    state.messages.forEach(renderMessage);
    scrollDown();
    rebuild();
    if (state.done) {
      elValidity.textContent = quoteValidityDate();
      elQuoteMeta.hidden = !(state.package && state.package !== 'riba');
      setComposerEnabled(false);
      if (state.submitted) { elSubmit.disabled = true; elSubmit.textContent = 'Submitted ✓'; }
    } else {
      var step = STEPS[state.stepIndex];
      if (step) showInput(step);
    }
  }

  // ---- Start ----
  function start(freshFlow) {
    if (freshFlow) { askStep(0); }
  }

  function boot() {
    var saved = load();
    resetSaveBarUI();
    rebuild();
    ready = true;
    if (saved && saved.messages && saved.messages.length && !saved.submitted) {
      offerResume(saved);
    } else if (saved && saved.submitted) {
      resume(saved);
    } else {
      start(true);
    }
  }

  if (A) boot();
})();
