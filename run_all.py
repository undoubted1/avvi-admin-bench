"""Run every case for many models, cheapest first, then score and rebuild the report.

python run_all.py [--first openai/gpt-6-luna,anthropic/claude-sonnet-5.5] [--only openai/gpt-6-luna] [--workers 6]

Models come from OpenRouter's /models/user (what this key can reach), filtered to tool calling.
--first models run before the price order: reference models the $40 cap would otherwise never reach.
Skipped on purpose: ~provider/*-latest aliases and openrouter/* routers (the model behind them can change,
so scores wouldn't be reproducible) and :batch variants (same model as the non-batch id).
Stops starting new cases once total cost (runs + judge) reaches bench.COST_LIMIT minus a small margin.
Models already fully run are not re-run.
"""

import argparse
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

import bench
import report
import score

MARGIN = 0.50  # stop starting cases this far below the cap, since up to --workers cases are in flight
SKIPPED = bench.RESULTS / "_skipped.json"
LOG = bench.RESULTS / "_progress.log"
NOT_RUN = bench.RESULTS / "_not_run.json"
_lock = threading.Lock()
_reserved = {}  # model -> estimated cost of its in-flight run, so concurrent models can't overcommit the cap


def log(msg):
    line = f"{time.strftime('%H:%M:%S')} {msg}"
    print(line, flush=True)
    with LOG.open("a") as f:
        f.write(line + "\n")


def price(m):
    p = m.get("pricing", {})
    return float(p.get("prompt") or 0) * 1e6, float(p.get("completion") or 0) * 1e6


def candidate_models():
    r = requests.get("https://openrouter.ai/api/v1/models/user", headers=bench.headers(), timeout=60)
    r.raise_for_status()
    out = []
    for m in r.json()["data"]:
        mid = m["id"]
        if "tools" not in (m.get("supported_parameters") or []):
            continue
        if mid.startswith(("~", "openrouter/")) or mid.endswith(":batch") or bench.excluded(mid):
            continue
        pin, pout = price(m)
        if pin < 0 or pout < 0 or bench.too_expensive(pin, pout):
            continue
        out.append({"id": mid, "prompt_per_m": pin, "completion_per_m": pout,
                    "supports_temperature": "temperature" in (m.get("supported_parameters") or [])})
    # "Cheapest per token": average of input and output price, ties by id.
    out.sort(key=lambda m: ((m["prompt_per_m"] + m["completion_per_m"]) / 2, m["id"]))
    return out


def load_skipped():
    return json.loads(SKIPPED.read_text()) if SKIPPED.exists() else {}


def done_cases(model):
    d = bench.model_dir(model)
    return {c["id"] for c in bench.CASES if (d / f"{c['id']}.json").exists()
            and not json.loads((d / f"{c['id']}.json").read_text()).get("error")}


