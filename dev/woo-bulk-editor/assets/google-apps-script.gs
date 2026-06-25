/**
 * WooCommerce Bulk Editor — Google Sheets sync
 *
 * Paste this into your Google Sheet under Extensions ▸ Apps Script, Save, then
 * reload the sheet. A "WooCommerce" menu appears with Pull / Check / Push.
 *
 * The store URL and token below are filled in for your store. Treat the token
 * like a password.
 */

const API_BASE = '__API_BASE__';
const TOKEN    = '__TOKEN__';

const SHEET_NAME    = 'Products';      // tab the catalogue lives in
const BASELINE_NAME = '_wbe_baseline'; // hidden tab: snapshot of the last pull

// Columns the store sends, in order. Mirrors WBE_Fields::sheet_fields().
const COLUMNS = [
  'id', 'type', 'name', 'sku', 'regular_price', 'sale_price',
  'stock_qty', 'stock_status', 'status', 'date_on_sale_from', 'date_on_sale_to'
];

// Columns the sheet may push back. id / type / name are read-only.
const EDITABLE = [
  'sku', 'regular_price', 'sale_price', 'stock_qty',
  'stock_status', 'status', 'date_on_sale_from', 'date_on_sale_to'
];

const COLOR_EDIT  = '#cfe3ff'; // blue  — your unsaved edit
const COLOR_WOO   = '#ffe2b8'; // amber — changed in the store since last pull
const COLOR_BOTH  = '#ffc7c2'; // red   — conflict: both changed
const COLOR_CLEAR = '#ffffff';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('WooCommerce')
    .addItem('⬇  Pull products from store', 'wbePull')
    .addItem('🔍  Check for changes in store', 'wbeCheck')
    .addSeparator()
    .addItem('⬆  Push my changes', 'wbePush')
    .addItem('⚠  Push & overwrite conflicts', 'wbePushForce')
    .addToUi();
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function wbeApi_(path, method, payload) {
  const opts = {
    method: method || 'get',
    muteHttpExceptions: true,
    headers: { 'X-WBE-Token': TOKEN },
    contentType: 'application/json'
  };
  if (payload) opts.payload = JSON.stringify(payload);

  const res  = UrlFetchApp.fetch(API_BASE + path, opts);
  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Store returned HTTP ' + code + ': ' + body);
  }
  return JSON.parse(body);
}

