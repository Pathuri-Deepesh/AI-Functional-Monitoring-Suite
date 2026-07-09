import { readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { uploadPath } from "./paths.js";

/**
 * Phase 1.29 — S3-backed storage for uploaded files, with local-disk fallback.
 *
 * Scope: uploads only. Audit reports stay on local disk (they're regenerated
 * on every audit run and email delivery attaches them by local path).
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
