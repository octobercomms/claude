// Shared → Schedule's download. "Do we just remove all of that, and allow me
// to download the assets and schedule? like we did for Paid?"
//
// This guards the two things that go wrong quietly: a short zip that says
// nothing, and a second copy of Paid's CSV rules drifting from the first.
const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const svc = read('src', 'services', 'socialExport.js');
const route = read('src', 'routes', 'social.js');
const ad = read('src', 'services', 'adExport.js');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log('PASS ', name); }
  else { fail += 1; console.log('FAIL ', name, '\n  ' + (detail || '')); }
};

check('the export reuses Paid\'s CSV writer and asset reader',
  /require\('\.\/adExport'\)/.test(svc)
    && /toCsv/.test(svc) && /readAsset/.test(svc) && /extFor/.test(svc) && /slug/.test(svc),
  'two implementations of "where did this asset go" drift the first time either changes');
check('and adExport exports them for it',
  /module\.exports = \{[^}]*readAsset/.test(ad),
  'readAsset was private; the Shared export needs the identical rule');
check('it does not define its own csvCell',
  !/function csvCell/.test(svc),
  'RFC 4180 quoting is where a second copy would hurt most: ad copy and captions both hold commas, quotes and newlines');

check('a post with no media still gets a row',
  /\(no media\)/.test(svc),
  'copy written and never illustrated is the normal state of part of a batch');
check('a file that cannot be read is named in the sheet and in MISSING.txt',
  /\(missing: \$\{err\.message\}\)/.test(svc) && /MISSING\.txt/.test(svc),
  'a short zip that says nothing gets scheduled with a gap nobody noticed');
check('MISSING.txt says what to do, not just what failed',
  /Re-render anything/.test(svc) && /Workbench step/.test(svc));

check('a carousel numbers its slides',
  /urls\.length > 1 \? `-\$\{String\(j \+ 1\)/.test(svc),
  'a uniqueness counter would name slide two "-2", which reads as a second attempt rather than the second image');
check('a reel falls back to a video extension',
  /p\.kind === 'reel' \? 'video' : 'image'/.test(svc),
  'a provider render has no extension in its URL, which is the common shape, and .png on an mp4 is a file nothing opens');
check('posts come out in the order they were reviewed',
  /ORDER BY position ASC, created_at ASC/.test(svc),
  'the review order is the approval order and therefore the posting order');
check('a batch that is not there returns null',
  /if \(!loaded\) return null;/.test(svc),
  'an empty zip looks like a batch with nothing in it');

check('the route honours a subset of ticked posts',
  /req\.query\.posts/.test(route) && /only\.size/.test(route),
  'exporting all nine when four were ticked ignores the one decision made on the review screen');
check('and filters those ids against this batch rather than trusting them',
  /loaded\.posts\.filter\(p => asked\.has\(p\.id\)\)/.test(route),
  'an id from another client\'s batch must select nothing, not read across clients');
check('the route checks the batch belongs to this client',
  /loaded\.batch\.client_id !== req\.params\.clientId/.test(route),
  'the path is client-scoped, so the record has to be too');
check('the counts go in headers as well as the zip',
  /X-Export-Posts/.test(route) && /X-Export-Assets/.test(route) && /X-Export-Missing/.test(route)
    && /Access-Control-Expose-Headers/.test(route),
  'without the expose header the page cannot read its own counts');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
