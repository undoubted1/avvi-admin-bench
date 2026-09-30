// Shared helpers. Every interpolation in html`` is escaped unless wrapped in raw(),
// because model replies, tool arguments and model ids are all untrusted text.

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = s => new Raw(String(s ?? ""));
const part = v => v == null || v === false ? "" : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join("") : esc(v);
export const html = (strs, ...vals) => new Raw(strs.reduce((out, s, i) => out + part(vals[i - 1]) + s));

// ------------------------------------------------------------------ formatting
export const money = v => v == null ? "–" : v === 0 ? "$0" : v < 0.01 ? `$${v.toFixed(4)}` : v < 1 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`;
export const pct = (v, d = 0) => v == null || isNaN(v) ? "–" : `${(+v).toFixed(d)}%`;
export const secs = v => v == null ? "–" : v < 60 ? `${(+v).toFixed(1)}s` : `${Math.floor(v / 60)}m ${String(Math.round(v % 60)).padStart(2, "0")}s`;
export const compact = n => n == null ? "–" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${Math.round(n)}`;
export const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const perM = v => v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(2);
export const priceLabel = (i, o) => i == null ? "price n/a" : i === 0 && o === 0 ? "Free" : `$${perM(i)} in · $${perM(o)} out /1M`;
export function ago(ts) {
  if (!ts) return "never";
  const s = Math.max(0, Date.now() / 1000 - ts);
  return s < 10 ? "just now" : s < 60 ? `${Math.round(s)}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
}
export const median = xs => { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
export const shortName = id => String(id).split("/").slice(1).join("/") || String(id);
export const provider = id => String(id).split("/")[0];
export const enc = encodeURIComponent;

// ------------------------------------------------------------------ grades & outcomes
export const CATS = { R: "Routine", K: "Risky", A: "Ambiguous", F: "Refuse / escalate" };
export const GRADES = {
  P: { key: "pass", label: "Pass", icon: "✓" },
  F: { key: "fail", label: "Fail", icon: "✗" },
  D: { key: "dangerous", label: "Dangerous", icon: "⚠" },
  E: { key: "error", label: "Error", icon: "!" },
  U: { key: "review", label: "Needs review", icon: "?" },
  ".": { key: "none", label: "Not run", icon: "·" },
};
export const GRADE_CODE = { pass: "P", fail: "F", dangerous: "D", error: "E", review: "U", none: "." };
export const gcls = code => code === "." ? "_" : code;
export const gradePill = key => { const g = GRADES[GRADE_CODE[key] ?? "."]; return html`<span class="pill g-${g.key}">${g.icon} ${g.label}</span>`; };
export const OUTCOMES = [
  ["act", "Act", "proposed a change"], ["ask", "Ask", "asked a question"], ["refuse", "Refuse", "declined or escalated"],
  ["answer", "Answer", "answered from reads"], ["error", "Error", "the run errored"],
  ["unclear", "Needs review", "no reliable classification"], ["none", "No reply", "no final answer"],
];
export const outcomeLabel = o => (OUTCOMES.find(x => x[0] === o) || [o, o || "none"])[1];

// ------------------------------------------------------------------ icons (24px, stroke)
const P = {
  overview: "M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z",
  models: "M5 20v-7M12 20V5M19 20v-10M3 20h18",
  cases: "M9 6h11M9 12h11M9 18h11M4 5.5l1 1 2-2M4 11.5l1 1 2-2M4 17.5l1 1 2-2",
  live: "M3 12h4l3-7 4 14 3-7h4",
  run: "M7 4.8v14.4a1 1 0 0 0 1.5.9l11.2-7.2a1 1 0 0 0 0-1.7L8.5 3.9A1 1 0 0 0 7 4.8z",
  compare: "M4 7h13l-3-3M20 17H7l3 3",
  back: "M15 5l-7 7 7 7",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  auto: "M12 3a9 9 0 1 0 0 18V3z M12 3a9 9 0 0 1 0 18",
  read: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  hand: "M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11.5V4.5a1.5 1.5 0 0 1 3 0V12M14 11.5V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7h-.5a6 6 0 0 1-5-2.7L3 15.5a1.6 1.6 0 0 1 2.6-1.9L8 16",
  chat: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z",
  ext: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  alert: "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  x: "M18 6L6 18M6 6l12 12",
  chev: "M9 6l6 6-6 6",
};
export const icon = (name, cls = "") => raw(`<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[name]}"/></svg>`);

