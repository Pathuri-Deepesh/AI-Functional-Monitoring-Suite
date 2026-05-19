import { useEffect, useState } from "react";
import { fetchFlow, listFlowRuns, runFlowNow } from "../api";
import { Spinner } from "./Spinner";
import type { Flow, FlowRun, FlowWithSteps, StatusGroup, StepResult } from "../types";

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

interface Props {
  flow: Flow;
  onEdit: () => void;
  onAddStep: () => void;
  onEditStep: (stepId: string) => void;
  onDelete: () => void;
  onAfterRun?: () => void;
  refreshTick: number;
}

export function FlowCard({ flow, onEdit, onAddStep, onEditStep, onDelete, onAfterRun, refreshTick }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [detail, setDetail] = useState<FlowWithSteps | null>(null);
  const [lastRun, setLastRun] = useState<FlowRun | null>(null);
  const [running, setRunning] = useState(false);

  async function load() {
    try {
      const [d, runs] = await Promise.all([fetchFlow(flow.id), listFlowRuns(flow.id, 1)]);
      setDetail(d);
      setLastRun(runs[0] ?? null);
    } catch {}
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.id, refreshTick, flow.lastRunAt]);

  async function handleRun() {
    setRunning(true);
    try {
      await runFlowNow(flow.id);
      await load();
      // Notify parent so the Flows KPI strip + flow list re-fetch with fresh lastRunAt
      onAfterRun?.();
    } finally {
      setRunning(false);
    }
  }

  const hasSteps = (detail?.steps.length ?? 0) > 0;
  const runOk = lastRun?.ok ?? null;
  const statusClass = runOk === null ? "pending" : runOk ? "g-2xx" : "g-5xx";
  const statusLabel = runOk === null ? "PENDING" : runOk ? "OK" : "FAILED";

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
                {detail.steps.map((step) => {
                  const result = lastRun?.stepResults.find((r) => r.stepId === step.id);
                  return (
                    <StepRow
                      key={step.id}
                      position={step.position}
                      method={step.method}
                      url={step.url}
                      description={step.description}
                      extractions={step.extractions.map((e) => e.saveAs).filter(Boolean)}
                      result={result ?? null}
                      onClick={() => onEditStep(step.id)}
                    />
                  );
                })}
              </div>
              <div className="flow-add-step">
                <button className="ghost small" onClick={onAddStep}>+ Add step</button>
                {lastRun && (
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
  onClick: () => void;
}) {
  const { position, method, url, description, extractions, result, onClick } = props;
  const ok = result?.ok ?? null;
  const skipped = result?.skipped ?? false;
  const statusClass = skipped
    ? "pending"
    : ok === null
    ? "pending"
    : ok
    ? "g-2xx"
    : "g-5xx";
  return (
    <div className={`step-row ${ok === false && !skipped ? "step-failed" : ""}`} onClick={onClick}>
      <div className="step-num">{position}</div>
      <div className="step-main">
        <div className="step-line">
          <span className={`pill ${statusClass}`}>
            {skipped ? "SKIPPED" : ok === null ? "—" : result?.statusCode ?? "OK"}
          </span>
          <span className={`method-tag ${METHOD_COLOR[method] ?? "method-get"}`}>{method}</span>
          <span className="url-link" style={{ borderBottom: "none", color: "var(--text)" }}>
            {url}
          </span>
        </div>
        {description && <div className="step-desc muted small">{description}</div>}
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
      <div className="step-edit-hint">edit ›</div>
    </div>
  );
}
