# AI-Powered Functional Monitoring Suite

## Phase 1 — URL Status Monitoring

A real-time monitoring prototype that:

1. Accepts URLs to monitor.
2. Periodically pings each URL and detects its HTTP status code.
3. Groups results by status family (`2xx`, `3xx`, `4xx`, `5xx`, `error`).
4. Streams updated counts to a React dashboard via short-interval polling.

This is the foundation for Phase 2: the same ingest → aggregate → visualize loop will scale up to logs/heartbeats from the Campaign Service, with an AI layer for error pattern analysis and notifications.

## Stack

| Layer    | Tech                                |
| -------- | ----------------------------------- |
| Backend  | Node.js + TypeScript + Express      |
| Frontend | React + TypeScript + Vite           |
| Storage  | In-memory (Phase 2 will swap in DB) |

## Run it

You need **two terminals**.

**Terminal 1 — backend** (port 4000):

```bash
cd backend
npm install        # only first time
npm run dev
```

**Terminal 2 — frontend** (port 5173):

```bash
cd frontend
npm install        # only first time
npm run dev
```

Then open <http://localhost:5173> and add a URL like `https://example.com` or `https://httpstat.us/500` to see status grouping in action.

## API

| Method | Endpoint         | Body              | Returns                  |
| ------ | ---------------- | ----------------- | ------------------------ |
| GET    | `/api/health`    | —                 | `{ ok, service }`        |
| GET    | `/api/status`    | —                 | full snapshot + grouped counts |
| POST   | `/api/urls`      | `{ "url": "..." }`| created `MonitoredUrl`   |
| DELETE | `/api/urls/:id`  | —                 | 204                      |

## Architecture notes

- **Monitor loop:** `backend/src/monitor.ts` runs a 5-second `setInterval` that fetches every registered URL in parallel.
- **Classification:** `classify(code)` maps numeric status codes into the five groups; network failures and timeouts collapse into `error`.
- **Real-time UX:** the frontend polls `/api/status` every 2 seconds. Phase 2 should replace this with WebSocket/SSE once volume justifies it.
- **Swappable subject:** the `MonitoredUrl` type is the only data shape the dashboard cares about. In Phase 2 we replace `checkOne()` with a heartbeat/log-tail consumer and the rest of the stack is unchanged.

## Phase 2 hooks (intentional design choices)

- `MonitoredUrl.statusGroup` is a free-form `StatusGroup` union — easy to extend with `"warning"`, `"degraded"`, etc.
- All ingestion goes through one function (`checkOne`) — point that at a Kafka consumer or webhook in Phase 2.
- Snapshot endpoint returns aggregated buckets, mirroring what the AI layer (LogiQ) will eventually summarize.
