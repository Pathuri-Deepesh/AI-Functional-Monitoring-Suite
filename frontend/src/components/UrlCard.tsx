import { useEffect, useState } from "react";
import { LatencyBar } from "./LatencyBar";
import { ActivityTimeline } from "./ActivityTimeline";
import { FailureChip } from "./FailureChip";
import { Spinner } from "./Spinner";
import { fetchHistory, fetchSparkline, fetchStats } from "../api";
import type { CheckRecord, MonitoredUrl, Project, SparklinePoint, StatusGroup, UrlStats } from "../types";

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
  url: MonitoredUrl;
  project: Project;
  onCheck: () => void | Promise<void>;
  onRemove: () => void | Promise<void>;
  // Optional pre-loaded values (so KpiBar can share data fetching)
  sparkline?: SparklinePoint[];
  stats?: UrlStats | null;
  history?: CheckRecord[];
  refreshTick?: number;
  windowMinutes?: number;
}

export function UrlCard(props: Props) {
  const { url, project, onCheck, onRemove, refreshTick = 0, windowMinutes = 24 * 60 } = props;
  const [checking, setChecking] = useState(false);
  const [history, setHistory] = useState<CheckRecord[]>(props.history ?? []);
  const [stats, setStats] = useState<UrlStats | null>(props.stats ?? null);
  const [sparkline, setSparkline] = useState<SparklinePoint[]>(props.sparkline ?? []);
  const key = project.apiKeys.find((k) => k.id === url.apiKeyId);

  useEffect(() => {
    let cancelled = false;
    const sinceMs = Date.now() - windowMinutes * 60_000;
    Promise.all([
      fetchHistory(url.id, sinceMs),
      fetchStats(url.id, windowMinutes),
      fetchSparkline(url.id, windowMinutes, 30),
    ])
      .then(([h, s, sp]) => {
        if (cancelled) return;
        setHistory(h);
        setStats(s);
        setSparkline(sp);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [url.id, refreshTick, url.lastChecked, windowMinutes]);

  async function check() {
    setChecking(true);
    try {
      await onCheck();
    } finally {
      setChecking(false);
    }
  }

  const totalAssertions = url.assertions?.length ?? 0;

  return (
    <div className={`url-card ${url.statusGroup ? `border-${GROUP_COLOR[url.statusGroup]}` : ""}`}>
      <div className="url-card-top">
        <div className="url-card-id">
          <span className={`pill ${url.statusGroup ? GROUP_COLOR[url.statusGroup] : "pending"}`}>
            {url.statusGroup
              ? `${url.statusGroup.toUpperCase()}${url.statusCode ? ` · ${url.statusCode}` : ""}`
              : "PENDING"}
          </span>
          <span className={`method-tag ${METHOD_COLOR[url.method] ?? "method-get"}`}>{url.method}</span>
          <a className="url-link" href={url.url} target="_blank" rel="noreferrer">
            {url.url}
          </a>
        </div>
        <div className="url-card-actions">
          <button className="ghost small btn-busy" onClick={check} disabled={checking}>
            {checking ? (
              <>
                <Spinner size={11} />
                <span>Checking…</span>
              </>
            ) : (
              "Check now"
            )}
          </button>
          <button className="ghost destructive small" onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>

      {url.description && <p className="url-desc">{url.description}</p>}

      <ActivityTimeline history={history} windowMinutes={windowMinutes} buckets={60} />

      {url.errorReason && (
        <div className="reason">
          <strong>Reason:</strong> {url.errorReason}
        </div>
      )}

      <LatencyBar timings={url.timings} />

      {totalAssertions > 0 && (
        <div className="assertions-row">
          {url.lastAssertionResults?.map((r) => (
            <span key={r.id} className={`assertion-pill ${r.passed ? "passed" : "failed"}`} title={r.detail}>
              {r.passed ? "✓" : "✗"} {assertionLabel(r.type)}
            </span>
          )) ?? <span className="muted small">{totalAssertions} assertion(s) — not yet evaluated</span>}
        </div>
      )}

      <div className="url-card-foot">
        <div className="foot-chips">
          <span className="foot-chip" title="How often this URL is automatically re-checked">
            ⏱ Every {url.intervalMinutes} min
          </span>
          {key ? (
            <span className="foot-chip key-chip" title={`Header: ${key.headerName}`}>
              🔑 {key.name}
            </span>
          ) : (
            <span className="foot-chip muted">🔓 No auth</span>
          )}
          <FailureChip stats={stats} />
        </div>
        <span className="muted">
          {url.lastChecked
            ? `Last check: ${new Date(url.lastChecked).toLocaleTimeString()}`
            : "Not checked yet"}
        </span>
      </div>
    </div>
  );
}

function assertionLabel(type: string): string {
  switch (type) {
    case "status-equals":
      return "status";
    case "status-in-range":
      return "status range";
    case "latency-under":
      return "latency";
    case "body-contains":
      return "body";
    default:
      return type;
  }
}
