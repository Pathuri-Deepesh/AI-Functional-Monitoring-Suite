import type { Extraction, FlowStep, KeyValue, PrereqStep } from "../types";

// Matches {{name}} or {{name.dotted.path}} — captures the ROOT identifier
// (everything before the first dot). Mirrors the backend's tolerant lookup so
// `{{student.id}}` is recognized as a reference to `student`.
const VAR_RX = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*\}\}/g;

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
 *
 * Phase 1.19: walks the chain of earlier for-each steps in `earlierSteps` and
 * adds each loop's `itemVarName` to the known set when it is in the current
 * step's nesting scope — i.e. its array source roots through an outer loop's
 * item that's already in scope. This lets a depth-3 step reference
 * `{{student.id}}`, `{{subject.id}}`, AND `{{mark.id}}` without warnings.
 */
export function checkStepVarRefs(
  step: FlowStep | PrereqStep,
  earlierSteps: (FlowStep | PrereqStep)[],
  projectVarNames: string[]
): string[] {
  const refs = stepVarRefs(step);
  if (refs.length === 0) return [];
  const known = new Set<string>([...projectVarNames, ...extractionsBefore(earlierSteps)]);

  // Walk earlier steps in order and maintain a stack of itemVarNames currently
  // in scope. A for-each step joins the stack iff its array root matches an
  // already-stacked itemVarName; otherwise it starts a new stack. A
  // non-iterating step clears the stack (lexical scope ends).
  let scopeStack: string[] = [];
  for (const s of earlierSteps) {
    const fe = "forEach" in s ? s.forEach : null;
    if (!fe) {
      scopeStack = [];
      continue;
    }
    const root = fe.arrayVarName.split(".")[0];
    const matchIdx = scopeStack.indexOf(root);
    if (matchIdx >= 0) {
      scopeStack = scopeStack.slice(0, matchIdx + 1);
      scopeStack.push(fe.itemVarName);
    } else {
      scopeStack = [fe.itemVarName];
    }
  }
  for (const v of scopeStack) if (v && v.trim()) known.add(v.trim());

  // This step's own loop-local item is also in scope while it executes.
  if ("forEach" in step && step.forEach && step.forEach.itemVarName.trim()) {
    known.add(step.forEach.itemVarName.trim());
  }
  return refs.filter((r) => !known.has(r));
}
