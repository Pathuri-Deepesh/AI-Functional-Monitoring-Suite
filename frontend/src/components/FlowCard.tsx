import { useEffect, useRef, useState } from "react";
import {
  fetchFlow,
  fetchFlowRun,
  fetchPrereqRun,
  fetchPrereqs,
  fetchProjectVariables,
  listFlowRuns,
  reorderFlowSteps,
  runFlowAsync,
  runPrereqsAsync,
} from "../api";
import { Spinner } from "./Spinner";
import type { Flow, FlowRun, FlowStep, FlowWithSteps, LiveStepProgress, StatusGroup, StepResult } from "../types";
import { checkStepVarRefs } from "../utils/varRefs";
import { MoveCopyStepModal } from "./MoveCopyStepModal";

const GROUP_COLOR: Record<StatusGroup, string> = {
  "2xx": "g-2xx",
  "3xx": "g-3xx",
  "4xx": "g-4xx",
  "5xx": "g-5xx",
  error: "g-error",
};
const METHOD_COLOR: Record<string, string> = {
  GET: "method-get",
  POST: "method-post",
  PUT: "method-put",
  PATCH: "method-patch",
};

const POLL_MS = 500;
const POLL_TIMEOUT_MS = 5 * 60_000; // safety cap: stop polling after 5 minutes

interface Props {
  flow: Flow;
  onEdit: () => void;
  onAddStep: () => void;
  onEditStep: (stepId: string) => void;
  onDelete: () => void;
  onAfterRun?: () => void;
  /** Notifies the parent (ProjectView) that we just started a prereq run, so
   *  the PrereqsPanel above can mirror the full progress UI. Called with null
   *  once the prereq phase finishes. */
  onPrereqRunStarted?: (runId: string | null) => void;
  refreshTick: number;
}

