# Architecture — AI-Powered Functional Monitoring Suite

> Stable, high-level reference. Updated only when the shape of the system actually changes (new module, new table, new layer). For week-to-week progress see [PROGRESS.md](PROGRESS.md); for "what's running right now" see [STATUS.md](STATUS.md).

---

## 1. What this project is

A real-time API monitoring suite for the Logitech intern programme. It watches HTTP endpoints (single URLs **and** multi-step API chains called "flows"), records every check into SQLite, surfaces health on a React dashboard, and alerts to Slack and Email when something breaks. Two extra capabilities sit on top: a **read-only Snapshot & Report** that emails an HTML audit on demand, and **OpenAPI round-trip** so a whole project can be exported as a Swagger spec and re-imported into another instance.

The original Phase-1 brief was "ping URLs, group by status family". Everything beyond that — flows, prereqs, for-each iteration, OpenAPI import, email — was built on the same `MonitoredUrl + Check` foundation without breaking the original contract.

---

## 2. Repository layout

```
AI-Functional-Monitoring-Suite/
├── backend/                # Node + Express + TypeScript API (port 4000)
│   ├── src/                # 18 .ts modules, ~8.7k LOC
│   └── package.json
├── frontend/               # React 18 + Vite SPA (port 5173)
│   ├── src/
│   │   ├── components/     # 20+ components — see §6
│   │   ├── App.tsx
│   │   ├── api.ts          # typed fetch wrapper for /api/*
│   │   ├── types.ts        # mirrors backend/src/types.ts
│   │   └── styles.css      # design tokens + every component class
│   └── package.json
├── data/                   # runtime — SQLite DB, audit HTML, uploads (gitignored)
├── .claude_internal/       # local Python helpers (seeds, migrations, csv→xlsx)
├── documentation/          # all the long-form docs + local-only trackers
│   ├── ARCHITECTURE.md     # this file (committed)
│   ├── STATUS.md           # 1-pager snapshot of current state (committed)
│   ├── PROGRESS.md         # phase-by-phase log (gitignored)
│   ├── project-tracker.csv # row-per-task spreadsheet (gitignored)
│   └── project-tracker.xlsx# date-grouped pretty version (gitignored)
└── README.md               # public-facing run guide at the root for GitHub/GitLab
```

Two `npm install` commands — one inside `backend/`, one inside `frontend/`. Each subproject has its own `package.json`; there is no root-level workspace file.

---

## 3. Backend

### Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node ≥ 22 (uses `node:sqlite` built-in) | Avoids `better-sqlite3` native-build pain on Windows |
| HTTP framework | Express 4.19 | Boring, well-known, fast enough |
| TypeScript | 5.4 via `tsx watch` | No build step in dev; `tsc` only for `npm run build` typecheck |
| DB | SQLite (`node:sqlite`), WAL mode, FKs on | Single-file, zero ops, fits intern scope |
| SMTP | nodemailer 6 | Standard pick; works with Gmail App Password and corporate SMTP |
| OpenAPI | `@apidevtools/swagger-parser` + `js-yaml` | Robust spec validation + clean YAML round-trip |

### Entry point — `backend/src/index.ts`

Boots Express, mounts ~60 REST routes grouped by resource (projects, urls, api-keys, flows, flow-steps, prereqs, runs, audit, uploads, openapi), kicks off the monitor loop, serves `data/reports/*.html` statically under `/reports/`. Listens on `PORT` (default 4000). Body limits: 1 MB JSON, 10 MB raw binary for uploads.

### Module map (`backend/src/`)

