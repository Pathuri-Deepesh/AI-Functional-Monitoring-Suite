import { useEffect, useRef, useState } from "react";

interface Preset {
  label: string;
  windowMinutes: number;
}

const PRESETS: Preset[] = [
  { label: "24h", windowMinutes: 24 * 60 },
  { label: "7d", windowMinutes: 7 * 24 * 60 },
  { label: "30d", windowMinutes: 30 * 24 * 60 },
  { label: "90d", windowMinutes: 90 * 24 * 60 },
  { label: "1y", windowMinutes: 365 * 24 * 60 },
];

export function TimeRangeSelector(props: {
  value: number;
  onChange: (windowMinutes: number) => void;
}) {
  const [showCustom, setShowCustom] = useState(false);
  const [customDays, setCustomDays] = useState<number>(14);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close custom popover on outside click + ESC
  useEffect(() => {
    if (!showCustom) return;
    function onClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowCustom(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowCustom(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [showCustom]);

  const matchedIdx = PRESETS.findIndex((p) => p.windowMinutes === props.value);
  const isCustom = matchedIdx === -1;
  const totalSegments = PRESETS.length + 1; // presets + custom icon
  const activeIdx = isCustom ? PRESETS.length : matchedIdx;

  function applyCustom() {
    const days = Math.max(1, Math.min(365, Math.floor(customDays)));
    props.onChange(days * 24 * 60);
    setShowCustom(false);
  }

  return (
    <div className="trange">
      <div className="trange-icon" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M7 4v3l2 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </div>

      <div className="trange-segments" role="tablist">
        {/* Sliding active indicator */}
        <div
          className="trange-indicator"
          style={{
            left: `${(activeIdx * 100) / totalSegments}%`,
            width: `${100 / totalSegments}%`,
          }}
        />

        {PRESETS.map((p, i) => (
          <button
            key={p.label}
            type="button"
            role="tab"
            aria-selected={i === matchedIdx}
            className={`trange-seg ${i === matchedIdx ? "active" : ""}`}
            onClick={() => {
              setShowCustom(false);
              props.onChange(p.windowMinutes);
            }}
          >
            {p.label}
          </button>
        ))}

        <button
          type="button"
          ref={(el) => {
            // Anchor for the popover positioning context
          }}
          className={`trange-seg trange-custom ${isCustom ? "active" : ""}`}
          onClick={() => setShowCustom((s) => !s)}
          title={isCustom ? `Custom — ${Math.round(props.value / (24 * 60))} days` : "Custom range"}
          aria-label="Custom range"
        >
          {isCustom ? (
            <span className="trange-custom-label">{Math.round(props.value / (24 * 60))}d</span>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <rect x="2" y="3" width="8" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" />
              <path d="M2 5h8M4 2v2M8 2v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          )}
        </button>

        {showCustom && (
          <div className="trange-popover" ref={popoverRef}>
            <div className="trange-popover-head">Custom range</div>
            <div className="trange-popover-body">
              <span className="muted small">Last</span>
              <input
                type="number"
                min={1}
                max={365}
                value={customDays}
                onChange={(e) => setCustomDays(Number(e.target.value) || 1)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyCustom();
                }}
                autoFocus
              />
              <span className="muted small">days</span>
              <button type="button" className="primary small" onClick={applyCustom}>
                Apply
              </button>
            </div>
            <div className="trange-popover-help">1–365 days · Enter to apply · Esc to close</div>
          </div>
        )}
      </div>
    </div>
  );
}
