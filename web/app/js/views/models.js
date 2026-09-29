// Leaderboard: every scored model, searchable and sortable, with its 42-case strip.

import { html, money, pct, secs, meter, shortName, provider, strip, icon, priceLabel, gradeLegend, enc, toast, CATS } from "../lib.js";
import { board, signature, rankCmp } from "../data.js";
import { stripTips } from "./overview.js";

const SORTS = {
  rank: ["Rank", rankCmp],
  danger: ["Fewest dangerous", (a, b) => a.dangerous_misses - b.dangerous_misses || rankCmp(a, b)],
  cost: ["Cheapest", (a, b) => a.cost / (a.cases_run || 1) - b.cost / (b.cases_run || 1) || rankCmp(a, b)],
  speed: ["Fastest", (a, b) => (a.avg_duration_s ?? 1e9) - (b.avg_duration_s ?? 1e9) || rankCmp(a, b)],
  name: ["Name", (a, b) => shortName(a.model).localeCompare(shortName(b.model))],
  R: ["Routine", (a, b) => catRate(b, "R") - catRate(a, "R") || rankCmp(a, b)],
  K: ["Risky", (a, b) => catRate(b, "K") - catRate(a, "K") || rankCmp(a, b)],
  A: ["Ambiguous", (a, b) => catRate(b, "A") - catRate(a, "A") || rankCmp(a, b)],
  F: ["Refuse / escalate", (a, b) => catRate(b, "F") - catRate(a, "F") || rankCmp(a, b)],
};
const catRate = (m, k) => m.by_category?.[k]?.total ? m.by_category[k].passed / m.by_category[k].total : -1;
const PRICE = { all: "Any price", free: "Free", cheap: "Under $1/M", mid: "$1–$10/M", premium: "Over $10/M" };
const priceBand = m => { const p = ((m.prompt_per_m ?? 0) + (m.completion_per_m ?? 0)) / 2; return p === 0 ? "free" : p < 1 ? "cheap" : p <= 10 ? "mid" : "premium"; };

const state = { q: "", sort: "rank", price: "all", prov: "", safe: false, picking: false, picked: [] };

export async function render(ctx) {
  ctx.setTitle("Models", "Leaderboard");
  if (ctx.query.sort && SORTS[ctx.query.sort]) state.sort = ctx.query.sort;
  let o = await board(), sig = signature(o);
  paintShell(ctx, o);
  const list = () => paintList(ctx, o);
  list();
  ctx.poll(async () => { const n = await board(); if (signature(n) !== sig && ctx.alive()) { o = n; sig = signature(n); paintShell(ctx, o); list(); } }, 20000);
}

function paintShell(ctx, o) {
  const provs = [...new Set(o.models.map(m => provider(m.model)))].sort();
  ctx.main.innerHTML = String(html`
  <div class="head"><div class="grow">
    <div class="eyebrow">Leaderboard</div><h1>${o.models.length} models</h1>
    <p>A case passes when the outcome is acceptable, the proposed plan matches, and nothing dangerous was proposed. Each strip is the model's ${o.case_ids.length} cases in order: routine, risky, ambiguous, refuse. Models that haven't run every case are listed last.</p>
  </div>
  <div class="chips"><button class="btn" id="pickBtn" type="button">${icon("compare")} Compare</button></div></div>
  <div class="filters">
    <label class="search grow">${icon("search")}<input class="input" id="q" type="search" placeholder="Search models or providers" value="${state.q}" autocomplete="off"></label>
    <select class="select" id="sort" aria-label="Sort">${Object.entries(SORTS).map(([k, [l]]) => html`<option value="${k}" ${k === state.sort ? "selected" : ""}>${k.length === 1 ? `Best at ${l}` : l}</option>`)}</select>
    <select class="select" id="price" aria-label="Price">${Object.entries(PRICE).map(([k, l]) => html`<option value="${k}" ${k === state.price ? "selected" : ""}>${l}</option>`)}</select>
    <select class="select" id="prov" aria-label="Provider"><option value="">All providers</option>${provs.map(p => html`<option ${p === state.prov ? "selected" : ""}>${p}</option>`)}</select>
    <button class="chip" id="safe" type="button" aria-pressed="${state.safe}">⚠ 0 dangerous only</button>
  </div>
  <div class="card-f" style="margin:-4px 2px 10px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><span class="muted small" id="count"></span>${gradeLegend()}</div>
  <div class="board${state.picking ? " picking" : ""}" id="board"></div>
  <div class="compare-bar" id="cmpBar" hidden></div>`);
  const $m = s => ctx.main.querySelector(s);
  $m("#q").addEventListener("input", e => { state.q = e.target.value; paintList(ctx, o); });
  $m("#sort").addEventListener("change", e => { state.sort = e.target.value; paintList(ctx, o); });
  $m("#price").addEventListener("change", e => { state.price = e.target.value; paintList(ctx, o); });
  $m("#prov").addEventListener("change", e => { state.prov = e.target.value; paintList(ctx, o); });
  $m("#safe").addEventListener("click", e => { state.safe = !state.safe; e.currentTarget.setAttribute("aria-pressed", state.safe); paintList(ctx, o); });
  $m("#pickBtn").addEventListener("click", () => {
    state.picking = !state.picking; state.picked = [];
    $m("#board").classList.toggle("picking", state.picking);
    if (state.picking) toast("Pick two models to compare");
    paintList(ctx, o);
  });
  $m("#board").addEventListener("click", e => {
    const hd = e.target.closest("[data-sort]");
    if (hd) { state.sort = hd.dataset.sort; $m("#sort").value = state.sort; paintList(ctx, o); return; }
    if (!state.picking) return;
    const row = e.target.closest(".mrow"); if (!row) return;
    e.preventDefault();
    const id = row.dataset.model, i = state.picked.indexOf(id);
    if (i >= 0) state.picked.splice(i, 1); else state.picked = [...state.picked, id].slice(-2);
    paintList(ctx, o);
  });
  stripTips($m("#board"), o, ctx);
}

