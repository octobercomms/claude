// Reading a mailbox without a password.
//
// press@ failed with AUTHENTICATIONFAILED on 25 October and could not be fixed
// by typing a new app password, because Google no longer issues one for that
// account. 3,605 journalists' replies went unread, and their opt-outs with
// them. The fix authenticates the same IMAP socket with a bearer token.
//
// What these guards protect is the handful of places where that switch could
// be half-made: a scope that IMAP refuses, an expiry checked to the second, a
// call site that forgot to await the token, or a partial consent stored as a
// working connection.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const oauth = require('../src/services/mailboxOauth');
const inboxes = require('../src/services/outreachInboxes');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

// ── The scope ────────────────────────────────────────────────────────────────

ok('IMAP asks for https://mail.google.com/', () => {
  // The only scope Google accepts for IMAP. gmail.readonly works against the
  // REST API and is refused at the IMAP handshake, so narrowing this scope
  // would silently stop every poll.
  assert.strictEqual(oauth.IMAP_SCOPE, 'https://mail.google.com/');
  assert.ok(oauth.SCOPES.includes('https://mail.google.com/'));
});

ok('the consent URL asks for offline access and a fresh consent', () => {
  process.env.GOOGLE_CLIENT_ID = 'cid';
  process.env.GOOGLE_REDIRECT_URI = 'https://platform.example/auth/google/callback';
  const url = oauth.authUrl('state-token');
  assert.ok(url.includes('access_type=offline'), 'offline access is what yields a refresh token');
  assert.ok(url.includes('prompt=consent'), 'without it Google returns no refresh token on a re-grant');
  assert.ok(url.includes(encodeURIComponent('https://mail.google.com/')));
  assert.ok(url.includes('state=state-token'));
});

ok('the client connectors do NOT ask for mail access', () => {
  // One scope list per purpose. Adding mail access to the per-client Google
  // connector would put "read all your email" on the consent screen every
  // client sees, for a grant that has nothing to do with their mailbox.
  assert.ok(!read('src/connectors/google.js').includes('https://mail.google.com/'));
});

// ── Partial consent ──────────────────────────────────────────────────────────

ok('a grant missing the mail scope is reported, not stored', () => {
  const missing = oauth.missingScopes('https://www.googleapis.com/auth/userinfo.email');
  assert.ok(missing.includes(oauth.IMAP_SCOPE));
});

ok('a full grant reports nothing missing', () => {
  assert.deepStrictEqual(oauth.missingScopes(oauth.SCOPES.join(' ')), []);
});

ok('attach() refuses a partial grant and a grant with no refresh token', () => {
  const src = read('src/services/mailboxOauth.js');
  const attach = src.slice(src.indexOf('async function attach'), src.indexOf('async function detach'));
  assert.ok(/if \(!data\.refresh_token\)/.test(attach), 'a grant with no refresh token dies after an hour');
  assert.ok(/missing\.includes\(IMAP_SCOPE\)/.test(attach), 'a partial grant looks exactly like a working one');
  assert.ok(/email\.toLowerCase\(\) !== String\(row\.username\)\.toLowerCase\(\)/.test(attach),
    'a grant for the wrong account authenticates perfectly and reads the wrong mailbox');
});

// ── Expiry ───────────────────────────────────────────────────────────────────

ok('a token inside the margin is treated as spent', () => {
  const now = 1_000_000;
  // Expiring in 30s. A poll can outlive the gap between "valid" and
  // "rejected", and a token that dies mid-fetch reads as a wrong password.
  assert.strictEqual(oauth.tokenUsable({ access_token: 'a', expires_at: now + 30_000 }, now), false);
  assert.strictEqual(oauth.tokenUsable({ access_token: 'a', expires_at: now + 120_000 }, now), true);
  assert.ok(oauth.EXPIRY_MARGIN_MS >= 30_000, 'a margin under 30s is not a margin');
});

ok('a token with no expiry is not trusted', () => {
  // Number(undefined) is NaN and Number(null) is 0; neither must read as
  // "valid for ever".
  assert.strictEqual(oauth.tokenUsable({ access_token: 'a' }), false);
  assert.strictEqual(oauth.tokenUsable({ access_token: 'a', expires_at: null }), false);
  assert.strictEqual(oauth.tokenUsable(null), false);
  assert.strictEqual(oauth.tokenUsable({ expires_at: Date.now() + 9e9 }), false);
});

// ── The socket ───────────────────────────────────────────────────────────────

ok('imapClient sends a token for a Google mailbox and a password otherwise', () => {
  const src = read('src/services/outreachInboxes.js');
  const fn = src.slice(src.indexOf('async function imapClient'), src.indexOf('module.exports'));
  assert.ok(/inbox\.auth_type === 'google_oauth'/.test(fn));
  assert.ok(/accessToken: await mailboxOauth\.accessTokenFor\(inbox\)/.test(fn),
    'ImapFlow builds the XOAUTH2 string from auth.accessToken');
  assert.ok(/pass: String\(inbox\.password\)\.trim\(\)/.test(fn), 'app-password hosts still work');
});

