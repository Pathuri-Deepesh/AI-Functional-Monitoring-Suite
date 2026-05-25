import { reasonForError, reasonForStatus } from "./errorReason.js";
import { evaluateAssertions } from "./assertions.js";
import { extractFromResponse, resolveVar, substitute } from "./extraction.js";
import type { Scope, ScopeStack } from "./extraction.js";
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
  /** Phase 1.18 — current iteration (1-indexed) when running a flat for-each step. null otherwise. */
  forEachIteration: number | null;
  /** Phase 1.18 — total iterations being run (capped at FOR_EACH_MAX). null when not iterating. */
  forEachTotal: number | null;
  /**
   * Phase 1.19 — full nested-iteration path (1-indexed for UI display). e.g. `[3, 7, 2]`
   * means "outer iteration 3, mid iteration 7, inner iteration 2". null when not iterating.
   * For depth-1 steps both this and `forEachIteration` are populated for back-compat.
   */
  forEachPath: number[] | null;
  /** Phase 1.19 — per-level totals matching `forEachPath` (e.g. `[10, 12, 8]`). null when not iterating. */
  forEachTotalPath: number[] | null;
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

function substituteKv(items: KeyValue[], vars: Scope | ScopeStack): KeyValue[] {
  return items.map((it) => ({ key: it.key, value: substitute(it.value, vars) }));
}

/**
 * Apply variable substitution to all string fields of a step before execution.
 * Variables come from earlier steps in the same flow run (and from the TTL cache).
 * Phase 1.19: `vars` may be a ScopeStack so inner loops can shadow outer loops.
 */
function substituteStep(step: FlowStep, vars: Scope | ScopeStack): FlowStep {
  return {
    ...step,
    url: substitute(step.url, vars),
    body: substitute(step.body, vars),
    customHeaders: substituteKv(step.customHeaders, vars),
    queryParams: substituteKv(step.queryParams, vars),
  };
}

