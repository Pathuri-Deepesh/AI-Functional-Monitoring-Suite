# Function Reference

A one-line-per-function quick reference for the AI Functional Monitoring Suite. Ctrl+F a function name; the description tells you what it does, not how it works inside.

---

## 📄 backend/src/app.ts

The Express HTTP server — every route the frontend can call lives here. Routes are listed in file order, grouped by URL prefix.

### Health & status

- **`GET /api/health`** — Liveness probe that returns a tiny `{ok:true}` JSON for uptime checks.
- **`GET /api/status`** — Returns the global snapshot (every URL + counts by status group) used by the dashboard.

### Projects

- **`GET /api/projects`** — Lists every project in the database.
- **`POST /api/projects`** — Creates a new project from the posted name + optional Slack/email settings.
- **`GET /api/projects/:id`** — Returns one project plus all of its URLs in a single payload.
- **`PATCH /api/projects/:id`** — Updates project fields like name, description, Slack webhook, email recipients, and prereq settings.
- **`DELETE /api/projects/:id`** — Deletes a project and cascade-removes its URLs, flows, keys, and history.

### OpenAPI export / import

- **`GET /api/projects/:id/export/openapi`** — Downloads the project as a Swagger/OpenAPI 3.0.3 spec in YAML or JSON.
- **`POST /api/projects/:id/import/openapi/preview`** — Fetches a remote spec and returns a read-only diff showing what would be created, changed, or removed.
- **`POST /api/projects/:id/import/openapi/apply`** — Atomically applies the user's selections from the preview, creating URLs and (for round-trips) flows and prereqs.

### API keys

- **`POST /api/projects/:id/keys`** — Adds a new API key to a project's secret vault.
- **`DELETE /api/projects/:projectId/keys/:keyId`** — Removes an API key from a project.

### URLs

- **`POST /api/projects/:projectId/urls`** — Adds a monitored URL to a project and immediately fires one initial check.
- **`PATCH /api/urls/:id`** — Updates a URL's settings (method, body, assertions, headers, interval, etc).
- **`DELETE /api/urls/:id`** — Deletes a monitored URL and its check history.
- **`POST /api/urls/:id/check`** — Triggers an immediate check of one URL and returns the freshly-updated snapshot.

### URL history & stats

- **`GET /api/urls/:id/history`** — Returns every recorded check for a URL since a given timestamp.
- **`GET /api/urls/:id/stats`** — Returns aggregate stats (failure rate, average latency, p99) over a time window.
- **`GET /api/urls/:id/sparkline`** — Returns time-bucketed latency points for drawing the small trend chart.

### Audit (read-only snapshot)

- **`POST /api/projects/:id/audit`** — Renders an HTML report of the project's current state and delivers it via Slack and email.

### Manual check triggers

- **`POST /api/projects/:id/check-urls`** — Runs every standalone URL in the project in parallel and returns aggregate counts.
- **`POST /api/projects/:id/check-all`** — Runs prereqs first, then standalone URLs and every enabled flow in parallel.

### Flows

- **`GET /api/projects/:projectId/flows`** — Lists every flow belonging to a project.
- **`POST /api/projects/:projectId/flows`** — Creates a new flow under a project.
- **`GET /api/flows/:id`** — Returns a flow with all its steps inlined.
- **`PATCH /api/flows/:id`** — Updates flow-level settings (name, interval, stop-on-failure, enabled).
- **`DELETE /api/flows/:id`** — Deletes a flow and cascade-removes its steps and runs.

### Flow steps

- **`POST /api/flows/:flowId/steps`** — Adds a step (HTTP, Compute, or Loop) to the end of a flow.
- **`PATCH /api/steps/:id`** — Updates one step in place.
- **`DELETE /api/steps/:id`** — Removes a step and rebalances the position numbers.
- **`POST /api/flows/:flowId/steps/reorder`** — Accepts a new ordered ID list and rewrites step positions.
- **`POST /api/steps/:id/copy-to-flow`** — Duplicates a step into another flow at position 1.
- **`POST /api/steps/:id/move-to-flow`** — Moves a step from one flow to another (top of target).

