# Status — AI-Powered Functional Monitoring Suite

> 1-pager snapshot of where the project is **right now**. Updated after every shipped phase. For the stable map of the system see [ARCHITECTURE.md](ARCHITECTURE.md); for the full history see [PROGRESS.md](PROGRESS.md).

**Last updated:** 2026-06-12
**Owner:** Deepesh P · **Company:** Logitech
**Branch:** `main` (GitHub) · `main` *(GitLab default is `master` — needs settings access to switch)*

---

## Current phase

**Phase 1.27.10 — Single-server bundle + entry-file rename** ✅ Shipped 2026-06-22

Manager asked for a single-process production deployment (frontend bundled into the backend). New repo-root [package.json](../package.json) ships three scripts: `install:all`, `build` (vite build → `node scripts/copy-frontend-to-backend.mjs` → `backend/public/`), and `start` (runs the bundled backend on port 4000 serving BOTH the API and the UI from the same origin). New scripts/copy-frontend-to-backend.mjs is cross-platform (Windows/macOS/Linux) and wipes the destination before copying so removed files don't linger. Backend's [src/app.ts](../backend/src/app.ts) (renamed from `index.ts` end-to-end — `backend/package.json` scripts, `ARCHITECTURE.md`, `FUNCTIONS.md`) detects `backend/public/` on startup; mounts it via `express.static` with a smart cache-control (no-cache on `index.html`, 1-year immutable on hashed `/assets/*`) and a final SPA-fallback middleware that returns `index.html` for any non-API/non-asset GET so client-side routes survive hard refresh. `/api/*` and `/reports/*` routes always win (registered before the static block). Verified end-to-end via `curl`: `GET /` returns the SPA HTML, `GET /settings` (invented SPA route) returns the SPA HTML, `GET /assets/index-*.js` returns the real 397 KB JS bundle, `GET /assets/missing.js` cleanly 404s (no HTML for missing assets). `backend/public/` added to `.gitignore` as a build artifact. Dev workflow (two terminals with Vite HMR on 5173) is unchanged.

**Phase 1.27.9 — Security hardening pass** ✅ Shipped 2026-06-12

