# OMI — Frontend

React 18.3 + Vite 6 SPA in `dev/platform/frontend/src`. React Router 6, Recharts,
react-markdown. Built to `dist/`, served by nginx from `/var/www/platform`.

## App shell & routing (`src/App.jsx`, `src/main.jsx`)

- Cookie-based auth (httpOnly). The api client redirects to login on 401.
- `ProtectedRoute → Layout → Outlet` nesting; `Layout` is the dark sidebar +
  light main panel. Role-based UI gating (admin-only items hidden for viewers).
- Client context is derived from the URL (`/clients/:clientId/...`).
- Tabs within a page are URL-synced via `useTabParam` (`?tab=`).

## Pages (`src/pages`, 28)

**Auth & public:** `LoginPage`, `HomePage` (waitlist), public approval/coverage flows.

**Dashboard & clients:** `DashboardPage`, `ClientsPage`, `ClientDetailPage`.

**Suite pages (PESO-ish):** Ads, SEO, Social, PR, Outreach, Video, plus the
per-client detail tabs. `SettingsPage.jsx` is large — a top-tab → sub-tab IA
(Connections / Workspace / Account) over an encrypted key/value settings store,
with green "set" states per row and an **AI models** routing sub-tab.

**Data & analysis:** AI Data Analyst (chat with per-question model picker),
Sales & Traffic, Audiences, AI Visibility.

**Profiles & contacts:** journalist/outlet profiles, contact cleanup.

## Components (`src/components`, 46 + subdirs)

- **Shell/UI kit:** `Layout`, `ClientSwitcher`, `ErrorBoundary`, `Button`,
  `Card`, `Chip`, `TabBar`, `MetricCard`, `EmptyState`, `Section`.
- **Modals/wizards:** `AIDraftModal`, `ReportPreview`, `CampaignWizard`, `ImportWizard`.
- **Strategy:** `StrategistPanel`, `SetupReadiness`, `ClientStrategy`.
- **Suite panels:** `organic/` (14), `paid/` (6), `social/` (4) step components.
- **Chat/AI:** `RefineChat`, `ReportTemplateChat`, `SocialPlannerChat`.
- **Brand/integrations:** `BrandVoicePanel`, `FormsTab`, `ClarityConnectorCard`.
- **Notable big ones:** `SettingsPage.jsx`, `IgOutreachPanel.jsx`
  (IG discovery queue — **To work / Done tabs**, the Done tab is client-wide so
  worked prospects can't disappear; detached prospects show a "not attached"
  reclaim strip), `AiModelsPanel.jsx` (per-feature model routing UI).

## Cross-cutting

- **Context:** `AuthContext` (`useAuth` — login/logout/session), `ToastContext`
  (`useToast(msg, 'success'|'error'|'info')`).
- **Hooks:** `useTabParam` (URL-synced tabs), `usePaidPipeline`, `useCssVar`.
- **utils/api.js** — the HTTP client: `api.get/post/put/patch/delete`, sends the
  auth cookie, formats errors, redirects to login on 401. **Use it for all
  backend calls.**
- **utils:** `csv.js` (lenient CSV parse w/ header aliases), `connectorLabels.js`
  (flags, B2B/B2C labels).

## Styling

- Global `src/index.css` (CSS variables: palette, spacing 4pt grid, radii,
  shadows) + `src/styles/tokens.js`. Tailwind + PostCSS pipeline.
- House style: two-tone (dark sidebar, light main), Brockmann font, 2px borders,
  chunky radii, soft depth. See the `october-design-system` skill and
  [docs/brand]. Semantic colour vars: `--positive`, `--positive-soft`,
  `--negative`, `--accent`, `--card-border`, `--surface-raised`, etc.

## Build & tooling

- `npm run dev` (Vite dev server :5173, proxies `/api` → :3001),
  `npm run build` (→ `dist/`).
- Key deps: react, react-router-dom, recharts, react-markdown + remark-gfm.
- The bundle is a single large chunk (build warns >500kB) — known/accepted.

---

_Last verified: 2026-06-28. Counts: 28 pages, 46 components._