### Flow runs

- **`POST /api/flows/:id/run`** — Runs a flow synchronously and returns the completed run.
- **`POST /api/flows/:id/run-async`** — Kicks off a flow in the background and returns the runId immediately for polling.
- **`GET /api/flows/:id/runs`** — Returns the last N runs of a flow.
- **`GET /api/flow-runs/:id`** — Returns one flow run with live mid-flight progress when applicable.
- **`GET /api/flows/:id/stats`** — Returns aggregate flow stats (run count, failure rate, average duration) over a window.
- **`GET /api/flows/:id/sample-vars`** — Returns the most recent successful run's variable snapshot + per-flow iterables for the live URL preview.

### Variable cache (per-flow TTL pool)

- **`GET /api/flows/:id/cache`** — Returns the flow's currently-cached variables and remaining TTLs.
- **`DELETE /api/flows/:id/cache`** — Clears the flow's variable cache.

### Prerequisites (project-level setup chain)

- **`GET /api/projects/:projectId/prereqs`** — Returns the prereq step list plus interval/enabled/last-run metadata.
- **`POST /api/projects/:projectId/prereqs/steps`** — Adds a new prereq step to a project.
- **`PATCH /api/prereq-steps/:id`** — Updates one prereq step in place.
- **`DELETE /api/prereq-steps/:id`** — Removes a prereq step and rebalances positions.
- **`POST /api/projects/:projectId/prereqs/steps/reorder`** — Rewrites prereq step positions from an ordered ID list.
- **`POST /api/projects/:projectId/prereqs/run`** — Runs the prereq chain synchronously.
- **`POST /api/projects/:projectId/prereqs/run-async`** — Kicks off the prereq chain in the background and returns a runId.
- **`GET /api/projects/:projectId/prereqs/runs`** — Returns the last N prereq runs for a project.
- **`GET /api/prereq-runs/:id`** — Returns one prereq run plus live mid-flight progress when applicable.

### Project variables (prereq output pool)

- **`GET /api/projects/:projectId/variables`** — Returns the live project variable pool with TTL info.
- **`DELETE /api/projects/:projectId/variables`** — Empties the project variable pool.

### Uploads (binary file storage)

- **`GET /api/projects/:projectId/uploads`** — Lists all uploaded files for a project.
- **`POST /api/projects/:projectId/uploads`** — Stores a raw file body (up to 10MB) and returns its metadata.
- **`GET /api/uploads/:id`** — Streams the file bytes back with the correct MIME type and filename.
- **`DELETE /api/uploads/:id`** — Removes an upload from both the database and disk.

---

## 📄 backend/src/db.ts

The SQLite singleton, schema bootstrap, and lightweight migrations.

- **`db()`** — Returns the singleton SQLite connection, lazily creating it and initializing the schema on first call.
- **`tx(fn)`** — Runs a function inside a `BEGIN`/`COMMIT`/`ROLLBACK` block so multi-statement writes are atomic.
- **`ensureColumn(d, table, column, ddl)`** — Adds a column to an existing table if it doesn't already exist (idempotent migrations).
- **`initSchema(d)`** — Creates every table, index, and column the app needs on a fresh database.
- **`migrateFromJsonIfNeeded(d)`** — One-time backfill from the legacy `db.json` file into SQLite, then renames the JSON file.
- **`pruneOldChecks()`** — Deletes check rows, flow runs, prereq runs, and expired variables older than 365 days.

---

## 📄 backend/src/store.ts

The data-access layer — every database read and write the rest of the backend uses. Functions are organized by domain in file order.

### Projects