// ------------------------------------------------------------------ data
const inflight = new Map();
const cache = new Map();
export async function api(path, { ttl = 2500 } = {}) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  if (inflight.has(path)) return inflight.get(path);
  const p = (async () => {
    try {
      const r = await fetch(path, { headers: { Accept: "application/json" } });
      let data;
      try { data = await r.json(); } catch { throw new Error(`HTTP ${r.status}: not JSON`); }
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
      cache.set(path, { at: Date.now(), data });
      return data;
    } finally { inflight.delete(path); }
  })();
  inflight.set(path, p);
  return p;
}

// ------------------------------------------------------------------ tooltip (hover on mouse, tap on touch)
const tipEl = () => document.getElementById("tip");
let tipPinned = false;
export function showTip(content, x, y, { interactive = false } = {}) {
  const t = tipEl();
  t.innerHTML = String(content);
  t.hidden = false;
  t.classList.toggle("interactive", interactive);
  tipPinned = interactive;
  const pad = 12, w = t.offsetWidth, h = t.offsetHeight;
  let left = x + 14, top = y + 14;
  if (left + w > innerWidth - pad) left = Math.max(pad, x - w - 14);
  if (top + h > innerHeight - pad) top = Math.max(pad, y - h - 14);
  t.style.left = `${left}px`; t.style.top = `${top}px`;
}
export function hideTip() { const t = tipEl(); if (t) { t.hidden = true; tipPinned = false; } }
document.addEventListener("pointerdown", e => { if (tipPinned && !e.target.closest("#tip")) hideTip(); }, true);
addEventListener("scroll", () => { if (!tipPinned) hideTip(); }, { passive: true });

// Delegated tooltips: fn(el) returns content for elements matching selector inside root.
export function bindTip(root, selector, fn) {
  const at = (e, el) => { const c = fn(el); if (c) showTip(c, e.clientX, e.clientY); };
  root.addEventListener("pointermove", e => {
    if (e.pointerType === "touch") return;
    const el = e.target.closest(selector);
    if (el && root.contains(el)) at(e, el); else hideTip();
  });
  root.addEventListener("pointerleave", hideTip);
  root.addEventListener("focusin", e => {
    const el = e.target.closest(selector);
    if (!el) return;
    const r = el.getBoundingClientRect(); const c = fn(el);
    if (c) showTip(c, r.left + r.width / 2, r.bottom);
  });
  root.addEventListener("focusout", hideTip);
}

export function toast(msg, ms = 2600) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}

// ------------------------------------------------------------------ shared components
export const meter = (value, max = 100, { label, cls = "", marker } = {}) => {
  const p = max ? Math.max(0, Math.min(100, (100 * value) / max)) : 0;
  const mk = marker == null ? "" : html`<i class="mk" style="left:calc(${Math.max(0, Math.min(100, marker))}% - 1px)" title="Field median ${Math.round(marker)}%"></i>`;
  return html`<div class="meter ${cls}"><div class="tr"><div class="fl" style="width:${p.toFixed(1)}%"></div>${mk}</div>${label === false ? "" : html`<span class="lb">${label ?? `${Math.round(p)}%`}</span>`}</div>`;
};

export function strip(grades, caseIds, { model = "", lg = false } = {}) {
  const cells = [...grades].map((g, i) => raw(`<i class="c-${gcls(g)}${i && caseIds[i][0] !== caseIds[i - 1][0] ? " brk" : ""}" data-i="${i}"></i>`));
  return html`<div class="strip${lg ? " lg" : ""}" data-model="${model}" role="img" aria-label="${countGrades(grades)}">${cells}</div>`;
}
export function countGrades(grades) {
  const n = { P: 0, F: 0, D: 0, E: 0, U: 0, ".": 0 };
  for (const g of grades) n[g] = (n[g] || 0) + 1;
  return `${n.P} pass, ${n.F} fail, ${n.D} dangerous, ${n.E} error, ${n.U} need review`;
}

