// OMI Xero Brain content script.
// Reads payee names from the Xero reconciliation page, queries the OMI supplier
// brain, and injects a read-only advisory element below each bank line.
//
// Compliance: strictly read-only. No clicks, no field population, no form
// submission, no DOM mutation beyond injecting .omi-brain-advice elements
// and the diagnostic banner.

(function () {
  'use strict';

  const LOOKUP_CACHE = new Map();
  const PROCESSED_ATTR = 'data-omi-brain';
  const DEBOUNCE_MS = 300;
  const DIAG = true;
  let config = null;
  let bankAccountsCache = null;

  async function getConfig() {
    if (config) return config;
    try {
      const data = await chrome.storage.local.get(['omiServerUrl', 'omiToken']);
      if (data.omiServerUrl && data.omiToken) {
        config = { serverUrl: data.omiServerUrl, token: data.omiToken };
        return config;
      }
    } catch {
      // storage inaccessible
    }
    return null;
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.omiServerUrl || changes.omiToken) {
      config = null;
      bankAccountsCache = null;
      LOOKUP_CACHE.clear();
      removeAllAdvice();
      scanPage();
    }
  });

  function removeAllAdvice() {
    document.querySelectorAll('.omi-brain-advice').forEach((el) => el.remove());
    document.querySelectorAll(`[${PROCESSED_ATTR}]`).forEach((el) => {
      el.removeAttribute(PROCESSED_ATTR);
    });
  }

  function sendToBackground(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ error: 'network', message: chrome.runtime.lastError.message });
          return;
        }
        resolve(response);
      });
    });
  }

  async function lookupPayee(payee, lineText, cfg) {
    const cacheKey = (payee + '||' + (lineText || '')).toLowerCase().trim();
    if (LOOKUP_CACHE.has(cacheKey)) return LOOKUP_CACHE.get(cacheKey);

    let url = `${cfg.serverUrl}/api/accounts/brain/lookup?payee=${encodeURIComponent(payee)}`;
    if (lineText) url += `&lineText=${encodeURIComponent(lineText)}`;

    const res = await sendToBackground({
      type: 'brain-fetch',
      url,
      headers: { Authorization: `Bearer ${cfg.token}` },
    });

    if (res.error) {
      return { error: res.error, message: res.message || 'Cannot reach OMI' };
    }

    if (res.status === 401) {
      const result = { error: 'auth', message: 'Extension token expired or revoked. Reconnect in the OMI extension popup.' };
      LOOKUP_CACHE.set(cacheKey, result);
      return result;
    }
    if (!res.ok) {
      return { error: 'server', message: `OMI returned ${res.status}` };
    }

    LOOKUP_CACHE.set(cacheKey, res.data);
    return res.data;
  }

  async function fetchBankAccounts(cfg) {
    if (bankAccountsCache) return bankAccountsCache;
    const res = await sendToBackground({
      type: 'brain-fetch',
      url: `${cfg.serverUrl}/api/accounts/brain/bank-accounts`,
      headers: { Authorization: `Bearer ${cfg.token}` },
    });
    if (res.ok && res.data && res.data.accounts) {
      bankAccountsCache = res.data.accounts;
      return bankAccountsCache;
    }
    return [];
  }

  function confidenceLabel(counter) {
    if (counter >= 10) return 'Settled';
    if (counter >= 5) return 'Confident';
    if (counter >= 3) return 'Learning';
    return 'New';
  }

  function confidenceClass(counter) {
    if (counter >= 5) return 'omi-brain-advice--high';
    if (counter >= 3) return 'omi-brain-advice--medium';
    return 'omi-brain-advice--low';
  }

  function createAdviceElement(payee, result) {
    const el = document.createElement('div');
    el.className = 'omi-brain-advice';
    el.setAttribute(OMI_INJECTED, '1');

    if (result.error) {
      el.classList.add('omi-brain-advice--error');
      el.innerHTML = `
        <svg class="omi-brain-icon" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 4a.75.75 0 011.5 0v3a.75.75 0 01-1.5 0V5zm.75 6.5a1 1 0 110-2 1 1 0 010 2z"/>
        </svg>
        <div class="omi-brain-content">
          <div class="omi-brain-label">${escapeHtml(result.message)}</div>
        </div>`;
      return el;
    }

    if (!result.found) {
      el.classList.add('omi-brain-advice--not-found');
      el.innerHTML = `
        <svg class="omi-brain-icon" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 4.75a.75.75 0 011.5 0v.5a.75.75 0 01-1.5 0v-.5zm0 3a.75.75 0 011.5 0v.5a.75.75 0 01-1.5 0v-.5z"/>
        </svg>
        <div class="omi-brain-content">
          <div class="omi-brain-label">Unknown supplier</div>
          <div class="omi-brain-detail">No match for "${escapeHtml(payee)}" in the supplier brain.</div>
        </div>`;
      return el;
    }

    const s = result.supplier;
    const conf = s.confidenceCounter || 0;
    el.classList.add(confidenceClass(conf));

    if (s.type === 'transfer') {
      el.innerHTML = `
        <svg class="omi-brain-icon" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 8a.75.75 0 01.75-.75h8.69L9.22 5.03a.75.75 0 011.06-1.06l3.5 3.5a.75.75 0 010 1.06l-3.5 3.5a.75.75 0 01-1.06-1.06l2.22-2.22H2.75A.75.75 0 012 8z"/>
        </svg>
        <div class="omi-brain-content">
          <div class="omi-brain-label">${escapeHtml(s.displayName)}</div>
          <div class="omi-brain-detail">
            <span><strong>Transfer to ${escapeHtml(s.destinationBankAccountName || '?')}</strong></span>
          </div>
          <div class="omi-brain-confidence">${confidenceLabel(conf)} (${conf} confirmed)</div>
        </div>
        <button class="omi-brain-correct-btn" data-supplier-id="${s.id}" title="Correct this coding">Correct</button>`;
    } else {
      const vatLabel = formatVat(s.vatTreatment);
      const rcBadge = s.isReverseCharge ? ' <strong style="color:#b45309">[RC]</strong>' : '';
      const codingNote = s.codingTrigger
        ? `<span class="omi-brain-coding-trigger">(matched: ${escapeHtml(s.codingTrigger)})</span>`
        : '';

      el.innerHTML = `
        <svg class="omi-brain-icon" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 3.75a.75.75 0 011.5 0v4.5a.75.75 0 01-1.5 0v-4.5zm.75 7.25a1 1 0 110-2 1 1 0 010 2z"/>
        </svg>
        <div class="omi-brain-content">
          <div class="omi-brain-label">${escapeHtml(s.displayName)} ${codingNote}</div>
          <div class="omi-brain-detail">
            <span><strong>${escapeHtml(s.accountCode || '?')}</strong> ${escapeHtml(s.accountName || '')}</span>
            <span>VAT: ${vatLabel}${rcBadge}</span>
          </div>
          <div class="omi-brain-confidence">${confidenceLabel(conf)} (${conf} confirmed)</div>
        </div>
        <button class="omi-brain-correct-btn" data-supplier-id="${s.id}" title="Correct this coding">Correct</button>`;
    }

    const btn = el.querySelector('.omi-brain-correct-btn');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showCorrectionForm(el, s);
    });

    return el;
  }

  function showCorrectionForm(adviceEl, supplier) {
    if (adviceEl.querySelector('.omi-brain-correct-form')) return;

    const isTransfer = supplier.type === 'transfer';
    const form = document.createElement('form');
    form.className = 'omi-brain-correct-form';

    form.innerHTML = `
      <div class="omi-brain-form-row">
        <select name="type" class="omi-brain-type-select">
          <option value="expense"${!isTransfer ? ' selected' : ''}>Expense</option>
          <option value="transfer"${isTransfer ? ' selected' : ''}>Transfer</option>
        </select>
      </div>
      <div class="omi-brain-expense-fields"${isTransfer ? ' style="display:none"' : ''}>
        <input type="text" name="accountCode" placeholder="Account code" value="${escapeHtml(supplier.accountCode || '')}" style="width:80px">
        <select name="vatTreatment">
          <option value="">VAT treatment</option>
          <option value="INPUT2"${supplier.vatTreatment === 'INPUT2' ? ' selected' : ''}>INPUT2 (20%)</option>
          <option value="ZERORATEDINPUT"${supplier.vatTreatment === 'ZERORATEDINPUT' ? ' selected' : ''}>Zero-rated</option>
          <option value="EXEMPTINPUT"${supplier.vatTreatment === 'EXEMPTINPUT' ? ' selected' : ''}>Exempt</option>
          <option value="NONE"${supplier.vatTreatment === 'NONE' ? ' selected' : ''}>No VAT</option>
          <option value="RRINPUT"${supplier.vatTreatment === 'RRINPUT' ? ' selected' : ''}>Reverse charge</option>
          <option value="RRINPUT2"${supplier.vatTreatment === 'RRINPUT2' ? ' selected' : ''}>Reverse charge (20%)</option>
          <option value="REVERSECHARGES"${supplier.vatTreatment === 'REVERSECHARGES' ? ' selected' : ''}>Reverse charges</option>
        </select>
      </div>
      <div class="omi-brain-transfer-fields"${!isTransfer ? ' style="display:none"' : ''}>
        <select name="destinationBankAccountId" class="omi-brain-bank-select">
          <option value="">Loading bank accounts...</option>
        </select>
      </div>
      <input type="text" name="notes" placeholder="Notes (optional)" style="flex:1;min-width:100px">
      <button type="submit">Save</button>
      <button type="button" class="cancel">Cancel</button>`;

    const typeSelect = form.querySelector('.omi-brain-type-select');
    const expenseFields = form.querySelector('.omi-brain-expense-fields');
    const transferFields = form.querySelector('.omi-brain-transfer-fields');

    typeSelect.addEventListener('change', () => {
      const isT = typeSelect.value === 'transfer';
      expenseFields.style.display = isT ? 'none' : '';
      transferFields.style.display = isT ? '' : 'none';
    });

    // Load bank accounts for the transfer picker.
    (async () => {
      const cfg = await getConfig();
      if (!cfg) return;
      const accounts = await fetchBankAccounts(cfg);
      const bankSelect = form.querySelector('.omi-brain-bank-select');
      bankSelect.innerHTML = '<option value="">Select bank account</option>';
      for (const a of accounts) {
        const opt = document.createElement('option');
        opt.value = a.xero_account_id;
        opt.textContent = `${a.name} (${a.currency})`;
        opt.dataset.name = a.name;
        if (supplier.destinationBankAccountId === a.xero_account_id) opt.selected = true;
        bankSelect.appendChild(opt);
      }
    })();

    form.querySelector('.cancel').addEventListener('click', () => form.remove());

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const type = fd.get('type');
      const bankSelect = form.querySelector('.omi-brain-bank-select');
      const selectedOption = bankSelect.options[bankSelect.selectedIndex];

      const body = {
        supplierId: supplier.id,
        type,
        codingId: supplier.codingId || undefined,
      };

      if (type === 'expense') {
        body.accountCode = fd.get('accountCode');
        body.vatTreatment = fd.get('vatTreatment') || undefined;
      } else {
        body.destinationBankAccountId = fd.get('destinationBankAccountId') || undefined;
        body.destinationBankAccountName = selectedOption ? selectedOption.dataset.name : undefined;
      }

      body.notes = fd.get('notes') || undefined;

      const cfg = await getConfig();
      if (!cfg) return;

      try {
        const res = await sendToBackground({
          type: 'brain-fetch',
          url: `${cfg.serverUrl}/api/accounts/brain/correct`,
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${cfg.token}`,
            'Content-Type': 'application/json',
          },
          body,
        });

        if (res.error) {
          form.innerHTML = `<span style="color:#dc2626">Failed: ${escapeHtml(res.message)}</span>`;
          return;
        }
        if (!res.ok) {
          const errMsg = (res.data && res.data.error) || 'Unknown error';
          form.innerHTML = `<span style="color:#dc2626">Failed: ${escapeHtml(errMsg)}</span>`;
          return;
        }

        LOOKUP_CACHE.clear();
        form.innerHTML = '<span style="color:#16a34a">Corrected. Refreshing...</span>';
        setTimeout(() => {
          const parent = adviceEl.parentElement;
          adviceEl.remove();
          if (parent) {
            const row = parent.closest('[data-omi-brain]');
            if (row) row.removeAttribute(PROCESSED_ATTR);
          }
          scanPage();
        }, 800);
      } catch {
        form.innerHTML = `<span style="color:#dc2626">Network error</span>`;
      }
    });

    adviceEl.querySelector('.omi-brain-content').appendChild(form);
  }

  function formatVat(treatment) {
    if (!treatment) return 'Unknown';
    const map = {
      INPUT2: '20% standard',
      ZERORATEDINPUT: 'Zero-rated',
      EXEMPTINPUT: 'Exempt',
      NONE: 'No VAT',
      RRINPUT: 'Reverse charge',
      RRINPUT2: 'Reverse charge (20%)',
      REVERSECHARGES: 'Reverse charges',
    };
    return map[treatment] || treatment;
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // --- DOM discovery ---
  const OMI_INJECTED = 'data-omi-injected';

  function isOmiElement(el) {
    return el.closest && (el.closest('.omi-brain-advice') || el.closest('#omi-brain-diag') || el.hasAttribute(OMI_INJECTED));
  }

  function isStatementLine(el) {
    const text = el.textContent || '';
    return /\d/.test(text) && (/(spent|received)/i.test(text) || /[\d.,]+\s*$/.test(text.trim()));
  }

  function findBankLineRows() {
    const selectors = [
      '.bank-rec-line',
      '.xrb-line',
      '[class*="StatementLine"]',
      '[class*="bankRecLine"]',
      '[class*="statement-line"]',
      '[class*="reconcile-line"]',
      '[class*="bank-statement"]',
      'tr.xrb-line',
      'tr[class*="rec-line"]',
      '[data-automationid*="statement"]',
      '[data-automationid*="bankLine"]',
      '[data-automationid*="reconcil"]',
      '[data-testid*="statement"]',
      '[data-testid*="bank-line"]',
      '[data-testid*="reconcil"]',
    ];

    for (const sel of selectors) {
      try {
        const rows = document.querySelectorAll(sel);
        if (rows.length) {
          const filtered = Array.from(rows).filter(r => !isOmiElement(r) && isStatementLine(r));
          if (filtered.length) {
            diagLog(`Found ${filtered.length} rows via: ${sel} (${rows.length} raw, ${rows.length - filtered.length} excluded)`);
            return filtered;
          }
        }
      } catch { /* invalid selector */ }
    }

    return [];
  }

  function getCleanText(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.omi-brain-advice, [data-omi-injected]').forEach(n => n.remove());
    return clone.textContent || '';
  }

  function extractLineInfo(row) {
    const fullText = getCleanText(row);

    const isReceived = /received/i.test(fullText) && !/spent/i.test(fullText);
    const direction = isReceived ? 'received' : 'spent';

    const payeeSelectors = [
      '.xrb-payee', '.xrb-line__payee', '[class*="payee"]',
      '.xrb-narrative', '.xrb-line__narrative', '[class*="narrative"]',
      '.xrb-desc', '.xrb-line__desc', '[class*="description"]',
      '[class*="Payee"]', '[class*="Narrative"]', '[class*="Description"]',
      '[data-automationid*="payee"]', '[data-automationid*="description"]',
      '[data-testid*="payee"]', '[data-testid*="description"]',
    ];

    let payee = null;
    for (const sel of payeeSelectors) {
      try {
        const el = row.querySelector(sel);
        if (el && !isOmiElement(el)) {
          const text = el.textContent.trim();
          if (text.length >= 2) { payee = text; break; }
        }
      } catch { /* invalid selector */ }
    }

    if (!payee) {
      const cells = row.querySelectorAll('td, div, span');
      for (const cell of cells) {
        if (isOmiElement(cell)) continue;
        if (cell.children.length > 3) continue;
        const text = cell.textContent.trim();
        if (text.length >= 3 && text.length < 120 && !/^[\d.,\-+$£€]+$/.test(text) && !/^\d{1,2}\s\w{3}\s\d{4}$/.test(text)) {
          payee = text;
          break;
        }
      }
    }

    return {
      payee,
      lineText: fullText.replace(/\s+/g, ' ').trim().slice(0, 500),
      direction,
    };
  }

  async function processRow(row, cfg) {
    if (row.getAttribute(PROCESSED_ATTR)) return;
    row.setAttribute(PROCESSED_ATTR, 'pending');

    const info = extractLineInfo(row);

    if (!info.payee) {
      row.setAttribute(PROCESSED_ATTR, 'no-payee');
      diagLog(`Row skipped (no payee extracted): ${row.className || row.tagName}`);
      return;
    }

    // Suppress suggestions on received lines.
    if (info.direction === 'received') {
      row.setAttribute(PROCESSED_ATTR, 'received');
      diagLog(`Row skipped (received line): "${info.payee}"`);
      return;
    }

    diagLog(`Looking up payee: "${info.payee}" (lineText: ${info.lineText.slice(0, 80)}...)`);
    const result = await lookupPayee(info.payee, info.lineText, cfg);
    row.setAttribute(PROCESSED_ATTR, 'done');

    const advice = createAdviceElement(info.payee, result);

    const target = row.querySelector('[class*="details"], [class*="content"], [class*="info"]') || row;
    target.appendChild(advice);
  }

  let scanTimeout = null;

  async function scanPage() {
    const cfg = await getConfig();
    if (!cfg) {
      diagLog('No config (token/URL not set)');
      updateBanner('Not configured. Set token in extension popup.', 'warn');
      return;
    }

    const rows = findBankLineRows();
    updateBanner(
      rows.length
        ? `Found ${rows.length} statement line(s). Querying brain...`
        : 'Reconcile view not detected. Waiting for DOM changes...',
      rows.length ? 'ok' : 'wait'
    );

    for (const row of rows) {
      if (!row.getAttribute(PROCESSED_ATTR)) {
        await processRow(row, cfg);
      }
    }

    if (rows.length) {
      const done = document.querySelectorAll(`[${PROCESSED_ATTR}="done"]`).length;
      const received = document.querySelectorAll(`[${PROCESSED_ATTR}="received"]`).length;
      const msg = received
        ? `${done} of ${rows.length} lines processed (${received} received lines skipped).`
        : `${done} of ${rows.length} lines processed.`;
      updateBanner(msg, 'ok');
    }
  }

  function debouncedScan() {
    clearTimeout(scanTimeout);
    scanTimeout = setTimeout(scanPage, DEBOUNCE_MS);
  }

  // --- Diagnostic banner ---
  let bannerEl = null;

  function ensureBanner() {
    if (bannerEl && document.body.contains(bannerEl)) return bannerEl;
    bannerEl = document.createElement('div');
    bannerEl.id = 'omi-brain-diag';
    bannerEl.setAttribute(OMI_INJECTED, '1');
    bannerEl.style.cssText = `
      position: fixed; bottom: 8px; right: 8px; z-index: 999999;
      background: #1e293b; color: #e2e8f0; font-family: monospace;
      font-size: 11px; padding: 6px 12px; border-radius: 6px;
      max-width: 420px; line-height: 1.4; box-shadow: 0 2px 8px rgba(0,0,0,.3);
      pointer-events: none;
    `;
    document.body.appendChild(bannerEl);
    return bannerEl;
  }

  function updateBanner(msg, level) {
    if (!DIAG) return;
    const b = ensureBanner();
    const colors = { ok: '#4ade80', warn: '#fbbf24', err: '#f87171', wait: '#94a3b8' };
    const dot = `<span style="color:${colors[level] || colors.wait}">&#9679;</span>`;
    b.innerHTML = `${dot} OMI Brain: ${escapeHtml(msg)}`;
  }

  const diagMessages = [];
  function diagLog(msg) {
    if (!DIAG) return;
    diagMessages.push(msg);
    console.log('[OMI Brain]', msg);
  }

  function diagDump() {
    const info = {
      url: location.href,
      configLoaded: !!config,
      cacheSize: LOOKUP_CACHE.size,
      messages: diagMessages.slice(-30),
      domSnapshot: domSnapshot(),
    };
    console.log('[OMI Brain] Diagnostic dump:', JSON.stringify(info, null, 2));
    return info;
  }

  function domSnapshot() {
    const body = document.body;
    if (!body) return 'no body';

    const markers = [];
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null);
    let count = 0;
    while (walker.nextNode() && count < 500) {
      count++;
      const text = walker.currentNode.textContent.trim();
      if (!text) continue;
      if (/\b(Spent|Received|Reconcile|Statement|Bank|Payee|Match|Create|Transfer)\b/i.test(text)) {
        const el = walker.currentNode.parentElement;
        if (el) {
          markers.push({
            text: text.slice(0, 80),
            tag: el.tagName.toLowerCase(),
            class: el.className ? String(el.className).slice(0, 120) : '',
            parent: el.parentElement ? `${el.parentElement.tagName.toLowerCase()}.${String(el.parentElement.className).slice(0, 80)}` : '',
          });
        }
      }
    }
    return markers.slice(0, 30);
  }

  window.__omiBrainDiag = diagDump;

  const observer = new MutationObserver((mutations) => {
    let hasNewContent = false;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1 && (node.hasAttribute && node.hasAttribute(OMI_INJECTED))) continue;
        if (node.nodeType === 1 && (node.classList && node.classList.contains('omi-brain-advice'))) continue;
        hasNewContent = true;
        break;
      }
      if (hasNewContent) break;
    }
    if (hasNewContent) debouncedScan();
  });

  function init() {
    diagLog(`Content script loaded on ${location.href}`);
    updateBanner('Script loaded. Scanning page...', 'wait');
    observer.observe(document.body, { childList: true, subtree: true });
    scanPage();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
