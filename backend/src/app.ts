import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import yaml from "js-yaml";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { buildOpenAPISpec } from "./openapiExport.js";
import {
  applyImport,
  diffSpecAgainstProject,
  fetchAndParseSpec,
} from "./openapiImport.js";
import {
  addApiKey,
  addFlowStep,
  addPrereqStep,
  addUrl,
  clearProjectVariableCache,
  clearVariableCache,
  copyFlowStepToFlow,
  createFlow,
  createProject,
  createUpload,
  deleteFlow,
  deleteFlowStep,
  deletePrereqStep,
  deleteProject,
  deleteUpload,
  getCachedVariables,
  getFlow,
  getFlowRun,
  getFlowStats,
  getFlowStep,
  getFlowWithSteps,
  getLatestSuccessfulFlowVariables,
  getPrereqRun,
  getProject,
  getUpload,
  getUrl,
  getUrlSparkline,
  getUrlStats,
  listChecksForUrl,
  listFlowRuns,
  listFlowsByProject,
  listPrereqRuns,
  listPrereqSteps,
  listProjectVariables,
  listProjects,
  listUploadsByProject,
  listUrlsByProject,
  moveFlowStepToFlow,
  removeApiKey,
  removeUrl,
  reorderFlowSteps,
  reorderPrereqSteps,
  updateFlow,
  updateFlowStep,
  updatePrereqStep,
  updateProject,
  updateUrl,
} from "./store.js";
import {
  saveUpload,
  readUpload,
  uploadExists,
  deleteUploadFile,
  readReport,
  listReports,
} from "./storage.js";
import {
  loadProjectApiKeys,
  upsertProjectApiKey,
  deleteProjectApiKeyFromSecrets,
} from "./secrets.js";
import { checkAllInProject, checkOne, snapshot, startMonitorLoop } from "./monitor.js";
import { runAuditAndDeliver } from "./audit.js";
import { getLiveStepProgress as getLiveFlowStep, kickoffFlow, runFlow } from "./flowRunner.js";
import {
  getLiveStepProgress as getLivePrereqStep,
  kickoffPrereqChain,
  runPrereqChain,
} from "./prereqRunner.js";

const app = express();
const PORT = Number(process.env.PORT) || 4000;
// Phase 1.27.9 — bind to loopback by default; explicit BACKEND_HOST=0.0.0.0
// is required to expose on the LAN. Was the #1 deployment foot-gun: the log
// line said "localhost" but Node was binding 0.0.0.0 silently.
const HOST = process.env.BACKEND_HOST ?? "127.0.0.1";

// Phase 1.27.9 — security headers. helmet() sets ~15 sensible defaults
// (X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy, etc.).
// CSP is intentionally disabled here because the dashboard uses inline
// styles + Vite's HMR which CSP would block; the dashboard is loopback-only
// dev surface, so the trade-off is acceptable. Add a CSP via reverse proxy
// in production.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// Phase 1.27.9 — tighten CORS to the frontend origin only (default
// http://127.0.0.1:5173 + http://localhost:5173). Override via FRONTEND_ORIGIN
// (comma-separated list) for LAN/production setups.
const corsAllow = (process.env.FRONTEND_ORIGIN ??
  "http://127.0.0.1:5173,http://localhost:5173"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: (origin, cb) => {
      // Same-origin / curl / native requests have no Origin header — allow.
      if (!origin) return cb(null, true);
      return cb(null, corsAllow.includes(origin));
    },
    credentials: true,
  })
);

// Phase 1.27.9 — generous global rate limit. 600/min won't trip the 3s
// frontend polling (max ~20/min from one tab × a handful of tabs). Hot-path
// mutations get tighter caps further down. Skip loopback so the local UI
// is never throttled.
const skipLoopback = (req: express.Request) =>
  req.ip === "127.0.0.1" || req.ip === "::1" || req.ip === "::ffff:127.0.0.1";

app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 600,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: skipLoopback,
  })
);

const mutationLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: skipLoopback,
});

