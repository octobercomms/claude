/**
 * Falcon Enamelware — Drive Image Product Tagger
 * ------------------------------------------------
 * Walks a Google Drive folder full of product photos, asks a vision model
 * which Falcon Enamelware product(s) appear in each image, and records the
 * result so you can filter the folder by product type (e.g. "oval plate",
 * "3 pint jug").
 *
 * It writes tags to TWO places:
 *   1. A Google Sheet index  — the master, sortable/filterable list (one row
 *      per image, with a clickable link and the matched product tags).
 *   2. Each file's Drive description — a distinctive token per product
 *      (e.g. FALCONTAG_oval-plate) so Drive's own search box finds them.
 *
 * Apps Script caps a single run at ~6 minutes, so this processes images in
 * batches and re-schedules itself until the whole folder is done. It skips
 * anything it has already tagged, so it is safe to re-run.
 *
 * SETUP: see docs/falcon-image-tagger/README.md
 */

// ============================ CONFIG ============================
const CONFIG = {
  // The Drive folder to scan. Right-click the folder in Drive → Share →
  // the ID is the long string in the URL: drive.google.com/drive/folders/<ID>
  FOLDER_ID: 'PASTE_YOUR_FOLDER_ID_HERE',

  // Also scan sub-folders?
  RECURSIVE: true,

  // Google AI Studio (Gemini) API key — free tier is plenty to start.
  // Get one at https://aistudio.google.com/app/apikey
  // Stored in Script Properties (Project Settings) — leave blank here.
  // The key is read from Script Property 'GEMINI_API_KEY'.
  GEMINI_MODEL: 'gemini-2.0-flash',

  // Where to write the master index. Leave blank on first run and the script
  // creates a new Sheet and logs its URL — then paste that ID back here so
  // future runs append to the same Sheet.
  SHEET_ID: '',

  // Dry run: only fill the Sheet, do NOT touch file descriptions. Start true,
  // eyeball the Sheet, then set false to also stamp Drive descriptions.
  DRY_RUN: true,

  // Also prepend the top product tag to the file NAME (definitely searchable
  // in Drive). Off by default because it rewrites filenames.
  RENAME_FILES: false,

  // Prefix used for the searchable description token, e.g. FALCONTAG_oval-plate
  TAG_PREFIX: 'FALCONTAG_',

  // Safety: stop and re-schedule after this many seconds (keeps under the
  // 6-minute Apps Script limit).
  MAX_RUN_SECONDS: 270,

  // Skip files bigger than this (Gemini inline-image limit). MB.
  MAX_FILE_MB: 18
};

/**
 * The product catalog. This is what the model matches photos against.
 * Edit it to mirror your category page: one entry per product type.
 *   tag   — the short slug used in the Sheet, description token, and filter.
 *   name  — human name shown to the model and in the Sheet.
 *   hints — optional extra description to help the model tell it apart.
 *
 * Seeded with Falcon Enamelware's classic range — trim/add to match yours.
 */
const PRODUCTS = [
  { tag: 'oval-plate',        name: 'Oval Plate',              hints: 'oblong/oval flat plate' },
  { tag: 'dinner-plate',      name: 'Dinner Plate',            hints: 'large round flat plate' },
  { tag: 'side-plate',        name: 'Side Plate',              hints: 'small round flat plate' },
  { tag: 'cereal-bowl',       name: 'Cereal Bowl',             hints: 'round bowl, medium depth' },
  { tag: 'pasta-bowl',        name: 'Pasta Bowl',              hints: 'wide shallow bowl' },
  { tag: 'serving-bowl',      name: 'Serving Bowl',            hints: 'large deep bowl' },
  { tag: 'tumbler',           name: 'Tumbler',                 hints: 'straight-sided beaker, no handle' },
  { tag: 'mug',               name: 'Mug',                     hints: 'cup with a handle' },
  { tag: 'half-pint-jug',     name: 'Half Pint Jug',           hints: 'small jug with pouring lip and handle' },
  { tag: 'one-pint-jug',      name: '1 Pint Jug',              hints: 'medium jug with pouring lip and handle' },
  { tag: 'two-pint-jug',      name: '2 Pint Jug',              hints: 'large jug with pouring lip and handle' },
  { tag: 'three-pint-jug',    name: '3 Pint Jug',              hints: 'extra-large jug with pouring lip and handle' },
  { tag: 'pie-dish',          name: 'Pie Dish',                hints: 'shallow round baking dish, sloped sides' },
  { tag: 'baking-tray',       name: 'Baking Tray / Bake Set',  hints: 'rectangular oven tray' },
  { tag: 'serving-tray',      name: 'Serving Tray',            hints: 'flat rectangular tray with rim' },
  { tag: 'colander',          name: 'Colander',                hints: 'bowl with drainage holes' },
  { tag: 'teapot',            name: 'Teapot',                  hints: 'pot with spout, lid and handle' },
  { tag: 'storage-canister',  name: 'Storage Canister',        hints: 'lidded cylindrical container' },
  { tag: 'bread-bin',         name: 'Bread Bin',               hints: 'large lidded box' },
  { tag: 'utensil-pot',       name: 'Utensil Pot',             hints: 'tall open cylinder for utensils' }
];
// ===============================================================


