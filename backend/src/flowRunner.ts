import { reasonForError, reasonForStatus } from "./errorReason.js";
import { evaluateAssertions } from "./assertions.js";
import {
  applyComputeTransform,
  extractFromResponse,
  resolveVar,
  substitute,
} from "./extraction.js";
import type { Scope, ScopeStack } from "./extraction.js";
import {
  cacheVariable,
  finishFlowRun,
  getCachedVariables,
  getFlowRun,
  getFlowWithSteps,
  getProject,
  getProjectApiKeysScope,
  getProjectVariables,
  listFlowRuns,
  markFlowRunCompletedAt,
  recordStepResult,
  resolveApiKeyHeader,
  startFlowRun,
} from "./store.js";
import { timedFetch } from "./timing.js";
import { sendFlowFailureAlert } from "./slack.js";
import { classifyFailure, pickRecipients, pickSlackWebhook, sendFlowFailureEmail } from "./email.js";
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
  attempt: number;
  maxAttempts: number;
  lastStatusCode: number | null;
  lastErrorReason: string | null;
  phase: "executing" | "backoff";
  nextRetryAtMs: number | null;
  forEachIteration: number | null;
  forEachTotal: number | null;
  forEachPath: number[] | null;
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

function substituteStep(step: FlowStep, vars: Scope | ScopeStack): FlowStep {
  return {
    ...step,
    url: substitute(step.url, vars),
    body: substitute(step.body, vars),
    customHeaders: substituteKv(step.customHeaders, vars),
    queryParams: substituteKv(step.queryParams, vars),
  };
}

function flattenStack(vars: Scope | ScopeStack): Scope {
  if (!Array.isArray(vars)) return vars;
  const out: Scope = {};
  for (const s of vars) Object.assign(out, s);
  return out;
}

function canSkipStepFromCache(step: FlowStep, cachedVars: Record<string, unknown>): boolean {
  if (step.extractions.length === 0) return false;
  return step.extractions.every(
    (ex) => (ex.ttlSeconds ?? 0) > 0 && cachedVars[ex.saveAs] != null && ex.saveAs.length > 0
  );
}

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

/** Phase 1.19 — total HTTP call budget across all nested iterations. */
const TOTAL_CALL_CAP = 10_000;

/** Phase 1.19 — hard cap on for-each nesting depth. */
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
  const flatVars = flattenStack(vars);
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

function getStepProjectId(step: FlowStep): string {
  const flow = getFlowWithSteps(step.flowId);
  return flow?.projectId ?? "";
}

/**
 * Phase 1.19 — run-wide state threaded through tree recursion. Tracks failure
 * flags + the total-call budget shared across sibling branches.
 */
interface RunState {
  allOk: boolean;
  failedAtStepId: string | null;
  upstreamFailed: boolean;
  totalCalls: number;
  truncated: boolean;
}

// ============================================================================
// Phase 1.23 — explicit step levels + tree-shaped execution.
//
// A step's `level` (1..4) declares it as a child of the most-recent preceding
// step at level-1 above. We materialize that into an ExecNode forest at run
// start, then walk it recursively. For-each parents run their children inside
// EACH iteration (so sibling /discover + /home both run for the same campaign).
// ============================================================================

type ExecNode = {
  stepIdx: number;
  children: ExecNode[];
  /** True iff this node's subtree contains at least one for-each step. Used
   *  with iterationStack depth to decide single-axis vs multi-axis iteration
   *  reporting. Pre-computed once at tree build time. */
  hasForEachDescendant: boolean;
};

