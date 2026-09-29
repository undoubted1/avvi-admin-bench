"""Data and static files for the dashboard web app (web/app/). app.py routes requests here.

Reads what the runner and scorer already wrote: results/<model>/_score.json, the raw
results/<model>/<case>.json runs, results/_models.json, results/_skipped.json and
results/_progress.log. It never calls a model and never writes anything.

Preview on another port:  python dashboard.py --port 8010
"""

import argparse
import json
import mimetypes
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import bench

APP_DIR = bench.ROOT / "web" / "app"
LIVE = bench.RESULTS / "_live"  # live runs from the web app; never overwrites the sweep's saved results
CATEGORIES = {"R": "Routine", "K": "Risky", "A": "Ambiguous", "F": "Refuse / escalate"}
CASE_IDS = [c["id"] for c in bench.CASES]
GRADE_CODE = {"pass": "P", "fail": "F", "dangerous": "D", "error": "E"}
FINAL_TEXT_LIMIT = 700
LOG_TAIL = 400
LIVE_MAX_MODELS = 25        # models per live request
LIVE_MODELS_AT_ONCE = 4     # models run in parallel; each model's cases run one after another
LIVE_MAX_STREAMS = 3        # live requests in flight across all visitors
_live_streams = threading.Semaphore(LIVE_MAX_STREAMS)

_lock = threading.Lock()
_file_cache = {}  # (path, pick) -> (mtime, size, value)


def _load(path, pick=None):
    """Parse a JSON file, re-reading only when its mtime or size changes.
    With pick, only pick(data) is kept in memory (raw runs carry whole transcripts)."""
    try:
        st = path.stat()
    except OSError:
        return None
    key = (str(path), pick)
    hit = _file_cache.get(key)
    if hit and hit[0] == st.st_mtime and hit[1] == st.st_size:
        return hit[2]
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    value = pick(data) if pick else data
    with _lock:
        _file_cache[key] = (st.st_mtime, st.st_size, value)
    return value


def _run_summary(r):
    return {"model": r.get("model"), "error": r.get("error"), "cost": r.get("cost") or 0.0, "turns": r.get("turns"),
            "usage": r.get("usage") or {}, "temperature_zero": r.get("temperature_zero"),
            "tools": [c["tool"] for c in r.get("recorded_calls", [])]}


def _cost_of(r):
    return r.get("cost") or 0.0


def total_cost():
    """Same total as bench.total_cost_so_far() (runs + judge labels), without re-parsing unchanged files."""
    return sum((_load(f, _cost_of) or 0.0)
               for f in bench.RESULTS.glob("*/*.json") if not f.name.startswith("_"))


def _memo(seconds):
    """Cache a zero-argument function's result for a few seconds (many phones polling one server)."""
    def wrap(fn):
        state = {"at": 0.0, "value": None}

        def inner():
            if time.time() - state["at"] > seconds:
                state["value"], state["at"] = fn(), time.time()
            return state["value"]
        inner.clear = lambda: state.update(at=0.0)
        return inner
    return wrap


def _grade(c):
    return "error" if c.get("error") else c.get("grade", "fail")


def _all_prices():
    rows = _load(bench.RESULTS / "_models.json") or []
    return {m["id"]: m for m in rows if isinstance(m, dict) and "id" in m}


def _hidden(model):
    """Stealth models, and anything priced above the bench's cap, stay off the site."""
    p = _all_prices().get(model)
    return bench.excluded(model) or bool(p and bench.too_expensive(p.get("prompt_per_m"), p.get("completion_per_m")))


def _price_table():
    return {k: v for k, v in _all_prices().items() if not _hidden(k)}


def _skipped():
    return _load(bench.RESULTS / "_skipped.json") or {}


def _scores():
    """(file, score) for every scored model that isn't hidden."""
    for f in sorted(bench.RESULTS.glob("*/_score.json")):
        s = _load(f)
        if s and "model" in s and not _hidden(s["model"]):
            yield f, s


def _case_meta():
    return [{"id": c["id"], "category": c["id"][0], "request": c["request"],
             "expected": c.get("expected") or {}, "why": c.get("why")} for c in bench.CASES]


# ---------------------------------------------------------------- overview / leaderboard

def _tokens_per_case(model):
    """Average [prompt, completion] tokens per saved case for one model, or None."""
    d = bench.model_dir(model)
    runs = [r for r in (_load(d / f"{cid}.json", _run_summary) for cid in CASE_IDS) if r and not r["error"]]
    if not runs:
        return None
    return [round(sum(r["usage"].get(k, 0) for r in runs) / len(runs)) for k in ("prompt_tokens", "completion_tokens")]


