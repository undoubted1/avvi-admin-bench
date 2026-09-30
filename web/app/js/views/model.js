// One model: headline numbers, category meters against the field, every case, cost/latency per case.

import { html, api, money, pct, secs, compact, meter, shortName, provider, icon, priceLabel, gradeLegend, gradePill, stack, legend, bindTip, GRADES, GRADE_CODE, CATS, OUTCOMES, outcomeLabel, enc } from "../lib.js";
import { caseColumns } from "../charts.js";
import { board } from "../data.js";

const METRICS = {
  time: ["Time", r => r.duration_s, v => secs(v)],
  cost: ["Cost", r => r.cost, v => money(v)],
  tokens: ["Tokens", r => r.tokens, v => compact(v)],
  turns: ["Turns", r => r.turns, v => String(Math.round(v))],
};
let metric = "time";

export async function render(ctx) {
  const id = ctx.params[0];
  ctx.setTitle(shortName(id), provider(id), { back: "#/models" });
  const [o, d] = await Promise.all([board(), api(`/api/model?id=${enc(id)}`)]);
  if (!ctx.alive()) return;
  const s = d.score, row = o.byModel[id];
  if (!s) {
    ctx.main.innerHTML = String(html`<div class="head"><div class="grow"><div class="eyebrow">${provider(id)}</div><h1>${shortName(id)}</h1></div></div>
      <div class="card empty"><b>Not scored yet.</b>${Object.keys(d.runs).length} of ${o.case_ids.length} cases have run.${d.skipped ? html`<br>Skipped: ${d.skipped}` : ""}</div>`);
    return;
  }
  const cases = s.cases, byId = Object.fromEntries(cases.map(c => [c.case_id, c]));
  const tokensIn = Object.values(d.runs).reduce((a, r) => a + (r.usage?.prompt_tokens || 0), 0);
  const tokensOut = Object.values(d.runs).reduce((a, r) => a + (r.usage?.completion_tokens || 0), 0);
  const noTemp = Object.values(d.runs).filter(r => r.temperature_zero === false).length;
  const gradeOf = c => c.error ? "error" : c.grade;
  const misses = cases.filter(c => gradeOf(c) !== "pass").sort((a, b) => ["dangerous", "error", "review", "fail"].indexOf(gradeOf(a)) - ["dangerous", "error", "review", "fail"].indexOf(gradeOf(b)));
  const outcomeParts = counts => OUTCOMES.map(([k, l]) => ({ cls: `o-${k}`, label: l, value: counts[k] || 0 }));
  const field = {};
  for (const m of o.models) for (const [k, v] of Object.entries(m.outcomes || {})) field[k] = (field[k] || 0) + v;
  const rows = o.case_ids.map(cid => {
    const c = byId[cid], r = d.runs[cid];
    return { id: cid, g: c ? GRADE_CODE[gradeOf(c)] : ".", duration_s: c?.duration_s, cost: c?.cost, turns: r?.turns, tokens: r ? (r.usage?.prompt_tokens || 0) + (r.usage?.completion_tokens || 0) : null };
  });

  ctx.main.innerHTML = String(html`
  <div class="head">
    <div class="grow">
      <div class="eyebrow"><a href="#/models">Leaderboard</a> › ${provider(id)}</div>
      <h1>${shortName(id)}</h1>
      <div class="meta-line"><span class="mono">${id}</span>·<span>${priceLabel(d.prompt_per_m, d.completion_per_m)}</span>${row ? html`<span class="pill accent">Rank #${row.rank} of ${o.models.length}</span>` : ""}${noTemp ? html`<span class="pill neutral" title="The model rejected temperature 0 on ${noTemp} cases">temperature ≠ 0</span>` : ""}</div>
    </div>
    <div class="chips">
      <a class="btn" href="#/compare/${enc(id)}/${enc(o.ranked.find(m => m.model !== id)?.model || id)}">${icon("compare")} Compare</a>
      <a class="btn" href="#/live?model=${enc(id)}">${icon("run")} Run live</a>
    </div>
  </div>

  ${s.needs_review ? html`<div class="card"><b>${s.needs_review} case(s) need review.</b> Pass rate is provisional until the judge or ground truth is resolved.</div>` : ""}
  <p class="small muted">Scoring rules: ${s.scorer_version || "legacy"}. Compare models evaluated under the same rules and inputs.</p>
  <div class="kpis six">
    <div class="tile hero"><span class="k">Pass rate</span><span class="v">${pct(s.pass_rate, 1)}</span><span class="n">${s.passed} of ${s.cases_run} cases${s.missing?.length ? ` · ${s.missing.length} not run` : ""}</span>${meter(s.pass_rate, 100, { label: false })}</div>
    <div class="tile"><span class="k">${icon("alert")} Dangerous misses</span><span class="v ${s.dangerous_misses ? "bad" : ""}">${s.dangerous_misses}</span><span class="n">wrong person, forbidden tool or setting</span></div>
    <div class="tile"><span class="k">Skipped confirmation</span><span class="v">${s.skipped_confirmations}</span><span class="n">called a write tool directly</span></div>
    <div class="tile"><span class="k">Cost</span><span class="v">${money(s.cost)}</span><span class="n">+ ${money(s.judge_cost)} judge · ${money(s.cost / (s.cases_run || 1))}/case</span></div>
    <div class="tile"><span class="k">Avg time per case</span><span class="v">${secs(s.avg_duration_s)}</span><span class="n">${s.errors} run error${s.errors === 1 ? "" : "s"}</span></div>
    <div class="tile"><span class="k">Avg turns per case</span><span class="v">${(Object.values(d.runs).reduce((a, r) => a + (r.turns || 0), 0) / (Object.keys(d.runs).length || 1)).toFixed(1)}</span><span class="n">of 6 allowed · reads before acting</span></div>
    <div class="tile"><span class="k">Tokens</span><span class="v">${compact(tokensIn + tokensOut)}</span><span class="n">${compact(tokensIn)} in · ${compact(tokensOut)} out</span></div>
  </div>

  <div class="grid two" style="margin-top:12px">
    <div class="card">
      <div class="card-h"><div><h2>By category</h2><p>The black tick is the median of ${o.full.length} complete runs</p></div></div>
      <div class="stack-rows">${Object.entries(CATS).map(([k, n]) => { const c = s.by_category[k] || { passed: 0, total: 0 }; return html`
        <div class="stack-row" style="grid-template-columns:128px minmax(0,1fr)"><span class="lbl"><b>${k}</b> · ${n}</span>
          ${meter(c.passed, c.total, { label: `${c.passed}/${c.total}`, marker: o.catMedian[k] })}</div>`; })}</div>
      <div class="lab" style="margin-top:18px">What it chose</div>
      <div class="stack-rows">
        <div class="stack-row"><span class="lbl">This model</span>${stack(outcomeParts(row?.outcomes || {}), { lg: true })}</div>
        <div class="stack-row"><span class="lbl">All models</span>${stack(outcomeParts(field), { lg: true })}</div>
      </div>
      <div style="margin-top:10px">${legend(OUTCOMES.map(([k, l]) => [`o-${k}`, `${l} ${row?.outcomes?.[k] || 0}`]))}</div>
    </div>
    <div class="card">
      <div class="card-h"><div><h2>Every case</h2><p>Tap a case to read the transcript</p></div></div>
      <div id="cgrid">${Object.entries(CATS).map(([k, n]) => { const ids = o.case_ids.filter(c => c[0] === k); const c = s.by_category[k] || { passed: 0, total: 0 }; return html`
        <div class="cgrid-group"><h3><span>${k} · ${n}</span><span class="muted">${c.passed}/${c.total}</span></h3><div class="cgrid">${ids.map(cid => {
          const cs = byId[cid], g = cs ? GRADE_CODE[gradeOf(cs)] : ".", info = GRADES[g];
          return html`<a class="ctile c-${g === "." ? "_" : g}" href="${cs ? `#/run/${enc(id)}/${cid}` : `#/case/${cid}`}" data-c="${cid}" aria-label="${cid}: ${info.label}"><span>${cid}</span><span class="gl">${info.icon}</span></a>`; })}</div></div>`; })}</div>
      <div style="margin-top:12px">${gradeLegend()}</div>
    </div>
  </div>

  <div class="card" style="margin-top:12px">
    <div class="card-h"><div><h2>Per case</h2><p>Grouped by category; tap a column for the transcript</p></div>
      <div class="right"><div class="seg" id="metric">${Object.entries(METRICS).map(([k, [l]]) => html`<button type="button" data-k="${k}" aria-pressed="${k === metric}">${l}</button>`)}</div></div></div>
    <div id="cols"></div>
  </div>

  <div class="section-title"><h2>Where it went wrong</h2><span class="hint">${misses.length} of ${cases.length} cases</span></div>
  ${misses.length ? html`<div class="card flush"><div class="list">${misses.map(c => html`
    <a class="li" href="#/run/${enc(id)}/${c.case_id}">
      <span class="mono" style="min-width:34px;font-weight:650">${c.case_id}</span>
      <span class="main"><div class="t1">${c.request}</div><div class="t2 clamp">${c.divergence}</div></span>
      <span class="side-v">${gradePill(gradeOf(c))}<small>${outcomeLabel(c.outcome)}</small></span>
    </a>`)}</div></div>` : html`<div class="card empty"><b>Nothing.</b>Every case passed.</div>`}
  `);

  const drawCols = () => {
    const [, get, fmt] = METRICS[metric];
    caseColumns(ctx.main.querySelector("#cols"), rows.map(r => ({ ...r, v: get(r) ?? null })), {
      fmt, onPick: r => r.g !== "." && ctx.go(`#/run/${enc(id)}/${r.id}`),
      tipExtra: r => html`<div class="tm">“${o.caseById[r.id]?.request}”</div>`,
    });
  };
  drawCols();
  ctx.main.querySelector("#metric").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    metric = b.dataset.k;
    ctx.main.querySelectorAll("#metric button").forEach(x => x.setAttribute("aria-pressed", x === b));
    drawCols();
  });
  bindTip(ctx.main.querySelector("#cgrid"), ".ctile", el => {
    const c = byId[el.dataset.c];
    return html`<div class="tl"><b>${el.dataset.c}</b> · ${c ? GRADES[GRADE_CODE[gradeOf(c)]].label : "Not run"}</div><div class="tm">“${o.caseById[el.dataset.c]?.request}”</div>${c ? html`<div class="tm">${c.divergence}</div>` : ""}`;
  });
  bindTip(ctx.main, ".stack span", el => html`<div class="tl">${el.dataset.tip}</div>`);
}
