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
- [x] **5.9** Dynamic axis labels (hours/days/dates) based on selected window — *2026-05-12*

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

### Friday 2026-05-08 — Storage + History + Audit foundation (16 items)
- Migrated entire backend from JSON file to SQLite (`node:sqlite` built-in)
- Built check history table with 7-day retention + auto-pruning
- Built history UI: sparkline, status strip, failure rate chip, KPI bar
- Wired `/api/urls/:id/history` and `/api/urls/:id/stats` endpoints
- Built Run Audit button + HTML report generator + Slack Block Kit + file upload
- Built audit progress + result modals

### Today 2026-05-11 — Postman parity + Discoverability + new viz (14 items)
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

---

## How to use this file

- Open `PROGRESS.md` here in VS Code (or any editor that renders Markdown checkboxes)
- Tick `[ ]` → `[x]` when you finish a task
- Replace `____________` with the date you finished it
- For Excel-style view, open `project-tracker.csv` in Excel or Google Sheets
