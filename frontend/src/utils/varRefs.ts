import type { Extraction, FlowStep, KeyValue, PrereqStep } from "../types";

const VAR_RX = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

export function findVarRefs(text: string | undefined | null): string[] {
  if (!text) return [];
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  VAR_RX.lastIndex = 0;
  while ((m = VAR_RX.exec(text)) !== null) out.add(m[1]);
  return [...out];
}

function refsInKv(items: KeyValue[]): string[] {
  const all = new Set<string>();
  for (const it of items) for (const r of findVarRefs(it.value)) all.add(r);
  return [...all];
}

/** All {{name}} references a step depends on across url + body + headers + query. */
export function stepVarRefs(step: FlowStep | PrereqStep): string[] {
  const all = new Set<string>();
  for (const r of findVarRefs(step.url)) all.add(r);
  for (const r of findVarRefs(step.body)) all.add(r);
  for (const r of refsInKv(step.customHeaders)) all.add(r);
  for (const r of refsInKv(step.queryParams)) all.add(r);
  return [...all];
}

/**
 * Var names this step's predecessors successfully extract — i.e. names that
 * will be in scope when this step executes, ignoring whether the extraction
 * actually matches at runtime.
 */
export function extractionsBefore(earlierSteps: (FlowStep | PrereqStep)[]): string[] {
  const all = new Set<string>();
  for (const s of earlierSteps) {
    for (const e of s.extractions as Extraction[]) {
      if (e.saveAs && e.saveAs.trim()) all.add(e.saveAs.trim());
    }
  }
  return [...all];
}

/**
 * Returns the list of {{var}} names the step references that are NOT available
 * at runtime — i.e. not in the project pool and not extracted by any earlier
 * step. Empty array = step is wired correctly.
 */
export function checkStepVarRefs(
  step: FlowStep | PrereqStep,
  earlierSteps: (FlowStep | PrereqStep)[],
  projectVarNames: string[]
): string[] {
  const refs = stepVarRefs(step);
  if (refs.length === 0) return [];
  const known = new Set<string>([...projectVarNames, ...extractionsBefore(earlierSteps)]);
  return refs.filter((r) => !known.has(r));
}
