// All 42 cases: how every model did on each, as a list or as a models × cases matrix.

import { html, pct, icon, stack, gradeLegend, bindTip, CATS, enc } from "../lib.js";
import { heatMatrix } from "../charts.js";
import { board, signature } from "../data.js";

const state = { cat: "", q: "", sort: "id", view: "list" };
let stopMatrix = null;

export async function render(ctx) {
  ctx.setTitle("Cases", "42 requests from the office manager");
  if (ctx.query.view) state.view = ctx.query.view;
  let o = await board(), sig = signature(o);
  paint(ctx, o);
  ctx.poll(async () => { const n = await board(); if (signature(n) !== sig && ctx.alive()) { o = n; sig = signature(n); paint(ctx, o); } }, 20000);
}

function paint(ctx, o) {
  ctx.main.innerHTML = String(html`
  <div class="head"><div class="grow"><div class="eyebrow">Test cases</div><h1>${o.case_ids.length} requests</h1>
    <p>Each request comes from Tom, the office manager, who is not an IT professional. Some are routine, some risky, some ambiguous, and some should be refused or escalated.</p></div>
    <div class="seg" id="view"><button type="button" data-v="list" aria-pressed="${state.view === "list"}">List</button><button type="button" data-v="matrix" aria-pressed="${state.view === "matrix"}">Matrix</button></div>
  </div>
  <div class="filters">
    <div class="chips" id="cats"><button class="chip" type="button" data-k="" aria-pressed="${!state.cat}">All <span class="c">${o.case_ids.length}</span></button>${Object.entries(CATS).map(([k, n]) => html`<button class="chip" type="button" data-k="${k}" aria-pressed="${state.cat === k}">${k} · ${n} <span class="c">${o.case_ids.filter(c => c[0] === k).length}</span></button>`)}</div>
    <label class="search grow">${icon("search")}<input class="input" id="q" type="search" placeholder="Search requests" value="${state.q}" autocomplete="off"></label>
    <select class="select" id="sort" aria-label="Sort"><option value="id" ${state.sort === "id" ? "selected" : ""}>By id</option><option value="hard" ${state.sort === "hard" ? "selected" : ""}>Hardest first</option><option value="danger" ${state.sort === "danger" ? "selected" : ""}>Most dangerous</option></select>
  </div>
  <div id="body"></div>`);
  const $m = s => ctx.main.querySelector(s);
  $m("#view").onclick = e => { const b = e.target.closest("button"); if (!b) return; state.view = b.dataset.v; $m("#view").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b)); body(ctx, o); };
  $m("#cats").onclick = e => { const b = e.target.closest("button"); if (!b) return; state.cat = b.dataset.k; $m("#cats").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b)); body(ctx, o); };
  $m("#q").oninput = e => { state.q = e.target.value; body(ctx, o); };
  $m("#sort").onchange = e => { state.sort = e.target.value; body(ctx, o); };
  bindTip($m("#body"), ".stack span", s => html`<div class="tl">${s.dataset.tip}</div>`);
  ctx.onCleanup(() => { stopMatrix?.(); stopMatrix = null; });
  body(ctx, o);
}

function filtered(o) {
  const q = state.q.trim().toLowerCase();
  const list = o.perCase.filter(c => (!state.cat || c.id[0] === state.cat) && (!q || c.request.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)));
  if (state.sort === "hard") list.sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101) || b.n.D - a.n.D);
  if (state.sort === "danger") list.sort((a, b) => b.n.D - a.n.D || (a.rate ?? 101) - (b.rate ?? 101));
  return list;
}

function body(ctx, o) {
  const el = ctx.main.querySelector("#body"), list = filtered(o);
  stopMatrix?.(); stopMatrix = null;
  if (state.view === "matrix") {
    if (!o.models.length) { el.innerHTML = `<div class="card empty"><b>No scored models yet.</b></div>`; return; }
    const ids = list.map(c => c.id), idx = ids.map(id => o.case_ids.indexOf(id));
    const rows = o.ranked.map(m => ({ model: m.model, grades: idx.map(i => m.grades[i]).join("") }));
    el.innerHTML = String(html`<div class="card"><div class="card-h"><div><h2>Every model × every case</h2><p>Rows ranked by pass rate. Tap a name for the model, a case id for the case, a cell for the transcript.</p></div></div>
      <div style="margin-bottom:10px">${gradeLegend(["P", "F", "D", "E", "U", "."])}</div><div class="matrix-wrap"><div id="matrix"></div></div></div>`);
    stopMatrix = heatMatrix(el.querySelector("#matrix"), rows, ids, o.caseById, {
      onCell: (m, id, g) => g !== "." && ctx.go(`#/run/${enc(m)}/${id}`), onRow: m => ctx.go(`#/model/${enc(m)}`), onCol: id => ctx.go(`#/case/${id}`),
    });
    return;
  }
  el.innerHTML = list.length ? String(html`<div class="card flush"><div class="list">${list.map(c => html`
    <a class="li" href="#/case/${c.id}" style="align-items:flex-start">
      <span class="cat-tag" style="margin-top:2px">${c.id}</span>
      <span class="main">
        <div class="clamp2" style="font-weight:520">${c.request}</div>
        <div class="t2">Expected: ${c.expected_outcome.join(" or ")}${c.ran ? html` · ${c.ran} models ran it` : ""}</div>
        ${c.ran ? html`<div style="margin-top:8px;max-width:520px">${stack([
          { cls: "c-P", label: "Pass", value: c.n.P }, { cls: "c-F", label: "Fail", value: c.n.F },
          { cls: "c-D", label: "Dangerous", value: c.n.D }, { cls: "c-E", label: "Error", value: c.n.E }, { cls: "c-U", label: "Needs review", value: c.n.U }])}</div>` : ""}
      </span>
      <span class="side-v"><b>${c.rate == null ? "–" : pct(c.rate)}</b><small>passed</small>${c.n.D ? html`<small class="bad">⚠ ${c.n.D}</small>` : ""}</span>
    </a>`)}</div></div><div style="margin-top:10px">${gradeLegend()}</div>`) : `<div class="card empty"><b>No cases match.</b></div>`;
}
