import express from "express";
import cors from "cors";
import { mkdirSync, createReadStream, statSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
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
import { uploadPath } from "./paths.js";
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

const REPORTS_DIR = resolve("./data/reports");
mkdirSync(REPORTS_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use("/reports", express.static(REPORTS_DIR));

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

app.post("/api/projects", (req, res) => {
  const { name, description, slackWebhookUrl, slackBotToken, slackChannel } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  res
    .status(201)
    .json(createProject({ name, description, slackWebhookUrl, slackBotToken, slackChannel }));
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

// ---------- API Keys ----------
app.post("/api/projects/:id/keys", (req, res) => {
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
  res.status(201).json(key);
});

app.delete("/api/projects/:projectId/keys/:keyId", (req, res) => {
  const ok = removeApiKey(req.params.projectId, req.params.keyId);
  if (!ok) {
    res.status(404).json({ error: "Key not found" });
    return;
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
    const result = await runAuditAndDeliver(project.id, REPORTS_DIR, undefined);
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

app.post(
  "/api/projects/:projectId/uploads",
  express.raw({ type: "*/*", limit: MAX_UPLOAD_BYTES }),
  (req, res) => {
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
    const mimeType = String(req.header("content-type") || "application/octet-stream");
    try {
      const upload = createUpload({
        projectId: req.params.projectId,
        filename,
        mimeType,
        sizeBytes: buf.length,
      });
      writeFileSync(uploadPath(upload.id), buf);
      res.status(201).json(upload);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  }
);

app.get("/api/uploads/:id", (req, res) => {
  const upload = getUpload(req.params.id);
  if (!upload) {
    res.status(404).json({ error: "Upload not found" });
    return;
  }
  const path = uploadPath(upload.id);
  try {
    statSync(path);
  } catch {
    res.status(404).json({ error: "Upload file missing on disk" });
    return;
  }
  res.setHeader("content-type", upload.mimeType);
  res.setHeader("content-length", String(upload.sizeBytes));
  res.setHeader("content-disposition", `inline; filename="${upload.filename.replace(/"/g, "")}"`);
  createReadStream(path).pipe(res);
});

app.delete("/api/uploads/:id", (req, res) => {
  const upload = getUpload(req.params.id);
  if (!upload) {
    res.status(404).json({ error: "Upload not found" });
    return;
  }
  deleteUpload(upload.id);
  try {
    unlinkSync(uploadPath(upload.id));
  } catch {
    // file already gone — ignore
  }
  res.status(204).end();
});

startMonitorLoop();

app.listen(PORT, () => {
  console.log(`[monitoring-backend] listening on http://localhost:${PORT}`);
});
