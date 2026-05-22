import { reasonForError, reasonForStatus } from "./errorReason.js";
import { evaluateAssertions } from "./assertions.js";
import { extractFromResponse, substitute } from "./extraction.js";
import {
  cacheProjectVariable,
  finishPrereqRun,
  getProject,
  getProjectVariables,
  getPrereqRun,
  listPrereqSteps,
  markPrereqRunCompletedAt,
  recordPrereqStepResult,
  resolveApiKeyHeader,
  startPrereqRun,
} from "./store.js";
import { timedFetch } from "./timing.js";
import type {
  ExtractedValue,
  KeyValue,
  MonitoredUrl,
  PrereqRun,
  PrereqStep,
  StatusGroup,
  Timings,
} from "./types.js";

interface InFlightPrereq {
  runId: string;
  done: Promise<PrereqRun | undefined>;
}

const inFlight = new Map<string, InFlightPrereq>();

// Live per-step progress for mid-flight runs (see flowRunner for full docs)
export interface LiveStepProgress {
  stepId: string;
  position: number;
  attempt: number;
  maxAttempts: number;
  lastStatusCode: number | null;
  lastErrorReason: string | null;
  phase: "executing" | "backoff";
  nextRetryAtMs: number | null;
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

function substituteKv(items: KeyValue[], vars: Record<string, string>): KeyValue[] {
  return items.map((it) => ({ key: it.key, value: substitute(it.value, vars) }));
}

function substituteStep(step: PrereqStep, vars: Record<string, string>): PrereqStep {
  return {
    ...step,
    url: substitute(step.url, vars),
    body: substitute(step.body, vars),
    customHeaders: substituteKv(step.customHeaders, vars),
    queryParams: substituteKv(step.queryParams, vars),
  };
}

function canSkipStepFromCache(step: PrereqStep, cachedVars: Record<string, string>): boolean {
  if (step.extractions.length === 0) return false;
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
  step: PrereqStep,
  vars: Record<string, string>,
  runId?: string
): Promise<StepOutcome> {
  const headers: Record<string, string> = {};
  if (step.apiKeyId) {
    const dummyUrl = {
      apiKeyId: step.apiKeyId,
      projectId: step.projectId,
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
    lastStatusCode = statusCode;
    lastErrorReason = errorReason;
    if (attempt > step.maxRetries) break;
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
      });
    }
    await sleep(backoff);
    backoff = Math.min(backoff * 2, 30_000);
  }

  return outcome!;
}

/**
 * Run the project's prereq chain. Sequential, stop-on-failure (always — these
 * are setup steps and downstream depends on upstream tokens). Captured
 * variables with a TTL are persisted to the project pool so URLs and Flows
 * can reference them via `{{name}}`.
 *
 * Takes a pre-created runId so callers can poll progress while it executes.
 */
async function executeRun(
  projectId: string,
  runId: string,
  startedAt: number,
  options: { force?: boolean } = {}
): Promise<PrereqRun | undefined> {
  const steps = listPrereqSteps(projectId);

  // Seed from already-cached project vars (so a partial chain can reuse a fresh token)
  const variables: Record<string, string> = { ...getProjectVariables(projectId) };

  let allOk = true;
  let failedAtStepId: string | null = null;
  let upstreamFailed = false;

  for (const step of steps) {
    if (upstreamFailed) {
      recordPrereqStepResult({
        prereqRunId: runId,
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
        skipReason: "Upstream prereq step failed",
        ok: false,
      });
      continue;
    }

    // Smart cache — bypassed when `force` is set (manual Run-now click).
    if (!options.force && canSkipStepFromCache(step, variables)) {
      const cachedExtractions: ExtractedValue[] = step.extractions.map((ex) => ({
        saveAs: ex.saveAs,
        value: variables[ex.saveAs] ?? "",
        fromCache: true,
      }));
      recordPrereqStepResult({
        prereqRunId: runId,
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
        skipReason: "All variables still fresh in project pool (TTL valid)",
        ok: true,
      });
      continue;
    }

    if (step.waitBeforeMs > 0) {
      await sleep(step.waitBeforeMs);
    }

    const resolved = substituteStep(step, variables);
    const outcome = await executeStep(resolved, variables, runId);

    // Stash into the in-run variables map and persist to the project pool with TTL.
    // Phase 1.18: ev.value may be an array (from a `[*]` JSONPath extract) — JSON-stringify
    // it for the string-typed project variable pool.
    for (const ev of outcome.extractedValues) {
      variables[ev.saveAs] = typeof ev.value === "string" ? ev.value : JSON.stringify(ev.value);
    }
    for (const ex of step.extractions) {
      if ((ex.ttlSeconds ?? 0) > 0 && variables[ex.saveAs] != null) {
        cacheProjectVariable(projectId, ex.saveAs, variables[ex.saveAs], ex.ttlSeconds!);
      }
    }

    recordPrereqStepResult({
      prereqRunId: runId,
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
      upstreamFailed = true; // prereqs always stop on failure
    }
  }

  const totalMs = Date.now() - startedAt;
  finishPrereqRun({ id: runId, ok: allOk, failedAtStepId, variables, totalMs });
  markPrereqRunCompletedAt(projectId, startedAt);
  liveStepByRun.delete(runId);

  return getPrereqRun(runId);
}

/**
 * Create a prereq run row immediately + kick off in background.
 * Returns runId synchronously so callers can poll step-by-step progress.
 */
export function kickoffPrereqChain(
  projectId: string,
  options: { force?: boolean } = {}
): { runId: string; alreadyRunning: boolean } | undefined {
  const existing = inFlight.get(projectId);
  if (existing) return { runId: existing.runId, alreadyRunning: true };

  const project = getProject(projectId);
  if (!project) return undefined;

  const startedAt = Date.now();
  const runId = startPrereqRun(projectId);
  const done = executeRun(projectId, runId, startedAt, options).finally(() => inFlight.delete(projectId));
  inFlight.set(projectId, { runId, done });
  return { runId, alreadyRunning: false };
}

/** Blocking variant — used by the scheduler tick. */
export function runPrereqChain(projectId: string): Promise<PrereqRun | undefined> {
  const started = kickoffPrereqChain(projectId);
  if (!started) return Promise.resolve(undefined);
  return inFlight.get(projectId)?.done ?? Promise.resolve(undefined);
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
