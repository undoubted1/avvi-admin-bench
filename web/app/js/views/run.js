// One run: the scorer's verdict and the full conversation, read tools and all.

import { html, api, money, secs, compact, icon, md, gradePill, stepHtml, paramLine, shortName, CATS, outcomeLabel, enc } from "../lib.js";

const pretty = s => { try { return JSON.stringify(typeof s === "string" ? JSON.parse(s) : s, null, 2); } catch { return String(s ?? ""); } };
const parseArgs = s => { try { return typeof s === "string" ? JSON.parse(s || "{}") : s || {}; } catch { return { _unparsed: s }; } };

export async function render(ctx) {
  // #/run/<model>/<case> is a saved sweep result; #/live-run/<id> is one saved live run.
  const live = ctx.params.length === 1;
  const [d, all] = await Promise.all([
    live ? api(`/api/live-run?id=${enc(ctx.params[0])}`) : api(`/api/run-detail?model=${enc(ctx.params[0])}&case=${ctx.params[1].toUpperCase()}`),
    api("/api/overview", { ttl: 10000 }).catch(() => null)]);
  if (!ctx.alive()) return;
  const model = d.run.model, caseId = d.run.case_id;
  ctx.setTitle(`${caseId} · ${shortName(model)}`, live ? "Live run" : "Saved result", { back: live ? "#/live" : `#/model/${enc(model)}` });
  const r = d.run, s = d.score, c = d.case, exp = c.expected || {};
  const grade = s ? (s.error ? "error" : s.grade) : (r.error ? "error" : null);
  const ids = live ? [] : all?.case_ids || [];
  const row = all?.models.find(m => m.model === model);
  const ran = ids.filter((id, i) => row ? row.grades[i] !== "." : true);
  const at = ran.indexOf(caseId), prev = ran[at - 1], next = ran[at + 1];

  // Pair each tool call with the mock result the bench sent back.
  const results = {};
  for (const m of r.messages || []) if (m.role === "tool") results[m.tool_call_id] = m.content;
  let turn = 0;
  const thread = [];
  for (const m of (r.messages || [])) {
    if (m.role === "system") thread.push(html`<details class="call"><summary><span class="ico">${icon("cases")}</span><span class="nm">System prompt</span><span class="arg">the same neutral prompt for every model, plus 46 tools</span></summary><pre>${m.content}</pre></details>`);
    else if (m.role === "user") thread.push(html`<div class="msg user"><div class="who">Tom · office manager</div><div class="bubble md">${md(m.content)}</div></div>`);
    else if (m.role === "assistant") {
      turn++;
      const parts = [];
      if (m.content) parts.push(html`<div class="bubble md">${md(m.content)}</div>`);
      for (const tc of m.tool_calls || []) {
        const name = tc.function?.name, args = parseArgs(tc.function?.arguments);
        if (results[tc.id] !== undefined) {
          parts.push(html`<details class="call"><summary><span class="ico">${icon("read")}</span><span class="nm">${name}</span><span class="arg">${paramLine(args, 3)}</span></summary><pre>${"arguments " + pretty(args) + "\n\nmock result " + pretty(results[tc.id])}</pre></details>`);
        } else {
          parts.push(html`<div class="call write"><div class="call-h"><span class="ico">${icon("hand")}</span><span class="nm">${name}</span><span class="tag">Recorded · not executed</span></div><pre>${pretty(args)}</pre></div>`);
        }
      }
      thread.push(html`<div class="msg bot"><div class="who">${icon("chat")} ${shortName(model)} · turn ${turn}</div>${parts}</div>`);
    }
  }
  if (r.error) thread.push(html`<div class="err-box"><b>Run error:</b> ${r.error}</div>`);

  ctx.main.innerHTML = String(html`
  <div class="head"><div class="grow">
    <div class="eyebrow">${live ? html`<a href="#/live">Live run</a> · ${new Date(d.at * 1000).toLocaleString()} › ` : ""}<a href="#/model/${enc(model)}">${shortName(model)}</a> › <a href="#/case/${caseId}">${caseId}</a> · ${CATS[caseId[0]]}</div>
    <p class="quote" style="font-size:21px">${c.request}</p>
    <div class="meta-line">${grade ? gradePill(grade) : html`<span class="pill neutral">Not scored</span>`}<span>${r.turns} turn${r.turns === 1 ? "" : "s"}</span>·<span>${compact((r.usage?.prompt_tokens || 0) + (r.usage?.completion_tokens || 0))} tokens</span>·<span>${money(r.cost)}</span>·<span>${secs(r.duration_s)}</span>${r.temperature_zero === false ? html`·<span>temperature ≠ 0</span>` : ""}</div>
  </div></div>

  <div class="grid two">
    <div class="card">
      <div class="card-h"><div><h2>Verdict</h2></div></div>
      ${s ? html`
        <div class="verdict g-${grade}">${s.divergence}</div>
        <div class="checks" style="margin-top:10px">
          ${[["outcome", "Right outcome"], ["plan", "Plan matched"], ["no_dangerous_miss", "Nothing dangerous"], ["valid_actions", "Valid tool arguments"], ["resolved", "Evaluation resolved"]].filter(([k]) => k in (s.checks || {})).map(([k, l]) => html`<span class="check ${s.checks?.[k] ? "ok" : "no"}"><b>${s.checks?.[k] ? "✓" : "✗"}</b>${l}</span>`)}
          <span class="check ${s.skipped_confirmation ? "no" : "ok"}"><b>${s.skipped_confirmation ? "✗" : "✓"}</b>Used a confirmation card</span>
        </div>
        ${s.judge ? html`<p class="small ink2" style="margin:12px 0 0"><b>Judge (${s.judge.judge_model || "judge"}):</b> ${outcomeLabel(s.judge.label)}. ${s.judge.reason}</p>` : ""}
        ${s.judge?.evidence ? html`<blockquote>${s.judge.evidence}</blockquote>` : ""}
        ${s.warnings?.map(w => html`<p class="small muted">${w}</p>`)}
        <details class="call"><summary>Evaluation details</summary><pre>${pretty({schema_version: s.schema_version || 1, scorer_version: s.scorer_version || "legacy", failure_codes: s.failure_codes || [], input_hash: s.input_hash, evaluation_fingerprint: s.evaluation_fingerprint})}</pre></details>
        ${s.dangerous?.length ? html`<div class="lab">Why it's dangerous</div>${s.dangerous.map(x => html`<div class="step bad">${x}</div>`)}` : ""}
      ` : html`<div class="empty">This run hasn't been scored yet.</div>`}
    </div>
    <div class="card">
      <div class="card-h"><div><h2>Expected vs proposed</h2></div></div>
      <div class="lab">Expected</div>
      <div class="chips">${(exp.outcome || []).map(x => html`<span class="pill accent">${outcomeLabel(x)}</span>`)}</div>
      ${exp.plans?.length ? html`${exp.plans.map((p, i) => html`${i ? html`<div class="or">or</div>` : ""}${p.map(st => stepHtml(st))}`)}` : ""}
      ${exp.must_not?.length ? html`<div class="small" style="margin-top:6px">Never: <span class="mono bad">${exp.must_not.join(", ")}</span></div>` : ""}
      <div class="lab">This model${s ? html` · ${outcomeLabel(s.outcome)}` : ""}</div>
      ${s?.proposed?.length ? s.proposed.map(a => stepHtml(a, { via: a.via, bad: s.dangerous?.length > 0 })) : html`<div class="small muted">No change proposed.</div>`}
      ${s?.reads?.length ? html`<div class="small muted" style="margin-top:8px">Reads: <span class="mono">${s.reads.join(", ")}</span></div>` : ""}
    </div>
  </div>

  <div class="section-title"><h2>Conversation</h2><span class="hint">Read tools answered from the fictional tenant; writes recorded, never run</span></div>
  <div class="thread">${thread}</div>

  <div class="pager">
    ${prev ? html`<a class="btn" href="#/run/${enc(model)}/${prev}">${icon("back")} ${prev}</a>` : html`<span></span>`}
    <a class="btn" href="#/case/${caseId}">All models on ${caseId}</a>
    ${next ? html`<a class="btn" href="#/run/${enc(model)}/${next}">${next} ${icon("chev")}</a>` : html`<span></span>`}
  </div>`);
}
