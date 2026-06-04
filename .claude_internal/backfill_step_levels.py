"""Phase 1.23 backfill: assign each existing flow step an explicit `level` (1..4).

Pass 1 (always runs) — for every flow, walks its steps in position order and
infers each step's level by mirroring the runner's old absorption rule:
  * non-for-each steps              → level 1
  * top-level for-each              → level 1
  * for-each whose array source's root identifier matches an outer loop's
    itemVarName → level (outer + 1), up to 4

After Pass 1, every flow renders + executes EXACTLY as it did before — we just
made the implicit depth explicit. Existing rows defaulted to level=1 by the DB
migration; this script overwrites them with the inferred value.

Pass 2 (printed but NOT applied) — scans for "duplicate LOOP" anti-patterns
(two consecutive LOOP steps over the SAME array source, with HTTP children of
the second). Prints a suggested fix the user can apply manually via the UI by
setting the second loop's children to L2 under the first loop and deleting the
duplicate. Logitech's /home flow is the motivating example.
"""
import urllib.request
import urllib.error
import json
import sys

BASE = "http://127.0.0.1:4000"


def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    if data is not None:
        r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        body_text = ""
        try:
            body_text = e.read().decode()
        except Exception:
            pass
        print(f"  ! HTTP {e.code} on {method} {path}: {body_text}", file=sys.stderr)
        raise


def infer_levels(steps):
    """Return list of (step, inferred_level) in position order."""
    ordered = sorted(steps, key=lambda s: s["position"])
    scope_stack = []  # list of itemVarNames currently in scope
    out = []
    for s in ordered:
        fe = s.get("forEach")
        if not fe:
            scope_stack = []
            out.append((s, 1))
            continue
        root = (fe.get("arrayVarName") or "").split(".")[0]
        if root in scope_stack:
            idx = scope_stack.index(root)
            scope_stack = scope_stack[: idx + 1]
            level = min(idx + 2, 4)
        else:
            scope_stack = []
            level = 1
        scope_stack.append(fe.get("itemVarName") or "")
        out.append((s, level))
    return out


def detect_duplicate_loops(steps):
    """Find pairs of consecutive LOOP-type for-each steps over the same array.
    Returns list of (first_loop, second_loop, http_children_of_second)."""
    ordered = sorted(steps, key=lambda s: s["position"])
    loops = [s for s in ordered if s.get("forEach") and s.get("stepType") == "loop"]
    hits = []
    for i, a in enumerate(loops):
        for b in loops[i + 1 :]:
            if a["forEach"]["arrayVarName"] == b["forEach"]["arrayVarName"]:
                # Collect HTTP steps that depend on b's itemVarName
                b_item = b["forEach"]["itemVarName"]
                children = [
                    s
                    for s in ordered
                    if s["position"] > b["position"]
                    and s.get("forEach")
                    and s["forEach"]["arrayVarName"].split(".")[0] == b_item
                ]
                hits.append((a, b, children))
                break
    return hits


def list_all_flows():
    """Walk projects → flows. /api/flows does not exist as a top-level route."""
    projects = req("GET", "/api/projects") or []
    out = []
    for p in projects:
        flows = req("GET", f"/api/projects/{p['id']}/flows") or []
        for f in flows:
            out.append(f)
    return out


def main():
    flows = list_all_flows()
    if not flows:
        print("No flows found - backend running on", BASE, "?")
        return

    print(f"=== Pass 1: infer + persist levels for {len(flows)} flows ===\n")
    total_patched = 0
    total_skipped = 0
    for flow_summary in flows:
        flow = req("GET", f"/api/flows/{flow_summary['id']}")
        steps = flow.get("steps") or []
        if not steps:
            continue
        leveled = infer_levels(steps)
        print(f"[FLOW] {flow['name']} ({flow['id'][:8]}) - {len(steps)} steps")
        for s, lvl in leveled:
            current = s.get("level") or 1
            if current == lvl:
                print(f"   pos {s['position']:2d}  L{lvl}  ok already correct")
                total_skipped += 1
                continue
            try:
                req("PATCH", f"/api/steps/{s['id']}", {"level": lvl})
                print(f"   pos {s['position']:2d}  L{current} -> L{lvl}  PATCHED")
                total_patched += 1
            except urllib.error.HTTPError:
                print(f"   pos {s['position']:2d}  L{current} -> L{lvl}  FAILED")
        print()

    print(f"Pass 1 done: {total_patched} patched, {total_skipped} already correct.\n")

    print("=== Pass 2: scan for duplicate-LOOP anti-patterns (REPORT ONLY) ===\n")
    found_any = False
    for flow_summary in flows:
        flow = req("GET", f"/api/flows/{flow_summary['id']}")
        hits = detect_duplicate_loops(flow.get("steps") or [])
        if not hits:
            continue
        found_any = True
        print(f"[WARN] {flow['name']} ({flow['id'][:8]}) has duplicate LOOPs:")
        for a, b, children in hits:
            print(
                f"   LOOP pos {a['position']} over '{a['forEach']['arrayVarName']}' as '{a['forEach']['itemVarName']}'"
            )
            print(
                f"   LOOP pos {b['position']} over '{b['forEach']['arrayVarName']}' as '{b['forEach']['itemVarName']}'  <- duplicate"
            )
            print(f"   Children of second loop ({len(children)}):")
            for c in children:
                print(f"     - pos {c['position']}  {c.get('method', '')} {c.get('url', '')[:60]}")
            print(f"   Suggested manual fix in the UI:")
            print(
                f"     1. Edit each child step above and rewrite forEach array source"
                f" from '{b['forEach']['itemVarName']}.{{field}}' to '{a['forEach']['itemVarName']}.{{field}}'."
            )
            print(f"     2. Set each child's Nesting level to L2 (child of LOOP {a['position']}).")
            print(f"     3. Delete the duplicate LOOP step at pos {b['position']}.")
            print()
    if not found_any:
        print("  none found.")


if __name__ == "__main__":
    main()