export function FlowCard({ flow, onEdit, onAddStep, onEditStep, onDelete, onAfterRun, onPrereqRunStarted, refreshTick }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [detail, setDetail] = useState<FlowWithSteps | null>(null);
  const [lastRun, setLastRun] = useState<FlowRun | null>(null);
  /** While a run is in-flight: the live FlowRun being polled. null otherwise. */
  const [activeRun, setActiveRun] = useState<FlowRun | null>(null);
  const [running, setRunning] = useState(false);
  /** Set to "prereq" while we're refreshing tokens, "flow" while the flow runs. */
  const [runPhase, setRunPhase] = useState<"prereq" | "flow" | null>(null);
  /** Live progress of the prereq run (only set while runPhase === "prereq"). */
  const [prereqProgress, setPrereqProgress] = useState<{
    completed: number;
    total: number;
    live: LiveStepProgress | null;
  } | null>(null);
  /** Names of vars in the project's prereq pool — used to flag broken refs. */
  const [projectVarNames, setProjectVarNames] = useState<string[]>([]);
  /** When set, the Move/Copy modal is open for this step. */
  const [moveCopyTarget, setMoveCopyTarget] = useState<
    { mode: "move" | "copy"; step: FlowStep } | null
  >(null);
  const pollAbort = useRef<{ cancelled: boolean } | null>(null);

  async function load() {
    try {
      const [d, runs, vars] = await Promise.all([
        fetchFlow(flow.id),
        listFlowRuns(flow.id, 1),
        fetchProjectVariables(flow.projectId),
      ]);
      setDetail(d);
      setLastRun(runs[0] ?? null);
      setProjectVarNames(vars.map((v) => v.name));
    } catch {}
  }

  async function handleReorder(stepId: string, direction: "up" | "down") {
    if (!detail) return;
    const sorted = [...detail.steps].sort((a, b) => a.position - b.position);
    const idx = sorted.findIndex((s) => s.id === stepId);
    if (idx < 0) return;
    const swapWith = direction === "up" ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= sorted.length) return;
    const reordered = [...sorted];
    [reordered[idx], reordered[swapWith]] = [reordered[swapWith], reordered[idx]];
    const orderedIds = reordered.map((s) => s.id);
    // Optimistic update so the swap feels instant
    setDetail({
      ...detail,
      steps: reordered.map((s, i) => ({ ...s, position: i + 1 })),
    });
    try {
      await reorderFlowSteps(flow.id, orderedIds);
    } catch {
      await load();
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.id, refreshTick, flow.lastRunAt]);

  // Cancel any in-flight poll loop when unmounting / flow id changes
  useEffect(() => {
    return () => {
      if (pollAbort.current) pollAbort.current.cancelled = true;
    };
  }, [flow.id]);

  async function handleRun() {
    setRunning(true);
    setActiveRun(null);
    const abort = { cancelled: false };
    pollAbort.current = abort;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    try {
      // 1. Refresh prereq tokens first when the project has any. Skipped silently
      //    if prereqs are disabled or empty — flow runs straight through.
      //    Mirrors what scheduler tick() does, but on user demand.
      try {
        const bundle = await fetchPrereqs(flow.projectId);
        if (bundle.enabled && bundle.steps.length > 0) {
          setRunPhase("prereq");
          setPrereqProgress({ completed: 0, total: bundle.steps.length, live: null });
          const { runId: prereqRunId } = await runPrereqsAsync(flow.projectId, { force: true });
          // Hand the runId up so PrereqsPanel can attach to it and surface the
          // full step-by-step progress UI in parallel with our inline banner.
          onPrereqRunStarted?.(prereqRunId);
          while (!abort.cancelled && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, POLL_MS));
            if (abort.cancelled) return;
            try {
              const pr = await fetchPrereqRun(prereqRunId);
              setPrereqProgress({
                completed: pr.stepResults.length,
                total: bundle.steps.length,
                live: pr.liveStep ?? null,
              });
              if (pr.endedAt != null) break;
            } catch {
              // transient — keep polling
            }
          }
        }
      } catch {
        // Prereq fetch/run failures shouldn't block the flow — the flow may not
        // even use prereq vars, and if it does the user will see the resulting
        // failure clearly.
      }
      if (abort.cancelled) return;

      // 2. Run the flow. force=true bypasses the per-step TTL skip cache.
      setRunPhase("flow");
      const { runId } = await runFlowAsync(flow.id, { force: true });
      try {
        const initial = await fetchFlowRun(runId);
        if (!abort.cancelled) setActiveRun(initial);
      } catch {}
      while (!abort.cancelled && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (abort.cancelled) return;
        try {
          const run = await fetchFlowRun(runId);
          if (abort.cancelled) return;
          setActiveRun(run);
          if (run.endedAt != null) break;
        } catch {
          // Transient — keep polling
        }
      }
      if (!abort.cancelled) {
        await load();
        onAfterRun?.();
      }
    } finally {
      if (!abort.cancelled) {
        setRunning(false);
        setRunPhase(null);
        setActiveRun(null);
        setPrereqProgress(null);
        // Clear the lifted runId so the parent doesn't keep PrereqsPanel
        // attached after the flow itself finishes.
        onPrereqRunStarted?.(null);
      }
    }
  }

  // Which run drives the per-step status? While running we use the live activeRun;
  // otherwise we fall back to the most recent persisted run.
  const displayRun = activeRun ?? lastRun;
  const hasSteps = (detail?.steps.length ?? 0) > 0;
  const runOk = running ? null : lastRun?.ok ?? null;
  const statusClass = running
    ? "running"
    : runOk === null
    ? "pending"
    : runOk
    ? "g-2xx"
    : "g-5xx";
  const statusLabel = running
    ? runPhase === "prereq"
      ? "PREREQ"
      : "RUNNING"
    : runOk === null
    ? "PENDING"
    : runOk
    ? "OK"
    : "FAILED";

  // Prefer the backend's live signal — it knows the exact step + attempt count.
  // Fall back to inferring from completed-results when liveStep isn't published yet.
  const live = activeRun?.liveStep ?? null;
  const runningStepPosition = (() => {
    if (!running || !detail) return null;
    if (live) return live.position;
    const done = new Set((activeRun?.stepResults ?? []).map((r) => r.stepId));
    const sorted = [...detail.steps].sort((a, b) => a.position - b.position);
    for (const s of sorted) if (!done.has(s.id)) return s.position;
    return null;
  })();
  const completedCount = activeRun?.stepResults.length ?? 0;
  const totalSteps = detail?.steps.length ?? 0;
  const isRetrying = !!live && live.attempt > 1;
  const isBackoff = !!live && live.phase === "backoff";

  return (
    <div className={`flow-card border-${statusClass}`}>
      <div className="flow-head">
        <button
          className="flow-expand"
          onClick={() => setExpanded(!expanded)}
          title={expanded ? "Collapse" : "Expand"}
          aria-label="Toggle"
        >
          {expanded ? "▾" : "▸"}
        </button>
        <div className="flow-id">
          <span className={`pill ${statusClass}`}>{statusLabel}</span>
          <span className="flow-name">{flow.name}</span>
          {!flow.enabled && <span className="pill pending">DISABLED</span>}
        </div>
        <div className="flow-meta">
          <span className="muted small" title="How often the whole flow runs">⏱ Every {flow.intervalMinutes} min</span>
          {flow.stopOnFailure && <span className="muted small">· Stop on fail</span>}
          {lastRun?.totalMs != null && <span className="muted small">· {lastRun.totalMs}ms</span>}
          {detail && (
            <span className="muted small">
              · {detail.steps.length} step{detail.steps.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <div className="flow-actions">
          <button className="ghost small btn-busy" onClick={handleRun} disabled={running || !hasSteps}>
            {running ? (<><Spinner size={11} /><span>Running…</span></>) : "▶ Run now"}
          </button>
          <button className="ghost small" onClick={onEdit}>⚙ Edit</button>
          <button className="ghost destructive small" onClick={onDelete}>🗑</button>
        </div>
      </div>

      {flow.description && (
        <p className="flow-desc">{flow.description}</p>
      )}

      {running && runPhase === "prereq" && (() => {
        const p = prereqProgress;
        const pct = p && p.total > 0
          ? Math.min(100, Math.round((p.completed / p.total) * 100))
          : 0;
        const runningPos = p?.live?.position ?? (p ? p.completed + 1 : null);
        const isRetry = !!p?.live && p.live.attempt > 1;
        const isBackoff = !!p?.live && p.live.phase === "backoff";
        return (
          <div
            className={`flow-prereq-banner ${isRetry ? "retrying" : ""}`}
            role="status"
            aria-live="polite"
          >
            <div className="flow-prereq-bar" style={{ width: `${pct}%` }} />
            <div className="flow-prereq-content">
              <Spinner size={12} />
              <span className="flow-prereq-label">
                <strong>🔑 Refreshing access tokens</strong>
                {p && (
                  <>
                    {" — "}
                    {p.completed >= p.total
                      ? "wrapping up…"
                      : runningPos != null
                        ? <>step <strong>{runningPos}</strong> of <strong>{p.total}</strong></>
                        : "starting…"}
                    {isRetry && p.live && (
                      <>
                        {" "}
                        <span className="meta-chip warn" style={{ marginLeft: 4 }}>
                          🔁 retry {p.live.attempt - 1}/{p.live.maxAttempts - 1}
                          {isBackoff ? " (waiting…)" : ""}
                        </span>
                      </>
                    )}
                  </>
                )}
              </span>
              {p && (
                <span className="muted small" style={{ marginLeft: "auto" }}>
                  {p.completed}/{p.total} done · {pct}%
                </span>
              )}
            </div>
          </div>
        );
      })()}

      {running && runPhase === "flow" && totalSteps > 0 && (
        <div
          className={`flow-progress ${isRetrying ? "retrying" : ""}`}
          aria-label={`Running step ${runningStepPosition ?? "—"} of ${totalSteps}`}
        >
          <div
            className="flow-progress-bar"
            style={{ width: `${Math.min(100, (completedCount / totalSteps) * 100)}%` }}
          />
          <div className="flow-progress-label">
            <Spinner size={11} />
            <span>
              {runningStepPosition != null
                ? `Step ${runningStepPosition} of ${totalSteps}`
                : `Wrapping up step ${totalSteps} of ${totalSteps}`}
              {isRetrying && live ? (
                <>
                  {" — "}
                  <strong>
                    🔁 retry {live.attempt - 1} of {live.maxAttempts - 1}
                  </strong>
                  {isBackoff ? " (waiting before next try…)" : " in flight…"}
                </>
              ) : (
                " running…"
              )}
            </span>
            <span className="muted small">· {completedCount} done</span>
            {isRetrying && live?.lastErrorReason && (
              <span className="muted small" title={live.lastErrorReason}>
                · last try: {live.lastStatusCode ?? "no response"}
              </span>
            )}
          </div>
        </div>
      )}

      {moveCopyTarget && (
        <MoveCopyStepModal
          mode={moveCopyTarget.mode}
          sourceFlow={flow}
          step={moveCopyTarget.step}
          projectId={flow.projectId}
          onClose={() => setMoveCopyTarget(null)}
          onDone={() => {
            setMoveCopyTarget(null);
            load();
            onAfterRun?.();
          }}
        />
      )}

      {expanded && (
        <div className="flow-body">
          {!detail ? (
            <div className="empty-inline">Loading steps…</div>
          ) : detail.steps.length === 0 ? (
            <div className="empty-card" style={{ padding: 32 }}>
              <div className="empty-icon">🔗</div>
              <h3>No steps yet</h3>
              <p>A flow needs at least 2 steps to be useful — first captures a value, second uses it.</p>
              <button className="primary" onClick={onAddStep}>+ Add first step</button>
            </div>
          ) : (
            <>
              <div className="step-list">
                {detail.steps
                  .slice()
                  .sort((a, b) => a.position - b.position)
                  .map((step, idx, arr) => {
                    const result = displayRun?.stepResults.find((r) => r.stepId === step.id);
                    const isRunningStep = running && runningStepPosition === step.position;
                    const isQueued = running && !result && !isRunningStep;
                    const earlier = arr.slice(0, idx);
                    const brokenVarRefs = checkStepVarRefs(step, earlier, projectVarNames);
                    return (
                      <StepRow
                        key={step.id}
                        position={step.position}
                        method={step.method}
                        url={step.url}
                        description={step.description}
                        extractions={step.extractions.map((e) => e.saveAs).filter(Boolean)}
                        result={result ?? null}
                        runState={isRunningStep ? "running" : isQueued ? "queued" : "idle"}
                        liveAttempt={isRunningStep ? live : null}
                        canMoveUp={idx > 0 && !running}
                        canMoveDown={idx < arr.length - 1 && !running}
                        brokenVarRefs={brokenVarRefs}
                        onMoveUp={() => handleReorder(step.id, "up")}
                        onMoveDown={() => handleReorder(step.id, "down")}
                        onMoveToFlow={() => setMoveCopyTarget({ mode: "move", step })}
                        onCopyToFlow={() => setMoveCopyTarget({ mode: "copy", step })}
                        disableActions={running}
                        onClick={() => onEditStep(step.id)}
                      />
                    );
                  })}
              </div>
              <div className="flow-add-step">
                <button className="ghost small" onClick={onAddStep}>+ Add step</button>
                {lastRun && !running && (
                  <span className="muted small">
                    Last run: {new Date(lastRun.startedAt).toLocaleString()}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function StepRow(props: {
  position: number;
  method: string;
  url: string;
  description: string;
  extractions: string[];
  result: StepResult | null;
  runState?: "idle" | "running" | "queued";
  liveAttempt?: LiveStepProgress | null;
  canMoveUp: boolean;
  canMoveDown: boolean;
  brokenVarRefs: string[];
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMoveToFlow: () => void;
  onCopyToFlow: () => void;
  disableActions: boolean;
  onClick: () => void;
}) {
  const {
    position,
    method,
    url,
    description,
    extractions,
    result,
    runState = "idle",
    liveAttempt,
    canMoveUp,
    canMoveDown,
    brokenVarRefs,
    onMoveUp,
    onMoveDown,
    onMoveToFlow,
    onCopyToFlow,
    disableActions,
    onClick,
  } = props;
  const ok = result?.ok ?? null;
  const skipped = result?.skipped ?? false;
  const isRetry = !!liveAttempt && liveAttempt.attempt > 1;
  const statusClass =
    runState === "running"
      ? isRetry
        ? "retry"
        : "running"
      : runState === "queued"
      ? "queued"
      : skipped
      ? "pending"
      : ok === null
      ? "pending"
      : ok
      ? "g-2xx"
      : "g-5xx";
  const pillText =
    runState === "running"
      ? isRetry && liveAttempt
        ? `🔁 RETRY ${liveAttempt.attempt - 1}/${liveAttempt.maxAttempts - 1}`
        : "▶ RUNNING"
      : runState === "queued"
      ? "QUEUED"
      : skipped
      ? "SKIPPED"
      : ok === null
      ? "—"
      : result?.statusCode ?? "OK";
  const rowClass = [
    "step-row",
    ok === false && !skipped ? "step-failed" : "",
    runState === "running" ? "step-running" : "",
    runState === "running" && isRetry ? "step-retrying" : "",
    runState === "queued" ? "step-queued" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={rowClass} onClick={onClick}>
      <div className="step-reorder">
        <button
          className="step-reorder-up"
          onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
          disabled={!canMoveUp}
          title="Move up"
          aria-label="Move step up"
        >▲</button>
        <div className="step-num">{position}</div>
        <button
          className="step-reorder-down"
          onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
          disabled={!canMoveDown}
          title="Move down"
          aria-label="Move step down"
        >▼</button>
      </div>
      <div className="step-main">
        <div className="step-line">
          <span className={`pill ${statusClass}`}>{pillText}</span>
          <span className={`method-tag ${METHOD_COLOR[method] ?? "method-get"}`}>{method}</span>
          <span className="url-link" style={{ borderBottom: "none", color: "var(--text)" }}>
            {url}
          </span>
        </div>
        {description && <div className="step-desc muted small">{description}</div>}
        {brokenVarRefs.length > 0 && (
          <div className="step-result-meta">
            <span
              className="meta-chip warn"
              title={`These vars aren't extracted by any earlier step and aren't in the project pool: ${brokenVarRefs.join(", ")}`}
            >
              ⚠ missing: {brokenVarRefs.map((n) => `{{${n}}}`).join(", ")}
            </span>
          </div>
        )}
        {/* While retrying: surface why the previous attempt failed */}
        {runState === "running" && isRetry && liveAttempt?.lastErrorReason && (
          <div className="step-result-meta">
            <span className="meta-chip warn" title={liveAttempt.lastErrorReason}>
              last try: {liveAttempt.lastStatusCode ?? "no response"} —{" "}
              {liveAttempt.lastErrorReason.slice(0, 60)}
            </span>
            {liveAttempt.phase === "backoff" && (
              <span className="meta-chip muted">⏳ waiting for next try…</span>
            )}
          </div>
        )}
        {result && (
          <div className="step-result-meta">
            {result.timings.totalMs != null && (
              <span className="meta-chip">⏱ {result.timings.totalMs}ms</span>
            )}
            {result.attempts > 1 && (
              <span className="meta-chip warn">🔁 {result.attempts} attempts</span>
            )}
            {result.errorReason && (
              <span className="meta-chip danger" title={result.errorReason}>
                ⚠ {result.errorReason.slice(0, 80)}
              </span>
            )}
            {skipped && result.skipReason && (
              <span className="meta-chip muted" title={result.skipReason}>
                ⏭ {result.skipReason}
              </span>
            )}
            {result.extractedValues.length > 0 && (
              <span className="meta-chip success">
                💾 captured: {result.extractedValues.map((e) => e.saveAs).join(", ")}
                {result.extractedValues.some((e) => e.fromCache) && " (cached)"}
              </span>
            )}
          </div>
        )}
        {!result && extractions.length > 0 && (
          <div className="step-result-meta">
            <span className="meta-chip muted">will capture: {extractions.join(", ")}</span>
          </div>
        )}
      </div>
      <div className="step-actions">
        <button
          className="step-move"
          onClick={(e) => { e.stopPropagation(); onMoveToFlow(); }}
          disabled={disableActions}
          title="Move this step to another flow (removed from this flow)"
        >↗ Move</button>
        <button
          className="step-copy"
          onClick={(e) => { e.stopPropagation(); onCopyToFlow(); }}
          disabled={disableActions}
          title="Copy this step to another flow (kept in this flow)"
        >📋 Copy</button>
      </div>
      <div className="step-edit-hint">edit ›</div>
    </div>
  );
}
