// Overview: the headline numbers, the leaders, accuracy vs cost, and where models struggle.

import { html, api, money, pct, plural, meter, shortName, provider, strip, bindTip, GRADES, CATS, icon, median, ago, gradeLegend, priceLabel, enc } from "../lib.js";
import { costScatter, categoryStrips } from "../charts.js";
import { board, signature } from "../data.js";

export async function render(ctx) {
  ctx.setTitle("Admin Bench", "Model scoreboard");
  let sig = "";
  const draw = async () => {
    const [o, mon] = await Promise.all([board(), api("/api/monitor", { ttl: 4000 }).catch(() => null)]);
    if (!ctx.alive()) return;
    const s = signature(o) + (mon?.state || "");
    if (s === sig) return;
    sig = s;
    paint(ctx, o, mon);
  };
  await draw();
  ctx.poll(draw, 15000);
}

function paint(ctx, o, mon) {
  const { ranked, perCase } = o;
  const leader = o.full[0];
  const complete = ranked.filter(m => m.cases_run === o.case_ids.length);
  const dangerModels = ranked.filter(m => m.dangerous_misses > 0);
  const totalDanger = ranked.reduce((s, m) => s + m.dangerous_misses, 0);
  const med = median(o.full.map(m => m.pass_rate));
  const running = mon?.state === "running";
  const doneCount = mon ? mon.models.filter(m => m.status === "done").length : ranked.length;
  const runningNow = mon ? mon.models.filter(m => m.status === "running") : [];

  const hardest = perCase.filter(c => c.ran).sort((a, b) => a.rate - b.rate || b.n.D - a.n.D).slice(0, 8);
  const riskiest = perCase.filter(c => c.n.D).sort((a, b) => b.n.D - a.n.D).slice(0, 6);
  const dangerBoard = [...dangerModels].sort((a, b) => b.dangerous_misses - a.dangerous_misses || b.pass_rate - a.pass_rate).slice(0, 6);
  const maxD = dangerBoard[0]?.dangerous_misses || 1;

  ctx.main.innerHTML = String(html`
  <div class="head">
    <div class="grow">
      <div class="eyebrow">Avvi Admin Bench ${running ? html`<span class="pill accent"><i class="live-dot on"></i> Sweep running</span>` : ""}</div>
      <h1>Which AI models can be trusted with IT admin?</h1>
      <p>${o.case_ids.length} real requests from an office manager at a fictional 12-person dental practice. Each model has to propose the right change for the right person, or ask or refuse when it should. Nothing is ever executed.</p>
      <div class="meta-line"><span>${plural(ranked.length, "model")} scored</span>${o.planned ? html`·<span>${o.planned} planned</span>` : ""}·<span>updated ${ago(Math.max(0, ...ranked.map(m => m.scored_at || 0)))}</span></div>
    </div>
    <div class="chips"><a class="btn" href="#/models">${icon("models")} Full leaderboard</a><a class="btn" href="#/cases">${icon("cases")} All cases</a></div>
  </div>

  ${running ? html`<a class="card state-card" href="#/sweep" style="margin-bottom:12px;color:inherit;text-decoration:none">
      <div class="big"><i class="live-dot on"></i> Sweep in progress</div>
      <div class="grow">
        <div class="small ink2" style="margin-bottom:6px">${doneCount} of ${mon.planned} models done · ${runningNow.length} running now${runningNow.length ? html`: ${runningNow.slice(0, 3).map(m => shortName(m.model)).join(", ")}${runningNow.length > 3 ? "…" : ""}` : ""}</div>
        ${meter(doneCount, mon.planned || 1, { label: `${Math.round(100 * doneCount / (mon.planned || 1))}%` })}
      </div>
      <span class="btn sm">Open monitor ${icon("chev")}</span></a>` : ""}

  ${!ranked.length ? html`<div class="card empty"><b>No scored models yet.</b>Scores appear here as soon as the first model finishes all ${o.case_ids.length} cases.</div>` : html`
  <div class="kpis six">
    <a class="tile hero" href="#/model/${enc(leader.model)}">
      <span class="k">Top pass rate</span>
      <span class="v">${pct(leader.pass_rate, 1)}</span>
      <span class="n"><b style="color:var(--ink)">${shortName(leader.model)}</b> · ${leader.passed}/${leader.cases_run} cases · ${leader.dangerous_misses} dangerous</span>
      ${meter(leader.pass_rate, 100, { label: false })}
    </a>
    <div class="tile"><span class="k">Models scored</span><span class="v">${ranked.length}${o.planned ? html`<small>/ ${o.planned}</small>` : ""}</span><span class="n">${complete.length} ran every case</span></div>
    <div class="tile"><span class="k">Median pass rate</span><span class="v">${pct(med)}</span><span class="n">${plural(o.full.length, "complete run")}</span></div>
    <a class="tile" href="#/cases"><span class="k">${icon("alert")} Dangerous misses</span><span class="v ${totalDanger ? "bad" : ""}">${totalDanger}</span><span class="n">${dangerModels.length} of ${ranked.length} models made one</span></a>
    <div class="tile"><span class="k">Skipped confirmation</span><span class="v">${ranked.reduce((s, m) => s + m.skipped_confirmations, 0)}</span><span class="n">wrote directly, no approval card</span></div>
    ${(() => { const v = [...o.full].filter(m => m.pass_rate >= 80).sort((a, b) => a.cost / a.cases_run - b.cost / b.cases_run || b.pass_rate - a.pass_rate)[0];
      return v ? html`<a class="tile" href="#/model/${enc(v.model)}"><span class="k">Best value at 80%+</span><span class="v txt">${shortName(v.model)}</span><span class="n">${pct(v.pass_rate)} pass · ${v.cost ? `${money(v.cost / v.cases_run)} per case` : "free"}</span></a>`
        : html`<div class="tile"><span class="k">Best value at 80%+</span><span class="v">–</span><span class="n">no model has reached 80% yet</span></div>`; })()}
    <a class="tile" href="#/sweep"><span class="k">Spend</span><span class="v">${money(o.total_cost)}<small>of $${o.cost_limit}</small></span>${meter(o.total_cost, o.cost_limit, { label: false, cls: o.total_cost / o.cost_limit > 0.85 ? "crit" : o.total_cost / o.cost_limit > 0.6 ? "warn" : "" })}</a>
  </div>

  <div class="grid three" style="margin-top:12px">
    <div class="card span-2">
      <div class="card-h"><div><h2>Accuracy vs cost</h2><p>Each dot is a model that ran every case. Blue dots are the frontier: no cheaper model scores higher.</p></div></div>
      <div class="chart" id="scatter"></div>
    </div>
    <div class="card flush">
      <div class="card-h" style="padding:16px 16px 0"><div><h2>Leaders</h2><p>Pass rate, then fewest dangerous misses</p></div><a class="link-btn" href="#/models">All ${ranked.length}</a></div>
      <div class="list" id="leaders">${ranked.slice(0, 7).map(m => html`
        <a class="li" href="#/model/${enc(m.model)}">
          <span class="cat-tag" style="min-width:26px">${m.rank}</span>
          <span class="main"><div class="t1"><b>${shortName(m.model)}</b></div><div class="t2">${provider(m.model)} · ${priceLabel(m.prompt_per_m, m.completion_per_m)}</div>
            <div style="margin-top:6px">${strip(m.grades, o.case_ids, { model: m.model })}</div></span>
          <span class="side-v"><b>${pct(m.pass_rate)}</b>${m.dangerous_misses ? html`<small class="bad">⚠ ${m.dangerous_misses}</small>` : html`<small>0 ⚠</small>`}</span>
        </a>`)}</div>
      <div style="padding:10px 16px 14px">${gradeLegend()}</div>
    </div>
  </div>

  <div class="grid two" style="margin-top:12px">
    <div class="card">
      <div class="card-h"><div><h2>Pass rate by category</h2><p>Gray dots are models, the black tick is the median${leader ? html`, blue is <b>${shortName(leader.model)}</b>` : ""}.</p></div></div>
      <div class="chart" id="catStrips"></div>
    </div>
    <div class="card">
      <div class="card-h"><div><h2>Hardest cases</h2><p>Lowest share of models that passed</p></div><a class="link-btn" href="#/cases">All cases</a></div>
      <div class="hbars">${hardest.map(c => html`
        <a class="hbar" href="#/case/${c.id}">
          <div class="hb-top"><span class="hb-label"><span class="mono">${c.id}</span>${c.request}</span><span class="hb-val">${pct(c.rate)}${c.n.D ? html` · <span class="bad">⚠ ${c.n.D}</span>` : ""}</span></div>
          <div class="hb-tr"><div class="hb-fl" style="width:${Math.max(0.5, c.rate)}%"></div></div>
        </a>`)}</div>
    </div>
  </div>

  <div class="grid two" style="margin-top:12px">
    <div class="card">
      <div class="card-h"><div><h2>${icon("alert")} Most dangerous models</h2><p>Wrong person, a forbidden tool, or a forbidden setting</p></div></div>
      ${dangerBoard.length ? html`<div class="hbars">${dangerBoard.map(m => html`
        <a class="hbar" href="#/model/${enc(m.model)}">
          <div class="hb-top"><span class="hb-label"><b>${shortName(m.model)}</b> <span class="muted">· ${pct(m.pass_rate)} pass</span></span><span class="hb-val">⚠ ${m.dangerous_misses}</span></div>
          <div class="hb-tr"><div class="hb-fl crit" style="width:${(100 * m.dangerous_misses / maxD).toFixed(1)}%"></div></div>
        </a>`)}</div>` : html`<div class="empty">No dangerous misses so far.</div>`}
    </div>
    <div class="card">
      <div class="card-h"><div><h2>Cases that trigger dangerous misses</h2><p>How many models made a dangerous proposal on each</p></div></div>
      ${riskiest.length ? html`<div class="hbars">${riskiest.map(c => html`
        <a class="hbar" href="#/case/${c.id}">
          <div class="hb-top"><span class="hb-label"><span class="mono">${c.id}</span>${c.request}</span><span class="hb-val">${c.n.D} of ${c.ran}</span></div>
          <div class="hb-tr"><div class="hb-fl crit" style="width:${(100 * c.n.D / (c.ran || 1)).toFixed(1)}%"></div></div>
        </a>`)}</div>` : html`<div class="empty">None yet.</div>`}
    </div>
  </div>`}
  `);

  if (!ranked.length) return;
  ctx.onCleanup(costScatter(ctx.main.querySelector("#scatter"), o.full, { onPick: m => ctx.go(`#/model/${enc(m)}`) }));
  ctx.onCleanup(categoryStrips(ctx.main.querySelector("#catStrips"), o.full, { emphasize: leader?.model, onPick: m => ctx.go(`#/model/${enc(m)}`) }));
  stripTips(ctx.main.querySelector("#leaders"), o, ctx);
}

// Hover a strip cell for the case; click it to open that run's transcript.
export function stripTips(root, o, ctx) {
  if (!root) return;
  bindTip(root, ".strip i", el => {
    const i = +el.dataset.i, m = o.byModel[el.parentElement.dataset.model], id = o.case_ids[i], g = GRADES[m?.grades[i] || "."];
    return html`<div class="tv">${g.icon} ${g.label}</div><div class="tl"><b>${id}</b> · ${CATS[id[0]]}</div><div class="tm">“${o.caseById[id]?.request}”</div>`;
  });
  root.addEventListener("click", e => {
    const cell = e.target.closest(".strip i");
    if (!cell) return;
    e.preventDefault(); e.stopPropagation();
    const m = cell.parentElement.dataset.model, id = o.case_ids[+cell.dataset.i];
    if (m && o.byModel[m]?.grades[+cell.dataset.i] !== ".") ctx.go(`#/run/${enc(m)}/${id}`);
  }, true);
}

