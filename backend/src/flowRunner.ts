import { reasonForError, reasonForStatus } from "./errorReason.js";
import { evaluateAssertions } from "./assertions.js";
import { extractFromResponse, substitute } from "./extraction.js";
import {
  cacheVariable,
  finishFlowRun,
  getCachedVariables,
  getFlowRun,
  getFlowWithSteps,
  getProject,
  markFlowRunCompletedAt,
  recordStepResult,
  resolveApiKeyHeader,
  startFlowRun,
} from "./store.js";
import { timedFetch } from "./timing.js";
import { sendFlowFailureAlert } from "./slack.js";
import type {
  ExtractedValue,
  Flow,
  FlowRun,
  FlowStep,
  KeyValue,
  MonitoredUrl,
  StatusGroup,
  Timings,
} from "./types.js";

const inFlight = new Map<string, Promise<FlowRun | undefined>>();

function classify(code: number): StatusGroup {
  if (code >= 200 && code < 300) return "2xx";
  if (code >= 300 && code < 400) return "3xx";
  if (code >= 400 && code < 500) return "4xx";
  if (code >= 500 && code < 600) return "5xx";
  return "error";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function substituteKv(items: KeyValue[], vars: Record<string, string>): KeyValue[] {
  return items.map((it) => ({ key: it.key, value: substitute(it.value, vars) }));
}

/**
 * Apply variable substitution to all string fields of a step before execution.
 * Variables come from earlier steps in the same flow run (and from the TTL cache).
 */
function substituteStep(step: FlowStep, vars: Record<string, string>): FlowStep {
  return {
    ...step,
    url: substitute(step.url, vars),
    body: substitute(step.body, vars),
    customHeaders: substituteKv(step.customHeaders, vars),
    queryParams: substituteKv(step.queryParams, vars),
  };
}

/**
 * Try to skip a step entirely if all of its extracted variables are present in
 * the TTL cache and still fresh. This is the "smart caching" optimization:
 * don't re-login if the token is still valid.
 */
function canSkipStepFromCache(step: FlowStep, cachedVars: Record<string, string>): boolean {
  if (step.extractions.length === 0) return false;
  // Every extraction must (a) have a TTL set AND (b) have a cached value
  return step.extractions.every(
    (ex) => (ex.ttlSeconds ?? 0) > 0 && cachedVars[ex.saveAs] != null && ex.saveAs.length > 0
  );
}

interface StepOutcome {
  ok: boolean;
  statusCode: number | null;
  statusGroup: StatusGroup | null;
  errorReason: string | null;
  timings: Timings;
  assertionResults: ReturnType<typeof evaluateAssertions>;
  extractedValues: ExtractedValue[];
  attempts: number;
}

async function executeStep(
  step: FlowStep,
  vars: Record<string, string>
): Promise<StepOutcome> {
  // Resolve auth header from project API key
  const headers: Record<string, string> = {};
  if (step.apiKeyId) {
    const dummyUrl = {
      apiKeyId: step.apiKeyId,
      projectId: getStepProjectId(step),
    } as MonitoredUrl;
    const auth = resolveApiKeyHeader(dummyUrl);
    if (auth) headers[auth.name] = auth.value;
  }

  let attempt = 0;
  let backoff = step.retryBackoffMs;
  let outcome: StepOutcome | null = null;

  while (attempt <= step.maxRetries) {
    attempt++;
    const result = await timedFetch({
      url: step.url,
      method: step.method,
      bodyType: step.bodyType,
      body: step.body,
      bodyContentType: step.bodyContentType,
      extraHeaders: headers,
      customHeaders: step.customHeaders,
      queryParams: step.queryParams,
    });

    let statusCode: number | null = null;
    let statusGroup: StatusGroup | null = null;
    let errorReason: string | null = null;

    if (result.error) {
      statusGroup = "error";
      errorReason = reasonForError(result.error);
    } else {
      const code = result.statusCode ?? 0;
      statusCode = code || null;
      statusGroup = code ? classify(code) : "error";
      const isHttpFailure =
        statusGroup === "4xx" || statusGroup === "5xx" || statusGroup === "error";
      errorReason = isHttpFailure ? reasonForStatus(code) : null;
    }

    const assertionResults = evaluateAssertions(step.assertions, {
      statusCode,
      totalMs: result.timings.totalMs,
      responseBody: result.responseBody,
    });
    const statusOk = statusGroup === "2xx" || statusGroup === "3xx";
    const allAssertionsPassed = assertionResults.every((r) => r.passed);
    const stepOk = statusOk && allAssertionsPassed;

    const extractedValues = extractFromResponse({
      extractions: step.extractions,
      responseBody: result.responseBody,
      responseHeaders: result.responseHeaders,
      statusCode,
    });

    outcome = {
      ok: stepOk,
      statusCode,
      statusGroup,
      errorReason,
      timings: result.timings,
      assertionResults,
      extractedValues,
      attempts: attempt,
    };

    if (stepOk) break;
    if (attempt > step.maxRetries) break;
    await sleep(backoff);
    backoff = Math.min(backoff * 2, 30_000);
  }

  return outcome!;
}

/**
 * Look up the project the step belongs to (via its flow). Cheap lookup; could
 * be cached but flows/steps tables are small.
 */
function getStepProjectId(step: FlowStep): string {
  const flow = getFlowWithSteps(step.flowId);
  return flow?.projectId ?? "";
}

/**
 * Execute one full flow run. All steps run in order. Smart cache may skip
 * steps whose extracted variables are still TTL-fresh. On failure, the
 * `stopOnFailure` flag determines whether remaining steps are skipped.
 */
async function doRun(flowId: string): Promise<FlowRun | undefined> {
  const flow = getFlowWithSteps(flowId);
  if (!flow) return undefined;
  if (!flow.enabled) return undefined;

  const project = getProject(flow.projectId);
  const startedAt = Date.now();
  const runId = startFlowRun(flowId);

  // Seed variables from TTL cache (cross-run reuse)
  const variables: Record<string, string> = { ...getCachedVariables(flowId) };

  let allOk = true;
  let failedAtStepId: string | null = null;
  let upstreamFailed = false;

  for (const step of flow.steps) {
    if (upstreamFailed) {
      recordStepResult({
        flowRunId: runId,
        stepId: step.id,
        position: step.position,
        statusCode: null,
        statusGroup: null,
        errorReason: null,
        timings: emptyTimings(),
        assertionResults: [],
        extractedValues: [],
        attempts: 0,
        skipped: true,
        skipReason: "Upstream step failed and Stop-on-failure is ON",
        ok: false,
      });
      continue;
    }

    // Smart cache: skip if all extracted variables are TTL-fresh
    if (canSkipStepFromCache(step, variables)) {
      const cachedExtractions: ExtractedValue[] = step.extractions.map((ex) => ({
        saveAs: ex.saveAs,
        value: variables[ex.saveAs] ?? "",
        fromCache: true,
      }));
      recordStepResult({
        flowRunId: runId,
        stepId: step.id,
        position: step.position,
        statusCode: null,
        statusGroup: null,
        errorReason: null,
        timings: emptyTimings(),
        assertionResults: [],
        extractedValues: cachedExtractions,
        attempts: 0,
        skipped: true,
        skipReason: "All variables still fresh in cache (TTL valid)",
        ok: true,
      });
      continue;
    }

    // Optional wait before this step
    if (step.waitBeforeMs > 0) {
      await sleep(step.waitBeforeMs);
    }

    // Substitute {{vars}} into this step's fields
    const resolved = substituteStep(step, variables);

    const outcome = await executeStep(resolved, variables);

    // Stash extracted values into the running `variables` map AND cache them
    // with TTL if configured.
    for (const ev of outcome.extractedValues) {
      variables[ev.saveAs] = ev.value;
    }
    for (const ex of step.extractions) {
      if ((ex.ttlSeconds ?? 0) > 0 && variables[ex.saveAs] != null) {
        cacheVariable(flowId, ex.saveAs, variables[ex.saveAs], ex.ttlSeconds!);
      }
    }

    recordStepResult({
      flowRunId: runId,
      stepId: step.id,
      position: step.position,
      statusCode: outcome.statusCode,
      statusGroup: outcome.statusGroup,
      errorReason: outcome.errorReason,
      timings: outcome.timings,
      assertionResults: outcome.assertionResults,
      extractedValues: outcome.extractedValues,
      attempts: outcome.attempts,
      skipped: false,
      skipReason: null,
      ok: outcome.ok,
    });

    if (!outcome.ok) {
      allOk = false;
      if (!failedAtStepId) failedAtStepId = step.id;
      if (flow.stopOnFailure) upstreamFailed = true;
    }
  }

  const totalMs = Date.now() - startedAt;
  finishFlowRun({ id: runId, ok: allOk, failedAtStepId, variables, totalMs });
  markFlowRunCompletedAt(flowId, startedAt);

  // Slack alert on failure (won't double-send if same run is alerted from elsewhere)
  if (!allOk && project) {
    const run = getFlowRun(runId);
    if (run) {
      void sendFlowFailureAlert(flow as Flow, run, project);
    }
  }

  return getFlowRun(runId);
}

export function runFlow(flowId: string): Promise<FlowRun | undefined> {
  const existing = inFlight.get(flowId);
  if (existing) return existing;
  const p = doRun(flowId).finally(() => inFlight.delete(flowId));
  inFlight.set(flowId, p);
  return p;
}

function emptyTimings(): Timings {
  return {
    dnsMs: null,
    tcpMs: null,
    tlsMs: null,
    ttfbMs: null,
    downloadMs: null,
    totalMs: null,
  };
}