def _model_row(s, prices, mtime):
    by_case = {c["case_id"]: c for c in s.get("cases", [])}
    grades = "".join(GRADE_CODE.get(_grade(by_case[i]), "F") if i in by_case else "." for i in CASE_IDS)
    outcomes = {}
    for c in s.get("cases", []):
        o = "error" if c.get("error") else c.get("outcome") or "none"
        outcomes[o] = outcomes.get(o, 0) + 1
    p = prices.get(s["model"], {})
    return {
        "model": s["model"], "provider": s["model"].split("/")[0],
        "prompt_per_m": p.get("prompt_per_m"), "completion_per_m": p.get("completion_per_m"),
        "cases_run": s.get("cases_run", 0), "passed": s.get("passed", 0), "pass_rate": s.get("pass_rate", 0.0),
        "by_category": s.get("by_category", {}), "dangerous_misses": s.get("dangerous_misses", 0),
        "skipped_confirmations": s.get("skipped_confirmations", 0), "errors": s.get("errors", 0),
        "cost": s.get("cost", 0.0), "judge_cost": s.get("judge_cost", 0.0), "avg_duration_s": s.get("avg_duration_s"),
        "grades": grades, "outcomes": outcomes, "scored_at": mtime, "tokens_per_case": _tokens_per_case(s["model"]),
    }


@_memo(3)
def overview():
    prices = _price_table()
    models = []
    for f, s in _scores():
        models.append(_model_row(s, prices, f.stat().st_mtime))
    tpc = [m["tokens_per_case"] for m in models if m["tokens_per_case"]]
    return {
        "generated": time.time(),
        "avg_tokens_per_case": [round(sum(t[i] for t in tpc) / len(tpc)) for i in (0, 1)] if tpc else [20000, 400],
        "total_cost": round(total_cost(), 6),
        "cost_limit": bench.COST_LIMIT,
        "price_cap": bench.MAX_PRICE_PER_M,
        "categories": CATEGORIES,
        "case_ids": CASE_IDS,
        "cases": [{k: c[k] for k in ("id", "category", "request")} | {"expected_outcome": c["expected"].get("outcome", [])}
                  for c in _case_meta()],
        "planned": len(prices),
        "skipped": _skipped(),
        "models": models,
    }


# ---------------------------------------------------------------- one model

def model_detail(model):
    if _hidden(model):
        return None
    d = bench.model_dir(model)
    s = _load(d / "_score.json")
    runs = {}
    for cid in CASE_IDS:
        r = _load(d / f"{cid}.json", _run_summary)
        if r:
            runs[cid] = {k: r[k] for k in ("turns", "usage", "temperature_zero", "tools")}
    if not s and not runs:
        return None
    p = _price_table().get(model, {})
    return {"model": model, "score": s, "runs": runs, "skipped": _skipped().get(model),
            "prompt_per_m": p.get("prompt_per_m"), "completion_per_m": p.get("completion_per_m"),
            "supports_temperature": p.get("supports_temperature")}


# ---------------------------------------------------------------- one case across models

def case_detail(case_id):
    meta = next((c for c in _case_meta() if c["id"] == case_id), None)
    if not meta:
        return None
    runs = []
    for _, s in _scores():
        c = next((x for x in s.get("cases", []) if x.get("case_id") == case_id), None)
        if not c:
            continue
        text = c.get("final_text") or ""
        runs.append({
            "model": s["model"], "grade": _grade(c), "outcome": "error" if c.get("error") else c.get("outcome"),
            "proposed": c.get("proposed", []), "reads": c.get("reads", []), "dangerous": c.get("dangerous", []),
            "divergence": c.get("divergence"), "judge": (c.get("judge") or {}).get("reason"),
            "skipped_confirmation": c.get("skipped_confirmation"), "cost": c.get("cost"), "duration_s": c.get("duration_s"),
            "final_text": text[:FINAL_TEXT_LIMIT] + ("…" if len(text) > FINAL_TEXT_LIMIT else ""),
            "model_pass_rate": s.get("pass_rate"),
        })
    return {"case": meta, "categories": CATEGORIES, "runs": runs}


# ---------------------------------------------------------------- one run (transcript + its score)

def run_detail(model, case_id):
    if _hidden(model):
        return None
    d = bench.model_dir(model)
    f = d / f"{case_id}.json"
    if f.resolve().parent.parent != bench.RESULTS.resolve() or case_id not in CASE_IDS:
        return None
    r = _load(f)
    if not r:
        return None
    s = _load(d / "_score.json") or {}
    score = next((c for c in s.get("cases", []) if c.get("case_id") == case_id), None)
    meta = next(c for c in _case_meta() if c["id"] == case_id)
    return {"run": r, "score": score, "case": meta}


