/* ============================================================
   Archlie — AI onboarding (two-panel builder), front-end mock.

   Faithful to Brief v3 §6 without a live model: a scripted 10-question
   flow drives a live package panel. Claude "emits" structured updates
   (add/remove/update nodes) and never states a price in conversation —
   the panel does that. Session persists to localStorage (mirroring the
   cookie + Postgres record in the brief). Voice uses the Web Speech API
   where available. Photo upload shows an example vision design-prompt.

   In production this is a React app talking to the Claude API server-side
   (see docs/archlie/README.md). This mock proves the interaction design.
   ============================================================ */
(function () {
  'use strict';

  var A = window.ARCHLIE;
  var STORE_KEY = 'archlie_v3_session';
  // Archie's mark — the Your Architect "t" (restrained, not a chatbot face).
  var BOT_SVG = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13.5 4 V16.5 A3 3 0 0 0 16.5 19.5 H17.5" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 9 H17.5" stroke="white" stroke-width="2.4" stroke-linecap="round"/></svg>';

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
      postcode: '', london: false, listed: false,
      service: null, band: 'B',
      survey: false, structural: false, partyWall: false, concept: false,
      timeframe: '', name: '', email: '', photoDesc: '',
      messages: [], stepIndex: 0, done: false, submitted: false, savePromptDismissed: false
    };
  }
  var state = freshState();

  // ---- Persistence ----
  // `ready` stays false during the initial boot render so the first rebuild()
  // does not overwrite a stored session before we've had a chance to read it.
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

  // Bot says a line after a short "typing" beat.
  function botSay(text, opts, delay) {
    showTyping();
    setTimeout(function () {
      hideTyping();
      pushMessage('bot', text, opts);
      if (opts && opts.then) opts.then();
    }, delay || 650);
  }

  // ---- The conversation script (10 questions, Brief v3 §6) ----
  var STEPS = [
    { // Q1 — address
      ask: "Hi — I'm Archie, Your Architect's project assistant. I'll ask a few short questions and build your fixed price as we go. First, what's the address of the property?",
      input: 'address',
      examples: ['24 Roupell St, London SE1 8TB', '8 Chatsworth Rd, London E5', '14 Elm Grove, Manchester M20'],
      onAnswer: function (val, next) {
        state.postcode = val;
        state.london = /london/i.test(val) || /\b(e|ec|n|nw|se|sw|w|wc|br|cr|da|en|ha|ig|kt|rm|sm|tw|ub)\d/i.test(val);
        state.listed = /roupell|listed|grade\s*(i|ii)/i.test(val);
        rebuild();
        showTyping();
        setTimeout(function () {
          hideTyping();
          if (state.listed) {
            pushMessage('bot', "Thanks. I've checked the Historic England register — that address is <strong>listed</strong>, so I've added a listed building consent to your project. It won't stop you going ahead.");
          } else {
            pushMessage('bot', "Thanks, got it." + (state.london ? " That's a London address, which affects survey pricing." : ""));
          }
          next();
        }, 1100);
      }
    },
    { // Q2 — what are you doing
      ask: "Tell me a bit about what you're looking to do.",
      input: 'text',
      examples: ['A single-storey rear extension', 'A loft conversion', 'A side return extension', 'Convert my garage'],
      onAnswer: function (val, next) { state.brief = val; next(); }
    },
    { // Q3 — planning status -> service
      ask: "Do you already have planning permission, or are you at the stage of applying for it?",
      input: 'chips',
      chips: [
        { label: "I still need planning permission", value: 'planning' },
        { label: "I already have planning permission", value: 'buildingcontrol' },
        { label: "It's permitted development", value: 'permitted' }
      ],
      onAnswer: function (val, next) {
        state.service = val;
        rebuild();
        var line = val === 'planning'
          ? "Great — I've added planning application drawings."
          : val === 'buildingcontrol'
            ? "Perfect — since planning's in place, you'll need building control drawings. Added."
            : "Got it — I've set this up as a permitted development package.";
        botSay(line, { then: next });
      }
    },
    { // Q4 — size band
      ask: "Roughly how large is the area you're working with? A guess is completely fine.",
      input: 'chips',
      chips: [
        { label: "Up to 50m² (a room or two)", value: 'A' },
        { label: "50–100m²", value: 'B' },
        { label: "100–150m²", value: 'C' },
        { label: "More than 150m²", value: 'over' }
      ],
      onAnswer: function (val, next) {
        state.band = val;
        rebuild();
        if (val === 'over') {
          botSay("That's a sizeable project. I'll keep building your summary, but a job this size is usually a full commission with our parent studio — you'll see the option on the right.", { then: next });
        } else {
          botSay("Noted — I'll price everything at that band.", { then: next });
        }
      }
    },
    { // Q5 — survey
      ask: "Do you already have a measured survey or an existing set of drawings for the property?",
      input: 'chips',
      chips: [
        { label: "I already have drawings", value: 'have' },
        { label: "I'll need a survey arranged", value: 'need' }
      ],
      onAnswer: function (val, next) {
        state.survey = (val === 'need');
        rebuild();
        botSay(state.survey
          ? "No problem — I've added a measured survey at our banded rate. Our panel surveyor works to a one-week turnaround."
          : "Great, that keeps things simpler. Do make sure they're accurate — we'll check them over.", { then: next });
      }
    },
    { // Q6 — structural
      ask: "Are there any structural changes involved — removing walls, adding steels, that sort of thing?",
      input: 'chips',
      chips: [{ label: "Yes", value: 'yes' }, { label: "No / not sure", value: 'no' }],
      onAnswer: function (val, next) {
        state.structural = (val === 'yes');
        rebuild();
        botSay(state.structural
          ? "Thanks — you'll likely need a structural engineer. You'd appoint them directly; I've noted it on your summary."
          : "Understood.", { then: next });
      }
    },
    { // Q7 — party wall
      ask: "Is there a shared wall with a neighbour involved in the work?",
      input: 'chips',
      chips: [{ label: "Yes", value: 'yes' }, { label: "No", value: 'no' }],
      onAnswer: function (val, next) {
        state.partyWall = (val === 'yes');
        rebuild();
        botSay(state.partyWall
          ? "Noted — a party wall surveyor may be needed, again appointed directly by you. Added to your summary."
          : "Great.", { then: next });
      }
    },
    { // Q8 — concept add-on
      ask: "Would a concept layout or 3D visual help support your application?",
      input: 'chips',
      chips: [
        { label: "Yes, add a concept design", value: 'yes' },
        { label: "No, just the drawings", value: 'no' }
      ],
      onAnswer: function (val, next) {
        state.concept = (val === 'yes');
        rebuild();
        botSay(state.concept ? "Nice — I've added the concept design add-on." : "No problem.", { then: next });
      }
    },
    { // Q9 — timeframe
      ask: "What's your rough timeframe — submitting in the next few weeks, or more of a planning-ahead conversation?",
      input: 'chips',
      chips: [
        { label: "Next few weeks", value: 'weeks' },
        { label: "A few months", value: 'months' },
        { label: "Just planning ahead", value: 'planning-ahead' }
      ],
      onAnswer: function (val, next) { state.timeframe = val; botSay("Good to know.", { then: next }); }
    },
    { // Q10 — contact (optional)
      ask: "Last thing — a name and email so I can save your project and send the summary? Your price is already set; this is just so you can pick up where you left off.",
      input: 'contact',
      onAnswer: function (val, next) {
        state.name = val.name || '';
        state.email = val.email || '';
        rebuild();
        next();
      }
    }
  ];

  // ---- Package builder: derive nodes from state ----
  function buildPackage() {
    var nodes = [];
    var total = 0;
    var band = (state.band === 'over') ? 'C' : state.band; // price "over" at top band for the summary

    if (state.service && A.SERVICES[state.service]) {
      var s = A.SERVICES[state.service];
      var price = s[band];
      total += price;
      nodes.push({ id: 'service', label: s.label, sub: A.BANDS[band], price: price, removable: false });
    }
    if (state.listed) {
      var lp = A.SERVICES.listed[band];
      total += lp;
      nodes.push({ id: 'listed', label: 'Listed building consent', sub: A.BANDS[band], price: lp, removable: true });
    }
    if (state.survey) {
      var rate = A.SURVEY[band][state.london ? 'london' : 'std'];
      total += rate;
      nodes.push({ id: 'survey', label: 'Measured survey', sub: (state.london ? 'London rate' : 'Standard rate') + ' · ' + A.BANDS[band], price: rate, removable: true });
    }
    if (state.concept) {
      var cp = A.SERVICES.concept[band];
      total += cp;
      nodes.push({ id: 'concept', label: 'Concept design + 3D visual', sub: 'Add-on · ' + A.BANDS[band], price: cp, removable: true, kind: 'addon' });
    }
    if (state.structural) {
      nodes.push({ id: 'structural', label: 'Structural engineer', sub: 'Appointed directly by you', price: null, removable: true, kind: 'consultant' });
    }
    if (state.partyWall) {
      nodes.push({ id: 'partyWall', label: 'Party wall surveyor', sub: 'Appointed directly by you', price: null, removable: true, kind: 'consultant' });
    }
    if (state.london && (state.survey || state.service)) {
      nodes.push({ id: 'london', label: '✓ London pricing applied', sub: '', price: null, removable: false, kind: 'info' });
    }
    return { nodes: nodes, total: total };
  }

  function isRedirect(total) {
    return state.band === 'over' || total > A.REDIRECT.feeOver;
  }

  // ---- Render the package panel ----
  function rebuild() {
    var pkg = buildPackage();
    // nodes
    elNodes.innerHTML = '';
    if (!pkg.nodes.length) {
      elNodes.appendChild(elNodesEmpty);
    } else {
      pkg.nodes.forEach(function (n) {
        var div = document.createElement('div');
        div.className = 'node' + (n.kind ? ' ' + n.kind : '');
        var priceHtml = n.price === null
          ? '<span class="n-price">' + (n.kind === 'consultant' ? 'you appoint' : '') + '</span>'
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
    // total
    elTotal.textContent = A.money(pkg.total);
    elToggleTotal.textContent = A.money(pkg.total);
    elLondonChip.classList.toggle('show', state.london);
    // quote meta (delivery / revisions / validity) — always shown, date live
    elValidity.textContent = quoteValidityDate();
    elQuoteMeta.hidden = !state.service;
    // redirect
    elRedirect.classList.toggle('show', isRedirect(pkg.total));
    elSubmit.textContent = isRedirect(pkg.total) ? 'Request a Tiam consultation' : 'Save & submit project';
    // enable submit once there's a service and the flow has reached the end
    elSubmit.disabled = !(state.service && state.done);
    maybeShowSaveBar();
    save();
  }

  // ---- Save-progress bar (early, optional email capture; Brief v3 §4) ----
  var SAVE_BAR_AFTER = 3; // appears after the first few answered questions
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
    if (id === 'listed') state.listed = false;
    if (id === 'survey') state.survey = false;
    if (id === 'concept') state.concept = false;
    if (id === 'structural') state.structural = false;
    if (id === 'partyWall') state.partyWall = false;
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
    var step = STEPS[i];
    if (!step) return finish();
    state.stepIndex = i;
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
      var nextI = state.stepIndex + 1;
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
    var pkg = buildPackage();
    var validity = quoteValidityDate();
    elValidity.textContent = validity;
    elQuoteMeta.hidden = false;
    rebuild();
    if (isRedirect(pkg.total)) {
      botSay("That's everything I need. Your summary's on the right. Because of the size or scope, I'd recommend a full consultation with Tiam Architects — tap the button on the right and the team will be in touch. Your quote is valid for 30 days.");
    } else {
      botSay("That's everything — your fixed quote is on the right, valid for 30 days, with delivery in 3–7 working days. When you're ready, hit <strong>Save &amp; submit</strong> and our registered architects take it from there.");
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
    var ref = 'ARCH-' + Math.abs(hashStr(state.postcode + state.email + Date.now())).toString(36).slice(0, 6).toUpperCase();
    var pkg = buildPackage();
    if (isRedirect(pkg.total)) {
      pushMessage('bot', "Thanks — I've flagged this for a Tiam Architects consultation (ref <strong>" + ref + "</strong>). In the live platform this notifies the team and books your call. " + (state.email ? "We'll email " + escapeHtml(state.email) + "." : ""), { kind: 'note' });
    } else {
      pushMessage('bot', "Project saved ✓ (ref <strong>" + ref + "</strong>). In the live platform this opens your portal to upload drawings and receive a watermarked preview — you'd only pay to release the full package. " + (state.email ? "A summary is on its way to " + escapeHtml(state.email) + "." : ""), { kind: 'note' });
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
    // re-render transcript
    elMsgList.innerHTML = '';
    state.messages.forEach(renderMessage);
    scrollDown();
    rebuild();
    if (state.done) {
      elValidity.textContent = quoteValidityDate();
      elQuoteMeta.hidden = false;
      setComposerEnabled(false);
      if (state.submitted) { elSubmit.disabled = true; elSubmit.textContent = 'Submitted ✓'; }
    } else {
      // re-show the input for the current step (question already in transcript)
      var step = STEPS[state.stepIndex];
      if (step) showInput(step);
    }
  }

  // ---- Start ----
  function start(freshFlow) {
    if (freshFlow) { askStep(0); }
  }

  function boot() {
    var saved = load();   // read the stored session BEFORE any save() can run
    resetSaveBarUI();
    rebuild();            // initial render (ready === false, so this does not persist)
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
