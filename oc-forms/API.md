# nvelope Forms — External API

Read-only JSON API for pulling form, submission, and analytics data into the Platform reporting app (or anything else).

## Auth

Generate an API key in **WP Admin → nvelope Forms → Settings → External API**.

Send the key in **either** of:
- `X-OCF-Api-Key: <key>` request header (preferred)
- `?api_key=<key>` query string (handy for curl / browser testing)

Without a valid key the API responds `401 Unauthorized`. If no key has been generated yet, the API responds `403 Forbidden` until one is.

## Base URL

```
https://<your-wp-site>/wp-json/ocf/v1/api/
```

## Date ranges

Endpoints that accept `from` / `to` use `YYYY-MM-DD` (inclusive of both ends). Defaults: `to` = today, `from` = `to - 29 days`.

## Endpoints

### `GET /health`
Sanity check the plugin and key.

```json
{
  "ok": true,
  "plugin": "nvelope-forms",
  "version": "1.1.0",
  "db_version": "1.1.0",
  "wp_version": "6.5",
  "time": "2026-05-26 14:00:00",
  "time_utc": "2026-05-26 13:00:00",
  "site_url": "https://nvelope.co"
}
```

### `GET /forms`
List every form (drafts included). Add `?status=publish` to filter.

```json
{
  "forms": [
    {
      "id": 42,
      "title": "Forgeworks",
      "status": "publish",
      "created_at": "2026-05-20 12:00:00",
      "modified_at": "2026-05-25 09:30:00",
      "shortcode": "[nvelope_form id=\"42\"]",
      "step_count": 7
    }
  ],
  "total": 1
}
```

### `GET /forms/{id}`
Same as above but for one form, plus the full schema JSON (steps, questions, theme, Brevo mapping, etc.) so the Platform app can render question labels alongside answers without a second call.

### `GET /forms/{id}/stats?from=&to=`
Headline metrics.

```json
{
  "range": { "from": "2026-04-26 00:00:00", "to": "2026-05-26 23:59:59" },
  "views":     420,
  "starts":    198,
  "partials":  60,
  "completes": 138,
  "view_to_start_rate": 0.4714,
  "start_to_complete":  0.6970,
  "overall_conversion": 0.3286,
  "median_seconds": 124,
  "mean_seconds":   147
}
```

### `GET /forms/{id}/funnel?from=&to=`
Count of submissions that reached each step at least once, plus a final `completed` row.

```json
{
  "steps": [
    { "step_index": 0, "step_id": "s_type",   "title": "Project type",    "reached": 198 },
    { "step_index": 1, "step_id": "s_status", "title": "Property status", "reached": 180 },
    { "step_index": 7, "step_id": "completed","title": "Submitted",       "reached": 138 }
  ]
}
```

### `GET /forms/{id}/timeseries?from=&to=`
Daily counts for `views`, `starts`, `completes`. Useful for sparklines.

```json
{
  "series": [
    { "date": "2026-04-26", "views": 14, "starts": 6, "completes": 4 },
    { "date": "2026-04-27", "views": 11, "starts": 5, "completes": 3 }
  ]
}
```

### `GET /forms/{id}/submissions?from=&to=&status=&limit=&offset=`
Paginated list of submission rows (no answers — call `/submissions/{id}` for the full payload).

- `status` — `partial` or `complete`. Omit for both.
- `limit` — max 500, default 50.
- `offset` — 0-indexed, default 0.

```json
{
  "submissions": [
    {
      "id": 1042,
      "form_id": 42,
      "status": "complete",
      "email": "client@example.com",
      "step_reached": 6,
      "seconds_active": 142,
      "ip_address": "203.0.113.42",
      "user_agent": "Mozilla/5.0 …",
      "referrer": "https://nvelope.co/forgeworks",
      "created_at": "2026-05-26 10:01:00",
      "updated_at": "2026-05-26 10:03:22",
      "completed_at": "2026-05-26 10:03:22"
    }
  ],
  "total": 138,
  "limit": 50,
  "offset": 0
}
```

### `GET /submissions/{id}`
One submission with the full answer payload, a per-question label/type table, and any uploaded files.

```json
{
  "id": 1042,
  "form_id": 42,
  "status": "complete",
  "email": "client@example.com",
  "step_reached": 6,
  "seconds_active": 142,
  "created_at": "2026-05-26 10:01:00",
  "completed_at": "2026-05-26 10:03:22",
  "answers": { "q_type": "extension", "q_email": "client@example.com" },
  "answers_table": [
    { "question_id": "q_type",  "label": "Which best describes …", "type": "image_cards", "value": "extension" },
    { "question_id": "q_email", "label": "Email",                  "type": "email",       "value": "client@example.com" }
  ],
  "files": [
    { "id": 7, "submission_id": 1042, "question_id": "q_files", "filename": "abc.pdf",
      "original_name": "plans.pdf", "mime_type": "application/pdf",
      "size_bytes": 240000, "url": "https://nvelope.co/wp-content/uploads/ocf/42/1042/abc.pdf" }
  ]
}
```

## Definitions

- **View** — the form was rendered on a page. Deduped server-side: one view per `(form, session)` per 10 minutes.
- **Start** — a submission row was created (the JS hits `/start` immediately after `/view`, so in practice every view becomes a start unless the form fails to boot).
- **Partial** — a submission row that hasn't been submitted yet (`status = 'partial'`).
- **Complete** — submitted successfully (`status = 'complete'`).
- **Step reached** — highest 0-indexed step the visitor scrolled to. Updated continuously and finalized on submit. Captured for partials via a `pagehide` beacon.
- **Seconds active** — engagement time, paused while the tab is in the background.

## curl examples

```bash
KEY="paste-your-key"
BASE="https://nvelope.co/wp-json/ocf/v1/api"

curl -s -H "X-OCF-Api-Key: $KEY" "$BASE/health" | jq
curl -s -H "X-OCF-Api-Key: $KEY" "$BASE/forms" | jq
curl -s -H "X-OCF-Api-Key: $KEY" "$BASE/forms/42/stats?from=2026-05-01&to=2026-05-31" | jq
curl -s -H "X-OCF-Api-Key: $KEY" "$BASE/forms/42/funnel" | jq
curl -s -H "X-OCF-Api-Key: $KEY" "$BASE/forms/42/submissions?status=complete&limit=10" | jq
curl -s -H "X-OCF-Api-Key: $KEY" "$BASE/submissions/1042" | jq
```
