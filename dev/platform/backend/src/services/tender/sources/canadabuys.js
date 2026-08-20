// CanadaBuys adapter — the official Government of Canada open data. CanadaBuys
// publishes all open tender notices as a daily bilingual CSV (free, no scraper).
// We fetch it, map the English columns to the common notice shape, and keep only
// the niche matches. Canada classifies by GSIN/UNSPSC (not CPV); those
// descriptions often literally say "Public relations services", so we fold them
// into the text the filter reads.
//
// Docs: canadabuys.canada.ca/en/procurement-and-contracting-data
// Feed: /opendata/pub/openTenderNotice-ouvertAvisAppelOffres.csv

const http = require('../http');
const { resolveClosing } = require('../normalise');
const { prefilter } = require('../classify');

// Minimal RFC-4180 CSV parser — handles quoted fields with embedded commas,
// newlines and escaped ("") quotes. Returns an array of string arrays.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') { inQ = true; }
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function fetch(source, { log = () => {}, stats = {} } = {}) {
  const cfg = source.config || {};
  const url = cfg.listUrl || 'https://canadabuys.canada.ca/opendata/pub/openTenderNotice-ouvertAvisAppelOffres.csv';
  const country = cfg.country || 'Canada';

  let text;
  try { text = await http.get(url, { type: 'text', timeout: 90000 }); }
  catch (e) { log(`CanadaBuys CSV fetch failed: ${e.message}`); return []; }

  const rows = parseCsv(text);
  if (rows.length < 2) { log('CanadaBuys: empty CSV'); return []; }
  stats.scanned = rows.length - 1; // raw notices in the CSV, before the niche filter
  const header = rows[0].map(h => h.replace(/^﻿/, '').trim());
  const col = name => header.indexOf(name);
  const iTitle = col('title-titre-eng');
  const iRef = col('referenceNumber-numeroReference');
  const iPub = col('publicationDate-datePublication');
  const iClose = col('tenderClosingDate-appelOffresDateCloture');
  const iStatus = col('tenderStatus-appelOffresStatut-eng');
  const iBuyer = col('contractingEntityName-nomEntitContractante-eng');
  const iEndUser = col('endUserEntitiesName-nomEntitesUtilisateurFinal-eng');
  const iCity = col('contractingEntityAddressCity-entiteContractanteAdresseVille-eng');
  const iUrl = col('noticeURL-URLavis-eng');
  const iDesc = col('tenderDescription-descriptionAppelOffres-eng');
  const iGsin = col('gsinDescription-nibsDescription-eng');
  const iUnspsc = col('unspscDescription-eng');
  const iUnspscCode = col('unspsc');

  const notices = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const ref = row[iRef];
    const title = row[iTitle];
    if (!ref || !title) continue;
    const status = (row[iStatus] || '').toLowerCase();
    if (status && !/open|active/.test(status)) continue; // skip cancelled/awarded/closed

    const description = iDesc >= 0 ? row[iDesc] : '';
    const gsin = iGsin >= 0 ? row[iGsin] : '';
    const unspsc = iUnspsc >= 0 ? row[iUnspsc] : '';
    const buyer = (iBuyer >= 0 && row[iBuyer]) || (iEndUser >= 0 && row[iEndUser]) || null;
    const { closing_at, needs_manual_check } = resolveClosing(row[iClose]);

    // Filter on the text plus the GSIN/UNSPSC category descriptions (Canada's
    // classification often names the service explicitly).
    const forFilter = { title, buyer_name: buyer, description: [description, gsin, unspsc].filter(Boolean).join(' — ') };
    if (prefilter(forFilter).tier === 'noise') continue;

    notices.push({
      external_ref: ref,
      url: (iUrl >= 0 && row[iUrl]) || null,
      title,
      buyer_name: buyer,
      buyer_country: country,
      buyer_city: (iCity >= 0 && row[iCity]) || null,
      cpv_codes: iUnspscCode >= 0 && row[iUnspscCode] ? [row[iUnspscCode]] : [],
      published_at: iPub >= 0 && row[iPub] ? new Date(row[iPub]) : null,
      closing_at,
      value_min: null,
      value_max: null,
      currency: 'CAD',
      description: description || [gsin, unspsc].filter(Boolean).join(' — ') || null,
      raw_payload: { ref },
      needs_manual_check,
    });
  }
  log(`CanadaBuys: ${rows.length - 1} notices → ${notices.length} relevant`);
  return notices;
}

module.exports = { fetch, parseCsv };
