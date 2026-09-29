// Hand-rolled SVG/HTML charts. No libraries and no network. Every chart has hover and
// keyboard tooltips; on touch the first tap shows the tooltip and the second opens the item.

import { html, esc, showTip, hideTip, money, pct, shortName, GRADES, gcls, CATS } from "./lib.js";

const NS = "http://www.w3.org/2000/svg";
const widthOf = el => Math.max(260, Math.floor(el.getBoundingClientRect().width || el.parentElement?.getBoundingClientRect().width || 320));

// Re-render a width-dependent chart when its container resizes.
export function responsive(el, draw) {
  let w = 0;
  const run = () => { const nw = widthOf(el); if (Math.abs(nw - w) > 2) { w = nw; draw(nw); } };
  const ro = new ResizeObserver(() => requestAnimationFrame(run));
  ro.observe(el);
  run();
  return () => ro.disconnect();
}

const niceLog = v => {
  if (v >= 1) return `$${v % 1 ? v.toFixed(1) : v}`;
  const s = v.toFixed(Math.max(0, -Math.floor(Math.log10(v))));
  return `$${s.replace(/^0/, "0")}`;
};

// ------------------------------------------------------------------ accuracy vs cost scatter
// x: average cost per case (log), free models in their own band; y: pass rate.
// Emphasis form: the cost/accuracy frontier is blue, everything else recedes to gray.
export function costScatter(el, models, { onPick, highlight } = {}) {
  const pts = models.filter(m => m.cases_run > 0).map(m => ({ m, x: m.cost / m.cases_run, y: m.pass_rate }));
  if (!pts.length) { el.innerHTML = `<div class="empty">No scored models yet.</div>`; return () => {}; }
  // Frontier: walking from cheapest up, keep each model that beats every cheaper model's pass rate.
  const sorted = [...pts].sort((a, b) => a.x - b.x || b.y - a.y);
  let best = -1; const frontier = [];
  for (const p of sorted) if (p.y > best) { frontier.push(p); best = p.y; }
  const onF = new Set(frontier.map(p => p.m.model));

  const draw = W => {
    const H = W < 520 ? 250 : 300, m = { l: 40, r: 16, t: 14, b: 38 };
    const paid = pts.filter(p => p.x > 0).map(p => p.x);
    const hasFree = pts.some(p => p.x === 0);
    const freeW = hasFree ? 44 : 0;
    let lo = paid.length ? Math.pow(10, Math.floor(Math.log10(Math.min(...paid)))) : 1e-4;
    let hi = paid.length ? Math.pow(10, Math.ceil(Math.log10(Math.max(...paid)))) : 1e-2;
    if (hi / lo < 100) hi = lo * 100;
    const x0 = m.l + freeW + (hasFree ? 24 : 0), x1 = W - m.r, y0 = H - m.b, y1 = m.t;
    const sx = v => v === 0 ? m.l + freeW / 2 : x0 + (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) * (x1 - x0);
    const sy = v => y0 - (v / 100) * (y0 - y1);
    // Deterministic jitter inside the free band so free models don't stack into one dot.
    const jit = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return ((h % 1000) / 1000 - 0.5) * (freeW - 16); };
    pts.forEach(p => { p.px = p.x === 0 ? sx(0) + jit(p.m.model) : sx(p.x); p.py = sy(p.y); });

    const g = [];
    for (const t of [0, 25, 50, 75, 100]) g.push(`<line class="grid-l" x1="${m.l}" x2="${x1}" y1="${sy(t)}" y2="${sy(t)}"/><text class="tick" x="${m.l - 8}" y="${sy(t) + 4}" text-anchor="end">${t}%</text>`);
    if (hasFree) g.push(`<rect class="band" x="${m.l}" y="${y1}" width="${freeW}" height="${y0 - y1}" rx="6"/><text class="tick" x="${m.l + freeW / 2}" y="${y0 + 18}" text-anchor="middle">Free</text>`);
    for (let d = Math.log10(lo); d <= Math.log10(hi) + 1e-9; d++) {
      const v = Math.pow(10, d), x = sx(v);
      g.push(`<line class="grid-l" x1="${x}" x2="${x}" y1="${y1}" y2="${y0}"/><text class="tick" x="${x}" y="${y0 + 18}" text-anchor="middle">${niceLog(v)}</text>`);
    }
    g.push(`<line class="base-l" x1="${m.l}" x2="${x1}" y1="${y0}" y2="${y0}"/>`);
    g.push(`<text class="ax-title" x="${x1}" y="${H - 4}" text-anchor="end">Average cost per case →</text>`);
    const fr = frontier.filter(p => p.x > 0 || frontier.length === 1);
    if (fr.length > 1) g.push(`<path class="frontier" d="${fr.map((p, i) => `${i ? "L" : "M"}${p.px.toFixed(1)},${p.py.toFixed(1)}`).join("")}" opacity=".35"/>`);
    // Gray dots first, frontier dots on top.
    const order = [...pts].sort((a, b) => onF.has(a.m.model) - onF.has(b.m.model));
    for (const p of order) g.push(`<circle class="pt${onF.has(p.m.model) ? " em" : ""}${p.m.model === highlight ? " hl" : ""}" cx="${p.px.toFixed(1)}" cy="${p.py.toFixed(1)}" r="${onF.has(p.m.model) ? 5.5 : 4.5}"/>`);
    // Label only the leader (selective labelling).
    const top = [...pts].sort((a, b) => b.y - a.y || a.x - b.x)[0];
    if (top) {
      const anchor = top.px > W * 0.7 ? "end" : "start", dx = anchor === "end" ? -9 : 9;
      g.push(`<text class="dlabel" x="${top.px + dx}" y="${top.py - 9}" text-anchor="${anchor}">${esc(shortName(top.m.model))}</text>`);
    }
    g.push(`<circle class="xhair-ring" r="9" fill="none" stroke="var(--ink)" stroke-width="2" visibility="hidden"/>`);
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Pass rate against average cost per case for ${pts.length} models">${g.join("")}</svg>`;
  };
  const stop = responsive(el, draw);

  const nearest = e => {
    const r = el.querySelector("svg").getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 28 * 28;
    for (const p of pts) { const d = (p.px - x) ** 2 + (p.py - y) ** 2; if (d < bd) { bd = d; best = p; } }
    return best;
  };
  const tipFor = (p, withLink) => html`<div class="tv">${pct(p.y, 1)} pass</div><div class="tl"><b>${shortName(p.m.model)}</b> · ${p.m.model.split("/")[0]}</div>
    <div class="tm">${p.x === 0 ? "Free" : `${money(p.x)} per case`} · ${money(p.m.cost)} total<br>${p.m.dangerous_misses} dangerous · ${p.m.passed}/${p.m.cases_run} passed${onF.has(p.m.model) ? " · on the frontier" : ""}</div>
    ${withLink ? html`<a href="#/model/${encodeURIComponent(p.m.model)}">Open model →</a>` : ""}`;
  const ring = p => { const c = el.querySelector(".xhair-ring"); if (!c) return; if (p) { c.setAttribute("cx", p.px); c.setAttribute("cy", p.py); c.setAttribute("visibility", "visible"); } else c.setAttribute("visibility", "hidden"); };
  let tapped = null;
  el.onpointermove = e => { if (e.pointerType === "touch") return; const p = nearest(e); ring(p); if (p) { showTip(tipFor(p), e.clientX, e.clientY); el.style.cursor = "pointer"; } else { hideTip(); el.style.cursor = ""; } };
  el.onpointerleave = () => { ring(null); hideTip(); };
  el.onclick = e => {
    const p = nearest(e); if (!p) return;
    if (e.pointerType === "touch" || matchMedia("(hover: none)").matches) {
      if (tapped !== p) { tapped = p; ring(p); showTip(tipFor(p, true), e.clientX, e.clientY, { interactive: true }); return; }
    }
    hideTip(); onPick?.(p.m.model);
  };
  return stop;
}

