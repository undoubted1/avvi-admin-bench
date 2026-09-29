// Loads /api/overview and derives what several views share: ranking, per-case aggregates.

import { api, median } from "./lib.js";

// Named in the overview headline when it shares the top score; the leaderboard order itself is unchanged.
export const FEATURED = "anthropic/claude-sonnet-5.5";

// Leaderboard order: pass rate, then fewer dangerous misses, then cheaper.
export const rankCmp = (a, b) => b.pass_rate - a.pass_rate || a.dangerous_misses - b.dangerous_misses || a.cost - b.cost || a.model.localeCompare(b.model);

export async function board({ ttl = 2500 } = {}) {
  const o = await api("/api/overview", { ttl });
  if (o._derived) return o;
  const total = o.case_ids.length;
  o.models.forEach(m => (m.complete = m.cases_run >= total));
  const ranked = [...o.models].sort((a, b) => b.complete - a.complete || rankCmp(a, b));
  ranked.forEach((m, i) => (m.rank = i + 1));
  // Charts and headline numbers compare like with like: models that ran every case (all models if none have).
  const full = ranked.filter(m => m.complete);
  const caseById = Object.fromEntries(o.cases.map(c => [c.id, c]));
  // Per-case aggregates across every scored model.
  const perCase = o.case_ids.map((id, i) => {
    const n = { P: 0, F: 0, D: 0, E: 0, ".": 0 };
    for (const m of o.models) n[m.grades[i] || "."]++;
    const ran = n.P + n.F + n.D + n.E;
    return { id, i, ...caseById[id], n, ran, rate: ran ? (100 * n.P) / ran : null };
  });
  const catMedian = {};
  for (const k of ["R", "K", "A", "F"]) {
    catMedian[k] = median((full.length ? full : o.models).filter(m => m.by_category?.[k]?.total).map(m => (100 * m.by_category[k].passed) / m.by_category[k].total));
  }
  o._derived = true;
  Object.assign(o, { ranked, full: full.length ? full : ranked, caseById, perCase, catMedian, byModel: Object.fromEntries(o.models.map(m => [m.model, m])) });
  return o;
}

// A cheap signature so polling views only re-render when the data really changed.
export const signature = o => `${o.models.length}:${o.models.reduce((s, m) => s + (m.scored_at || 0), 0)}:${o.total_cost}`;
