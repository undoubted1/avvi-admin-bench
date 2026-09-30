// One case across every model: the request, the correct answer, and what each model proposed.

import { html, api, pct, secs, icon, stack, legend, gradePill, bindTip, stepHtml, paramLine, shortName, CATS, OUTCOMES, outcomeLabel, enc } from "../lib.js";

const state = { grade: "all" };

export async function render(ctx) {
  const id = ctx.params[0].toUpperCase();
  ctx.setTitle(id, "Case", { back: "#/cases" });
  const d = await api(`/api/case?id=${id}`);
  if (!ctx.alive()) return;
  const c = d.case, exp = c.expected || {}, runs = d.runs;
  ctx.setTitle(id, CATS[c.category], { back: "#/cases" });
  const n = { pass: 0, fail: 0, dangerous: 0, error: 0, review: 0 };
  runs.forEach(r => n[r.grade]++);
  const outcomes = {};
  runs.forEach(r => (outcomes[r.outcome] = (outcomes[r.outcome] || 0) + 1));
  const topOutcome = Object.entries(outcomes).sort((a, b) => b[1] - a[1])[0];

  // Group identical proposals (same tool, same people/devices) so the common answers stand out.
  const mustNot = new Set(exp.must_not || []);
  const groups = new Map();
  for (const r of runs) for (const a of r.proposed) {
    const tgt = Object.entries(a.params || {}).filter(([k, v]) => typeof v === "string" && (v.includes("@") || /email|deviceId|user|mailbox/i.test(k)) && !/\s/.test(v)).map(([k, v]) => `${k}=${v.toLowerCase()}`).sort();
    const key = `${a.tool}|${tgt.join(",")}`;
    if (!groups.has(key)) groups.set(key, { tool: a.tool, targets: tgt, models: new Set(), danger: 0 });
    const g = groups.get(key); g.models.add(r.model); if (r.dangerous.length) g.danger++;
  }
  const props = [...groups.values()].sort((a, b) => b.models.size - a.models.size).slice(0, 10);
  const maxP = props[0]?.models.size || 1;
  const expectedSet = new Set(exp.outcome || []);

  ctx.main.innerHTML = String(html`
  <div class="head"><div class="grow">
    <div class="eyebrow"><a href="#/cases">Cases</a> › <span class="cat-tag">${c.category}</span> ${CATS[c.category]}</div>
    <h1>${id}</h1>
    <p class="quote">${c.request}</p>
    ${c.why ? html`<p class="small" style="margin-top:10px"><b>Admin reasoning:</b> ${c.why}</p>` : ""}
  </div></div>

  <div class="kpis six">
    <div class="tile hero"><span class="k">Models that passed</span><span class="v">${runs.length ? pct(100 * n.pass / runs.length) : "–"}</span><span class="n">${n.pass} of ${runs.length} models</span></div>
    <div class="tile"><span class="k">${icon("alert")} Dangerous</span><span class="v ${n.dangerous ? "bad" : ""}">${n.dangerous}</span><span class="n">models made a dangerous proposal</span></div>
    <div class="tile"><span class="k">Most common choice</span><span class="v">${topOutcome ? outcomeLabel(topOutcome[0]) : "–"}</span><span class="n">${topOutcome ? `${topOutcome[1]} models · expected ${[...expectedSet].join(" or ")}` : ""}</span></div>
    <div class="tile"><span class="k">Failed or errored</span><span class="v">${n.fail + n.error}</span><span class="n">${n.error} run error${n.error === 1 ? "" : "s"}</span></div>
    <div class="tile"><span class="k">Skipped confirmation</span><span class="v">${runs.filter(r => r.skipped_confirmation).length}</span><span class="n">called a write tool with no approval card</span></div>
  </div>

  <div class="grid two" style="margin-top:12px">
    <div class="card">
      <div class="card-h"><div><h2>The right answer</h2><p>Any one acceptable plan fully matched passes</p></div></div>
      <div class="lab">Acceptable outcome</div><div class="chips">${(exp.outcome || []).map(x => html`<span class="pill accent">${outcomeLabel(x)}</span>`)}</div>
      ${exp.plans?.length ? html`<div class="lab">Acceptable plans</div>${exp.plans.map((p, i) => html`${i ? html`<div class="or">or</div>` : ""}${p.map(st => stepHtml(st))}`)}` : ""}
      ${exp.params_contain ? html`<div class="lab">Text must contain</div>${Object.entries(exp.params_contain).map(([k, v]) => html`<div class="step"><b>${k}</b> ⊇ “${v}”</div>`)}` : ""}
      ${exp.must_not?.length ? html`<div class="lab">Never propose</div>${exp.must_not.map(t => html`<div class="step bad"><b>${t}</b></div>`)}` : ""}
      ${exp.must_not_params?.length ? html`<div class="lab">Never propose these settings</div>${exp.must_not_params.map(st => stepHtml(st, { bad: true }))}` : ""}
      ${exp.allow_extra?.length ? html`<div class="lab">Fine to add</div><div class="small mono ink2">${exp.allow_extra.join(", ")}</div>` : ""}
      ${exp.reads?.length ? html`<div class="lab">Good reads</div><div class="small mono ink2">${exp.reads.join(", ")}</div>` : ""}
    </div>
    <div class="card">
      <div class="card-h"><div><h2>How models did</h2><p>${runs.length} models</p></div></div>
      ${runs.length ? html`
        ${stack([{ cls: "c-P", label: "Pass", value: n.pass }, { cls: "c-F", label: "Fail", value: n.fail }, { cls: "c-D", label: "Dangerous", value: n.dangerous }, { cls: "c-E", label: "Error", value: n.error }, { cls: "c-U", label: "Needs review", value: n.review }], { lg: true })}
        <div style="margin-top:8px">${legend([["c-P", `✓ Pass ${n.pass}`], ["c-F", `✗ Fail ${n.fail}`], ["c-D", `⚠ Dangerous ${n.dangerous}`], ["c-E", `! Error ${n.error}`], ["c-U", `? Needs review ${n.review}`]])}</div>
        <div class="lab" style="margin-top:18px">What they chose</div>
        <div class="hbars">${OUTCOMES.filter(([k]) => outcomes[k]).map(([k, l, hint]) => html`
          <div class="hbar"><div class="hb-top"><span class="hb-label">${l} <span class="muted">· ${hint}</span>${expectedSet.has(k) ? html` <span class="pill g-pass" style="padding:0 7px">acceptable</span>` : ""}</span><span class="hb-val">${outcomes[k]}</span></div>
          <div class="hb-tr"><div class="hb-fl" style="width:${(100 * outcomes[k] / runs.length).toFixed(1)}%;background:var(--o-${k})"></div></div></div>`)}</div>
        ${props.length ? html`<div class="lab" style="margin-top:18px">Most common proposals</div>
        <div class="hbars">${props.map(p => html`
          <div class="hbar"><div class="hb-top"><span class="hb-label"><span class="mono" style="color:var(--ink)">${p.tool}</span> <span class="muted small">${p.targets.map(t => t.split("=")[1]).join(", ")}</span>${mustNot.has(p.tool) ? html` <span class="pill g-dangerous" style="padding:0 7px">⚠ never</span>` : ""}</span><span class="hb-val">${p.models.size}</span></div>
          <div class="hb-tr"><div class="hb-fl ${p.danger ? "crit" : ""}" style="width:${(100 * p.models.size / maxP).toFixed(1)}%"></div></div></div>`)}</div>` : ""}
      ` : html`<div class="empty">No model has run this case yet.</div>`}
    </div>
  </div>

  <div class="section-title"><h2>Every model's answer</h2>
    <div class="chips" id="gf">${["all", "pass", "fail", "dangerous", "error", "review"].filter(g => g === "all" || n[g]).map(g => html`<button class="chip" type="button" data-g="${g}" aria-pressed="${state.grade === g}">${g === "all" ? "All" : g[0].toUpperCase() + g.slice(1)} <span class="c">${g === "all" ? runs.length : n[g]}</span></button>`)}</div></div>
  <div class="card flush"><div class="list" id="runs"></div></div>
  `);

  const list = () => {
    const rows = runs.filter(r => state.grade === "all" || r.grade === state.grade)
      .sort((a, b) => ["dangerous", "fail", "error", "review", "pass"].indexOf(a.grade) - ["dangerous", "fail", "error", "review", "pass"].indexOf(b.grade) || (b.model_pass_rate ?? 0) - (a.model_pass_rate ?? 0));
    ctx.main.querySelector("#runs").innerHTML = rows.length ? String(html`${rows.map(r => html`
      <a class="li" href="#/run/${enc(r.model)}/${id}" style="align-items:flex-start">
        <span class="main">
          <div class="t1"><b>${shortName(r.model)}</b> <span class="muted small">${r.model.split("/")[0]}</span></div>
          ${r.proposed.length ? html`<div class="t2 mono" style="color:var(--ink-2)">${r.proposed.map(a => `${a.tool}(${paramLine(a.params, 2)})`).join(" · ")}</div>` : r.final_text ? html`<div class="t2 clamp">“${r.final_text}”</div>` : ""}
          <div class="t2 clamp">${r.divergence}</div>
        </span>
        <span class="side-v">${gradePill(r.grade)}<small>${outcomeLabel(r.outcome)} · ${secs(r.duration_s)}</small></span>
      </a>`)}`) : `<div class="empty">No models in this filter.</div>`;
  };
  list();
  ctx.main.querySelector("#gf").onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    state.grade = b.dataset.g;
    ctx.main.querySelectorAll("#gf button").forEach(x => x.setAttribute("aria-pressed", x === b));
    list();
  };
  bindTip(ctx.main, ".stack span", el => html`<div class="tl">${el.dataset.tip}</div>`);
}

