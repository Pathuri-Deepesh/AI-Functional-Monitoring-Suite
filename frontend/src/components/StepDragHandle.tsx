/**
 * Shared drag-handle visuals for the Flow / Prereq step lists.
 * Kept in its own module so FlowCard and PrereqsPanel render identical grips
 * and identical floating drag previews.
 */
const METHOD_COLOR: Record<string, string> = {
  GET: "method-get",
  POST: "method-post",
  PUT: "method-put",
  PATCH: "method-patch",
};

/**
 * Six-dot grip icon — the universal "drag handle" affordance.
 * Two columns × three rows of small circles. SVG so it scales crisply at any DPR.
 */
export function GripIcon() {
  return (
    <svg
      className="step-grip-icon"
      width="10"
      height="14"
      viewBox="0 0 10 14"
      aria-hidden
    >
      <circle cx="2" cy="2" r="1.2" />
      <circle cx="8" cy="2" r="1.2" />
      <circle cx="2" cy="7" r="1.2" />
      <circle cx="8" cy="7" r="1.2" />
      <circle cx="2" cy="12" r="1.2" />
      <circle cx="8" cy="12" r="1.2" />
    </svg>
  );
}

/**
 * Compact floating preview shown in the dnd-kit DragOverlay — follows the
 * cursor exactly while dragging. Stripped-down vs the real step row (no
 * action buttons, no result chips, no iterations panel) so it stays light.
 * Visually elevated via .step-drag-preview class.
 */
export function StepDragPreview(props: {
  position: number;
  method: string;
  url: string;
  description?: string;
}) {
  const { position, method, url, description } = props;
  return (
    <div className="step-drag-preview">
      <div className="step-drag-preview-grip">
        <GripIcon />
        <span className="step-num">{position}</span>
      </div>
      <div className="step-drag-preview-main">
        <div className="step-drag-preview-line">
          <span
            className={`method-tag ${METHOD_COLOR[method] ?? "method-get"}`}
          >
            {method}
          </span>
          <span className="step-drag-preview-url">{url}</span>
        </div>
        {description && (
          <div className="step-drag-preview-desc muted small">{description}</div>
        )}
      </div>
    </div>
  );
}