- **`listProjects()`** — Returns every project, oldest first.
- **`getProject(id)`** — Returns one project with its API keys and latest prereq run summary.
- **`createProject(input)`** — Inserts a new project row and returns it fully hydrated.
- **`updateProject(id, patch)`** — Updates name, description, Slack URL, email list, and prereq settings on a project.
- **`markPrereqRunCompletedAt(projectId, when)`** — Records the timestamp of the most recent prereq run on the project row.
- **`deleteProject(id)`** — Removes a project and cascades to URLs, keys, flows, and runs.

### API keys

- **`addApiKey(projectId, input)`** — Adds a new key to a project's vault and returns the created key.
- **`removeApiKey(projectId, keyId)`** — Removes one API key from a project's vault.

### URLs

- **`listUrls()`** — Returns every URL across every project, newest first.
- **`listUrlsByProject(projectId)`** — Returns every URL belonging to a single project, newest first.
- **`getUrl(id)`** — Returns one URL by id.
- **`addUrl(input)`** — Validates and inserts a new monitored URL after checking the API key belongs to the same project.
- **`getUrlsByImportSpec(projectId, specId)`** — Returns every URL in a project that was imported from a specific OpenAPI spec.
- **`updateUrl(id, patch)`** — Updates a URL's settings in place after validating the method and body type.
- **`removeUrl(id)`** — Deletes one URL and its check history.
- **`recordCheck(args)`** — Inserts a check record and updates the URL's denormalized latest-status snapshot in a single transaction.
- **`resolveApiKeyHeader(url)`** — Looks up the API key attached to a URL and returns the ready-to-send header name and value.

### History queries

- **`listChecksForUrl(urlId, sinceMs)`** — Returns every recorded check for a URL since a given timestamp.
- **`getUrlStats(urlId, windowMinutes)`** — Returns total checks, failure rate, average latency, and approximate p99 for a URL window.

### Flows

- **`listFlows()`** — Returns every flow across every project with last-run status attached.
- **`listFlowsByProject(projectId)`** — Returns every flow in one project with last-run status attached.
- **`getFlow(id)`** — Returns one flow with last-run status attached.
- **`getFlowWithSteps(id)`** — Returns one flow plus its full step list.
- **`createFlow(input)`** — Inserts a new flow under a project.
- **`updateFlow(id, patch)`** — Updates name, description, interval, stop-on-failure, and enabled flag.
- **`deleteFlow(id)`** — Removes a flow and cascades to its steps and runs.
- **`markFlowRunCompletedAt(id, when)`** — Records the timestamp of the most recent run on the flow row.

### Flow steps

- **`listFlowSteps(flowId)`** — Returns every step in a flow in position order.
- **`getFlowStep(id)`** — Returns one step by id.
- **`assertLevelChain(steps)`** — Throws if any level-N step has no level-(N-1) parent above it in position order.
- **`addFlowStep(input)`** — Adds an HTTP, Compute, or Loop step to the end of a flow after validating nesting depth and level chain.
- **`updateFlowStep(id, patch)`** — Updates a step in place, re-validating the for-each depth and level chain when those fields change.
- **`deleteFlowStep(id)`** — Removes a step after confirming it wouldn't orphan any child step, then rebalances positions.
- **`reorderFlowSteps(flowId, orderedIds)`** — Reassigns step positions from a user-supplied ID list, rejecting orderings that break the level chain.
- **`copyFlowStepToFlow(stepId, targetFlowId)`** — Inserts a copy of a step at position 1 of another flow.
- **`moveFlowStepToFlow(stepId, targetFlowId)`** — Moves a step out of its current flow and onto position 1 of the target flow.

### Flow runs

- **`startFlowRun(flowId)`** — Creates a new "in-flight" flow run row and returns its id.
- **`finishFlowRun(args)`** — Stamps a flow run as finished with its ok flag, total duration, and final variable snapshot.
- **`recordStepResult(args)`** — Persists one step's outcome (timings, assertions, extractions, iteration metadata).
- **`getFlowRun(id)`** — Returns one flow run with its full step result list.
- **`getLatestSuccessfulFlowVariables(flowId)`** — Returns the most recent successful run's variable snapshot, used by the live URL preview.
- **`listFlowRuns(flowId, limit)`** — Returns the most recent N flow runs with step results inlined.
- **`getFlowStats(flowId, windowMinutes)`** — Returns run count, failure rate, and average duration for a flow over a window.

