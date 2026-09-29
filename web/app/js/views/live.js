// Live monitor for run_all.py: what's running, what finished, what was skipped, and spend.

import { html, api, money, pct, ago, meter, shortName, legend, enc } from "../lib.js";
import { timeLine } from "../charts.js";

const STATE = {
  running: ["Sweep running", "on"], finished: ["Sweep finished", "idle"], stopped: ["Stopped at the cost cap", "warn"],
  stalled: ["No activity for 15+ minutes", "warn"], idle: ["No sweep yet", "idle"],
};
const state = { log: "all" };

export async function render(ctx) {
  ctx.setTitle("Sweep", "Every model, cheapest first");
  let stopChart = null, lastSpendSig = "";
  const draw = async () => {
    const m = await api("/api/monitor", { ttl: 2000 });
    if (!ctx.alive()) return;
    paint(ctx, m);
    const sig = m.spend.map(p => p.total).join(",") + m.total_cost;
    const el = ctx.main.querySelector("#spend");
    if (el && (sig !== lastSpendSig || !el.firstChild)) {
      lastSpendSig = sig;
      stopChart?.();
      const pts = spendPoints(m);
      stopChart = timeLine(el, pts, { fmt: v => money(v), label: "Total spend" });
    }
  };
  ctx.onCleanup(() => stopChart?.());
  await draw();
  ctx.poll(draw, 5000);
}

function spendPoints(m) {
  let dayOffset = 0, prev = -1;
  const pts = m.spend.map(p => {
    const [h, mi, s] = p.t.split(":").map(Number); let x = h * 3600 + mi * 60 + s;
    if (x < prev) dayOffset += 86400; prev = x; x += dayOffset;
    return { x, y: p.total, label: p.t.slice(0, 5) };
  });
  // End the line at the true current total.
  if (pts.length) {
    const now = new Date(m.now * 1000), x = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() + dayOffset;
    if (x >= pts.at(-1).x && m.state === "running") pts.push({ x, y: m.total_cost, label: "now" });
  }
  return pts;
}