function buildExecutionTree(steps: FlowStep[]): ExecNode[] {
  const roots: ExecNode[] = [];
  const lastAtLevel: (ExecNode | null)[] = [null, null, null, null, null];
  for (let i = 0; i < steps.length; i++) {
    const node: ExecNode = { stepIdx: i, children: [], hasForEachDescendant: false };
    const lvl = Math.max(1, Math.min(4, steps[i].level || 1));
    if (lvl === 1) {
      roots.push(node);
    } else {
      const parent = lastAtLevel[lvl - 1];
      if (parent) parent.children.push(node);
      else roots.push(node); // safety net: orphaned → promote to root
    }
    lastAtLevel[lvl] = node;
    for (let j = lvl + 1; j <= FOR_EACH_MAX_DEPTH; j++) lastAtLevel[j] = null;
  }
  const markDescendants = (node: ExecNode): boolean => {
    let found = false;
    for (const c of node.children) {
      const childHas = markDescendants(c);
      if (steps[c.stepIdx].forEach || childHas) found = true;
    }
    node.hasForEachDescendant = found;
    return found;
  };
  for (const r of roots) markDescendants(r);
  return roots;
}

/** Walk a node + all descendants, recording one "skipped — upstream failed" row each. */
function recordSkipForNode(node: ExecNode, steps: FlowStep[], runId: string): void {
  const step = steps[node.stepIdx];
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
  for (const c of node.children) recordSkipForNode(c, steps, runId);
}

/**
 * Execute one tree node. Branches on step shape:
 *   - for-each: iterate, push scope, run own HTTP (unless loop step), recurse children per iteration.
 *   - compute:  apply transforms, write vars, recurse children.
 *   - HTTP:     smart-cache check (top-level only) → call → record → recurse children.
 *
 * `iterationStack` is mutated as we descend (push on iter start, pop on iter end).
 * `baseStack` holds the run-wide variable scope (project vars + TTL cache + top-level
 * extractions); never mutated by reference, but its contents (baseStack[0]) ARE updated
 * by top-level extractions and compute steps so cross-step variable reads work.
 */
