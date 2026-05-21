# Project Progress Tracker — AI-Powered Functional Monitoring Suite

**Owner:** Deepesh P · **Company:** Logitech · **Started:** 2026-04-29

> Tick boxes as you finish a task. Add the completion date next to it.
> Open the CSV (`project-tracker.csv`) in Excel for spreadsheet view.

---

## Phase 1 — Foundations *(URL Monitor MVP)* ✅ Complete

- [x] **1.1** Backend project setup (Node.js + TypeScript + Express) — *2026-04-29*
- [x] **1.2** Frontend project setup (React + Vite + TypeScript) — *2026-04-29*
- [x] **1.3** URL ingestion endpoint (POST /api/urls) — *2026-04-29*
- [x] **1.4** HTTP status checker — *2026-04-29*
- [x] **1.5** Group URLs by status family (2xx/3xx/4xx/5xx/error) — *2026-04-29*
- [x] **1.6** Frontend dashboard with grouped count cards — *2026-04-30*
- [x] **1.7** Real-time refresh (frontend polls every 3s) — *2026-04-30*
- [x] **1.8** JSON file persistence with atomic writes — *2026-04-30*

## Phase 1.5 — Production polish ✅ Complete

- [x] **2.1** Project segregation (sidebar) — *2026-05-05*
- [x] **2.2** Per-project API key vault — *2026-05-05*
- [x] **2.3** Auth header injection (Bearer / x-api-key / Basic) — *2026-05-05*
- [x] **2.4** Per-URL check interval (1–1440 min) — *2026-05-05*
- [x] **2.5** 5-phase HTTP latency tracking (DNS/TCP/TLS/TTFB/Download) — *2026-05-05*
- [x] **2.6** Description field per URL — *2026-05-05*
- [x] **2.7** Error reason mapping (human-readable) — *2026-05-05*
- [x] **2.8** Slack webhook for failure alerts — *2026-05-05*
- [x] **2.9** Latency bar visualization — *2026-05-05*

## Phase 1.6 — UX refresh ✅ Complete

- [x] **3.1** Modal/dialog system — *2026-05-07*
- [x] **3.2** Toast notifications — *2026-05-07*
- [x] **3.3** Design token system (CSS variables) — *2026-05-07*
- [x] **3.4** Polished sidebar with avatars + health dots — *2026-05-07*
- [x] **3.5** Animated transitions and hover states — *2026-05-07*

## Phase 1.7 — Storage upgrade ✅ Complete

- [x] **4.1** Migrate from JSON file to SQLite (node:sqlite) — *2026-05-08*
- [x] **4.2** Schema design (projects / keys / urls / checks) — *2026-05-08*
- [x] **4.3** Auto-migrate existing db.json — *2026-05-08*
- [x] **4.4** Persistent check history — *2026-05-08*
- [x] **4.5** 7-day retention policy with auto-pruning — *2026-05-08*
- [x] **4.6** Extended retention to 365 days for long-range charts — *2026-05-12*

## Phase 1.8 — History UI ✅ Complete

- [x] **5.1** Sparkline component (24h latency) — *2026-05-08*
- [x] **5.2** Status strip (replaced by Activity Timeline) — *2026-05-08*
- [x] **5.3** Failure rate chip (color-coded) — *2026-05-08*
- [x] **5.4** KPI bar (4 KPIs + project sparkline) — *2026-05-08*
- [x] **5.5** /api/urls/:id/history endpoint — *2026-05-08*
- [x] **5.6** /api/urls/:id/stats endpoint — *2026-05-08*
- [x] **5.7** Activity Timeline (unified history viz) — *2026-05-11*
- [x] **5.8** Time Range Selector (24h/7d/30d/90d/1y/Custom — LinkedIn-style) — *2026-05-12*
- [x] **5.10** Time Range Selector visual redesign (segmented pill + sliding indicator, Datadog-style) — *2026-05-12*

## Phase 1.12 — UX polish ✅ Complete

- [x] **12.1** Skeleton loaders on first paint (shimmer placeholders) — *2026-05-12*
- [x] **12.2** Spinner component + busy state in async buttons — *2026-05-12*
- [x] **12.3** Toast notifications with success/error/info icons — *2026-05-12*
- [x] **12.4** Pulse animation on failing/degraded health dots — *2026-05-12*
- [x] **12.5** Staggered fade+slide entrance for URL cards (40ms stagger) — *2026-05-12*
- [x] **12.6** Smooth transitions on status pills, KPIs, chips — *2026-05-12*
- [x] **12.7** Consistent focus-visible rings (keyboard a11y) — *2026-05-12*
- [x] **12.8** Reduced-motion media query (respects user prefs) — *2026-05-12*

