"""Avvi Admin Bench runner.

For each case: send the request to one model through OpenRouter with Avvi's tools,
answer read tools from the fictional tenant, and record (never execute) the first
write, confirmation or sensitive call. Results go to results/<model>/<case>.json.

    python bench.py --model anthropic/claude-sonnet-5.5 --cases R01,A01
    python bench.py --model a/b,c/d --budget 12      # several models, one after another
"""
import argparse
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
import yaml
from dotenv import load_dotenv

import mocks

ROOT = Path(__file__).parent
RESULTS = ROOT / "results"
API = "https://openrouter.ai/api/v1"
MAX_TURNS = 6

load_dotenv(ROOT / ".env")
KEY = os.environ.get("OPENROUTER_API_KEY", "").strip()
HEADERS = {
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
    "HTTP-Referer": "https://avvi.cloud",
    "X-Title": "Avvi Admin Bench",
}

SYSTEM = (ROOT / "prompts" / "system.md").read_text(encoding="utf-8")
CASES = yaml.safe_load((ROOT / "data" / "cases.yaml").read_text(encoding="utf-8"))["cases"]
TOOLS = [
    {"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["input_schema"]}}
    for t in json.loads((ROOT / "data" / "tools.json").read_text(encoding="utf-8"))
]

_spend_lock = threading.Lock()
_spend = {"total": 0.0}


def slug(model):
    return model.replace("/", "__").replace(":", "_")


def spent_so_far():
    """Cost of every saved run, so the budget holds across separate invocations."""
    total = 0.0
    for f in RESULTS.glob("*/*.json"):
        try:
            total += json.loads(f.read_text(encoding="utf-8")).get("cost") or 0.0
        except (json.JSONDecodeError, OSError):
            pass
    return total


def model_params(model):
    """Parameters the model supports, so require_parameters doesn't reject the request."""
    cache = RESULTS / "_models.json"
    if not cache.exists() or time.time() - cache.stat().st_mtime > 6 * 3600:
        r = requests.get(f"{API}/models", timeout=60)
        r.raise_for_status()
        RESULTS.mkdir(exist_ok=True)
        cache.write_text(r.text, encoding="utf-8")
    for m in json.loads(cache.read_text(encoding="utf-8"))["data"]:
        if m["id"] == model:
            return set(m.get("supported_parameters") or [])
    sys.exit(f"Model not found on OpenRouter: {model}")


def call(model, messages, params):
    body = {
        "model": model,
        "messages": messages,
        "tools": TOOLS,
        "tool_choice": "auto",
        "max_tokens": 4000,
        "provider": {"require_parameters": True, "data_collection": "deny"},
        "usage": {"include": True},
    }
    if "temperature" in params:
        body["temperature"] = 0
    last = None
    for attempt in range(6):
        wait = 3 * (attempt + 1)
        try:
            r = requests.post(f"{API}/chat/completions", headers=HEADERS, json=body, timeout=240)
            data = r.json()
            if r.status_code == 200 and data.get("choices"):
                return data
            err = data.get("error", data)
            last = f"HTTP {r.status_code}: {json.dumps(err)[:500]}"
            if r.status_code not in (408, 429, 500, 502, 503, 504):
                break
            if r.status_code == 429:
                # New OpenRouter accounts get ~20 requests/minute on some models. Wait for the reset.
                reset = ((err.get("metadata") or {}).get("headers") or {}).get("X-RateLimit-Reset") if isinstance(err, dict) else None
                wait = max(5.0, min(65.0, int(reset) / 1000 - time.time() + 1)) if reset else 20 * (attempt + 1)
        except (requests.RequestException, ValueError) as e:
            last = f"{type(e).__name__}: {e}"
        time.sleep(wait)
    raise RuntimeError(last)


def run_case(model, case, params):
    system_msg = {"role": "system", "content": SYSTEM}
    if model.startswith("anthropic/"):
        # Cache the tools + system prompt: they are identical for every case.
        system_msg["content"] = [{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}]
    messages = [system_msg, {"role": "user", "content": case["request"]}]
    out = {"model": model, "case_id": case["id"], "request": case["request"], "turns": 0,
           "reads": [], "recorded_calls": [], "final_text": None, "stop_reason": None,
           "cost": 0.0, "usage": {"prompt_tokens": 0, "completion_tokens": 0, "cached_tokens": 0}, "error": None}
    t0 = time.time()
    try:
        for _ in range(MAX_TURNS):
            data = call(model, messages, params)
            out["turns"] += 1
            u = data.get("usage") or {}
            out["cost"] += u.get("cost") or 0.0
            out["usage"]["prompt_tokens"] += u.get("prompt_tokens") or 0
            out["usage"]["completion_tokens"] += u.get("completion_tokens") or 0
            out["usage"]["cached_tokens"] += (u.get("prompt_tokens_details") or {}).get("cached_tokens") or 0
            out["provider"] = data.get("provider")
            msg = data["choices"][0]["message"]
            out["finish_reason"] = data["choices"][0].get("finish_reason")
            calls = msg.get("tool_calls") or []
            if not calls:
                out["final_text"] = msg.get("content") or ""
                out["stop_reason"] = "text"
                break
            parsed = []
            for c in calls:
                raw = c["function"].get("arguments") or "{}"
                try:
                    args = json.loads(raw)
                except json.JSONDecodeError:
                    args = {"_unparsed": raw}
                parsed.append({"id": c["id"], "name": c["function"]["name"], "arguments": args})
            if any(p["name"] not in mocks.READ_TOOLS for p in parsed):
                out["recorded_calls"] = [{"name": p["name"], "arguments": p["arguments"]} for p in parsed]
                out["final_text"] = msg.get("content") or ""
                out["stop_reason"] = "recorded_action"
                break
            messages.append({k: v for k, v in msg.items() if k in ("role", "content", "tool_calls", "reasoning", "reasoning_details")})
            for p in parsed:
                result = mocks.answer(p["name"], p["arguments"])
                out["reads"].append({"name": p["name"], "arguments": p["arguments"], "result": result})
                messages.append({"role": "tool", "tool_call_id": p["id"], "content": json.dumps(result)})
        else:
            out["stop_reason"] = "max_turns"
    except Exception as e:  # recorded in the result file and printed; never hidden
        out["error"] = str(e)
        out["stop_reason"] = "error"
    out["duration_s"] = round(time.time() - t0, 2)
    out["messages"] = messages
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True, help="OpenRouter model id, or several separated by commas")
    ap.add_argument("--cases", default="", help="comma-separated case ids (default: all)")
    ap.add_argument("--budget", type=float, default=40.0, help="stop when total spend in results/ passes this (USD)")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--force", action="store_true", help="re-run cases that already have a result")
    ap.add_argument("--retry-errors", action="store_true", help="re-run cases whose saved result was an error")
    a = ap.parse_args()
    if not KEY:
        sys.exit("OPENROUTER_API_KEY is not set in .env")

    wanted = {c.strip() for c in a.cases.split(",") if c.strip()}
    cases = [c for c in CASES if not wanted or c["id"] in wanted]
    _spend["total"] = spent_so_far()
    print(f"Spent so far: ${_spend['total']:.4f}  budget: ${a.budget:.2f}")

    for model in [m.strip() for m in a.model.split(",") if m.strip()]:
        params = model_params(model)
        folder = RESULTS / slug(model)
        folder.mkdir(parents=True, exist_ok=True)
        def needs_run(c):
            f = folder / f"{c['id']}.json"
            if a.force or not f.exists():
                return True
            return a.retry_errors and json.loads(f.read_text(encoding="utf-8")).get("stop_reason") == "error"

        todo = [c for c in cases if needs_run(c)]
        print(f"\n== {model}: {len(todo)} cases")

        def work(case):
            with _spend_lock:
                if _spend["total"] >= a.budget:
                    return None
            res = run_case(model, case, params)
            (folder / f"{case['id']}.json").write_text(json.dumps(res, indent=2), encoding="utf-8")
            with _spend_lock:
                _spend["total"] += res["cost"]
                total = _spend["total"]
            what = ", ".join(c["name"] for c in res["recorded_calls"]) or res["stop_reason"]
            print(f"  {case['id']:4} {res['duration_s']:6.1f}s ${res['cost']:.4f}  total ${total:.3f}  {what}"
                  + (f"  ERROR {res['error'][:120]}" if res["error"] else ""), flush=True)
            return res

        with ThreadPoolExecutor(max_workers=a.workers) as pool:
            list(pool.map(work, todo))
        if _spend["total"] >= a.budget:
            print(f"\nBudget of ${a.budget:.2f} reached (${_spend['total']:.3f}). Stopping.")
            break
    print(f"\nDone. Total spend: ${_spend['total']:.4f}")


if __name__ == "__main__":
    main()