async function executeNode(
  node: ExecNode,
  steps: FlowStep[],
  baseStack: ScopeStack,
  iterationStack: Array<{ scope: Scope; index: number; total: number }>,
  runId: string,
  runState: RunState,
  flow: ReturnType<typeof getFlowWithSteps> & {},
  options: { force?: boolean }
): Promise<void> {
  if (runState.upstreamFailed) {
    recordSkipForNode(node, steps, runId);
    return;
  }

  const step = steps[node.stepIdx];

  const currentStack = (): ScopeStack => [...baseStack, ...iterationStack.map((f) => f.scope)];
  const currentPath = (): number[] => iterationStack.map((f) => f.index);
  const currentPathCount = (): number[] => iterationStack.map((f) => f.total);

  // ------------------------------------------------------------------ FOR-EACH
  if (step.forEach) {
    const fe = step.forEach;

    if (step.waitBeforeMs > 0) await sleep(step.waitBeforeMs);

    const arrRaw = resolveVar(currentStack(), fe.arrayVarName);

    if (!Array.isArray(arrRaw)) {
      recordStepResult({
        flowRunId: runId,
        stepId: step.id,
        position: step.position,
        statusCode: null,
        statusGroup: "error",
        errorReason:
          arrRaw == null
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
        iterationPath: iterationStack.length > 0 ? currentPath() : null,
        iterationPathCount: iterationStack.length > 0 ? currentPathCount() : null,
      });
      runState.allOk = false;
      if (!runState.failedAtStepId) runState.failedAtStepId = step.id;
      return;
    }

    const capped = arrRaw.slice(0, FOR_EACH_MAX);
    const total = capped.length;

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
        iterationPath: iterationStack.length > 0 ? currentPath() : null,
        iterationPathCount: iterationStack.length > 0 ? currentPathCount() : null,
      });
      return;
    }

    const isLoopStep = (step.stepType ?? "http") === "loop";

    for (let idx = 0; idx < total; idx++) {
      iterationStack.push({ scope: { [fe.itemVarName]: capped[idx] }, index: idx, total });

      const newDepth = iterationStack.length;
      // Multi-axis when there's an active outer iteration OR this subtree
      // contains further for-each levels. Single-axis only when this is a flat
      // depth-1 loop with no nested iteration anywhere below.
      const useMulti = newDepth > 1 || node.hasForEachDescendant;

      if (!isLoopStep && runState.totalCalls >= TOTAL_CALL_CAP) {
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
          iterationIndex: !useMulti ? idx : null,
          iterationCount: !useMulti ? total : null,
          iterationPath: useMulti ? currentPath() : null,
          iterationPathCount: useMulti ? currentPathCount() : null,
        });
        runState.truncated = true;
        runState.allOk = false;
        if (!runState.failedAtStepId) runState.failedAtStepId = step.id;
        iterationStack.pop();
        return;
      }

      if (!isLoopStep) {
        const stack = currentStack();
        const resolved = substituteStep(step, stack);
        const path = currentPath();
        const pathCount = currentPathCount();

        runState.totalCalls++;
        const outcome = await executeStep(resolved, stack, runId, {
          forEachIteration: !useMulti ? idx + 1 : null,
          forEachTotal: !useMulti ? total : null,
          forEachPath: path.length > 0 ? path.map((n) => n + 1) : null,
          forEachTotalPath: pathCount.length > 0 ? pathCount : null,
        });

        // Per-iteration extractions land in the current iteration frame so
        // sibling L(N+1) children inside the SAME iteration can read them.
        const topFrame = iterationStack[iterationStack.length - 1];
        for (const ev of outcome.extractedValues) {
          topFrame.scope[ev.saveAs] = ev.value;
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
          iterationIndex: !useMulti ? idx : null,
          iterationCount: !useMulti ? total : null,
          iterationPath: useMulti ? path : null,
          iterationPathCount: useMulti ? pathCount : null,
          resolvedUrl: resolved.url,
        });

        if (!outcome.ok) {
          runState.allOk = false;
          if (!runState.failedAtStepId) runState.failedAtStepId = step.id;
          // Per locked design: iteration failures do NOT halt the run.
        }
      }

      // Run children inside THIS iteration's scope.
      for (const child of node.children) {
        if (runState.upstreamFailed) break;
        await executeNode(child, steps, baseStack, iterationStack, runId, runState, flow, options);
      }

      iterationStack.pop();
    }

    // Phase 1.22 — Loop step summary row.
    if (isLoopStep) {
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
        attempts: 1,
        skipped: false,
        skipReason: null,
        ok: true,
        iterationIndex: null,
        iterationCount: total,
        iterationPath: null,
        iterationPathCount: null,
      });
    }
    return;
  }

  // ------------------------------------------------------------------- COMPUTE
  if ((step.stepType ?? "http") === "compute") {
    const outcome = runComputeStep(step, flattenStack(currentStack()));
    // Write into whichever scope the step lives in: iteration frame if nested,
    // else the run-wide base scope so subsequent top-level steps can read it.
    if (iterationStack.length > 0) {
      const topFrame = iterationStack[iterationStack.length - 1];
      for (const ev of outcome.extractedValues) {
        topFrame.scope[ev.saveAs] = ev.value;
      }
    } else {
      const base = baseStack[0] as Record<string, unknown>;
      for (const ev of outcome.extractedValues) {
        base[ev.saveAs] = ev.value;
      }
    }
    recordStepResult({
      flowRunId: runId,
      stepId: step.id,
      position: step.position,
      statusCode: null,
      statusGroup: null,
      errorReason: outcome.errorReason,
      timings: emptyTimings(),
      assertionResults: [],
      extractedValues: outcome.extractedValues.map((ev) => ({
        saveAs: ev.saveAs,
        value: computedValueToPersist(ev.value),
        fromCache: false,
      })),
      attempts: 1,
      skipped: false,
      skipReason: null,
      ok: outcome.ok,
      iterationIndex: null,
      iterationCount: null,
      iterationPath: iterationStack.length > 0 ? currentPath() : null,
      iterationPathCount: iterationStack.length > 0 ? currentPathCount() : null,
    });
    if (!outcome.ok) {
      runState.allOk = false;
      if (!runState.failedAtStepId) runState.failedAtStepId = step.id;
      if (flow.stopOnFailure && iterationStack.length === 0) {
        runState.upstreamFailed = true;
      }
    }
    for (const child of node.children) {
      if (runState.upstreamFailed) break;
      await executeNode(child, steps, baseStack, iterationStack, runId, runState, flow, options);
    }
    return;
  }

  // -------------------------------------------------------------- HTTP (plain)
  const variables = flattenStack(currentStack());

  // Smart cache only applies at top level — iteration-scoped vars get rewritten
  // each iteration so caching them would skip valid work.
  if (iterationStack.length === 0 && !options.force && canSkipStepFromCache(step, variables)) {
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
    for (const child of node.children) {
      if (runState.upstreamFailed) break;
      await executeNode(child, steps, baseStack, iterationStack, runId, runState, flow, options);
    }
    return;
  }

  if (step.waitBeforeMs > 0) await sleep(step.waitBeforeMs);

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
      iterationIndex: null,
      iterationCount: null,
      iterationPath: iterationStack.length > 0 ? currentPath() : null,
      iterationPathCount: iterationStack.length > 0 ? currentPathCount() : null,
    });
    runState.truncated = true;
    runState.allOk = false;
    if (!runState.failedAtStepId) runState.failedAtStepId = step.id;
    return;
  }

  const stack = currentStack();
  const resolved = substituteStep(step, stack);
  const path = currentPath();
  const pathCount = currentPathCount();
  const inIteration = iterationStack.length > 0;
  // HTTP children of a single-axis loop with no nested for-each show the
  // friendly "iter N of M" pill; multi-axis paths show the [a,b,c] form.
  const useMulti = iterationStack.length > 1 || node.hasForEachDescendant;

  runState.totalCalls++;
  const outcome = await executeStep(resolved, stack, runId, {
    forEachIteration: inIteration && !useMulti ? iterationStack[iterationStack.length - 1].index + 1 : null,
    forEachTotal: inIteration && !useMulti ? iterationStack[iterationStack.length - 1].total : null,
    forEachPath: path.length > 0 ? path.map((n) => n + 1) : null,
    forEachTotalPath: pathCount.length > 0 ? pathCount : null,
  });

  // Top-level extractions update the run-wide scope + TTL cache. Iteration-scoped
  // extractions only update the current iteration frame (visible to sibling children).
  if (!inIteration) {
    const base = baseStack[0] as Record<string, unknown>;
    for (const ev of outcome.extractedValues) {
      base[ev.saveAs] = ev.value;
    }
    for (const ex of step.extractions) {
      if ((ex.ttlSeconds ?? 0) > 0 && base[ex.saveAs] != null) {
        cacheVariable(flow.id, ex.saveAs, varToString(base[ex.saveAs]), ex.ttlSeconds!);
      }
    }
  } else {
    const topFrame = iterationStack[iterationStack.length - 1];
    for (const ev of outcome.extractedValues) {
      topFrame.scope[ev.saveAs] = ev.value;
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
    iterationIndex: inIteration && !useMulti ? iterationStack[iterationStack.length - 1].index : null,
    iterationCount: inIteration && !useMulti ? iterationStack[iterationStack.length - 1].total : null,
    iterationPath: inIteration && useMulti ? path : null,
    iterationPathCount: inIteration && useMulti ? pathCount : null,
    resolvedUrl: resolved.url,
  });

  if (!outcome.ok) {
    runState.allOk = false;
    if (!runState.failedAtStepId) runState.failedAtStepId = step.id;
    if (flow.stopOnFailure && !inIteration) {
      runState.upstreamFailed = true;
    }
  }

  for (const child of node.children) {
    if (runState.upstreamFailed) break;
    await executeNode(child, steps, baseStack, iterationStack, runId, runState, flow, options);
  }
}

