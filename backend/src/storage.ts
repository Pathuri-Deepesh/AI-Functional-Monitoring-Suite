import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
} from "@aws-sdk/client-s3";
import { uploadPath, reportPath, REPORTS_DIR } from "./paths.js";

/**
 * Phase 1.29 — S3-backed storage for uploaded files, with local-disk fallback.
 * Phase 1.31 — audit reports also stored in S3 (key `reports/<projectId>/<file>`)
 * so report history is browsable in the bucket and survives instance replacement.
 * Reports are served via a backend route (readReport) and attached to emails from
 * bytes, so they no longer depend on a local file path.
 *
 * Behavior: fail loud. If S3_BUCKET_NAME is set and an S3 call fails, the
 * error propagates — no silent fallback to disk once S3 is the chosen backend.
 * If S3_BUCKET_NAME is unset, local disk is used as before (dev machines).
 */

const REGION = process.env.AWS_REGION || "us-east-1";
const BUCKET = process.env.S3_BUCKET_NAME;

const client = BUCKET ? new S3Client({ region: REGION }) : null;

export function isS3Enabled(): boolean {
  return !!BUCKET;
}

export async function saveUpload(id: string, buf: Buffer): Promise<void> {
  if (client) {
    await client.send(
      new PutObjectCommand({ Bucket: BUCKET, Key: `uploads/${id}`, Body: buf })
    );
    return;
  }
  writeFileSync(uploadPath(id), buf);
}

export async function readUpload(id: string): Promise<Buffer> {
  if (client) {
    const res = await client.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: `uploads/${id}` })
    );
    const bytes = await res.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }
  return readFileSync(uploadPath(id));
}

export async function uploadExists(id: string): Promise<boolean> {
  if (client) {
    try {
      await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: `uploads/${id}` }));
      return true;
    } catch {
      return false;
    }
  }
  try {
    statSync(uploadPath(id));
    return true;
  } catch {
    return false;
  }
}

export async function deleteUploadFile(id: string): Promise<void> {
  if (client) {
    await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: `uploads/${id}` }));
    return;
  }
  try {
    unlinkSync(uploadPath(id));
  } catch {
    // file already gone — ignore
  }
}

// ── Reports ────────────────────────────────────────────────────────────────
// S3 key layout: reports/<projectId>/<filename>. Local fallback mirrors it under
// ./data/reports/<projectId>/<filename>.

function reportKey(projectId: string, filename: string): string {
  return `reports/${projectId}/${filename}`;
}

export async function saveReport(
  projectId: string,
  filename: string,
  buf: Buffer
): Promise<void> {
  if (client) {
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: reportKey(projectId, filename),
        Body: buf,
        ContentType: "text/html",
      })
    );
    return;
  }
  const p = reportPath(projectId, filename);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, buf);
}

export async function readReport(
  projectId: string,
  filename: string
): Promise<Buffer> {
  if (client) {
    const res = await client.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: reportKey(projectId, filename) })
    );
    const bytes = await res.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }
  return readFileSync(reportPath(projectId, filename));
}

/** List a project's report filenames (newest first), for a history view. */
export async function listReports(projectId: string): Promise<string[]> {
  if (client) {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `reports/${projectId}/` })
    );
    return (res.Contents ?? [])
      .filter((o) => !!o.Key && !o.Key.endsWith("/"))
      .sort(
        (a, b) =>
          (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0)
      )
      .map((o) => o.Key!.split("/").pop()!);
  }
  try {
    return readdirSync(reportPath(projectId, "")).filter((f) => f.endsWith(".html"));
  } catch {
    return [];
  }
}

/**
 * Delete report objects older than `retentionMs`. Mirrors the disk pruner but for
 * S3 — lists everything under reports/ and deletes by LastModified age.
 */
export async function pruneReportsS3(retentionMs: number): Promise<number> {
  const s3 = client;
  if (!s3) return 0;
  const cutoff = Date.now() - retentionMs;
  let deleted = 0;
  let token: string | undefined;
  do {
    const res: ListObjectsV2CommandOutput = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: "reports/",
        ContinuationToken: token,
      })
    );
    for (const obj of res.Contents ?? []) {
      if (!obj.Key || obj.Key.endsWith("/")) continue;
      if ((obj.LastModified?.getTime() ?? Infinity) < cutoff) {
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: obj.Key }));
        deleted++;
      }
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return deleted;
}

/** Re-export for callers that need the local reports dir (disk fallback pruning). */
export { REPORTS_DIR };