25 of 32 findings from the [baseline security review](security-review-2026-06-12.html) closed. Bound both servers to 127.0.0.1 by default (was the #1 LAN-exposure foot-gun); added `helmet` + `express-rate-limit`; locked CORS to the loopback frontend origin; built a real SSRF blocklist in `backend/src/timing.ts` (rejects private/loopback/link-local/cloud-metadata IPs + pins the resolved IP through the connection so DNS rebinding can't bypass it); centralized error responses through a `sendError()` helper; added a MIME allowlist + filename sanitization on uploads; new `pruneOldReports()` (30-day retention) wired into the existing hourly tick; new `safeHref()` + `rel="noopener noreferrer"` on the URL card; localStorage cleanup of stale `fm:scroll/section:*` keys; `npm audit fix` on both projects + Vite 5.4.21 → 6.4.3 (both now report 0 vulnerabilities). The post-hardening status report is at [security-status-2026-06-12.html](security-status-2026-06-12.html).

**Phase 1.27.8 — SMTP/nodemailer → AWS SES v2 migration** ✅ Shipped 2026-06-12

Manager asked for SMTP to vanish ahead of an AWS access grant landing in ~2 days. `nodemailer` (+ `@types/nodemailer`) removed from `package.json`; `@aws-sdk/client-sesv2` installed in their place. [backend/src/email.ts](../backend/src/email.ts) rewritten as a pure SES client: lazy `SESv2Client` singleton, branched `SendEmailCommand` (Simple content for the 2 per-failure emails, Raw + hand-built multipart MIME for the Snapshot/Report email which carries the HTML attachment). All 5 public exports preserved (`classifyFailure`, `pickRecipients`, `sendUrlFailureEmail`, `sendFlowFailureEmail`, `sendAuditEmail`) — zero ripple to callers in `monitor.ts` / `flowRunner.ts` / `audit.ts`. New env vars: `AWS_REGION` + `SES_FROM_EMAIL` (required), plus the standard AWS SDK credential chain for IAM keys / `~/.aws/credentials` / IAM role + optional `SES_CONFIGURATION_SET`. Old `SMTP_*` vars deleted from [backend/.env.example](../backend/.env.example) and replaced with a 7-step SES setup guide (verified identity → sandbox vs production → credential chain options → least-privilege IAM policy). Code is tsc-clean without creds; ready to flip on the moment AWS access lands.

**Phase 1.27 — Settings menu + dual-channel email + URL edit + API-key variables** ✅ Shipped 2026-06-12

Four interrelated upgrades shipped together because they touched overlapping surfaces (`forms.tsx`, Project schema, store mappers, scope-stack assembly). **(1.27.1)** Refactored the ⚙ Settings modal from a flat form into a 2-pane shell with a left menu — General · API Keys · Notifications · Appearance — and rolled the formerly-separate "Manage Keys" popup inside the API Keys panel; added a Light/Dark/System theme toggle backed by new design-token blocks in `styles.css` (`[data-theme="dark"]` + `[data-theme="light"]`) and a new [frontend/src/theme.ts](../frontend/src/theme.ts) helper that persists to `localStorage:fm:theme` and subscribes to `prefers-color-scheme` for live OS-flip. **(1.27.2)** New `projects.latency_failure_emails` column (additive); new `classifyFailure(assertions)` in [backend/src/email.ts](../backend/src/email.ts) returns `"latency"` iff every failed assertion is `latency-under`; mixed failures route to general so on-call still pages; empty latency list falls back to the general list (safety net). **(1.27.3)** Standalone URLs now have a full Edit feature mirroring flow steps — 6th "Retry / Wait" tab (Wait before ms · Max retries · Initial backoff ms); `monitor.ts` retry loop honours them with exponential backoff and skips 4xx; `UrlCard` gets an Edit button; `AddUrlForm` is now dual-purpose via an optional `url` prop. **(1.27.4)** Vault API keys are now Postman-style `{{slug}}` variables in addition to the existing auto-inject path — `slugifyKeyName` lives in [backend/src/extraction.ts](../backend/src/extraction.ts), `getProjectApiKeysScope(projectId)` in [backend/src/store.ts](../backend/src/store.ts), and all 3 runners (`monitor.ts` / `flowRunner.ts` / `prereqRunner.ts`) merge the apiKeys scope at the bottom (lowest precedence) so prereq-captured vars still override on collision. All additive: no destructive migrations, no breaking signatures, no behavioural regressions in flows/prereqs/OpenAPI round-trip.

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
- **Notifications** — Slack webhook + Email (AWS SES v2 API) fire in parallel on OK→FAIL transitions for URLs and flow runs, and on every Snapshot & Report button click. Both channels are per-project opt-in.
- **OpenAPI export** — `GET /api/projects/:id/export/openapi?format=yaml|json` produces deterministic Swagger with `x-mon-*` extensions + `x-mon-flows` side-band.
- **OpenAPI import** — two-step preview → apply, atomic, granular per-item selection, auth-scheme matching against vault, polished modal UI (1.26.1).
- **Settings 2-pane modal + Light/Dark theme** — General / API Keys / Notifications / Appearance left menu; theme persists per browser + flips live with OS pref in System mode (1.27.1).
- **Dual-channel email recipients** — per-project latency-only list routes `latency-under` assertion failures to perf owners; mixed and non-latency failures stay on the general list (1.27.2).
- **Standalone URL Edit** — same Postman-style 6-tab editor (incl. Retry / Wait) for the existing URL, with retry loop + waitBefore honored in `monitor.ts` (1.27.3).
- **Postman-style API-key variables** — every vault key is auto-exposed as `{{slugified_name}}` in any URL, body, header, or query param across this project's URLs, flows, and prereq steps — coexists with the existing auto-inject path (1.27.4).

## What's currently running on this machine

- **Backend dev server** — port 4000, `npm run dev` in `backend/`, loading `.env` for AWS SES creds (region + from + IAM keys / profile / role).
- **Frontend dev server** — port 5173, `npm run dev` in `frontend/`.
- **SQLite DB** — `backend/data/db.sqlite` (gitignored).

## Open items / known bugs

1. **GitLab default branch is `master`, current pushes land on `main`.** Needs a settings tweak from the manager (or a one-shot rename) before the GitLab mirror is useful.
2. **GitLab push still blocked on auth.** The token user created had wrong type (Feed token `glft-` instead of PAT `glpat-`). Needs a fresh PAT with `write_repository` scope before the next push to GitLab will succeed.
3. **AWS SES not yet wired in any environment** — Phase 1.27.8 swapped SMTP/nodemailer for the SES v2 SDK. Code is tsc-clean and ready; waiting on AWS access (ETA 2 days) to verify a sender identity and request production access (sandbox account would otherwise restrict sends to verified recipients only). Setup guide: [backend/.env.example](../backend/.env.example).

## Next up (in order)

1. Manual smoke of Phase 1.27 (4 sub-phases): Settings menu navigation, Light/Dark/System theme flip, dual-channel email routing (latency vs general — needs AWS SES creds + verified sender; pending Phase 1.27.8 hand-off), URL Edit with retry/wait, API-key `{{slug}}` substitution in a custom header.
2. Demo the Swagger import flow end-to-end with a manager-supplied spec URL (Petstore and Stripe specs already smoke-tested locally).
3. Fresh GitLab PAT with `write_repository` scope → push `main` to the GitLab mirror.
4. Schedule Phase 2 AI kick-off meeting with manager.

## Where things live

| You want to… | Go to |
|---|---|
| Run the apps | [README.md](../README.md) |
| Understand the system end-to-end | [ARCHITECTURE.md](ARCHITECTURE.md) |
| See every shipped task and date | [PROGRESS.md](PROGRESS.md) |
| Configure email notifications | [backend/.env.example](../backend/.env.example) |
| Track tasks day-by-day (local-only) | `project-tracker.xlsx` at repo root (gitignored) |
