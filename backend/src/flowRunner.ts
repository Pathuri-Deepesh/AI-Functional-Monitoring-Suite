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
  const variables: Record<string, string> = {
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
        cacheVariable(flow.id, ex.saveAs, variables[ex.saveAs], ex.ttlSeconds!);
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
  markFlowRunCompletedAt(flow.id, startedAt);

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