def per_case_tokens():
    """Average prompt/completion tokens per case across every finished run (fallback before there are any)."""
    p = c = n = 0
    for f in bench.RESULTS.glob("*/[A-Z]*.json"):
        try:
            r = json.loads(f.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        if not r.get("error"):
            p += r["usage"]["prompt_tokens"]; c += r["usage"]["completion_tokens"]; n += 1
    return (p / n, c / n) if n else (26000, 700)


def estimate(m, n_cases):
    """Estimated cost of n_cases for model meta m, with 50% headroom."""
    p, c = per_case_tokens()
    return 1.5 * n_cases * (p * m.get("prompt_per_m", 0) + c * m.get("completion_per_m", 0)) / 1e6


def run_model(model, workers, m=None):
    """Returns 'done', 'skipped:<reason>', 'budget' (stopped mid-run) or 'not_run:<reason>' (would not fit)."""
    todo = [c for c in bench.CASES if c["id"] not in done_cases(model)]
    if not todo:
        return "done"
    # Only start a model if ALL its remaining cases fit under the cap, so no model is left half-run.
    est = estimate(m or {}, len(todo))
    with _lock:
        committed = bench.total_cost_so_far() + sum(_reserved.values())
        if committed + est > bench.COST_LIMIT - MARGIN:
            return f"not_run:needs ~${est:.2f} for {len(todo)} cases; ${committed:.2f} of ${bench.COST_LIMIT:.0f} already spent or committed"
        _reserved[model] = est
    try:
        return _run_cases(model, workers, todo)
    finally:
        with _lock:
            _reserved.pop(model, None)


def _run_cases(model, workers, todo):
    stop = None
    # Probe with one case first so an unroutable model costs one request, not 42.
    first, rest = todo[0], todo[1:]
    r = bench.run_case(model, first)
    if bench.should_skip_model(r["error"]):
        return f"skipped:{r['error']}"
    errors = [bool(r["error"])]
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {}
        for case in rest:
            if bench.total_cost_so_far() >= bench.COST_LIMIT - MARGIN:
                stop = "budget"
                break
            futures[pool.submit(bench.run_case, model, case)] = case["id"]
        for fut in as_completed(futures):
            res = fut.result()
            errors.append(bool(res["error"]))
            if res["error"]:
                log(f"  {model} {res['case_id']} error: {res['error'][:160]}")
            if len(errors) >= 6 and all(errors):
                stop = stop or "skipped:every case errored"
                for f in futures:
                    f.cancel()
    return stop or "done"


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--first", default="openai/gpt-6-luna,anthropic/claude-sonnet-5.5",
                   help="comma-separated model ids to run before the price-ordered list")
    p.add_argument("--only", default="", help="comma-separated model ids; run just these")
    p.add_argument("--workers", type=int, default=3, help="cases in flight per model (rate limit is ~20 req/min per model)")
    p.add_argument("--models-at-once", type=int, default=4)
    a = p.parse_args()

    models = candidate_models()
    meta = {m["id"]: m for m in models}
    (bench.RESULTS / "_models.json").write_text(json.dumps(models, indent=2))
    first = [x.strip() for x in a.first.split(",") if x.strip()]
    order = [x.strip() for x in a.only.split(",") if x.strip()] or \
        first + [m["id"] for m in models if m["id"] not in first]
    skipped = load_skipped()
    log(f"Plan: {len(order)} models, spent so far ${bench.total_cost_so_far():.2f} of ${bench.COST_LIMIT:.0f}")

    budget_hit = threading.Event()

    def one(i, model):
        if budget_hit.is_set():
            return
        m = meta.get(model, {})
        log(f"[{i}/{len(order)}] start {model}  (${m.get('prompt_per_m', 0):.2f}/${m.get('completion_per_m', 0):.2f} per 1M)")
        try:
            status = run_model(model, a.workers, m)
        except (bench.BenchError, requests.RequestException) as e:
            status = f"skipped:{e}"
        with _lock:
            if status.startswith("not_run:"):
                not_run = json.loads(NOT_RUN.read_text()) if NOT_RUN.exists() else {}
                not_run[model] = status.split(":", 1)[1]
                NOT_RUN.write_text(json.dumps(not_run, indent=2))
                log(f"  NOT RUN {model}: {not_run[model]}")
            elif NOT_RUN.exists():
                not_run = json.loads(NOT_RUN.read_text())
                if not_run.pop(model, None) is not None:
                    NOT_RUN.write_text(json.dumps(not_run, indent=2))
            if status.startswith("skipped:"):
                skipped[model] = status.split(":", 1)[1][:300]
                SKIPPED.write_text(json.dumps(skipped, indent=2))
                log(f"  SKIPPED {model}: {skipped[model]}")
            if any(bench.model_dir(model).glob("[A-Z]*.json")):
                s = score.score_model(model)
                log(f"  done {model}: pass {s['passed']}/{s['cases_run']} ({s['pass_rate']}%), dangerous {s['dangerous_misses']}, "
                    f"cost ${s['cost']:.4f}; total ${bench.total_cost_so_far():.2f}")
                report.build()
            if status == "budget" and not budget_hit.is_set():
                budget_hit.set()
                log(f"STOP: total cost ${bench.total_cost_so_far():.2f} reached the ${bench.COST_LIMIT:.0f} cap.")

    with ThreadPoolExecutor(max_workers=a.models_at_once) as pool:
        for fut in [pool.submit(one, i, m) for i, m in enumerate(order, 1) if m not in skipped]:
            fut.result()

    # Second pass: retry cases that hit transient errors (provider 400/5xx, timeouts) so every
    # scored model has all its cases. run_model only re-runs cases whose saved result has an error.
    retry = [m for m in order if m not in skipped and any(bench.model_dir(m).glob("[A-Z]*.json"))
             and len(done_cases(m)) < len(bench.CASES)]
    if retry and not budget_hit.is_set():
        log(f"Retry pass: {len(retry)} models with errored or missing cases")
        budget_hit.clear()
        with ThreadPoolExecutor(max_workers=a.models_at_once) as pool:
            for fut in [pool.submit(one, order.index(m) + 1, m) for m in retry]:
                fut.result()
    report.build()
    log(f"Finished. Total spent ${bench.total_cost_so_far():.2f}.")


if __name__ == "__main__":
    main()
