"""Seed: Retry & Failure Cascade Demo — intentionally exercises retry behavior + skip cascade."""
import urllib.request
import json
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


# 1. Pick the first project
projects = req("GET", "/api/projects")
project = projects[0]
project_id = project["id"]
print(f"Project: {project['name']} ({project_id[:8]})")

# 2. Create flow
flow = req("POST", f"/api/projects/{project_id}/flows", {
    "name": "Retry & Failure Cascade Demo",
    "description": "Step 1 succeeds. Step 2 mixes random success/fail with retries. Step 3 always fails and exhausts retries. Steps 4-5 skipped due to stop-on-failure.",
    "intervalMinutes": 60,
    "stopOnFailure": True,
})
flow_id = flow["id"]
print(f"Flow created: {flow['name']} ({flow_id[:8]})\n")

steps = [
    # ===== Step 1: Baseline success =====
    {
        "url": "https://httpbin.org/status/200",
        "method": "GET",
        "description": "Baseline — always succeeds on first try (no retries needed)",
        "assertions": [
            {"id": gen_id(), "type": "status-equals", "config": {"value": 200}},
        ],
        "maxRetries": 0,
    },
    # ===== Step 2: Random success/fail — shows retries that may eventually succeed =====
    {
        "url": "https://httpbin.org/status/200,503,503",
        "method": "GET",
        "description": "Returns 200 OR 503 randomly. Retries kick in if a 503 is returned.",
        "assertions": [
            {"id": gen_id(), "type": "status-equals", "config": {"value": 200}},
        ],
        "maxRetries": 3,
        "retryBackoffMs": 500,
    },
    # ===== Step 3: ALWAYS FAILS — the star of the show =====
    {
        "url": "https://httpbin.org/status/503",
        "method": "GET",
        "description": "Always returns 503. Will exhaust all retries then mark FAILED.",
        "assertions": [
            {"id": gen_id(), "type": "status-equals", "config": {"value": 200}},
        ],
        "maxRetries": 3,
        "retryBackoffMs": 500,
    },
    # ===== Step 4: Would succeed but gets SKIPPED =====
    {
        "url": "https://httpbin.org/status/200",
        "method": "GET",
        "description": "Healthy endpoint — but never runs (stop-on-failure cascade)",
        "assertions": [
            {"id": gen_id(), "type": "status-equals", "config": {"value": 200}},
        ],
    },
    # ===== Step 5: Same as 4 =====
    {
        "url": "https://httpbin.org/post",
        "method": "POST",
        "description": "Final cleanup — also skipped",
        "bodyType": "json",
        "body": json.dumps({"action": "done"}),
        "assertions": [
            {"id": gen_id(), "type": "status-equals", "config": {"value": 200}},
        ],
    },
]

for i, step in enumerate(steps, 1):
    s = req("POST", f"/api/flows/{flow_id}/steps", step)
    print(f"  Step {i}: {step['method']:5s} {step['url']}")

# Run it
print("\nRunning the flow (this will take a few seconds due to retries)...\n")
import time
start = time.time()
result = req("POST", f"/api/flows/{flow_id}/run")
elapsed_ms = int((time.time() - start) * 1000)

print(f"Result: ok={result['ok']}  |  total={result['totalMs']}ms  (wall clock: {elapsed_ms}ms)\n")
for sr in result["stepResults"]:
    if sr["skipped"]:
        icon = "[SKIP]"
        info = sr.get("skipReason", "")
    elif sr["ok"]:
        icon = "[ OK ]"
        info = f"{sr['statusCode']} - {sr['timings']['totalMs']}ms"
    else:
        icon = "[FAIL]"
        info = f"{sr['statusCode'] or 'no response'} - {sr['timings']['totalMs']}ms - {sr.get('errorReason', '')}"
    attempts = ""
    if sr["attempts"] > 1:
        attempts = f"  [{sr['attempts']} attempts]"
    print(f"  {icon} Step {sr['position']}: {info}{attempts}")
