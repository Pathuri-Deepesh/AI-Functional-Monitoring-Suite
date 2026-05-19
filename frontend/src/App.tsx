import { useEffect, useMemo, useRef, useState } from "react";
import { checkUrlNow, deleteProject, fetchStatus, removeUrl, runAudit } from "./api";
import { Sidebar } from "./components/Sidebar";
import { ProjectView } from "./components/ProjectView";
import { ConfirmDialog, Modal, ToastStack, type ToastItem } from "./components/Modal";
import { SkeletonProject, SkeletonSidebar } from "./components/Skeleton";
import { Spinner } from "./components/Spinner";
import {
  AddUrlForm,
  ApiKeyManagerForm,
  CreateProjectForm,
  SettingsForm,
} from "./components/forms";
import type { AuditResult, FullSnapshot, Project } from "./types";

const POLL_MS = 3000;

type ModalState =
  | { kind: "none" }
  | { kind: "create-project" }
  | { kind: "add-url"; project: Project }
  | { kind: "manage-keys"; project: Project }
  | { kind: "settings"; project: Project }
  | { kind: "confirm-delete-project"; project: Project }
  | { kind: "confirm-delete-url"; urlId: string; urlText: string }
  | { kind: "audit-running"; projectName: string }
  | { kind: "audit-result"; result: AuditResult; projectName: string };

