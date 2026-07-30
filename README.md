# AI-Powered Functional Monitoring Suite

A self-hosted API monitoring suite that watches HTTP endpoints, chains multi-step API workflows, alerts on failures over Slack and Email, and round-trips entire projects to OpenAPI / Swagger.

> Built as a Logitech intern project by [Deepesh P](#). Currently at **Phase 1.36** — fully featured monitor + flow runner + email/Slack alerts (with dual-channel latency-vs-general routing) + OpenAPI export & import + 2-pane Settings (incl. Light/Dark theme) + full URL edit (incl. retry/wait) + Postman-style `{{api_key}}` substitution. **Deployed live on AWS Elastic Beanstalk** (see [Deploy to the Live Server](#️-deploy-to-the-live-server-aws)). AI layer (Phase 2) is deferred.

---

## 🚀 Local Setup Guide

This gets the app running on **your own computer** from a fresh copy. You don't need to be a developer — follow the steps in order. Two ways to run it:
**Dev mode** (two programs side-by-side, auto-reload — best while developing) or
**Bundled mode** (one program — mirrors the real server).

> **Two words you'll see everywhere below:**
> - **Terminal** — the text window where you type commands. On **Windows**: open *PowerShell* (Start menu → type "PowerShell"). On **Mac**: open *Terminal* (Cmd+Space → type "Terminal").
> - **Repo root** — the main project folder, called **`AI-Functional-Monitoring-Suite`**. It's the folder that directly contains `backend`, `frontend`, and `package.json`. **Almost every command below runs from here.** Not sure you're in it? Type `dir` (Windows) or `ls` (Mac) and check you can see `package.json`.

### 1. Prerequisites (install these once)

| Requirement | Version | Check with | Notes |
|---|---|---|---|
| **Node.js** | **≥ 22** | `node -v` | Required — the backend uses the built-in `node:sqlite` module (only in Node 22+). No native build tools needed. |
| **npm** | ≥ 10 (ships with Node 22) | `npm -v` | |
| **Git** | any recent | `git --version` | To clone the repo. |

> ⚠️ **Node 22 is mandatory.** On older Node the backend will crash with `Cannot find module 'node:sqlite'`. Install from [nodejs.org](https://nodejs.org) (LTS 22+) or via `nvm install 22`.

No database server, Docker, or AWS account is needed to run locally — SQLite is a single file and email/Slack are optional.

### 2. Download the code

📁 **Run this from:** any folder you like — it creates the project folder for you.

```bash
git clone <repo-url>
cd AI-Functional-Monitoring-Suite
```

After the `cd`, you are now **inside the repo root**. Stay here for the rest of the steps.

### 3. Install dependencies

📁 **Run this from:** the **repo root** (`AI-Functional-Monitoring-Suite/`).

```bash
npm run install:all
```

This one command installs everything for **both** the backend and the frontend. <sub>(Same as running `npm install` inside `backend/` and again inside `frontend/`.)</sub>

### 4. Start the app — pick ONE option

#### Option A — Dev mode (recommended while developing)

You need **two terminal windows**, both opened at the **repo root**. Leave both running while you use the app.

📁 **Terminal 1 — the backend** (the engine / API, runs on port **4000**). Run from the **repo root**:
```bash
npm run dev:backend
```

📁 **Terminal 2 — the frontend** (the dashboard you look at, runs on port **5173**). Run from the **repo root**:
```bash
npm run dev:frontend
```

Then open **<http://localhost:5173>** in your browser.

#### Option B — Bundled mode (one window, like the real server)

The dashboard is built into the backend and served by one program — **one process, one port**.

📁 **Run these from:** the **repo root**. One terminal is enough.

```bash
npm run build      # step 1: build the dashboard into backend/public
npm start          # step 2: run everything on one port (4000)
```

Then open **<http://localhost:4000>**.

### 5. Verify it's working

- **Backend health check:** open <http://localhost:4000/api/health> → should return
  `{ "ok": true, "service": "monitoring-backend" }`
- **Frontend:** the dashboard loads. Create a project from the sidebar, add a URL like
  `https://httpstat.us/200` and one like `https://httpstat.us/500`, and status grouping
  appears within ~30 seconds.

### 6. (Optional) Enable Email / Slack alerts

The app runs fully without these. To turn them on, see
[Optional — enable email notifications](#optional--enable-email-notifications) and
[Optional — enable Slack notifications](#optional--enable-slack-notifications) below.

### Where your data lives

Everything is stored in a single SQLite file at **`backend/data/db.sqlite`** (auto-created on
first run, gitignored). Deleting it resets the app to empty.
⚠️ It holds API keys and webhook URLs in plaintext — **never commit or share it.**

### Common issues

| Problem | Fix |
|---|---|
| `Cannot find module 'node:sqlite'` | You're on Node < 22. Upgrade to Node 22+. |
| `EADDRINUSE :4000` (or `:5173`) | An old process is holding the port. Find & kill it: **Windows** `netstat -ano \| findstr :4000` then `taskkill /F /PID <pid>` · **Mac/Linux** `lsof -ti:4000 \| xargs kill`. |
| Dashboard loads but data doesn't update | Make sure the **backend** terminal is running — the frontend polls it on port 4000. |
| Blank page in bundled mode | Run `npm run build` before `npm start` (the backend serves `backend/public/`, which the build creates). |
| `npm ... not recognized` / "command not found" | You're not in the **repo root**, or Node isn't installed. `cd` into `AI-Functional-Monitoring-Suite` and re-check `node -v`. |

### Quick command reference

📁 **All of these run from the repo root** (`AI-Functional-Monitoring-Suite/`).

| Command | What it does |
|---|---|
| `npm run install:all` | Install backend + frontend deps |
| `npm run dev:backend` | Backend dev server (port 4000, hot-reload) |
| `npm run dev:frontend` | Frontend dev server (port 5173, hot-reload) |
| `npm run build` | Production build (frontend → `backend/public`) |
| `npm start` | Run the bundled single-server app (port 4000) |
| `npm run clean` | Remove build outputs (`backend/public`, `frontend/dist`) |

---

## ☁️ Deploy to the Live Server (AWS)

This section is for pushing your changes to the **real, shared server** so other people see them. The app is hosted on **AWS Elastic Beanstalk** and reachable **from the company network** at **<https://monitor-cloudservices.np.logitech.io>**.

> **Read this first:** deploying changes the live app that everyone uses. It's safe — you can undo it with a single command (see step 4) — but it is not the same as running on your own machine. Do it on purpose, not by accident.

**What "deploying" actually does:** your computer builds the app and uploads it to AWS; AWS then runs the new version on the live server. Start to finish is about **3–6 minutes**, and the command shows progress the whole time.

### 1. One-time setup (once per computer)

You need three things ready before your **first** deploy:

**a) Install the Elastic Beanstalk command-line tool (`eb`).**  📁 Run from: anywhere.
```bash
pip install awsebcli
eb --version              # check it worked
```
> 🪟 **Windows note:** if `eb --version` says *"eb is not recognized"*, the tool installed to a folder that isn't on your PATH — usually `C:\Users\<you>\AppData\Roaming\Python\Python3xx\Scripts`. Add that folder to your PATH (then re-open the terminal), or call `eb` by its full path.

**b) Set up AWS credentials** (the keys that let your computer talk to our AWS account — ask the team for the `monitor-app-user` keys if you don't have them).  📁 Run from: anywhere.
```bash
aws configure                 # paste Access Key + Secret Key; region = us-east-1
aws sts get-caller-identity   # check it worked — prints an account number, no error
```

**c) Be on the company network / VPN.** The live server only accepts connections from the office network — off-network, uploads and checks will time out.

### 2. Deploy your changes

📁 **Run this from:** the **repo root** (`AI-Functional-Monitoring-Suite/`) — the same main folder as local setup. **NOT** the `infrastructure` folder.

```bash
npm run build && eb deploy
```

That's the whole deploy. What each part does:
- **`npm run build`** — rebuilds the dashboard so your latest changes are included. **Never skip this** — if you do, the live site keeps showing the *old* screen even after deploying.
- **`eb deploy`** — zips the app, uploads it, and switches the live server to your new version. Wait until it prints **`Environment update completed successfully`**.

> 💡 Always run **both together** (`npm run build && eb deploy`). Building when nothing changed is harmless; forgetting to build is the #1 "I deployed but nothing changed" mistake.

### 3. Confirm it went live

📁 **Run this from:** the **repo root**.
```bash
eb status        # look for  Health: Green  and a new "Deployed Version"
```
Then open <https://monitor-cloudservices.np.logitech.io/api/health> — it should say `{"ok":true,"service":"monitoring-backend"}`. Finally open the site and **hard-refresh** (Ctrl+Shift+R) so your browser drops the old cached screen.

### 4. If something goes wrong — undo first, debug later

Because it's the live site, get it working again *before* investigating.  📁 Run from: the **repo root**.
```bash
eb appversion                      # lists past versions — note the last good label
eb deploy --version <that-label>   # instantly puts the previous good version back
```
Then look at what failed:
```bash
eb logs        # recent logs  (eb logs --all  pulls everything)
eb health      # per-instance health detail
```

### 5. Deploy troubleshooting

| Symptom | Cause & fix |
|---|---|
| `eb` not recognized | The EB tool isn't on your PATH — see the Windows note in step 1a. |
| Upload / health check times out | You're off the company network. Connect to the office network / VPN. |
| Old screen after deploy | You skipped `npm run build`, or the browser cached it — hard-refresh (Ctrl+Shift+R). |
| Health turns **Red** after deploy | The new version failed to start. Roll back (step 4), then read `eb logs`. |
| Access-denied / credential error | AWS keys missing or wrong. Re-run `aws configure`; verify with `aws sts get-caller-identity`. |

### ⛔ NEVER run these on the live environment

- **`eb create`** — makes a brand-new, extra (billable) environment. We already have ours; only ever use `eb deploy`.
- **`eb setenv`** — crashes our environment. Environment variables live in code instead: `cd infrastructure` → `npx cdk deploy`.

### Deploy — the short version

```bash
# from the repo root, on the company network:
npm run build && eb deploy
eb status                                  # wait for Health: Green
# if it breaks:  eb deploy --version <last-good-label>
```

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

See the **[🚀 Local Setup Guide](#-local-setup-guide)** above for full step-by-step instructions (prerequisites, install, dev vs bundled mode, troubleshooting).

**TL;DR** — from the repo root:

```bash
npm run install:all                        # first time only
npm run dev:backend                        # terminal 1 → API on :4000
npm run dev:frontend                       # terminal 2 → dashboard on :5173
```

Open <http://localhost:5173>.

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