# ---------------------------------------------------------------- live monitor

LOG_LINE = re.compile(r"^(\d\d:\d\d:\d\d) (.*)$")


def _parse_log():
    f = bench.RESULTS / "_progress.log"
    try:
        lines = f.read_text(errors="replace").splitlines()
        log_mtime = f.stat().st_mtime
    except OSError:
        return {"events": [], "spend": [], "state": "idle", "log_mtime": None, "plan": None}
    start = max((i for i, l in enumerate(lines) if " Plan: " in l), default=0)
    session = lines[start:]
    events, spend = [], []
    state = "running"
    for line in session:
        m = LOG_LINE.match(line)
        t, msg = (m.group(1), m.group(2)) if m else ("", line)
        body = msg.strip()
        kind = ("plan" if body.startswith("Plan:") else "start" if re.match(r"\[\d+/\d+\]", body)
                else "done" if body.startswith("done ") or re.match(r"[\w.\-/:]+: pass \d+/\d+", body)
                else "skip" if body.startswith("SKIPPED") else "stop" if body.startswith("STOP")
                else "finish" if body.startswith("Finished") else "error" if " error: " in body else "info")
        events.append({"t": t, "kind": kind, "text": body})
        tm = re.search(r"total \$(\d+(?:\.\d+)?)", body) or re.search(r"spent so far \$(\d+(?:\.\d+)?)", body) \
            or re.search(r"Total spent \$(\d+(?:\.\d+)?)", body)
        if tm and t:
            spend.append({"t": t, "total": float(tm.group(1))})
        if kind in ("finish", "stop"):
            state = "finished" if kind == "finish" else "stopped"
    if state == "running" and time.time() - log_mtime > 15 * 60:
        state = "stalled"
    plan = next((e["text"] for e in events if e["kind"] == "plan"), None)
    return {"events": events[-LOG_TAIL:], "spend": spend, "state": state, "log_mtime": log_mtime, "plan": plan}


@_memo(4)
def monitor():
    prices = _price_table()
    skipped = _skipped()
    log = _parse_log()
    now = time.time()
    dirs = {}
    for d in bench.RESULTS.iterdir() if bench.RESULTS.exists() else []:
        if not d.is_dir() or d.name.startswith("_"):
            continue
        files = list(d.glob("[A-Z]*.json"))
        score = d / "_score.json"
        model, errors, last, cost = None, 0, 0.0, 0.0
        for f in files:
            r = _load(f, _run_summary)
            if not r:
                continue
            model = model or r.get("model")
            errors += bool(r.get("error"))
            cost += r.get("cost") or 0
            last = max(last, f.stat().st_mtime)
        if not model or _hidden(model):
            continue
        dirs[model] = {"model": model, "files": len(files), "errors": errors, "cost": round(cost, 6),
                       "last_activity": last or None, "scored": score.exists(),
                       "score_mtime": score.stat().st_mtime if score.exists() else None}
    # A model is "running" when it has fresh case files that the scorer hasn't caught up with yet.
    for m in dirs.values():
        fresh = m["last_activity"] and now - m["last_activity"] < 180
        m["status"] = ("skipped" if m["model"] in skipped
                       else "running" if fresh and (not m["scored"] or m["last_activity"] > (m["score_mtime"] or 0) + 1)
                       else "done" if m["scored"] else "partial")
        s = _load(bench.model_dir(m["model"]) / "_score.json") if m["scored"] else None
        if s:
            m |= {"pass_rate": s.get("pass_rate"), "passed": s.get("passed"), "cases_run": s.get("cases_run"),
                  "dangerous_misses": s.get("dangerous_misses")}
    order = list(prices)
    return {
        "now": now, "state": log["state"], "plan": log["plan"], "log_mtime": log["log_mtime"],
        "planned": len(order), "order": order, "total_cost": round(total_cost(), 6),
        "cost_limit": bench.COST_LIMIT, "cases_per_model": len(CASE_IDS),
        "models": sorted(dirs.values(), key=lambda m: -(m["last_activity"] or 0)),
        "skipped": skipped, "events": log["events"], "spend": log["spend"],
    }


# ---------------------------------------------------------------- live runs (web app)

