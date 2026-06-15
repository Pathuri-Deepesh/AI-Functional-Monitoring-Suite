# Status — AI-Powered Functional Monitoring Suite

> 1-pager snapshot of where the project is **right now**. Updated after every shipped phase. For the stable map of the system see [ARCHITECTURE.md](ARCHITECTURE.md); for the full history see [PROGRESS.md](PROGRESS.md).

**Last updated:** 2026-06-15
**Owner:** Deepesh P · **Company:** Logitech
**Branch:** `main` (GitHub) · `main` *(GitLab default is `master` — needs settings access to switch)*

---

## Current phase

**Phase 1.26.4 — Snapshot & Report elegance pass** ✅ Shipped 2026-06-15

Two surfaces upgraded: (a) the HTML report attachment ([backend/src/report.ts](../backend/src/report.ts)) and (b) the **email body itself** ([backend/src/email.ts](../backend/src/email.ts)). Previously the email was thin counts only — recipient had to open the attachment to learn which endpoints failed and why. Now the inbox preview itself is actionable. Four changes in `report.ts` and two in `email.ts`, ~120 lines net, no logic/contract/schema impact: (1) hero banner under the report header — green check (all-healthy) or large red failure count with caption `"N endpoint(s) need attention out of M total monitored"`; (2) unified failures-summary table between KPIs and main tables, grouping every failing URL + flow with type/name/reason/when columns, omitted entirely when project is healthy; (3) anchor IDs on every row + "View details ↓" jump links from the summary, so clicking a failure jumps to its full row (with 5-phase latency, assertions, sparkline) below — survives Gmail's JS stripping because fragment links aren't JS; (4) **the email body now contains the same hero banner + failures table inline**, with clickable links pointing at `${reportUrl}#url-{id}` and `${reportUrl}#flow-{id}` so the manager can triage from the inbox preview without opening the attachment.

**Phase 1.26.3 — Flow notification gate fix** ✅ Shipped 2026-06-15

User pinged an inbox screenshot — 10,585 unread, same flow paging at 3:35, 3:35, 3:37, 3:39. Root cause: [backend/src/flowRunner.ts](../backend/src/flowRunner.ts) end-of-run had **no OK→FAIL gate at all**. Phase 1.26.2 patched the URL companion site in `monitor.ts` but missed the flow path. Fix mirrors the URL semantics — look up the previous run via `listFlowRuns(flow.id, 2).find(r => r.id !== runId)` and alert iff first-ever run, or genuine OK→FAIL transition, or the failure reason has changed from last time. The reason-change branch was a deliberate user ask — they didn't want a flow flipping from "step 2 timed out" to "step 5 returned 500" to be silently absorbed.

**Phase 1.26.2 — Notification correctness fixes** ✅ Shipped 2026-06-10

Two related bugs in [backend/src/monitor.ts](../backend/src/monitor.ts) closed in ~10 lines: (1) `errorReason` was `null` on a healthy 2xx response that failed an assertion, so the email/Slack template rendered the literal string "Unknown failure" — now the first failed assertion's `detail` (e.g. `"Expected 201, got 200"`) flows through; (2) `wasFailing` was derived from `statusGroup` alone, so a 2xx-with-failed-assertion stayed in the "OK" bucket every tick and the OK→FAIL gate re-fired the alert every interval — now `wasFailing` mirrors the new `ok` semantics (status + assertions), with a first-ever-check carve-out so the initial failure still notifies.

## What's shipped end-to-end and demo-ready

- **URL monitoring** — add a URL, pick an interval (1–1440 min), watch checks accrue. Status grouped 2xx/3xx/4xx/5xx/error. 5-phase latency tracking on every check.
- **API-key vault + auth injection** — per-project; supports Bearer / x-api-key / Basic / custom header + prefix.
- **Project segregation** — sidebar switcher; each project has its own URLs, flows, prereq chain, API keys, recipients, Slack webhook.
- **Flows (API chains)** — sequential steps with `{{var}}` substitution, JSONPath extraction, 4 assertion types, retries with exponential backoff, TTL-aware caching, drag-and-drop reorder (dnd-kit), move/copy steps across flows.
- **For-each iteration up to 4 nesting levels** — dynamic fleet monitoring; per-iteration result rows; 100-iteration safety cap per level.
- **Prerequisites chain** — project-level auth/setup chain that captures variables into a project pool consumed by every URL + flow in the project.
- **Activity Timeline** — unified history view with 24h / 7d / 30d / 90d / 1y / Custom time-range selector.
- **Snapshot & Report (audit)** — generates a self-contained HTML report, posts a summary to Slack, emails the HTML to recipients. Read-only by design.
- **Notifications** — Slack webhook + Email (SMTP) fire in parallel on OK→FAIL transitions for URLs and flow runs, and on every Snapshot & Report button click. Both channels are per-project opt-in.
- **OpenAPI export** — `GET /api/projects/:id/export/openapi?format=yaml|json` produces deterministic Swagger with `x-mon-*` extensions + `x-mon-flows` side-band.
- **OpenAPI import** — two-step preview → apply, atomic, granular per-item selection, auth-scheme matching against vault, polished modal UI (1.26.1).

## What's currently running on this machine

- **Backend dev server** — port 4000, `npm run dev` in `backend/`, loading `.env` for SMTP creds.
- **Frontend dev server** — port 5173, `npm run dev` in `frontend/`.
- **SQLite DB** — `backend/data/db.sqlite` (gitignored).

## Open items / known bugs

1. **GitLab default branch is `master`, current pushes land on `main`.** Needs a settings tweak from the manager (or a one-shot rename) before the GitLab mirror is useful.
2. **GitLab push still blocked on auth.** The token user created had wrong type (Feed token `glft-` instead of PAT `glpat-`). Needs a fresh PAT with `write_repository` scope before the next push to GitLab will succeed.
3. **No SMTP creds in production / shared dev** — `.env` is local-only. Each contributor follows the kid-friendly guide in [backend/.env.example](../backend/.env.example) (Gmail App Password path takes ~5 min).

## Next up (in order)

1. Demo the Swagger import flow end-to-end with a manager-supplied spec URL (Petstore and Stripe specs already smoke-tested locally).
2. Fresh GitLab PAT with `write_repository` scope → push `main` to the GitLab mirror.
3. Schedule Phase 2 AI kick-off meeting with manager.

## Where things live

| You want to… | Go to |
|---|---|
| Run the apps | [README.md](../README.md) |
| Understand the system end-to-end | [ARCHITECTURE.md](ARCHITECTURE.md) |
| See every shipped task and date | [PROGRESS.md](PROGRESS.md) |
| Configure email notifications | [backend/.env.example](../backend/.env.example) |
| Track tasks day-by-day (local-only) | `documentation/project-tracker.xlsx` (gitignored) |