/** Flatten a ScopeStack into a single Record (innermost wins) for APIs that need Scope. */
function flattenStack(vars: Scope | ScopeStack): Scope {
  if (!Array.isArray(vars)) return vars;
  const out: Scope = {};
  for (const s of vars) Object.assign(out, s);
  return out;
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

/**
 * Phase 1.19 — total HTTP call budget across all nested iterations in a single
 * flow run. Protects against combinatorial blow-up (e.g. 100^4 = 100M).
 * When the budget is exhausted, a `Truncated` sentinel row is emitted and the
 * remaining iterations of the active block are skipped.
 */
const TOTAL_CALL_CAP = 10_000;

/** Phase 1.19 — hard cap on for-each nesting depth (matches `assertForEachDepth`). */
const FOR_EACH_MAX_DEPTH = 4;

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
  vars: Scope | ScopeStack,
  runId?: string,
  liveExtras: {
    forEachIteration: number | null;
    forEachTotal: number | null;
    forEachPath: number[] | null;
    forEachTotalPath: number[] | null;
  } = {
    forEachIteration: null,
    forEachTotal: null,
    forEachPath: null,
    forEachTotalPath: null,
  }
): Promise<StepOutcome> {
  // Note: `vars` is used both for header/body substitution above (via substituteStep)
  // and for resolving {{vars}} inside assertion config (e.g., body-contains).
  // For assertions we flatten the stack (innermost wins) since the assertion
  // helper still takes a flat Record.
  const flatVars = flattenStack(vars);
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
        forEachPath: liveExtras.forEachPath,
        forEachTotalPath: liveExtras.forEachTotalPath,
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
      flatVars
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
        forEachPath: liveExtras.forEachPath,
        forEachTotalPath: liveExtras.forEachTotalPath,
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
 * Phase 1.19 — mutable run-wide state threaded through the recursive for-each
 * walker. Tracks failure flags + the total-call budget shared across sibling
 * blocks (so a heavy outer loop doesn't starve a later sibling).
 */
interface RunState {
  allOk: boolean;
  failedAtStepId: string | null;
  /** Set when stopOnFailure is on AND a non-iterating step has failed. */
  upstreamFailed: boolean;
  /** Total HTTP calls made in this run (counts every iteration of every nested step). */
  totalCalls: number;
  /** Set once the run has hit TOTAL_CALL_CAP — subsequent steps short-circuit. */
  truncated: boolean;
}

/**
 * Phase 1.19 — compute which contiguous for-each steps belong in the same
 * nested block starting at `startIdx`. The first step's `arrayVarName` must
 * resolve against the outer (non-loop) scope; each subsequent for-each step
 * joins the block iff its `arrayVarName`'s root identifier is the
 * `itemVarName` of an earlier step in this block (i.e. it depends on a loop
 * variable that's about to be in scope).
 *
 * Returns the list of for-each step indices in the block (length 1..4).
 * Stops at the first step that is NOT a for-each, OR whose array source
 * doesn't depend on any in-block loop variable.
 */
function computeAbsorbedBlock(steps: FlowStep[], startIdx: number): number[] {
  const block: number[] = [startIdx];
  const inScopeItemVars = new Set<string>();
  if (steps[startIdx].forEach) {
    inScopeItemVars.add(steps[startIdx].forEach!.itemVarName);
  }
  for (let j = startIdx + 1; j < steps.length; j++) {
    const cand = steps[j];
    if (!cand.forEach) break;
    const rootIdent = cand.forEach.arrayVarName.split(".")[0];
    if (!inScopeItemVars.has(rootIdent)) break;
    block.push(j);
    inScopeItemVars.add(cand.forEach.itemVarName);
    if (block.length >= FOR_EACH_MAX_DEPTH) break;
  }
  return block;
}

/**
 * Phase 1.19 — execute a nested for-each block. Each absorbed step runs once
 * per element of its array, with the current element bound in a new scope on
 * the stack. Direct-children for-each steps recurse inside each iteration.
 *
 * Returns the number of step positions consumed (so the outer driver can
 * advance past the absorbed block).
 *
 * Failure policy (locked design): iteration failures do NOT halt the flow.
 * Only the run-wide `truncated` flag and a non-iterating step's failure
 * (handled in the outer driver) can short-circuit.
 */
async function runForEachBlock(
  _flow: ReturnType<typeof getFlowWithSteps> & {},
  steps: FlowStep[],
  startIdx: number,
  outerStack: ScopeStack,
  runId: string,
  runState: RunState,
  _options: { force?: boolean }
): Promise<number> {
  const blockIndices = computeAbsorbedBlock(steps, startIdx);

  // Mutable stack of `{ scope, index, total }` frames added by the current
  // recursion path. `outerStack` is the immutable base (non-loop vars).
  const iterationStack: Array<{ scope: Scope; index: number; total: number }> = [];

  const pushScope = (scope: Scope, index: number, total: number): void => {
    iterationStack.push({ scope, index, total });
  };
  const popScope = (): void => {
    iterationStack.pop();
  };
  const currentStack = (): ScopeStack => [...outerStack, ...iterationStack.map((f) => f.scope)];
  const currentPath = (): number[] => iterationStack.map((f) => f.index);
  const currentPathCount = (): number[] => iterationStack.map((f) => f.total);

  const processBlockEntry = async (blockDepth: number): Promise<void> => {
    const stepIdx = blockIndices[blockDepth];
    const step = steps[stepIdx];
    const fe = step.forEach!;

    // The active scope stack: outerStack + one per already-iterating ancestor.
    // We rebuild this lazily by reading the closed-over `iterationStack`.
    // (Closure captures from the recursive helper below.)
    const arrRaw = resolveVar(currentStack(), fe.arrayVarName);

    // Optional wait before this step — once per iteration, mirroring 1.18.
    // We honor it before the iteration loop starts to avoid stacking sleeps
    // inside deep nests (matches "step waitBeforeMs" semantics).
    if (step.waitBeforeMs > 0) {
      await sleep(step.waitBeforeMs);
    }

    if (!Array.isArray(arrRaw)) {
      // Variable is missing or not an array — record one failure and bail out
      // of THIS branch (no iterations to run). Sibling branches continue.
      recordStepResult({
        flowRunId: runId,
        stepId: step.id,
        position: step.position,
        statusCode: null,
        statusGroup: "error",
        errorReason: arrRaw == null
          ? `forEach: variable '${fe.arrayVarName}' is not in scope`
          : `forEach: variable '${fe.arrayVarName}' is not an array`,
        timings: emptyTimings(),
        assertionResults: [],
        extractedValues: [],
        attempts: 0,
        skipped: false,
        skipReason: null,
        ok: false,
        iterationIndex: null,
        iterationCount: null,
        iterationPath: currentPath().length > 0 ? currentPath() : null,
        iterationPathCount: currentPathCount().length > 0 ? currentPathCount() : null,
      });
      runState.allOk = false;
      if (!runState.failedAtStepId) runState.failedAtStepId = step.id;
      return;
    }

    const capped = arrRaw.slice(0, FOR_EACH_MAX);
    const total = capped.length;

    // Empty array: record a single sentinel so the UI doesn't render a silent gap.
    if (total === 0) {
      recordStepResult({
        flowRunId: runId,
        stepId: step.id,
        position: step.position,
        statusCode: null,
        statusGroup: null,
        errorReason: `forEach: '${fe.arrayVarName}' resolved to an empty array — nothing to iterate`,
        timings: emptyTimings(),
        assertionResults: [],
        extractedValues: [],
        attempts: 0,
        skipped: true,
        skipReason: "for-each over empty array",
        ok: true,
        iterationIndex: null,
        iterationCount: 0,
        iterationPath: currentPath().length > 0 ? currentPath() : null,
        iterationPathCount: currentPathCount().length > 0 ? currentPathCount() : null,
      });
      return;
    }

    for (let idx = 0; idx < total; idx++) {
      // Push this iteration's scope.
      pushScope({ [fe.itemVarName]: capped[idx] }, idx, total);

      // Truncation guard — applies to every individual HTTP call.
      if (runState.totalCalls >= TOTAL_CALL_CAP) {
        recordStepResult({
          flowRunId: runId,
          stepId: step.id,
          position: step.position,
          statusCode: null,
          statusGroup: null,
          errorReason: `Truncated: total call cap (${TOTAL_CALL_CAP}) reached`,
          timings: emptyTimings(),
          assertionResults: [],
          extractedValues: [],
          attempts: 0,
          skipped: true,
          skipReason: `Truncated: total call cap (${TOTAL_CALL_CAP}) reached`,
          ok: false,
          iterationIndex: blockIndices.length === 1 ? idx : null,
          iterationCount: blockIndices.length === 1 ? total : null,
          iterationPath: blockIndices.length > 1 ? currentPath() : null,
          iterationPathCount: blockIndices.length > 1 ? currentPathCount() : null,
        });
        runState.truncated = true;
        runState.allOk = false;
        if (!runState.failedAtStepId) runState.failedAtStepId = step.id;
        popScope();
        return;
      }

      const stack = currentStack();
      const resolved = substituteStep(step, stack);

      const path = currentPath();
      const pathCount = currentPathCount();

      runState.totalCalls++;
      const outcome = await executeStep(resolved, stack, runId, {
        forEachIteration: blockIndices.length === 1 ? idx + 1 : null,
        forEachTotal: blockIndices.length === 1 ? total : null,
        forEachPath: path.length > 0 ? path.map((n) => n + 1) : null,
        forEachTotalPath: pathCount.length > 0 ? pathCount : null,
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
        // Back-compat: depth-1 rows keep iteration_index/_count populated.
        iterationIndex: blockIndices.length === 1 ? idx : null,
        iterationCount: blockIndices.length === 1 ? total : null,
        iterationPath: blockIndices.length > 1 ? path : null,
        iterationPathCount: blockIndices.length > 1 ? pathCount : null,
        resolvedUrl: resolved.url,
      });

      if (!outcome.ok) {
        runState.allOk = false;
        if (!runState.failedAtStepId) runState.failedAtStepId = step.id;
        // Per locked design: iteration failures do NOT halt the run.
      }

      // Recurse into the direct child (if any) for this iteration.
      if (blockDepth + 1 < blockIndices.length) {
        await processBlockEntry(blockDepth + 1);
      }

      popScope();
    }
  };

  await processBlockEntry(0);
  return blockIndices.length;
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

  const runState: RunState = {
    allOk: true,
    failedAtStepId: null,
    upstreamFailed: false,
    totalCalls: 0,
    truncated: false,
  };

  let i = 0;
  while (i < flow.steps.length) {
    const step = flow.steps[i];
    if (runState.upstreamFailed) {
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
      i++;
      continue;
    }

    // For-each step at the top level — absorb a contiguous nested block and
    // recurse. `consumed` is the number of contiguous for-each steps that
    // belong to this nested block (1..FOR_EACH_MAX_DEPTH).
    if (step.forEach) {
      const consumed = await runForEachBlock(flow, flow.steps, i, [variables], runId, runState, options);
      i += consumed;
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
      i++;
      continue;
    }

    // Optional wait before this step
    if (step.waitBeforeMs > 0) {
      await sleep(step.waitBeforeMs);
    }

    // ============================================================
    // Normal (non-iterating) path
    // ============================================================
    const resolved = substituteStep(step, variables);

    // Total-call budget guard for non-iterating steps too. (Unlikely to trip
    // here unless a very long flat flow runs after a heavy nested block.)
    if (runState.totalCalls >= TOTAL_CALL_CAP) {
      recordStepResult({
        flowRunId: runId,
        stepId: step.id,
        position: step.position,
        statusCode: null,
        statusGroup: null,
        errorReason: `Truncated: total call cap (${TOTAL_CALL_CAP}) reached`,
        timings: emptyTimings(),
        assertionResults: [],
        extractedValues: [],
        attempts: 0,
        skipped: true,
        skipReason: `Truncated: total call cap (${TOTAL_CALL_CAP}) reached`,
        ok: false,
      });
      runState.truncated = true;
      runState.allOk = false;
      if (!runState.failedAtStepId) runState.failedAtStepId = step.id;
      i++;
      continue;
    }

    runState.totalCalls++;
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
      resolvedUrl: resolved.url,
    });

    if (!outcome.ok) {
      runState.allOk = false;
      if (!runState.failedAtStepId) runState.failedAtStepId = step.id;
      if (flow.stopOnFailure) runState.upstreamFailed = true;
    }
    i++;
  }

  const allOk = runState.allOk;
  const failedAtStepId = runState.failedAtStepId;

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
