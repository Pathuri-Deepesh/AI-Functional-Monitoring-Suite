import { useEffect, useRef, useState } from "react";
import {
  clearProjectVariables,
  fetchPrereqRun,
  fetchPrereqs,
  fetchProjectVariables,
  reorderPrereqSteps,
  runPrereqsAsync,
  updateProject,
} from "../api";
import { Spinner } from "./Spinner";
import type {
  LiveStepProgress,
  PrereqRun,
  PrereqStep,
  PrereqsBundle,
  Project,
  ProjectVariable,
  StepResult,
} from "../types";
import { checkStepVarRefs } from "../utils/varRefs";

const POLL_MS = 500;
const POLL_TIMEOUT_MS = 5 * 60_000;

const METHOD_COLOR: Record<string, string> = {
  GET: "method-get",
  POST: "method-post",
  PUT: "method-put",
  PATCH: "method-patch",
};

interface Props {
  project: Project;
  onAddStep: (siblings: PrereqStep[]) => void;
  onEditStep: (step: PrereqStep, siblings: PrereqStep[]) => void;
  refreshTick: number;
  /** Bumped whenever the prereq chain runs — lets ProjectView re-load project vars. */
  onAfterRun?: () => void;
  /** When a FlowCard's "Run now" kicks off a prereq run, the parent passes that
   *  runId down so this panel can attach to the same run and surface the full
   *  step-by-step progress UI (not just FlowCard's inline banner). */
  externalRunId?: string | null;
}

