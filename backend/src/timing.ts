import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import type { BodyType, HttpMethod, KeyValue, Timings } from "./types.js";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_BODY_BYTES = 256 * 1024; // capture up to 256KB of response body for assertions

export interface TimedResult {
  statusCode: number | null;
  timings: Timings;
  responseBody: string; // up to MAX_BODY_BYTES
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
      resolve({ statusCode: null, timings: emptyTimings(), responseBody: "", error: new Error("Invalid URL") });
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

    const req = transport(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: spec.method,
        agent: false,
        headers,
      },
      (res) => {
        marks.response = Date.now();
        const statusCode = res.statusCode ?? null;

        const chunks: Buffer[] = [];
        let drained = 0;
        let truncated = false;
        res.on("data", (chunk: Buffer) => {
          drained += chunk.length;
          if (!truncated && drained <= MAX_BODY_BYTES) {
            chunks.push(chunk);
          } else if (!truncated) {
            // Capture only up to the cap, then drop further data
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
        error: err,
      });
    });

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(Object.assign(new Error("Request timed out"), { code: "ETIMEDOUT" }));
    });

    if (bodyBuffer) req.write(bodyBuffer);
    req.end();
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
    default:
      return { bodyBuffer: null, contentType: null };
  }
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
