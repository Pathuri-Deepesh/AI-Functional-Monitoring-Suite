import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { lookup as dnsLookup } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { getUpload } from "./store.js";
import { uploadPath } from "./paths.js";
import type { BinaryBodyConfig, BodyType, HttpMethod, KeyValue, Timings } from "./types.js";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_BODY_BYTES = 256 * 1024; // capture up to 256KB of response body for assertions

// Phase 1.27.9 — SSRF blocklist. The app's job is to fetch user-supplied URLs,
// so an unconstrained client would happily hit cloud metadata
// (169.254.169.254), internal admin panels, and localhost services. Default:
// block every private / loopback / link-local / metadata / CGN / multicast
// range. Opt back in for testing internal endpoints via env:
//
//     SSRF_ALLOW_PRIVATE=true
//
// The resolved IP is also PINNED through the http.request `lookup` option so
// that DNS rebinding (resolve to public IP for the check, then flip to
// internal IP for the connect) is structurally impossible.
const ALLOW_PRIVATE_TARGETS =
  (process.env.SSRF_ALLOW_PRIVATE ?? "").toLowerCase() === "true";

function isPrivateOrLoopback(ip: string): boolean {
  // IPv6
  if (ip.includes(":")) {
    if (ip === "::1" || ip === "::") return true;
    const lower = ip.toLowerCase();
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local (ULA)
    if (lower.startsWith("fe80")) return true; // link-local
    if (lower.startsWith("ff")) return true;   // multicast
    // IPv4-mapped: ::ffff:a.b.c.d
    const m = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (m) return isPrivateV4(m[1]);
    return false;
  }
  return isPrivateV4(ip);
}

function isPrivateV4(ip: string): boolean {
  const parts = ip.split(".").map((s) => Number(s));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 0) return true;                             // 0.0.0.0/8 — "this network"
  if (a === 10) return true;                            // 10.0.0.0/8
  if (a === 127) return true;                           // 127.0.0.0/8 — loopback
  if (a === 169 && b === 254) return true;              // 169.254.0.0/16 — link-local incl. AWS/GCP/Azure metadata
  if (a === 172 && b >= 16 && b <= 31) return true;     // 172.16.0.0/12
  if (a === 192 && b === 168) return true;              // 192.168.0.0/16
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24 — IETF Protocol Assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 — benchmarking
  if (a === 100 && b >= 64 && b <= 127) return true;    // 100.64.0.0/10 — CGN
  if (a >= 224) return true;                            // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false;
}

interface ResolveOk {
  ok: true;
  address: string;
  family: 4 | 6;
}
interface ResolveErr {
  ok: false;
  reason: string;
}

