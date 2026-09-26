# Press exclusions

Keep a journalist off one release, or off a client's sends permanently.

The case: a client is already speaking to a journalist directly. A release
landing in that journalist's inbox from October makes the client look
uncoordinated. Sometimes that is true for one story. Sometimes it is true for
that client forever.

## Two scopes

| | Where it lives | Means |
|---|---|---|
| **This release only** | `outreach_press_releases.excluded_contacts UUID[]` | A judgement about one story. Leaves no mark on the contact |
| **Permanent, per client** | `outreach_contact_clients.excluded_at` + `excluded_reason` | Never send to them on this client's behalf. Other clients unaffected |

Deliberately **not** a tag and **not** a contact status. Both would change the
journalist's record in the shared library, which every client reads. An
exclusion is a statement about one relationship, so it lives on the
relationship row.

## Where it is enforced

Three layers, and only the last one is authoritative.

**1. Selection.** `GET /press/audience?tags=…&client_id=…` drops the client's
permanent exclusions. `client_id` is optional; without it nothing is filtered
and the response says so via `exclusions_applied: false`, rather than implying
a filtered list. The response also carries `excluded`, the count removed, so
the UI can say "12 held back" instead of quietly showing a shorter list.

**2. Queue time.** `POST /press/releases/:id/send` and `/send-plan` both filter
through `excludedIdsForRelease()` and report `held_back`. Both use the same
helper so the confirm dialog's numbers match what the send does. A plan that
promises 400 and then queues 388 is worse than no plan.

**3. The dispatch gate — the one that matters.** `runOutreachSends()` in
`scheduler.js` re-checks every pending send immediately before dispatch and
cancels it. This is authoritative because it is the only layer that catches an
exclusion added *after* the queue was built, which is the common case: the
realisation that a client already knows a journalist usually arrives late.

The gate already cancelled on hard bounce, per-client unsubscribe, per-campaign
stop, prior reply, and the 24h frequency cap. Exclusions join that list.

## The `do_not_contact` hole, fixed here

`do_not_contact` was treated as suppression everywhere except the place that
decides whether an email goes out:

- Set by three routes, including the **public unsubscribe link**
  (`routes/unsubscribe.js`), which fires whenever a recipient opts out.
- Filtered by `/press/tags`, `/press/audience` and `/press/journalists`.
- Listed as suppressed by both `/suppression` endpoints.
- **Not checked in the dispatch gate.**

So a recipient who opted out after a send was queued still received it. The
gate now checks it alongside the others.

Worth internalising: the selection queries excluding a state is not
enforcement. Only the gate is, because only the gate runs after the state can
change.

## API

| | |
|---|---|
| `GET /press/clients/:clientId/exclusions` | Everyone permanently excluded for a client |
| `PUT /press/clients/:clientId/exclusions` | `{ contact_id, excluded, reason? }`. Upserts, so you can exclude someone who was never a member — the commonest case, since clients mention the relationship before the first release |
| `GET /press/releases/:id/exclusions` | `{ this_release, permanent }` so the UI shows both and marks which is which |
| `PUT /press/releases/:id/exclusions` | `{ contact_ids }`, replacing the list. Also cancels matching pending sends, so counts are honest immediately rather than after the next cron tick |

The release PUT validates ids against `outreach_contacts`, so a stale browser
tab cannot write junk uuids into the release row.

## UI

Earned → the campaign's audience step.

- **hold back** — a tick box per journalist. This release only. Saved on the
  click, not debounced, because the operator should not be racing a timer
  against their own press of Send.
- **always** — permanent for this client, with a "manage" list to restore.
- A **held back** line under the recipient count, naming both scopes.

Every control is a convenience. The server enforces regardless, so a stale tab
or a failed save cannot put an email in front of the wrong journalist.

## Tests

15 behaviour tests against Postgres (`186` applied to a scratch schema),
covering: each suppression state reaching the gate's cancel decision;
cross-client isolation, so excluding for Acme never touches Other; an exclusion
added after queueing; audience filtering with and without `client_id`;
restoring; and excluding a contact who has no membership row yet.

## Code map

- `backend/migrations/186_press_exclusions.sql`
- `backend/src/services/scheduler.js` — `runOutreachSends()`, the gate
- `backend/src/routes/press.js` — `excludedIdsForRelease()`, the four endpoints,
  `/audience`, `/send`, `/send-plan`
- `frontend/src/components/PressCampaignDetail.jsx`
