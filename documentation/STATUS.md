# Status — AI-Powered Functional Monitoring Suite

> 1-pager snapshot of where the project is **right now**. Updated after every shipped phase. For the stable map of the system see [ARCHITECTURE.md](ARCHITECTURE.md); for the full history see [PROGRESS.md](PROGRESS.md).

**Last updated:** 2026-07-16
**Owner:** Deepesh P · **Company:** Logitech
**Branch:** `main` (GitHub) · `main` *(GitLab default is `master` — needs settings access to switch)*

---

## Current phase

**Phase 1.31 — Audit reports in S3 (browsable history)** ✅ Shipped 2026-07-16

Audit reports now persist as S3 objects under `reports/<projectId>/<filename>` (was local disk), so report history is browsable per project in the bucket and survives instance replacement. Mirrors the existing uploads-in-S3 pattern in [backend/src/storage.ts](../backend/src/storage.ts) (new `saveReport`/`readReport`/`listReports`/`pruneReportsS3`) — reuses the same bucket + IAM role as uploads, so **no infra/IAM change was needed**. [audit.ts](../backend/src/audit.ts) writes via `saveReport` and points `reportUrl` at a new serve route `GET /reports/:projectId/:filename` in [app.ts](../backend/src/app.ts) (replacing `express.static`); a `GET /api/projects/:projectId/reports` listing endpoint was added. Email attachments switched from reading a local path to in-memory bytes ([email.ts](../backend/src/email.ts)); the report pruner ([db.ts](../backend/src/db.ts)) is now S3-aware. Deployed via `eb deploy` and verified end-to-end on the live env: audit → object in `s3://monitor-suite-storage-dev/reports/<pid>/`, serve route returns the HTML, and the report stays openable **after a full redeploy** (proving S3 durability, not ephemeral disk). Bumped `package.json` 1.30.0 → 1.31.0. **Deferred:** automated EBS snapshots (DLM) — coded but the shared CDK exec role lacks `dlm:CreateLifecyclePolicy` and we chose not to modify that shared role; backed out cleanly (see tracker 31.5).

**Phase 1.30 — CDK infrastructure-as-code + Elastic Beanstalk (dev DEPLOYED & LIVE)** ✅ Shipped 2026-07-15

**Live (office-IP only):** http://184.72.231.124 · env `monitor-suite-env-dev` · **AWS account:** Logitech CPG Dev (443555584785) · **Region:** us-east-1 · **Health:** Green