def _live_summary(r):
    sc = r.get("score") or {}
    return {"model": r.get("model"), "case_id": r.get("case_id"), "cost": r.get("cost") or 0.0, "duration_s": r.get("duration_s"),
            "error": r.get("error"), "stop_reason": r.get("stop_reason"), "grade": ("error" if sc.get("error") else sc.get("grade")),
            "outcome": sc.get("outcome"), "divergence": sc.get("divergence"), "tools": [c["tool"] for c in r.get("recorded_calls", [])]}


def live_runs(limit=300):
    files = sorted(LIVE.glob("*.json"), reverse=True)[:limit] if LIVE.exists() else []
    out = []
    for f in files:
        r = _load(f, _live_summary)
        if r and not _hidden(r["model"]):
            out.append(r | {"id": f.stem, "at": f.stat().st_mtime})
    return out


def live_run_detail(run_id):
    f = LIVE / f"{run_id}.json"
    if not re.fullmatch(r"[\w.\-]+", run_id) or f.resolve().parent != LIVE.resolve():
        return None
    r = _load(f)
    if not r or r.get("case_id") not in CASE_IDS:
        return None
    meta = next(c for c in _case_meta() if c["id"] == r["case_id"])
    return {"run": r, "score": r.get("score"), "case": meta, "live": True, "at": f.stat().st_mtime}


def stream_live(handler, models, case_ids):
    """Run every selected case on every selected model and stream events (each tagged with its model).
    Each case is scored as soon as it finishes. Stops at the cost cap."""
    import score  # needs the judge; imported here so the dashboard still loads if the scorer is missing

    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream")
    handler.send_header("Cache-Control", "no-cache")
    handler.send_header("X-Accel-Buffering", "no")
    handler.end_headers()
    lock, gone, halt = threading.Lock(), threading.Event(), threading.Event()

    def send(event, data):
        if gone.is_set():
            return
        with lock:
            try:
                handler.wfile.write(f"event: {event}\ndata: {json.dumps(data)}\n\n".encode())
                handler.wfile.flush()
            except OSError:
                gone.set()

    if not _live_streams.acquire(blocking=False):
        return send("fatal", {"text": "Other live runs are in progress. Try again in a minute."})
    try:
        models = list(dict.fromkeys(m.strip() for m in models if m.strip()))
        if not models:
            raise bench.BenchError("Pick at least one model.")
        if len(models) > LIVE_MAX_MODELS:
            raise bench.BenchError(f"Pick at most {LIVE_MAX_MODELS} models at a time.")
        if any(bench.excluded(m) for m in models):
            raise bench.BenchError("Stealth models are left out of the bench: they're temporary, so their scores can't be compared later.")
        if any(_hidden(m) for m in models):
            raise bench.BenchError("Premium models aren't offered here: the bench only runs lower-cost models.")
        if not any(c.strip() for c in case_ids):
            raise bench.BenchError("Pick at least one case.")
        cases = bench.select_cases(",".join(case_ids))
        bench.headers()  # fails early if the server has no key
        send("plan", {"models": models, "cases": [c["id"] for c in cases]})

        def beat():
            while not halt.wait(15):
                with lock:
                    try:
                        handler.wfile.write(b": ping\n\n")
                        handler.wfile.flush()
                    except OSError:
                        gone.set()
                        return
        threading.Thread(target=beat, daemon=True).start()

        def work(model):
            safe = bench.model_dir(model).name
            for case in cases:
                if gone.is_set() or halt.is_set():
                    return
                spent = total_cost()
                if spent > bench.COST_LIMIT:
                    halt.set()
                    return send("fatal", {"text": f"Stopped: total spend ${spent:.2f} passed the ${bench.COST_LIMIT:.0f} cap."})
                stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
                out = LIVE / f"{stamp}__{safe}__{case['id']}.json"
                r = bench.run_case(model, case, on_event=lambda ev, d: send(ev, d | {"model": model}), out_file=out)
                try:
                    sc = score.score_case(case, r)
                    r["score"] = sc
                    out.write_text(json.dumps(r, indent=2))
                    send("scored", {"model": model, "case_id": case["id"], "id": out.stem, "grade": "error" if sc["error"] else sc["grade"],
                                    "outcome": sc["outcome"], "divergence": sc["divergence"], "cost": r["cost"]})
                except Exception as e:  # scoring is a bonus; the run itself is saved either way
                    send("scored", {"model": model, "case_id": case["id"], "id": out.stem, "grade": None, "divergence": f"Not scored: {e}", "cost": r["cost"]})
                if bench.should_skip_model(r["error"]):
                    return send("model_skipped", {"model": model, "text": "No provider meets data_collection=deny with tool calling, so this model can't be run here."})
            send("model_done", {"model": model})

        with ThreadPoolExecutor(max_workers=min(LIVE_MODELS_AT_ONCE, len(models))) as pool:
            list(pool.map(work, models))
        send("finished", {"total_cost": round(total_cost(), 6)})
    except bench.BenchError as e:
        send("fatal", {"text": str(e)})
    finally:
        halt.set()
        _live_streams.release()


