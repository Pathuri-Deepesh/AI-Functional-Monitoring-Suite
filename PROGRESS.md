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
- [x] **16.22** Prereq banner now shows live `Step N of M` + completed count + retry chip + filling progress bar — *2026-05-22*
- [x] **16.23** FlowCard "Run now" lifts the prereq runId so `PrereqsPanel` attaches and shows its full step-by-step progress UI (matching panel's own Run-now behaviour) — *2026-05-22*

## Phase 1.19 — Nested for-each (up to 4 levels deep) ✅ Complete

- [x] **19.1** Backend `types.ts`: `ForEachConfig` doc updated for dotted-path `arrayVarName`; `StepResult.iterationPath` + `iterationPathCount` (nested-iteration tracking) — *2026-05-25*
- [x] **19.2** Backend `db.ts`: idempotent migrations for `iteration_path_json` + `iteration_path_count_json` columns on `step_results` — *2026-05-25*
- [x] **19.3** Backend `extraction.ts`: new `Scope` / `ScopeStack` types; `substitute()` + `resolveVar()` walk innermost-first so inner loops shadow outer scopes — *2026-05-25*
- [x] **19.4** Backend `store.ts`: `assertSingleForEach` replaced by `assertForEachDepth` (static scope-stack walk, ≤4 nesting cap) — wired into add/update/copy/move — *2026-05-25*
- [x] **19.5** Backend `store.ts`: `normalizeForEach` now accepts dotted-path `arrayVarName` (e.g. `student.subjects`); `recordStepResult` + `rowToStepResult` persist/parse `iteration_path*` JSON columns — *2026-05-25*
- [x] **19.6** Backend `flowRunner.ts`: `LiveStepProgress.forEachPath` + `forEachTotalPath`; new `TOTAL_CALL_CAP = 10_000` constant — *2026-05-25*
- [x] **19.7** Backend `flowRunner.ts`: top-level `for` → `while` driver; new `computeAbsorbedBlock()` walks contiguous for-each steps whose `arrayVarName` roots through an in-scope loop var (depth ≤ 4) — *2026-05-25*
- [x] **19.8** Backend `flowRunner.ts`: new `runForEachBlock()` recursive runner — per-iteration `ScopeStack` push/pop, direct-child recursion, depth-1 rows keep `iteration_index/_count` for back-compat, depth >1 rows write `iteration_path[_count]` — *2026-05-25*
- [x] **19.9** Backend `flowRunner.ts`: total-call-budget guard (`TOTAL_CALL_CAP`) — emits a `Truncated: total call cap (10,000) reached` sentinel row and short-circuits the current branch when the budget is exhausted — *2026-05-25*
- [x] **19.10** Frontend `types.ts`: mirror backend — `StepResult.iterationPath/iterationPathCount`, `LiveStepProgress.forEachPath/forEachTotalPath`, `ForEachConfig` doc — *2026-05-25*
- [x] **19.11** Frontend `varRefs.ts`: `checkStepVarRefs` now walks ALL earlier for-each steps; lexical scope-stack pushes/pops match the runner so nested `{{student.id}}` + `{{subject.id}}` + `{{mark.id}}` all resolve without false-warning chips — *2026-05-25*
- [x] **19.12** Frontend `flowForms.tsx`: `ForEachEditor` rewritten — grouped `<optgroup>` dropdown (extracted vars vs outer-loop items), depth badge (1..4 with color), pre-filled `student.` text input when picking a loop item — *2026-05-25*
- [x] **19.13** Frontend `flowForms.tsx`: combinatorial-call banner — *"This step will run up to ~10,000 times per flow run (depth × 100/level cap). First 10,000 always execute; further iterations are truncated."* — live recomputed from `computeForEachDepth` — *2026-05-25*
- [x] **19.14** Frontend `flowForms.tsx`: removed the `locked` single-level guard (multi-loop now allowed); dropped the warning banner — *2026-05-25*
- [x] **19.15** Frontend `FlowCard.tsx`: loop-pill gets `depth-{1..4}` class (teal/violet/amber/rose accents) + tooltip naming the outer scope; live progress label shows full path (`iteration 3/10 → 7/12 → 2/8`) — *2026-05-25*
- [x] **19.16** Frontend `FlowCard.tsx`: new `IterationTree` component — chevron-expandable per-level breadcrumb header, left-edge color stripe per depth, 16px indent per level, branch-level ok/fail aggregation, surfaces `⚠ truncated at 10,000` chip when budget hit — *2026-05-25*
- [x] **19.17** Frontend `FlowCard.tsx`: `computeForEachDepth` helper mirrors the backend's static scope-stack walk so the depth pill color stays in sync with the runner's actual nesting — *2026-05-25*
- [x] **19.18** Frontend `styles.css`: `.step-foreach-pill.depth-{1..4}`, `.step-foreach-depth-badge`, `.step-foreach-estimate` banner, `.step-iter-tree` + `.step-iter-children` + `.step-iter-level-{1..4}` + `.step-iter-node.fail` + `.step-iter-breadcrumb` — *2026-05-25*
- [x] **19.19** Build clean: `npx tsc -b` on backend; `npx tsc -b && npx vite build` on frontend — zero warnings — *2026-05-25*

## Phase 1.22 — Pure Loop step type (eliminate scaffold HTTP calls) ✅ Complete

User's ask, verbatim: *"hey claude plan mode, i need changes in the mandatory url for loop part, like y cant we implement another feature next to compute which does the for loop part but without url? how my idea is?"*. The Phase 1.21 Logitech flow worked, but every outer for-each loop had to be attached to an HTTP step — so the user added a `https://httpbin.org/status/200` placeholder purely to provide a `campaign` scope for the inner `country` loop to nest inside. That's ~44 wasted external HTTP calls per outer loop, per run — pure noise, no monitoring signal. Solved by adding a third step type — Loop — that mirrors Compute's shape (no URL, no method, no body) and exists solely to declare iteration scope.

- [x] **22.1** Backend `types.ts`: extended `StepType` discriminator to `"http" | "compute" | "loop"`; no new config shape needed — a Loop step's only config IS its existing `forEach` field. Cleaner than nesting under `loop:` — *2026-06-01*
- [x] **22.2** Backend `store.ts`: 3-way switch in `addFlowStep` and `updateFlowStep` — Loop branch skips URL/method/body/assertions/extractions validation, forces sentinel `url = "loop://step"` (same trick Compute uses for NOT NULL `url` column), requires non-empty `arrayVarName` + `itemVarName`. `rowToFlowStep` cast extended to accept `"loop"`. Zero new DB columns — reuses existing `step_type` + `for_each_config_json` from Phase 1.18/1.21 migrations — *2026-06-01*
- [x] **22.3** Backend `flowRunner.ts`: branched `processBlockEntry` on `stepType` — Loop iterations skip `executeStep` + per-iteration `recordStepResult` entirely and just push/pop the for-each scope, letting downstream HTTP steps inherit `{{campaign}}` naturally. After the loop completes, emits ONE summary `StepResult` with `iterationCount: N, ok: true` so the dashboard shows a single "🔁 ran N iterations" chip instead of N noisy rows. `computeAbsorbedBlock` needed zero changes — it already absorbs any consecutive step whose `forEach` is set regardless of `stepType` — *2026-06-01*
- [x] **22.4** Frontend `types.ts` + `api.ts`: mirrored `StepType` change; `addFlowStep`/`updateFlowStep` input signatures accept `"loop"` — *2026-06-01*
- [x] **22.5** Frontend `flowForms.tsx`: `StepTypePicker` gained `allowedTypes?: StepType[]` prop + a 3rd amber Loop card (🔁 icon, "Iterate over an array — provides scope for nested steps, no HTTP call"). New `<LoopStepBody />` reuses the existing standalone `<ForEachEditor />` — just description + the editor. Submit handler branches by stepType (Loop validates both for-each fields). Prereq form passes `allowedTypes={["http", "compute"]}` since the prereq runner doesn't support for-each — *2026-06-01*
- [x] **22.6** Frontend `FlowCard.tsx` + `styles.css`: `StepRow` accepts `stepType` prop, swaps the HTTP method tag for a `🔁 LOOP` badge (or `⚙ COMPUTE`) and hides the sentinel URL. Loop-step result chip shows "🔁 ran N iterations" instead of `⏱ Xms` (which is meaningless for a scope-only step). Added `.step-type-badge.--loop` amber rule (`rgba(251,146,60,0.10)` bg, `#fed7aa` text) sibling to the Compute badge — *2026-06-01*
- [x] **22.7** Migrated the live Logitech flow (no UI clicks — pure REST): `DELETE /api/steps/<httpbin-id>` then `POST /api/flows/<id>/steps` for the Loop, then `/steps/reorder` to slot it before the inner `/discover` step. Call count drops from ~113 to ~69 per run (44 wasted httpbin scaffolds per run eliminated). Builds clean: `npx tsc -b` zero output; `npx vite build` ✓ 56 modules, 67.84 KB CSS / 355.91 KB JS (12.03 / 105.04 KB gzipped) — *2026-06-01*

**Out of scope, deferred:** Sibling HTTP steps inside one Loop iteration (e.g., `Loop → discover, home` as siblings rather than nested) would let us also avoid duplicating the country loop when we want to probe both `/discover` AND `/home` per country. Genuinely useful, but requires extending `computeAbsorbedBlock` + `processBlockEntry` to absorb non-forEach HTTP steps as a "body" of the innermost loop — kept this PR tight. Phase 1.23 candidate.

## Phase 1.22.1 — Live Loop progress visualization ✅ Complete

Right after shipping 1.22 the user spotted the UX gap: *"whilestep 4 running, it shows queued but it is running 46 steps right, could we visualise it? with the best ux we can"*. The Loop step's `result` only emits AFTER all iterations complete, and `liveStep.position` reports the inner HTTP step — so the Loop sat on a "QUEUED" pill the whole time it was actively orchestrating 46 iterations. Pure visualisation gap, fixed entirely in the frontend.

- [x] **22.1.1** Frontend `FlowCard.tsx`: derive `loopLiveProgress = { current, total }` for any Loop step whose scope contains the live step — `liveStep.forEachPath[depth-1]` / `forEachTotalPath[depth-1]` gives us the iteration directly. When set: pill flips from `QUEUED` to `▶ ITER X / N`, runState becomes "running" (lighting up the existing step-running glow), and `isQueued` is suppressed. Generalizes to nested loops automatically via the depth lookup — *2026-06-01*
- [x] **22.1.2** Frontend `FlowCard.tsx`: inline `<LoopProgress>` widget under the step description — amber band with "🔁 iteration **23** of 46" label, right-aligned percentage, and a 4px gradient progress bar (amber → cream) with a soft amber glow. Eased width transition (360ms cubic-bezier) so the bar advances smoothly between updates; respects `prefers-reduced-motion` — *2026-06-01*
- [x] **22.1.3** Frontend `styles.css`: new `.loop-progress` family (~50 lines) using the same amber palette as `.step-type-badge.--loop` so the Loop step's running visual is unmistakably part of the Loop family. Verified live: `liveStep.forEachPath=[10,1] totals=[46,2]` rendered as `▶ ITER 10/46` + 21% gradient bar. Builds clean (`tsc -b` + `vite build` ✓ 56 modules, 68.74 KB CSS / 356.80 KB JS) — *2026-06-01*

## Phase 1.22.2 — `concatArrays` Compute transform (merge two lists, loop them together) ✅ Complete

Manager's ask, verbatim: *"we will have countries n regions, why can we add both n keep in a separate field, n then we'll loop than tpgether? seems interesting right, could you tell the our product can do that right now?"* — and the honest answer was "no, not yet." Existing `concat` transform builds a string from a template (`"{{a}}-{{b}}"`), not a merged array. The 3 ways to fan out over both `countries` AND `regions` today were (a) nest two separate loops (wasted scaffold), (b) make them siblings (Phase 1.23 scope), or (c) add a transform that merges arrays. (c) is the cleanest and slots straight into the existing Compute step — one new transform kind, zero schema changes.

- [x] **22.2.1** Backend `types.ts`: added 9th `ComputeTransform` variant `{ kind: "concatArrays"; sources: string[] }`. Source field is ignored (transform resolves its own inputs from the scope stack, same pattern as `concat` and `mapAddField`) — *2026-06-01*
- [x] **22.2.2** Backend `extraction.ts`: `applyComputeTransform` case for `concatArrays` — resolves each name via `resolveVar(stack, name)` (innermost-first scope walk with dotted-path support), validates each is an array (throws on type mismatch with a clear message), silently skips empty/missing entries, returns the flat concatenation. Missing-but-named arrays are not an error so the transform composes nicely with conditional upstream extractions — *2026-06-01*
- [x] **22.2.3** Frontend `types.ts`: mirrored the new variant; added editor entry in `TRANSFORM_KINDS` ("Concat arrays (merge lists)" with hint *"e.g. countries + regions → one combined list, then Loop it"*); `defaultTransform` returns `{ kind: "concatArrays", sources: ["", ""] }`; `needsSource` excludes it (like `concat`); new editor UI block with numbered "Source array 1/2/..." inputs, add/remove buttons (remove disabled when only 1 source left), placeholders that read `countries` / `regions` / `another_array`. `mapAddField` inner-transform picker filters `concatArrays` out (mapAddField operates on a single scalar field per element) — *2026-06-01*
- [x] **22.2.4** Demo flow built end-to-end via REST: Step 1 POSTs `{countries:[US,UK,JP],regions:[EMEA,APAC]}` and extracts both arrays, Step 2 Compute `concatArrays(countries, regions)` → `geos`, Step 3 Loop `geos as geo`, Step 4 HTTP `GET /anything/{{geo}}/discover`. Run verified green: 5 iterations fired with URLs `/US/discover`, `/UK/discover`, `/JP/discover`, `/EMEA/discover`, `/APAC/discover` — the merge worked. Builds clean: `tsc -b` zero output, `vite build` ✓ 56 modules, 358.41 KB JS / 68.74 KB CSS — *2026-06-01*
- [x] **22.2.7** Click-to-copy URL parity across all flows — user pointed out that clicking a URL in the Logitech flow copies to clipboard, but the same gesture didn't work in other projects' flows. Investigated: NOT a project-level gate (audited both backend + frontend, no `projectId === "logitech"` hardcoding exists — all gating is generic projectId filtering by design). The actual cause: Logitech uses nested loops → `IterationTree` renderer → `CopyableUrl` button. Other projects use single loops → depth-1 row → previously a plain `<span>`. Swapped the span for `<CopyableUrl url={r.resolvedUrl} />` and added matching CSS scoped to `.step-iterations-row` (hover bg, focus outline, ⧉ copy hover affordance, ✓ copied flash). Now click-to-copy works identically across every flow in every project, regardless of loop depth. Builds clean: 56 modules, 358.46 KB JS / 69.96 KB CSS — *2026-06-01*
- [x] **22.2.6** Show resolved URL on depth-1 iteration rows in the dashboard — another **pre-existing bug** the user caught after the preview fix landed. [FlowCard.tsx:976-1003](frontend/src/components/FlowCard.tsx#L976-L1003) rendered `#N ✓ 200 2936ms` for each iteration but silently dropped `r.resolvedUrl`. The nested-loop case (line 1006 → `IterationTree`) already showed it, so this only bit single-loop flows. Added a `<span className="iter-url">` (mono, muted, ellipsis-truncated) so each iteration row now shows the actual URL fetched (`/anything/US/discover`, `/anything/UK/discover`, …) instead of just status + latency. Builds clean: 56 modules, 358.51 KB JS / 69.04 KB CSS — *2026-06-01* *(superseded by 22.2.7 same day — span replaced with `<CopyableUrl>`)*
- [x] **22.2.5** Fix `/api/flows/:id/sample-vars` to rehydrate stringified arrays — a **pre-existing bug** the user caught while reviewing the demo. `flowRunner.flattenVariables()` JSON-stringifies arrays before persisting to `flow_runs.variables_json` (for the TEXT column / Slack alerts), so reads came back as strings. The frontend preview's `Array.isArray()` check silently failed → `{{geo}}`-style iterables never expanded → preview was effectively dead for every flow that uses for-each (including the Logitech flow). Added a small `rehydrateSampleValue` helper in the endpoint that `JSON.parse`s any string starting with `[` or `{`. Less invasive than changing the persistence shape (which would ripple into `variable_cache` + Slack + run-history rendering). Verified: demo flow's `geos` now returns as a real 5-element array, preview will expand to all 5 resolved URLs — *2026-06-01*

**What the user can show the manager:** open the Default project → "Demo: concatArrays + Loop (countries + regions)" flow → click into Step 2's Compute editor → "Kind" dropdown now has *Concat arrays (merge lists)* → row shows two source inputs `countries` and `regions` → run the flow and watch one Loop summary chip + 5 per-geo HTTP rows. Generalises to N source arrays via the + button (not capped to 2).

## Phase 1.22.3 — `mapAddField` element-scope unlock (concatArrays inside mapAddField) ✅ Complete

User's ask, verbatim: *"yeah it worked, final work for today, do it ill but premium subscription of yours, in logitech campaign servces project, in that only flow, what ur task is step 1 is crt, in step 2 : u must concat two arrays which is countries n regions"*. The Logitech CMS returns ~44 campaigns each carrying `{documentId, locale, countries:[...], regions:[...]}`. The new dev API path is `/campaign/<docId>/<locale>/<country-or-region>/discover` — countries and regions share one URL axis. The user wanted Phase 1.22.2's `concatArrays` to merge each campaign's per-element `countries + regions` into a derived `geos` field. Problem: `concatArrays` resolves names against the scope stack via `resolveVar`, and as built it could only see TOP-LEVEL vars — per-campaign `countries`/`regions` live INSIDE each element. Fixed in 3 small surgical changes that compose `mapAddField{inner: concatArrays}` cleanly.

- [x] **22.3.1** Backend `extraction.ts`: `applyComputeTransform` mapAddField case now pushes the current element onto the scope stack when invoking its inner transform — `innerStack = [...stack, el as Scope]` for object elements. Inner transforms (notably `concatArrays`) can now resolve element fields by name (`countries`, `regions` → per-element arrays). Backwards-compatible: existing inner transforms (`splitTake`/`slice`/`replace`/`concat`) don't reach into stack the same way, so behavior is unchanged for them. Element-shadowing is intentional — gives users a way to reference per-element data without restructuring their flow — *2026-06-01*
- [x] **22.3.2** Frontend `flowForms.tsx`: two coupled UI changes that unlock the feature end-to-end. (a) Removed the `k.value !== "concatArrays"` filter from the mapAddField inner-transform picker — concatArrays now appears in the dropdown. (b) Added a `concatArrays` render branch in `MapAddFieldInnerEditor` — reuses the same "+ Add another array" sources-list UI the top-level concatArrays editor has, with a `<p>` explainer noting that names resolve against the current element first. Without (b) the user could pick concatArrays but had no input fields to fill in — *2026-06-01*
- [x] **22.3.3** Logitech flow rewrite (real dogfood, not synthetic demo): user clicked through the UI to replace Step 2's `mapAddField → splitTake(locale)` (the old `language` derivation, no longer needed since the new URL uses `locale` directly) with `mapAddField{fieldName:"geos", inner: concatArrays(["countries","regions"])}`. Step 4 updated to iterate `campaign.geos as geo` with the new URL `https://dev-campaign-service.np.logitech.io/campaign/{{campaign.documentId}}/{{campaign.locale}}/{{geo}}/discover`. Run verified: **66/69 calls 2xx**, 3/69 4xx (all `zh-Hant` locale 403s — real backend gap, not a tool issue — exactly the kind of signal the monitoring suite is meant to surface). Flow + Step 3 descriptions PATCHed to reflect the new shape (removed stale `language` / `campaign.countries` references). Builds clean: backend `tsc -b` zero output, frontend `tsc -b` zero output — *2026-06-01*

**Honest doubt-clearing moment with the user:** they asked *"while implementing we need for each, but for concatinating 2 arrays, n adding that to new field, that too for a specific campaign y not, how doesnt it working without for loop?"*. Explained that `mapAddField` IS a loop — the word "map" already means "apply to every element". Two kinds of for-each in the tool now: step-level (for HTTP, where each iteration is a monitored event with its own status/latency/chip) vs compute-level mapAddField (data shaping where the iteration is internal plumbing, one chip for the whole transform). Rule of thumb: see "map" in a transform name → it's already a loop, don't wrap it.

## Phase 1.24 — Export project to OpenAPI / Swagger spec ✅ Complete

Manager's ask, relayed by user verbatim: *"you tell ai that to export to swagger ai, it knows how to do, then u'll understand later ill give some link soo we test the import part later right after it"*. User confirmed scope: *"1.build the export now like a pro / 2. also flows / 3.later we can buld the import, as of now export is fine, cz its easy"*. Import deferred until manager provides the test link.

A new dev joining Logitech can take the exported file, drop it into Postman / ReadyAPI / SwaggerHub, and immediately reproduce every monitor + flow this project encodes — zero meetings, zero hand-written docs. The export also pressure-tests our data model: if it serialises cleanly to OpenAPI, the schema is sound.

**Hybrid encoding** (chosen over Swagger-only or sidecar-only): every HTTP step (URL monitor, flow step, prereq step) becomes a Swagger `paths` entry with our orchestration metadata in `x-mon-*` extensions; a top-level `x-mon-flows` side-band lists every flow in position order — the only place Compute and Loop steps appear, since Swagger has no concept of a non-HTTP node.

- [x] **24.1** Backend `openapiExport.ts` (new file): pure transform `buildOpenAPISpec(project, urls, flows, prereqs): OpenAPIDocument`. Helpers: `splitServerAndPath` (URL() parser with `{{var}}` placeholder protection), `toOpenAPIPathKey` (`{{a.b}}` → `{a_b}` so dotted vars stay distinct), `templateVarsToPathParams`, `extractServers` (filters out `compute://step` + `loop://step` sentinels), `buildSecuritySchemes` (Authorization+Bearer → `type:http scheme:bearer`; anything else → `type:apiKey in:header name:<headerName>`), `buildOperationForUrl` / `buildOperationForFlowStep` / `buildOperationForPrereq` (each emits the right `x-mon-*` extension shape), `mergeOperation` (collision-safe path+method merge — appends `#<id-slice>` alias key on duplicate to avoid losing operations), `buildXMonFlow` (full flow side-band with stepType / level / forEach / compute), `sortKeys` (alphabetical path sort for deterministic diffs). Zero side effects, no DB access — *2026-06-04*
- [x] **24.2** Backend `index.ts`: added `GET /api/projects/:id/export/openapi?format=yaml|json` (defaults YAML). Reuses existing `getProject` / `listUrlsByProject` / `listFlowsByProject` + `getFlowWithSteps` / `listPrereqSteps`. Output via `js-yaml` (`yaml.dump` with `lineWidth: 120, noRefs: true, sortKeys: false`) or `JSON.stringify(spec, null, 2)`. `content-disposition: attachment; filename="<slug>-openapi.<ext>"` so browsers trigger the download — *2026-06-04*
- [x] **24.3** Backend `package.json`: added `js-yaml@^4.1.0` + `@types/js-yaml@^4.0.9`. Same lib will handle import parsing later — picked once for round-trip symmetry — *2026-06-04*
- [x] **24.4** Frontend `api.ts`: new `exportProjectOpenAPI(projectId, format): Promise<{ blob, filename }>`. Parses `content-disposition` header for the server-suggested filename; falls back to `openapi.<ext>` if missing — *2026-06-04*
- [x] **24.5** Frontend `ProjectView.tsx`: new "📥 Export to Swagger" button in `hero-actions` between Snapshot button and the settings icons. Handler `handleExportOpenAPI` calls the API helper, creates a Blob URL, triggers download via a temporary anchor, revokes the URL, shows a `success` toast with the filename. Failure → `error` toast with the server's error message. Loading state: Spinner + "Exporting…". Disabled when project has zero URLs AND zero flows (tooltip explains) — *2026-06-04*
- [x] **24.6** End-to-end smoke on the live CMS / Logitech project: YAML export — clean OpenAPI 3.0.3 with `servers` = exactly the 2 real hosts (compute/loop sentinels filtered), `paths` alphabetically sorted, `/api/getCampaigns` + the 2 dotted-path-distinct `/campaign/{campaign_documentId}/{campaign_locale}/{geo}/...` paths, `securitySchemes.campaign-api-key = { type: http, scheme: bearer }` correctly derived from the project's Bearer ApiKey, `x-mon-flows` round-trips Compute step's `mapAddField → concatArrays(countries, regions)`, Loop step's `forEach{ campaigns as campaign }`, sibling L2 children with `forEach{ campaign.geos as geo }` and full `assertions` + `extractions` + `level` + `position`. JSON variant parses cleanly. Determinism verified: two consecutive exports byte-identical. Default project (no flows, 12 hosts) also renders OK — *2026-06-04*
- [x] **24.7** Build clean: backend `tsc -b` zero output; frontend `tsc -b` zero output — *2026-06-04*

**Why hybrid was the right call:** Swagger-only would have *lost* Compute and Loop steps (they have no URL to hang off). Sidecar-only (custom JSON file) would have *lost* the Swagger benefit — no Postman import, no SwaggerHub render, no contract surface. Hybrid gives both: HTTP steps render as real Swagger paths a tool can call, AND every flow (including non-HTTP steps) is fully reproducible from the `x-mon-flows` side-band. The `x-mon-step-id` + `x-mon-prereq-id` + `x-mon-url-id` markers also pre-wire the future import: a parser can identify which records to UPDATE (id present) vs INSERT (id absent).

**Design constraint preserved:** Snapshot/Report and AI features unaffected — this is data plumbing using a standard file format, not the deferred AI work. Manager's "AI is for later" invariant still honoured.

**Out of scope (deferred to later phases):** Import side (Phase 1.25 — needs manager's spec link first); all-projects single-spec export; sample/recorded response bodies as `examples:`; format dropdown in UI (defaults YAML, `?format=json` available via direct endpoint); push-to-SwaggerHub (wait until we know Logitech actually uses it).

## Phase 1.23 — Explicit step levels + sibling children inside one loop iteration ✅ Complete

User's bug report, verbatim: *"there a bug in cmc, like if i add one more url l2 /home its running twice, so why doont we like if a for loop comes, a one inch inside a nested loop, if another for loop comes"*. And the locked design call: *"like if the user selects l2 means it comes under l1 n it shd not consider as a step it shd be numbered as a,b,c, if user selected l3, it shd come under l2... so that outer for loop if i=0, /home n /discoever both will work for i=0 to i-campaigns.len-1"*.

The Logitech flow had 6 steps with a **duplicate LOOP** at pos 5 — the only way to express "both /discover AND /home run inside the SAME campaign iteration" under the old linear-absorption runner. Net effect: campaigns array iterated twice → 227 calls/run instead of ~139, /home re-walked campaigns it didn't need to. Root cause: every for-each chain was linear — once /discover absorbed into the LOOP block, /home couldn't join as a sibling. Fix: replace implicit depth-from-for-each-scope inference with an **explicit, user-controlled level (1..4)** + tree-shaped execution.

- [x] **23.1** Backend `db.ts`: one additive migration via existing `ensureColumn` — `flow_steps.level INTEGER NOT NULL DEFAULT 1`. All existing rows default to 1 so flows render + execute identically until backfill runs — *2026-06-03*
- [x] **23.2** Backend `types.ts` + `store.ts`: added `level: number` to `FlowStep`; `rowToFlowStep` reads it (default 1); `addFlowStep` + `updateFlowStep` accept + persist it. New `assertLevelChain(steps)` validator: walks steps in position order, maintains `lastAtLevel[1..4]`, throws `"Step at position X has level N but no level-(N-1) parent before it"`. Runs alongside existing `assertForEachDepth` (orthogonal scope check) — *2026-06-03*
- [x] **23.3** Backend `flowRunner.ts`: deleted flat `computeAbsorbedBlock` + `processBlockEntry` linear-chain recursion. New `buildExecutionTree(steps)` returns a root forest with precomputed `hasForEachDescendant` per node; new recursive `executeNode(node, baseStack, iterationStack, …)` is the single execution primitive for every step. forEach branch iterates + recurses children per iteration; compute branch writes to top iteration frame (so sibling L(N+1) children see the new vars); HTTP branch records + recurses. `useMulti = iterationStack.length > 1 || node.hasForEachDescendant` decides single-axis vs multi-axis (`iterationPath/iterationPathCount`) reporting. Phase 1.22 Loop summary `recordStepResult`, smart-cache, TTL writes, total-call cap (10_000), stopOnFailure (gated on top-level only), live forEachPath/forEachIteration progress all preserved. `executeRun` top-level loop replaced with `for (const root of buildExecutionTree(flow.steps)) await executeNode(root, …)` — *2026-06-03*
- [x] **23.4** Frontend `types.ts` + `api.ts`: mirrored `level: number` on `FlowStep`; `level` field rides existing `addFlowStep` / `updateFlowStep` payloads via `Partial<FlowStep>` — *2026-06-03*
- [x] **23.5** Frontend `FlowCard.tsx`: deleted `computeForEachDepth`. New `computeStepLabels(steps)` walks steps in order, maintains counters[1..4]: for step at level N, increment counters[N], reset counters[N+1..4]; label = counters[1] + (N≥2 ? letter(counters[2]) : "") + (N≥3 ? "." + roman(counters[3]) : "") + (N≥4 ? "." + counters[4] : ""). `letter(n)`: 1→a, 26→z, 27→aa. `roman(n)`: 1→i, 2→ii, 3→iii, 4→iv. `StepRow` gains `label: string` + `level: number` props; position badge renders `label` ("3a" instead of "4"); inline style sets `--step-level` CSS var so indentation keys on explicit level not inferred depth — *2026-06-03*
- [x] **23.6** Frontend `styles.css`: renamed indent var to `--step-level`; added `.step-row.step-level-2/3/4` with progressive `margin-left` + 1px dashed brand-cyan low-alpha `border-left` guideline so the parent→child hierarchy is visible at a glance. New `.level-picker` family (`.level-picker-pills`, `.level-pill`, `.level-pill.active`, `.level-pill:disabled` with strikethrough, `.level-picker-hint`) — *2026-06-03*
- [x] **23.7** Frontend `flowForms.tsx`: new `LevelPicker` component — 4 pill row `[L1][L2][L3][L4]` below `StepTypePicker`. `allowedLevels` useMemo mirrors backend's `assertLevelChain` client-side: walks steps preceding the current edit position, maintains `lastAt[1..4]`, returns the set of levels with a valid parent above. Disallowed pills are rendered disabled with a tooltip `"L2 needs a level-1 step earlier in the flow"`. `useEffect` snaps level down if a deleted parent invalidates the current selection. All three submit branches (compute / loop / http) include `level` in the payload. Prereq editor unchanged (deferred) — *2026-06-03*
- [x] **23.8** Migration script `.claude_internal/backfill_step_levels.py`: enumerates flows via `/api/projects` → `/api/projects/:id/flows` (top-level `/api/flows` doesn't exist), then for each flow walks steps in position order mirroring `assertForEachDepth` — any forEach step whose array-source root is found at index K in the scope stack gets `level = K + 2`. **Pass 1 result on live DB:** 8 patches across 4 flows — Nested-demo depth-2/3/4 demos (pos 3→L2, pos 4→L3, pos 5→L4) and the Logitech flow (pos 4 + pos 5 → both L2, now siblings under LOOP-3). Pass 2 (duplicate-LOOP detector) found none — the user had already manually removed the duplicate. **Every pre-1.23 flow renders + executes identically post-migration** — we made the implicit depth explicit, nothing else — *2026-06-03*
- [x] **23.9** End-to-end verification on the live Logitech flow (44 campaigns, 2 countries/campaign avg): 135 stepResults total → 1 (campaigns fetch) + 0 (compute locales, no result row) + 1 (LOOP summary with `iterationCount: 44`) + 65 /discover (each with `iterationPathCount: [44, N]`) + 65 /home (each with `iterationPathCount: [44, N]`) + extraction rows. Both /discover AND /home now execute as sibling L2 children inside the SAME campaign iteration — no second outer LOOP pass. Run completed `ok: true` in 110s — *2026-06-03*
- [x] **23.10** Build clean: backend `tsc -b` zero output; frontend `tsc -b` + `vite build` zero errors. The migration is one-time and idempotent — re-running it prints `"ok already correct"` for every step — *2026-06-04*

**Why this matters:** The old runner forced users to encode "two siblings inside one loop iteration" as "two outer loops over the same array" — the only escape hatch the linear-absorption model offered. That doubled the campaigns walk, doubled the iteration cost, and made the dashboard show TWO LOOP chips where there should have been ONE. The new tree-recursion model lets `/home` and `/discover` sit side-by-side under LOOP-3, each labeled `3a` and `3b` in the UI, and both execute inside `campaigns[i]` before moving to `campaigns[i+1]`. Same monitoring signal, half the wasted iterations, infinitely clearer mental model — the level you see in the UI IS the level the runner executes at.

**Design constraint preserved:** Snapshot/Report (Phase 1.20) untouched — levels are a flow-editor + runner concept, the read-only audit just renders whatever StepResults the run produced. Manager's invariant *"its job only to report at that time"* honoured.

**Out of scope (deferred):** Prereq sibling support (prereqs stay flat / L1-only); cross-level drag-and-drop reordering with parent re-attachment (drag stays in flat position order — user edits level explicitly to move between levels); auto-detect duplicate-LOOP patterns in OTHER flows (Pass 2 of the script reports them; no auto-fix).

## Phase 1.22.4 — Final UX sharpening (production polish) ✅ Complete

User's ask, verbatim: *"final ux sharpening, my product shd be very smooth atleast 1% rn, do the things u need to do, that i may not specify"*. Open-ended polish brief — find rough edges I hadn't been told about and fix them. Spawned an Explore-agent audit, verified each claim against the actual code (audit was wrong on the loop progress bar — CSS already exists), and shipped the high-impact subset. Pure frontend, zero backend churn, bundle grew by 0.23 KB.

- [x] **22.4.1** New `frontend/src/utils/format.ts` — two shared formatters that didn't exist before. `formatLatency(ms)` returns `"284ms" / "1.23s" / "12.4s" / "1m 20s"` instead of raw `"1234ms"` everywhere. `formatRelative(ts)` returns `"just now" / "42s ago" / "5 min ago" / "3h ago" / "12d ago"` instead of `toLocaleString()` walls. Both handle null/undefined/future timestamps. Also exports `formatAbsolute()` so callers can still get the full timestamp for tooltips — *2026-06-02*
- [x] **22.4.2** Wired `formatLatency` into 9 surfaces that previously showed raw ms: `LatencyBar` (segment tooltips + chip values + total), `FlowCard` (last-run meta + step meta-chip + iteration rows depth-1 + iteration rows nested), `PrereqsPanel` (project meta + step meta-chip), `ActivityTimeline` (tooltip avg-latency), `KpiBar` (avg-URL-latency card), `ProjectView` (avg-run KPI cell + full-check-done toast), `Sparkline` (axis label with SVG `<title>` for raw ms). Every changed display also gets a `title=` with the raw ms so power users hovering can still see the exact value — *2026-06-02*
- [x] **22.4.3** Wired `formatRelative` into 4 "Last run" / "Last check" timestamp surfaces: `FlowCard` (flow last-run line), `PrereqsPanel` (prereq panel header — was already calling a local helper; replaced both PrereqsPanel + ProjectView local `formatRelative` shadows with the shared util), `UrlCard` (per-URL last-check line). Absolute timestamp preserved in `title=` for hover. The two local duplicates deleted (~12 lines net removed) — *2026-06-02*
- [x] **22.4.4** Disabled-button tooltips: Run-Now (flow + prereq) and full-check / check-all-now buttons now show DIFFERENT tooltip copy depending on WHY they're disabled (running vs no-steps vs no-URLs) rather than one generic message. Also added `aria-label="Delete flow"` + `title="Delete this flow"` to the bare-emoji 🗑 delete button on flow cards (was an accessibility gap — screen readers heard "wastebasket" with no context) — *2026-06-02*
- [x] **22.4.5** Backend-connection loss surfacing: `App.tsx#refresh()` polls every 3s and silently swallowed errors via `console.error(e)` — if the backend crashed, the UI froze on stale data with zero indication. Added a `connectionLost` ref that pushes ONE toast on the down-edge ("Lost connection to the backend — showing stale data until it returns.") and ONE on recovery ("Reconnected to the server."). Debounced so a flaky backend doesn't spam 20 toasts per minute — *2026-06-02*
- [x] **22.4.6** Verified loop-progress-bar CSS already exists (`.loop-progress-bar-fill` at styles.css:3791) — audit flagged it as missing but it isn't. Verified-only, no code change. Documented here so the absent diff is not mistaken for a missed item — *2026-06-02*
- [x] **22.4.7** Build clean: backend `tsc -b` (unchanged — no backend touched), frontend `tsc -b` + `vite build` zero errors. Bundle: **361.27 KB JS** (+0.23 KB) / **69.96 KB CSS** (unchanged) — *2026-06-02*

**Why these and not others:** the audit surfaced 8 candidates; I shipped 5, verified 1 was wrong, and dropped 2 (modal-escape hint = adds clutter for marginal value; iteration-tree-button disabling = low-frequency edge case). Principle: every shipped item should be a thing a user would NOTICE within 30 seconds of using the dashboard, not a thing only a UX reviewer would spot in screenshots.

## Phase 1.21 — Compute step + Live URL preview (Logitech campaign use case) ✅ Complete

Manager's ask, verbatim: *"when i give a api, that response, i need to take the locale, country/region, n documentid n i shd run those diff url too in a flow"*. Logitech campaign service returns ~44 rows of `{documentId, locale, countries, regions}` and the suite must fan out to ~69 derived URLs of shape `https://device-recommendation.logitech.com/campaign/<documentId>/<lang>-<country>/discover` — hardcoding is dead on arrival, the list churns whenever marketing publishes. Solved with one missing primitive (a Compute step that derives variables from other variables) + a premium-feel live URL preview panel so users see the materialised URLs before saving the template.

- [x] **21.1** Backend `types.ts`: added `ComputeTransform` (8 kinds — splitTake, slice, lowercase, uppercase, trim, replace, concat, recursive mapAddField), `ComputeRow`, `ComputeConfig`, `StepType`; extended `FlowStep` + `PrereqStep` with optional `stepType` / `compute` fields (additive, defaults preserve every pre-1.21 step as `"http"`) — *2026-05-29*
- [x] **21.2** Backend `extraction.ts`: pure `applyComputeTransform(value, transform, stack)` handling all 8 transforms (mapAddField walks arrays, enriches each element via inner transform); `expandTemplateForPreview()` + `buildPreviewRow()` produce cartesian-sampled preview rows with literal/resolved/unresolved segments capped at maxSamples=20 — *2026-05-29*
- [x] **21.3** Backend `db.ts`: idempotent `ensureColumn` migrations for `flow_steps.step_type` (default `'http'`) + `compute_config_json`; same on `prereq_steps`. Existing rows untouched — *2026-05-29*
- [x] **21.4** Backend `store.ts`: marshalling for new columns on both flow and prereq paths; compute branch skips URL/method/body validation, uses sentinel URL `compute://step` so the NOT NULL `url` column stays compatible; validates `computations` non-empty; added `getLatestSuccessfulFlowVariables(flowId)` powering the preview endpoint — *2026-05-29*
- [x] **21.5** Backend `flowRunner.ts` + `prereqRunner.ts`: top-level compute branch BEFORE for-each detection (so `mapAddField` enriches the array upfront; downstream for-each over `campaign.countries` just works); local-scope chaining so later rows in one Compute step see earlier rows' saveAs; `computedValueToPersist` coerces unknown → ExtractedValue.value shape for run-history; prereq variant adds string coercion for the project-pool scope — *2026-05-29*
- [x] **21.6** Backend `index.ts`: `GET /api/flows/:id/sample-vars` returns `{variables, iterables, hasSample}` — `variables` from latest successful run, `iterables` derived from the flow's own for-each `itemVarName → arrayPath` mapping. Feeds the live URL preview panel — *2026-05-29*
- [x] **21.7** Frontend `types.ts` + `api.ts`: mirror Compute types + `FlowSampleVars`; `addFlowStep` + `addPrereqStep` input shapes extended with `stepType` / `compute`; new `fetchFlowSampleVars(flowId)` helper — *2026-05-29*
- [x] **21.8** Frontend `flowForms.tsx`: new `<StepTypePicker />` (two cards — HTTP vs Compute — only shown when creating; edits lock); new `<ComputeStepBody />` + `<ComputeRowEditor />` with per-kind inline fields (separator/index for splitTake, find/replace pair, concat template with `{{var}}` hint, full mapAddField editor including nested inner-transform picker); preserves all 8 existing tabs on the HTTP branch; submit handler branches by `stepType` — *2026-05-29*
- [x] **21.9** Frontend `flowForms.tsx`: new `<URLPreviewPanel template={url} flowId={flowId} />` slot under the URL input on the Basics tab. Fetches `/sample-vars` once per editor open; mirrors backend `expandTemplateForPreview` + `resolveVar` + `toScalar` client-side so the preview updates live on every keystroke without an extra round-trip. States: hidden when no `{{vars}}` in template, "no sample data yet" before first successful run, color-coded segments after (green = resolved, red wavy-underlined = unresolved), badge "Will generate ~N calls per run" — *2026-05-29*
- [x] **21.10** Frontend `styles.css`: ~190 lines added — `.step-type-picker` + `.step-type-card`, `.step-type-badge.--compute`, `.compute-row-card` + `.compute-saveas` + `.compute-kind-select`, full `.url-preview-panel` family (`--empty`, `--loading`, `--error`, header, count-badge with `--warn` variant, list, row, segment with `--literal`/`--resolved`/`--unresolved` modifiers, footer) — all using existing CSS tokens (var(--panel-2), var(--accent-soft), var(--r-sm)) so it fits the existing visual language — *2026-05-29*
- [x] **21.11** Builds clean: `cd backend && npx tsc -b` zero output; `cd frontend && npx tsc -b && npx vite build` ✓ 56 modules, 353 KB JS / 67 KB CSS (gzip 104 KB / 12 KB) — *2026-05-29*

**Logitech recipe (configured purely via UI, zero code per-customer):** Flow with 5 steps — (1) HTTP GET `/api/getCampaigns` extracting `$[*] → campaigns`, (2) Compute step with one `mapAddField` row that enriches every campaign with `language = splitTake(locale, "-", 0)`, (3) For-each `campaigns as campaign`, (4) For-each `campaign.countries as country` nested inside, (5) HTTP `GET .../campaign/{{campaign.documentId}}/{{campaign.language}}-{{country}}/discover` with `status-equals 200` + `latency-under 3000`. When marketing publishes new campaigns or countries, step 1's response includes them, the for-each loops one more time, new URLs auto-appear in the dashboard — zero manual reconfiguration.

**Read-only audit preserved:** Snapshot/Report (Phase 1.20) is untouched — Compute steps do their work during scheduled or manual flow runs only; the report still purely reads existing state. Manager's invariant *"its job only to report at that time"* honoured.

## Phase 1.20 — Manual "Check now" buttons + read-only audit ✅ Complete

- [x] **20.1** Backend `audit.ts`: stripped the `options.refresh` block (and the `options` parameter) from `runAuditAndDeliver`; removed `checkAllInProject` + `runFlow` imports. Snapshot/Report is now strictly READ-ONLY — *2026-05-25*
- [x] **20.2** Backend `index.ts`: dropped `req.query.refresh === "true"` parsing from `POST /api/projects/:id/audit`; manager-mandated separation of "trigger" vs "report" — *2026-05-25*
- [x] **20.3** Backend `index.ts`: new `POST /api/projects/:id/check-urls` reusing `checkAllInProject(id, 8)`; returns `{ checked, ok, failed, durationMs }` — *2026-05-25*
- [x] **20.4** Backend `index.ts`: new `POST /api/projects/:id/check-all` — prereqs first (sequential, they capture tokens), then standalone URLs + enabled flows in parallel; continues even if prereqs fail; returns `{ durationMs, prereqs, urls, flows }` — *2026-05-25*
- [x] **20.5** Frontend `api.ts`: new `checkAllUrls(projectId)` + `checkEntireProject(projectId)` helpers + their typed result interfaces (`CheckUrlsResult` / `CheckAllResult`) — *2026-05-25*
- [x] **20.6** Frontend `App.tsx`: `handleCheckAllUrls` + `handleCheckEntireProject` mirroring the `handleRunAudit` pattern; busy state per-project (`busyCheckUrls` / `busyFullCheck`); toast on completion summarising counts + duration; auto-refresh on success — *2026-05-25*
- [x] **20.7** Frontend `ProjectView.tsx`: **Button 1 "⚡ Check all now"** added inside a new `.method-chips-row` flex wrapper, right of the HTTP method chips; disabled when `urls.length === 0` — *2026-05-25*
- [x] **20.8** Frontend `ProjectView.tsx`: **Button 2 "⚡ Run full check"** added in `.hero-actions` to the LEFT of `📊 Snapshot & report` (now demoted to default button styling); cog + delete remain at the far right — *2026-05-25*
- [x] **20.9** Frontend `styles.css`: new `.method-chips-row` (flex row, `space-between`, wraps on narrow widths) + `.check-all-urls-btn` (no-shrink, no-wrap) so the chips bar and the trigger share a single line — *2026-05-25*
- [x] **20.10** Build clean: `npx tsc -b` (backend) + `npx tsc -b && npx vite build` (frontend) — zero warnings; bundle 336KB JS / 63KB CSS (gzip 100KB / 11KB) — *2026-05-25*

## Phase 1.20.1 — "Run full check" live progress orchestration ✅ Complete

Manager feedback after Phase 1.20 demo: *"when i click 'run full check', ux is not responding, it shd run the prereq n then the flows one by one right so that user will know its running, but its blank, its nit userfriendly"*. The single blocking `/check-all` endpoint was doing all the work server-side; the frontend just sat on a spinner until everything finished. Rewired the button to a client-side orchestrator that drives existing async kickoff + poll endpoints — every phase now lights up in real time in the matching panel/card.

- [x] **20.1.1** Frontend `FlowCard.tsx`: new `externalRunId?: string | null` prop + `useEffect` that, when set, calls `handleRun({ runId, skipPrereqs: true })` to attach to a parent-orchestrated flow run without re-kicking it off — mirrors the existing PrereqsPanel pattern — *2026-05-27*
- [x] **20.1.2** Frontend `FlowCard.tsx`: `handleRun` refactored to accept `{ runId?, skipPrereqs? }` — when `runId` is supplied the kickoff is skipped and we poll the existing run; the "Run now" button now wraps with `() => handleRun()` so the MouseEvent isn't passed as opts — *2026-05-27*
- [x] **20.1.3** Frontend `ProjectView.tsx`: new orchestrator state (`fullCheckBusy`, `fullCheckPhase`, `orchestratorFlowRunId`) + `runFullCheckOrchestrator()` — phase 1 runs prereqs (sets `externalPrereqRunId` so PrereqsPanel shows live progress), phase 2 kicks off URLs in parallel while iterating enabled flows one at a time (sets `orchestratorFlowRunId` so the matching FlowCard attaches and shows step-by-step) — *2026-05-27*
- [x] **20.1.4** Frontend `ProjectView.tsx`: new `FullCheckBanner` sub-component — sticky banner at top of main panel, phase-aware (🔑 Refreshing prerequisites → 🔗 Checking URLs + running flows → 📋 Running flow X of Y: "Login" → ✓ Full check complete) with inline spinner — *2026-05-27*
- [x] **20.1.5** Frontend `ProjectView.tsx`: `FlowsSectionPanel` threads `orchestratorFlowRunId` to the matching `FlowCard` (matched by flowId) — when null, no card is attached; when set, exactly one card shows live step-by-step progress — *2026-05-27*
- [x] **20.1.6** Frontend `App.tsx`: removed `handleCheckEntireProject` + `busyFullCheck` state + `checkEntireProject` import (the single-shot backend call is no longer used by the button); ProjectView now receives `onAfterFullCheck` (refresh hook) + `onToast` (for the completion summary toast) — *2026-05-27*
- [x] **20.1.7** Frontend `styles.css`: new `.full-check-banner` (sticky top, blue→violet gradient backdrop, 6px blur, fade-in keyframes, lifted shadow) + `.full-check-banner-icon` / `-body` / `-label` / `-detail` — *2026-05-27*
- [x] **20.1.8** Backend `POST /api/projects/:id/check-all` kept intact for non-interactive callers (scripts/cron) but no longer the UI's path — the UI now drives the same work through visible per-phase async endpoints — *2026-05-27*
- [x] **20.1.9** Build clean: `npx tsc -b` (backend) + `npx tsc -b && npx vite build` (frontend) — zero warnings; bundle 339KB JS / 64KB CSS (gzip 100KB / 11KB) — *2026-05-27*

## Phase 1.19.1 — Resolved URL per iteration row ✅ Complete

- [x] **19.1.1** Backend `types.ts`: new `StepResult.resolvedUrl: string | null` (the URL actually fetched after `{{var}}` substitution; NULL for skipped/sentinel rows) — *2026-05-25*
- [x] **19.1.2** Backend `db.ts`: idempotent `ensureColumn` migration for `resolved_url TEXT` on both `step_results` and `prereq_step_results` — *2026-05-25*
- [x] **19.1.3** Backend `store.ts`: row interfaces extended; `rowToStepResult` + `rowToPrereqStepResult` map the new column; `recordStepResult` + `recordPrereqStepResult` accept + persist `resolvedUrl` (25-col / 21-col INSERTs) — *2026-05-25*
- [x] **19.1.4** Backend `flowRunner.ts`: success-path `recordStepResult` calls (per-iteration in `runForEachBlock` + non-iter in `executeRun`) pass `resolvedUrl: resolved.url`; sentinel paths intentionally leave it null — *2026-05-25*
- [x] **19.1.5** Backend `prereqRunner.ts`: success-path `recordPrereqStepResult` passes `resolvedUrl: resolved.url`; cache-skip + upstream-failed sentinels leave it null — *2026-05-25*
- [x] **19.1.6** Frontend `types.ts`: mirror — `StepResult.resolvedUrl: string \| null` — *2026-05-25*
- [x] **19.1.7** Frontend `FlowCard.tsx` `IterNodeView`: render `ownRow.resolvedUrl` as a monospace truncated line under the iteration breadcrumb (with full URL on hover) when present — *2026-05-25*
- [x] **19.1.8** Frontend `styles.css`: new `.step-iter-node > .iter-url` (monospace, muted, ellipsis-truncate, 28px left-pad to align under the breadcrumb status row) — *2026-05-25*
- [x] **19.1.9** Build clean (backend + frontend tsc + vite); depth-2 demo re-run end-to-end confirms 17/17 rows now carry the resolved URL (e.g. `/student/std-3/subject/sub-3-english`) — *2026-05-25*

## Phase 1.18.2 — Production-grade drag-and-drop (dnd-kit) ✅ Complete

- [x] **18.2.1** Added `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` dependencies — *2026-05-25*
- [x] **18.2.2** New `StepDragHandle.tsx` with `GripIcon` (SVG 2×3 dot grid) + `StepDragPreview` (floating overlay content shared by FlowCard + PrereqsPanel) — *2026-05-25*
- [x] **18.2.3** `FlowCard.tsx`: `SortedStepList` wraps step list in `<DndContext>` + `<SortableContext verticalListSortingStrategy>` + `<DragOverlay>` (with 220ms cubic-bezier drop animation). `StepRow` uses `useSortable({ id })`; row gets `setNodeRef` + `transform` + `transition`; grip button gets `attributes` + `listeners` — *2026-05-25*
- [x] **18.2.4** `PrereqsPanel.tsx`: mirrored — `SortedPrereqStepList` + `PrereqStepRow.useSortable` — *2026-05-25*
- [x] **18.2.5** Sensors: `PointerSensor` with `activationConstraint: { distance: 8 }` so a regular click on the row still opens the editor; `KeyboardSensor` with `sortableKeyboardCoordinates` enables full a11y (Tab → grip, Space to grab, ↑/↓ to move, Space to drop, Esc to cancel) — *2026-05-25*
- [x] **18.2.6** Drop handler uses dnd-kit `arrayMove(sorted, fromIdx, toIdx)` for index math; optimistic UI swap + rollback on `reorderFlowSteps` / `reorderPrereqSteps` failure — *2026-05-25*
- [x] **18.2.7** `styles.css`: new `.step-grip` (focusable button w/ focus-ring + `touch-action:none`), `.step-dragging` (source row 35% opacity), `.step-sorting` (cursor reset), `.step-drag-preview` (lifted shadow + 1.02 scale + −0.4° tilt + accent border + 2px backdrop blur) — *2026-05-25*
- [x] **18.2.8** Removed `.step-drop-above/below` pseudo-element insertion lines (dnd-kit's smooth slide-out-of-the-way animation makes the drop position obvious without a separate indicator) — *2026-05-25*
- [x] **18.2.9** Build clean: tsc + vite build zero warnings; bundle 327KB JS / 59KB CSS (gzip 96KB / 11KB) — *2026-05-25*

## Phase 1.18.1 — Drag-and-drop step reorder (replaces ▲/▼ arrows) ✅ Complete

- [x] **18.1.1** Frontend `FlowCard.tsx`: parent-level DnD state (`dragSourceIdx` / `dragOverIdx` / `dragOverPos`) + `handleDropReorder(fromIdx, toIdx)` (splice + `insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx` offset math) with optimistic UI swap + rollback on API failure — *2026-05-25*
- [x] **18.1.2** Frontend `FlowCard.tsx` StepRow: replaced `.step-reorder` ▲/▼ buttons with `.step-grip` (grip dots + position number). Only the grip is `draggable`; the rest of the row is the click-to-edit target + drop zone. Row-level `onDragOver` computes above/below by cursor Y vs row midpoint — *2026-05-25*
- [x] **18.1.3** Frontend `PrereqsPanel.tsx`: mirrored the same DnD treatment — `handleDropReorder` + `PrereqStepRow` grip + row drop handlers — *2026-05-25*
- [x] **18.1.4** Frontend `styles.css`: removed `.step-reorder*` blocks; added `.step-grip` (cursor grab → grabbing, fades to `not-allowed` while running), `.step-dragging` (opacity 0.4 on source row), `.step-drop-above` / `.step-drop-below` (2px accent insertion line via `::before` / `::after` so layout doesn't shift) — *2026-05-25*
- [x] **18.1.5** Drop indicator suppresses no-op hovers: if dragging row N hovers row N's own above-line or row N-1's below-line, the line doesn't render (since the drop would be identity) — *2026-05-25*
- [x] **18.1.6** Smoke test: `POST /api/flows/:id/steps/reorder` with swapped order against the for-each demo flow on Default project; verified order flipped + restored cleanly — *2026-05-25*
- [x] **18.1.7** Build clean: `npx tsc -b && npx vite build` zero warnings — *2026-05-25*

## Phase 1.18 — For-each step (dynamic-fleet iteration) ✅ Complete

- [x] **18.1** Backend `types.ts`: new `ForEachConfig` interface + `forEach?: ForEachConfig | null` on `FlowStep` — *2026-05-22*
- [x] **18.2** Backend `types.ts`: `iterationIndex` + `iterationCount` on `StepResult`; `forEachIteration` + `forEachTotal` on `LiveStepProgress` — *2026-05-22*
- [x] **18.3** Backend `extraction.ts`: `jsonPath()` learns `[*]` wildcard (recursive flatten); `ExtractedValue.value` widened to `string \| unknown[]` — *2026-05-22*
- [x] **18.4** Backend `extraction.ts`: `substitute()` learns dotted-path lookup (`{{student.id}}` walks object-typed vars) — *2026-05-22*
- [x] **18.5** Backend `db.ts`: idempotent migrations — `for_each_config_json` on flow_steps, `iteration_index` + `iteration_count` on step_results — *2026-05-22*
- [x] **18.6** Backend `store.ts`: `normalizeForEach` (identifier validation) + `assertSingleForEach` (single-level guard) + serialize/parse in add/update/copy/move — *2026-05-22*
- [x] **18.7** Backend `store.ts`: `recordStepResult` writes `iterationIndex` + `iterationCount`; `rowToFlowStep` + `rowToStepResult` parse them back — *2026-05-22*
- [x] **18.8** Backend `flowRunner.ts`: iteration fork — resolves array var, caps at 100, loops once per element with `{ ...vars, [itemVarName]: item }`, records per-iteration row, never stops the flow on iteration failure — *2026-05-22*
- [x] **18.9** Backend `flowRunner.ts`: LiveStepProgress publishes `forEachIteration` / `forEachTotal` between iterations — *2026-05-22*
- [x] **18.10** Backend `flowRunner.ts` + `assertions.ts` + `prereqRunner.ts`: widen `vars` map from `Record<string,string>` to `Record<string,unknown>` (with stringify on persistence) — *2026-05-22*
- [x] **18.11** Frontend `types.ts`: mirror backend (`ForEachConfig`, `FlowStep.forEach`, `StepResult.iteration*`, `LiveStepProgress.forEach*`) — *2026-05-22*
- [x] **18.12** Frontend `flowForms.tsx`: new **For each** tab with dropdown of array-typed vars (auto-derived from earlier-step extractions whose JSONPath has `[*]`) + item-name input + Disable button + single-level warning banner — *2026-05-22*
- [x] **18.13** Frontend `FlowCard.tsx`: `⟳ for each {{item}}` pill in the step header next to the method tag — *2026-05-22*
- [x] **18.14** Frontend `FlowCard.tsx`: result row replaces latency chip with `(N) ✓ X / ✗ Y` summary chip when iterating; chevron toggles a vertical scrollable iterations panel (per-row status + latency + error reason + retry count) — *2026-05-22*
- [x] **18.15** Frontend `FlowCard.tsx`: live progress label gets `— iteration X of N` suffix when `liveStep.forEachTotal` is set — *2026-05-22*
- [x] **18.16** Frontend `varRefs.ts`: regex widened to recognise `{{name.dotted.path}}` (captures root); `checkStepVarRefs` adds the step's own `forEach.itemVarName` to the known set so loop-locals don't false-warn — *2026-05-22*
- [x] **18.17** Frontend `styles.css`: `.step-foreach-pill` (indigo), `.step-iterations-summary` (green/red w/ chevron), `.step-iterations-panel` + `.step-iterations-row` (scrollable list), `.step-foreach-warning` (yellow banner) — *2026-05-22*
- [x] **18.18** Build clean: `npx tsc -b` on backend + `npx tsc -b && npx vite build` on frontend — *2026-05-22*

## Phase 1.17 — Step orchestration (reorder + move/copy) ✅ Complete

- [x] **17.1** Backend: `copyFlowStepToFlow` + `moveFlowStepToFlow` store fns — transactional, shift target positions +1, insert at pos=1, rebalance source on move — *2026-05-22*
- [x] **17.2** Backend: `POST /api/steps/:id/copy-to-flow` + `/move-to-flow` routes; 400 on missing step / same flow / missing target — *2026-05-22*
- [x] **17.3** Frontend: `reorderPrereqSteps`, `copyStepToFlow`, `moveStepToFlow` API wrappers — *2026-05-22*
- [x] **17.4** Frontend: `utils/varRefs.ts` — `findVarRefs` + `checkStepVarRefs` (scans url + body + headers + query for `{{name}}` against project pool + earlier extractions) — *2026-05-22*
- [x] **17.5** Frontend: ▲/▼ micro-stack column on every step row (FlowCard + PrereqsPanel); first/last disabled; optimistic swap, disabled while running — *2026-05-22*
- [x] **17.6** Frontend: hover-revealed `↗ Move` and `📋 Copy` buttons on Flow step rows (not on prereqs); opens `MoveCopyStepModal` — *2026-05-22*
- [x] **17.7** Frontend: `MoveCopyStepModal` — lists other flows in the project, empty-state when none, confirm-row with `Move →`/`Copy →` — *2026-05-22*
- [x] **17.8** Frontend: `⚠ missing: {{var}}` warn chip on rows with broken var refs (non-blocking — runtime still attempts and surfaces the real error) — *2026-05-22*
- [x] **17.9** Smoke test: copy + move + reorder routes verified via curl on Default project (positions rebalanced correctly on both sides) — *2026-05-22*
- [x] **17.10** Fix: target Flow now auto-refreshes after Move/Copy — ProjectView passes `refreshTick + flowsTick` to FlowsSectionPanel so the receiving card pulls fresh `detail` instead of waiting for a manual reload — *2026-05-22*
- [x] **17.11** Fix: `deleteFlowStep` + `deletePrereqStep` now rebalance positions inside a `tx()` — gaps from 1,2,3 → 1,2 instead of 1,3 after deleting position 2 — *2026-05-22*
- [x] **17.12** Scroll position survives page reload — mirrored to `localStorage` under `fm:scroll:<projectId>` on project-switch + `beforeunload` + `pagehide` + `visibilitychange`; one-shot useLayoutEffect on first snapshot restores via double-rAF after layout commits — *2026-05-22*
- [x] **17.13** Per-project section memory: switching back to a project now restores the last-viewed tab (`#urls` vs `#flows`) instead of forcing `#urls`. Mirrored to `localStorage` under `fm:section:<projectId>` on project-switch + page-hide — *2026-05-22*

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

### 2026-05-25 — Phase 1.18.2 Production-grade drag-and-drop with dnd-kit (9 items)
- **Why:** the 1.18.1 hand-rolled HTML5 DnD worked but felt basic — "more advanced, production-level, extreme UX" was the ask. Swapped to **dnd-kit**, the modern React DnD library (Linear, Notion, Vercel all use it). Same `reorderFlowSteps` / `reorderPrereqSteps` backend API — just a richer client.
- **What's new in the UX:** as you drag a step, every other step in the list smoothly slides out of the way to make room (transform-based, hardware-accelerated). The dragged row dims to 35% opacity in place, and a floating *drag preview* lifts above the page following the cursor exactly — with a soft shadow, a 1.02 scale, a subtle −0.4° tilt, and a backdrop blur. On drop, the preview animates into its new slot over 220ms with an ease-out curve, then the real row fades back to 100%. No more "blue line above/below" — the layout itself shows you where the step will land.
- **Accessibility built in:** Tab focuses the grip (highlighted with an accent focus-ring), Space picks up the step, ↑/↓ moves it one slot at a time with the same smooth animation, Space drops it, Escape cancels. Touch works too — `touch-action: none` on the grip lets mobile users drag without fighting page scroll.
- **Click vs drag disambiguation:** `PointerSensor` with `activationConstraint: { distance: 8 }` means a regular click on the grip (or anywhere on the row) still opens the step editor — the drag only starts after 8px of movement. This is the production pattern: no false drags from a slightly twitchy click.
- **Shared visuals:** new `StepDragHandle.tsx` module exports `GripIcon` (SVG 2×3 dot grid, scales crisply at any DPR) and `StepDragPreview` (the floating overlay's content) so FlowCard and PrereqsPanel render identical DnD without duplicating JSX.
- **Same backend:** optimistic UI swap then POST to the existing `/steps/reorder` route; rolls back on failure. Bundle cost: +52KB raw / +17KB gzip, all in the dnd-kit library — no custom physics code to maintain.

### 2026-05-25 — Phase 1.18.1 Drag-and-drop step reorder (7 items)
- **Why:** manager reversed the Phase 1.17 ▲/▼ arrow decision and asked for "drag and drop, convenient, easy, smooth UX within the flow". Arrows worked but felt clumsy at >3 steps — DnD lets the user jump position 7 → position 1 in one gesture instead of six clicks.
- **Implementation:** native HTML5 DnD (no extra dep). Only the leftmost `.step-grip` (grip dots + position number) is `draggable`; the rest of the row is the click-to-edit target + drop zone. Row-level `onDragOver` splits the row at its vertical midpoint to compute "above" vs "below" insertion. A 2px accent line drawn via `::before` / `::after` shows where the dragged step will land — and is suppressed for no-op hovers (dragging row N onto its own boundary). Drop applies an optimistic order swap then `POST /flows/:id/steps/reorder`, rolling back on failure.
- **Mirrored across both panels:** same DnD code path in `FlowCard.tsx` and `PrereqsPanel.tsx`, sharing identical CSS classes (`.step-grip`, `.step-dragging`, `.step-drop-above/below`). Disabled during `running` so no reordering mid-run.
- **CSS cleanup:** removed `.step-reorder`, `.step-reorder-up`, `.step-reorder-down` blocks entirely (no longer used).
- Smoke-tested against the live backend on the for-each demo flow; reorder API confirmed working with swapped step IDs.

### 2026-05-22 — Phase 1.18 For-each iteration (18 items)
- **Why it matters for a monitoring tool:** a flow can now monitor a *dynamic fleet*. A single step `GET /students/{{student.id}}/grades` runs once per element of an array captured by an earlier step. When a new student is added to the DB tomorrow, that student is automatically included — no flow edit required. And when student #37 breaks, the result is `(50) ✓ 49 / ✗ 1` with a chevron-expandable per-iteration breakdown instead of one opaque 500.
- **Backend:** new `for_each_config_json` column on `flow_steps` + new `iteration_index` / `iteration_count` columns on `step_results` (idempotent `ensureColumn` migrations). `jsonPath()` learns the `[*]` wildcard so an extraction like `$.data[*]` returns the whole array (kept in-memory as a JS array, JSON-stringified when persisted to `flow_runs.variables_json` / `variable_cache`). `substitute()` learns dotted-path lookup so `{{student.id}}` walks an object-typed loop variable.
- **Runner fork:** flowRunner branches after substitution — if the step has `forEach`, resolves the array var, hard-caps at 100, and loops once per element with a per-iteration `{ ...vars, [itemVarName]: item }` map. Each iteration is its own `step_results` row (with `iteration_index` 0..N-1 and `iteration_count = N` on every row). Iteration failures never stop the flow — overall step `ok` is the AND of `statusOk + assertions + at-least-one-iter-passed` but the flow still progresses (`stopOnFailure` semantics applied at the step level, not the iteration level).
- **Guardrails:** server-side single-level guard — `assertSingleForEach` rejects a 2nd for-each in the same flow with a 400. Identifier validation on both `arrayVarName` + `itemVarName`. Empty source array writes a single sentinel `skipped=true` row so the UI shows "for-each over empty array" instead of a silent gap. Missing/non-array variable writes one failed row with reason `forEach: variable 'x' is not an array` — does not crash the flow.
- **Frontend editor:** new **For each** tab in the step editor (between Extract and Retry). Dropdown auto-derives candidates from earlier steps' extractions that use `[*]` in the JSONPath. Yellow banner when another step already has for-each enabled (single-level enforced both client-side + server-side). One-click Disable button.
- **Frontend results:** `⟳ for each {{student}}` indigo pill in the step header. When iterating, the result row replaces the single latency chip with a `(50) ✓ 47 / ✗ 3` summary chip that toggles a vertical scrollable panel of per-iteration rows (#1 ✓ 200 134ms, #2 ✗ 404 …). `⚠ truncated to 100` chip surfaces when the source array had more than 100 elements.
- **Frontend progress:** live mid-flight label gets `— iteration X of N` suffix while iterating. `varRefs.ts` regex now matches dotted refs and treats the loop-local `itemVarName` as known, so `{{student.id}}` doesn't trigger a false-warning chip.
- **What's NOT in v1 (intentional):** nested for-each (single-level guard); static array / CSV-upload source (array must come from a prior step's response); user-configurable cap (hardcoded 100); parallel iterations (all serial for cleaner error attribution); extracting variables OUT of iterations (results are terminal — they're persisted and rendered but don't feed the global `variables` map).

### 2026-05-22 — Step orchestration follow-ups (3 fixes)
- **Move/Copy target auto-refreshes**: receiving FlowCard now pulls fresh `detail` immediately instead of needing a manual reload. ProjectView combines its `flowsTick` into the `refreshTick` passed to each FlowCard, so any flow-list mutation also re-fetches every card's step list.
- **Delete now closes position gaps**: `deleteFlowStep` and `deletePrereqStep` were leaving sparse positions (deleting pos=2 left 1,3). Both now do `DELETE` + `UPDATE … SET position = position - 1 WHERE position > deleted` inside a `tx()`. The UI's optimistic reorder math always worked, but DB state could drift after a delete.
- **Scroll survives page reload**: per-project scroll position is mirrored to `localStorage` (`fm:scroll:<projectId>`) on project-switch, `beforeunload`, `pagehide`, and `visibilitychange=hidden`. A one-shot `useLayoutEffect` on the first snapshot (gated by `initialRestoreDone` ref) restores via double-`requestAnimationFrame` so the saved Y is applied after the ProjectView's lazy children have expanded.
- **Section survives project switch**: was always resetting to `#urls` on every sidebar click; now `selectProject` saves the outgoing project's hash and restores the incoming project's last-seen hash (defaulting to `#urls` for first-visit projects). Mirrored to `localStorage` under `fm:section:<projectId>` on project-switch + page-hide so a reload also lands on the right tab.

### 2026-05-22 — Step orchestration: reorder + move/copy between flows (9 items)
- Steps inside any Flow or the Prereqs chain can now be **reordered** with tiny ▲/▼ buttons in the left margin (first/last disabled, all disabled mid-run, optimistic UI). Reuses the existing `reorderFlowSteps` / new `reorderPrereqSteps` endpoints.
- Hover-revealed `↗ Move` and `📋 Copy` buttons on every Flow step (not on prereqs). Both open a new `MoveCopyStepModal` that lists the other flows in the project (with status + interval), plus an empty-state row when this is the only flow. **Move** removes the step from the source flow + inserts at position 1 of the target (single transaction, both sides rebalanced). **Copy** inserts a duplicate at position 1 of the target and leaves the source intact.
- New backend store fns `copyFlowStepToFlow` / `moveFlowStepToFlow` (both inside one `tx()`) and 2 new routes `POST /api/steps/:id/{copy,move}-to-flow`. 400 on missing step, same-flow target, or missing target.
- New `utils/varRefs.ts` helper scans every step's url + body + customHeaders + queryParams for `{{name}}` tokens and reports any that aren't extracted by an earlier step in the chain and aren't in the project's prereq pool. Reordering or moving a step that now references an unknown var shows a non-blocking `⚠ missing: {{token}}` chip on the row — the user gets a heads-up but isn't blocked from running.
- Smoke-tested via curl: copy on Default project's 2-step "Smoke test flow" + 3-step "Session-bound API Flow", move back, position rebalancing verified on both sides. All edge cases (same flow, missing step, missing target) return 400 with the right message.

### 2026-05-22 — Prereq progress UI continuity (1 item)
- FlowCard's "Run now" now lifts its prereq `runId` up to ProjectView, which passes it to `PrereqsPanel` as `externalRunId`. The panel attaches via a new effect (re-using `handleRun` with the lifted id instead of starting a fresh chain), auto-expands, and shows the same complete progress bar + step-by-step rows that appear when the user clicks the panel's own "Run now". FlowCard keeps its inline banner for in-context feedback.

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
