// Guard — a refused calendar call says why it was refused.
//
// On 18 Oct 2026 October's book-a-call page stopped offering times. The public
// page said "we could not reach the calendar" and the admin preview, the one
// screen an authenticated admin is entitled to detail on, said "Request failed
// with status code 403". That is axios's string; Google's own reason was in the
// response body and was thrown away.
//
// It matters because the three common reasons for a 403 on this API need three
// unrelated fixes: a scope that was never granted (reconnect), the Calendar API
// not enabled on the Cloud project (enable it), and rate limiting (wait). With
// the reason discarded there is no way to tell which, so the screen is a dead
// end for whoever has to fix it.
//
// No database, no network. Runs in CI.

const gcal = require('./googleCalendar');

let pass = 0;
let fail = 0;

function check(name, got, want) {
  const ok = typeof want === 'function' ? want(got) : got === want;
  if (ok) { pass += 1; console.log('PASS ', name); }
  else { fail += 1; console.log('FAIL ', name, '\n  got:  ', JSON.stringify(got)?.slice(0, 300)); }
}
const has = (needle) => (got) => String(got).includes(needle);

// Shaped like a real Google error body.
const refusal = (status, reason, message) => ({
  response: {
    status,
    statusText: 'Forbidden',
    data: { error: { code: status, message, errors: reason ? [{ reason, message }] : [] } },
  },
});

// ---------------------------------------------------------------------------
// 1. Each reason names itself and what to do about it.

const scopes = gcal.googleError(
  refusal(403, 'insufficientPermissions', 'Request had insufficient authentication scopes.'),
  'post', '/freeBusy');
check('the reason survives', scopes.message, has('insufficientPermissions'));
check('Google’s own words survive', scopes.message, has('insufficient authentication scopes'));
check('and the remedy is a reconnect', scopes.message, has('connect it again'));
check('the reason is readable by code too', scopes.googleReason, 'insufficientPermissions');

const notEnabled = gcal.googleError(
  refusal(403, 'accessNotConfigured', 'Google Calendar API has not been used in project 123 before or it is disabled.'),
  'post', '/freeBusy');
check('an unenabled API is not confused with a scope problem',
  notEnabled.message, has('not enabled on the Google Cloud project'));
check('and does not tell anyone to reconnect', notEnabled.message, (m) => !/connect it again/.test(m));

const limited = gcal.googleError(refusal(403, 'rateLimitExceeded', 'Rate Limit Exceeded'), 'post', '/freeBusy');
check('rate limiting says there is nothing to change', limited.message, has('Nothing to change'));

// Every remedy must be distinct, or the message cannot tell the cases apart.
const remedies = Object.values(gcal.REMEDY);
check('no two reasons share a remedy that would mislead',
  new Set(remedies).size, (n) => n >= 5);

// ---------------------------------------------------------------------------
// 2. What the old behaviour gave, for contrast.

check('the bare axios message carried no reason at all',
  'Request failed with status code 403', (m) => !/insufficientPermissions|scope|enabled/.test(m));

// ---------------------------------------------------------------------------
// 3. Nothing else breaks.

// Which call failed is part of the answer: freeBusy failing while event
// creation works is itself the clue that the scopes are split.
check('the failing call is named', scopes.message, has('POST /freeBusy'));

// cancelEvent swallows 404/410 by reading err.response.status, so the wrapper
// must keep the response attached rather than replacing the error outright.
const gone = gcal.googleError(refusal(410, null, 'Resource has been deleted'), 'delete', '/calendars/primary/events/x');
check('a 410 keeps its response for the cancel path', gone.response.status, 410);
check('and its status is readable directly', gone.status, 410);

// A reason Google has not documented here still reports cleanly.
const odd = gcal.googleError(refusal(403, 'somethingNew', 'A new failure.'), 'post', '/freeBusy');
check('an unknown reason is still named', odd.message, has('somethingNew'));
check('without inventing a remedy for it', odd.message, (m) => !/Disconnect|enable|wait a minute/i.test(m));

// Network failures are not Google refusals and must pass through untouched, so
// a timeout is not reported as a permissions problem.
const net = new Error('socket hang up');
check('a network error is returned unchanged', gcal.googleError(net, 'post', '/freeBusy'), net);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