ok('every call site awaits the client', () => {
  // The factory became async when it started minting tokens. A call site that
  // kept the old synchronous shape would hand ImapFlow a Promise and fail on
  // every poll.
  for (const f of ['src/services/outreachReplies.js', 'src/services/replyCatchup.js']) {
    const src = read(f);
    const calls = src.match(/[^\s(]*imapClient\(/g) || [];
    assert.ok(calls.length > 0, `${f} opens a mailbox`);
    const unawaited = src.match(/[^t]\s+(?:const|let)?\s*client\s*=\s*inboxes\.imapClient\(/g) || [];
    assert.strictEqual(unawaited.length, 0, `${f} calls imapClient without awaiting it`);
    assert.ok(/await inboxes\.imapClient\(/.test(src), `${f} must await imapClient`);
  }
});

ok('a mailbox that never opened is not logged out', () => {
  // Construction can now throw before a client exists (a lapsed grant), and
  // the finally blocks run anyway.
  for (const f of ['src/services/outreachReplies.js', 'src/services/replyCatchup.js']) {
    const src = read(f);
    assert.ok(!/\n\s+await client\.logout\(\)/.test(src),
      `${f} calls client.logout() unguarded, which throws when the client was never built`);
  }
});

ok('a failed poll records why against the mailbox', () => {
  const src = read('src/services/outreachReplies.js');
  const poll = src.slice(src.indexOf('async function pollOneInbox'));
  const build = poll.indexOf('await inboxes.imapClient(inbox)');
  assert.ok(build > 0);
  // The recordState call that follows is how "Connect it in Settings" reaches
  // the screen rather than a log nobody reads.
  assert.ok(/recordState\(inbox\.id, \{ last_run_at: new Date\(\), last_error: err\.message \}\)/
    .test(poll.slice(build, build + 400)));
});

// ── Storage ──────────────────────────────────────────────────────────────────

ok('the migration keeps password mailboxes honest and lets OAuth rows wait', () => {
  const sql = read('migrations/230_outreach_inbox_oauth.sql');
  assert.ok(/ADD COLUMN IF NOT EXISTS auth_type TEXT NOT NULL DEFAULT 'password'/.test(sql),
    'existing mailboxes must stay on passwords without a data migration');
  assert.ok(/ALTER COLUMN password_enc DROP NOT NULL/.test(sql));
  assert.ok(/auth_type = 'password' AND password_enc IS NOT NULL/.test(sql),
    'a password mailbox with no password cannot be opened');
  assert.ok(/pg_constraint WHERE conname = 'outreach_inboxes_auth_shape'/.test(sql),
    'the constraint must be safe to re-run');
});

ok('the token columns never reach the UI, but their presence does', () => {
  const src = read('src/services/outreachInboxes.js');
  const cols = src.slice(src.indexOf('const PUBLIC_COLUMNS'), src.indexOf('`;', src.indexOf('const PUBLIC_COLUMNS')));
  assert.ok(!/oauth_enc[^)]*$/m.test(cols.replace(/\(oauth_enc IS NOT NULL\) AS has_oauth/, '')),
    'oauth_enc itself must not be selectable by the UI');
  assert.ok(cols.includes('(oauth_enc IS NOT NULL) AS has_oauth'));
  assert.ok(cols.includes('auth_type'));
  assert.ok(!cols.includes('password_enc,'), 'the ciphertext never leaves the service');
});

ok('withCredentials drops the ciphertext and decrypts the right credential', () => {
  const src = read('src/services/outreachInboxes.js');
  const fn = src.slice(src.indexOf('async function withCredentials'), src.indexOf('async function activeWithCredentials'));
  assert.ok(/password_enc: passwordEnc, oauth_enc: oauthEnc, \.\.\.row/.test(fn),
    'a row handed around after this must carry no ciphertext');
  assert.ok(/row\.auth_type === 'google_oauth'/.test(fn));
});

ok('typing a password moves the mailbox off Google sign-in', () => {
  const src = read('src/services/outreachInboxes.js');
  const fn = src.slice(src.indexOf('async function update'), src.indexOf('async function remove'));
  const i = fn.indexOf("push('password_enc'");
  assert.ok(i > 0);
  assert.ok(fn.slice(i, i + 160).includes("push('auth_type', 'password')"),
    'otherwise the password is stored and then ignored');
});

ok('a Google mailbox can be added without a password', () => {
  assert.strictEqual(inboxes.normAuthType('google_oauth'), 'google_oauth');
  assert.strictEqual(inboxes.normAuthType('anything else'), 'password');
  assert.strictEqual(inboxes.normAuthType(undefined), 'password');
  const src = read('src/services/outreachInboxes.js');
  assert.ok(/requirePassword && normAuthType\(authType\) === 'password' && !String\(password \|\| ''\)/.test(src));
});

ok('disconnecting refuses to leave a mailbox unopenable', () => {
  const src = read('src/services/mailboxOauth.js');
  const fn = src.slice(src.indexOf('async function detach'), src.indexOf('async function accessTokenFor'));
  assert.ok(/if \(!rows\[0\]\.password_enc\)/.test(fn),
    'going back to passwords with no password stored breaks the mailbox');
});

ok('the app-password error names the withdrawal', () => {
  // The message an operator reads when press@ fails. It said "Gmail needs an
  // app password", which sent Daniel to a screen that no longer offers one.
  const msg = inboxes.describeImapError(
    { message: 'Invalid credentials', authenticationFailed: true },
    { label: 'press@', username: 'press@octobercomms.com' });
  assert.ok(/withdrawn app passwords/i.test(msg));
  assert.ok(/Google sign-in/i.test(msg));
});

console.log(`mailbox-oauth   ✓ ${passed} assertions passed`);