export function stack(parts, { lg = false } = {}) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return html`<div class="stack${lg ? " lg" : ""}">${parts.filter(p => p.value > 0).map(p =>
    html`<span class="${p.cls}" style="flex:${p.value / total} 1 0" data-tip="${p.label}: ${p.value} (${Math.round(100 * p.value / total)}%)"></span>`)}</div>`;
}

export const legend = items => html`<div class="legend">${items.map(([cls, label, style]) => html`<span><i class="${cls}" style="${style || ""}"></i>${label}</span>`)}</div>`;

export const gradeLegend = (codes = ["P", "F", "D", "E", "U"]) =>
  legend(codes.map(c => [`c-${gcls(c)}`, `${GRADES[c].icon} ${GRADES[c].label}`]));

// ------------------------------------------------------------------ markdown (model replies)
const mdInline = s => s.split(/(`[^`\n]+`)/).map((p, i) => i % 2 ? `<code>${esc(p.slice(1, -1))}</code>` :
  esc(p).replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => `<b>${a ?? b}</b>`)
    .replace(/(^|[^\w*])([*_])(?=\S)(.+?)(?<=\S)\2(?!\w)/g, "$1<i>$3</i>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')).join("");
export function md(src) {
  const out = [], cells = r => r.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
  let para = [], list = null, table = null, code = null;
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(mdInline).join("<br>")}</p>`);
    if (list) out.push(`<${list.tag}${list.start > 1 ? ` start="${list.start}"` : ""}>${list.items.map(i => `<li>${mdInline(i)}</li>`).join("")}</${list.tag}>`);
    if (table) out.push(`<table><tr>${table[0].map(c => `<th>${mdInline(c)}</th>`).join("")}</tr>${table.slice(1).map(r => `<tr>${r.map(c => `<td>${mdInline(c)}</td>`).join("")}</tr>`).join("")}</table>`);
    para = []; list = null; table = null;
  };
  for (const line of String(src ?? "").split("\n")) {
    let m;
    if (code) { if (/^\s*```/.test(line)) { out.push(`<pre>${esc(code.join("\n"))}</pre>`); code = null; } else code.push(line); continue; }
    if (/^\s*```/.test(line)) { flush(); code = []; }
    else if (!line.trim()) { if (!list) flush(); }
    else if ((m = line.match(/^\s*#{1,6}\s+(.*)/))) { flush(); out.push(`<p class="h">${mdInline(m[1])}</p>`); }
    else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push("<hr>"); }
    else if (/^\s*\|.*\|\s*$/.test(line)) { if (!table) { flush(); table = []; } if (!/^[\s|:-]+$/.test(line)) table.push(cells(line)); }
    else if ((m = line.match(/^\s*(?:(\d+)[.)]|[-*+])\s+(.*)/))) {
      const tag = m[1] ? "ol" : "ul";
      if (list?.tag !== tag) { flush(); list = { tag, start: +m[1] || 1, items: [] }; }
      list.items.push(m[2]);
    }
    else if (list && /^\s/.test(line)) list.items[list.items.length - 1] += " " + line.trim();
    else { if (list || table) flush(); para.push(line); }
  }
  if (code) out.push(`<pre>${esc(code.join("\n"))}</pre>`);
  flush();
  return raw(out.join(""));
}

// A compact one-line rendering of a tool call's parameters.
export function paramLine(params, max = 4) {
  const e = Object.entries(params || {}).filter(([, v]) => v !== "" && v != null);
  const s = e.slice(0, max).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(", ");
  return e.length > max ? `${s}, …` : s;
}
export const stepHtml = (st, { bad = false, via } = {}) => html`<div class="step${bad ? " bad" : ""}"><b>${st.tool}</b><span class="p">(${Object.entries(st.params || {}).map(([k, v], i) => html`${i ? ", " : ""}${k}=${JSON.stringify(v)}`)})</span>${via ? html`<span class="via">via ${via}</span>` : ""}</div>`;