// ------------------------------------------------------------------ distribution strip per category
// One row per category: every model is a gray dot at its pass rate, the median is a black tick,
// and one emphasized model (the leader, or the model being viewed) is blue.
export function categoryStrips(el, models, { emphasize, onPick } = {}) {
  const rows = Object.keys(CATS).map(k => ({
    k, pts: models.filter(m => m.by_category?.[k]?.total).map(m => ({ m, v: 100 * m.by_category[k].passed / m.by_category[k].total })),
  }));
  const draw = W => {
    const lw = W < 520 ? 92 : 132, rowH = 38, m = { t: 6, r: 14, b: 26 }, H = m.t + rows.length * rowH + m.b;
    const x0 = lw, x1 = W - m.r, sx = v => x0 + (v / 100) * (x1 - x0);
    const g = [];
    for (const t of [0, 25, 50, 75, 100]) g.push(`<line class="grid-l" x1="${sx(t)}" x2="${sx(t)}" y1="${m.t}" y2="${H - m.b}"/><text class="tick" x="${sx(t)}" y="${H - 8}" text-anchor="middle">${t}%</text>`);
    rows.forEach((r, i) => {
      const cy = m.t + i * rowH + rowH / 2;
      g.push(`<text class="dlabel-2" x="0" y="${cy + 4}">${esc(r.k)} · ${esc(W < 520 ? CATS[r.k].split(" ")[0] : CATS[r.k])}</text>`);
      const jit = s => { let h = 7; for (const c of s) h = (h * 33 + c.charCodeAt(0)) | 0; return ((Math.abs(h) % 1000) / 1000 - 0.5) * 16; };
      r.pts.forEach(p => { p.px = sx(p.v); p.py = cy + jit(p.m.model + r.k); });
      for (const p of r.pts) if (p.m.model !== emphasize) g.push(`<circle class="strip-dot" cx="${p.px.toFixed(1)}" cy="${p.py.toFixed(1)}" r="3.5"/>`);
      const vals = r.pts.map(p => p.v).sort((a, b) => a - b);
      if (vals.length) {
        const med = vals.length % 2 ? vals[vals.length >> 1] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2;
        g.push(`<line class="med" x1="${sx(med)}" x2="${sx(med)}" y1="${cy - 12}" y2="${cy + 12}"/>`);
        r.med = med;
      }
      const e = r.pts.find(p => p.m.model === emphasize);
      if (e) g.push(`<circle class="strip-dot em" cx="${e.px.toFixed(1)}" cy="${cy}" r="5.5"/>`);
    });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Pass rate by category for every model">${g.join("")}</svg>`;
    el._geom = { rows, lw, rowH, m };
  };
  const stop = responsive(el, draw);
  const nearest = e => {
    const r = el.querySelector("svg").getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 18 * 18, row = null;
    for (const rw of rows) for (const p of rw.pts) { const d = (p.px - x) ** 2 + (p.py - y) ** 2; if (d < bd) { bd = d; best = p; row = rw; } }
    return best && { p: best, row };
  };
  const tip = ({ p, row }, link) => html`<div class="tv">${pct(p.v)}</div><div class="tl"><b>${shortName(p.m.model)}</b> · ${CATS[row.k]}</div>
    <div class="tm">${p.m.by_category[row.k].passed}/${p.m.by_category[row.k].total} passed · field median ${pct(row.med)}</div>${link ? html`<a href="#/model/${encodeURIComponent(p.m.model)}">Open model →</a>` : ""}`;
  let tapped = null;
  el.onpointermove = e => { if (e.pointerType === "touch") return; const n = nearest(e); if (n) { showTip(tip(n), e.clientX, e.clientY); el.style.cursor = "pointer"; } else { hideTip(); el.style.cursor = ""; } };
  el.onpointerleave = hideTip;
  el.onclick = e => {
    const n = nearest(e); if (!n) return;
    if (matchMedia("(hover: none)").matches && tapped !== n.p) { tapped = n.p; showTip(tip(n, true), e.clientX, e.clientY, { interactive: true }); return; }
    hideTip(); onPick?.(n.p.m.model);
  };
  return stop;
}