### Variable cache (per-flow TTL pool)

- **`getCachedVariables(flowId)`** — Returns the non-expired cached variables for a flow.
- **`cacheVariable(flowId, name, value, ttlSeconds)`** — Stores or refreshes one cached variable with a TTL.
- **`clearVariableCache(flowId)`** — Empties a flow's variable cache.

### Prereq steps

- **`listPrereqSteps(projectId)`** — Returns every prereq step for a project in position order.
- **`getPrereqStep(id)`** — Returns one prereq step by id.
- **`addPrereqStep(input)`** — Adds an HTTP or Compute prereq step to the end of a project's chain.
- **`updatePrereqStep(id, patch)`** — Updates a prereq step in place.
- **`deletePrereqStep(id)`** — Removes a prereq step and rebalances positions.
- **`reorderPrereqSteps(projectId, orderedIds)`** — Reassigns prereq positions from a user-supplied ID list.

### Prereq runs

- **`startPrereqRun(projectId)`** — Creates a new "in-flight" prereq run row and returns its id.
- **`finishPrereqRun(args)`** — Stamps a prereq run as finished with ok flag, total duration, and final variables.
- **`recordPrereqStepResult(args)`** — Persists one prereq step's outcome (timings, assertions, extractions).
- **`getPrereqRun(id)`** — Returns one prereq run with its full step result list.
- **`listPrereqRuns(projectId, limit)`** — Returns the most recent N prereq runs with step results inlined.

### Project variables (prereq output pool)

- **`getProjectVariables(projectId)`** — Returns the non-expired project-wide variables used by URLs and flows.
- **`listProjectVariables(projectId)`** — Returns every project variable with capture and expiry timestamps for the UI.
- **`cacheProjectVariable(projectId, name, value, ttlSeconds)`** — Stores or refreshes one project variable with a TTL.
- **`clearProjectVariableCache(projectId)`** — Empties the project variable pool.

### Uploads

- **`createUpload(input)`** — Inserts an upload metadata row and returns it (the file bytes are written separately to disk).
- **`getUpload(id)`** — Returns one upload's metadata by id.
- **`listUploadsByProject(projectId)`** — Returns every upload in a project, newest first.
- **`deleteUpload(id)`** — Removes one upload's metadata row.

### URL sparkline

- **`getUrlSparkline(urlId, windowMinutes, buckets)`** — Bucketizes a URL's recent checks into time slots for the trend chart.

---

## 📄 backend/src/monitor.ts

The standalone-URL scheduler — runs every 30 seconds, fires URLs whose interval has elapsed, and posts failure alerts.

- **`checkOne(urlId)`** — Runs one URL check, de-duplicating concurrent calls so the same URL isn't checked twice in parallel.
- **`tick()`** — Once per scheduler tick, runs all due prereqs, then all due URLs and flows in parallel.
- **`checkAllInProject(projectId, concurrency)`** — Runs every URL in a project in parallel with a concurrency cap.
- **`snapshot()`** — Returns the dashboard payload: all projects, all URLs, and counts by status group.
- **`startMonitorLoop()`** — Starts the 30-second scheduler tick and the hourly pruning job.

---

## 📄 backend/src/flowRunner.ts

The flow execution engine — builds the level-1-through-4 tree from a flow's steps and walks it, handling retries, smart-cache skips, for-each iteration, and Compute steps.