## Phase 1.13 — Flows (API chaining) ✅ Complete

- [x] **13.1** Backend: flow tables (flows, flow_steps, flow_runs, step_results, variable_cache) — *2026-05-19*
- [x] **13.2** Backend: extraction.ts with mini JSONPath + headers + status — *2026-05-19*
- [x] **13.3** Backend: variable substitution `{{name}}` in URL/headers/body/params — *2026-05-19*
- [x] **13.4** Backend: flowRunner.ts atomic execution + stop-on-failure — *2026-05-19*
- [x] **13.5** Backend: smart caching with TTL (skip step if vars still fresh) — *2026-05-19*
- [x] **13.6** Backend: per-step retries with exponential backoff — *2026-05-19*
- [x] **13.7** Backend: custom wait between steps for async APIs — *2026-05-19*
- [x] **13.8** Backend: monitor scheduler runs due flows atomically — *2026-05-19*
- [x] **13.9** Backend: Slack alert on flow failure — *2026-05-19*
- [x] **13.10** Backend: 13 REST endpoints (flows/steps/runs/cache) — *2026-05-19*
- [x] **13.11** Frontend: FlowEditor modal (name/interval/stop-on-failure) — *2026-05-19*
- [x] **13.12** Frontend: StepEditor modal with 7 tabs (incl. Extract + Retry) — *2026-05-19*
- [x] **13.13** Frontend: Variables hint shows available `{{vars}}` from prior steps — *2026-05-19*
- [x] **13.14** Frontend: FlowCard with expandable step list + per-step results — *2026-05-19*
- [x] **13.15** Frontend: Run Now button with spinner + last-run timestamp — *2026-05-19*
- [x] **13.16** Frontend: Flows section integrated above Standalone URLs — *2026-05-19*
- [x] **13.17** UX: wrap Flows + URLs in visual section panels (Notion/Linear style) — *2026-05-19*
- [x] **13.18** UX: GitHub-style tab navigation with count badges + active underline — *2026-05-19*
- [x] **13.19** UX: URL hash persistence (#urls / #flows) + danger badge on failing count — *2026-05-19*
- [x] **13.20** UX: switching projects in sidebar resets to URLs tab (deep-link still works on refresh) — *2026-05-19*
- [x] **13.21** UX: tighten vertical rhythm (12px gaps) + extra breath before section panel — *2026-05-19*
- [x] **13.22** Backend: Run Audit now includes flows (re-runs all enabled flows) — *2026-05-19*
- [x] **13.23** Backend: HTML report has dedicated Flows table section + 4 KPIs with breakdown — *2026-05-19*
- [x] **13.24** Backend: Slack Block Kit message split into URL track + Flow track — *2026-05-19*
- [x] **13.25** Backend: store extends list queries with lastRunOk + lastRunTotalMs via correlated subquery — *2026-05-19*
- [x] **13.26** Frontend: KpiBar flow-aware (Endpoints label + breakdowns) with graceful no-flows fallback — *2026-05-19*
- [x] **13.27** Frontend: Audit result modal shows dual-track URL/Flow breakdown — *2026-05-19*
- [x] **13.28** Frontend: Flows tab gets mini-KPI strip (Total/Healthy/Failing/Avg run/Last run) — *2026-05-19*
- [x] **13.29** UX: Flow KPI strip enlarged + tooltips on every cell + shows which flow last ran — *2026-05-19*
- [x] **13.30** Fix: Flow KPI strip auto-updates after Run Now (no page refresh needed) — *2026-05-19*
- [x] **5.9** Dynamic axis labels (hours/days/dates) based on selected window — *2026-05-12*

## Phase 1.14 — Prerequisites (project-level setup chain) ✅ Complete

- [x] **14.1** Backend: 4 new tables (prereq_steps / prereq_runs / prereq_step_results / project_variable_cache) + project columns — *2026-05-19*
- [x] **14.2** Backend: store CRUD + run lifecycle + project-pool variable cache — *2026-05-19*
- [x] **14.3** Backend: prereqRunner.ts (sequential exec, retries, wait, TTL, captures to project pool) — *2026-05-19*
- [x] **14.4** Backend: monitor.ts substitutes project-pool `{{vars}}` into every standalone URL check — *2026-05-19*
- [x] **14.5** Backend: flowRunner.ts merges project pool + flow cache (flow-scoped wins on conflict) — *2026-05-19*
- [x] **14.6** Backend: monitor tick auto-runs due prereq chains (before URLs/flows) — *2026-05-19*
- [x] **14.7** Backend: REST endpoints (CRUD prereq steps / run / list runs / get vars / clear vars) — *2026-05-19*
- [x] **14.8** Frontend: PrereqsPanel — collapsible panel above tab nav with status header + Run Now — *2026-05-19*
- [x] **14.9** Frontend: PrereqStepEditorForm (shares 7-tab UX with FlowStep editor) — *2026-05-19*
- [x] **14.10** Frontend: Variables hint in Flow step editor now includes prereq-chain vars — *2026-05-19*
- [x] **14.11** Frontend: live project variable list (with TTL countdown) + Clear vars button — *2026-05-19*
- [x] **14.12** Frontend: per-project schedule controls (interval + enable/disable) — *2026-05-19*
- [x] **14.13** Smoke test: prereq captures token → URL substitutes it → `body-contains` assertion passes — *2026-05-19*
- [x] **14.14** Backend: `{{var}}` substitution inside assertion config (closes the brittleness gap) — *2026-05-19*
- [x] **14.15** Backend: `evaluateAssertions(vars)` param + wired into monitor / flowRunner / prereqRunner — *2026-05-19*
- [x] **14.16** Frontend: assertion UI hints `{{var}}` support (placeholder + tip line) — *2026-05-19*
- [x] **14.17** Smoke test: prereq re-run after pool clear keeps flow green automatically (3 injection shapes) — *2026-05-19*
- [x] **14.18** Backend: split runners — `kickoff*()` returns runId synchronously, `/run-async` returns 202, run completes in background — *2026-05-19*
- [x] **14.19** Frontend: FlowCard + PrereqsPanel poll `/api/flow-runs/:id` and `/api/prereq-runs/:id` every 500ms; live per-step state — *2026-05-19*
- [x] **14.20** UX: progress bar + "Step N of M running…" replaces opaque blocking spinner — *2026-05-19*
- [x] **14.21** Backend: `force` flag bypasses smart TTL cache (`?force=true` on `/run-async`) — *2026-05-19*
- [x] **14.22** Frontend: manual Run-now click always passes `force=true` (scheduler stays cache-aware) — *2026-05-19*
- [x] **14.23** Smoke test: scheduler skips fresh / manual click rotates pool value — *2026-05-19*

## Phase 1.15 — UX hardening (production polish) ✅ Complete

- [x] **15.1** Active project persists across page refresh (localStorage) — *2026-05-19*
- [x] **15.2** Per-project scroll memory: save on leave / restore on return / top on fresh — *2026-05-19*
- [x] **15.3** Prereq panel auto-collapses 1.5s after run completes (restores pre-click state) — *2026-05-19*
- [x] **15.4** Two-click inline confirm for step delete (replaces native `window.confirm`) — *2026-05-19*
- [x] **15.5** Document title reflects active project + failing count — *2026-05-19*
- [x] **15.6** Sidebar shows failing-count badge per project (pulsing red) — *2026-05-19*
- [x] **15.7** Step rows truncate long URLs cleanly (ellipsis + monospace) — *2026-05-19*
- [x] **15.8** Backend: in-memory `liveStep` map per runner; each retry attempt + backoff phase is published — *2026-05-20*
- [x] **15.9** Backend: `GET /flow-runs/:id` and `/prereq-runs/:id` enrich response with optional `liveStep` while mid-flight — *2026-05-20*
- [x] **15.10** Frontend: running step pill switches to amber `🔁 RETRY N/M` + row tints amber during retries — *2026-05-20*
- [x] **15.11** Frontend: progress bar shows `retry N of M (waiting before next try…)` + last-try status code chip — *2026-05-20*
- [x] **15.12** Smoke test: 503 endpoint with 3 retries — attempts 1→4 transitions including backoff phase all visible — *2026-05-20*

## Phase 1.16 — Binary uploads + UX tightening ✅ Complete

- [x] **16.1** Backend: `uploads` table + on-disk storage in `data/uploads/<uuid>` — *2026-05-21*
- [x] **16.2** Backend: `paths.ts` helper centralises UPLOADS_DIR + per-id path — *2026-05-21*
- [x] **16.3** Backend: 3 routes — `POST/GET/DELETE /api/(projects/:id/)uploads` (raw bytes via `express.raw`, 10MB cap, URL-encoded filename header) — *2026-05-21*
- [x] **16.4** Backend: store CRUD (`createUpload`, `getUpload`, `listUploadsByProject`, `deleteUpload`) — *2026-05-21*
- [x] **16.5** Backend: `bodyType="binary"` in `timing.ts` → parses `{uploadId, fieldName?}` body, builds raw or multipart/form-data — *2026-05-21*
- [x] **16.6** Frontend: shared `BinaryBodyEditor` — file picker, image preview, field-name input, existing-uploads picker — *2026-05-21*
- [x] **16.7** Frontend: Binary tab wired into URL editor + Flow step editor + Prereq step editor — *2026-05-21*
- [x] **16.8** UX: "Run Now" on a Flow now auto-runs the prereq chain first (force=true), so flows never fail on stale tokens — *2026-05-21*
- [x] **16.9** UX: Audit button renamed "Generate report" — snapshots current state (no re-check); `?refresh=true` opt-in for full re-check — *2026-05-21*
- [x] **16.10** Smoke test: upload → list → readback → delete round-trip — *2026-05-21*
- [x] **16.11** Frontend: BinaryBodyEditor rebuilt in **Postman style** — "Select File" button + inline filename + clear (×); compact and utilitarian — *2026-05-21*
- [x] **16.12** Frontend: real upload progress bar (XHR `onprogress` %) — thin inline bar under the file row — *2026-05-21*
- [x] **16.13** Frontend: client-side max-size guard (10MB) shows inline error before hitting the server — *2026-05-21*
- [x] **16.14** Frontend: inline filename + size display with × clear button (Postman binary tab layout) — *2026-05-21*
- [x] **16.15** Frontend: "Field name (optional)" inline input — empty = raw bytes, set = multipart (matches Postman's single-tab semantic) — *2026-05-21*
- [x] **16.16** Frontend: inline left-bar error message (no large banners) — *2026-05-21*
- [x] **16.17** Frontend: project uploads library — collapsible list of tight rows with thumb/ext, ✓ for active, hover-only delete — *2026-05-21*
- [x] **16.18** Frontend: FlowCard surfaces a "🔑 Refreshing access tokens…" banner during the prereq phase of Run Now — *2026-05-21*
- [x] **16.19** Frontend: Audit button copy → "Snapshot & report"; tooltip explicitly says "no re-checks" — *2026-05-21*
- [x] **16.20** Fix: × button on selected file now deletes from project (not just unbinds from step) — *2026-05-21*
- [x] **16.21** Replace native `window.confirm` for upload delete with two-click inline confirm (matches existing step-delete pattern) — *2026-05-21*

## Phase 1.9 — Postman parity ✅ Complete

- [x] **6.1** HTTP method support (GET / POST / PUT / PATCH; DELETE blocked) — *2026-05-11*
- [x] **6.2** Body editor (JSON / form / urlencoded) — *2026-05-11*
- [x] **6.3** Custom headers tab — *2026-05-11*
- [x] **6.4** Query parameters tab — *2026-05-11*
- [x] **6.5** Assertions engine (4 v1 types) — *2026-05-11*
- [x] **6.6** Assertion result pills on URL cards — *2026-05-11*
- [x] **6.7** Raw body type with custom Content-Type (Text/XML/HTML/JS/YAML) — *2026-05-12*

## Phase 1.10 — Audit + Slack delivery ✅ Mostly complete

- [x] **7.1** Run Audit button (manual Check All) — *2026-05-08*
- [x] **7.2** HTML report generator — *2026-05-08*
- [x] **7.3** Slack Block Kit message format — *2026-05-08*
- [x] **7.4** Slack file upload (HTML attached) — *2026-05-08*
- [x] **7.5** Audit progress + result modals — *2026-05-08*
- [ ] **7.6** Get Slack Bot Token (xoxb-) and configure in Settings — *date: ____________*

## Phase 1.11 — Discoverability ✅ Complete

- [x] **8.1** Search by URL/description/method — *2026-05-11*
- [x] **8.2** Numbered pagination (LeetCode style) — *2026-05-11*
- [x] **8.3** Method filter chips (color-coded) — *2026-05-11*
- [x] **8.4** Search icon + keyboard shortcut (/) — *2026-05-11*
- [x] **8.5** Result count chip — *2026-05-11*
- [x] **8.6** New URLs appear at top — *2026-05-11*

## Demos & explanations

- [x] **9.1** Demo: API key with/without (httpbin/bearer) — *2026-05-06*
- [x] **9.2** Demo: Basic Auth with httpbin/basic-auth — *2026-05-06*
- [x] **9.3** Demo: POST + JSON body to httpbin/post — *2026-05-11*
- [x] **9.4** Explanation: how Phase 1 connects to Phase 2 — *2026-05-05*
- [ ] **9.5** Manager meeting: present plan and get Phase 2 approval — *date: ____________*

---

## Recent activity

### Today 2026-05-21 — Binary uploads + Flow/Audit UX (19 items)
- New `uploads` table + on-disk store; raw POST via `express.raw` (10MB cap, x-filename header)
- `BinaryBodyEditor` shared across URL / Flow step / Prereq step editors with image preview + reuse picker
- `timing.ts` handles `bodyType="binary"` two ways: raw bytes when no field name, multipart/form-data when set
- Flow "Run Now" auto-runs the prereq chain first (force=true) so a fresh token is always available
- Audit button now produces a **snapshot** of current state by default — `?refresh=true` is the opt-in for the old "re-check everything" behaviour
- **Upload UX overhaul** (9 sub-items): full dropzone with drag-drop, real progress %, client-side size guard, selected-file card with thumb + ext badge, Raw vs Form-field radio toggle, success/error banners, collapsible library, prereq-running banner, audit relabel

### Friday 2026-05-08 — Storage + History + Audit foundation (16 items)
- Migrated entire backend from JSON file to SQLite (`node:sqlite` built-in)
- Built check history table with 7-day retention + auto-pruning
- Built history UI: sparkline, status strip, failure rate chip, KPI bar
- Wired `/api/urls/:id/history` and `/api/urls/:id/stats` endpoints
- Built Run Audit button + HTML report generator + Slack Block Kit + file upload
- Built audit progress + result modals

### Today 2026-05-19 — Prerequisites: project-level auth chain (13 items)
- New top-of-project panel: define a sequential login chain that captures tokens into a project variable pool
- Every URL + every Flow step in the project can now reference captured vars as `{{name}}`
- Hierarchical variable scoping: flow-scoped vars override project pool on name conflict
- Per-project schedule + manual Run Now; chain auto-fires on tick before URL/flow checks
- TTL-aware caching: skip the login step entirely if the token is still fresh
- Live variable list with remaining-TTL countdowns; one-click "Clear captured vars"
- Reuses entire flow-step editor UX (7 tabs) — no new editor concepts to learn
- Smoke-tested end-to-end with httpbin: chain captures `auth_token`, URL injects it, assertion passes

### Earlier 2026-05-11 — Postman parity + Discoverability + new viz (14 items)
- Replaced 2 separate viz with unified **Activity Timeline** (proportional bars + tooltips)
- Added Postman parity: HTTP methods, body editor (JSON/form/urlencoded), assertions engine
- Added custom **Headers** + **Query Params** tabs to URL builder
- Built **LeetCode-style numbered pagination** with smart ellipsis
- Redesigned search bar (icon + `/` shortcut + result count)
- Added color-coded method filter chips
- Sorted URLs newest-first in the list

**Next up (in order):**
1. Get Slack Bot Token from workspace and paste in Settings *(7.6)*
2. Schedule Phase 2 kick-off meeting with manager *(9.5)*
3. End-to-end demo of binary upload feature: POST an image to httpbin/post and verify the response echoes the multipart field

---

## How to use this file

- Open `PROGRESS.md` here in VS Code (or any editor that renders Markdown checkboxes)
- Tick `[ ]` → `[x]` when you finish a task
- Replace `____________` with the date you finished it
- For Excel-style view, open `project-tracker.csv` in Excel or Google Sheets
