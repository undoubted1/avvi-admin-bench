// Head to head: two models' numbers side by side and every case where they disagree.

import { html, money, pct, secs, shortName, strip, gradePill, legend, GRADES, CATS, enc } from "../lib.js";
import { board } from "../data.js";
import { stripTips } from "./overview.js";

export async function render(ctx) {
  const o = await board();
  if (!ctx.alive()) return;
  let [a, b] = ctx.params;
  if (!a || !b || !o.byModel[a] || !o.byModel[b]) {
    a = o.byModel[a] ? a : o.ranked[0]?.model; b = o.byModel[b] && b !== a ? b : o.ranked.find(m => m.model !== a)?.model;
    if (a && b) { history.replaceState(null, "", `#/compare/${enc(a)}/${enc(b)}`); }
  }
  ctx.setTitle("Compare", a && b ? `${shortName(a)} vs ${shortName(b)}` : "", { back: "#/models" });
  if (!a || !b) { ctx.main.innerHTML = `<div class="card empty"><b>Need at least two scored models.</b></div>`; return; }
  const A = o.byModel[a], B = o.byModel[b];
  const opts = sel => html`${o.ranked.map(m => html`<option value="${m.model}" ${m.model === sel ? "selected" : ""}>${m.rank}. ${shortName(m.model)} (${pct(m.pass_rate)})</option>`)}`;
  const diffs = o.case_ids.map((id, i) => ({ id, i, ga: A.grades[i], gb: B.grades[i] })).filter(d => d.ga !== d.gb);
  const both = o.case_ids.filter((_, i) => A.grades[i] === "P" && B.grades[i] === "P").length;
  const onlyA = o.case_ids.filter((_, i) => A.grades[i] === "P" && B.grades[i] !== "P").length;
  const onlyB = o.case_ids.filter((_, i) => B.grades[i] === "P" && A.grades[i] !== "P").length;
  const neither = o.case_ids.length - both - onlyA - onlyB;
  const better = (x, y, lower) => x === y ? "" : (lower ? x < y : x > y) ? "win" : "";
  const rowsDef = [
    ["Pass rate", m => pct(m.pass_rate, 1), m => m.pass_rate, false],
    ["Dangerous misses", m => m.dangerous_misses, m => m.dangerous_misses, true],
    ["Skipped confirmations", m => m.skipped_confirmations, m => m.skipped_confirmations, true],
    ["Errors", m => m.errors, m => m.errors, true],
    ["Cost (all cases)", m => money(m.cost), m => m.cost, true],
    ["Avg time per case", m => secs(m.avg_duration_s), m => m.avg_duration_s ?? 1e9, true],
    ...Object.entries(CATS).map(([k, n]) => [`${k} · ${n}`, m => `${m.by_category[k]?.passed ?? 0}/${m.by_category[k]?.total ?? 0}`, m => (m.by_category[k]?.passed ?? 0) / (m.by_category[k]?.total || 1), false]),
  ];

  ctx.main.innerHTML = String(html`
  <div class="head"><div class="grow"><div class="eyebrow"><a href="#/models">Leaderboard</a> › Compare</div><h1>Head to head</h1></div></div>
  <div class="grid two">
    <label class="card" style="display:flex;gap:10px;align-items:center"><i class="legend-sw" style="width:12px;height:12px;border-radius:3px;background:var(--accent);flex:none"></i><select class="select" id="selA" style="flex:1;width:100%">${opts(a)}</select></label>
    <label class="card" style="display:flex;gap:10px;align-items:center"><i class="legend-sw" style="width:12px;height:12px;border-radius:3px;background:var(--s2);flex:none"></i><select class="select" id="selB" style="flex:1;width:100%">${opts(b)}</select></label>
  </div>

  <div class="kpis" style="margin-top:12px">
    <div class="tile"><span class="k">Both passed</span><span class="v">${both}</span><span class="n">of ${o.case_ids.length} cases</span></div>
    <div class="tile"><span class="k">Only ${shortName(a)}</span><span class="v">${onlyA}</span><span class="n">passed where the other didn't</span></div>
    <div class="tile"><span class="k">Only ${shortName(b)}</span><span class="v">${onlyB}</span><span class="n">passed where the other didn't</span></div>
    <div class="tile"><span class="k">Neither</span><span class="v">${neither}</span><span class="n">both missed</span></div>
  </div>

  <div class="grid two" style="margin-top:12px">
    <div class="card flush"><div class="scroll-x"><table class="tbl">
      <thead><tr><th></th><th class="r">${shortName(a)}</th><th class="r">${shortName(b)}</th></tr></thead>
      <tbody>${rowsDef.map(([l, f, v, lower]) => html`<tr><td class="ink2">${l}</td>
        <td class="r" style="${better(v(A), v(B), lower) ? "font-weight:700" : ""}">${f(A)}</td>
        <td class="r" style="${better(v(B), v(A), lower) ? "font-weight:700" : ""}">${f(B)}</td></tr>`)}</tbody></table></div>
      <div class="small muted" style="padding:10px 16px 14px">Bold is better.</div></div>
    <div class="card">
      <div class="card-h"><div><h2>By category</h2><p>Pass rate per category</p></div></div>
      <div class="hbars">${Object.entries(CATS).map(([k, n]) => html`
        <div class="hbar"><div class="hb-top"><span class="hb-label"><b>${k}</b> · ${n}</span><span class="hb-val">${pct(rate(A, k))} · ${pct(rate(B, k))}</span></div>
          <div class="hb-tr"><div class="hb-fl" style="width:${Math.max(0.5, rate(A, k))}%"></div></div>
          <div class="hb-tr"><div class="hb-fl" style="width:${Math.max(0.5, rate(B, k))}%;background:var(--s2)"></div></div></div>`)}</div>
      <div style="margin-top:12px">${legend([["", shortName(a), "background:var(--accent)"], ["", shortName(b), "background:var(--s2)"]])}</div>
    </div>
  </div>

  <div class="card" style="margin-top:12px" id="strips">
    <div class="card-h"><div><h2>All ${o.case_ids.length} cases</h2><p>Routine, risky, ambiguous, refuse</p></div></div>
    <div class="small ink2" style="margin-bottom:4px"><b>${shortName(a)}</b></div>${strip(A.grades, o.case_ids, { model: a, lg: true })}
    <div class="small ink2" style="margin:10px 0 4px"><b>${shortName(b)}</b></div>${strip(B.grades, o.case_ids, { model: b, lg: true })}
  </div>

  <div class="section-title"><h2>Where they disagree</h2><span class="hint">${diffs.length} case${diffs.length === 1 ? "" : "s"}</span></div>
  ${diffs.length ? html`<div class="card flush"><div class="list">${diffs.map(d => html`
    <a class="li" href="#/case/${d.id}">
      <span class="cat-tag">${d.id}</span>
      <span class="main"><div class="t1">${o.caseById[d.id]?.request}</div></span>
      <span class="side-v" style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${gradePill(GRADES[d.ga].key)}${gradePill(GRADES[d.gb].key)}</span>
    </a>`)}</div></div>` : html`<div class="card empty"><b>They agree on every case.</b></div>`}
  `);
  const go = () => ctx.go(`#/compare/${enc(ctx.main.querySelector("#selA").value)}/${enc(ctx.main.querySelector("#selB").value)}`);
  ctx.main.querySelector("#selA").onchange = go;
  ctx.main.querySelector("#selB").onchange = go;
  stripTips(ctx.main.querySelector("#strips"), o, ctx);
}
const rate = (m, k) => m.by_category[k]?.total ? 100 * m.by_category[k].passed / m.by_category[k].total : 0;

