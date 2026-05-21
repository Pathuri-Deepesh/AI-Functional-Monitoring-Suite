import { useEffect, useRef, useState } from "react";
import { deleteUpload, listUploads, uploadFile, uploadUrl } from "../api";
import type { BinaryBodyConfig, Upload } from "../types";

/**
 * Edits a step body for bodyType="binary". The body is stored as JSON
 * `{uploadId, fieldName?}`. Empty fieldName = send raw bytes with the file's
 * stored MIME type. Non-empty = wrap as multipart/form-data with that one field.
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
  const [success, setSuccess] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const cfg = parseCfg(body);
  const currentId = cfg?.uploadId ?? "";
  const fieldName = cfg?.fieldName ?? "";
  const sendAs: "raw" | "form" = fieldName ? "form" : "raw";
  const selected = uploads.find((u) => u.id === currentId);
  const otherUploads = uploads.filter((u) => u.id !== currentId);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Auto-hide success banner after 3 s so it doesn't linger forever.
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 3000);
    return () => clearTimeout(t);
  }, [success]);

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
    setSuccess(null);
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
      setSuccess(`Uploaded "${u.filename}" — ready to send.`);
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

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  async function removeSelected() {
    if (!selected) return;
    if (!confirm(`Delete "${selected.filename}" from this project's uploads?`)) return;
    setBusy(true);
    try {
      await deleteUpload(selected.id);
      setUploads((prev) => prev.filter((p) => p.id !== selected.id));
      writeCfg({ uploadId: "" });
      setSuccess(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bin-editor">
      {/* Hidden native picker — opened by buttons / dropzone clicks */}
      <input
        ref={fileRef}
        type="file"
        style={{ display: "none" }}
        onChange={onFilePicked}
      />

      {/* ===== Empty state: a clear, clickable dropzone ===== */}
      {!selected && !busy && (
        <div
          className={`bin-dropzone ${dragOver ? "drag-over" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileRef.current?.click();
            }
          }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <div className="bin-dropzone-icon">📁</div>
          <div className="bin-dropzone-title">
            {dragOver ? "Drop to upload" : "Click to browse or drag a file here"}
          </div>
          <div className="bin-dropzone-sub">
            Stored on this project · up to {humanSize(MAX_BYTES)} · any file type
          </div>
        </div>
      )}

      {/* ===== Busy state: progress bar with percentage ===== */}
      {busy && (
        <div className="bin-uploading">
          <div className="bin-uploading-head">
            <span className="bin-uploading-icon">⬆</span>
            <span>Uploading…</span>
            <span className="muted small">{progress ?? 0}%</span>
          </div>
          <div className="bin-progress-track">
            <div
              className="bin-progress-fill"
              style={{ width: `${progress ?? 0}%` }}
            />
          </div>
        </div>
      )}

      {/* ===== Selected file card ===== */}
      {selected && !busy && (
        <div className="bin-selected">
          <div className="bin-selected-head">
            <div className="bin-thumb">
              {isImage(selected.mimeType) ? (
                <img src={uploadUrl(selected.id)} alt={selected.filename} />
              ) : (
                <span className="bin-thumb-ext">{fileExt(selected.filename)}</span>
              )}
            </div>
            <div className="bin-selected-meta">
              <div className="bin-selected-name" title={selected.filename}>
                {selected.filename}
              </div>
              <div className="muted small">
                {selected.mimeType || "unknown"} · {humanSize(selected.sizeBytes)}
              </div>
              <div className="bin-selected-tag">
                <span className="meta-chip success">✓ attached to this step</span>
              </div>
            </div>
            <div className="bin-selected-actions">
              <button
                type="button"
                className="ghost small"
                onClick={() => fileRef.current?.click()}
                title="Upload a different file"
              >
                ↻ Replace
              </button>
              <button
                type="button"
                className="ghost destructive small"
                onClick={removeSelected}
                title="Delete from project uploads"
              >
                🗑 Delete
              </button>
            </div>
          </div>

          {/* Send-as toggle */}
          <div className="bin-sendas">
            <div className="bin-sendas-head">
              <span className="field-label">How to send this file</span>
              <span className="field-hint">Choose how the request body is built</span>
            </div>
            <div className="bin-sendas-options">
              <label className={`bin-sendas-opt ${sendAs === "raw" ? "active" : ""}`}>
                <input
                  type="radio"
                  name="bin-sendas"
                  checked={sendAs === "raw"}
                  onChange={() => writeCfg({ fieldName: "" })}
                />
                <div>
                  <div className="bin-sendas-title">Raw bytes</div>
                  <div className="bin-sendas-sub">
                    Body = file contents · <code>Content-Type: {selected.mimeType || "application/octet-stream"}</code>
                  </div>
                </div>
              </label>
              <label className={`bin-sendas-opt ${sendAs === "form" ? "active" : ""}`}>
                <input
                  type="radio"
                  name="bin-sendas"
                  checked={sendAs === "form"}
                  onChange={() => writeCfg({ fieldName: fieldName || "file" })}
                />
                <div style={{ flex: 1 }}>
                  <div className="bin-sendas-title">Form field (multipart/form-data)</div>
                  <div className="bin-sendas-sub">
                    Wraps the file as one form field — needed by most upload endpoints
                  </div>
                  {sendAs === "form" && (
                    <input
                      type="text"
                      className="bin-fieldname-input"
                      placeholder="field name (e.g. file, avatar, attachment)"
                      value={fieldName}
                      onChange={(e) => writeCfg({ fieldName: e.target.value })}
                      onClick={(e) => e.preventDefault()}
                    />
                  )}
                </div>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* ===== Inline status banners ===== */}
      {success && (
        <div className="bin-banner success">
          <span>✓</span><span>{success}</span>
        </div>
      )}
      {err && (
        <div className="bin-banner error">
          <span>⚠</span><span>{err}</span>
        </div>
      )}

      {/* ===== Library: existing uploads from this project ===== */}
      {otherUploads.length > 0 && (
        <div className="bin-library">
          <button
            type="button"
            className="bin-library-toggle"
            onClick={() => setShowLibrary(!showLibrary)}
          >
            <span>{showLibrary ? "▾" : "▸"}</span>
            <span>
              {selected ? "Choose a different file" : "Or use a file already uploaded"} ({otherUploads.length})
            </span>
          </button>
          {showLibrary && (
            <div className="bin-library-list">
              {otherUploads.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  className="bin-library-row"
                  onClick={() => { writeCfg({ uploadId: u.id }); setShowLibrary(false); }}
                  title={`${u.mimeType} · ${humanSize(u.sizeBytes)}`}
                >
                  <div className="bin-thumb small">
                    {isImage(u.mimeType) ? (
                      <img src={uploadUrl(u.id)} alt="" />
                    ) : (
                      <span className="bin-thumb-ext">{fileExt(u.filename)}</span>
                    )}
                  </div>
                  <div className="bin-library-meta">
                    <div className="bin-library-name">{u.filename}</div>
                    <div className="muted small">
                      {u.mimeType || "unknown"} · {humanSize(u.sizeBytes)}
                    </div>
                  </div>
                  <div className="bin-library-cta">use →</div>
                </button>
              ))}
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
