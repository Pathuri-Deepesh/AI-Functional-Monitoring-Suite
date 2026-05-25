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
