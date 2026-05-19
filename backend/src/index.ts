import express from "express";
import cors from "cors";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  addApiKey,
  addFlowStep,
  addUrl,
  clearVariableCache,
  createFlow,
  createProject,
  deleteFlow,
  deleteFlowStep,
  deleteProject,
  getCachedVariables,
  getFlow,
  getFlowRun,
  getFlowStats,
  getFlowStep,
  getFlowWithSteps,
  getProject,
  getUrl,
  getUrlSparkline,
  getUrlStats,
  listChecksForUrl,
  listFlowRuns,
  listFlowsByProject,
  listProjects,
  listUrlsByProject,
  removeApiKey,
  removeUrl,
  reorderFlowSteps,
  updateFlow,
  updateFlowStep,
  updateProject,
  updateUrl,
} from "./store.js";
import { checkOne, snapshot, startMonitorLoop } from "./monitor.js";
import { runAuditAndDeliver } from "./audit.js";
import { runFlow } from "./flowRunner.js";

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

// ---------- Audit ("Check All") ----------
app.post("/api/projects/:id/audit", async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  try {
    const result = await runAuditAndDeliver(project.id, REPORTS_DIR);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get("/api/projects/:id/check-all", async (_req, res) => {
  res.status(405).json({ error: "Use POST /api/projects/:id/audit" });
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
  res.json(run);
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

startMonitorLoop();

app.listen(PORT, () => {
  console.log(`[monitoring-backend] listening on http://localhost:${PORT}`);
});