- **`getLiveStepProgress(runId)`** — Returns the in-flight per-step progress for a running flow (retry count, backoff phase, iteration index).
- **`buildExecutionTree(steps)`** — Materializes a flat step list into an L1..L4 forest of `ExecNode`s so each level-N step becomes a child of the prior level-(N-1).
- **`executeNode(node, …)`** — Recursively executes one tree node — branches into for-each, Compute, or HTTP — and walks its children inside each iteration.
- **`kickoffFlow(flowId, options)`** — Starts a flow run in the background and returns the runId immediately, deduplicating against any in-flight run.
- **`runFlow(flowId)`** — Starts a flow run and waits for it to finish, returning the completed run.
- **`runComputeStep(step, variables)`** — Applies a Compute step's transforms in sequence, returning new variables and an ok/error flag.

---

## 📄 backend/src/prereqRunner.ts

The prereq chain executor — sequential, stop-on-failure, writes captured variables into the project-wide pool.

- **`getLiveStepProgress(runId)`** — Returns the in-flight per-step progress for a running prereq chain.
- **`kickoffPrereqChain(projectId, options)`** — Starts a prereq chain in the background and returns the runId immediately.
- **`runPrereqChain(projectId)`** — Starts a prereq chain and waits for it to finish, returning the completed run.

---

## 📄 backend/src/audit.ts

The read-only project audit — snapshots current state into an HTML report and delivers it.

- **`runAuditAndDeliver(projectId, reportsDir, baseUrl)`** — Renders an HTML audit report from current URL and flow state, writes it to disk, and posts it to Slack and email in parallel.

---

## 📄 backend/src/report.ts

The HTML renderer used by audit emails and Slack snapshots.

- **`renderReportHtml(args)`** — Builds the full HTML audit page (hero card, KPIs, failure summary, URL table, flow table) from project state.

---

## 📄 backend/src/email.ts

SMTP-based email delivery — per-URL failures, per-flow failures, and audit reports.

- **`getTransport()`** — Lazily builds the Nodemailer SMTP transport from environment variables, caching the result.
- **`sendUrlFailureEmail(project, url)`** — Sends a short email about a single failing URL to the project's notification recipients.
- **`sendFlowFailureEmail(flow, run, project, failedStep)`** — Sends a short email about a failing flow run, naming the step that failed and why.
- **`sendAuditEmail(args)`** — Sends the full audit report as HTML + plain-text + an attached HTML file, with clickable per-failure deep links.

---

## 📄 backend/src/slack.ts

Slack webhook delivery — per-URL failures, per-flow failures, and audit reports.

- **`sendSlackAlert(webhookUrl, project, url)`** — Posts a brief failure message about one URL to a Slack webhook.
- **`sendFlowFailureAlert(flow, run, project)`** — Posts a brief failure message about one flow run to the project's Slack webhook.
- **`sendAuditToSlack(args)`** — Posts the audit summary (counts + report link) to the project's Slack webhook.

---

## 📄 backend/src/openapiImport.ts

Imports URLs (and round-trip flows and prereqs) from a remote OpenAPI 3.x spec.

- **`fetchAndParseSpec(specUrl)`** — Downloads a spec URL, validates it as OpenAPI 3.x, and returns a parsed document with a stable specId.
- **`pathTemplateToInternalSyntax(path)`** — Converts OpenAPI `{var}` path templating to the suite's internal `{{var}}` syntax.
- **`operationIdentity(method, pathTemplate, operationId)`** — Returns a stable identifier for an operation across re-imports (operationId, or `METHOD path` as fallback).
- **`pickBaseUrl(doc, pathItem, op, override, specUrl)`** — Picks the first usable server URL, with override taking precedence and relative paths resolved against the spec URL.
- **`matchApiKey(scheme, schemeId, existing)`** — Matches an OpenAPI security scheme to a user's existing API key by name first, then header tuple.
- **`classifyScheme(scheme)`** — Labels a security scheme as `http-bearer`, `apiKey-header`, or `unsupported`.
- **`buildDefaultAssertions(op)`** — Builds a default status assertion from the lowest 2xx response code, falling back to `status in 200-399`.
- **`iterateOperations(doc)`** — Yields every `(method, pathKey, pathItem, op)` tuple in a spec's `paths:` map.
- **`diffSpecAgainstProject(parsed, project, urls, flows, prereqs, options)`** — Compares a parsed spec against the current project state and returns a preview of new, unchanged, drifted, and removed items.
- **`applyImport(projectId, parsed, selections)`** — Atomically creates the user-selected URLs, flows, prereqs, and API keys inside a single SQLite transaction.
- **`getExistingUrlsForSpec(projectId, specId)`** — Returns the URLs in a project that came from a given spec id.

