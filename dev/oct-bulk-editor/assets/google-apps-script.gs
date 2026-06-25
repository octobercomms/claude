/**
 * OctoberComms Bulk Editor — Google Sheets sync
 *
 * Paste this into your Google Sheet under Extensions ▸ Apps Script, Save, then
 * reload the sheet. A "Bulk Editor" menu appears with Pull / Check / Push.
 *
 * The store URL and token below are filled in for your store. Treat the token
 * like a password. Columns are read live from the store, so the sheet always
 * matches the editor (prices, EUR/USD prices, stock, Variant Showcase, etc.).
 */

const API_BASE = '__API_BASE__';
const TOKEN    = '__TOKEN__';

const SHEET_NAME    = 'Products';      // tab the catalogue lives in
const BASELINE_NAME = '_octwbe_base';  // hidden tab: snapshot of the last pull

const COLOR_EDIT  = '#cfe3ff'; // blue  — your unsaved edit
const COLOR_WOO   = '#ffe2b8'; // amber — changed in the store since last pull
const COLOR_BOTH  = '#ffc7c2'; // red   — conflict: both changed
const COLOR_CLEAR = '#ffffff';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Bulk Editor')
    .addItem('⬇  Pull products from store', 'octwbePull')
    .addItem('🔍  Check for changes in store', 'octwbeCheck')
    .addSeparator()
    .addItem('⬆  Push my changes', 'octwbePush')
    .addItem('⚠  Push & overwrite conflicts', 'octwbePushForce')
    .addSeparator()
    .addItem('🩺  Diagnose a product', 'octwbeDiag')
    .addToUi();
}

// Diagnostic: ask the store what it actually sees for one product, so a stale
// read-replica (or read/write DB split) shows up plainly.
function octwbeDiag() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt('Diagnose a product', 'Enter the product ID (e.g. 179423 for the sofa):', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const pid = resp.getResponseText().trim();
  if (!pid) return;
  const data = octwbeApi_('/diag?product=' + encodeURIComponent(pid) + '&' + cacheBust_(), 'get');
  ui.alert('Diagnostics for product ' + pid, JSON.stringify(data, null, 2), ui.ButtonSet.OK);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function octwbeApi_(path, method, payload) {
  const opts = {
    method: method || 'get',
    muteHttpExceptions: true,
    headers: { 'X-OCTWBE-Token': TOKEN },
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

// A unique value per request, appended as &_cb=... so a page cache (the store
// runs LiteSpeed, which caches REST GETs) can't serve a stale copy — every call
// is a fresh cache miss that actually runs the server code.
function cacheBust_() {
  return '_cb=' + new Date().getTime() + '_' + Math.floor(Math.random() * 1e6);
}

function config_() {
  return octwbeApi_('/ping?' + cacheBust_(), 'get'); // { columns, editable, stock_readonly, ... }
}

function fetchAllProducts_() {
  let rows = [];
  let page = 1;
  while (true) {
    const data = octwbeApi_('/products?per_page=100&page=' + page + '&' + cacheBust_(), 'get');
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

function rowsToGrid_(rows, columns) {
  const grid = [columns.slice()];
  rows.forEach(function (r) {
    grid.push(columns.map(function (c) { return r[c] != null ? r[c] : ''; }));
  });
  return grid;
}

function writeGrid_(sh, grid) {
  sh.clearContents();
  if (!grid.length) return;
  var rowsNeeded = grid.length;
  var colsNeeded = grid[0].length;
  // A sheet defaults to 1000 rows; setValues() throws (and writes nothing) if the
  // grid is bigger. Grow the sheet to fit so large catalogues import in full —
  // this is what previously "capped out" pulls on stores with many variations.
  var maxRows = sh.getMaxRows();
  var maxCols = sh.getMaxColumns();
  if (maxRows < rowsNeeded) sh.insertRowsAfter(maxRows, rowsNeeded - maxRows);
  if (maxCols < colsNeeded) sh.insertColumnsAfter(maxCols, colsNeeded - maxCols);
  sh.getRange(1, 1, rowsNeeded, colsNeeded).setValues(grid);
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

// Do two values mean the same thing? Numeric when both look numeric.
function same_(a, b) {
  a = a == null ? '' : String(a).trim();
  b = b == null ? '' : String(b).trim();
  if (a === b) return true;
  if (a !== '' && b !== '' && !isNaN(Number(a)) && !isNaN(Number(b))) {
    return Number(a) === Number(b);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function octwbePull() { SpreadsheetApp.getUi().alert('Pulled ' + pullCore_() + ' products from the store.'); }

function pullCore_() {
  const cfg     = config_();
  const columns = cfg.columns;
  const grid    = rowsToGrid_(fetchAllProducts_(), columns);

  const sh = sheet_(SHEET_NAME);
  writeGrid_(sh, grid);
  sh.getDataRange().setBackground(COLOR_CLEAR);
  sh.getRange(1, 1, 1, columns.length).setFontWeight('bold');
  sh.setFrozenRows(1);

  const base = sheet_(BASELINE_NAME);
  writeGrid_(base, grid);
  base.hideSheet();

  return grid.length - 1;
}

function octwbeCheck() {
  const ui = SpreadsheetApp.getUi();
  const sh = sheet_(SHEET_NAME);
  const visible = readGrid_(sh);
  if (visible.length < 2) { ui.alert('Pull products first.'); return; }

  const editable = {};
  config_().editable.forEach(function (c) { editable[c] = true; });

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
      if (!editable[col]) continue;
      const edited     = !same_(visible[i][j], b[col]);
      const wooChanged = cur ? !same_(cur[col], b[col]) : false;
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

function octwbePush()      { pushChanges_(false); }
function octwbePushForce() { pushChanges_(true); }

function pushChanges_(force) {
  const ui = SpreadsheetApp.getUi();
  const sh = sheet_(SHEET_NAME);
  const visible = readGrid_(sh);
  if (visible.length < 2) { ui.alert('Pull products first.'); return; }

  const editable = {};
  config_().editable.forEach(function (c) { editable[c] = true; });

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
      if (!editable[col]) continue;
      if (same_(visible[i][j], b[col])) continue;
      changes.push({
        id: Number(id),
        column: col,
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

  const result     = octwbeApi_('/push', 'post', { force: force, changes: changes });
  const saved      = (result.saved || []).length;
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
    const col = head.indexOf(c.column);
    if (r && col >= 0) sh.getRange(r, col + 1).setBackground(COLOR_BOTH);
  });
}