function fetchAllProducts_() {
  let rows = [];
  let page = 1;
  while (true) {
    const data = wbeApi_('/products?per_page=100&page=' + page, 'get');
    rows = rows.concat(data.rows || []);
    if (page >= (data.total_pages || 1)) break;
    page++;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Sheet helpers
// ---------------------------------------------------------------------------

function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function rowsToGrid_(rows) {
  const grid = [COLUMNS.slice()];
  rows.forEach(function (r) {
    grid.push(COLUMNS.map(function (c) { return r[c] != null ? r[c] : ''; }));
  });
  return grid;
}

function writeGrid_(sh, grid) {
  sh.clearContents();
  if (grid.length) {
    sh.getRange(1, 1, grid.length, grid[0].length).setValues(grid);
  }
}

function readGrid_(sh) {
  return sh.getDataRange().getValues();
}

// grid -> { id: { column: value } }
function gridToMap_(grid) {
  const head  = grid[0];
  const idCol = head.indexOf('id');
  const map   = {};
  for (let i = 1; i < grid.length; i++) {
    const id = String(grid[i][idCol]);
    if (!id) continue;
    const obj = {};
    for (let j = 0; j < head.length; j++) obj[head[j]] = grid[i][j];
    map[id] = obj;
  }
  return map;
}

// Do two values for a column mean the same thing?
function same_(col, a, b) {
  a = a == null ? '' : String(a).trim();
  b = b == null ? '' : String(b).trim();
  if (col === 'regular_price' || col === 'sale_price' || col === 'stock_qty') {
    if (a === '' || b === '') return a === b;
    return Number(a) === Number(b);
  }
  return a === b;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function wbePull() { SpreadsheetApp.getUi().alert('Pulled ' + pullCore_() + ' products from the store.'); }

function pullCore_() {
  const rows = fetchAllProducts_();
  const grid = rowsToGrid_(rows);

  const sh = sheet_(SHEET_NAME);
  writeGrid_(sh, grid);
  sh.getDataRange().setBackground(COLOR_CLEAR);
  sh.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold');
  sh.setFrozenRows(1);

  const base = sheet_(BASELINE_NAME);
  writeGrid_(base, grid);
  base.hideSheet();

  return rows.length;
}

function wbeCheck() {
  const ui = SpreadsheetApp.getUi();
  const sh = sheet_(SHEET_NAME);
  const visible = readGrid_(sh);
  if (visible.length < 2) { ui.alert('Pull products first.'); return; }

  const baseMap = gridToMap_(readGrid_(sheet_(BASELINE_NAME)));

  const current = {};
  fetchAllProducts_().forEach(function (r) { current[String(r.id)] = r; });

  const head  = visible[0];
  const idCol = head.indexOf('id');

  let edits = 0, woo = 0, conflicts = 0;
  const bg = [];
  for (let i = 1; i < visible.length; i++) {
    const colors = new Array(head.length).fill(COLOR_CLEAR);
    const id  = String(visible[i][idCol]);
    const b   = baseMap[id] || {};
    const cur = current[id] || null;

    for (let j = 0; j < head.length; j++) {
      const col = head[j];
      if (EDITABLE.indexOf(col) < 0) continue;
      const edited     = !same_(col, visible[i][j], b[col]);
      const wooChanged = cur ? !same_(col, cur[col], b[col]) : false;
      if (edited && wooChanged) { colors[j] = COLOR_BOTH; conflicts++; }
      else if (wooChanged)      { colors[j] = COLOR_WOO;  woo++; }
      else if (edited)          { colors[j] = COLOR_EDIT; edits++; }
    }
    bg.push(colors);
  }
  if (bg.length) sh.getRange(2, 1, bg.length, head.length).setBackgrounds(bg);

  ui.alert(
    'Your edits: ' + edits +
    '\nChanged in store since last pull: ' + woo +
    '\nConflicts (both changed): ' + conflicts +
    '\n\nBlue = your edit · Amber = store changed · Red = conflict.'
  );
}

function wbePush()      { pushChanges_(false); }
function wbePushForce() { pushChanges_(true); }

function pushChanges_(force) {
  const ui = SpreadsheetApp.getUi();
  const sh = sheet_(SHEET_NAME);
  const visible = readGrid_(sh);
  if (visible.length < 2) { ui.alert('Pull products first.'); return; }

  const head    = visible[0];
  const idCol   = head.indexOf('id');
  const baseMap = gridToMap_(readGrid_(sheet_(BASELINE_NAME)));

  const changes = [];
  for (let i = 1; i < visible.length; i++) {
    const id = String(visible[i][idCol]);
    if (!id) continue;
    const b = baseMap[id] || {};
    for (let j = 0; j < head.length; j++) {
      const col = head[j];
      if (EDITABLE.indexOf(col) < 0) continue;
      if (same_(col, visible[i][j], b[col])) continue;
      changes.push({
        id: Number(id),
        field: col,
        value: String(visible[i][j]),
        baseline: b[col] == null ? '' : String(b[col])
      });
    }
  }

  if (!changes.length) { ui.alert('No changes to push.'); return; }

  if (!force) {
    const ok = ui.alert('Push ' + changes.length + ' change(s) to the store?', ui.ButtonSet.OK_CANCEL);
    if (ok !== ui.Button.OK) return;
  }

  const result = wbeApi_('/push', 'post', { force: force, changes: changes });
  const saved  = (result.saved || []).length;
  const unresolved = !force && result.conflicts && result.conflicts.length;

  if (unresolved) {
    highlightConflicts_(sh, head, idCol, result.conflicts);
    ui.alert(
      'Saved ' + saved + ' product(s).\n\n' +
      result.conflicts.length + ' field(s) were NOT pushed because the store changed ' +
      'since your last pull (highlighted red). Review them, then choose ' +
      '"⚠ Push & overwrite conflicts" to force.'
    );
  } else {
    let msg = 'Pushed successfully — ' + saved + ' product(s) updated.';
    if (result.errors && result.errors.length) msg += '\n\nNotes:\n' + result.errors.join('\n');
    ui.alert(msg);
  }

  // Re-pull to reset the baseline to the live store state — but not while
  // conflicts are still pending, or we would wipe the user's attempted values.
  if (!unresolved) pullCore_();
}

function highlightConflicts_(sh, head, idCol, conflicts) {
  const data    = sh.getDataRange().getValues();
  const rowById = {};
  for (let i = 1; i < data.length; i++) rowById[String(data[i][idCol])] = i + 1;

  conflicts.forEach(function (c) {
    const r   = rowById[String(c.id)];
    const col = head.indexOf(c.field);
    if (r && col >= 0) sh.getRange(r, col + 1).setBackground(COLOR_BOTH);
  });
}