---

## 📄 backend/src/openapiExport.ts

Exports a project as an OpenAPI 3.0.3 document with `x-mon-*` extensions that round-trip back through import.

- **`buildOpenAPISpec(project, urls, flows, prereqs)`** — Builds the full OpenAPI document with paths, security schemes, and the `x-mon-flows` side-band, sorted deterministically for byte-stable re-exports.

---

## 📄 backend/src/extraction.ts

Variable substitution, JSONPath extraction, and Compute step transforms.

- **`extractFromResponse(args)`** — Pulls values out of a response (body via JSONPath, headers by name, or status code) and returns them as named variables.
- **`jsonPath(obj, path)`** — Evaluates a small subset of JSONPath against a parsed object, supporting dotted access, numeric indices, bracket notation, and `[*]` wildcards.
- **`substitute(template, vars)`** — Resolves `{{var}}` placeholders inside a string by looking up the scope stack, leaving unknown placeholders intact.
- **`resolveVar(stack, name)`** — Walks the scope stack from innermost to outermost and returns the first binding for a name or dotted path.
- **`applyComputeTransform(value, transform, stack)`** — Applies one Compute transform (splitTake, slice, lowercase, uppercase, trim, replace, concat, mapAddField, concatArrays) to a value.
- **`expandTemplateForPreview(args)`** — Expands a URL template against a sample variable snapshot to produce up to N representative preview rows for the live URL panel.

---

## 📄 backend/src/assertions.ts

Pass/fail evaluation of user-configured assertions against a check outcome.

- **`evaluateAssertions(assertions, outcome, vars)`** — Runs every configured assertion against a response and returns pass/fail with a human-readable detail each.
- **`summarizeAssertion(a)`** — Returns a short one-line label for an assertion (used in tooltips and tables).

---

## 📄 backend/src/timing.ts

The 5-phase timed HTTP primitive used by every check, flow step, and prereq.

- **`timedFetch(spec)`** — Performs one HTTP request, returning status code, response body, headers, and timings broken down by DNS, TCP, TLS, TTFB, and download.

---

## 📄 backend/src/errorReason.ts

Plain-English error explanations.

- **`reasonForStatus(code)`** — Returns a friendly sentence explaining a given HTTP status code.
- **`reasonForError(err)`** — Returns a friendly sentence explaining a network-level error (DNS, connection refused, TLS, etc).

---

## 📄 backend/src/paths.ts

Disk location helpers for binary uploads.

- **`uploadPath(id)`** — Returns the on-disk path where an upload's bytes are stored.

---

## 📄 frontend/src/api.ts

The frontend's typed wrapper around every backend route — the single place the UI calls `fetch()`. Grouped by domain in file order.

### Snapshot

- **`fetchStatus()`** — Loads the global dashboard snapshot (projects + URLs + counts).

### Projects

- **`createProject(input)`** — Creates a new project.
- **`updateProject(id, patch)`** — Updates a project's name, description, Slack, email, or prereq settings.
- **`deleteProject(id)`** — Deletes a project.
- **`exportProjectOpenAPI(projectId, format)`** — Downloads the project's OpenAPI spec as a Blob plus suggested filename.
- **`previewSwaggerImport(projectId, input)`** — Asks the backend to fetch and diff a remote spec, returning a preview.
- **`applySwaggerImport(projectId, input)`** — Applies the user's selections from a spec preview.

### API keys

- **`addApiKey(projectId, input)`** — Adds a new API key to a project's vault.
- **`removeApiKey(projectId, keyId)`** — Removes an API key from a project.

