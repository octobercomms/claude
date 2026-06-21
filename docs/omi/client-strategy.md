# Client strategy playbooks

Encode the lifecycle/segment marketing strategies you run as assignable,
checkable playbooks. In Setup you set the client's **business type** +
**lifecycle stage**; the matching strategy is auto-assigned; the client
dashboard shows it as a phased checklist the AM works through.

## Model (migration 101)
- **`strategy_templates`** — the library: `{ name, business_type,
  lifecycle_stage, summary, phases:[{title, items:[text]}], is_seed }`. Seeded
  with a starter set (Retail/Service × Launch/Growth/Maturity) grounded in
  lifecycle theory.
- **`client_strategy`** — per client: a **snapshot** of the chosen template's
  phases with checkbox + note state (`phases:[{title, items:[{id,text,done,note}]}]`),
  so editing the library later never wipes a client's progress.
- `clients.business_type` / `clients.lifecycle_stage`.

## Service (`strategyTemplates.js`)
- `listTemplates()` / `matchTemplate(type, stage)` (auto-seeds on first use).
- `assignToClient(clientId, { templateId | businessType+lifecycleStage })` —
  snapshots the template into the client's checklist + records type/stage.
- `getClientStrategy` (with `progress`), `setItem` (toggle/note).
- `tailorWithClaude(clientId)` — adapts the checklist to the client's brief,
  **preserving ticks** where item wording is unchanged.

## API (`/api/strategy`, authed)
`GET /meta`, `GET /templates`; per-client (access-controlled):
`GET|PUT /clients/:id/strategy`, `PATCH /clients/:id/strategy/items/:itemId`,
`POST /clients/:id/strategy/tailor`.

## UI
`ClientStrategyPanel` on the client dashboard (Setup → Overview): type/stage
pickers → assign, then the phased checklist with checkboxes, per-item notes,
a progress bar, **Tailor with Claude**, and **Change**.

## Not yet (fast follow-up)
An admin **template editor** in Settings to edit the seeded library / add new
playbooks. Today the library is seeded + editable per-client via tailoring;
global template editing is the next slice.
