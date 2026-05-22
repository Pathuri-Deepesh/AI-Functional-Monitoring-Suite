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
  getProjectVariables,
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

interface InFlightRun {
  runId: string;
  done: Promise<FlowRun | undefined>;
}

const inFlight = new Map<string, InFlightRun>();

/**
 * Live per-step progress while a run is mid-flight. Lets the frontend show
 * "retry 2 of 4" or "waiting for retry…" instead of an opaque spinner during
 * the gap between attempts. Cleared when the step (and run) finishes.
 */
export interface LiveStepProgress {
  stepId: string;
  position: number;
  attempt: number;       // 1-indexed: 1 = first try, 2 = first retry, ...
  maxAttempts: number;   // maxRetries + 1
  lastStatusCode: number | null;
  lastErrorReason: string | null;
  phase: "executing" | "backoff";
  nextRetryAtMs: number | null; // wall clock when the next attempt fires (during backoff)
  /** Phase 1.18 — current iteration (1-indexed) when running a for-each step. null otherwise. */
  forEachIteration: number | null;
  /** Phase 1.18 — total iterations being run (capped at FOR_EACH_MAX). null when not iterating. */
  forEachTotal: number | null;
}
const liveStepByRun = new Map<string, LiveStepProgress>();

export function getLiveStepProgress(runId: string): LiveStepProgress | undefined {
  return liveStepByRun.get(runId);
}

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

function substituteKv(items: KeyValue[], vars: Record<string, unknown>): KeyValue[] {
  return items.map((it) => ({ key: it.key, value: substitute(it.value, vars) }));
}

/**
 * Apply variable substitution to all string fields of a step before execution.
 * Variables come from earlier steps in the same flow run (and from the TTL cache).
 * Phase 1.18: vars may include object/array values (e.g., a for-each iteration item).
 */
function substituteStep(step: FlowStep, vars: Record<string, unknown>): FlowStep {
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
function canSkipStepFromCache(step: FlowStep, cachedVars: Record<string, unknown>): boolean {
  if (step.extractions.length === 0) return false;
  // Every extraction must (a) have a TTL set AND (b) have a cached value
  return step.extractions.every(
    (ex) => (ex.ttlSeconds ?? 0) > 0 && cachedVars[ex.saveAs] != null && ex.saveAs.length > 0
  );
}

/**
 * Phase 1.18 — coerce a variable value to the string form expected by the
 * flow_runs.variables_json snapshot, the variable_cache table, and Slack alerts.
 * Arrays/objects become JSON; scalars pass through.
 */
function varToString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function flattenVariables(vars: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) out[k] = varToString(v);
  return out;
}

