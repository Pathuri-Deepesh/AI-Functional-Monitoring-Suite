# AI-Powered Functional Monitoring Suite

A self-hosted API monitoring suite that watches HTTP endpoints, chains multi-step API workflows, alerts on failures over Slack and Email, and round-trips entire projects to OpenAPI / Swagger.

> Built as a Logitech intern project by [Deepesh P](#). Currently at **Phase 1.27** — fully featured monitor + flow runner + email/Slack alerts (with dual-channel latency-vs-general routing) + OpenAPI export & import + 2-pane Settings (incl. Light/Dark theme) + full URL edit (incl. retry/wait) + Postman-style `{{api_key}}` substitution. AI layer (Phase 2) is deferred.

---

## ⚠ Security & threat model

This app is designed for **single-user, localhost (or trusted-LAN) deployment**. By default it has no authentication or per-project ownership — anyone who can reach the backend port can read / modify / delete everything.

Hardened defaults shipped in Phase 1.27.9:
- Backend + frontend dev servers bind to `127.0.0.1`. Set `BACKEND_HOST=0.0.0.0` / `VITE_HOST=0.0.0.0` only if you explicitly need LAN access.
- CORS allows only the loopback frontend origin (`http://127.0.0.1:5173`). Override via `FRONTEND_ORIGIN`.
- `helmet` is on (X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy, etc.).
- **SSRF blocklist**: requests to private / loopback / link-local / cloud-metadata IPs are refused. Resolved IPs are pinned through the connection so DNS rebinding can't bypass the check. Need to monitor an internal endpoint? Set `SSRF_ALLOW_PRIVATE=true`.
- Rate limit: 600 req/min globally (loopback exempted) + 30/min on mutating routes (create-project, upload).
- Uploads validate MIME type against an allowlist and sanitize filenames; max 10 MB.
- Audit-report HTML files older than 30 days are auto-pruned alongside the existing 365-day check retention.

**Still NOT in the box** (deliberate trade-offs for the current threat model):
- No login / sessions / per-project ACLs. Don't expose to the public internet without putting auth in front (reverse-proxy + OAuth/SSO, or basic auth).
- Vault values, Slack webhooks, and email recipient lists are stored in **plaintext SQLite**. Treat `backend/data/db.sqlite` as a credential — never check it in or share it.
- Phase 1.27.4 `{{api_key}}` substitution exposes vault values to any user with edit access on a project. Anyone allowed to edit a URL can exfiltrate keys; treat project edit as a privileged role.
- HTTP only in dev. Put TLS in front (reverse proxy + Let's Encrypt) for anything beyond your own machine.

A full audit report ships in [documentation/security-review-2026-06-12.html](documentation/security-review-2026-06-12.html).

---

## What you can do with it

- **Monitor URLs** at custom intervals (1 min – 24 h) with full 5-phase latency breakdown (DNS / TCP / TLS / TTFB / Download), grouped by status family (2xx / 3xx / 4xx / 5xx / error).
- **Chain API calls into Flows** — extract values from one response with JSONPath, substitute them as `{{var}}` in the next, assert on status / latency / body, retry with exponential backoff.
- **Iterate over arrays** with for-each (up to 4 nesting levels). Monitor a dynamic fleet — when a new student / device / customer is added, it's automatically included next run.
- **Run a setup chain (Prerequisites)** at the project level — log in once, capture the token into a project-scoped pool, every URL and flow in that project consumes it via `{{token}}`.
- **Get alerted** on Slack (webhook) and Email (AWS SES) the moment a URL or flow flips from OK to FAIL.
- **Generate audit reports** — one-click HTML snapshot of current health, posted to Slack and emailed as an attachment. Read-only by design (doesn't re-check).
- **Round-trip to OpenAPI** — export a project to Swagger YAML/JSON, hand the file to a new dev, they import it into a fresh project and get every URL + flow back without typing a thing.

A polished React dashboard sits in front of it all — drag-and-drop step reordering, live mid-flight progress, sparklines, KPI bars, unified Activity Timeline with 24h / 7d / 30d / 90d / 1y / Custom time ranges.

---

## Run it locally

You need **Node ≥ 22** (the backend uses the built-in `node:sqlite` module — no native compilation, no `better-sqlite3`).

Open **two terminals.**

**Terminal 1 — backend** (port 4000):

```bash
cd backend
npm install            # first time only
npm run dev            # tsx watch with auto-reload
```

**Terminal 2 — frontend** (port 5173):

```bash
cd frontend
npm install            # first time only
npm run dev            # vite dev server
```

Open <http://localhost:5173>. Create a project from the sidebar, then add a URL like `https://httpstat.us/200` and one like `https://httpstat.us/500` to see status grouping kick in within ~30 seconds.

---

## Run it in production (single-server bundle)

Phase 1.27.10 ships a one-process deployment. The frontend gets compiled to static files, copied into `backend/public/`, and served by the same Express process that exposes the API. **One port, one process** — no separate Vite server in production.

From the repo root:

```bash
npm run install:all   # first time only — installs backend + frontend deps
npm run build         # vite build → copies frontend/dist → backend/public
npm start             # starts the bundled server on port 4000
```

Then open <http://localhost:4000> — the dashboard and the API now live on the same origin.

What `npm run build` does:
1. `npm --prefix frontend run build` → produces `frontend/dist/` (TypeScript check + Vite production build)
2. `node scripts/copy-frontend-to-backend.mjs` → copies it to `backend/public/` (overwrites any previous build)

What `npm start` does:
- Runs `backend/src/app.ts` via `tsx`. On startup the backend detects `backend/public/` and mounts it as static middleware + adds an SPA fallback so client-side routes survive a hard refresh. API routes (`/api/*`) and audit reports (`/reports/*`) take precedence over static serving — order is preserved.

For deploying to a server: copy the entire repo (or just `backend/` + a built `backend/public/`), `npm install --omit=dev` inside `backend/`, set your env vars, run `npm start`.

> Dev workflow with hot reload still works exactly as before — run `npm run dev:backend` + `npm run dev:frontend` from the repo root (or `npm run dev` in each subproject as documented above). The single-server bundle only matters for production.

### Optional — enable email notifications

Email is off until you configure AWS SES. Follow the step-by-step guide in [backend/.env.example](backend/.env.example) — it walks through verifying a sender identity, choosing how the backend authenticates (env-var keys vs `~/.aws/credentials` vs IAM role), and the IAM policy you need. Takes ~5 minutes once you have an AWS account.

```bash
cd backend
cp .env.example .env       # Mac / Linux
copy .env.example .env     # Windows cmd
Copy-Item .env.example .env  # PowerShell

# Edit .env: set AWS_REGION + SES_FROM_EMAIL (and AWS_ACCESS_KEY_ID /
# AWS_SECRET_ACCESS_KEY if you're not using an IAM role or ~/.aws/credentials),
# then restart the backend.
```

Then open any project → ⚙ Settings → paste recipient addresses into "Notification emails" → save. Email is per-project, independent of Slack.

### Optional — enable Slack notifications

Open any project → ⚙ Settings → paste a Slack incoming-webhook URL into "Slack webhook URL" → save. Slack is also per-project.

---

## A 60-second tour

| Screen | What it does |
|---|---|
| **Sidebar** | Projects. Each project has its own URLs, flows, prereq chain, API keys, recipients. Failing-count badge pulses red when something's down. |
| **Project header** | KPI bar (Total / Healthy / Failing / Avg latency), search, action buttons (📥 Import from Swagger, 📤 Export to Swagger, 📊 Snapshot & report). Chips show which channels are live (`🔔 Slack on`, `📧 Email on`). |
| **Prerequisites panel** | Collapsible. The sequential auth/setup chain that runs before every URL + flow in the project. Live pool of captured variables with TTL countdowns. |
| **URLs tab** | Cards with status pill, 5-phase latency bar, 24h sparkline, failure-rate chip, Activity Timeline. Edit opens the same 7-tab editor as flow steps. |
| **Flows tab** | Cards with expandable step list. Drag-and-drop reorder. Live per-step progress while running ("retry 2 of 3 …", "iteration 14 of 50 …"). Move/copy steps across flows. |
| **Step editor** | 7 tabs — Details / Body / Headers / Params / Assertions / Extract / Retry+ForEach. Variables hint shows every `{{var}}` available from earlier steps + the project prereq pool. |
| **Snapshot & report** | One click → HTML report generated, summary posted to Slack, HTML emailed to recipients. Doesn't re-check anything (read-only). |
| **Import / Export Swagger** | Two-step import (preview diff → granular apply). Export produces deterministic YAML/JSON — no-op re-exports are byte-identical. |

---

## Stack

| Layer | Tech |
|---|---|
| Backend | Node ≥ 22 · TypeScript · Express 4 · `node:sqlite` (built-in, WAL mode) · `@aws-sdk/client-sesv2` · `@apidevtools/swagger-parser` · `js-yaml` |
| Frontend | React 18 · Vite 5 · TypeScript · vanilla CSS with design tokens · `@dnd-kit/core` for drag-and-drop |
| Data | SQLite single-file (`backend/data/db.sqlite`, gitignored). 17 tables. Additive migrations only. 365-day check retention. |
| Notifications | Slack incoming webhooks · AWS SES v2 API (credentials via env vars, `~/.aws/credentials`, or IAM role) |

No global state library, no message queue, no background workers. Everything runs on the single Node process; the frontend polls.

---

## Project files

| File | Read it when… |
|---|---|
| [STATUS.md](documentation/STATUS.md) | …you want a 1-pager of where the project is right now |
| [ARCHITECTURE.md](documentation/ARCHITECTURE.md) | …you want to understand the system end-to-end (modules, data model, execution model, conventions) |
| [PROGRESS.md](documentation/PROGRESS.md) | …you want the full phase-by-phase log with dates |
| [backend/.env.example](backend/.env.example) | …you want to enable email notifications |
| `project-tracker.xlsx` (at repo root) | …you want a date-grouped daily log for sharing with a manager *(local-only, gitignored)* |

---

## What's NOT here yet (Phase 2, deferred)

- AI-assisted setup / flow building (conversational interface)
- One more TBD AI capability
- Dashboard authentication / multi-tenant separation
- WebSocket / SSE in place of polling

Manager-led — picked up after Phase 1 sign-off.

---

## Health check

Backend on port 4000 → `GET http://localhost:4000/api/health` returns `{ "ok": true, "service": "monitoring-backend" }`.

Frontend on port 5173 → opens straight to the dashboard.

If the backend won't start with `EADDRINUSE`, an old process is still holding port 4000. Find it with `netstat -ano | findstr :4000` and kill the PID — `taskkill /F /PID <pid>` on Windows.