export function PrereqsPanel({ project, onAddStep, onEditStep, refreshTick, onAfterRun, externalRunId }: Props) {
  const [bundle, setBundle] = useState<PrereqsBundle | null>(null);
  const [lastRun, setLastRun] = useState<PrereqRun | null>(null);
  /** Live run while the chain is executing — null otherwise. */
  const [activeRun, setActiveRun] = useState<PrereqRun | null>(null);
  const [vars, setVars] = useState<ProjectVariable[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [running, setRunning] = useState(false);
  const [intervalDraft, setIntervalDraft] = useState(project.prereqIntervalMinutes);
  const [savingInterval, setSavingInterval] = useState(false);
  const pollAbort = useRef<{ cancelled: boolean } | null>(null);
  /** Pre-run expanded state — restored after the run finishes so the panel
   *  returns to whatever the user had it set to before clicking Run now. */
  const expandedBeforeRun = useRef<boolean | null>(null);

  async function load() {
    try {
      const [b, v] = await Promise.all([
        fetchPrereqs(project.id),
        fetchProjectVariables(project.id),
      ]);
      setBundle(b);
      setVars(v);
      setIntervalDraft(b.intervalMinutes);
    } catch {}
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, refreshTick, project.prereqLastRunAt]);

  useEffect(() => {
    return () => {
      if (pollAbort.current) pollAbort.current.cancelled = true;
    };
  }, [project.id]);

  async function handleRun(opts?: { runId?: string }) {
    // Remember the user's pre-click expansion state so we can restore it after
    expandedBeforeRun.current = expanded;
    setRunning(true);
    setActiveRun(null);
    setExpanded(true); // auto-open so the user can watch step-by-step progress
    const abort = { cancelled: false };
    pollAbort.current = abort;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    try {
      // If the parent already kicked off the run (FlowCard's "Run now"), attach
      // to that runId. Otherwise start a fresh one — force=true bypasses TTL.
      const runId = opts?.runId
        ?? (await runPrereqsAsync(project.id, { force: true })).runId;
      try {
        const initial = await fetchPrereqRun(runId);
        if (!abort.cancelled) setActiveRun(initial);
      } catch {}
      while (!abort.cancelled && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (abort.cancelled) return;
        try {
          const run = await fetchPrereqRun(runId);
          if (abort.cancelled) return;
          setActiveRun(run);
          if (run.endedAt != null) {
            setLastRun(run);
            break;
          }
        } catch {
          // keep polling
        }
      }
      if (!abort.cancelled) {
        await load();
        onAfterRun?.();
      }
    } finally {
      if (!abort.cancelled) {
        setRunning(false);
        // Brief delay so the user sees the final OK/FAILED state before the
        // panel snaps back, then restore their original expansion preference.
        const wasExpanded = expandedBeforeRun.current;
        expandedBeforeRun.current = null;
        window.setTimeout(() => {
          if (abort.cancelled) return;
          setActiveRun(null);
          if (wasExpanded === false) setExpanded(false);
        }, 1500);
      }
    }
  }

  // Attach to a run started by a FlowCard's "Run now" — surfaces the same
  // expanded + progress UI without duplicating the runPrereqsAsync call.
  useEffect(() => {
    if (!externalRunId || running) return;
    handleRun({ runId: externalRunId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalRunId]);

  async function saveInterval(next: number) {
    if (next === project.prereqIntervalMinutes) return;
    setSavingInterval(true);
    try {
      await updateProject(project.id, { prereqIntervalMinutes: next });
      onAfterRun?.();
    } finally {
      setSavingInterval(false);
    }
  }

  async function toggleEnabled() {
    setSavingInterval(true);
    try {
      await updateProject(project.id, { prereqEnabled: !project.prereqEnabled });
      onAfterRun?.();
    } finally {
      setSavingInterval(false);
    }
  }

  async function handleReorder(stepId: string, direction: "up" | "down") {
    const sorted = [...steps].sort((a, b) => a.position - b.position);
    const idx = sorted.findIndex((s) => s.id === stepId);
    if (idx < 0) return;
    const swapWith = direction === "up" ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= sorted.length) return;
    const reordered = [...sorted];
    [reordered[idx], reordered[swapWith]] = [reordered[swapWith], reordered[idx]];
    const orderedIds = reordered.map((s) => s.id);
    // Optimistic update so the swap feels instant
    if (bundle) {
      setBundle({
        ...bundle,
        steps: reordered.map((s, i) => ({ ...s, position: i + 1 })),
      });
    }
    try {
      await reorderPrereqSteps(project.id, orderedIds);
    } catch {
      await load();
    }
  }

  async function handleClearVars() {
    if (!window.confirm("Clear all captured variables? URLs that reference them will fail until the chain runs again.")) {
      return;
    }
    await clearProjectVariables(project.id);
    await load();
    onAfterRun?.();
  }

  const steps = bundle?.steps ?? [];
  const hasSteps = steps.length > 0;
  const displayRun = activeRun ?? lastRun;
  const runOk = project.prereqLastRunOk;
  const statusClass = running
    ? "running"
    : !project.prereqEnabled
    ? "pending"
    : runOk === null
    ? "pending"
    : runOk
    ? "g-2xx"
    : "g-5xx";
  const statusLabel = running
    ? "RUNNING"
    : !project.prereqEnabled
    ? "DISABLED"
    : runOk === null
    ? "NEVER RUN"
    : runOk
    ? "OK"
    : "FAILED";

  // Currently-executing step position while a chain is in flight
  const live = activeRun?.liveStep ?? null;
  const runningStepPosition = (() => {
    if (!running || steps.length === 0) return null;
    if (live) return live.position;
    const done = new Set((activeRun?.stepResults ?? []).map((r) => r.stepId));
    const sorted = [...steps].sort((a, b) => a.position - b.position);
    for (const s of sorted) if (!done.has(s.id)) return s.position;
    return null;
  })();
  const completedCount = activeRun?.stepResults.length ?? 0;
  const totalSteps = steps.length;
  const isRetrying = !!live && live.attempt > 1;
  const isBackoff = !!live && live.phase === "backoff";

  return (
    <section className={`prereq-panel border-${statusClass}`}>
      <header className="prereq-head">
        <button
          className="flow-expand"
          onClick={() => setExpanded(!expanded)}
          title={expanded ? "Collapse" : "Expand"}
          aria-label="Toggle prerequisites panel"
        >
          {expanded ? "▾" : "▸"}
        </button>
        <div className="prereq-title">
          <span className="prereq-icon">🔐</span>
          <span className="prereq-name">Prerequisites</span>
          <span className={`pill ${statusClass}`}>{statusLabel}</span>
          <span className="muted small">
            {hasSteps
              ? `${steps.length} step${steps.length === 1 ? "" : "s"}`
              : "no steps yet"}
          </span>
          {vars.length > 0 && (
            <span className="meta-chip success" title="Variables currently fresh in the project pool">
              💾 {vars.length} var{vars.length === 1 ? "" : "s"} cached
            </span>
          )}
        </div>
        <div className="prereq-meta">
          {project.prereqLastRunAt && (
            <span className="muted small" title={new Date(project.prereqLastRunAt).toLocaleString()}>
              Last run {formatRelative(project.prereqLastRunAt)}
              {project.prereqLastRunTotalMs != null && ` · ${project.prereqLastRunTotalMs}ms`}
            </span>
          )}
        </div>
        <div className="prereq-actions">
          <button
            className="ghost small btn-busy"
            onClick={() => handleRun()}
            disabled={running || !hasSteps}
            title={hasSteps ? "Run the prereq chain now" : "Add a step first"}
          >
            {running ? (<><Spinner size={11} /><span>Running…</span></>) : "▶ Run now"}
          </button>
        </div>
      </header>

      {running && totalSteps > 0 && (
        <div
          className={`flow-progress ${isRetrying ? "retrying" : ""}`}
          aria-label={`Prereq chain running step ${runningStepPosition ?? "—"} of ${totalSteps}`}
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

      {expanded && (
        <div className="prereq-body">
          <div className="prereq-config">
            <label className="prereq-config-cell">
              <span className="muted small">Auto-run every</span>
              <input
                type="number"
                min={1}
                max={1440}
                value={intervalDraft}
                onChange={(e) => setIntervalDraft(Math.max(1, Math.min(1440, Number(e.target.value) || 30)))}
                onBlur={() => saveInterval(intervalDraft)}
                disabled={savingInterval}
                style={{ width: 70 }}
              />
              <span className="muted small">min</span>
            </label>
            <button
              className={`ghost small ${project.prereqEnabled ? "" : "destructive"}`}
              onClick={toggleEnabled}
              disabled={savingInterval}
              title={project.prereqEnabled ? "Stop auto-running on schedule" : "Resume auto-runs"}
            >
              {project.prereqEnabled ? "⏸ Disable schedule" : "▶ Enable schedule"}
            </button>
            {vars.length > 0 && (
              <button className="ghost small destructive" onClick={handleClearVars}>
                🧹 Clear captured vars
              </button>
            )}
          </div>

          {!hasSteps ? (
            <div className="empty-card flush">
              <div className="empty-icon">🔐</div>
              <h3>No prereq steps yet</h3>
              <p>
                Add a setup chain that runs before everything else — typically a login that
                captures an auth token. Other URLs and Flows in this project can then reference
                the captured value as <code>{`{{token}}`}</code>.
              </p>
              <button className="primary" onClick={() => onAddStep([])}>
                + Add first prereq step
              </button>
            </div>
          ) : (
            <>
              <div className="step-list">
                {steps
                  .slice()
                  .sort((a, b) => a.position - b.position)
                  .map((s, idx, arr) => {
                    const result = displayRun?.stepResults.find((r) => r.stepId === s.id);
                    const isRunningStep = running && runningStepPosition === s.position;
                    const isQueued = running && !result && !isRunningStep;
                    const earlier = arr.slice(0, idx);
                    const brokenVarRefs = checkStepVarRefs(
                      s,
                      earlier,
                      vars.map((v) => v.name)
                    );
                    return (
                      <PrereqStepRow
                        key={s.id}
                        step={s}
                        result={result ?? null}
                        runState={isRunningStep ? "running" : isQueued ? "queued" : "idle"}
                        liveAttempt={isRunningStep ? live : null}
                        canMoveUp={idx > 0 && !running}
                        canMoveDown={idx < arr.length - 1 && !running}
                        brokenVarRefs={brokenVarRefs}
                        onMoveUp={() => handleReorder(s.id, "up")}
                        onMoveDown={() => handleReorder(s.id, "down")}
                        onClick={() => onEditStep(s, steps)}
                      />
                    );
                  })}
              </div>
              <div className="flow-add-step">
                <button className="ghost small" onClick={() => onAddStep(steps)}>+ Add prereq step</button>
                {lastRun && (
                  <span className="muted small">
                    Last run: {new Date(lastRun.startedAt).toLocaleString()}
                  </span>
                )}
              </div>
            </>
          )}

          {vars.length > 0 && (
            <div className="prereq-vars-list" aria-label="Captured variables">
              <div className="muted small" style={{ marginBottom: 6 }}>
                <strong>Variables in project pool</strong> — referenced as <code>{`{{name}}`}</code> in URLs & Flows
              </div>
              <div className="var-chip-row">
                {vars.map((v) => (
                  <span key={v.name} className="var-chip" title={`expires ${new Date(v.expiresAt ?? 0).toLocaleString()}`}>
                    <code>{`{{${v.name}}}`}</code>
                    <span className="muted small"> · {formatTtl(v.expiresAt)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function PrereqStepRow(props: {
  step: PrereqStep;
  result: StepResult | null;
  runState?: "idle" | "running" | "queued";
  liveAttempt?: LiveStepProgress | null;
  canMoveUp: boolean;
  canMoveDown: boolean;
  brokenVarRefs: string[];
  onMoveUp: () => void;
  onMoveDown: () => void;
  onClick: () => void;
}) {
  const {
    step,
    result,
    runState = "idle",
    liveAttempt,
    canMoveUp,
    canMoveDown,
    brokenVarRefs,
    onMoveUp,
    onMoveDown,
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
        <div className="step-num">{step.position}</div>
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
          <span className={`method-tag ${METHOD_COLOR[step.method] ?? "method-get"}`}>{step.method}</span>
          <span className="url-link" style={{ borderBottom: "none", color: "var(--text)" }}>
            {step.url}
          </span>
        </div>
        {step.description && <div className="step-desc muted small">{step.description}</div>}
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
        {!result && step.extractions.length > 0 && (
          <div className="step-result-meta">
            <span className="meta-chip muted">
              will capture: {step.extractions.map((e) => e.saveAs).filter(Boolean).join(", ")}
            </span>
          </div>
        )}
      </div>
      <div className="step-edit-hint">edit ›</div>
    </div>
  );
}

function formatRelative(ts: number): string {
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

function formatTtl(expiresAt: number | null): string {
  if (expiresAt == null) return "no TTL";
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) return "expired";
  if (remaining < 60_000) return `${Math.floor(remaining / 1000)}s left`;
  if (remaining < 3600_000) return `${Math.floor(remaining / 60_000)}m left`;
  return `${Math.floor(remaining / 3600_000)}h left`;
}
