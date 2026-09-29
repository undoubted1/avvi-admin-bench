// App shell: hash router, navigation, theme, spend chip and polling.

import { $, html, icon, api, money, hideTip, meter } from "./lib.js";
import * as overview from "./views/overview.js";
import * as models from "./views/models.js";
import * as model from "./views/model.js";
import * as cases from "./views/cases.js";
import * as kase from "./views/case.js";
import * as run from "./views/run.js";
import * as live from "./views/live.js";
import * as consoleView from "./views/console.js";
import * as compare from "./views/compare.js";

const NAV = [
  { href: "#/", key: "overview", label: "Overview", icon: "overview" },
  { href: "#/models", key: "models", label: "Models", icon: "models" },
  { href: "#/cases", key: "cases", label: "Cases", icon: "cases" },
  { href: "#/sweep", key: "sweep", label: "Sweep", icon: "live" },
  { href: "#/live", key: "live", label: "Live run", icon: "run" },
];
const ROUTES = [
  [/^\/?$/, overview, "overview"],
  [/^\/models$/, models, "models"],
  [/^\/model\/(.+)$/, model, "models"],
  [/^\/compare(?:\/([^/]+)\/([^/]+))?$/, compare, "models"],
  [/^\/cases$/, cases, "cases"],
  [/^\/case\/([A-Za-z]\d\d)$/, kase, "cases"],
  [/^\/run\/(.+)\/([A-Za-z]\d\d)$/, run, "cases"],
  [/^\/sweep$/, live, "sweep"],
  [/^\/live$/, consoleView, "live"],
  [/^\/live-run\/([\w.\-]+)$/, run, "live"],
];

// ------------------------------------------------------------------ navigation chrome
function renderNav(active, liveState) {
  const dot = liveState === "running" ? html`<i class="badge-dot"></i>` : "";
  $("#tabBar").innerHTML = String(html`${NAV.map(n => html`<a href="${n.href}" ${n.key === active ? html`aria-current="page"` : ""}>${icon(n.icon)}<span>${n.label}</span>${n.key === "sweep" ? dot : ""}</a>`)}`);
  $("#sideNav").innerHTML = String(html`${NAV.map(n => html`<a href="${n.href}" ${n.key === active ? html`aria-current="page"` : ""}>${icon(n.icon)}<span>${n.label}</span>${n.key === "sweep" && liveState === "running" ? html`<span class="count"><i class="live-dot on"></i></span>` : ""}</a>`)}
    <hr><a href="#/compare">${icon("compare")}<span>Compare</span></a>`);
}

let lastSpend = null;
async function refreshSpend() {
  try {
    const m = await api("/api/monitor", { ttl: 4000 });
    lastSpend = m;
    const running = m.state === "running";
    $("#spendChip").innerHTML = String(html`${running ? html`<i class="live-dot on"></i>` : ""}${money(m.total_cost)} <span class="muted">/ $${m.cost_limit}</span>`);
    $("#sideSpend").innerHTML = String(html`<a href="#/sweep" class="tile" style="padding:11px 12px">
      <span class="k">${running ? html`<i class="live-dot on"></i> Sweep running` : m.state === "finished" ? "Sweep finished" : "Spend"}</span>
      <span class="v" style="font-size:19px">${money(m.total_cost)} <small>of $${m.cost_limit}</small></span>
      ${meter(m.total_cost, m.cost_limit, { label: false, cls: m.total_cost / m.cost_limit > 0.85 ? "crit" : m.total_cost / m.cost_limit > 0.6 ? "warn" : "" })}</a>`);
    renderNav(current.active, m.state);
  } catch { /* the chip just keeps its last value */ }
}

// ------------------------------------------------------------------ theme
const THEMES = ["auto", "light", "dark"];
function applyTheme(pref) {
  const dark = pref === "dark" || (pref === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const ic = icon(pref === "auto" ? "auto" : pref === "dark" ? "moon" : "sun");
  for (const b of [$("#themeBtn"), $("#themeBtnSide")]) { b.innerHTML = String(ic); b.title = `Theme: ${pref}`; }
  document.dispatchEvent(new CustomEvent("themechange"));
}
function cycleTheme() {
  const next = THEMES[(THEMES.indexOf(localStorage.getItem("theme") || "auto") + 1) % THEMES.length];
  localStorage.setItem("theme", next); applyTheme(next);
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme(localStorage.getItem("theme") || "auto"));

// ------------------------------------------------------------------ router
const current = { active: "overview", cleanup: [], view: null, token: 0 };
export function setTitle(title, sub = "", { back } = {}) {
  $("#topTitle").textContent = title;
  $("#topSub").textContent = sub;
  document.title = title === "Admin Bench" ? "Avvi Admin Bench" : `${title} · Avvi Admin Bench`;
  const b = $("#backBtn");
  b.hidden = !back;
  b.onclick = () => (history.length > 1 ? history.back() : (location.hash = back));
}

async function route() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, qs] = raw.split("?");
  const query = Object.fromEntries(new URLSearchParams(qs || ""));
  let match = null;
  for (const [re, view, active] of ROUTES) { const m = path.match(re); if (m) { match = { view, active, params: m.slice(1).map(p => p && decodeURIComponent(p)) }; break; } }
  current.cleanup.forEach(fn => { try { fn(); } catch { /* ignore */ } });
  current.cleanup = [];
  hideTip();
  const token = ++current.token;
  const main = $("#main");
  if (!match) { setTitle("Not found", "", { back: "#/" }); main.innerHTML = `<div class="empty"><b>Nothing here.</b><a href="#/">Go to the overview</a></div>`; return; }
  const sameView = current.view === match.view;
  current.view = match.view; current.active = match.active;
  renderNav(match.active, lastSpend?.state);
  if (!sameView) { main.classList.add("loading"); scrollTo({ top: 0 }); }
  const ctx = {
    main, query, params: match.params,
    alive: () => token === current.token,
    onCleanup: fn => current.cleanup.push(fn),
    poll: (fn, ms) => { const id = setInterval(() => { if (document.visibilityState === "visible") fn(); }, ms); current.cleanup.push(() => clearInterval(id)); },
    setTitle, go: h => (location.hash = h),
  };
  try {
    await match.view.render(ctx);
  } catch (e) {
    if (token === current.token) main.innerHTML = String(html`<div class="err-box"><b>Couldn't load this page.</b><br>${e.message}</div>`);
  } finally {
    if (token === current.token) main.classList.remove("loading");
  }
}

addEventListener("hashchange", route);
$("#themeBtn").onclick = cycleTheme;
$("#themeBtnSide").onclick = cycleTheme;
$("#backBtn").innerHTML = String(icon("back"));
applyTheme(localStorage.getItem("theme") || "auto");
renderNav("overview");
route();
refreshSpend();
setInterval(() => { if (document.visibilityState === "visible") refreshSpend(); }, 10000);