/** Phase 1.18 — hard cap on iterations for a single for-each step. */
const FOR_EACH_MAX = 100;

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
  vars: Record<string, unknown>,
  runId?: string,
  liveExtras: { forEachIteration: number | null; forEachTotal: number | null } = {
    forEachIteration: null,
    forEachTotal: null,
  }
): Promise<StepOutcome> {
  // Note: `vars` is used both for header/body substitution above (via substituteStep)
  // and for resolving {{vars}} inside assertion config (e.g., body-contains).
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

  const maxAttempts = step.maxRetries + 1;
  let attempt = 0;
  let backoff = step.retryBackoffMs;
  let outcome: StepOutcome | null = null;
  let lastStatusCode: number | null = null;
  let lastErrorReason: string | null = null;

  while (attempt <= step.maxRetries) {
    attempt++;
    // Publish live progress so the frontend can show "▶ RUNNING" on attempt 1
    // and "🔁 RETRY N/M" on subsequent attempts.
    if (runId) {
      liveStepByRun.set(runId, {
        stepId: step.id,
        position: step.position,
        attempt,
        maxAttempts,
        lastStatusCode,
        lastErrorReason,
        phase: "executing",
        nextRetryAtMs: null,
        forEachIteration: liveExtras.forEachIteration,
        forEachTotal: liveExtras.forEachTotal,
      });
    }
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

    const assertionResults = evaluateAssertions(
      step.assertions,
      {
        statusCode,
        totalMs: result.timings.totalMs,
        responseBody: result.responseBody,
      },
      vars
    );
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
    // Remember this attempt's failure signal so the next live update shows it
    lastStatusCode = statusCode;
    lastErrorReason = errorReason;
    if (attempt > step.maxRetries) break;
    // Publish backoff phase — UI shows "Waiting 1.5s before retry…"
    if (runId) {
      liveStepByRun.set(runId, {
        stepId: step.id,
        position: step.position,
        attempt,
        maxAttempts,
        lastStatusCode,
        lastErrorReason,
        phase: "backoff",
        nextRetryAtMs: Date.now() + backoff,
        forEachIteration: liveExtras.forEachIteration,
        forEachTotal: liveExtras.forEachTotal,
      });
    }
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
 *
 * Takes a pre-created runId so callers can know it before execution starts —
 * letting them poll progress without waiting for the whole run to finish.
 */
async function executeRun(
  flow: ReturnType<typeof getFlowWithSteps> & {},
  runId: string,
  startedAt: number,
  options: { force?: boolean } = {}
): Promise<FlowRun | undefined> {
  const project = getProject(flow.projectId);

  // Seed variables. Order matters: project pool first (lowest priority), then
  // flow-scoped TTL cache (flow-scoped wins on name conflict).
  // Phase 1.18: this map now holds `unknown` values — arrays (from `[*]` extracts)
  // and per-iteration item objects (during a for-each step) live alongside strings.
  const variables: Record<string, unknown> = {
    ...getProjectVariables(flow.projectId),
    ...getCachedVariables(flow.id),
  };

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

    // Smart cache: skip if all extracted variables are TTL-fresh.
    // Always bypassed when `force` is set — the manual "Run now" button must
    // do real work or it feels broken to the user.
    if (!options.force && canSkipStepFromCache(step, variables)) {
      const cachedExtractions: ExtractedValue[] = step.extractions.map((ex) => ({
        saveAs: ex.saveAs,
        value: varToString(variables[ex.saveAs] ?? ""),
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

    // ============================================================
    // Phase 1.18 — For-each iteration branch
    // ============================================================
    if (step.forEach) {
      const arr = variables[step.forEach.arrayVarName];
      if (!Array.isArray(arr)) {
        recordStepResult({
          flowRunId: runId,
          stepId: step.id,
          position: step.position,
          statusCode: null,
          statusGroup: "error",
          errorReason: `forEach: variable '${step.forEach.arrayVarName}' is not an array`,
          timings: emptyTimings(),
          assertionResults: [],
          extractedValues: [],
          attempts: 0,
          skipped: false,
          skipReason: null,
          ok: false,
          iterationIndex: null,
          iterationCount: null,
        });
        allOk = false;
        if (!failedAtStepId) failedAtStepId = step.id;
        if (flow.stopOnFailure) upstreamFailed = true;
        continue;
      }

      const capped = arr.slice(0, FOR_EACH_MAX);
      const total = capped.length;
      let anyOk = false;
      let anyFailed = false;

      for (let i = 0; i < total; i++) {
        const iterationVars: Record<string, unknown> = {
          ...variables,
          [step.forEach.itemVarName]: capped[i],
        };
        const resolved = substituteStep(step, iterationVars);
        const outcome = await executeStep(resolved, iterationVars, runId, {
          forEachIteration: i + 1,
          forEachTotal: total,
        });

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
          iterationIndex: i,
          iterationCount: total,
        });

        if (outcome.ok) anyOk = true;
        else anyFailed = true;
      }

      // The for-each step as a whole is "ok" iff every iteration passed.
      // We deliberately never set `upstreamFailed` here — iteration failures
      // don't halt the flow (matches the locked design: continue + report).
      if (anyFailed) {
        allOk = false;
        if (!failedAtStepId) failedAtStepId = step.id;
      }
      // If the array was empty, record a single sentinel result so the UI has
      // something to show ("for each (0)") rather than a silent gap.
      if (total === 0) {
        recordStepResult({
          flowRunId: runId,
          stepId: step.id,
          position: step.position,
          statusCode: null,
          statusGroup: null,
          errorReason: `forEach: '${step.forEach.arrayVarName}' resolved to an empty array — nothing to iterate`,
          timings: emptyTimings(),
          assertionResults: [],
          extractedValues: [],
          attempts: 0,
          skipped: true,
          skipReason: "for-each over empty array",
          ok: true,
          iterationIndex: null,
          iterationCount: 0,
        });
      }
      void anyOk; // (kept for future "at least one passed" semantics)
      continue;
    }

    // ============================================================
    // Normal (non-iterating) path
    // ============================================================
    const resolved = substituteStep(step, variables);

    const outcome = await executeStep(resolved, variables, runId);

    // Stash extracted values into the running `variables` map AND cache them
    // with TTL if configured. Arrays stay as arrays in memory but JSON-stringify
    // on the way into the TTL cache (which is a TEXT column).
    for (const ev of outcome.extractedValues) {
      variables[ev.saveAs] = ev.value;
    }
    for (const ex of step.extractions) {
      if ((ex.ttlSeconds ?? 0) > 0 && variables[ex.saveAs] != null) {
        cacheVariable(flow.id, ex.saveAs, varToString(variables[ex.saveAs]), ex.ttlSeconds!);
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
  finishFlowRun({ id: runId, ok: allOk, failedAtStepId, variables: flattenVariables(variables), totalMs });
  markFlowRunCompletedAt(flow.id, startedAt);
  // Tear down the live-progress slot — no more attempts coming for this run
  liveStepByRun.delete(runId);

  // Slack alert on failure (won't double-send if same run is alerted from elsewhere)
  if (!allOk && project) {
    const run = getFlowRun(runId);
    if (run) {
      void sendFlowFailureAlert(flow as Flow, run, project);
    }
  }

  return getFlowRun(runId);
}

/**
 * Create a run row immediately + kick off execution in the background.
 * Returns the runId synchronously so callers can poll step-by-step progress
 * while the flow is still running.
 */
export function kickoffFlow(
  flowId: string,
  options: { force?: boolean } = {}
): { runId: string; alreadyRunning: boolean } | undefined {
  const existing = inFlight.get(flowId);
  if (existing) return { runId: existing.runId, alreadyRunning: true };

  const flow = getFlowWithSteps(flowId);
  if (!flow || !flow.enabled) return undefined;

  const startedAt = Date.now();
  const runId = startFlowRun(flowId);
  const done = executeRun(flow, runId, startedAt, options).finally(() => inFlight.delete(flowId));
  inFlight.set(flowId, { runId, done });
  return { runId, alreadyRunning: false };
}

/**
 * Run a flow and wait for it to finish. Existing blocking semantics —
 * kept for the scheduler tick and any callers that want the final result.
 */
export function runFlow(flowId: string): Promise<FlowRun | undefined> {
  const started = kickoffFlow(flowId);
  if (!started) return Promise.resolve(undefined);
  return inFlight.get(flowId)?.done ?? Promise.resolve(undefined);
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
