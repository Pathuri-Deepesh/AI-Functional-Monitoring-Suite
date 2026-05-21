import { useEffect, useRef, useState } from "react";
import { deleteUpload, listUploads, uploadFile, uploadUrl } from "../api";
import type { BinaryBodyConfig, Upload } from "../types";

/**
 * Postman-style binary body editor.
 *
 * Body is JSON `{uploadId, fieldName?}`. Empty fieldName = raw bytes
 * with the file's stored MIME type. Set fieldName = multipart/form-data
 * with that one field.
 */
const MAX_BYTES = 10 * 1024 * 1024; // mirrors backend MAX_UPLOAD_BYTES

export function BinaryBodyEditor(props: {
  body: string;
  setBody: (b: string) => void;
  projectId: string;
}) {
  const { body, setBody, projectId } = props;
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  /** id of the upload currently in "click again to confirm" state; null = nothing armed. */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const confirmTimer = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const cfg = parseCfg(body);
  const currentId = cfg?.uploadId ?? "";
  const fieldName = cfg?.fieldName ?? "";
  const selected = uploads.find((u) => u.id === currentId);
  const otherUploads = uploads.filter((u) => u.id !== currentId);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function refresh() {
    try {
      setUploads(await listUploads(projectId));
    } catch {
      // non-fatal — empty list is fine
    }
  }

  function writeCfg(next: { uploadId?: string; fieldName?: string }) {
    const merged: BinaryBodyConfig = {
      uploadId: next.uploadId ?? currentId,
      fieldName: next.fieldName !== undefined ? next.fieldName : fieldName,
    };
    if (!merged.uploadId) {
      setBody("");
      return;
    }
    const payload: BinaryBodyConfig = { uploadId: merged.uploadId };
    if (merged.fieldName && merged.fieldName.trim()) payload.fieldName = merged.fieldName.trim();
    setBody(JSON.stringify(payload));
  }

  async function handleFile(file: File) {
    setErr(null);
    if (file.size > MAX_BYTES) {
      setErr(`File is ${humanSize(file.size)} — max upload is ${humanSize(MAX_BYTES)}.`);
      return;
    }
    setBusy(true);
    setProgress(0);
    try {
      const u = await uploadFile(projectId, file, (pct) => setProgress(pct));
      setUploads((prev) => [u, ...prev.filter((p) => p.id !== u.id)]);
      writeCfg({ uploadId: u.id });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  }

  /**
   * Two-click confirm: first click arms (sets confirmingId + 4s timeout),
   * second click on the same id actually deletes. Click on a different id
   * resets the arming to that id.
   */
  function requestDelete(id: string) {
    if (confirmingId !== id) {
      setConfirmingId(id);
      if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
      confirmTimer.current = window.setTimeout(() => setConfirmingId(null), 4000);
      return;
    }
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
    confirmTimer.current = null;
    setConfirmingId(null);
    void deleteFile(id);
  }

  async function deleteFile(id: string) {
    try {
      await deleteUpload(id);
      setUploads((prev) => prev.filter((p) => p.id !== id));
      if (id === currentId) writeCfg({ uploadId: "" });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    }
  }

  // Cancel any pending confirm timer on unmount
  useEffect(() => () => {
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
  }, []);

  return (
    <div className="pm-binary">
      <input
        ref={fileRef}
        type="file"
        style={{ display: "none" }}
        onChange={onFilePicked}
      />

      {/* ===== Postman-style file row ===== */}
      <div className="pm-binary-row">
        <button
          type="button"
          className="pm-select-btn"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          {busy ? "Uploading…" : selected ? "Select File" : "Select File"}
        </button>
        <div className="pm-file-display">
          {busy ? (
            <span className="muted small">Uploading… {progress ?? 0}%</span>
          ) : selected ? (
            <>
              <span className="pm-file-name" title={selected.filename}>
                {selected.filename}
              </span>
              <span className="muted small">· {humanSize(selected.sizeBytes)}</span>
              <button
                type="button"
                className={`pm-clear-btn ${confirmingId === selected.id ? "confirming" : ""}`}
                onClick={() => requestDelete(selected.id)}
                title={
                  confirmingId === selected.id
                    ? "Click again to confirm delete"
                    : "Delete this file from the project"
                }
              >
                {confirmingId === selected.id ? "Click to confirm" : "×"}
              </button>
            </>
          ) : (
            <span className="muted small">No file chosen</span>
          )}
        </div>
      </div>

      {/* Inline progress bar while uploading */}
      {busy && (
        <div className="pm-progress-track">
          <div className="pm-progress-fill" style={{ width: `${progress ?? 0}%` }} />
        </div>
      )}

      {/* Inline error */}
      {err && <div className="pm-binary-err">{err}</div>}

      {/* ===== Field name (multipart vs raw) ===== */}
      <label className="field">
        <div className="field-head">
          <span className="field-label">Field name (optional)</span>
          <span className="field-hint">
            Empty = raw bytes · Set = multipart/form-data with this field
          </span>
        </div>
        <input
          type="text"
          placeholder="e.g. file, avatar, attachment"
          value={fieldName}
          onChange={(e) => writeCfg({ fieldName: e.target.value })}
          disabled={!selected || busy}
        />
      </label>

      {/* ===== Library: previously uploaded files in this project ===== */}
      {uploads.length > 0 && (
        <div className="pm-library">
          <button
            type="button"
            className="pm-library-toggle"
            onClick={() => setShowLibrary(!showLibrary)}
          >
            <span>{showLibrary ? "▾" : "▸"}</span>
            <span>Project uploads ({uploads.length})</span>
          </button>
          {showLibrary && (
            <div className="pm-library-list">
              {uploads.map((u) => {
                const isActive = u.id === currentId;
                return (
                  <div
                    key={u.id}
                    className={`pm-library-row ${isActive ? "active" : ""}`}
                  >
                    {isImage(u.mimeType) ? (
                      <img
                        className="pm-library-thumb"
                        src={uploadUrl(u.id)}
                        alt=""
                      />
                    ) : (
                      <span className="pm-library-ext">{fileExt(u.filename)}</span>
                    )}
                    <button
                      type="button"
                      className="pm-library-pick"
                      onClick={() => { writeCfg({ uploadId: u.id }); setShowLibrary(false); }}
                      title="Use this file"
                    >
                      <span className="pm-library-name">{u.filename}</span>
                      <span className="muted small">
                        {u.mimeType || "unknown"} · {humanSize(u.sizeBytes)}
                      </span>
                    </button>
                    {isActive && <span className="pm-library-check" title="In use">✓</span>}
                    <button
                      type="button"
                      className={`pm-library-del ${confirmingId === u.id ? "confirming" : ""}`}
                      onClick={() => requestDelete(u.id)}
                      title={
                        confirmingId === u.id
                          ? "Click again to confirm delete"
                          : "Delete from project"
                      }
                    >
                      {confirmingId === u.id ? "Confirm?" : "🗑"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function parseCfg(body: string): BinaryBodyConfig | null {
  if (!body) return null;
  try {
    const o = JSON.parse(body) as BinaryBodyConfig;
    if (typeof o?.uploadId === "string") return o;
  } catch {
    // not parseable — treat as no selection
  }
  return null;
}

function isImage(mime: string): boolean {
  return mime.startsWith("image/");
}

function fileExt(filename: string): string {
  const i = filename.lastIndexOf(".");
  if (i < 0 || i === filename.length - 1) return "FILE";
  return filename.slice(i + 1).toUpperCase().slice(0, 4);
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
