import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import type { ApiKey } from "./types.js";

/**
 * Phase 1.28 — AWS Secrets Manager write-through vault for per-project API keys.
 *
 * Storage shape (JSON stored under one AWS secret):
 *   {
 *     "_meta": { "updated": "...", "notes": "..." },
 *     "<projectId>": {
 *       "<keyId>": { "name": "...", "value": "...", "headerName": "...", "headerPrefix": "..." },
 *       ...
 *     },
 *     ...
 *   }
 *
 * Boot: call loadProjectApiKeys() once → hydrates in-RAM cache.
 * Read: getApiKeyForProject(projectId, keyId) → RAM lookup.
 * Write: upsert/delete helpers do a read-modify-write against AWS AND refresh cache.
 * On AWS failure during write: the helpers throw; caller decides how to surface it.
 */

const REGION = process.env.AWS_REGION || "us-east-1";
const SECRET_ARN = process.env.PROJECT_KEYS_SECRET_ARN;

const client = new SecretsManagerClient({ region: REGION });

type Meta = { updated?: string; notes?: string };
type ProjectKeys = Record<string, ApiKey>;
type SecretShape = { _meta?: Meta } & Record<string, ProjectKeys | Meta | undefined>;

let cache: Record<string, ProjectKeys> = {};
let loaded = false;

function isProjectKeysBucket(v: unknown): v is ProjectKeys {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function parseSecret(json: string): { keys: Record<string, ProjectKeys>; meta: Meta } {
  const parsed = JSON.parse(json) as SecretShape;
  const meta: Meta = (parsed._meta as Meta) ?? {};
  const keys: Record<string, ProjectKeys> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (k === "_meta") continue;
    if (isProjectKeysBucket(v)) {
      const bucket: ProjectKeys = {};
      for (const [keyId, entry] of Object.entries(v)) {
        if (
          entry &&
          typeof entry === "object" &&
          typeof (entry as ApiKey).value === "string"
        ) {
          const e = entry as ApiKey;
          bucket[keyId] = {
            id: e.id ?? keyId,
            name: e.name ?? "",
            value: e.value,
            headerName: e.headerName ?? "Authorization",
            headerPrefix: e.headerPrefix ?? "Bearer ",
          };
        }
      }
      keys[k] = bucket;
    }
  }
  return { keys, meta };
}

function serializeSecret(keys: Record<string, ProjectKeys>, meta: Meta): string {
  const today = new Date().toISOString().slice(0, 10);
  const out: SecretShape = { _meta: { ...meta, updated: today } };
  for (const [projectId, bucket] of Object.entries(keys)) {
    out[projectId] = bucket;
  }
  const json = JSON.stringify(out, null, 2);
  if (Buffer.byteLength(json, "utf8") > 60_000) {
    throw new Error(
      "Secret JSON is approaching the 64 KB AWS limit. Split into a second secret before adding more."
    );
  }
  return json;
}

export async function loadProjectApiKeys(): Promise<void> {
  if (!SECRET_ARN) throw new Error("PROJECT_KEYS_SECRET_ARN is not set in .env");
  const res = await client.send(new GetSecretValueCommand({ SecretId: SECRET_ARN }));
  if (!res.SecretString) throw new Error("Secret has no SecretString value");
  const { keys } = parseSecret(res.SecretString);
  cache = keys;
  loaded = true;
  const totalKeys = Object.values(cache).reduce((n, b) => n + Object.keys(b).length, 0);
  console.log(
    `[secrets] loaded ${totalKeys} API keys across ${Object.keys(cache).length} projects`
  );
}

export async function reloadProjectApiKeys(): Promise<void> {
  loaded = false;
  await loadProjectApiKeys();
}

export function isSecretsManagerEnabled(): boolean {
  return !!SECRET_ARN && loaded;
}

export function getProjectKeysFromSecrets(projectId: string): ApiKey[] {
  if (!loaded) return [];
  const bucket = cache[projectId];
  if (!bucket) return [];
  return Object.values(bucket);
}

export function getApiKeyForProject(projectId: string, keyId: string): ApiKey | null {
  if (!loaded) return null;
  return cache[projectId]?.[keyId] ?? null;
}

async function mutateSecret(
  mutator: (keys: Record<string, ProjectKeys>, meta: Meta) => void
): Promise<void> {
  if (!SECRET_ARN) throw new Error("PROJECT_KEYS_SECRET_ARN is not set in .env");
  const res = await client.send(new GetSecretValueCommand({ SecretId: SECRET_ARN }));
  if (!res.SecretString) throw new Error("Secret has no SecretString value");
  const { keys, meta } = parseSecret(res.SecretString);
  mutator(keys, meta);
  const json = serializeSecret(keys, meta);
  await client.send(
    new PutSecretValueCommand({ SecretId: SECRET_ARN, SecretString: json })
  );
  cache = keys;
}

export async function upsertProjectApiKey(projectId: string, key: ApiKey): Promise<void> {
  await mutateSecret((keys) => {
    if (!keys[projectId]) keys[projectId] = {};
    keys[projectId][key.id] = { ...key };
  });
}

export async function deleteProjectApiKeyFromSecrets(
  projectId: string,
  keyId: string
): Promise<void> {
  await mutateSecret((keys) => {
    if (keys[projectId]) {
      delete keys[projectId][keyId];
      if (Object.keys(keys[projectId]).length === 0) {
        delete keys[projectId];
      }
    }
  });
}
