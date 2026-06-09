# Status — AI-Powered Functional Monitoring Suite

> 1-pager snapshot of where the project is **right now**. Updated after every shipped phase. For the stable map of the system see [ARCHITECTURE.md](ARCHITECTURE.md); for the full history see [PROGRESS.md](PROGRESS.md).

**Last updated:** 2026-06-09
**Owner:** Deepesh P · **Company:** Logitech
**Branch:** `main` (GitHub) · `main` *(GitLab default is `master` — needs settings access to switch)*

---

## Current phase

**Phase 1.26.1 — Import-from-Swagger UI/UX polish** ✅ Shipped 2026-06-08

The OpenAPI import modal was functional after Phase 1.26 but visually rough (raw HTML checkboxes, hardcoded hex colors, untreated tables). 1.26.1 rebuilt it on the design system: real iOS-style toggles, stacked auth-scheme cards with 3 state variants (matched / unsupported / new), proper per-section selection counts, sticky `.modal-actions` footer, and `.method-tag` / `.pill` re-use instead of bespoke badges. ~190 lines of CSS, no backend changes.

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

1. **"Reason: Unknown failure" in notifications when a 200 response fails an assertion.** [monitor.ts:78](../backend/src/monitor.ts#L78) only populates `errorReason` for 4xx/5xx/error — assertion failures on a 2xx status leave it `null`, and the email template falls back to the literal string "Unknown failure". *(Identified 2026-06-09, not yet patched.)*
2. **Repeat alerts when assertions keep failing on a 200 response.** `wasFailing` is computed from `statusGroup` alone, which stays `"2xx"` across ticks even when `ok` is `false` — so the OK→FAIL gate doesn't deduplicate. *(Identified 2026-06-09, not yet patched. Fix is in the same file as #1.)*
3. **GitLab default branch is `master`, current pushes land on `main`.** Needs a settings tweak from the manager (or a one-shot rename) before the GitLab mirror is useful.
4. **No SMTP creds in production / shared dev** — `.env` is local-only. Each contributor follows the kid-friendly guide in [backend/.env.example](../backend/.env.example) (Gmail App Password path takes ~5 min).

## Next up (in order)

1. Fix the two notification bugs above — small ~4-line change in [monitor.ts](../backend/src/monitor.ts); also patches the silent re-fire spam.
2. Demo the Swagger import flow end-to-end with a manager-supplied spec URL (Petstore and Stripe specs already smoke-tested locally).
3. Schedule Phase 2 AI kick-off meeting with manager.

## Where things live

| You want to… | Go to |
|---|---|
| Run the apps | [README.md](../README.md) |
| Understand the system end-to-end | [ARCHITECTURE.md](ARCHITECTURE.md) |
| See every shipped task and date | [PROGRESS.md](PROGRESS.md) |
| Configure email notifications | [backend/.env.example](../backend/.env.example) |
| Track tasks day-by-day (local-only) | `documentation/project-tracker.xlsx` (gitignored) |
