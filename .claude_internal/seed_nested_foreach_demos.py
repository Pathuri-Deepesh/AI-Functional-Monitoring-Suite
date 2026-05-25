"""Seed: three Phase-1.19 nested-foreach demo flows (depth 2 / 3 / 4).

Strategy: step 1 POSTs a JSON tree to httpbin.org/anything, which echoes the
exact body back under `.json`. We then extract `$.json.students[*]` so each
student carries its full nested subjects -> marks -> reports tree as embedded
arrays. Inner for-each steps resolve `student.subjects`, `subject.marks`,
`mark.reports` via the runner's dotted-path lookup against the outer loop
items, with no extra extractions needed.

Each inner step makes a real GET against `httpbin.org/anything/...` per
iteration, so the iteration tree in the UI shows live ok/fail/latency.
"""
import json
import urllib.request
import urllib.error
import uuid

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
        print(f"  HTTP {e.code}: {e.read().decode()}")
        raise


def gen_id():
    return str(uuid.uuid4())


# ---------------------------------------------------------------- canned trees
# Depth-2 tree: 4 students -> 3 subjects each. (12 inner iterations.)
DEPTH2_TREE = {
    "students": [
        {
            "id": f"std-{s}",
            "name": name,
            "subjects": [
                {"id": f"sub-{s}-math",    "name": "Mathematics"},
                {"id": f"sub-{s}-science", "name": "Science"},
                {"id": f"sub-{s}-english", "name": "English"},
            ],
        }
        for s, name in enumerate(["Alice", "Bob", "Carla", "Dev"], start=1)
    ]
}

# Depth-3 tree: 3 students -> 3 subjects -> 2 marks each. (18 leaf iterations.)
DEPTH3_TREE = {
    "students": [
        {
            "id": f"std-{s}",
            "name": name,
            "subjects": [
                {
                    "id":   f"sub-{s}-{sub_slug}",
                    "name": sub_name,
                    "marks": [
                        {"id": f"mark-{s}-{sub_slug}-mid",   "type": "midterm"},
                        {"id": f"mark-{s}-{sub_slug}-final", "type": "final"},
                    ],
                }
                for sub_slug, sub_name in [
                    ("math", "Mathematics"),
                    ("sci",  "Science"),
                    ("eng",  "English"),
                ]
            ],
        }
        for s, name in enumerate(["Alice", "Bob", "Carla"], start=1)
    ]
}

# Depth-4 tree: 2 students -> 2 subjects -> 2 marks -> 2 reports each.
# (16 leaf iterations; total HTTP = 1 + 2 + 4 + 8 + 16 = 31.)
DEPTH4_TREE = {
    "students": [
        {
            "id": f"std-{s}",
            "name": name,
            "subjects": [
                {
                    "id":   f"sub-{s}-{sub}",
                    "name": sub.upper(),
                    "marks": [
                        {
                            "id":   f"mark-{s}-{sub}-{mtype}",
                            "type": mtype,
                            "reports": [
                                {"id": f"rep-{s}-{sub}-{mtype}-summary", "title": "summary"},
                                {"id": f"rep-{s}-{sub}-{mtype}-detail",  "title": "detail"},
                            ],
                        }
                        for mtype in ("mid", "final")
                    ],
                }
                for sub in ("math", "sci")
            ],
        }
        for s, name in enumerate(["Alice", "Bob"], start=1)
    ]
}


def build_flow_payload(name, description, interval):
    return {
        "name":            name,
        "description":     description,
        "intervalMinutes": interval,
        "stopOnFailure":   False,  # nested for-each shouldn't halt on first iter failure
    }


def step(url, *, method="GET", body=None, body_type=None, extractions=None,
         assertions=None, for_each=None, description=""):
    s = {
        "url":           url,
        "method":        method,
        "description":   description,
        "extractions":   extractions or [],
        "assertions":    assertions  or [],
    }
    if body is not None:
        s["body"] = body
        s["bodyType"] = body_type or "json"
    if for_each is not None:
        s["forEach"] = for_each
    return s


def extract(path, save_as, source="body"):
    return {"id": gen_id(), "source": source, "path": path, "saveAs": save_as}


def status_ok():
    return {"id": gen_id(), "type": "status-equals", "config": {"value": 200}}


def for_each(array_var, item_var):
    return {"arrayVarName": array_var, "itemVarName": item_var}


# ---------------------------------------------------------------- main
projects = req("GET", "/api/projects")
project = projects[0]
project_id = project["id"]
print(f"Project: {project['name']} ({project_id[:8]})\n")

flows = []

# ============================================================ Flow A: depth-2
flow_a = req("POST", f"/api/projects/{project_id}/flows", build_flow_payload(
    "Nested for-each demo - depth 2 (students -> subjects)",
    "POST a nested students/subjects tree to httpbin, then iterate 4x3 = 12 leaves.",
    60,
))
flows.append(flow_a)
print(f"[depth-2] Flow created: {flow_a['name']}  ({flow_a['id'][:8]})")