| Module | Role |
|---|---|
| `index.ts` | Express bootstrap + every route handler |
| `store.ts` | SQLite CRUD for every entity — the only file that touches SQL |
| `db.ts` | Schema init, `ensureColumn` additive migrations, retention pruning |
| `monitor.ts` | 30-second tick loop. Drives `checkOne(url)` + due flows + due prereq chains |
| `timing.ts` | HTTP client with 5-phase timings (DNS/TCP/TLS/TTFB/Download); 8 s timeout |
| `flowRunner.ts` | Sequential step executor with retries, extractions, for-each (L1–L4 nesting), TTL cache |
| `prereqRunner.ts` | Same execution model as flowRunner, but writes to **project-scoped** variable pool |
| `extraction.ts` | Mini JSONPath (`$.a.b[0]`, `$.list[*]`, `$.list[*].id`) + `{{var}}` substitution with dotted paths |
| `assertions.ts` | 4 assertion types: `status-equals`, `status-in-range`, `latency-under`, `body-contains` |
| `errorReason.ts` | Numeric status / Node error code → human string |
| `audit.ts` | Read-only snapshot → HTML report → Slack + email delivery |
| `report.ts` | HTML report template (inlined CSS, self-contained file) |
| `slack.ts` | Webhook POST + message formatters (URL fail, flow fail, audit summary) |
| `email.ts` | Nodemailer transport + templates (URL fail, flow fail, audit with HTML attachment) |
| `openapiExport.ts` | Project → OpenAPI YAML/JSON, with `x-mon-*` extensions for flows/prereqs |
| `openapiImport.ts` | OpenAPI → diff (preview) → atomic apply (insert/update/remove) |
| `paths.ts` | Helpers for on-disk upload paths |
| `types.ts` | Shared TypeScript domain types; mirrored on the frontend |

### Database schema (SQLite, 17 tables)

**Identity & secrets**
- `projects` — name, optional Slack webhook URL, comma/semicolon-separated notification emails, prereq schedule config + last-run snapshot
- `api_keys` — per-project vault (name, secret value, target header name, optional prefix like `Bearer `)
- `uploads` — binary file metadata (UUID filename on disk, mime type, byte size)

**Standalone URLs**
- `urls` — what to check (URL, method, body, headers, query params, assertions, interval, optional API-key reference, optional `import_source` + `import_spec_id` for OpenAPI round-trip)
- `checks` — one row per tick, stores 5-phase timings, assertion results, the `ok` boolean, errorReason

**Flows (API chains)**
- `flows` — name, interval, `stopOnFailure`, enabled flag, last-run timestamps
- `flow_steps` — position, full HTTP config, extraction config (JSONPath → variable name), assertions, retry config, `for_each_config_json`, `level` (1–4 for nested for-each)
- `flow_runs` — per-execution record, `ok`, captured-variables snapshot, total ms, failed-at step id
- `step_results` — per-step outcome inside a run; `iteration_index` + `iteration_count` when the step was inside a for-each
- `variable_cache` — flow-scoped TTL cache of captured variables

**Prerequisites (project-level setup chain)**
- `prereq_steps`, `prereq_runs`, `prereq_step_results` — mirror flow tables structurally
- `project_variable_cache` — project-scoped TTL pool consumed by every URL + flow in the project

`ensureColumn(table, col, ddl)` in `db.ts` is the migration pattern: idempotent `ALTER TABLE ADD COLUMN IF NOT EXISTS`. No destructive migrations to date — old columns are left dormant when superseded.

### Execution model

**Monitor tick (every 30 s):**
1. For each project, run any **due prereq chain** first (`prereqRunner.runPrereqChain`). Successful chains write captured variables into `project_variable_cache` with TTL.
2. For each project, run any **due standalone URL** (interval matched). `monitor.checkOne(urlId)` substitutes `{{vars}}` from the project pool, executes via `timing.timedFetch`, evaluates assertions, records to `checks`. Transition OK→FAIL fires Slack + email in parallel.
3. For each project, run any **due flow** (`flowRunner.runFlow`).

**Flow / prereq step execution (identical):**
- Substitute `{{vars}}` (project pool ∪ flow cache, flow wins on collision)
- Optional `waitBeforeMs` delay (lets eventually-consistent APIs catch up)
- HTTP request via `timing.timedFetch`
- Retry up to `maxRetries` with exponential backoff
- Evaluate assertions; extract response → variables → flow cache
- If `forEach` config is set: loop the step over an array variable, capped at **100 iterations**, each writing its own `step_results` row (with `iteration_index` / `iteration_count`)
- For-each can nest **up to 4 levels** (`flow_steps.level` 1–4); parent loop variables stay in scope inside children

**Variable scoping (3-tier, lowest precedence first):**
1. Hardcoded literals in URL / body / headers
2. **Project pool** — captured by prereq chain, lives in `project_variable_cache`
3. **Flow cache** — captured by a flow step, lives in `variable_cache`, overrides project pool on name collision

**Status classification — `monitor.classify(code)`:**
- `2xx` / `3xx` → success
- `4xx` / `5xx` → failure
- Network errors / timeouts / DNS failures → `error`
- Assertion failures override: a 200 response can still be `ok: false` if an assertion failed

