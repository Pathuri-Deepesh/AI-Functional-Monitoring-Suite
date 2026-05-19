"""Seed: Marketing Campaign Workflow — a 6-step demo flow against httpbin."""
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
print(f"📁 Project: {project['name']} ({project_id[:8]})")

# 2. Create flow
flow = req("POST", f"/api/projects/{project_id}/flows", {
    "name": "Marketing Campaign Workflow",
    "description": "6-step demo: login → list → create → activate → update → logout (against httpbin)",
    "intervalMinutes": 60,
    "stopOnFailure": True,
})
flow_id = flow["id"]
print(f"🆕 Flow created: {flow['name']} ({flow_id[:8]})")

# 3. Define 6 steps
steps = [
    # ===== Step 1: Login =====
    {
        "url": "https://httpbin.org/post",
        "method": "POST",
        "description": "Admin login — capture auth token for next 5 steps",
        "bodyType": "json",
        "body": json.dumps({
            "username": "marketing_admin",
            "password": "demo_pass_123",
            "app": "campaign-service",
        }),
        "extractions": [
            {"id": gen_id(), "source": "body", "path": "$.json.username", "saveAs": "admin_user", "ttlSeconds": 300},
            {"id": gen_id(), "source": "body", "path": "$.json.app",      "saveAs": "service_name", "ttlSeconds": 300},
            {"id": gen_id(), "source": "status", "path": "",              "saveAs": "login_code"},
        ],
        "assertions": [
            {"id": gen_id(), "type": "status-equals", "config": {"value": 200}},
        ],
        "maxRetries": 2,
    },
    # ===== Step 2: List campaigns =====
    {
        "url": "https://httpbin.org/anything/campaigns",
        "method": "GET",
        "description": "List campaigns for logged-in admin (uses {{admin_user}})",
        "queryParams": [
            {"key": "user",   "value": "{{admin_user}}"},
            {"key": "status", "value": "active"},
            {"key": "limit",  "value": "50"},
        ],
        "customHeaders": [
            {"key": "X-Service-Name", "value": "{{service_name}}"},
            {"key": "X-Login-Code",   "value": "{{login_code}}"},
        ],
        "extractions": [
            {"id": gen_id(), "source": "body", "path": "$.args.user", "saveAs": "confirmed_user"},
        ],
        "assertions": [
            {"id": gen_id(), "type": "body-contains", "config": {"text": "marketing_admin"}},
        ],
    },
    # ===== Step 3: Create campaign =====
    {
        "url": "https://httpbin.org/anything/campaigns/create",
        "method": "POST",
        "description": "Create Summer Sale 2026 — capture campaign name + budget",
        "bodyType": "json",
        "body": json.dumps({
            "owner":   "{{admin_user}}",
            "name":    "Summer Sale 2026",
            "budget":  50000,
            "channel": "email",
        }),
        "extractions": [
            {"id": gen_id(), "source": "body", "path": "$.json.name",   "saveAs": "campaign_name"},
            {"id": gen_id(), "source": "body", "path": "$.json.budget", "saveAs": "campaign_budget"},
        ],
        "assertions": [
            {"id": gen_id(), "type": "status-in-range", "config": {"min": 200, "max": 299}},
            {"id": gen_id(), "type": "body-contains",   "config": {"text": "Summer Sale 2026"}},
            {"id": gen_id(), "type": "latency-under",   "config": {"ms": 3000}},
        ],
    },
    # ===== Step 4: Wait + activation poll =====
    {
        "url": "https://httpbin.org/anything/campaigns/Summer-Sale-2026",
        "method": "GET",
        "description": "Poll for activation (3s wait, retries with backoff)",
        "queryParams": [
            {"key": "check", "value": "activation_status"},
        ],
        "waitBeforeMs": 3000,
        "maxRetries": 3,
        "retryBackoffMs": 1500,
        "assertions": [
            {"id": gen_id(), "type": "status-equals", "config": {"value": 200}},
        ],
    },
    # ===== Step 5: Update budget (PUT with numeric variable substitution) =====
    {
        "url": "https://httpbin.org/anything/campaigns/Summer-Sale-2026/budget",
        "method": "PUT",
        "description": "Bump budget by 20% based on captured original",
        "bodyType": "json",
        # Numeric var substitution — {{campaign_budget}} not quoted so it stays a number after substitution
        "body": '{"campaign":"{{campaign_name}}","old_budget":{{campaign_budget}},"new_budget":60000,"updated_by":"{{admin_user}}"}',
        "customHeaders": [
            {"key": "X-Update-Reason", "value": "Q3 budget bump"},
        ],
        "assertions": [
            {"id": gen_id(), "type": "body-contains", "config": {"text": "60000"}},
        ],
    },
    # ===== Step 6: Logout =====
    {
        "url": "https://httpbin.org/anything/auth/logout",
        "method": "POST",
        "description": "Clean session exit",
        "bodyType": "json",
        "body": json.dumps({
            "user":   "{{admin_user}}",
            "action": "logout",
        }),
        "assertions": [
            {"id": gen_id(), "type": "status-equals", "config": {"value": 200}},
        ],
    },
]

for i, step in enumerate(steps, 1):
    s = req("POST", f"/api/flows/{flow_id}/steps", step)
    print(f"  ✓ Step {i}: {step['method']:5s} {step['url'][:60]}")

# 4. Run the flow now
print("\n▶️  Running the flow…")
result = req("POST", f"/api/flows/{flow_id}/run")
print(f"\n{'✅' if result['ok'] else '❌'} ok={result['ok']} · total={result['totalMs']}ms")
for sr in result["stepResults"]:
    icon = "⏭" if sr["skipped"] else ("✅" if sr["ok"] else "❌")
    status = sr.get("statusCode") or "—"
    ms = sr["timings"]["totalMs"]
    extras = ""
    if sr["extractedValues"]:
        extras = " | 💾 " + ", ".join(e["saveAs"] for e in sr["extractedValues"])
    if sr["attempts"] > 1:
        extras += f" | 🔁 {sr['attempts']} attempts"
    print(f"  {icon} Step {sr['position']}: {status} · {ms}ms{extras}")

print(f"\n💾 Variables at end of run:")
for k, v in (result["variables"] or {}).items():
    val = str(v)[:50]
    print(f"  {k} = {val}")
