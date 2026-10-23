// Every IMAP client gets an 'error' listener.
//
// ImapFlow is an EventEmitter, and Node throws an 'error' event that nobody
// is listening for. Every client in this codebase was built without one, so a
// socket error arriving outside the awaited call — after a poll had finished
// with its connection — reached process.on('uncaughtException') instead of
// the per-mailbox handling that already existed.
//
// The count is what gave it away: 94 "Socket timeout" errors in a day against
// a reply poll that runs every 15 minutes, which is 96 runs a day. One per
// poll, every poll.
//
//   node tests/imap-client.test.js

const EventEmitter = require('events');
const Module = require('module');

// The two things this service pulls in that a test has no business starting:
// a database pool and a real IMAP library.
let built = null;
const stubs = {
  'imapflow': {
    ImapFlow: class extends EventEmitter {
      constructor(opts) { super(); this.opts = opts; built = this; }
    },
  },
  '../db': { query: async () => ({ rows: [] }) },
  './settings': { getSetting: async () => null },
};
const load = Module._load;
Module._load = function (req, ...rest) {
  if (stubs[req]) return stubs[req];
  if (req.endsWith('/db') || req === '../db') return stubs['../db'];
  return load.call(this, req, ...rest);
};

const inboxes = require('../src/services/outreachInboxes');

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log('PASS ', name); }
  else { fail += 1; console.log('FAIL ', name, detail ? `\n  ${detail}` : ''); }
};

const INBOX = { host: ' imap.example.com ', port: '993', username: ' a@b.c ', password: ' pw ', label: 'press@' };

const client = inboxes.imapClient(INBOX);

check('the client is built from the mailbox', !!built && built.opts.host === 'imap.example.com',
  JSON.stringify(built && built.opts));
check('and credentials are trimmed on the way in',
  built.opts.auth.user === 'a@b.c' && built.opts.auth.pass === 'pw');
check('993 is treated as implicit TLS', built.opts.secure === true);
inboxes.imapClient({ ...INBOX, port: 143 });
check('a plain port is not', built.opts.secure === false && built.opts.port === 143,
  JSON.stringify({ secure: built.opts.secure, port: built.opts.port }));
inboxes.imapClient({ ...INBOX, port: '' });
check('and a missing port falls back to 993',
  built.opts.port === 993 && built.opts.secure === true,
  JSON.stringify({ secure: built.opts.secure, port: built.opts.port }));

// Rebuild the TLS case, since the two above moved `built` on.
inboxes.imapClient(INBOX);

// The one that matters.
check('an error listener is attached', client.listenerCount('error') === 1,
  'without one, Node turns the event into an uncaught exception');

let threw = null;
try { client.emit('error', new Error('Socket timeout')); } catch (e) { threw = e; }
check('so a socket error does not take the process down', threw === null,
  threw && threw.message);

// The caller still gets to record the failure against the mailbox.
let seen = null;
const withCb = inboxes.imapClient(INBOX, (err) => { seen = err.message; });
withCb.emit('error', new Error('Command failed'));
check('and the caller is told', seen === 'Command failed', String(seen));

// Reporting a failure must not become a second failure.
let threw2 = null;
const bad = inboxes.imapClient(INBOX, () => { throw new Error('reporting blew up'); });
try { bad.emit('error', new Error('Socket timeout')); } catch (e) { threw2 = e; }
check('a handler that throws is contained', threw2 === null, threw2 && threw2.message);

// Timeouts are left at the library's defaults on purpose: shortening them to
// "fix" a timeout would cut off a slow mailbox mid-fetch.
check('the library’s own timeouts are left alone',
  built.opts.socketTimeout === undefined && built.opts.greetingTimeout === undefined,
  JSON.stringify(built.opts));

Module._load = load;

// --- nothing builds a client around the factory ------------------------------
// A second construction site is a second place with no error listener, which
// is exactly how this one got here.
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'src');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (
  e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]
)).filter(f => f.endsWith('.js'));
const sites = walk(dir).filter(f => /new ImapFlow\(/.test(fs.readFileSync(f, 'utf8')));
check('only the factory constructs an IMAP client',
  sites.length === 1 && sites[0].endsWith('outreachInboxes.js'),
  `built in: ${sites.map(f => path.relative(dir, f)).join(', ')}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