steps_a = [
    step(
        "https://httpbin.org/anything",
        method="POST",
        body=json.dumps(DEPTH2_TREE),
        body_type="json",
        description="Seed: POST nested tree; httpbin echoes it back under .json",
        extractions=[extract("$.json.students[*]", "students")],
        assertions=[status_ok()],
    ),
    step(
        "https://httpbin.org/anything/student/{{student.id}}",
        description="Outer loop: 1 GET per student",
        for_each=for_each("students", "student"),
        assertions=[status_ok()],
    ),
    step(
        "https://httpbin.org/anything/student/{{student.id}}/subject/{{subject.id}}",
        description="Inner loop: 1 GET per subject (nested under student)",
        for_each=for_each("student.subjects", "subject"),
        assertions=[status_ok()],
    ),
]
for i, s in enumerate(steps_a, 1):
    req("POST", f"/api/flows/{flow_a['id']}/steps", s)
    pill = f"[for-each {s['forEach']['arrayVarName']}/{s['forEach']['itemVarName']}]" if "forEach" in s else ""
    print(f"  + step {i}: {s['method']:5s} {s['url'][:65]} {pill}")
print()

# ============================================================ Flow B: depth-3
flow_b = req("POST", f"/api/projects/{project_id}/flows", build_flow_payload(
    "Nested for-each demo - depth 3 (students -> subjects -> marks)",
    "3x3x2 = 18 leaf iterations across three nested loops.",
    60,
))
flows.append(flow_b)
print(f"[depth-3] Flow created: {flow_b['name']}  ({flow_b['id'][:8]})")

steps_b = [
    step(
        "https://httpbin.org/anything",
        method="POST",
        body=json.dumps(DEPTH3_TREE),
        body_type="json",
        description="Seed: POST nested students/subjects/marks tree",
        extractions=[extract("$.json.students[*]", "students")],
        assertions=[status_ok()],
    ),
    step(
        "https://httpbin.org/anything/student/{{student.id}}",
        description="Level 1: per student",
        for_each=for_each("students", "student"),
        assertions=[status_ok()],
    ),
    step(
        "https://httpbin.org/anything/student/{{student.id}}/subject/{{subject.id}}",
        description="Level 2: per subject (nested under student)",
        for_each=for_each("student.subjects", "subject"),
        assertions=[status_ok()],
    ),
    step(
        "https://httpbin.org/anything/student/{{student.id}}/subject/{{subject.id}}/mark/{{mark.id}}",
        description="Level 3: per mark (nested under subject)",
        for_each=for_each("subject.marks", "mark"),
        assertions=[status_ok()],
    ),
]
for i, s in enumerate(steps_b, 1):
    req("POST", f"/api/flows/{flow_b['id']}/steps", s)
    pill = f"[for-each {s['forEach']['arrayVarName']}/{s['forEach']['itemVarName']}]" if "forEach" in s else ""
    print(f"  + step {i}: {s['method']:5s} {s['url'][:65]} {pill}")
print()

# ============================================================ Flow C: depth-4
flow_c = req("POST", f"/api/projects/{project_id}/flows", build_flow_payload(
    "Nested for-each demo - depth 4 (students -> subjects -> marks -> reports)",
    "2x2x2x2 = 16 leaf iterations. Maxes out the depth cap.",
    60,
))
flows.append(flow_c)
print(f"[depth-4] Flow created: {flow_c['name']}  ({flow_c['id'][:8]})")

steps_c = [
    step(
        "https://httpbin.org/anything",
        method="POST",
        body=json.dumps(DEPTH4_TREE),
        body_type="json",
        description="Seed: POST 4-level nested tree",
        extractions=[extract("$.json.students[*]", "students")],
        assertions=[status_ok()],
    ),
    step(
        "https://httpbin.org/anything/student/{{student.id}}",
        description="Level 1: per student",
        for_each=for_each("students", "student"),
        assertions=[status_ok()],
    ),
    step(
        "https://httpbin.org/anything/student/{{student.id}}/subject/{{subject.id}}",
        description="Level 2: per subject",
        for_each=for_each("student.subjects", "subject"),
        assertions=[status_ok()],
    ),
    step(
        "https://httpbin.org/anything/student/{{student.id}}/subject/{{subject.id}}/mark/{{mark.id}}",
        description="Level 3: per mark",
        for_each=for_each("subject.marks", "mark"),
        assertions=[status_ok()],
    ),
    step(
        "https://httpbin.org/anything/student/{{student.id}}/subject/{{subject.id}}/mark/{{mark.id}}/report/{{report.id}}",
        description="Level 4: per report (deepest)",
        for_each=for_each("mark.reports", "report"),
        assertions=[status_ok()],
    ),
]
for i, s in enumerate(steps_c, 1):
    req("POST", f"/api/flows/{flow_c['id']}/steps", s)
    pill = f"[for-each {s['forEach']['arrayVarName']}/{s['forEach']['itemVarName']}]" if "forEach" in s else ""
    print(f"  + step {i}: {s['method']:5s} {s['url'][:65]} {pill}")
print()

# ============================================================ summary
print("=" * 78)
print("Done. Three nested-foreach demo flows seeded on the first project.")
print()
print("Open the UI, switch to the Flows tab, and click 'Run now' on each:")
for f in flows:
    print(f"  - {f['name']}")
print()
print("Expected leaf iterations: depth-2 = 12 | depth-3 = 18 | depth-4 = 16")
