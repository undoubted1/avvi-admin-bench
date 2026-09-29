// Live run: pick any number of models and cases, then watch every run stream in and get graded.
// Writes are recorded, never executed. Each live run is saved to its own history, so the
// sweep's saved results are never overwritten.

import { html, api, money, pct, secs, icon, md, paramLine, shortName, provider, priceLabel, toast, ago, gradePill, meter, CATS, GRADES, GRADE_CODE, enc, scopeNote } from "../lib.js";

const LS = "liveModels";
const state = {
  models: new Set(JSON.parse(localStorage.getItem(LS) || "[]")), cases: new Set(), q: "", filter: "all", sort: "price",
  es: null, run: null, watch: null, pinned: false,
};
const saveModels = () => localStorage.setItem(LS, JSON.stringify([...state.models]));

export async function render(ctx) {
  ctx.setTitle("Live run", "Run cases on any models");
  if (ctx.query.model) { state.models.add(ctx.query.model); saveModels(); }
  const [meta, status, o] = await Promise.all([
    api("/api/case-meta", { ttl: 60000 }), api("/api/status", { ttl: 3000 }).catch(() => null), api("/api/overview", { ttl: 10000 }).catch(() => null),
  ]);
  if (!ctx.alive()) return;
  const cases = meta.cases, caseById = Object.fromEntries(cases.map(c => [c.id, c]));
  const scored = Object.fromEntries((o?.models || []).map(m => [m.model, m]));
  const avgTok = o?.avg_tokens_per_case || [20000, 400];
  let MODELS = [];
  const estPerCase = m => { const t = scored[m.id]?.tokens_per_case || avgTok; return (t[0] * m.prompt_per_m + t[1] * m.completion_per_m) / 1e6; };

  ctx.main.innerHTML = String(html`
  <div class="head"><div class="grow"><div class="eyebrow">Live run</div><h1>Run cases live</h1>
    <p>Pick as many models and cases as you like. Every run streams in as it happens and is graded the moment it finishes. Read tools are answered from the fictional tenant; any write or approval is recorded, never executed.</p>
    ${status && !status.key_set ? html`<div class="err-box" style="margin-top:10px">Live runs are unavailable on this server right now.</div>` : ""}
    ${status ? html`<div style="max-width:420px;margin-top:10px"><div class="small muted" style="margin-bottom:4px">${money(status.total_cost)} of the $${status.cost_limit} budget spent · live runs count toward it</div>${meter(status.total_cost, status.cost_limit, { label: false })}</div>` : ""}
  </div></div>
  ${scopeNote(status?.price_cap)}

  <div class="console-grid">
    <div class="picker">
      <div class="card">
        <div class="card-h"><div><h2>1 · Models</h2><p id="mCount">Loading models…</p></div><button class="link-btn" type="button" id="mClear">Clear</button></div>
        <div class="chips" id="mSel" style="margin-bottom:10px"></div>
        <label class="search">${icon("search")}<input class="input" id="mq" type="search" placeholder="Search ${"models"}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
        <div class="filters" style="margin:8px 0 6px">
          <div class="seg" id="mFilter">${[["all", "All"], ["scored", "Scored"], ["free", "Free"], ["cheap", "< $1/M"]].map(([k, l]) => html`<button type="button" data-k="${k}" aria-pressed="${state.filter === k}">${l}</button>`)}</div>
          <select class="select" id="mSort" aria-label="Sort models"><option value="price">Cheapest</option><option value="score">Best pass rate</option><option value="name">Name</option></select>
        </div>
        <div class="mlist" id="mList"></div>
      </div>
      <div class="card" style="margin-top:12px">
        <div class="card-h"><div><h2>2 · Cases</h2><p id="cCount"></p></div><span class="small"><button class="link-btn" type="button" id="cAll">All</button> · <button class="link-btn" type="button" id="cNone">None</button></span></div>
        <div class="case-pick" id="cases">${Object.entries(CATS).map(([k, n]) => html`
          <div class="cat-h"><span>${k} · ${n}</span><button class="link-btn" type="button" data-cat="${k}">Toggle</button></div>
          ${cases.filter(c => c.category === k).map(c => html`<label><input type="checkbox" value="${c.id}" ${state.cases.has(c.id) ? "checked" : ""}><span class="id">${c.id}</span><span>${c.request}</span></label>`)}`)}</div>
      </div>
    </div>
    <div class="results">
      <div id="board"><div class="card empty"><b>Nothing running.</b>Pick models and cases, then press Run.</div></div>
      <div id="watch"></div>
      <div class="section-title"><h2>Recent live runs</h2><span class="hint" id="histHint"></span></div>
      <div class="card flush" id="history"><div class="empty">Loading…</div></div>
    </div>
  </div>
  <div class="run-bar"><span class="grow" id="summary"></span><button class="btn blue" id="runBtn" type="button">${icon("run")} Run</button></div>`);

  const $m = s => ctx.main.querySelector(s);

  // ---------------------------------------------------------------- model picker
  const drawModels = () => {
    const q = state.q.trim().toLowerCase();
    let list = MODELS.filter(m => (!q || m.id.toLowerCase().includes(q) || (m.name || "").toLowerCase().includes(q))
      && (state.filter === "all" || (state.filter === "scored" && scored[m.id]) || (state.filter === "free" && m.prompt_per_m === 0 && m.completion_per_m === 0)
        || (state.filter === "cheap" && (m.prompt_per_m + m.completion_per_m) / 2 < 1)));
    list.sort(state.sort === "score" ? (a, b) => (scored[b.id]?.pass_rate ?? -1) - (scored[a.id]?.pass_rate ?? -1) || estPerCase(a) - estPerCase(b)
      : state.sort === "name" ? (a, b) => a.id.localeCompare(b.id) : (a, b) => estPerCase(a) - estPerCase(b) || a.id.localeCompare(b.id));
    const shown = list.slice(0, 150);
    $m("#mList").innerHTML = shown.length ? String(html`${shown.map(m => { const s = scored[m.id]; return html`
      <label class="mopt"><input type="checkbox" value="${m.id}" ${state.models.has(m.id) ? "checked" : ""}>
        <span class="mo-main"><b>${shortName(m.id)}</b><span>${provider(m.id)} · ${priceLabel(m.prompt_per_m, m.completion_per_m)}</span></span>
        <span class="mo-side">${s ? html`<span class="pill ${s.pass_rate >= 80 ? "g-pass" : "neutral"}">${pct(s.pass_rate)}</span>` : ""}<small>${estPerCase(m) ? `≈ ${money(estPerCase(m))}/case` : "free"}</small></span>
      </label>`; })}${list.length > shown.length ? html`<div class="small muted" style="padding:8px 4px">${list.length - shown.length} more · refine the search</div>` : ""}`)
      : `<div class="empty">No models match.</div>`;
  };
  const drawSelected = () => {
    const sel = [...state.models];
    $m("#mSel").innerHTML = sel.length ? String(html`${sel.map(id => html`<button class="chip on" type="button" data-rm="${id}" title="Remove">${shortName(id)} ${icon("x")}</button>`)}`) : `<span class="small muted">No models selected</span>`;
    $m("#mCount").textContent = `${sel.length} selected${MODELS.length ? ` · ${MODELS.length} tool-calling models` : ""}`;
    summary();
  };
  $m("#mList").addEventListener("change", e => { const id = e.target.value; e.target.checked ? state.models.add(id) : state.models.delete(id); saveModels(); drawSelected(); });
  $m("#mSel").addEventListener("click", e => { const b = e.target.closest("[data-rm]"); if (!b) return; state.models.delete(b.dataset.rm); saveModels(); drawSelected(); drawModels(); });
  $m("#mClear").onclick = () => { state.models.clear(); saveModels(); drawSelected(); drawModels(); };
  $m("#mq").oninput = e => { state.q = e.target.value; drawModels(); };
  $m("#mSort").value = state.sort;
  $m("#mSort").onchange = e => { state.sort = e.target.value; drawModels(); };
  $m("#mFilter").onclick = e => { const b = e.target.closest("button"); if (!b) return; state.filter = b.dataset.k; $m("#mFilter").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b)); drawModels(); };

  // ---------------------------------------------------------------- case picker
  const syncCases = () => { state.cases = new Set([...ctx.main.querySelectorAll("#cases input:checked")].map(i => i.value)); $m("#cCount").textContent = `${state.cases.size} of ${cases.length} selected`; summary(); };
  $m("#cases").addEventListener("change", syncCases);
  $m("#cases").addEventListener("click", e => {
    const k = e.target.dataset?.cat; if (!k) return;
    const boxes = [...ctx.main.querySelectorAll("#cases input")].filter(i => i.value[0] === k), on = !boxes.every(i => i.checked);
    boxes.forEach(i => (i.checked = on)); syncCases();
  });
  $m("#cAll").onclick = () => { ctx.main.querySelectorAll("#cases input").forEach(i => (i.checked = true)); syncCases(); };
  $m("#cNone").onclick = () => { ctx.main.querySelectorAll("#cases input").forEach(i => (i.checked = false)); syncCases(); };

  // ---------------------------------------------------------------- summary + run
  function summary() {
    const nm = state.models.size, nc = state.cases.size, byId = Object.fromEntries(MODELS.map(m => [m.id, m]));
    const est = [...state.models].reduce((s, id) => s + (byId[id] ? estPerCase(byId[id]) : 0), 0) * nc;
    const running = !!state.es;
    $m("#summary").innerHTML = String(running ? html`<b>Running</b> · ${state.run ? `${state.run.done} of ${state.run.total} runs done · ${money(state.run.cost)}` : ""}`
      : nm && nc ? html`<b>${nm}</b> model${nm > 1 ? "s" : ""} × <b>${nc}</b> case${nc > 1 ? "s" : ""} = <b>${nm * nc}</b> runs · ≈ ${money(est)}`
        : !nm ? "Pick at least one model" : "Pick at least one case");
    const btn = $m("#runBtn");
    btn.disabled = !running && (!nm || !nc || (status && !status.key_set));
    btn.className = `btn ${running ? "" : "blue"}`;
    btn.innerHTML = String(running ? html`${icon("x")} Stop` : html`${icon("run")} Run`);
  }
  $m("#runBtn").onclick = () => state.es ? stop("Stopped. Runs already in flight finish on the server.") : start();

  function start() {
    const models = [...state.models], ids = cases.map(c => c.id).filter(id => state.cases.has(id));
    if (!models.length || !ids.length) return;
    state.run = { models, ids, cells: {}, events: {}, current: {}, done: 0, total: models.length * ids.length, cost: 0, passed: 0, notes: {} };
    state.watch = null; state.pinned = false;
    drawBoard();
    if (matchMedia("(max-width: 1099px)").matches) $m("#board").scrollIntoView({ behavior: "smooth", block: "start" });
    const es = new EventSource(`/api/run-many?models=${models.map(enc).join(",")}&cases=${ids.join(",")}`);
    state.es = es;
    summary();
    const R = state.run, key = (m, c) => `${m}|${c}`;
    const push = (m, ev) => { const c = R.current[m]; if (!c) return; (R.events[key(m, c)] ||= []).push(ev); if (state.watch === key(m, c)) drawWatch(); };
    es.addEventListener("start", e => { const d = JSON.parse(e.data); R.current[d.model] = d.case_id; R.cells[key(d.model, d.case_id)] = { st: "run" }; if (!state.pinned) state.watch = key(d.model, d.case_id); drawBoard(); drawWatch(); });
    for (const t of ["note", "read", "write", "text", "failed"]) es.addEventListener(t, e => { const d = JSON.parse(e.data); push(d.model, { t, d }); });
    es.addEventListener("done", e => { const d = JSON.parse(e.data); R.cells[key(d.model, d.case_id)] = { st: "score", cost: d.cost, done: d }; drawBoard(); });
    es.addEventListener("scored", e => {
      const d = JSON.parse(e.data);
      R.cells[key(d.model, d.case_id)] = { st: "done", ...d };
      R.done++; R.cost += d.cost || 0; if (d.grade === "pass") R.passed++;
      drawBoard(); summary(); if (state.watch === key(d.model, d.case_id)) drawWatch();
    });
    es.addEventListener("model_skipped", e => { const d = JSON.parse(e.data); R.notes[d.model] = d.text; drawBoard(); });
    es.addEventListener("fatal", e => { const d = JSON.parse(e.data); R.fatal = d.text; drawBoard(); stop(d.text); });
    es.addEventListener("finished", e => stop(`Done · ${R.done} runs · ${money(R.cost)} · ${money(JSON.parse(e.data).total_cost)} spent in total`));
    es.onerror = () => { if (state.es === es) stop("Connection closed"); };
  }
  function stop(msg) {
    if (state.es) { state.es.close(); state.es = null; }
    if (!ctx.alive()) return;
    summary(); drawHistory();
    if (msg) toast(msg, 4000);
  }
  ctx.onCleanup(() => { if (state.es) { state.es.close(); state.es = null; } });

  // ---------------------------------------------------------------- live board: models × cases
  function drawBoard() {
    const R = state.run; if (!R) return;
    const cell = (m, c) => {
      const x = R.cells[`${m}|${c}`];
      if (!x) return html`<button class="lc wait" type="button" data-k="${m}|${c}" title="${c}: waiting"><span>${c}</span></button>`;
      if (x.st !== "done") return html`<button class="lc run" type="button" data-k="${m}|${c}" title="${c}: ${x.st === "run" ? "running" : "grading"}"><span>${c}</span><i class="spinner"></i></button>`;
      const g = x.grade ? GRADE_CODE[x.grade] : ".";
      return html`<button class="lc c-${g === "." ? "_" : g}" type="button" data-k="${m}|${c}" title="${c}: ${GRADES[g].label}"><span>${c}</span><b>${GRADES[g].icon}</b></button>`;
    };
    const rowStats = m => { let d = 0, p = 0, cost = 0; for (const c of R.ids) { const x = R.cells[`${m}|${c}`]; if (x?.st === "done") { d++; cost += x.cost || 0; if (x.grade === "pass") p++; } } return { d, p, cost }; };
    $m("#board").innerHTML = String(html`<div class="card">
      <div class="card-h"><div><h2>${state.es ? html`<i class="live-dot on"></i> Running` : "Finished"} · ${R.done}/${R.total}</h2><p>${R.passed} passed · ${money(R.cost)} · tap a case to watch it</p></div></div>
      ${R.fatal ? html`<div class="err-box" style="margin-bottom:10px">${R.fatal}</div>` : ""}
      ${meter(R.done, R.total, { label: `${Math.round(100 * R.done / (R.total || 1))}%` })}
      <div class="lboard">${R.models.map(m => { const s = rowStats(m); return html`
        <div class="lrow">
          <div class="lrow-h"><b>${shortName(m)}</b><span class="small muted">${s.d}/${R.ids.length} · ${s.p} pass · ${money(s.cost)}</span></div>
          ${R.notes[m] ? html`<div class="small bad">${R.notes[m]}</div>` : ""}
          <div class="lcells">${R.ids.map(c => cell(m, c))}</div>
        </div>`; })}</div>
    </div>`);
  }
  $m("#board").addEventListener("click", e => {
    const b = e.target.closest(".lc"); if (!b) return;
    state.watch = b.dataset.k; state.pinned = true; drawWatch();
    if (matchMedia("(max-width: 1099px)").matches) $m("#watch").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // ---------------------------------------------------------------- the run being watched
  function drawWatch() {
    const R = state.run, k = state.watch;
    if (!R || !k) { $m("#watch").innerHTML = ""; return; }
    const [m, c] = [k.slice(0, k.lastIndexOf("|")), k.slice(k.lastIndexOf("|") + 1)];
    const x = R.cells[k], evs = R.events[k] || [], cs = caseById[c];
    $m("#watch").innerHTML = String(html`<div class="stream-card" style="margin-top:12px">
      <div class="sc-h"><span class="cat-tag">${c}</span><b>${shortName(m)}</b>
        ${!x ? html`<span class="pill neutral">waiting</span>` : x.st === "done" ? (x.grade ? gradePill(x.grade) : html`<span class="pill neutral">not scored</span>`) : html`<span class="pill neutral"><span class="spinner"></span> ${x.st === "run" ? "running" : "grading"}</span>`}
        ${state.pinned ? html`<button class="link-btn" type="button" id="follow" style="margin-left:auto">Follow latest</button>` : ""}</div>
      <div style="font-weight:520">“${cs?.request}”</div>
      <div class="small muted" style="margin-top:4px">Expected: ${(cs?.expected?.outcome || []).join(" or ")}${cs?.why ? ` · ${cs.why}` : ""}</div>
      ${x?.st === "done" ? html`<div class="verdict g-${x.grade || "error"}" style="margin-top:10px">${x.divergence}</div>` : ""}
      <div class="evs">${evs.map(({ t, d }) => t === "read" ? html`<details class="call"><summary><span class="ico">${icon("read")}</span><span class="nm">${d.tool}</span><span class="arg">${paramLine(d.arguments, 3)}</span></summary><pre>${"arguments " + JSON.stringify(d.arguments, null, 2) + "\n\nmock result " + JSON.stringify(d.result, null, 2)}</pre></details>`
        : t === "write" ? html`<div class="call write"><div class="call-h"><span class="ico">${icon("hand")}</span><span class="nm">${d.tool}</span><span class="tag">Recorded · not executed</span></div><pre>${JSON.stringify(d.arguments, null, 2)}</pre></div>`
        : t === "text" ? html`<div class="bubble md">${md(d.text)}</div>`
        : t === "failed" ? html`<div class="err-box">${d.text}</div>` : html`<div class="small muted">${d.text}</div>`)}</div>
      ${x?.done ? html`<div class="small muted" style="margin-top:8px">${x.done.turns} turn${x.done.turns === 1 ? "" : "s"} · ${secs(x.done.duration_s)} · ${money(x.done.cost || 0)}</div>` : ""}
      ${x?.id ? html`<a class="btn sm" style="margin-top:10px" href="#/live-run/${x.id}">Full transcript ${icon("chev")}</a>` : ""}
    </div>`);
    const f = $m("#follow"); if (f) f.onclick = () => { state.pinned = false; drawWatch(); };
  }

  // ---------------------------------------------------------------- history
  async function drawHistory() {
    try {
      const runs = await api("/api/live-runs", { ttl: 0 });
      if (!ctx.alive()) return;
      $m("#histHint").textContent = runs.length ? `${runs.length} saved` : "";
      $m("#history").innerHTML = runs.length ? String(html`<div class="list">${runs.slice(0, 60).map(r => html`
        <a class="li" href="#/live-run/${r.id}">
          <span class="cat-tag">${r.case_id}</span>
          <span class="main"><div class="t1"><b>${shortName(r.model)}</b></div><div class="t2 clamp">${r.divergence || (r.error ? `Error: ${r.error}` : "")}</div></span>
          <span class="side-v">${r.grade ? gradePill(r.grade) : html`<span class="pill neutral">not scored</span>`}<small>${ago(r.at)} · ${money(r.cost)}</small></span>
        </a>`)}</div>`) : `<div class="empty"><b>No live runs yet.</b>Runs you start here are saved and listed.</div>`;
    } catch (e) { if (ctx.alive()) $m("#history").innerHTML = String(html`<div class="empty">Couldn't load history: ${e.message}</div>`); }
  }

  drawSelected(); syncCases(); drawHistory();
  if (state.run) { drawBoard(); drawWatch(); }
  api("/api/models", { ttl: 600000 }).then(list => {
    if (!ctx.alive()) return;
    MODELS = list.filter(m => m.prompt_per_m >= 0 && m.completion_per_m >= 0 && !m.id.startsWith("openrouter/") && !m.id.startsWith("~"));
    drawModels(); drawSelected();
  }).catch(e => { if (ctx.alive()) { $m("#mCount").textContent = "Couldn't load the model list"; $m("#mList").innerHTML = String(html`<div class="empty">${e.message}</div>`); } });
}