app.use(express.json({ limit: "1mb" }));
// Reports are stored in S3 (key reports/<projectId>/<filename>), with local-disk
// fallback when S3 is disabled. Serve them through the app so the "Open report"
// link keeps working regardless of backend. Filename is validated to a single
// path segment to prevent traversal.
app.get("/reports/:projectId/:filename", async (req, res) => {
  const { projectId, filename } = req.params;
  if (!/^[A-Za-z0-9._-]+\.html$/.test(filename)) {
    res.status(400).send("Invalid report name");
    return;
  }
  try {
    const bytes = await readReport(projectId, filename);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(bytes);
  } catch {
    res.status(404).send("Report not found");
  }
});

// Optional: list a project's report history (newest first).
app.get("/api/projects/:projectId/reports", async (req, res) => {
  try {
    res.json(await listReports(req.params.projectId));
  } catch (e) {
    sendError(res, 500, e, "Failed to list reports");
  }
});

// Phase 1.27.9 — sanitize error responses. Generic message to the client,
// full detail to the server log with a request-id the user can quote back.
function sendError(res: express.Response, status: number, e: unknown, label = "Request failed") {
  const id = randomUUID().slice(0, 8);
  // eslint-disable-next-line no-console
  console.warn(`[err ${id}]`, label, e);
  const detail =
    process.env.NODE_ENV === "development" && e instanceof Error ? `: ${e.message}` : "";
  res.status(status).json({ error: `${label}${detail}`, requestId: id });
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "monitoring-backend" });
});

app.get("/api/status", (_req, res) => {
  res.json(snapshot());
});

// ---------- Projects ----------
app.get("/api/projects", (_req, res) => {
  res.json(listProjects());
});

app.post("/api/projects", mutationLimiter, (req, res) => {
  const { name, description, slackWebhookUrl, notificationEmails } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  res
    .status(201)
    .json(createProject({ name, description, slackWebhookUrl, notificationEmails }));
});

app.get("/api/projects/:id", (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json({ project, urls: listUrlsByProject(project.id) });
});

app.patch("/api/projects/:id", (req, res) => {
  const updated = updateProject(req.params.id, req.body ?? {});
  if (!updated) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(updated);
});

app.delete("/api/projects/:id", (req, res) => {
  const ok = deleteProject(req.params.id);
  if (!ok) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.status(204).end();
});