/**
 * Execute one full flow run. Builds the L1..L4 execution tree from the flat
 * step list and walks the root forest. Smart cache may skip top-level steps
 * whose extracted variables are still TTL-fresh.
 */
async function executeRun(
  flow: ReturnType<typeof getFlowWithSteps> & {},
  runId: string,
  startedAt: number,
  options: { force?: boolean } = {}
): Promise<FlowRun | undefined> {
  const project = getProject(flow.projectId);

  // Phase 1.27.4 — apiKeysScope at the bottom of the merge so prereq-captured
  // project vars and per-flow cache can override on name collision.
  const variables: Record<string, unknown> = {
    ...getProjectApiKeysScope(flow.projectId),
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

  const roots = buildExecutionTree(flow.steps);
  for (const root of roots) {
    await executeNode(root, flow.steps, [variables], [], runId, runState, flow, options);
  }

  const allOk = runState.allOk;
  const failedAtStepId = runState.failedAtStepId;

  const totalMs = Date.now() - startedAt;
  finishFlowRun({ id: runId, ok: allOk, failedAtStepId, variables: flattenVariables(variables), totalMs });
  markFlowRunCompletedAt(flow.id, startedAt);
  liveStepByRun.delete(runId);

  if (!allOk && project) {
    const run = getFlowRun(runId);
    if (run) {
      const failedStep =
        flow.steps.find((s) => s.id === run.failedAtStepId) ?? null;

      // OK→FAIL gate + reason-change escalation. Mirrors the URL path in
      // monitor.ts so a flow that fails every interval doesn't spam an alert
      // every run. listFlowRuns is DESC and includes the just-finished run, so
      // we filter by id to find the truly-previous run.
      const recent = listFlowRuns(flow.id, 2);
      const previousRun = recent.find((r) => r.id !== runId) ?? null;
      const previousReason = previousRun
        ? previousRun.stepResults.find((sr) => sr.stepId === previousRun.failedAtStepId)
            ?.errorReason ?? null
        : null;
      const currentReason =
        run.stepResults.find((sr) => sr.stepId === run.failedAtStepId)?.errorReason ?? null;

      const shouldAlert =
        previousRun == null ||           // first-ever run for this flow
        previousRun.ok === true ||       // OK→FAIL transition
        previousReason !== currentReason; // failing for a NEW reason — escalate

      if (shouldAlert) {
        // Phase 1.27.2 — classify the failed step's assertion mix and route
        // a latency-only failure to the dedicated recipient list.
        const failedStepResult = run.stepResults.find(
          (sr) => sr.stepId === run.failedAtStepId
        );
        const category = classifyFailure(failedStepResult?.assertionResults ?? []);
        const emailRecipients = pickRecipients(project, category);
        // Phase 1.27.13 — Slack picked by category, mirroring email routing.
        const slackWebhook = pickSlackWebhook(project, category);
        void Promise.allSettled([
          sendFlowFailureAlert(slackWebhook, flow as Flow, run, project),
          sendFlowFailureEmail(flow as Flow, run, project, failedStep, emailRecipients),
        ]);
      }
    }
  }

  return getFlowRun(runId);
}

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

/**
 * Phase 1.21 — Compute step runtime. Pure transform; writes derived vars and
 * returns them as ExtractedValue[] so they surface in the run history.
 */
function computedValueToPersist(v: unknown): string | unknown[] {
  if (Array.isArray(v)) return v;
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function runComputeStep(
  step: FlowStep,
  variables: Record<string, unknown>
): {
  ok: boolean;
  errorReason: string | null;
  extractedValues: Array<{ saveAs: string; value: unknown; fromCache: boolean }>;
} {
  const cfg = step.compute;
  if (!cfg || !Array.isArray(cfg.computations) || cfg.computations.length === 0) {
    return { ok: false, errorReason: "Compute step has no computations", extractedValues: [] };
  }
  const out: Array<{ saveAs: string; value: unknown; fromCache: boolean }> = [];
  const localScope: Scope = { ...variables };
  for (const row of cfg.computations) {
    if (!row.saveAs || !row.saveAs.trim()) continue;
    try {
      const sourceVal =
        row.transform.kind === "concat" ? "" : resolveVar([localScope], row.source);
      const newVal = applyComputeTransform(sourceVal, row.transform, [localScope]);
      localScope[row.saveAs] = newVal;
      out.push({ saveAs: row.saveAs, value: newVal, fromCache: false });
    } catch (err: any) {
      return {
        ok: false,
        errorReason: `Compute "${row.saveAs}" failed: ${err?.message ?? String(err)}`,
        extractedValues: out,
      };
    }
  }
  return { ok: true, errorReason: null, extractedValues: out };
}
