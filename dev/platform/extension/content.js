// OMI Xero Brain content script.
// Reads payee names from the Xero reconciliation page, queries the OMI supplier
// brain, and injects a read-only advisory element below each bank line.
//
// Compliance: strictly read-only. No clicks, no field population, no form
// submission, no DOM mutation beyond injecting .omi-brain-advice elements.

(function () {
  'use strict';

  const LOOKUP_CACHE = new Map();
  const PROCESSED_ATTR = 'data-omi-brain';
  const DEBOUNCE_MS = 300;
  let config = null;

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

  // Listen for config changes (user saves in popup while page is open).
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.omiServerUrl || changes.omiToken) {
      config = null;
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

  async function lookupPayee(payee, cfg) {
    const key = payee.toLowerCase().trim();
    if (LOOKUP_CACHE.has(key)) return LOOKUP_CACHE.get(key);

    try {
      const url = `${cfg.serverUrl}/api/accounts/brain/lookup?payee=${encodeURIComponent(key)}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${cfg.token}` },
      });

      if (res.status === 401) {
        const result = { error: 'auth', message: 'Extension token expired or revoked. Reconnect in the OMI extension popup.' };
        LOOKUP_CACHE.set(key, result);
        return result;
      }
      if (!res.ok) {
        const result = { error: 'server', message: `OMI returned ${res.status}` };
        // Don't cache server errors; they might be transient.
        return result;
      }

      const data = await res.json();
      LOOKUP_CACHE.set(key, data);
      return data;
    } catch (err) {
      return { error: 'network', message: `Cannot reach OMI: ${err.message}` };
    }
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

    const vatLabel = formatVat(s.vatTreatment);
    const rcBadge = s.isReverseCharge ? ' <strong style="color:#b45309">[RC]</strong>' : '';

    el.innerHTML = `
      <svg class="omi-brain-icon" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 3.75a.75.75 0 011.5 0v4.5a.75.75 0 01-1.5 0v-4.5zm.75 7.25a1 1 0 110-2 1 1 0 010 2z"/>
      </svg>
      <div class="omi-brain-content">
        <div class="omi-brain-label">${escapeHtml(s.displayName)}</div>
        <div class="omi-brain-detail">
          <span><strong>${escapeHtml(s.accountCode || '?')}</strong> ${escapeHtml(s.accountName || '')}</span>
          <span>VAT: ${vatLabel}${rcBadge}</span>
        </div>
        <div class="omi-brain-confidence">${confidenceLabel(conf)} (${conf} confirmed)</div>
      </div>
      <button class="omi-brain-correct-btn" data-supplier-id="${s.id}" title="Correct this coding">Correct</button>`;

    const btn = el.querySelector('.omi-brain-correct-btn');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showCorrectionForm(el, s);
    });

    return el;
  }

  function showCorrectionForm(adviceEl, supplier) {
    if (adviceEl.querySelector('.omi-brain-correct-form')) return;

    const form = document.createElement('form');
    form.className = 'omi-brain-correct-form';
    form.innerHTML = `
      <input type="text" name="accountCode" placeholder="Account code" value="${escapeHtml(supplier.accountCode || '')}" style="width:80px" required>
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
      <input type="text" name="notes" placeholder="Notes (optional)" style="flex:1;min-width:100px">
      <button type="submit">Save</button>
      <button type="button" class="cancel">Cancel</button>`;

    form.querySelector('.cancel').addEventListener('click', () => form.remove());

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const body = {
        supplierId: supplier.id,
        accountCode: fd.get('accountCode'),
        vatTreatment: fd.get('vatTreatment') || undefined,
        notes: fd.get('notes') || undefined,
      };

      const cfg = await getConfig();
      if (!cfg) return;

      try {
        const res = await fetch(`${cfg.serverUrl}/api/accounts/brain/correct`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${cfg.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Unknown error' }));
          form.innerHTML = `<span style="color:#dc2626">Failed: ${escapeHtml(err.error)}</span>`;
          return;
        }

        // Clear cache and re-scan this row.
        const payee = supplier.displayName.toLowerCase().trim();
        LOOKUP_CACHE.delete(payee);

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
      } catch (err) {
        form.innerHTML = `<span style="color:#dc2626">Network error: ${escapeHtml(err.message)}</span>`;
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

  // Extract payee names from the Xero reconcile DOM.
  // Xero's reconcile page has bank statement lines with contact/payee text.
  // The selectors target the known DOM structure; if Xero changes their markup,
  // the extension gracefully shows nothing rather than breaking.
  function findBankLineRows() {
    // Try the newer BankRec SPA structure.
    const rows = document.querySelectorAll(
      '.bank-rec-line, .xrb-line, [class*="StatementLine"], [class*="bankRecLine"]'
    );
    if (rows.length) return Array.from(rows);

    // Fallback: the older BankRec.aspx table rows.
    const tableRows = document.querySelectorAll('tr.xrb-line, tr[class*="rec-line"]');
    return Array.from(tableRows);
  }

  function extractPayeeFromRow(row) {
    // Try multiple selectors that Xero has used for the payee/description field.
    const selectors = [
      '.xrb-payee', '.xrb-line__payee', '[class*="payee"]',
      '.xrb-narrative', '.xrb-line__narrative', '[class*="narrative"]',
      '.xrb-desc', '.xrb-line__desc', '[class*="description"]',
    ];
    for (const sel of selectors) {
      const el = row.querySelector(sel);
      if (el) {
        const text = el.textContent.trim();
        if (text.length >= 2) return text;
      }
    }

    // Last resort: scan for any element that looks like a payee name.
    // Xero statement lines typically have the payee in a prominent text node.
    const cells = row.querySelectorAll('td, div[class*="cell"], span[class*="name"]');
    for (const cell of cells) {
      const text = cell.textContent.trim();
      if (text.length >= 3 && text.length < 100 && !/^[\d.,\-+$]+$/.test(text)) {
        return text;
      }
    }
    return null;
  }

  async function processRow(row, cfg) {
    if (row.getAttribute(PROCESSED_ATTR)) return;
    row.setAttribute(PROCESSED_ATTR, 'pending');

    const payee = extractPayeeFromRow(row);
    if (!payee) {
      row.setAttribute(PROCESSED_ATTR, 'no-payee');
      return;
    }

    const result = await lookupPayee(payee, cfg);
    row.setAttribute(PROCESSED_ATTR, 'done');

    const advice = createAdviceElement(payee, result);

    // Insert the advisory element after the row content, not replacing anything.
    const target = row.querySelector('.xrb-line__details, [class*="details"]') || row;
    target.appendChild(advice);
  }

  let scanTimeout = null;

  async function scanPage() {
    const cfg = await getConfig();
    if (!cfg) return;

    const rows = findBankLineRows();
    for (const row of rows) {
      if (!row.getAttribute(PROCESSED_ATTR)) {
        await processRow(row, cfg);
      }
    }
  }

  function debouncedScan() {
    clearTimeout(scanTimeout);
    scanTimeout = setTimeout(scanPage, DEBOUNCE_MS);
  }

  // Watch for DOM changes: Xero's reconcile page is a SPA that loads bank lines
  // dynamically. We observe mutations and re-scan when new content appears.
  const observer = new MutationObserver((mutations) => {
    let hasNewContent = false;
    for (const m of mutations) {
      if (m.addedNodes.length) {
        hasNewContent = true;
        break;
      }
    }
    if (hasNewContent) debouncedScan();
  });

  function init() {
    observer.observe(document.body, { childList: true, subtree: true });
    scanPage();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