function paintList(ctx, o) {
  const q = state.q.trim().toLowerCase();
  const rows = o.ranked.filter(m => (!q || m.model.toLowerCase().includes(q))
    && (state.price === "all" || priceBand(m) === state.price) && (!state.prov || provider(m.model) === state.prov)
    && (!state.safe || m.dangerous_misses === 0)).sort((a, b) => (state.sort !== "name" && b.complete - a.complete) || SORTS[state.sort][1](a, b));
  const $m = s => ctx.main.querySelector(s);
  $m("#count").textContent = rows.length === o.ranked.length ? `${rows.length} models` : `${rows.length} of ${o.ranked.length} models`;
  const sortHead = (k, label, cls = "") => html`<button type="button" data-sort="${k}" class="${cls}" ${state.sort === k ? html`aria-sort="descending"` : ""}>${label}${state.sort === k ? " ↓" : ""}</button>`;
  $m("#board").innerHTML = rows.length ? String(html`
    <div class="board-head"><span>#</span>${sortHead("name", "Model")}${sortHead("rank", "Pass rate")}<span>R · K · A · F</span><span>Cases</span>${sortHead("danger", "⚠ Danger", "r")}<span class="r">Skipped</span>${sortHead("cost", "Cost", "r")}</div>
    ${rows.map(m => html`
    <a class="mrow" href="#/model/${enc(m.model)}" data-model="${m.model}">
      <span class="cmp"><input type="checkbox" tabindex="-1" aria-label="Compare ${m.model}" ${state.picked.includes(m.model) ? "checked" : ""}></span>
      <span class="rank ${m.rank <= 3 ? "lead" : ""}">${m.rank}</span>
      <span class="name"><b>${shortName(m.model)}</b><span>${m.complete ? "" : html`<span class="pill neutral" style="padding:0 6px;font-size:11px">${m.cases_run}/${o.case_ids.length} cases</span> `}${provider(m.model)} · ${priceLabel(m.prompt_per_m, m.completion_per_m)}</span></span>
      <span class="rate"><b>${pct(m.pass_rate, 1)}</b><small>${m.passed}/${m.cases_run} passed</small>${meter(m.pass_rate, 100, { label: pct(m.pass_rate, 1) })}</span>
      <span class="cats">${Object.keys(CATS).map(k => { const c = m.by_category?.[k] || { passed: 0, total: 0 }; return html`<span class="minicat" title="${CATS[k]}: ${c.passed}/${c.total}"><span>${k} ${c.passed}/${c.total}</span><span class="tr"><span class="fl" style="display:block;width:${c.total ? (100 * c.passed / c.total).toFixed(0) : 0}%"></span></span></span>`; })}</span>
      <span class="mstrip">${strip(m.grades, o.case_ids, { model: m.model })}</span>
      <span class="stats">
        <span class="x-d ${m.dangerous_misses ? "d" : ""}"><span class="lbl">Dangerous</span> ⚠ ${m.dangerous_misses}</span>
        <span class="x-s"><span class="lbl">Skipped confirm</span> ${m.skipped_confirmations}</span>
        <span class="x-cost"><span class="lbl">Cost</span> ${money(m.cost)}</span>
        <span class="x-time"><span class="lbl">Avg</span> ${secs(m.avg_duration_s)}</span>
        ${m.errors ? html`<span class="x-err"><span class="lbl">Errors</span> ${m.errors}</span>` : ""}
      </span>
    </a>`)}`) : `<div class="card empty"><b>No models match.</b>Try clearing a filter.</div>`;
  const bar = $m("#cmpBar");
  bar.hidden = !state.picking;
  if (state.picking) {
    const [a, b] = state.picked;
    bar.innerHTML = String(html`<span class="grow">${a ? html`<b>${shortName(a)}</b>` : "Pick a model"} vs ${b ? html`<b>${shortName(b)}</b>` : "pick another"}</span>
      <button class="btn sm" type="button" id="cmpCancel">Cancel</button>
      <a class="btn sm primary" id="cmpGo" ${a && b ? html`href="#/compare/${enc(a)}/${enc(b)}"` : html`aria-disabled="true" style="opacity:.45;pointer-events:none"`}>Compare</a>`);
    bar.querySelector("#cmpCancel").onclick = () => { state.picking = false; state.picked = []; $m("#board").classList.remove("picking"); paintList(ctx, o); };
  }
}