/** Main entry point. Run this (or let the trigger run it). */
function runTagging() {
  const started = Date.now();
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('Set Script Property GEMINI_API_KEY (Project Settings → Script Properties).');
  if (CONFIG.FOLDER_ID === 'PASTE_YOUR_FOLDER_ID_HERE') throw new Error('Set CONFIG.FOLDER_ID.');

  const sheet = getSheet_();
  const done = getProcessedSet_(props);

  let processed = 0, tagged = 0, skipped = 0;
  const files = imageIterator_();

  while (files.hasNext()) {
    // Time budget guard — re-schedule and stop cleanly.
    if ((Date.now() - started) / 1000 > CONFIG.MAX_RUN_SECONDS) {
      scheduleContinuation_();
      log_(`Paused after ${processed} images this run — continuation scheduled.`);
      return;
    }

    const file = files.next();
    const id = file.getId();
    if (done.has(id)) { skipped++; continue; }

    try {
      const sizeMb = file.getSize() / (1024 * 1024);
      if (sizeMb > CONFIG.MAX_FILE_MB) {
        recordRow_(sheet, file, ['(skipped: too large)']);
        markDone_(props, done, id);
        skipped++;
        continue;
      }

      const tags = classifyImage_(file, apiKey);
      recordRow_(sheet, file, tags.length ? tags : ['(none)']);

      if (!CONFIG.DRY_RUN && tags.length) {
        stampFile_(file, tags);
        tagged++;
      }
      markDone_(props, done, id);
      processed++;
      Utilities.sleep(200); // gentle on the API
    } catch (err) {
      log_(`Error on "${file.getName()}": ${err.message}`);
      recordRow_(sheet, file, ['(error: ' + err.message + ')']);
      // do not mark done — will retry on next run
    }
  }

  clearContinuation_();
  log_(`Finished. Processed ${processed}, tagged ${tagged}, skipped ${skipped}. Index: ${sheet.getParent().getUrl()}`);
}


/** Ask Gemini which catalog products appear in this image. Returns tag[]. */
function classifyImage_(file, apiKey) {
  const b64 = Utilities.base64Encode(file.getBlob().getBytes());
  const catalog = PRODUCTS.map(p => `- ${p.tag}: ${p.name}${p.hints ? ' (' + p.hints + ')' : ''}`).join('\n');

  const prompt =
    'You are tagging product photos for Falcon Enamelware. Look at the image ' +
    'and decide which of these product types are the MAIN subject(s) of the photo.\n\n' +
    'PRODUCT CATALOG (return the tag on the left):\n' + catalog + '\n\n' +
    'Rules:\n' +
    '- Only include a product if it is clearly a featured item in the photo, not a tiny background prop.\n' +
    '- A photo can contain more than one product type.\n' +
    '- Use the jug sizes as best you can from relative proportions; if size is genuinely unclear, pick the closest.\n' +
    '- If no catalog product is present, return an empty list.\n' +
    'Return ONLY the matching tags.';

  const payload = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: file.getMimeType(), data: b64 } }
      ]
    }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          tags: { type: 'array', items: { type: 'string', enum: PRODUCTS.map(p => p.tag) } }
        },
        required: ['tags']
      }
    }
  };

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    CONFIG.GEMINI_MODEL + ':generateContent?key=' + encodeURIComponent(apiKey);

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code !== 200) throw new Error('Gemini HTTP ' + code + ': ' + body.slice(0, 300));

  const json = JSON.parse(body);
  const text = json.candidates && json.candidates[0].content.parts[0].text;
  if (!text) return [];
  const parsed = JSON.parse(text);
  const valid = new Set(PRODUCTS.map(p => p.tag));
  return (parsed.tags || []).filter(t => valid.has(t));
}


