import type { Timings } from "../types";

const PHASES: Array<{
  key: keyof Timings;
  label: string;
  color: string;
  tip: string;
}> = [
  { key: "dnsMs", label: "DNS", color: "var(--lat-dns)", tip: "DNS lookup — hostname → IP" },
  { key: "tcpMs", label: "TCP", color: "var(--lat-tcp)", tip: "TCP handshake — open the connection" },
  { key: "tlsMs", label: "TLS", color: "var(--lat-tls)", tip: "TLS handshake — secure the connection (https only)" },
  { key: "ttfbMs", label: "TTFB", color: "var(--lat-ttfb)", tip: "Server thinking time — until first byte arrived" },
  { key: "downloadMs", label: "Download", color: "var(--lat-dl)", tip: "Time to stream the response body" },
];

export function LatencyBar(props: { timings: Timings | null }) {
  const t = props.timings;

  if (!t || t.totalMs == null || t.totalMs <= 0) {
    return (
      <div className="latency-empty">
        <span className="muted">No latency data yet — click Check now.</span>
      </div>
    );
  }

  const sumMeasured = PHASES.reduce((acc, p) => acc + (t[p.key] ?? 0), 0);
  const denominator = Math.max(sumMeasured, t.totalMs ?? 1);

  return (
    <div className="latency">
      <div className="latency-bar" role="img" aria-label="Latency breakdown">
        {PHASES.map((p) => {
          const v = t[p.key] ?? 0;
          if (v <= 0) return null;
          const pct = (v / denominator) * 100;
          return (
            <div
              key={p.key}
              className="latency-segment"
              style={{ width: `${pct}%`, background: p.color }}
              title={`${p.label}: ${v}ms — ${p.tip}`}
            />
          );
        })}
      </div>
      <div className="latency-legend">
        {PHASES.map((p) => {
          const v = t[p.key];
          return (
            <div key={p.key} className="latency-chip" title={p.tip}>
              <span className="latency-dot" style={{ background: p.color }} />
              <span className="latency-chip-label">{p.label}</span>
              <span className="latency-chip-value">{v != null ? `${v}ms` : "—"}</span>
            </div>
          );
        })}
        <div className="latency-chip latency-total">
          <span className="latency-chip-label">Total</span>
          <span className="latency-chip-value">{t.totalMs}ms</span>
        </div>
      </div>
    </div>
  );
}