// ---------- OpenAPI / Swagger export ----------
app.get("/api/projects/:id/export/openapi", (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const format: "yaml" | "json" = req.query.format === "json" ? "json" : "yaml";
  const urls = listUrlsByProject(project.id);
  const flows = listFlowsByProject(project.id)
    .map((f) => getFlowWithSteps(f.id))
    .filter((f): f is NonNullable<typeof f> => Boolean(f));
  const prereqs = listPrereqSteps(project.id);
  const spec = buildOpenAPISpec(project, urls, flows, prereqs);
  const body =
    format === "yaml"
      ? yaml.dump(spec, { lineWidth: 120, noRefs: true, sortKeys: false })
      : JSON.stringify(spec, null, 2);
  const slug =
    project.name
      .replace(/[^a-z0-9-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "project";
  const filename = `${slug}-openapi.${format}`;
  res.setHeader(
    "content-type",
    format === "yaml" ? "application/yaml; charset=utf-8" : "application/json; charset=utf-8",
  );
  res.setHeader("content-disposition", `attachment; filename="${filename}"`);
  res.send(body);
});

// ---------- OpenAPI / Swagger import (Phase 1.26) ----------
//
// Two endpoints split read-only from transactional writes:
//   POST /preview — fetch spec, diff against project, return preview (no writes)
//   POST /apply   — atomically create selected URLs (+ round-trip flows/prereqs if present)
//
// Both expect { specUrl: string, baseUrlOverride?: string, includeDeprecated?: boolean }
// in the body. /apply additionally takes the user's per-section selections.

app.post("/api/projects/:id/import/openapi/preview", async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const { specUrl, baseUrlOverride, includeDeprecated } = req.body ?? {};
  if (typeof specUrl !== "string" || !specUrl.trim()) {
    res.status(400).json({ error: "specUrl is required" });
    return;
  }
  try {
    const parsed = await fetchAndParseSpec(specUrl);
    const urls = listUrlsByProject(project.id);
    const flows = listFlowsByProject(project.id)
      .map((f) => getFlowWithSteps(f.id))
      .filter((f): f is NonNullable<typeof f> => Boolean(f));
    const prereqs = listPrereqSteps(project.id);
    const diff = diffSpecAgainstProject(parsed, project, urls, flows, prereqs, {
      includeDeprecated: !!includeDeprecated,
      baseUrlOverride: typeof baseUrlOverride === "string" ? baseUrlOverride : undefined,
    });
    res.json({
      diff,
      specMeta: {
        title: parsed.specTitle,
        version: parsed.specVersion,
        specId: parsed.specId,
        isRoundTrip: parsed.isRoundTrip,
      },
    });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/api/projects/:id/import/openapi/apply", async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const {
    specUrl,
    selections,
    baseUrlOverride,
    includeDeprecated,
  } = req.body ?? {};
  if (typeof specUrl !== "string" || !specUrl.trim()) {
    res.status(400).json({ error: "specUrl is required" });
    return;
  }
  if (!selections || typeof selections !== "object") {
    res.status(400).json({ error: "selections object is required" });
    return;
  }
  try {
    const parsed = await fetchAndParseSpec(specUrl);
    const result = applyImport(project.id, parsed, {
      endpointIdentities: Array.isArray(selections.endpointIdentities)
        ? selections.endpointIdentities
        : [],
      flowIds: Array.isArray(selections.flowIds) ? selections.flowIds : [],
      prereqIds: Array.isArray(selections.prereqIds) ? selections.prereqIds : [],
      deleteUrlIds: Array.isArray(selections.deleteUrlIds) ? selections.deleteUrlIds : [],
      deleteFlowIds: Array.isArray(selections.deleteFlowIds) ? selections.deleteFlowIds : [],
      deletePrereqIds: Array.isArray(selections.deletePrereqIds)
        ? selections.deletePrereqIds
        : [],
      apiKeyCreates: Array.isArray(selections.apiKeyCreates)
        ? selections.apiKeyCreates
        : [],
      baseUrlOverride: typeof baseUrlOverride === "string" ? baseUrlOverride : undefined,
      includeDeprecated: !!includeDeprecated,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------- API Keys ----------
app.post("/api/projects/:id/keys", async (req, res) => {
  const { name, value, headerName, headerPrefix } = req.body ?? {};
  if (typeof name !== "string" || typeof value !== "string" || !value) {
    res.status(400).json({ error: "name and value are required" });
    return;
  }
  const key = addApiKey(req.params.id, { name, value, headerName, headerPrefix });
  if (!key) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  if (process.env.PROJECT_KEYS_SECRET_ARN) {
    try {
      await upsertProjectApiKey(req.params.id, key);
    } catch (err) {
      console.error("[api-keys] Secrets Manager write failed, rolling back:", err);
      removeApiKey(req.params.id, key.id);
      res
        .status(503)
        .json({ error: "Could not save to secrets vault. Please try again." });
      return;
    }
  }
  res.status(201).json(key);
});

app.delete("/api/projects/:projectId/keys/:keyId", async (req, res) => {
  const ok = removeApiKey(req.params.projectId, req.params.keyId);
  if (!ok) {
    res.status(404).json({ error: "Key not found" });
    return;
  }
  if (process.env.PROJECT_KEYS_SECRET_ARN) {
    try {
      await deleteProjectApiKeyFromSecrets(req.params.projectId, req.params.keyId);
    } catch (err) {
      console.error(
        "[api-keys] Secrets Manager delete failed — SQLite already updated; manual reconciliation may be needed:",
        err
      );
    }
  }
  res.status(204).end();
});

// ---------- URLs ----------
app.post("/api/projects/:projectId/urls", (req, res) => {
  const {
    url,
    description,
    apiKeyId,
    intervalMinutes,
    method,
    bodyType,
    body,
    bodyContentType,
    assertions,
    customHeaders,
    queryParams,
  } = req.body ?? {};
  if (typeof url !== "string" || !url.trim()) {
    res.status(400).json({ error: "url is required" });
    return;
  }
  try {
    const created = addUrl({
      projectId: req.params.projectId,
      url,
      description,
      apiKeyId: apiKeyId ?? null,
      intervalMinutes: typeof intervalMinutes === "number" ? intervalMinutes : 5,
      method,
      bodyType,
      body,
      bodyContentType,
      assertions,
      customHeaders,
      queryParams,
    });
    res.status(201).json(created);
    void checkOne(created.id);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.patch("/api/urls/:id", (req, res) => {
  try {
    const updated = updateUrl(req.params.id, req.body ?? {});
    if (!updated) {
      res.status(404).json({ error: "URL not found" });
      return;
    }
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete("/api/urls/:id", (req, res) => {
  const ok = removeUrl(req.params.id);
  if (!ok) {
    res.status(404).json({ error: "URL not found" });
    return;
  }
  res.status(204).end();
});

app.post("/api/urls/:id/check", async (req, res) => {
  const url = getUrl(req.params.id);
  if (!url) {
    res.status(404).json({ error: "URL not found" });
    return;
  }
  const updated = await checkOne(url.id);
  res.json(updated);
});

// ---------- History / Stats ----------
app.get("/api/urls/:id/history", (req, res) => {
  const sinceMs = Number(req.query.since) || Date.now() - 24 * 60 * 60_000;
  res.json(listChecksForUrl(req.params.id, sinceMs));
});

app.get("/api/urls/:id/stats", (req, res) => {
  const windowMinutes = Number(req.query.windowMinutes) || 24 * 60;
  res.json(getUrlStats(req.params.id, windowMinutes));
});

app.get("/api/urls/:id/sparkline", (req, res) => {
  const windowMinutes = Number(req.query.windowMinutes) || 24 * 60;
  const buckets = Math.min(120, Math.max(5, Number(req.query.buckets) || 24));
  res.json(getUrlSparkline(req.params.id, windowMinutes, buckets));
});

// ---------- Audit (READ-ONLY) ----------
// Snapshots the current state of every URL + flow into an HTML report
// and posts to Slack. Never triggers fresh checks — that's what the
// dedicated /check-urls and /check-all endpoints are for.
app.post("/api/projects/:id/audit", async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  try {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const result = await runAuditAndDeliver(project.id, baseUrl);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------- Manual check triggers ----------
// "Check all standalone URLs now" — fires every URL in the project in parallel
// (concurrency-capped). Ignores flows and prereqs. Used by the toolbar button
// under the search bar.
app.post("/api/projects/:id/check-urls", async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const startedAt = Date.now();
  try {
    const results = await checkAllInProject(project.id, 8);
    const ok = results.filter(
      (r) => r.statusGroup === "2xx" || r.statusGroup === "3xx"
    ).length;
    const failed = results.length - ok;
    res.json({
      checked: results.length,
      ok,
      failed,
      durationMs: Date.now() - startedAt,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// "Run full check" — prereqs first (sequential, they capture tokens),
// then standalone URLs + every enabled flow in parallel. Continues even if
// prereqs fail so the operator sees the full picture.
app.post("/api/projects/:id/check-all", async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const startedAt = Date.now();
  try {
    let prereqRun: { ok: boolean; totalMs: number | null } | null = null;
    if (project.prereqEnabled) {
      const prereqSteps = listPrereqSteps(project.id);
      if (prereqSteps.length > 0) {
        const run = await runPrereqChain(project.id);
        prereqRun = run ? { ok: run.ok, totalMs: run.totalMs } : null;
      }
    }

    const urlsTask = checkAllInProject(project.id, 8);
    const flows = listFlowsByProject(project.id).filter((f) => f.enabled);
    const flowsTask = Promise.all(flows.map((f) => runFlow(f.id)));
    const [urlResults, flowRuns] = await Promise.all([urlsTask, flowsTask]);

    const urlsOk = urlResults.filter(
      (r) => r.statusGroup === "2xx" || r.statusGroup === "3xx"
    ).length;
    const flowsOk = flowRuns.filter((r) => r?.ok === true).length;

    res.json({
      durationMs: Date.now() - startedAt,
      prereqs: prereqRun,
      urls: { checked: urlResults.length, ok: urlsOk },
      flows: { ran: flowRuns.length, ok: flowsOk },
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------- Flows ----------
app.get("/api/projects/:projectId/flows", (req, res) => {
  const project = getProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(listFlowsByProject(req.params.projectId));
});

app.post("/api/projects/:projectId/flows", (req, res) => {
  try {
    const { name, description, intervalMinutes, stopOnFailure, enabled } = req.body ?? {};
    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const created = createFlow({
      projectId: req.params.projectId,
      name,
      description,
      intervalMinutes,
      stopOnFailure,
      enabled,
    });
    res.status(201).json(created);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get("/api/flows/:id", (req, res) => {
  const flow = getFlowWithSteps(req.params.id);
  if (!flow) {
    res.status(404).json({ error: "Flow not found" });
    return;
  }
  res.json(flow);
});

app.patch("/api/flows/:id", (req, res) => {
  const updated = updateFlow(req.params.id, req.body ?? {});
  if (!updated) {
    res.status(404).json({ error: "Flow not found" });
    return;
  }
  res.json(updated);
});

app.delete("/api/flows/:id", (req, res) => {
  const ok = deleteFlow(req.params.id);
  if (!ok) {
    res.status(404).json({ error: "Flow not found" });
    return;
  }
  res.status(204).end();
});

// ---------- Flow Steps ----------
app.post("/api/flows/:flowId/steps", (req, res) => {
  try {
    const created = addFlowStep({ flowId: req.params.flowId, ...(req.body ?? {}) });
    res.status(201).json(created);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.patch("/api/steps/:id", (req, res) => {
  try {
    const updated = updateFlowStep(req.params.id, req.body ?? {});
    if (!updated) {
      res.status(404).json({ error: "Step not found" });
      return;
    }
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete("/api/steps/:id", (req, res) => {
  const ok = deleteFlowStep(req.params.id);
  if (!ok) {
    res.status(404).json({ error: "Step not found" });
    return;
  }
  res.status(204).end();
});

app.post("/api/flows/:flowId/steps/reorder", (req, res) => {
  const ids = req.body?.orderedIds;
  if (!Array.isArray(ids)) {
    res.status(400).json({ error: "orderedIds (string[]) is required" });
    return;
  }
  reorderFlowSteps(req.params.flowId, ids);
  res.json({ ok: true });
});

app.post("/api/steps/:id/copy-to-flow", (req, res) => {
  const targetFlowId = req.body?.targetFlowId;
  if (typeof targetFlowId !== "string" || !targetFlowId) {
    res.status(400).json({ error: "targetFlowId (string) is required" });
    return;
  }
  try {
    const created = copyFlowStepToFlow(req.params.id, targetFlowId);
    res.status(201).json(created);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/api/steps/:id/move-to-flow", (req, res) => {
  const targetFlowId = req.body?.targetFlowId;
  if (typeof targetFlowId !== "string" || !targetFlowId) {
    res.status(400).json({ error: "targetFlowId (string) is required" });
    return;
  }
  try {
    const moved = moveFlowStepToFlow(req.params.id, targetFlowId);
    res.json(moved);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------- Flow Runs ----------
app.post("/api/flows/:id/run", async (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) {
    res.status(404).json({ error: "Flow not found" });
    return;
  }
  try {
    const result = await runFlow(flow.id);
    res.json(result ?? null);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * Kick off a flow and return the runId immediately (HTTP 202).
 * The flow continues in the background; clients poll GET /api/flow-runs/:id
 * for live step-by-step progress.
 */
app.post("/api/flows/:id/run-async", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) {
    res.status(404).json({ error: "Flow not found" });
    return;
  }
  // Manual UI clicks set ?force=true to bypass the TTL skip-cache.
  const force = req.query.force === "true";
  const started = kickoffFlow(flow.id, { force });
  if (!started) {
    res.status(409).json({ error: "Flow is disabled" });
    return;
  }
  res.status(202).json(started);
});

app.get("/api/flows/:id/runs", (req, res) => {
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 30));
  res.json(listFlowRuns(req.params.id, limit));
});

app.get("/api/flow-runs/:id", (req, res) => {
  const run = getFlowRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: "Flow run not found" });
    return;
  }
  // Enrich the response with live mid-flight progress (retry attempt, backoff
  // status). Only present while the run is in-flight; null after completion.
  const liveStep = run.endedAt == null ? getLiveFlowStep(run.id) ?? null : null;
  res.json({ ...run, liveStep });
});

app.get("/api/flows/:id/stats", (req, res) => {
  const windowMinutes = Number(req.query.windowMinutes) || 24 * 60;
  res.json(getFlowStats(req.params.id, windowMinutes));
});

// Phase 1.21 — sample variable snapshot used by the live URL-preview panel
// in the step editor. Returns the most recent successful run's `variables_json`
// plus a `iterables` map (`itemVarName → arrayPath`) derived from the flow's
// own for-each steps so the preview can expand template URLs accurately. Both
// fields can be empty — the panel handles a missing snapshot gracefully.
app.get("/api/flows/:id/sample-vars", (req, res) => {
  const flow = getFlowWithSteps(req.params.id);
  if (!flow) {
    res.status(404).json({ error: "Flow not found" });
    return;
  }
  const raw = getLatestSuccessfulFlowVariables(req.params.id) ?? {};
  // flow_runs.variables_json stores every value as a string (see
  // flowRunner.flattenVariables) so arrays/objects come back JSON-encoded.
  // Re-hydrate them here so the preview's Array.isArray() check actually fires
  // and `{{geo}}`-style iterables expand into per-iteration sample URLs.
  const variables: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    variables[k] = rehydrateSampleValue(v);
  }
  const iterables: Record<string, string> = {};
  for (const step of flow.steps) {
    if (step.forEach && step.forEach.itemVarName && step.forEach.arrayVarName) {
      iterables[step.forEach.itemVarName] = step.forEach.arrayVarName;
    }
  }
  res.json({ variables, iterables, hasSample: Object.keys(variables).length > 0 });
});

function rehydrateSampleValue(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const s = v.trim();
  if (!(s.startsWith("[") || s.startsWith("{"))) return v;
  try {
    return JSON.parse(s);
  } catch {
    return v;
  }
}

// ---------- Variable cache (smart caching with TTL) ----------
app.get("/api/flows/:id/cache", (req, res) => {
  res.json(getCachedVariables(req.params.id));
});

app.delete("/api/flows/:id/cache", (req, res) => {
  clearVariableCache(req.params.id);
  res.status(204).end();
});

// ---------- Prerequisites (project-level setup chain) ----------
app.get("/api/projects/:projectId/prereqs", (req, res) => {
  const project = getProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json({
    steps: listPrereqSteps(req.params.projectId),
    intervalMinutes: project.prereqIntervalMinutes,
    enabled: project.prereqEnabled,
    lastRunAt: project.prereqLastRunAt,
    lastRunOk: project.prereqLastRunOk,
    lastRunTotalMs: project.prereqLastRunTotalMs,
  });
});

app.post("/api/projects/:projectId/prereqs/steps", (req, res) => {
  try {
    const created = addPrereqStep({ projectId: req.params.projectId, ...(req.body ?? {}) });
    res.status(201).json(created);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.patch("/api/prereq-steps/:id", (req, res) => {
  try {
    const updated = updatePrereqStep(req.params.id, req.body ?? {});
    if (!updated) {
      res.status(404).json({ error: "Prereq step not found" });
      return;
    }
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete("/api/prereq-steps/:id", (req, res) => {
  const ok = deletePrereqStep(req.params.id);
  if (!ok) {
    res.status(404).json({ error: "Prereq step not found" });
    return;
  }
  res.status(204).end();
});

app.post("/api/projects/:projectId/prereqs/steps/reorder", (req, res) => {
  const ids = req.body?.orderedIds;
  if (!Array.isArray(ids)) {
    res.status(400).json({ error: "orderedIds (string[]) is required" });
    return;
  }
  reorderPrereqSteps(req.params.projectId, ids);
  res.json({ ok: true });
});

app.post("/api/projects/:projectId/prereqs/run", async (req, res) => {
  const project = getProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  try {
    const result = await runPrereqChain(project.id);
    res.json(result ?? null);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Kick off prereq chain, return runId immediately. Client polls GET /api/prereq-runs/:id. */
app.post("/api/projects/:projectId/prereqs/run-async", (req, res) => {
  const project = getProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const force = req.query.force === "true";
  const started = kickoffPrereqChain(project.id, { force });
  if (!started) {
    res.status(409).json({ error: "Unable to start prereq run" });
    return;
  }
  res.status(202).json(started);
});

app.get("/api/projects/:projectId/prereqs/runs", (req, res) => {
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 30));
  res.json(listPrereqRuns(req.params.projectId, limit));
});

app.get("/api/prereq-runs/:id", (req, res) => {
  const run = getPrereqRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: "Prereq run not found" });
    return;
  }
  const liveStep = run.endedAt == null ? getLivePrereqStep(run.id) ?? null : null;
  res.json({ ...run, liveStep });
});

app.get("/api/projects/:projectId/variables", (req, res) => {
  if (!getProject(req.params.projectId)) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(listProjectVariables(req.params.projectId));
});

app.delete("/api/projects/:projectId/variables", (req, res) => {
  if (!getProject(req.params.projectId)) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  clearProjectVariableCache(req.params.projectId);
  res.status(204).end();
});

// ---------- Uploads (binary file storage for bodyType="binary") ----------
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB

app.get("/api/projects/:projectId/uploads", (req, res) => {
  if (!getProject(req.params.projectId)) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(listUploadsByProject(req.params.projectId));
});

// Phase 1.27.9 — permissive MIME allowlist. Covers everything the BinaryBodyEditor
// realistically uploads (images, PDFs, JSON, text, common archives, video/audio
// samples). Anything outside this set is rejected at the gate.
const ALLOWED_UPLOAD_MIME_PREFIXES = [
  "image/",
  "video/",
  "audio/",
  "text/",
  "font/",
];
const ALLOWED_UPLOAD_MIME_EXACT = new Set([
  "application/pdf",
  "application/json",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
  "application/zip",
  "application/x-zip-compressed",
  "application/x-tar",
  "application/gzip",
  "application/x-gzip",
  "application/x-7z-compressed",
  "application/octet-stream", // generic binary — needed for arbitrary form-data uploads
  "application/javascript",
  "application/x-www-form-urlencoded",
]);
function isAllowedMime(m: string): boolean {
  const norm = m.toLowerCase().split(";")[0].trim();
  if (ALLOWED_UPLOAD_MIME_EXACT.has(norm)) return true;
  return ALLOWED_UPLOAD_MIME_PREFIXES.some((p) => norm.startsWith(p));
}

app.post(
  "/api/projects/:projectId/uploads",
  mutationLimiter,
  express.raw({ type: "*/*", limit: MAX_UPLOAD_BYTES }),
  async (req, res) => {
    if (!getProject(req.params.projectId)) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      res.status(400).json({ error: "Empty body — POST raw file bytes" });
      return;
    }
    const rawFilename = String(req.header("x-filename") || "upload").trim();
    let filename = rawFilename;
    try {
      filename = decodeURIComponent(rawFilename);
    } catch {
      // not URL-encoded — use raw
    }
    // Phase 1.27.9 — strip path-traversal characters from filename. Even though
    // the disk key is a UUID (so path traversal via filename is structurally
    // impossible), don't let `../` end up in the download Content-Disposition
    // header that gets sent back as `filename=`.
    filename = filename.replace(/[\\/]/g, "_").replace(/\.\.+/g, "_").slice(0, 255) || "upload";

    const mimeType = String(req.header("content-type") || "application/octet-stream");
    if (!isAllowedMime(mimeType)) {
      res.status(415).json({
        error: `MIME type "${mimeType}" not permitted. Allowed: image/*, video/*, audio/*, text/*, font/*, pdf, json, xml, yaml, zip, tar, gzip, 7z, octet-stream, javascript.`,
      });
      return;
    }
    try {
      const upload = createUpload({
        projectId: req.params.projectId,
        filename,
        mimeType,
        sizeBytes: buf.length,
      });
      await saveUpload(upload.id, buf);
      res.status(201).json(upload);
    } catch (e) {
      sendError(res, 400, e, "Upload failed");
    }
  }
);

app.get("/api/uploads/:id", async (req, res) => {
  const upload = getUpload(req.params.id);
  if (!upload) {
    res.status(404).json({ error: "Upload not found" });
    return;
  }
  if (!(await uploadExists(upload.id))) {
    res.status(404).json({ error: "Upload file missing on disk" });
    return;
  }
  res.setHeader("content-type", upload.mimeType);
  res.setHeader("content-length", String(upload.sizeBytes));
  res.setHeader("content-disposition", `inline; filename="${upload.filename.replace(/"/g, "")}"`);
  res.send(await readUpload(upload.id));
});

app.delete("/api/uploads/:id", async (req, res) => {
  const upload = getUpload(req.params.id);
  if (!upload) {
    res.status(404).json({ error: "Upload not found" });
    return;
  }
  deleteUpload(upload.id);
  try {
    await deleteUploadFile(upload.id);
  } catch {
    // file already gone — ignore
  }
  res.status(204).end();
});

// ===========================================================================
// Phase 1.27.10 — single-origin deployment.
// Serve the built frontend (frontend/dist/ → copied to backend/public/) from
// the same Express process as the API. In dev, the public/ folder is usually
// absent and `npm run dev` keeps Vite on port 5173 with its proxy — this block
// is essentially a no-op until `npm run build` populates public/. Order is
// important: ALL /api/* and /reports/ routes are registered above; the static
// + SPA fallback below only get hit by anything that didn't match those.
// ===========================================================================
const PUBLIC_DIR = resolve("./public");
try {
  statSync(PUBLIC_DIR);
  // Static asset serving — index.html, /assets/*.js + .css, favicons, etc.
  app.use(
    express.static(PUBLIC_DIR, {
      // Don't cache index.html so dashboard updates land on next refresh.
      // The /assets/* files have content-hashed names so they can cache long.
      setHeaders(res, filePath) {
        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        } else if (/\.(?:js|css|woff2?|ttf|png|jpg|jpeg|svg|webp)$/i.test(filePath)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    })
  );

  // SPA fallback — any GET that isn't an API/report path and doesn't look like
  // a missing asset (no file extension) returns index.html so client-side
  // routes (#settings, #urls, #flows) survive a hard refresh.
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    if (req.path.startsWith("/api/") || req.path.startsWith("/reports/")) return next();
    // Has an extension? Probably a real asset request — let Express 404 it
    // naturally instead of returning an HTML page for a missing .js file.
    if (/\.[a-z0-9]+$/i.test(req.path)) return next();
    res.sendFile(resolve(PUBLIC_DIR, "index.html"));
  });

  console.log(`[monitoring-backend] serving frontend from ${PUBLIC_DIR}`);
} catch {
  // public/ doesn't exist yet — this is the dev case. The Vite dev server on
  // 5173 handles the UI; this Express process is API-only.
  console.log(
    `[monitoring-backend] no frontend build at ${PUBLIC_DIR} — run "npm run build" at the repo root to bundle the UI into this server`
  );
}

if (process.env.PROJECT_KEYS_SECRET_ARN) {
  try {
    await loadProjectApiKeys();
  } catch (err) {
    console.error(
      "[monitoring-backend] Secrets Manager unreachable at boot — refusing to start.",
      err
    );
    process.exit(1);
  }
} else {
  console.log(
    "[monitoring-backend] PROJECT_KEYS_SECRET_ARN not set — Secrets Manager sync disabled (local SQLite vault only)"
  );
}

startMonitorLoop();

app.listen(PORT, HOST, () => {
  // Now the log line tells the truth instead of always claiming "localhost".
  console.log(`[monitoring-backend] listening on http://${HOST}:${PORT}`);
});