/** Write the searchable tokens into the file's description (and optionally name). */
function stampFile_(file, tags) {
  const tokens = tags.map(t => CONFIG.TAG_PREFIX + t).join(' ');
  const existing = (file.getDescription() || '').replace(/FALCONTAG_\S+/g, '').trim();
  file.setDescription((existing ? existing + ' ' : '') + tokens);

  if (CONFIG.RENAME_FILES && tags.length) {
    const name = file.getName();
    const label = '[' + tags[0] + '] ';
    if (name.indexOf(label) !== 0) file.setName(label + name.replace(/^\[[^\]]+\]\s*/, ''));
  }
}


// ---------------------- Drive iteration ----------------------
function imageIterator_() {
  const root = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  if (!CONFIG.RECURSIVE) return root.getFilesByType ? allImagesIn_(root) : root.getFiles();
  return allImagesRecursive_(root);
}

function allImagesIn_(folder) { return folder.getFiles(); }

/** Flatten folder tree into a lazy-ish iterator of image files. */
function allImagesRecursive_(root) {
  const stack = [root];
  const collected = [];
  while (stack.length) {
    const f = stack.pop();
    const subs = f.getFolders();
    while (subs.hasNext()) stack.push(subs.next());
    const files = f.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      if (/^image\//.test(file.getMimeType())) collected.push(file);
    }
  }
  let i = 0;
  return { hasNext: () => i < collected.length, next: () => collected[i++] };
}


// ---------------------- Sheet index ----------------------
function getSheet_() {
  let ss;
  if (CONFIG.SHEET_ID) {
    ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  } else {
    ss = SpreadsheetApp.create('Falcon Enamelware — Image Product Tags');
    log_('Created index Sheet: ' + ss.getUrl() + '  — paste its ID into CONFIG.SHEET_ID to reuse it.');
  }
  let sheet = ss.getSheetByName('tags');
  if (!sheet) {
    sheet = ss.getSheets()[0];
    sheet.setName('tags');
    sheet.appendRow(['File', 'Product tags', 'File name', 'Folder', 'Link', 'File ID']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function recordRow_(sheet, file, tags) {
  const url = 'https://drive.google.com/file/d/' + file.getId() + '/view';
  const parents = file.getParents();
  const folder = parents.hasNext() ? parents.next().getName() : '';
  sheet.appendRow([
    '=IMAGE("https://drive.google.com/thumbnail?id=' + file.getId() + '")',
    tags.join(', '),
    file.getName(),
    folder,
    url,
    file.getId()
  ]);
}


// ---------------------- Resume / continuation state ----------------------
function getProcessedSet_(props) {
  const raw = props.getProperty('PROCESSED_IDS') || '';
  return new Set(raw ? raw.split(',') : []);
}
function markDone_(props, set, id) {
  set.add(id);
  // Persist in chunks to stay under the 9KB-per-property limit.
  props.setProperty('PROCESSED_IDS', Array.from(set).slice(-8000).join(','));
}
function scheduleContinuation_() {
  clearContinuation_();
  ScriptApp.newTrigger('runTagging').timeBased().after(30 * 1000).create();
}
function clearContinuation_() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'runTagging' && t.getEventType() === ScriptApp.EventType.CLOCK)
    .forEach(t => ScriptApp.deleteTrigger(t));
}

function log_(msg) { console.log(msg); }


// ---------------------- Utilities you can run manually ----------------------

/** Clears the "already processed" memory so the next run re-tags everything. */
function resetProgress() {
  PropertiesService.getScriptProperties().deleteProperty('PROCESSED_IDS');
  log_('Progress reset — next runTagging() will re-scan every image.');
}

/** Removes FALCONTAG_ tokens from every file description in the folder. */
function clearAllDescriptions() {
  const it = imageIterator_();
  let n = 0;
  while (it.hasNext()) {
    const f = it.next();
    const d = f.getDescription();
    if (d && /FALCONTAG_/.test(d)) { f.setDescription(d.replace(/FALCONTAG_\S+/g, '').trim()); n++; }
  }
  log_('Cleared tags from ' + n + ' files.');
}

/** Store your Gemini key. Paste it between the quotes, run once, then delete it. */
function setGeminiKey() {
  const KEY = '';
  if (!KEY) throw new Error('Paste your key into setGeminiKey() first.');
  PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', KEY);
  log_('Gemini key saved to Script Properties.');
}
