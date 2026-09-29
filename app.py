"""Avvi Admin Bench web app. Run: python app.py, then open http://localhost:8000

The dashboard pages and their data live in dashboard.py; this file keeps the model list and the single-model run stream."""

import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import requests

import bench
import dashboard

HOST, PORT = os.environ.get("HOST", "127.0.0.1"), int(os.environ.get("PORT", 8000))
_models_cache = {"at": 0, "data": None}


def list_models():
    """Tool-calling models from OpenRouter, cached for 10 minutes."""
    if _models_cache["data"] and time.time() - _models_cache["at"] < 600:
        return _models_cache["data"]
    r = requests.get("https://openrouter.ai/api/v1/models", headers=bench.headers(), timeout=30)
    r.raise_for_status()
    models = [
        {
            "id": m["id"],
            "name": m.get("name", m["id"]),
            "prompt_per_m": float(m.get("pricing", {}).get("prompt") or 0) * 1e6,
            "completion_per_m": float(m.get("pricing", {}).get("completion") or 0) * 1e6,
        }
        for m in r.json().get("data", [])
        if "tools" in (m.get("supported_parameters") or []) and not bench.excluded(m["id"])
    ]
    models.sort(key=lambda m: m["id"])
    _models_cache.update(at=time.time(), data=models)
    return models


def result_summaries():
    out = []
    for f in sorted(bench.RESULTS.glob("*/[A-Z]*.json")):
        try:
            r = json.loads(f.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        if bench.excluded(r.get("model")):
            continue
        out.append({k: r.get(k) for k in ("model", "case_id", "stop_reason", "cost", "duration_s", "error")}
                   | {"tools": [c["tool"] for c in r.get("recorded_calls", [])]})
    return out


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"  {self.command} {self.path.split('?')[0]} {args[1] if len(args) > 1 else ''}")

    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            if dashboard.route(self, url.path, q):
                return
            if url.path == "/api/cases":
                self.send_json([{"id": c["id"], "request": c["request"], "expected": c.get("expected"),
                                 "why": c.get("why")} for c in bench.CASES])
            elif url.path == "/api/models":
                self.send_json(list_models())
            elif url.path == "/api/results":
                self.send_json(result_summaries())
            elif url.path == "/api/result":
                f = bench.model_dir(q.get("model", "")) / f"{q.get('case', '')}.json"
                if f.resolve().parent.parent != bench.RESULTS.resolve() or not f.exists():
                    return self.send_json({"error": "not found"}, 404)
                self.send_json(json.loads(f.read_text()))
            elif url.path == "/api/run":
                self.stream_run(q.get("model", ""), q.get("cases", ""))
            else:
                self.send_json({"error": "not found"}, 404)
        except (bench.BenchError, requests.RequestException) as e:
            self.send_json({"error": str(e)}, 500)

    def stream_run(self, model, case_ids):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()

        def send(event, data):
            self.wfile.write(f"event: {event}\ndata: {json.dumps(data)}\n\n".encode())
            self.wfile.flush()

        try:
            if not model:
                raise bench.BenchError("Pick a model first.")
            if bench.excluded(model):
                raise bench.BenchError("Stealth models are left out of the bench: they're temporary, so their scores can't be compared later.")
            cases = bench.select_cases(case_ids)
            for case in cases:
                spent = bench.total_cost_so_far()
                if spent > bench.COST_LIMIT:
                    raise bench.BenchError(f"Stopped: total cost ${spent:.2f} passed ${bench.COST_LIMIT:.0f}.")
                r = bench.run_case(model, case, on_event=send)
                if r["error"] and "data_collection" in r["error"].lower():
                    raise bench.BenchError(f"{model} rejected data_collection=deny. Skip this model.")
            send("finished", {"total_cost": bench.total_cost_so_far()})
        except bench.BenchError as e:
            send("fatal", {"text": str(e)})
        except (BrokenPipeError, ConnectionResetError):
            pass


if __name__ == "__main__":
    ThreadingHTTPServer.request_queue_size = 128  # the page loads ~15 modules at once; the default backlog of 5 resets some
    print(f"Avvi Admin Bench: http://localhost:{PORT}  (Ctrl+C to stop)")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