Manager asked to move the manual EC2 deploy to AWS CDK (infrastructure-as-code) + Elastic Beanstalk across three environments. New [infrastructure/](../infrastructure) directory (separate CDK TypeScript project) defines one parameterized stack — [lib/monitor-suite-stack.ts](../infrastructure/lib/monitor-suite-stack.ts) — instantiated for `dev`/`staging`/`prod` from [bin/app.ts](../infrastructure/bin/app.ts) via [lib/config.ts](../infrastructure/lib/config.ts). Per-environment resources: S3 bucket, Secrets Manager secret, IAM **Role** (upgrade from the live setup's long-lived IAM user — no static keys on the instance), an office-IP-locked security group, a persistent EBS volume, and an Elastic Beanstalk single-instance environment. **`dev` is now fully deployed and healthy.** App code deployed via the **EB CLI** (`eb init`/`eb use`/`eb deploy` against the CDK-created app — never `eb create`).

Key things proven end-to-end on the live environment:
- **Runs the real app** (React UI + Express API), not the EB placeholder.
- **Private / company-only:** EB's default public security group disabled (`DisableDefaultEC2SecurityGroup=true`); the instance uses only `monitor-suite-sg-dev`, with ports 22/80/4000 restricted to the office CIDR `14.97.45.226/32` — no `0.0.0.0/0` anywhere.
- **Data persists:** the app writes SQLite to cwd-relative `./data`; AL2023 `.platform/hooks/` (prebuild installs backend deps incl. `tsx`; predeploy attaches+mounts the EBS volume at `/app/data` via IMDSv2 + NVMe device discovery; postdeploy symlinks `backend/data → /app/data` and restarts). **Verified the DB survives both a redeploy and a full instance replacement.**
- **Single-AZ pinning:** the env is pinned to one subnet in the volume's AZ (`us-east-1a`) — an EBS volume can only attach to an instance in its own AZ, so this prevents `InvalidVolume.ZoneMismatch` on instance replacement.

Additive only — does **not** touch the currently-live manual EC2/S3/IAM from Phase 1.28.1/1.29; this is a parallel `-dev` stack. `staging`/`prod` remain ready-but-undeployed identical-config code. Deploy-time issues found and fixed in code (non-ASCII descriptions, stale EB platform version, missing VPC/subnet options, us-east-1e/t3.small AZ gap, IAM `DescribeVolumes` needing `Resource:*`, data-dir symlink path, AZ pinning) are tracked in `project-tracker.csv` rows 30.6–30.12. **Deferred:** `SES_FROM_EMAIL` (no verified SES sender yet — email alerts inactive until set). **Teardown/cost control:** `cdk destroy MonitorSuite-dev`. See [infrastructure/README.md](../infrastructure/README.md).

**Phase 1.29 — S3 storage for uploaded files** ✅ Shipped 2026-07-09

New [backend/src/storage.ts](../backend/src/storage.ts) wraps `@aws-sdk/client-s3` with `saveUpload` / `readUpload` / `uploadExists` / `deleteUploadFile` — S3-backed when `S3_BUCKET_NAME` is set, local-disk fallback otherwise (dev laptops unaffected). Scoped to uploads only — reports stay on local disk since email delivery attaches them by local path and they're cheap to regenerate every audit run. 3 upload routes in `app.ts` swapped over. User created the S3 bucket (`monitor-suite-storage-deepesh-2026`, all-public-access blocked, versioning on, SSE-S3) and extended `monitor-app-user`'s IAM policy with a scoped `S3StorageAccess` statement. Deployed to EC2 (pull, build, `S3_BUCKET_NAME` added to `.env`, restart) and verified end-to-end — user uploaded a real image through the prod UI and confirmed it both in the S3 console and via the app's own Uploads list. Bonus fix in the same session: `runAuditAndDeliver` was hardcoding `http://localhost:4000` as the report base URL regardless of actual host, breaking every Snapshot & Report link on EC2 — fixed by deriving the base URL from the incoming request. Bumped `package.json` 1.28.1 → 1.29.0.

**Phase 1.28.1 — EC2 production deploy (Path B — app is LIVE)** ✅ Shipped 2026-07-08

**Live at:** http://18.215.189.244:4000 · **AWS account:** Logitech CPG Dev (443555584785) · **Region:** us-east-1

Full end-to-end deploy in one session. Launched EC2 t3.small `monitor-suite-prod` in us-east-1b with Ubuntu 26.04 + 20 GB gp3 EBS. `monitor-suite-sg` opens SSH from my IP + TCP 4000 from 0.0.0.0/0 (infra team will lock down). Cloned repo into `/app`, ran `install:all` + `build`. `scp`'d `.env` up with AWS creds. Wrote systemd unit — service auto-restarts on crash and on boot. Hit two live boot issues and fixed both: (a) Node 20 lacks `node:sqlite` → upgraded to Node 22, (b) app defaulted to loopback → set `BACKEND_HOST=0.0.0.0`. Uploaded full local SQLite (298 MB) so prod has all projects + history. Took snapshot `initial-deploy-2026-07-08` as rollback. Wrote [HANDOFF-README.md](HANDOFF-README.md) with the 3 remaining infra-team TODOs (subdomain, HTTPS, tighten SG). Path B means S3 for uploads is still on EBS for now — Phase 1.29 will move them.

**Phase 1.28 — Secrets Manager write-through vault** ✅ Shipped 2026-07-08

First half of the deployment plan committed. New module [backend/src/secrets.ts](../backend/src/secrets.ts) wraps `@aws-sdk/client-secrets-manager` — boot-time fetch hydrates a RAM cache, and `POST /api/projects/:id/keys` + `DELETE /api/projects/:projectId/keys/:keyId` in [backend/src/app.ts](../backend/src/app.ts) now write-through so every add/delete pushes to both SQLite AND the AWS secret. Nested JSON shape `{_meta, <projectId>: {<keyId>: {…}}}` preserves the multi-key-per-project model. SQLite stays the read source; Secrets Manager is a durable off-box mirror for disaster recovery. Env-var gated by `PROJECT_KEYS_SECRET_ARN` — dev laptops without AWS creds continue to work. IAM user `monitor-app-user` provisioned in Logitech CPG Dev account with a scoped inline policy (3 actions on 1 resource). End-to-end verified: user added and removed keys through the UI, watched them appear and disappear in the AWS console. Existing keys backfilled via Plan B (user manually re-added through the UI so SQLite + AWS are in sync). Full click-by-click guide saved at [SECRETS-MANAGER-IMPLEMENTATION.md](SECRETS-MANAGER-IMPLEMENTATION.md) for the next AWS account (e.g. prod).

**Phase 1.27.14 — Deployment plan rewrite (final AWS architecture)** ✅ Shipped 2026-07-06

[DEPLOYMENT-PLAN.md](DEPLOYMENT-PLAN.md) rewritten from scratch to reflect the 7-service architecture the infra team asked for: **EC2 t3.small + EBS 20 GB (SQLite + OS + code) + S3 bucket (uploads + reports) + Secrets Manager (one shared API key) + SES + IAM user + systemd** — ~$18/month. Adds S3 and Secrets Manager (both previously rejected), drops the Phase 1.28 KMS envelope-encryption plan (no longer needed since we're on one shared key instead of per-project user vaults). Doc has 13 sections including a **storage matrix** that pins every kind of data to exactly one home and an explicit "why EBS AND S3 both exist" explainer (SQLite cannot run on S3 — no fsync/locks/random writes; EC2 needs an EBS boot volume anyway). Deploy sequenced into 7 sub-phases (~4 hours end to end). Two additive code changes documented but non-blocking for Phase 1 deploy: `backend/src/storage.ts` (~1 day) wrapping `@aws-sdk/client-s3`, `backend/src/secrets.ts` (~2 hours) wrapping `@aws-sdk/client-secrets-manager`. Operational runbook covers restart, rotate, roll back, and S3-version-restore; risks + mitigations table documents blast-radius reasoning for each service. Self-sufficient handoff doc — no external context needed.

**Phase 1.27.13 — Dual-channel Slack (General + Latency)** ✅ Shipped 2026-06-26

Slack now mirrors the email model from Phase 1.27.2: one **General** webhook for non-latency failures (4xx, 5xx, network, body/status assertions) and a separate **Latency** webhook for failures caused solely by `latency-under` assertions. Empty Latency webhook falls back to General (same semantics email already uses). One new `latency_slack_webhook_url` column added via the existing `ensureColumn` migration pattern; one new `pickSlackWebhook(project, category)` helper in [email.ts](../backend/src/email.ts) next to `pickRecipients` (channel-agnostic — both helpers consume the existing `classifyFailure` output). Three send-points swapped to the helper: URL failure ([monitor.ts:162-170](../backend/src/monitor.ts#L162-L170)), flow failure ([flowRunner.ts:842-848](../backend/src/flowRunner.ts#L842-L848)), and `sendFlowFailureAlert` in [slack.ts](../backend/src/slack.ts) refactored to take an explicit `webhookUrl` arg matching `sendSlackAlert`'s shape. Audit/snapshot Slack untouched — full-project summary has no failure category to route on, stays on the General webhook (matches the email audit behaviour). Frontend Notifications panel rebuilt: the old "Slack URL up top, dropdown for emails below" layout replaced with **pill tabs at the top** (General / Latency, each showing live counts like *"slack on · 3 emails"* or *"slack → general · emails → general"*); picking a pill swaps BOTH the Slack input AND the email textarea below. Save round-trip verifies both the latency-emails and the new latency-slack column came back unchanged so the user gets a clear error instead of a silently-dropped field when a stale backend predates the migration. Bumped `package.json` 1.27.12 → 1.27.13.

**Phase 1.27.12 — API Keys list duplicate-render fix** ✅ Shipped 2026-06-24

User reported existing API keys visually doubling on the API Keys settings panel right after adding a new key — refresh cleared the duplication. Root cause: in [`ApiKeyManagerForm`](../frontend/src/components/forms.tsx), `add()` bumped `keysVersion` synchronously before `await props.onDone(...)` resolved, and `keysVersion` was the `key={...}` on BOTH the existing-keys list and the form below. The form remount was intentional (defeats Chrome/Edge/Safari autofill clobbering the cleared inputs, per the comment at lines 874–885) — the list remount was an accident. Bumping the list's key forced React to remount the list while `props.project.apiKeys` was still the stale pre-add array (parent's `await refresh()` hadn't returned), so the old rows rendered in the fresh container alongside the in-flight render. Fix: removed `key={keysVersion}` from the list `<div>` only (rows are already uniquely keyed by `k.id`); kept the form's `key={keysVersion}` untouched. Rebuilt + restarted the single-server bundle; verified via `npm run build` + `npm start` — listening on http://127.0.0.1:4000. Bumped `package.json` to 1.27.12 (also captures the prior 1.27.11 SSRF-lookup + UI alignment fixes that hadn't bumped).

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

1. Take a fresh EBS snapshot now that Phase 1.29 is live (last one was `initial-deploy-2026-07-08`, pre-S3).
2. Request AWS SES production access (currently sandboxed to 200 emails/day, verified recipients only).
3. Add the manager's IP allowlist to `monitor-suite-sg` once he sends it.
4. Hand off `HANDOFF-README.md` + EC2 access to the infra team.
5. Fresh GitLab PAT with `write_repository` scope → push `main` to the GitLab mirror.
6. Schedule Phase 2 AI kick-off meeting with manager.

## Where things live

| You want to… | Go to |
|---|---|
| Run the apps | [README.md](../README.md) |
| Understand the system end-to-end | [ARCHITECTURE.md](ARCHITECTURE.md) |
| See every shipped task and date | [PROGRESS.md](PROGRESS.md) |
| Configure email notifications | [backend/.env.example](../backend/.env.example) |
| Track tasks day-by-day (local-only) | `project-tracker.xlsx` at repo root (gitignored) |
