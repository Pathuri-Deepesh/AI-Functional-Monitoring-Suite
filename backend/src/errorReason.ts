const STATUS_REASONS: Record<number, string> = {
  400: "Bad request — the server rejected the request format.",
  401: "Unauthorized — missing or invalid API key.",
  403: "Forbidden — the API key is valid but lacks permission.",
  404: "Not found — the endpoint does not exist at this URL.",
  405: "Method not allowed — the endpoint exists but does not accept GET.",
  408: "Request timeout — the server gave up waiting for the request.",
  409: "Conflict — the request conflicts with the current resource state.",
  410: "Gone — the resource has been permanently removed.",
  413: "Payload too large.",
  418: "I'm a teapot (server is signalling it cannot brew coffee).",
  422: "Unprocessable entity — request was well-formed but semantically invalid.",
  429: "Rate limited — too many requests; back off and retry.",
  500: "Internal server error — the server crashed handling this request.",
  501: "Not implemented — the server does not support this endpoint.",
  502: "Bad gateway — an upstream service returned an invalid response.",
  503: "Service unavailable — the server is overloaded or down for maintenance.",
  504: "Gateway timeout — an upstream service did not respond in time.",
  511: "Network authentication required (e.g., captive portal).",
};

export function reasonForStatus(code: number): string {
  if (STATUS_REASONS[code]) return STATUS_REASONS[code];
  if (code >= 200 && code < 300) return `Success (${code}).`;
  if (code >= 300 && code < 400) return `Redirect (${code}) — server is pointing to another URL.`;
  if (code >= 400 && code < 500) return `Client error (${code}) — the request was rejected.`;
  if (code >= 500 && code < 600) return `Server error (${code}) — the server failed to fulfill the request.`;
  return `Unexpected status (${code}).`;
}

export function reasonForError(err: unknown): string {
  if (!err) return "Unknown error.";
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as any)?.code ?? (err as any)?.cause?.code ?? "";

  switch (code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "DNS lookup failed — the hostname could not be resolved.";
    case "ECONNREFUSED":
      return "Connection refused — nothing is listening on that port.";
    case "ECONNRESET":
      return "Connection reset by peer — the server closed the connection unexpectedly.";
    case "ETIMEDOUT":
      return "Connection timed out — the server did not respond in time.";
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return "Network unreachable — cannot route to the host.";
    case "EPROTO":
      return "Protocol error — TLS or HTTP handshake failed.";
    case "CERT_HAS_EXPIRED":
      return "TLS certificate has expired.";
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
      return "TLS certificate is self-signed and not trusted.";
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
      return "TLS certificate could not be verified against a trusted CA.";
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return "TLS certificate hostname does not match the URL.";
    case "ABORT_ERR":
    case "ERR_ABORTED":
      return "Request aborted — likely exceeded the per-check timeout.";
  }

  if (/aborted/i.test(msg)) {
    return "Request aborted — likely exceeded the per-check timeout.";
  }
  if (/fetch failed/i.test(msg)) {
    return `Fetch failed — ${msg}.`;
  }
  return msg;
}
