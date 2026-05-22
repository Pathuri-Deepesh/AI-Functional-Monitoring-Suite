import { useEffect, useState } from "react";
import { copyStepToFlow, listProjectFlows, moveStepToFlow } from "../api";
import { Modal } from "./Modal";
import { Spinner } from "./Spinner";
import type { Flow, FlowStep } from "../types";

interface Props {
  mode: "move" | "copy";
  sourceFlow: Flow;
  step: FlowStep;
  projectId: string;
  onClose: () => void;
  onDone: (targetFlowId: string) => void;
}

export function MoveCopyStepModal({ mode, sourceFlow, step, projectId, onClose, onDone }: Props) {
  const [flows, setFlows] = useState<Flow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listProjectFlows(projectId)
      .then((all) => {
        if (cancelled) return;
        setFlows(all.filter((f) => f.id !== sourceFlow.id));
      })
      .catch(() => {
        if (!cancelled) setFlows([]);
      });
    return () => { cancelled = true; };
  }, [projectId, sourceFlow.id]);

  async function handleConfirm() {
    if (!selectedId) return;
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "move") {
        await moveStepToFlow(step.id, selectedId);
      } else {
        await copyStepToFlow(step.id, selectedId);
      }
      onDone(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  const verb = mode === "move" ? "Move" : "Copy";
  const subtitle = mode === "move"
    ? `Pick a target flow. The step will be removed from "${sourceFlow.name}" and inserted at position 1 of the target.`
    : `Pick a target flow. A duplicate of this step will be inserted at position 1 of the target. The original stays in "${sourceFlow.name}".`;

  return (
    <Modal
      open={true}
      title={`${verb} step to another flow`}
      subtitle={subtitle}
      onClose={onClose}
      size="md"
    >
      <div className="move-copy-modal">
        <div className="move-copy-source">
          <span className="muted small">Step:</span>
          <span className={`method-tag method-${step.method.toLowerCase()}`}>{step.method}</span>
          <code className="move-copy-source-url">{step.url}</code>
        </div>

        {!flows ? (
          <div className="empty-inline"><Spinner size={12} /> Loading flows…</div>
        ) : flows.length === 0 ? (
          <div className="empty-card flush">
            <div className="empty-icon">🔗</div>
            <h3>No other flows in this project</h3>
            <p>Create another flow first, then come back here to {mode} this step into it.</p>
          </div>
        ) : (
          <ul className="move-copy-list">
            {flows.map((f) => {
              const selected = f.id === selectedId;
              const statusClass = f.lastRunOk === null
                ? "pending"
                : f.lastRunOk ? "g-2xx" : "g-5xx";
              const statusLabel = f.lastRunOk === null
                ? "—"
                : f.lastRunOk ? "OK" : "FAILED";
              return (
                <li key={f.id}>
                  <button
                    className={`move-copy-target ${selected ? "selected" : ""}`}
                    onClick={() => setSelectedId(f.id)}
                    disabled={submitting}
                  >
                    <span className="move-copy-target-name">{f.name}</span>
                    <span className={`pill ${statusClass}`}>{statusLabel}</span>
                    {!f.enabled && <span className="pill pending">DISABLED</span>}
                    <span className="muted small">
                      ⏱ every {f.intervalMinutes} min
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {error && <div className="inline-error">{error}</div>}

        <div className="modal-actions">
          <button className="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          {flows && flows.length > 0 && (
            <button
              className="primary btn-busy"
              onClick={handleConfirm}
              disabled={!selectedId || submitting}
            >
              {submitting
                ? (<><Spinner size={11} /><span>Working…</span></>)
                : `${verb} →`}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
