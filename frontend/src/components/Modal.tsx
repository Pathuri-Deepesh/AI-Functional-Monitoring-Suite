import { useEffect, useRef } from "react";

export function Modal(props: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const { open, title, subtitle, onClose, children, size = "md" } = props;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose();
      }}
      ref={ref}
    >
      <div className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <div>
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const {
    open,
    title,
    message,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    destructive,
    onConfirm,
    onCancel,
  } = props;
  return (
    <Modal open={open} title={title} onClose={onCancel} size="sm">
      <p className="confirm-message">{message}</p>
      <div className="modal-actions">
        <button className="ghost" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button className={destructive ? "destructive" : "primary"} onClick={onConfirm} autoFocus>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export interface ToastItem {
  id: number;
  kind: "success" | "error" | "info";
  message: string;
}

export function ToastStack(props: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toast-stack" aria-live="polite">
      {props.toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <ToastIcon kind={t.kind} />
          <span className="toast-msg">{t.message}</span>
          <button className="toast-close" onClick={() => props.onDismiss(t.id)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function ToastIcon({ kind }: { kind: ToastItem["kind"] }) {
  if (kind === "success") {
    return (
      <svg className="toast-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.15" />
        <path d="M5 8.5l2 2 4-4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    );
  }
  if (kind === "error") {
    return (
      <svg className="toast-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.15" />
        <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg className="toast-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.15" />
      <path d="M8 6.5v4M8 4.2v0.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