**Failure notification gate (current behaviour):**
```
const wasFailing = prevStatusGroup ∈ {4xx, 5xx, error}
const isFailingNow = !ok
if (isFailingNow && !wasFailing) → fire Slack + Email
```
Alerts fire on the **OK→FAIL transition only**, not on every failing tick (no spam). One known sharp edge: if the failure is a 200-status + failed-assertion, `prevStatusGroup` stays "2xx" so successive ticks can re-fire — see [STATUS.md](STATUS.md) for whether this is currently patched.

### Retention

- `checks` rows older than **365 days** are auto-pruned hourly.
- `variable_cache` and `project_variable_cache` rows past their `expires_at` are pruned on read and hourly.
- Audit HTML reports in `data/reports/` are never auto-deleted (manual cleanup).

---

## 4. Frontend

### Stack

| Layer | Choice |
|---|---|
| Framework | React 18.3 (function components + hooks) |
| Build | Vite 5.3 |
| Styling | Vanilla CSS + design-token CSS variables in `src/styles.css` |
| Drag-and-drop | `@dnd-kit/core` + `@dnd-kit/sortable` (Phase 1.18.2) |
| State | `useState` / `useEffect` / `useContext` + localStorage for cross-session persistence |
| Polling | 3 s default refresh, 500 ms while a flow is mid-run |
| Forms | Plain HTML inputs wired to local state — no form library |

There is **no global state library** (no Redux, no Zustand). Every screen owns its own state; cross-cutting state (active project id, current section, scroll position) is persisted to localStorage.

### Component map (`frontend/src/components/`)

| Component | Role |
|---|---|
| `Sidebar.tsx` | Project switcher + per-project failing-count badge |
| `ProjectView.tsx` | Main view; tabs (URLs / Flows), KPI bar, search, action buttons |
| `UrlCard.tsx` | Single monitored URL — status pill, latency bar, sparkline, run/edit/delete |
| `FlowCard.tsx` | Single flow — expandable step list with live per-step results, DnD reorder |
| `PrereqsPanel.tsx` | Collapsible top-of-project panel for the prereq chain, with live variable pool |
| `StepDragHandle.tsx` | Shared dnd-kit handle + floating drag preview |
| `LatencyBar.tsx` | Stacked DNS/TCP/TLS/TTFB/Download bar with hover tooltip |
| `Sparkline.tsx` | Minimalist 24-h latency trend |
| `ActivityTimeline.tsx` | Unified history view (proportional bars per check) |
| `TimeRangeSelector.tsx` | Segmented pill 24h / 7d / 30d / 90d / 1y / Custom |
| `Modal.tsx` | Reusable modal frame + `ConfirmDialog` + `ToastStack` |
| `ImportSwaggerModal.tsx` | Two-step OpenAPI import (preview → apply) |
| `KpiBar.tsx` | 4 KPI cards (Total / Healthy / Failing / Avg latency or Avg run-ms) |
| `FailureChip.tsx` | Failure-rate pill with inline expandable breakdown |
| `Spinner.tsx`, `Skeleton.tsx` | Loading affordances |
| `BinaryBodyEditor.tsx` | Dropzone + image preview + library picker, shared across URL/Flow/Prereq editors |
| `MoveCopyStepModal.tsx` | Cross-flow step move/copy picker |
| `forms.tsx` | `AddUrlForm`, `CreateProjectForm`, `SettingsForm`, `ApiKeyManagerForm` |
| `flowForms.tsx` | `FlowEditorForm`, `StepEditorForm` (7 tabs: Details / Body / Headers / Params / Assertions / Extract / Retry+ForEach), `PrereqStepEditorForm` |

### API surface

The frontend talks to the backend only through `frontend/src/api.ts`, a typed fetch wrapper. Endpoints are grouped by resource and return strongly typed payloads matching `backend/src/types.ts`.

---

## 5. Notification & report channels

Three trigger sites in the backend, all using the **same** "failure → Slack + email in parallel via `Promise.allSettled`" pattern:

