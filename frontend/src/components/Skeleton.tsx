/**
 * Shimmer-style skeleton placeholders shown during the very first load
 * (before the first /api/status response arrives).
 */
export function SkeletonProject() {
  return (
    <main className="main">
      {/* Hero */}
      <div className="project-hero">
        <div style={{ flex: 1 }}>
          <div className="sk sk-line" style={{ width: "40%", height: 28, marginBottom: 8 }} />
          <div className="sk sk-line" style={{ width: "60%", height: 14, marginBottom: 14 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <div className="sk sk-pill" style={{ width: 100 }} />
            <div className="sk sk-pill" style={{ width: 90 }} />
            <div className="sk sk-pill" style={{ width: 120 }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div className="sk sk-pill" style={{ width: 110, height: 36 }} />
          <div className="sk sk-pill" style={{ width: 36, height: 36 }} />
          <div className="sk sk-pill" style={{ width: 36, height: 36 }} />
        </div>
      </div>

      {/* Time range placeholder */}
      <div className="sk sk-pill" style={{ width: 320, height: 36, marginLeft: "auto", marginBottom: 12 }} />

      {/* KPI bar */}
      <div className="kpi-bar">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="sk sk-card" style={{ height: 90 }} />
        ))}
        <div className="sk sk-card" style={{ height: 90 }} />
      </div>

      {/* Stat grid */}
      <div className="stat-grid">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="sk sk-card" style={{ height: 78 }} />
        ))}
      </div>

      {/* URL list */}
      <div className="url-list">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="sk sk-card" style={{ height: 240 }} />
        ))}
      </div>
    </main>
  );
}

export function SkeletonSidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="sk sk-circle" style={{ width: 36, height: 36 }} />
        <div style={{ flex: 1 }}>
          <div className="sk sk-line" style={{ width: "70%", height: 14, marginBottom: 4 }} />
          <div className="sk sk-line" style={{ width: "40%", height: 10 }} />
        </div>
      </div>
      <div className="side-section">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{ display: "flex", gap: 12, padding: 12 }}>
            <div className="sk sk-circle" style={{ width: 34, height: 34 }} />
            <div style={{ flex: 1 }}>
              <div className="sk sk-line" style={{ width: "70%", height: 12, marginBottom: 4 }} />
              <div className="sk sk-line" style={{ width: "40%", height: 10 }} />
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