export default function App() {
  const [snapshot, setSnapshot] = useState<FullSnapshot | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);
  const toastSeq = useRef(0);
  const timer = useRef<number | null>(null);

  function pushToast(message: string, kind: ToastItem["kind"] = "success") {
    const id = ++toastSeq.current;
    setToasts((t) => [...t, { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 4000);
  }

  function dismissToast(id: number) {
    setToasts((t) => t.filter((x) => x.id !== id));
  }

  async function refresh() {
    try {
      const data = await fetchStatus();
      setSnapshot(data);
      setActiveProjectId((current) => {
        if (current && data.projects.some((p) => p.id === current)) return current;
        return data.projects[0]?.id ?? null;
      });
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    refresh();
    timer.current = window.setInterval(refresh, POLL_MS);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeProject = useMemo(
    () => snapshot?.projects.find((p) => p.id === activeProjectId) ?? null,
    [snapshot, activeProjectId]
  );
  const projectUrls = useMemo(
    () => snapshot?.urls.filter((u) => u.projectId === activeProjectId) ?? [],
    [snapshot, activeProjectId]
  );

  async function handleCheckUrl(id: string) {
    try {
      await checkUrlNow(id);
      await refresh();
      setRefreshTick((t) => t + 1);
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "Check failed", "error");
    }
  }

  async function handleDeleteUrl(id: string) {
    const u = snapshot?.urls.find((x) => x.id === id);
    setModal({ kind: "confirm-delete-url", urlId: id, urlText: u?.url ?? "this URL" });
  }

  async function confirmDeleteUrl() {
    if (modal.kind !== "confirm-delete-url") return;
    try {
      await removeUrl(modal.urlId);
      pushToast("URL removed");
      await refresh();
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "Failed to remove", "error");
    } finally {
      setModal({ kind: "none" });
    }
  }

  async function confirmDeleteProject() {
    if (modal.kind !== "confirm-delete-project") return;
    try {
      await deleteProject(modal.project.id);
      pushToast(`Deleted "${modal.project.name}"`);
      await refresh();
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "Failed to delete", "error");
    } finally {
      setModal({ kind: "none" });
    }
  }

  async function handleRunAudit() {
    if (!activeProject) return;
    setModal({ kind: "audit-running", projectName: activeProject.name });
    try {
      const result = await runAudit(activeProject.id);
      await refresh();
      setRefreshTick((t) => t + 1);
      setModal({ kind: "audit-result", result, projectName: activeProject.name });
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "Audit failed", "error");
      setModal({ kind: "none" });
    }
  }

  async function handleFormDone(message?: string) {
    setModal({ kind: "none" });
    if (message) pushToast(message);
    await refresh();
    setRefreshTick((t) => t + 1);
  }

  // First-load skeleton (before the first snapshot arrives)
  if (snapshot === null) {
    return (
      <div className="app">
        <SkeletonSidebar />
        <SkeletonProject />
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar
        projects={snapshot?.projects ?? []}
        urls={snapshot?.urls ?? []}
        activeProjectId={activeProjectId}
        onSelect={setActiveProjectId}
        onCreate={() => setModal({ kind: "create-project" })}
      />

      {activeProject ? (
        <ProjectView
          key={activeProject.id}
          project={activeProject}
          urls={projectUrls}
          refreshTick={refreshTick}
          onAddUrl={() => setModal({ kind: "add-url", project: activeProject })}
          onManageKeys={() => setModal({ kind: "manage-keys", project: activeProject })}
          onSettings={() => setModal({ kind: "settings", project: activeProject })}
          onDeleteProject={() =>
            setModal({ kind: "confirm-delete-project", project: activeProject })
          }
          onRunAudit={handleRunAudit}
          auditRunning={modal.kind === "audit-running"}
          onCheckUrl={handleCheckUrl}
          onRemoveUrl={handleDeleteUrl}
        />
      ) : (
        <main className="main">
          <div className="empty-card big">
            <div className="empty-icon">🚀</div>
            <h3>Welcome to Functional Monitor</h3>
            <p>
              Group URLs by project, attach API keys, define assertions, and watch them live with
              full latency breakdowns and 24h history.
            </p>
            <button className="primary" onClick={() => setModal({ kind: "create-project" })}>
              + Create your first project
            </button>
          </div>
        </main>
      )}

      <Modal
        open={modal.kind === "create-project"}
        title="New project"
        subtitle="A project groups related URLs (e.g. one service) and their API keys."
        onClose={() => setModal({ kind: "none" })}
      >
        <CreateProjectForm onDone={handleFormDone} onError={(m) => pushToast(m, "error")} />
      </Modal>

      <Modal
        open={modal.kind === "add-url"}
        title="Add URL to monitor"
        subtitle={modal.kind === "add-url" ? `In project: ${modal.project.name}` : undefined}
        onClose={() => setModal({ kind: "none" })}
        size="lg"
      >
        {modal.kind === "add-url" && (
          <AddUrlForm
            project={modal.project}
            onDone={handleFormDone}
            onError={(m) => pushToast(m, "error")}
          />
        )}
      </Modal>

      <Modal
        open={modal.kind === "manage-keys"}
        title="API keys"
        subtitle={
          modal.kind === "manage-keys"
            ? `Keys for: ${modal.project.name} — only URLs in this project can use them.`
            : undefined
        }
        onClose={() => setModal({ kind: "none" })}
        size="lg"
      >
        {modal.kind === "manage-keys" && (
          <ApiKeyManagerForm
            project={modal.project}
            onDone={handleFormDone}
            onError={(m) => pushToast(m, "error")}
          />
        )}
      </Modal>

      <Modal
        open={modal.kind === "settings"}
        title="Project settings"
        onClose={() => setModal({ kind: "none" })}
        size="lg"
      >
        {modal.kind === "settings" && (
          <SettingsForm
            project={modal.project}
            onDone={handleFormDone}
            onError={(m) => pushToast(m, "error")}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={modal.kind === "confirm-delete-project"}
        title="Delete project?"
        message={
          modal.kind === "confirm-delete-project"
            ? `This will permanently delete "${modal.project.name}", all of its URLs, and all check history. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete project"
        destructive
        onConfirm={confirmDeleteProject}
        onCancel={() => setModal({ kind: "none" })}
      />

      <ConfirmDialog
        open={modal.kind === "confirm-delete-url"}
        title="Remove URL?"
        message={
          modal.kind === "confirm-delete-url"
            ? `Stop monitoring ${modal.urlText}? Its check history will also be deleted.`
            : ""
        }
        confirmLabel="Remove"
        destructive
        onConfirm={confirmDeleteUrl}
        onCancel={() => setModal({ kind: "none" })}
      />

      <Modal
        open={modal.kind === "audit-running"}
        title="Running audit…"
        onClose={() => {
          /* intentionally not closable */
        }}
      >
        <div className="audit-progress">
          <Spinner size={36} inline={false} />
          <p>
            Re-checking every URL in <strong>{modal.kind === "audit-running" ? modal.projectName : ""}</strong>…
          </p>
          <p className="muted small">This may take up to a minute depending on URL count.</p>
        </div>
      </Modal>

      <Modal
        open={modal.kind === "audit-result"}
        title="Audit complete"
        subtitle={modal.kind === "audit-result" ? `Project: ${modal.projectName}` : undefined}
        onClose={() => setModal({ kind: "none" })}
      >
        {modal.kind === "audit-result" && (
          <div className="audit-result">
            <div className="audit-summary">
              <div className="audit-stat">
                <div className="audit-num">{modal.result.totalUrls}</div>
                <div className="audit-lbl">Endpoints checked</div>
              </div>
              <div className="audit-stat">
                <div className="audit-num" style={{ color: "var(--g-2xx)" }}>
                  {modal.result.okUrls}
                </div>
                <div className="audit-lbl">Healthy</div>
              </div>
              <div className="audit-stat">
                <div
                  className="audit-num"
                  style={{ color: modal.result.failingUrls > 0 ? "var(--g-5xx)" : "var(--g-2xx)" }}
                >
                  {modal.result.failingUrls}
                </div>
                <div className="audit-lbl">Failing</div>
              </div>
            </div>

            <div className="audit-actions">
              <a
                className="audit-link"
                href={modal.result.reportUrl}
                target="_blank"
                rel="noreferrer"
              >
                📄 Open HTML report
              </a>
              {modal.result.slack.posted ? (
                <div className="audit-slack good">✅ Posted to Slack</div>
              ) : (
                <div className="audit-slack neutral">
                  ℹ️ Slack: {modal.result.slack.reason ?? "not configured"}
                </div>
              )}
            </div>

            <div className="modal-actions">
              <button className="primary" onClick={() => setModal({ kind: "none" })}>
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <footer className="app-footer">
        <span>
          Refreshed at {snapshot ? new Date(snapshot.lastUpdated).toLocaleTimeString() : "—"}
        </span>
        <span className="footer-help">
          Dashboard pulls fresh data every {POLL_MS / 1000}s · each URL is re-pinged on its own
          schedule (default 5 min) · click <strong>Check now</strong> to ping immediately
        </span>
      </footer>
    </div>
  );
}