| Trigger | Where | Slack | Email |
|---|---|---|---|
| URL OK → FAIL | `monitor.ts:114` | `sendSlackAlert` | `sendUrlFailureEmail` |
| Flow run fails | `flowRunner.ts` (end-of-run) | `sendFlowFailureAlert` | `sendFlowFailureEmail` |
| Snapshot & Report button | `audit.ts:runAuditAndDeliver` | `sendAuditToSlack` (webhook, summary text) | `sendAuditEmail` (with HTML report attached) |

Each channel has its own configuration gate:
- **Slack**: per-project `slackWebhookUrl` column. Empty → channel skipped silently.
- **Email**: requires both `SMTP_HOST/PORT/USER/PASS` env vars (set in `backend/.env`) **and** per-project `notificationEmails` recipients. Either empty → returns `{ sent: false, reason: "..." }` without throwing.

The Snapshot & Report path is **read-only** by design — it summarises the *current* state of URLs and flows without re-running any checks. (Original `?refresh=true` query opts back into the legacy "re-check everything" behaviour.)

---

## 6. OpenAPI round-trip (Phases 1.24 + 1.26)

**Export — `GET /api/projects/:id/export/openapi?format=yaml|json`**
- Every URL + every flow HTTP step becomes a Swagger `paths` entry.
- Orchestration metadata travels in `x-mon-*` extensions on each operation (step id, retry config, assertions, extractions).
- Flows themselves are listed under a top-level `x-mon-flows` side-band (they have no native Swagger representation; this is the only place Compute / Loop / nested-for-each metadata lives).
- Output is deterministic (sorted keys) → a no-op re-export produces a byte-identical file, so diff tools work.

**Import — `POST /api/projects/:id/import/openapi/preview` then `POST /apply`**
- Step 1: parse + validate the spec, diff against existing project URLs (matched by `import_source` + `import_spec_id`), classify each operation as `new` / `unchanged` / `drifted` / `removed`.
- Step 2: user picks which items to apply (granular per-row checkboxes); backend runs the entire apply inside a single SQLite transaction — all-or-nothing.
- Auth schemes from the spec are matched against the API-key vault when possible; unmatched schemes prompt the user to create a vault entry inline.
- Round-trip works: export project A → import that YAML into project B → identical structure with new ids.

---

## 7. Local data & gitignore

**Committed:** `backend/`, `frontend/`, `README.md` at root, `documentation/ARCHITECTURE.md`, `documentation/STATUS.md`, `.gitignore`, `.mcp.json`, `backend/.env.example`.

**Gitignored (local-only):**
- `node_modules/`, `dist/`, `.vite/`
- `**/.env` (every env file with real secrets)
- `data/` (SQLite DB, WAL files, audit HTML, uploads)
- `documentation/PROGRESS.md`, `documentation/project-tracker.csv`, `documentation/project-tracker.xlsx`
- `.claude_internal/` (seeds + migrations + the Python script that generates the pretty XLSX)
- `.postman/`, `postman/` (local Postman scaffolding for manual smoke tests)
- OS junk (`.DS_Store`, `Thumbs.db`)

---

## 8. Conventions worth knowing

- **Additive migrations only.** When a column outlives its usefulness, leave it dormant with a sane DEFAULT. SQLite table rebuilds are not worth the risk for an intern-scope project.
- **The `ok` flag is the single source of truth for "did this pass?"** Not the HTTP status group. A 200 with a failed assertion is `ok = false`. Notification gating that reads `statusGroup` alone is a bug waiting to happen.
- **Variables are stringly-typed at the boundary.** Inside the runner they can be objects/arrays (especially for for-each), but `variable_cache.value` is JSON-stringified on persist and parsed on read.
- **No background workers, no message queue.** Everything runs on the single Node process. The monitor loop is just `setInterval`. If we ever outgrow this, that's the place to split.
- **Frontend never holds long-lived references to backend data.** Every screen polls. This keeps the data flow trivially debuggable; it does cost network chatter, so the polling interval is bumped to 500 ms only while a flow is running and back to 3 s otherwise.

---

## 9. Things that are intentionally *not* here

- **AI layer** (Phase 2, deferred per manager decision). Two future capabilities are reserved: conversational setup/flow building, and one TBD.
- **Authentication for the dashboard itself.** The whole UI assumes single-user local-dev or trusted-LAN deployment.
- **Multi-tenant separation.** Projects are isolation units within one install; there is no per-user partitioning.
- **WebSocket / SSE.** Polling has been good enough at the scale this runs at. Replacing it is a Phase 2 candidate but not committed.