// ------------------------------------------------------------------ line over time (single series)
export function timeLine(el, pts, { fmt = money, label = "Spend", height = 200 } = {}) {
  if (pts.length < 2) { el.innerHTML = `<div class="empty">Not enough points yet.</div>`; return () => {}; }
  const draw = W => {
    const H = height, m = { l: 48, r: 14, t: 14, b: 28 };
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const xa = Math.min(...xs), xb = Math.max(...xs) || xa + 1, yb = Math.max(...ys) * 1.15 || 1;
    const sx = v => m.l + (v - xa) / (xb - xa || 1) * (W - m.l - m.r), sy = v => H - m.b - v / yb * (H - m.t - m.b);
    const g = [];
    for (let i = 0; i <= 4; i++) { const v = yb * i / 4; g.push(`<line class="grid-l" x1="${m.l}" x2="${W - m.r}" y1="${sy(v)}" y2="${sy(v)}"/><text class="tick" x="${m.l - 8}" y="${sy(v) + 4}" text-anchor="end">${esc(fmt(v))}</text>`); }
    const n = Math.min(5, pts.length);
    for (let i = 0; i < n; i++) { const p = pts[Math.round(i * (pts.length - 1) / (n - 1 || 1))]; g.push(`<text class="tick" x="${sx(p.x)}" y="${H - 8}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}">${esc(p.label)}</text>`); }
    const d = pts.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join("");
    g.push(`<path class="area" d="${d}L${sx(pts.at(-1).x)},${sy(0)}L${sx(pts[0].x)},${sy(0)}Z"/>`);
    g.push(`<line class="base-l" x1="${m.l}" x2="${W - m.r}" y1="${sy(0)}" y2="${sy(0)}"/>`);
    g.push(`<path class="ln" d="${d}"/>`);
    const last = pts.at(-1);
    g.push(`<circle cx="${sx(last.x)}" cy="${sy(last.y)}" r="4.5" fill="var(--accent)" stroke="var(--card)" stroke-width="2"/>`);
    g.push(`<line class="xhair" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/><circle class="xdot" r="4.5" fill="var(--accent)" stroke="var(--card)" stroke-width="2" visibility="hidden"/>`);
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(label)} over time">${g.join("")}</svg>`;
    el._s = { sx, sy };
  };
  const stop = responsive(el, draw);
  el.onpointermove = e => {
    const r = el.querySelector("svg").getBoundingClientRect(), x = e.clientX - r.left, { sx, sy } = el._s;
    let best = pts[0]; for (const p of pts) if (Math.abs(sx(p.x) - x) < Math.abs(sx(best.x) - x)) best = p;
    const xh = el.querySelector(".xhair"), xd = el.querySelector(".xdot");
    xh.setAttribute("x1", sx(best.x)); xh.setAttribute("x2", sx(best.x)); xh.setAttribute("visibility", "visible");
    xd.setAttribute("cx", sx(best.x)); xd.setAttribute("cy", sy(best.y)); xd.setAttribute("visibility", "visible");
    showTip(html`<div class="tv">${fmt(best.y)}</div><div class="trow"><i class="key" style="background:var(--accent)"></i><span class="tl">${label} · ${best.label}</span></div>`, e.clientX, e.clientY);
  };
  el.onpointerleave = () => { hideTip(); el.querySelectorAll(".xhair,.xdot").forEach(n => n.setAttribute("visibility", "hidden")); };
  return stop;
}