async function resolveSafely(hostname: string): Promise<ResolveOk | ResolveErr> {
  // Numeric literal? Skip DNS entirely.
  const isLiteralV4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
  const isLiteralV6 = hostname.includes(":") && /^[0-9a-fA-F:.]+$/.test(hostname);
  if (isLiteralV4 || isLiteralV6) {
    const family: 4 | 6 = isLiteralV6 ? 6 : 4;
    if (!ALLOW_PRIVATE_TARGETS && isPrivateOrLoopback(hostname)) {
      return {
        ok: false,
        reason: `Blocked by SSRF guard: ${hostname} is a private/loopback IP. Set SSRF_ALLOW_PRIVATE=true to override.`,
      };
    }
    return { ok: true, address: hostname, family };
  }
  try {
    const r = await dnsLookup(hostname, { family: 0, verbatim: true });
    if (!ALLOW_PRIVATE_TARGETS && isPrivateOrLoopback(r.address)) {
      return {
        ok: false,
        reason: `Blocked by SSRF guard: ${hostname} resolves to private/loopback IP ${r.address}. Set SSRF_ALLOW_PRIVATE=true to override.`,
      };
    }
    return { ok: true, address: r.address, family: (r.family === 6 ? 6 : 4) as 4 | 6 };
  } catch (e) {
    return {
      ok: false,
      reason: `DNS lookup failed for ${hostname}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export interface TimedResult {
  statusCode: number | null;
  timings: Timings;
  responseBody: string; // up to MAX_BODY_BYTES
  responseHeaders: Record<string, string>; // lowercase keys
  error: unknown | null;
}

export interface RequestSpec {
  url: string;
  method: HttpMethod;
  bodyType: BodyType;
  body: string;
  bodyContentType?: string;
  extraHeaders: Record<string, string>;
  customHeaders?: KeyValue[];
  queryParams?: KeyValue[];
}

export function timedFetch(spec: RequestSpec): Promise<TimedResult> {
  return new Promise((resolve) => {
    let parsed: URL;
    try {
      parsed = new URL(spec.url);
    } catch {
      resolve({
        statusCode: null,
        timings: emptyTimings(),
        responseBody: "",
        responseHeaders: {},
        error: new Error("Invalid URL"),
      });
      return;
    }

    // Defense in depth: reject any non-http(s) scheme. URL validators at
    // creation already do this for standalone URLs, but flow + prereq steps
    // path here too and a malicious `{{var}}` substitution could craft a
    // file:// or gopher:// here at runtime.
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      resolve({
        statusCode: null,
        timings: emptyTimings(),
        responseBody: "",
        responseHeaders: {},
        error: new Error(`Blocked by SSRF guard: scheme "${parsed.protocol}" is not http(s)`),
      });
      return;
    }

    // Append custom query params to whatever already exists in the URL
    if (spec.queryParams && spec.queryParams.length > 0) {
      for (const qp of spec.queryParams) {
        if (qp.key) parsed.searchParams.append(qp.key, qp.value);
      }
    }

    const isHttps = parsed.protocol === "https:";
    const transport = isHttps ? httpsRequest : httpRequest;

    const { bodyBuffer, contentType } = buildBody(spec);
    const customHeaderObj: Record<string, string> = {};
    for (const h of spec.customHeaders ?? []) {
      if (h.key) customHeaderObj[h.key] = h.value;
    }
    const headers: Record<string, string> = {
      "user-agent": "monitoring-suite/0.2",
      accept: "*/*",
      connection: "close",
      ...customHeaderObj,
      ...spec.extraHeaders, // auth header wins over custom (intentional)
    };
    if (bodyBuffer) {
      headers["content-length"] = String(bodyBuffer.length);
      if (contentType && !headers["content-type"]) headers["content-type"] = contentType;
    }

    const start = Date.now();
    const marks: Record<string, number | null> = {
      lookup: null,
      connect: null,
      secureConnect: null,
      response: null,
      end: null,
    };

    // SSRF pre-flight: resolve hostname, reject private/loopback/metadata IPs,
    // then PIN that exact IP via the `lookup` override so DNS rebinding (flip
    // public→internal between resolve and connect) cannot bypass the check.
    resolveSafely(parsed.hostname).then((check) => {
      if (!check.ok) {
        resolve({
          statusCode: null,
          timings: buildTimings(start, marks),
          responseBody: "",
          responseHeaders: {},
          error: new Error(check.reason),
        });
        return;
      }
      const pinnedIp = check.address;
      const pinnedFamily = check.family;

    const req = transport(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: spec.method,
        agent: false,
        headers,
        // Pin resolved IP — prevents DNS rebinding mid-connection.
        // Node 18+ HTTP internally calls lookup with `all: true` and expects
        // the callback signature `(err, [{address, family}, ...])`. Older
        // callers (and dns.lookup default) use `(err, address, family)`. We
        // branch on `opts.all` to support both — passing only the single-IP
        // form caused "Invalid IP address: undefined" on every request.
        lookup: (_host, opts, cb) => {
          if (opts && (opts as { all?: boolean }).all) {
            (cb as unknown as (
              e: NodeJS.ErrnoException | null,
              addrs: Array<{ address: string; family: number }>
            ) => void)(null, [{ address: pinnedIp, family: pinnedFamily }]);
          } else {
            (cb as (e: NodeJS.ErrnoException | null, addr: string, family: number) => void)(
              null,
              pinnedIp,
              pinnedFamily
            );
          }
        },
        // Preserve Host header so TLS/SNI + virtual-host routing still work
        // even though we're connecting by IP.
        servername: parsed.hostname,
      },
      (res) => {
        marks.response = Date.now();
        const statusCode = res.statusCode ?? null;

        // Collect response headers (lowercase keys, joined values for arrays)
        const responseHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (v == null) continue;
          responseHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
        }

        const chunks: Buffer[] = [];
        let drained = 0;
        let truncated = false;
        res.on("data", (chunk: Buffer) => {
          drained += chunk.length;
          if (!truncated && drained <= MAX_BODY_BYTES) {
            chunks.push(chunk);
          } else if (!truncated) {
            const remaining = MAX_BODY_BYTES - (drained - chunk.length);
            if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
            truncated = true;
          }
        });
        res.on("end", () => {
          marks.end = Date.now();
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({
            statusCode,
            timings: buildTimings(start, marks),
            responseBody: body,
            responseHeaders,
            error: null,
          });
        });
        res.on("close", () => {
          if (!marks.end) marks.end = Date.now();
        });
      }
    );

    req.on("socket", (socket) => {
      socket.on("lookup", () => {
        marks.lookup = Date.now();
      });
      socket.on("connect", () => {
        marks.connect = Date.now();
      });
      socket.on("secureConnect", () => {
        marks.secureConnect = Date.now();
      });
    });

    req.on("error", (err) => {
      resolve({
        statusCode: null,
        timings: buildTimings(start, marks),
        responseBody: "",
        responseHeaders: {},
        error: err,
      });
    });

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(Object.assign(new Error("Request timed out"), { code: "ETIMEDOUT" }));
    });

    if (bodyBuffer) req.write(bodyBuffer);
    req.end();
    }); // end of resolveSafely().then(...)
  });
}

function buildBody(spec: RequestSpec): { bodyBuffer: Buffer | null; contentType: string | null } {
  if (spec.method === "GET" || spec.bodyType === "none" || !spec.body) {
    return { bodyBuffer: null, contentType: null };
  }
  switch (spec.bodyType) {
    case "json":
      return {
        bodyBuffer: Buffer.from(spec.body, "utf8"),
        contentType: "application/json",
      };
    case "urlencoded":
      return {
        bodyBuffer: Buffer.from(spec.body, "utf8"),
        contentType: "application/x-www-form-urlencoded",
      };
    case "form":
      try {
        const fields = JSON.parse(spec.body) as { key: string; value: string }[];
        const params = new URLSearchParams();
        for (const f of fields) params.append(f.key, f.value);
        return {
          bodyBuffer: Buffer.from(params.toString(), "utf8"),
          contentType: "application/x-www-form-urlencoded",
        };
      } catch {
        return { bodyBuffer: Buffer.from(spec.body, "utf8"), contentType: "text/plain" };
      }
    case "raw":
      return {
        bodyBuffer: Buffer.from(spec.body, "utf8"),
        contentType: spec.bodyContentType?.trim() || "text/plain",
      };
    case "binary":
      return buildBinaryBody(spec.body);
    default:
      return { bodyBuffer: null, contentType: null };
  }
}

/**
 * `spec.body` for binary is a JSON blob: `{ uploadId, fieldName? }`.
 * - fieldName empty/missing → raw bytes with file's stored MIME type
 * - fieldName set → multipart/form-data with that one field
 */
function buildBinaryBody(rawBody: string): {
  bodyBuffer: Buffer | null;
  contentType: string | null;
} {
  let cfg: BinaryBodyConfig;
  try {
    cfg = JSON.parse(rawBody) as BinaryBodyConfig;
  } catch {
    return { bodyBuffer: null, contentType: null };
  }
  if (!cfg.uploadId) return { bodyBuffer: null, contentType: null };

  const upload = getUpload(cfg.uploadId);
  if (!upload) return { bodyBuffer: null, contentType: null };

  let fileBytes: Buffer;
  try {
    fileBytes = readFileSync(uploadPath(upload.id));
  } catch {
    return { bodyBuffer: null, contentType: null };
  }

  const fieldName = cfg.fieldName?.trim();
  if (!fieldName) {
    return { bodyBuffer: fileBytes, contentType: upload.mimeType || "application/octet-stream" };
  }

  // multipart/form-data with a single file field
  const boundary = `----monitoringboundary${randomBytes(12).toString("hex")}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="${upload.filename.replace(/"/g, "")}"\r\n` +
      `Content-Type: ${upload.mimeType || "application/octet-stream"}\r\n\r\n`,
    "utf8"
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  return {
    bodyBuffer: Buffer.concat([head, fileBytes, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function emptyTimings(): Timings {
  return { dnsMs: null, tcpMs: null, tlsMs: null, ttfbMs: null, downloadMs: null, totalMs: null };
}

function buildTimings(start: number, marks: Record<string, number | null>): Timings {
  const dnsEnd = marks.lookup;
  const connectEnd = marks.connect;
  const tlsEnd = marks.secureConnect;
  const responseStart = marks.response;
  const responseEnd = marks.end;

  const dnsMs = dnsEnd != null ? dnsEnd - start : null;
  const tcpMs = connectEnd != null && dnsEnd != null ? connectEnd - dnsEnd : null;
  const tlsMs = tlsEnd != null && connectEnd != null ? tlsEnd - connectEnd : null;
  const handshakeEnd = tlsEnd ?? connectEnd;
  const ttfbMs =
    responseStart != null && handshakeEnd != null ? responseStart - handshakeEnd : null;
  const downloadMs =
    responseEnd != null && responseStart != null ? responseEnd - responseStart : null;
  const totalMs = (responseEnd ?? Date.now()) - start;

  return {
    dnsMs: nonNeg(dnsMs),
    tcpMs: nonNeg(tcpMs),
    tlsMs: nonNeg(tlsMs),
    ttfbMs: nonNeg(ttfbMs),
    downloadMs: nonNeg(downloadMs),
    totalMs: nonNeg(totalMs),
  };
}

function nonNeg(v: number | null): number | null {
  if (v == null) return null;
  return v < 0 ? 0 : v;
}
