"""Avvi Admin Bench runner. See README.md "How a run works".

python bench.py --model <openrouter model id> [--cases R01,R02,A01]
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import requests
import yaml
from dotenv import load_dotenv

import mocks

ROOT = Path(__file__).parent
RESULTS = ROOT / "results"
API_URL = "https://openrouter.ai/api/v1/chat/completions"
MAX_TURNS = 6
COST_LIMIT = 40.0
STOP_TOOLS = {"request_confirmation", "request_multi_confirmation", "ask_permission_type"}

load_dotenv(ROOT / ".env")

SYSTEM_PROMPT = (ROOT / "prompts" / "system.md").read_text()
CASES = yaml.safe_load((ROOT / "data" / "cases.yaml").read_text())["cases"]
TOOLS = [
    {"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["input_schema"]}}
    for t in json.loads((ROOT / "data" / "tools.json").read_text())
]


class BenchError(Exception):
    pass


# Kept out of the sweep, the scoreboard and live runs. OpenRouter's stealth/ models are anonymous and free
# for a limited time before they're withdrawn, so their scores can't be rerun or compared later.
EXCLUDED_PREFIXES = ("stealth/",)


def excluded(model):
    return str(model or "").startswith(EXCLUDED_PREFIXES)


# The bench compares lower-cost models: anything priced above Claude Sonnet 5.5 ($ per 1M prompt, completion
# tokens) is left out of the sweep, the scoreboard and live runs, so premium models like Opus and Fable never run.
MAX_PRICE_PER_M = (2.0, 10.0)


def too_expensive(prompt_per_m, completion_per_m):
    return (prompt_per_m or 0) > MAX_PRICE_PER_M[0] or (completion_per_m or 0) > MAX_PRICE_PER_M[1]


def headers():
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise BenchError("OPENROUTER_API_KEY is not set in .env")
    return {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "X-Title": "Avvi Admin Bench",
        "HTTP-Referer": "https://avvi.cloud",
    }


def model_dir(model):
    return RESULTS / re.sub(r"[^A-Za-z0-9._-]", "__", model)


def total_cost_so_far():
    total = 0.0
    for f in RESULTS.glob("*/*.json"):
        if f.name.startswith("_"):  # per-model score summaries repeat the case costs
            continue
        try:
            total += json.loads(f.read_text()).get("cost") or 0
        except (json.JSONDecodeError, OSError):
            pass
    return total


def is_unroutable(err):
    """OpenRouter found no provider that meets require_parameters + data_collection=deny."""
    return "no endpoints found" in str(err).lower()


def should_skip_model(err):
    return bool(err) and ("data_collection" in err.lower() or is_unroutable(err))


def chat(model, messages, use_temperature=True):
    body = {
        "model": model,
        "messages": messages,
        "tools": TOOLS,
        "provider": {"require_parameters": True, "data_collection": "deny"},
        "usage": {"include": True},
    }
    if use_temperature:
        body["temperature"] = 0
    for attempt in range(8):
        r = requests.post(API_URL, headers=headers(), json=body, timeout=180)
        if r.status_code != 429:
            break
        # Rate limited (new accounts get ~20 requests/minute per model): wait and retry.
        time.sleep(min(float(r.headers.get("Retry-After") or 0) or 10 * (attempt + 1), 60))
    try:
        data = r.json()
    except ValueError:
        raise BenchError(f"HTTP {r.status_code}: non-JSON response")
    if r.status_code != 200 or "error" in data:
        err = data.get("error", {})
        msg = err.get("message", str(err)) if isinstance(err, dict) else str(err)
        raise BenchError(f"HTTP {r.status_code}: {msg}")
    return data


def run_case(model, case, on_event=None, out_file=None):
    """Run one case against one model. Returns the result dict (also saved to disk).
    out_file overrides where it is saved (live runs from the web app keep their own history)."""
    emit = on_event or (lambda *_: None)
    messages = [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": case["request"]}]
    result = {
        "model": model, "case_id": case["id"], "request": case["request"],
        "reads": [], "recorded_calls": [], "final_text": None, "stop_reason": None,
        "usage": {"prompt_tokens": 0, "completion_tokens": 0}, "cost": 0.0,
        "turns": 0, "temperature_zero": True, "error": None,
    }
    start = time.time()
    emit("start", {"case_id": case["id"], "request": case["request"]})
    try:
        for turn in range(1, MAX_TURNS + 1):
            result["turns"] = turn
            try:
                data = chat(model, messages, result["temperature_zero"])
            except BenchError as e:
                # A model that doesn't support temperature gets no endpoint under require_parameters.
                if result["temperature_zero"] and ("temperature" in str(e).lower() or is_unroutable(e)):
                    result["temperature_zero"] = False
                    emit("note", {"text": "Model rejected temperature=0; retrying without it."})
                    data = chat(model, messages, False)
                else:
                    raise
            usage = data.get("usage") or {}
            result["usage"]["prompt_tokens"] += usage.get("prompt_tokens", 0)
            result["usage"]["completion_tokens"] += usage.get("completion_tokens", 0)
            result["cost"] += usage.get("cost") or 0
            msg = data["choices"][0]["message"]
            calls = msg.get("tool_calls") or []
            messages.append({k: v for k, v in msg.items() if k in ("role", "content", "tool_calls")})
            if msg.get("content"):
                emit("text", {"turn": turn, "text": msg["content"]})

            if not calls:
                result["final_text"] = msg.get("content") or ""
                result["stop_reason"] = "text"
                break

            reads, stop = [], []
            for c in calls:
                name = c["function"]["name"]
                try:
                    args = json.loads(c["function"].get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {"_unparsed": c["function"].get("arguments")}
                (reads if mocks.is_read_tool(name) and name not in STOP_TOOLS else stop).append((c, name, args))

            if stop:
                # Any approval or write tool: record every non-read call in this turn and stop. Never execute.
                for _, name, args in stop:
                    result["recorded_calls"].append({"turn": turn, "tool": name, "arguments": args})
                    emit("write", {"turn": turn, "tool": name, "arguments": args})
                result["final_text"] = msg.get("content") or ""
                result["stop_reason"] = "write_or_approval"
                break

            for c, name, args in reads:
                out = mocks.answer(name, args)
                result["reads"].append({"turn": turn, "tool": name, "arguments": args, "result": out})
                emit("read", {"turn": turn, "tool": name, "arguments": args, "result": out})
                messages.append({"role": "tool", "tool_call_id": c["id"], "content": json.dumps(out)})
        else:
            result["stop_reason"] = "max_turns"
    except (BenchError, requests.RequestException, KeyError, IndexError) as e:
        result["error"] = str(e)
        result["stop_reason"] = "error"
        emit("failed", {"text": str(e)})

    result["duration_s"] = round(time.time() - start, 2)
    result["messages"] = messages
    out_file = Path(out_file) if out_file else model_dir(model) / f"{case['id']}.json"
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(json.dumps(result, indent=2))
    emit("done", {k: result[k] for k in ("case_id", "stop_reason", "cost", "usage", "duration_s", "turns", "error")})
    return result


def select_cases(ids):
    if not ids:
        return CASES
    wanted = [i.strip().upper() for i in ids.split(",") if i.strip()]
    by_id = {c["id"]: c for c in CASES}
    missing = [i for i in wanted if i not in by_id]
    if missing:
        raise BenchError(f"Unknown case ids: {', '.join(missing)}")
    return [by_id[i] for i in wanted]


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--model", required=True)
    p.add_argument("--cases", default="")
    a = p.parse_args()
    try:
        cases = select_cases(a.cases)
    except BenchError as e:
        sys.exit(str(e))

    for i, case in enumerate(cases, 1):
        spent = total_cost_so_far()
        if spent > COST_LIMIT:
            sys.exit(f"Stopping: total cost ${spent:.2f} passed ${COST_LIMIT:.0f}.")
        r = run_case(a.model, case)
        tools = ", ".join(c["tool"] for c in r["recorded_calls"]) or "-"
        print(f"[{i}/{len(cases)}] {case['id']} {r['stop_reason']:<18} {tools:<40} "
              f"${r['cost']:.4f}  total ${total_cost_so_far():.2f}" + (f"  ERROR {r['error']}" if r["error"] else ""))
        if should_skip_model(r["error"]):
            sys.exit(f"{a.model} has no endpoint for data_collection=deny + tools. Skipping this model (setting NOT removed).")


if __name__ == "__main__":
    main()