# ---------------------------------------------------------------- HTTP routing

def _send(handler, status, body, ctype, cache="no-cache"):
    handler.send_response(status)
    handler.send_header("Content-Type", ctype)
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", cache)
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.end_headers()
    if handler.command != "HEAD":
        handler.wfile.write(body)


def _json(handler, obj, status=200):
    _send(handler, status, json.dumps(obj).encode(), "application/json")


def _static(handler, rel):
    f = (APP_DIR / rel).resolve()
    if APP_DIR.resolve() not in f.parents or not f.is_file():
        return _json(handler, {"error": "not found"}, 404)
    ctype = {".js": "text/javascript", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
             ".woff2": "font/woff2", ".ico": "image/x-icon"}.get(f.suffix, mimetypes.guess_type(f.name)[0] or "application/octet-stream")
    if ctype.startswith("text/") or ctype.endswith(("json", "javascript", "svg+xml")):
        ctype += "; charset=utf-8"
    body = f.read_bytes()
    if rel == "index.html":
        body = body.replace(b"__ORIGIN__", _origin(handler).encode())
    # Font files never change under the same name; everything else revalidates so a deploy shows at once.
    _send(handler, 200, body, ctype, "public, max-age=2592000" if f.suffix == ".woff2" else "no-cache")


def _origin(handler):
    """This site's own origin, for the share-card URL (link previews need an absolute image URL)."""
    host = handler.headers.get("X-Forwarded-Host") or handler.headers.get("Host") or ""
    proto = handler.headers.get("X-Forwarded-Proto") or "http"
    if not re.fullmatch(r"[A-Za-z0-9.\-]+(:\d+)?", host) or proto not in ("http", "https"):
        return ""
    return f"{proto}://{host}"


def route(handler, path, q):
    """Serve dashboard pages and data. Returns False for paths app.py handles itself."""
    if path in ("/", "/index.html"):
        _static(handler, "index.html")
    elif path.startswith("/app/"):
        _static(handler, path[len("/app/"):])
    elif path == "/manifest.webmanifest":
        _static(handler, "manifest.webmanifest")
    elif path == "/favicon.ico":
        _static(handler, "favicon.ico")
    elif path == "/api/overview":
        _json(handler, overview())
    elif path == "/api/monitor":
        _json(handler, monitor())
    elif path == "/api/model":
        d = model_detail(q.get("id", ""))
        _json(handler, d or {"error": "not found"}, 200 if d else 404)
    elif path == "/api/case":
        d = case_detail(q.get("id", "").upper())
        _json(handler, d or {"error": "not found"}, 200 if d else 404)
    elif path == "/api/run-detail":
        d = run_detail(q.get("model", ""), q.get("case", "").upper())
        _json(handler, d or {"error": "not found"}, 200 if d else 404)
    elif path == "/api/case-meta":
        _json(handler, {"categories": CATEGORIES, "cases": _case_meta()})
    elif path == "/api/status":
        _json(handler, {"key_set": bool(os.environ.get("OPENROUTER_API_KEY")), "total_cost": round(total_cost(), 6),
                        "cost_limit": bench.COST_LIMIT, "price_cap": bench.MAX_PRICE_PER_M})
    elif path == "/api/live-runs":
        _json(handler, live_runs())
    elif path == "/api/live-run":
        d = live_run_detail(q.get("id", ""))
        _json(handler, d or {"error": "not found"}, 200 if d else 404)
    elif path == "/api/run-many":
        stream_live(handler, q.get("models", "").split(","), q.get("cases", "").split(","))
    else:
        return False
    return True


if __name__ == "__main__":
    # Preview on another port with the same routes as app.py, e.g. python dashboard.py --port 8010
    from http.server import ThreadingHTTPServer

    import app

    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--port", type=int, default=8010)
    p.add_argument("--host", default="127.0.0.1")
    a = p.parse_args()
    ThreadingHTTPServer.request_queue_size = 128
    print(f"Avvi Admin Bench preview: http://localhost:{a.port}  (Ctrl+C to stop)")
    ThreadingHTTPServer((a.host, a.port), app.Handler).serve_forever()
