/* October Events — public customer support chat widget.
 *
 * A self-contained floating chat. Verifies the visitor with an emailed code,
 * then chats against the scoped oe/v1/support endpoints. No framework, no deps. */
(function () {
  'use strict';
  var CFG = window.OE_SUPPORT || {};
  if (!CFG.restUrl) { return; }

  var mounts = document.querySelectorAll('#oe-support-chat, .oe-support-inline');
  if (!mounts.length) { return; }

  function api(path, body) {
    return fetch(CFG.restUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json().then(function (j) { return { status: r.status, json: j }; }); });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function format(text) {
    var s = esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    return s.split(/\n{2,}/).map(function (p) {
      return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  function Widget(mount, floating) {
    var token = null;
    var email = '';
    var thread = [];
    var step = 'email'; // email -> code -> chat
    var busy = false;

    var root = document.createElement('div');
    root.className = 'oe-sc' + (floating ? ' oe-sc-floating' : ' oe-sc-inline');
    mount.appendChild(root);

    var launcher = null;
    if (floating) {
      launcher = document.createElement('button');
      launcher.className = 'oe-sc-launch';
      launcher.setAttribute('aria-label', 'Open support chat');
      launcher.innerHTML = '<span>Need help?</span>';
      root.appendChild(launcher);
      launcher.addEventListener('click', function () { root.classList.toggle('open'); paint(); });
    }

    var panel = document.createElement('div');
    panel.className = 'oe-sc-panel';
    panel.innerHTML =
      '<header class="oe-sc-head"><span class="oe-sc-title">' + esc(CFG.brand || 'Support') + '</span>' +
      (floating ? '<button class="oe-sc-close" aria-label="Close">×</button>' : '') + '</header>' +
      '<div class="oe-sc-log"></div>' +
      '<form class="oe-sc-bar"><input class="oe-sc-input" autocomplete="off"><button class="oe-sc-send" type="submit">Send</button></form>';
    root.appendChild(panel);
    if (!floating) { root.classList.add('open'); }

    var log = panel.querySelector('.oe-sc-log');
    var form = panel.querySelector('.oe-sc-bar');
    var input = panel.querySelector('.oe-sc-input');
    var closeBtn = panel.querySelector('.oe-sc-close');
    if (closeBtn) { closeBtn.addEventListener('click', function () { root.classList.remove('open'); }); }

    function add(role, html) {
      var b = document.createElement('div');
      b.className = 'oe-sc-msg oe-sc-' + (role === 'assistant' ? 'ai' : role === 'system' ? 'sys' : 'me');
      b.innerHTML = '<div class="oe-sc-body">' + html + '</div>';
      log.appendChild(b);
      log.scrollTop = log.scrollHeight;
      return b;
    }

    function paint() {
      if (!log.childElementCount) {
        add('system', '<p>Hi! I can look up your orders and tickets. To keep things private, ' +
          'enter the email you used to book and I’ll send you a 6-digit code.</p>');
        input.placeholder = 'Your email address';
        input.type = 'email';
        input.focus();
      }
    }

    function setBusy(on) {
      busy = on;
      input.disabled = on;
      form.querySelector('.oe-sc-send').disabled = on;
    }

    function typing() {
      var t = add('assistant', '<div class="oe-sc-typing"><span></span><span></span><span></span></div>');
      t.dataset.typing = '1';
      return t;
    }

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (busy) { return; }
      var val = input.value.trim();
      if (!val) { return; }

      if (step === 'email') {
        email = val;
        add('me', '<p>' + esc(val) + '</p>');
        input.value = '';
        setBusy(true);
        var t = typing();
        api('/support/request-code', { email: email }).then(function (res) {
          t.remove();
          add('system', '<p>' + esc(res.json.message || 'Check your email for a code.') + '</p>');
          if (res.json.ok) {
            step = 'code';
            input.type = 'text';
            input.placeholder = '6-digit code';
          }
          setBusy(false);
          input.focus();
        }).catch(function () { t.remove(); add('system', '<p>Something went wrong. Please try again.</p>'); setBusy(false); });
        return;
      }

      if (step === 'code') {
        add('me', '<p>' + esc(val) + '</p>');
        input.value = '';
        setBusy(true);
        var t2 = typing();
        api('/support/verify', { email: email, code: val }).then(function (res) {
          t2.remove();
          if (res.json.ok && res.json.token) {
            token = res.json.token;
            step = 'chat';
            input.type = 'text';
            input.placeholder = 'Ask about your order or tickets…';
            add('assistant', '<p>You’re verified ✅ How can I help with your order today?</p>');
          } else {
            add('system', '<p>' + esc(res.json.message || 'That code didn’t work.') + '</p>');
          }
          setBusy(false);
          input.focus();
        }).catch(function () { t2.remove(); add('system', '<p>Something went wrong. Please try again.</p>'); setBusy(false); });
        return;
      }

      // step === 'chat'
      add('me', '<p>' + esc(val) + '</p>');
      thread.push({ role: 'user', content: val });
      input.value = '';
      setBusy(true);
      var t3 = typing();
      api('/support/chat', { token: token, messages: thread }).then(function (res) {
        t3.remove();
        if (res.status === 401 && res.json.expired) {
          token = null; step = 'email'; thread = [];
          input.type = 'email'; input.placeholder = 'Your email address';
          add('system', '<p>' + esc(res.json.reply) + '</p>');
        } else {
          var reply = (res.json && res.json.reply) || 'Sorry, please try again.';
          thread.push({ role: 'assistant', content: reply });
          add('assistant', format(reply));
        }
        setBusy(false);
        input.focus();
      }).catch(function () { t3.remove(); add('assistant', '<p>Sorry — I had trouble. Please try again.</p>'); setBusy(false); });
    });

    paint();
  }

  Array.prototype.forEach.call(mounts, function (m) {
    Widget(m, m.getAttribute('data-mode') === 'floating');
  });
})();