### URLs

- **`addUrl(projectId, input)`** — Creates a new monitored URL in a project.
- **`updateUrl(id, patch)`** — Updates a URL's settings.
- **`removeUrl(id)`** — Deletes a URL.
- **`checkUrlNow(id)`** — Triggers an immediate check of one URL.

### URL history & stats

- **`fetchHistory(urlId, sinceMs)`** — Loads every check for a URL since a timestamp.
- **`fetchStats(urlId, windowMinutes)`** — Loads aggregate stats (failure rate, latency, p99) for a URL window.
- **`fetchSparkline(urlId, windowMinutes, buckets)`** — Loads the time-bucketed points for the URL trend chart.

### Audit

- **`runAudit(projectId)`** — Triggers an audit run and returns the report URL, file path, and delivery results.

### Manual check triggers

- **`checkAllUrls(projectId)`** — Runs every standalone URL in a project in parallel.
- **`checkEntireProject(projectId)`** — Runs prereqs, URLs, and flows together as a full check.

### Flows

- **`listProjectFlows(projectId)`** — Loads every flow in a project.
- **`createFlow(projectId, input)`** — Creates a new flow under a project.
- **`fetchFlow(id)`** — Loads one flow with its steps.
- **`updateFlow(id, patch)`** — Updates flow-level settings.
- **`deleteFlow(id)`** — Deletes a flow.

### Flow steps

- **`addFlowStep(flowId, input)`** — Adds a step to a flow.
- **`updateFlowStep(id, patch)`** — Updates a step in place.
- **`deleteFlowStep(id)`** — Removes a step.
- **`reorderFlowSteps(flowId, orderedIds)`** — Rewrites step positions from a new ordering.
- **`copyStepToFlow(stepId, targetFlowId)`** — Duplicates a step into another flow.
- **`moveStepToFlow(stepId, targetFlowId)`** — Moves a step into another flow.

### Flow runs

- **`runFlowNow(id)`** — Runs a flow synchronously and waits for the result.
- **`runFlowAsync(id, opts)`** — Kicks off a flow run and returns the runId for polling.
- **`fetchFlowRun(runId)`** — Loads one flow run with its full step results and live progress.
- **`listFlowRuns(id, limit)`** — Loads recent runs for a flow.
- **`fetchFlowSampleVars(flowId)`** — Loads the sample variable snapshot powering the live URL preview.
- **`getCachedVariables(id)`** — Loads a flow's currently-cached variables.
- **`clearFlowCache(id)`** — Empties a flow's variable cache.

### Prerequisites

- **`fetchPrereqs(projectId)`** — Loads the prereq step list plus interval, enabled, and last-run metadata.
- **`addPrereqStep(projectId, input)`** — Adds a prereq step to a project.
- **`updatePrereqStep(id, patch)`** — Updates a prereq step.
- **`deletePrereqStep(id)`** — Removes a prereq step.
- **`reorderPrereqSteps(projectId, orderedIds)`** — Rewrites prereq positions from a new ordering.
- **`runPrereqsNow(projectId)`** — Runs the prereq chain synchronously.
- **`runPrereqsAsync(projectId, opts)`** — Kicks off the prereq chain in the background and returns the runId.
- **`fetchPrereqRun(runId)`** — Loads one prereq run with its full step results and live progress.
- **`listPrereqRuns(projectId, limit)`** — Loads recent prereq runs for a project.
- **`fetchProjectVariables(projectId)`** — Loads the live project variable pool with TTL info.
- **`clearProjectVariables(projectId)`** — Empties the project variable pool.

### Uploads

- **`listUploads(projectId)`** — Loads all uploaded files for a project.
- **`uploadFile(projectId, file, onProgress)`** — Uploads a file via XHR with progress-event reporting.
- **`deleteUpload(id)`** — Removes an upload.
- **`uploadUrl(id)`** — Returns the URL that streams an upload's bytes back (used as a preview src).
