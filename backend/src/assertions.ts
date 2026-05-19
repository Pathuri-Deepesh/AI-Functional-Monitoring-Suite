import type { Assertion, AssertionResult } from "./types.js";

export function evaluateAssertions(
  assertions: Assertion[],
  outcome: { statusCode: number | null; totalMs: number | null; responseBody: string }
): AssertionResult[] {
  return assertions.map((a) => evaluateOne(a, outcome));
}

function evaluateOne(
  a: Assertion,
  outcome: { statusCode: number | null; totalMs: number | null; responseBody: string }
): AssertionResult {
  switch (a.type) {
    case "status-equals": {
      const expected = Number(a.config?.value);
      const actual = outcome.statusCode;
      const passed = actual === expected;
      return {
        id: a.id,
        type: a.type,
        passed,
        detail: passed
          ? `Status is ${actual} as expected.`
          : `Expected ${expected}, got ${actual ?? "no response"}.`,
      };
    }
    case "status-in-range": {
      const min = Number(a.config?.min);
      const max = Number(a.config?.max);
      const actual = outcome.statusCode;
      const passed = actual != null && actual >= min && actual <= max;
      return {
        id: a.id,
        type: a.type,
        passed,
        detail: passed
          ? `Status ${actual} is within ${min}–${max}.`
          : `Expected status in ${min}–${max}, got ${actual ?? "no response"}.`,
      };
    }
    case "latency-under": {
      const threshold = Number(a.config?.ms);
      const actual = outcome.totalMs;
      const passed = actual != null && actual < threshold;
      return {
        id: a.id,
        type: a.type,
        passed,
        detail: passed
          ? `Latency ${actual}ms < ${threshold}ms.`
          : `Expected latency under ${threshold}ms, got ${actual ?? "n/a"}ms.`,
      };
    }
    case "body-contains": {
      const text = String(a.config?.text ?? "");
      const passed = text.length > 0 && outcome.responseBody.includes(text);
      return {
        id: a.id,
        type: a.type,
        passed,
        detail: passed
          ? `Response body contains "${text}".`
          : `Response body does not contain "${text}".`,
      };
    }
    default:
      return {
        id: a.id,
        type: a.type,
        passed: false,
        detail: `Unknown assertion type: ${(a as any).type}`,
      };
  }
}

export function summarizeAssertion(a: Assertion): string {
  switch (a.type) {
    case "status-equals":
      return `status equals ${a.config?.value ?? "?"}`;
    case "status-in-range":
      return `status in ${a.config?.min ?? "?"}–${a.config?.max ?? "?"}`;
    case "latency-under":
      return `latency under ${a.config?.ms ?? "?"}ms`;
    case "body-contains":
      return `body contains "${a.config?.text ?? ""}"`;
    default:
      return "unknown";
  }
}