function paint(ctx, m) {
  const by = s => m.models.filter(x => x.status === s);
  const done = by("done"), running = by("running"), partial = by("partial");
  const skipped = Object.keys(m.skipped).length;
  const seen = new Set([...m.models.map(x => x.model), ...Object.keys(m.skipped)]);
  const queued = Math.max(0, m.planned - seen.size);
  const casesDone = m.models.reduce((s, x) => s + x.files, 0);
  const [label, dot] = STATE[m.state] || STATE.idle;
  const recent = [...done].sort((a, b) => (b.score_mtime || 0) - (a.score_mtime || 0)).slice(0, 12);
  const total = m.planned || seen.size || 1;
  const tenMin = m.models.filter(x => x.last_activity && m.now - x.last_activity < 600).length;
  const events = [...m.events].reverse().filter(e => state.log === "all" || (state.log === "problems" ? ["error", "skip", "stop"].includes(e.kind) : e.kind === state.log)).slice(0, 150);

  // Keep scroll position of the log across refreshes.
  const logEl = ctx.main.querySelector(".log"), logScroll = logEl?.scrollTop || 0;
  const spendEl = ctx.main.querySelector("#spend");
  ctx.main.innerHTML = String(html`
  <div class="head"><div class="grow"><div class="eyebrow">Saved results</div><h1>Sweep monitor</h1>
    <p>Every tool-calling model on OpenRouter, cheapest first, until the $${m.cost_limit} cap. Updates every 5 seconds.</p></div></div>

  <div class="card state-card">
    <div class="big"><i class="live-dot ${dot}"></i>${label}</div>
    <div class="grow">
      <div class="small ink2" style="margin-bottom:6px">${m.plan || "No plan logged yet"} · last log line ${ago(m.log_mtime)}</div>
      <div class="progress-stack" role="img" aria-label="${done.length} done, ${running.length} running, ${skipped} skipped, ${queued} queued">
        <span class="ps-done" style="flex:${done.length} 1 0"></span><span class="ps-run" style="flex:${running.length + partial.length} 1 0"></span>
        <span class="ps-skip" style="flex:${skipped} 1 0"></span><span class="ps-queue" style="flex:${queued} 1 0"></span>
      </div>
      <div style="margin-top:8px">${legend([["ps-done", `Done ${done.length}`], ["ps-run", `Running ${running.length}${partial.length ? ` · partial ${partial.length}` : ""}`], ["ps-skip", `Skipped ${skipped}`], ["ps-queue", `Queued ${queued}`]])}</div>
    </div>
  </div>

  <div class="kpis" style="margin-top:12px">
    <div class="tile hero"><span class="k">Models done</span><span class="v">${done.length}<small>/ ${total}</small></span><span class="n">${pct(100 * (done.length + skipped) / total)} of the plan processed</span>${meter(done.length + skipped, total, { label: false })}</div>
    <div class="tile"><span class="k">Spend</span><span class="v">${money(m.total_cost)}<small>of $${m.cost_limit}</small></span>${meter(m.total_cost, m.cost_limit, { label: false, cls: m.total_cost / m.cost_limit > 0.85 ? "crit" : m.total_cost / m.cost_limit > 0.6 ? "warn" : "" })}</div>
    <div class="tile"><span class="k">Case runs saved</span><span class="v">${casesDone.toLocaleString()}</span><span class="n">${m.cases_per_model} per model</span></div>
    <div class="tile"><span class="k">Models active, last 10 min</span><span class="v">${tenMin}</span><span class="n">models writing results</span></div>
    <div class="tile"><span class="k">Skipped</span><span class="v">${skipped}</span><span class="n">no private tool-calling route</span></div>
  </div>

  <div class="grid two" style="margin-top:12px">
    <div class="card">
      <div class="card-h"><div><h2>Running now</h2><p>${running.length ? "Cases saved so far for each model" : "Nothing in flight"}</p></div></div>
      ${running.length || partial.length ? html`<div class="grid" style="gap:14px">${[...running, ...partial].map(x => html`
        <a class="run-card" href="#/model/${enc(x.model)}" style="color:inherit;text-decoration:none">
          <div class="row1"><b>${shortName(x.model)}</b><span class="small muted nowrap">${x.status === "partial" ? "partial · " : ""}${ago(x.last_activity)}</span></div>
          ${meter(x.files, m.cases_per_model, { label: `${x.files}/${m.cases_per_model}` })}
          ${x.errors ? html`<span class="small bad">${x.errors} error${x.errors === 1 ? "" : "s"} so far</span>` : ""}
        </a>`)}</div>` : html`<div class="empty">${m.state === "finished" ? "The sweep has finished." : "Waiting for the next model."}</div>`}
    </div>
    <div class="card">
      <div class="card-h"><div><h2>Spend over time</h2><p>Runs plus judge labels, from the progress log</p></div></div>
      <div class="chart" id="spend"></div>
    </div>
  </div>

  <div class="grid two" style="margin-top:12px">
    <div class="card flush">
      <div class="card-h" style="padding:16px 16px 0"><div><h2>Just finished</h2><p>Newest first</p></div><a class="link-btn" href="#/models">Leaderboard</a></div>
      ${recent.length ? html`<div class="list">${recent.map(x => html`
        <a class="li" href="#/model/${enc(x.model)}">
          <span class="main"><div class="t1"><b>${shortName(x.model)}</b></div><div class="t2">${ago(x.score_mtime)} · ${money(x.cost)}${x.errors ? ` · ${x.errors} errors` : ""}</div></span>
          <span class="side-v"><b>${pct(x.pass_rate)}</b>${x.dangerous_misses ? html`<small class="bad">⚠ ${x.dangerous_misses}</small>` : html`<small>0 ⚠</small>`}</span>
        </a>`)}</div>` : html`<div class="empty">Nothing yet.</div>`}
    </div>
    <div class="card flush">
      <div class="card-h" style="padding:16px 16px 0"><div><h2>Skipped models</h2><p>Per the rules, <span class="mono">data_collection: deny</span> is never removed</p></div></div>
      ${skipped ? html`<div class="list" style="max-height:420px;overflow:auto">${Object.entries(m.skipped).map(([id, why]) => html`
        <div class="li"><span class="main"><div class="t1"><b>${shortName(id)}</b> <span class="muted small">${id.split("/")[0]}</span></div><div class="t2 clamp">${why}</div></span></div>`)}</div>` : html`<div class="empty">None skipped.</div>`}
    </div>
  </div>

  <div class="section-title"><h2>Event log</h2>
    <div class="chips" id="logf">${[["all", "All"], ["done", "Finished"], ["start", "Started"], ["problems", "Problems"]].map(([k, l]) => html`<button class="chip" type="button" data-k="${k}" aria-pressed="${state.log === k}">${l}</button>`)}</div></div>
  <div class="card flush"><div class="log">${events.length ? events.map(e => html`<div class="k-${e.kind}"><span class="t">${e.t}</span><span class="x">${e.text}</span></div>`) : html`<div><span></span><span class="muted">No events.</span></div>`}</div></div>
  `);
  if (spendEl) ctx.main.querySelector("#spend").replaceWith(spendEl);
  const nl = ctx.main.querySelector(".log"); if (nl) nl.scrollTop = logScroll;
  ctx.main.querySelector("#logf").onclick = e => { const b = e.target.closest("button"); if (!b) return; state.log = b.dataset.k; paint(ctx, m); };
}

