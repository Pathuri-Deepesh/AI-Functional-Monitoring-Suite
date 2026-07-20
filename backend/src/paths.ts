import { resolve, join } from "node:path";
import { mkdirSync } from "node:fs";

export const UPLOADS_DIR = resolve("./data/uploads");
mkdirSync(UPLOADS_DIR, { recursive: true });

export function uploadPath(id: string): string {
  return join(UPLOADS_DIR, id);
}

export const REPORTS_DIR = resolve("./data/reports");
mkdirSync(REPORTS_DIR, { recursive: true });

/**
 * Local-disk fallback path for a report, mirroring the S3 key layout
 * reports/<projectId>/<filename>. The per-project subdir is created on demand.
 */
export function reportPath(projectId: string, filename: string): string {
  return join(REPORTS_DIR, projectId, filename);
}