// ------------------------------------------------------------------ per-case columns (HTML, so it reflows freely)
export function caseColumns(el, rows, { fmt, onPick, tipExtra } = {}) {
  const max = Math.max(...rows.map(r => r.v ?? 0), 0) || 1;
  const step = niceStep(max / 3), top = Math.ceil(max / step) * step;
  const ticks = []; for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  el.innerHTML = String(html`<div class="cols">
    <div class="cols-y">${ticks.map(t => html`<span style="bottom:${(100 * t / top).toFixed(2)}%">${fmt(t)}</span>`)}</div>
    <div class="cols-plot">${ticks.slice(1).map(t => html`<i class="gl" style="bottom:${(100 * t / top).toFixed(2)}%"></i>`)}
      ${rows.map((r, i) => html`<button class="col${r.v == null ? " dim" : ""}${i && rows[i - 1].id[0] !== r.id[0] ? " brk" : ""}" style="height:${r.v == null ? 0 : Math.max(1, 100 * r.v / top).toFixed(2)}%" data-i="${i}" aria-label="${r.id}: ${r.v == null ? "not run" : fmt(r.v)}"></button>`)}</div>
    <div class="cols-x">${rows.map((r, i) => html`<span class="${i && rows[i - 1].id[0] !== r.id[0] ? "brk" : ""}">${i === 0 || rows[i - 1].id[0] !== r.id[0] ? r.id[0] : ""}</span>`)}</div>
  </div>`);
  const plot = el.querySelector(".cols-plot");
  const tip = b => { const r = rows[+b.dataset.i]; return html`<div class="tv">${r.v == null ? "–" : fmt(r.v)}</div><div class="tl"><b>${r.id}</b> · ${GRADES[r.g]?.label ?? ""}</div>${tipExtra ? tipExtra(r) : ""}`; };
  plot.addEventListener("pointermove", e => { const b = e.target.closest(".col"); if (b && e.pointerType !== "touch") showTip(tip(b), e.clientX, e.clientY); else if (!b) hideTip(); });
  plot.addEventListener("pointerleave", hideTip);
  plot.addEventListener("focusin", e => { const b = e.target.closest(".col"); if (b) { const r = b.getBoundingClientRect(); showTip(tip(b), r.left, r.top); } });
  plot.addEventListener("focusout", hideTip);
  plot.addEventListener("click", e => { const b = e.target.closest(".col"); if (b) { hideTip(); onPick?.(rows[+b.dataset.i]); } });
}
function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

