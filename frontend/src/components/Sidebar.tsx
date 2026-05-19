import type { MonitoredUrl, Project, StatusGroup } from "../types";

export function Sidebar(props: {
  projects: Project[];
  urls: MonitoredUrl[];
  activeProjectId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const { projects, urls, activeProjectId, onSelect, onCreate } = props;

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">FM</div>
        <div className="brand-text">
          <div className="brand-title">Functional Monitor</div>
          <div className="brand-sub">Phase 1 prototype</div>
        </div>
      </div>

      <div className="side-section">
        <div className="side-head">
          <span>Projects</span>
          <button className="icon-btn" onClick={onCreate} title="Create new project">+</button>
        </div>

        {projects.length === 0 && (
          <div className="empty-side">
            <p>No projects yet.</p>
            <button className="primary tiny" onClick={onCreate}>Create your first project</button>
          </div>
        )}

        <div className="project-list">
          {projects.map((p) => {
            const projectUrls = urls.filter((u) => u.projectId === p.id);
            const health = computeHealth(projectUrls);
            const initial = (p.name[0] ?? "?").toUpperCase();
            const color = colorForName(p.name);
            return (
              <button
                key={p.id}
                className={`project-card ${activeProjectId === p.id ? "active" : ""}`}
                onClick={() => onSelect(p.id)}
              >
                <div className="project-avatar" style={{ background: color }}>
                  {initial}
                </div>
                <div className="project-meta">
                  <div className="project-name">{p.name}</div>
                  <div className="project-info">
                    <span className={`health-dot ${health}`} />
                    <span className="muted">
                      {projectUrls.length} URL{projectUrls.length === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

type Health = "healthy" | "degraded" | "down" | "idle";

function computeHealth(urls: MonitoredUrl[]): Health {
  if (urls.length === 0) return "idle";
  const failing = urls.filter(
    (u) => u.statusGroup === "5xx" || u.statusGroup === "error"
  ).length;
  const warning = urls.filter((u) => u.statusGroup === "4xx").length;
  if (failing > 0) return "down";
  if (warning > 0) return "degraded";
  if (urls.every((u) => !u.statusGroup)) return "idle";
  return "healthy";
}

const PALETTE = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#ec4899",
  "#f97316",
  "#14b8a6",
];

function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export const _testHelpers = { colorForName, computeHealth };

export type _Status = StatusGroup;