// ------------------------------------------------------------------ models × cases heat matrix
export function heatMatrix(el, models, caseIds, cases, { onCell, onRow, onCol } = {}) {
  const draw = W => {
    const lw = W < 560 ? 104 : 190;
    const cell = Math.max(10, Math.min(18, Math.floor((W - lw - 16) / (caseIds.length + 3))));
    const gap = 1, brk = 4, headH = 46;
    const colX = []; let x = lw;
    caseIds.forEach((id, i) => { if (i && id[0] !== caseIds[i - 1][0]) x += brk; colX.push(x); x += cell + gap; });
    const w = x + 8, h = headH + models.length * (cell + gap) + 6;
    const parts = [`<g class="matrix">`];
    let prev = "";
    caseIds.forEach((id, i) => {
      if (id[0] !== prev) { parts.push(`<text class="cg" x="${colX[i]}" y="12">${esc(id[0])}</text>`); prev = id[0]; }
      parts.push(`<text class="cl" data-c="${i}" transform="translate(${colX[i] + cell / 2 + 3},${headH - 4}) rotate(-90)">${esc(id.slice(1))}</text>`);
    });
    models.forEach((m, r) => {
      const y = headH + r * (cell + gap);
      const name = shortName(m.model), max = Math.floor((lw - 10) / 6.4);
      parts.push(`<text class="rl" data-r="${r}" x="${lw - 8}" y="${y + cell - 3}" text-anchor="end">${esc(name.length > max ? name.slice(0, max - 1) + "…" : name)}</text>`);
      let row = "";
      for (let i = 0; i < caseIds.length; i++) row += `<rect class="cell f-${gcls(m.grades[i] || ".")}" x="${colX[i]}" y="${y}" width="${cell}" height="${cell}" rx="2"/>`;
      parts.push(row);
    });
    parts.push(`<rect class="hlrect" fill="none" stroke="var(--ink)" stroke-width="2" rx="3" visibility="hidden"/></g>`);
    el.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Grade for every model and case">${parts.join("")}</svg>`;
    el._g = { lw, cell, gap, headH, colX };
  };
  const host = el.parentElement;
  const stop = responsive(host, draw);
  const locate = e => {
    const g = el._g, r = el.querySelector("svg").getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const row = Math.floor((y - g.headH) / (g.cell + g.gap));
    const col = g.colX.findIndex(cx => x >= cx && x < cx + g.cell + g.gap);
    return { row, col, ok: row >= 0 && row < models.length && col >= 0 };
  };
  const hl = (loc) => {
    const rect = el.querySelector(".hlrect"); if (!rect) return;
    if (!loc?.ok) return rect.setAttribute("visibility", "hidden");
    const g = el._g;
    rect.setAttribute("x", g.colX[loc.col] - 1); rect.setAttribute("y", g.headH + loc.row * (g.cell + g.gap) - 1);
    rect.setAttribute("width", g.cell + 2); rect.setAttribute("height", g.cell + 2); rect.setAttribute("visibility", "visible");
  };
  const cellTip = (loc, link) => {
    const m = models[loc.row], id = caseIds[loc.col], gr = GRADES[m.grades[loc.col] || "."], c = cases[id];
    return html`<div class="tv">${gr.icon} ${gr.label}</div><div class="tl"><b>${id}</b> · ${shortName(m.model)}</div>
      <div class="tm">“${c?.request ?? ""}”</div>${link && gr.key !== "none" ? html`<a href="#/run/${encodeURIComponent(m.model)}/${id}">Open transcript →</a>` : ""}`;
  };
  let tapped = "";
  el.onpointermove = e => {
    if (e.pointerType === "touch") return;
    const t = e.target;
    if (t.classList?.contains("rl") || t.classList?.contains("cl")) { hl(null); hideTip(); el.style.cursor = "pointer"; return; }
    const loc = locate(e); hl(loc);
    if (loc.ok) { showTip(cellTip(loc), e.clientX, e.clientY); el.style.cursor = "pointer"; } else { hideTip(); el.style.cursor = ""; }
  };
  el.onpointerleave = () => { hl(null); hideTip(); };
  el.onclick = e => {
    const t = e.target;
    if (t.classList?.contains("rl")) return onRow?.(models[+t.dataset.r].model);
    if (t.classList?.contains("cl")) return onCol?.(caseIds[+t.dataset.c]);
    const loc = locate(e); if (!loc.ok) return;
    const key = `${loc.row}:${loc.col}`;
    if (matchMedia("(hover: none)").matches && tapped !== key) { tapped = key; hl(loc); showTip(cellTip(loc, true), e.clientX, e.clientY, { interactive: true }); return; }
    hideTip(); onCell?.(models[loc.row].model, caseIds[loc.col], models[loc.row].grades[loc.col]);
  };
  return stop;
}

