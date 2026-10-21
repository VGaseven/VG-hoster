// Transparent rubric for the boardroom defense. Decision quality is judged on the information available when the
// decision was made (the briefing's delay forecast); the realized outcome is reported separately and never scored.
import { prepare, draws, judgePlan, weakSpot, simulateOnce, realizedDraw, referencePlans, violations, DEFAULT_ASSUMPTIONS } from "./model.js";

export const RUBRIC = [
  { id: "correctness", label: "Data and calculation correctness", max: 2, how: "Both required SQL checks pass on the sandbox data (1 point each)." },
  { id: "evidence", label: "Evidence quality and reproducibility", max: 2, how: "At least two pieces of evidence are linked, including a passed SQL check. The dataset version, seed and queries are saved automatically." },
  { id: "constraints", label: "Budget and operational constraints", max: 2, how: "1 point: within the emergency budget and Antwerp slots. 1 more: the plan meets the 95% service target in at least half of the forecast runs, or the defense explicitly accepts the shortfall and explains why." },
  { id: "tradeoffs", label: "Trade-offs and uncertainty", max: 2, how: "1 point: you correctly name the delay condition in which your plan would be the wrong choice. 1 point: you state a downside (90th-percentile) cost within 10% of your plan's." },
  { id: "clarity", label: "Clarity of the recommendation", max: 2, how: "1 point: the recommendation explains the plan in at least 25 words. 1 point: the expected cost you quote is within 5% of the model and the fill rate within 1 percentage point." },
];

const within = (claimed, actual, tol) => Number.isFinite(claimed) && Math.abs(claimed - actual) <= Math.abs(actual) * tol + 1e-9;
const eur = (v) => "€" + Math.round(v).toLocaleString("en-GB");
const pct = (v) => (v * 100).toFixed(1) + "%";

/**
 * submission: { seed, plan, assumptions, checks: {delayed, exposure, freight}, evidence: [{id,label,kind,pass?}],
 *   defense: { recommendation, claimedCost, claimedFillPct, claimedP90, weakSpot, acceptShortfall, shortfallReason, assumptionNote } }
 */
export function evaluate(scenario, submission) {
  const prep = prepare(scenario);
  const sample = draws(scenario.seed, DEFAULT_ASSUMPTIONS); // decision information: the briefing's forecast
  const refs = referencePlans(prep);
  const judged = judgePlan(prep, submission.plan, sample, refs);
  const mine = judged.mine, d = submission.defense || {};
  const feedback = { calculation: [], unsupported: [], constraints: [], alternatives: [] };
  const scores = {};

  // 1. Correctness
  const passed = ["delayed", "exposure"].filter((k) => submission.checks?.[k]?.pass);
  scores.correctness = passed.length;
  for (const k of ["delayed", "exposure"]) if (!submission.checks?.[k]?.pass) feedback.calculation.push(`The "${k}" SQL check has not passed yet${submission.checks?.[k]?.messages?.[0] ? ": " + submission.checks[k].messages[0].text : "."}`);

  // 2. Evidence
  const ev = submission.evidence || [];
  const validated = ev.filter((e) => e.kind === "check" && e.pass);
  scores.evidence = (ev.length >= 2 ? 1 : 0) + (validated.length >= 1 ? 1 : 0);
  if (ev.length < 2) feedback.unsupported.push("Link at least two pieces of evidence (a query result, a KPI, a comparison) to your recommendation.");
  if (!validated.length) feedback.unsupported.push("None of your linked evidence is a passed SQL check, so the numbers behind your claim are not verified.");
  for (const e of ev.filter((e) => e.kind === "check" && !e.pass)) feedback.unsupported.push(`You linked "${e.label}", but that query has not passed its check. Evidence should be correct before it is cited.`);

  // 3. Constraints
  const broken = violations(prep, submission.plan);
  const meets = mine.pServiceMet >= 0.5;
  const acknowledged = d.acceptShortfall && String(d.shortfallReason || "").trim().split(/\s+/).length >= 8;
  scores.constraints = broken.length ? 0 : 1 + (meets || acknowledged ? 1 : 0);
  for (const v of broken) feedback.constraints.push(v.text);
  if (!meets) feedback.constraints.push(`Your plan meets the 95% service target in ${pct(mine.pServiceMet)} of forecast runs (expected fill rate ${pct(mine.expectedFill)}).${acknowledged ? " You accepted this shortfall explicitly, which is a legitimate choice when it is explained." : " Either strengthen the plan or state that you accept the shortfall and why."}`);

  // 4. Trade-offs and uncertainty
  const ws = weakSpot(prep, submission.plan, refs);
  const named = ws.accepted.includes(d.weakSpot);
  const p90ok = within(Number(d.claimedP90), mine.p90, 0.1);
  scores.tradeoffs = (named ? 1 : 0) + (p90ok ? 1 : 0);
  if (!named) feedback.unsupported.push(`You said your plan is weakest if the delay is ${d.weakSpot ? (d.weakSpot === "shorter" ? "shorter" : "longer") : "(not stated)"} than expected. The model shows its largest regret if the delay is ${ws.worst} (${eur(ws.regret[ws.worst])} above the best alternative in that case).`);
  if (!p90ok) feedback.unsupported.push(`Your downside cost ${Number.isFinite(Number(d.claimedP90)) && d.claimedP90 !== "" ? eur(Number(d.claimedP90)) : "(not stated)"} does not match the plan's 90th-percentile cost of ${eur(mine.p90)}.`);

  // 5. Clarity
  const words = String(d.recommendation || "").trim().split(/\s+/).filter(Boolean).length;
  const costOk = within(Number(d.claimedCost), mine.expectedCost, 0.05), fillOk = d.claimedFillPct !== "" && d.claimedFillPct !== undefined && Math.abs(Number(d.claimedFillPct) / 100 - mine.expectedFill) <= 0.01;
  scores.clarity = (words >= 25 ? 1 : 0) + (costOk && fillOk ? 1 : 0);
  if (words < 25) feedback.unsupported.push(`The recommendation has ${words} words. Explain what you will do, why, and what it costs (25 words or more).`);
  if (!costOk) feedback.unsupported.push(`You quoted an expected cost of ${d.claimedCost ? eur(Number(d.claimedCost)) : "(none)"}; the model gives ${eur(mine.expectedCost)} for your plan.`);
  if (!fillOk) feedback.unsupported.push(`You quoted a fill rate of ${d.claimedFillPct ? d.claimedFillPct + "%" : "(none)"}; the model gives ${pct(mine.expectedFill)}.`);

  // Decision quality (separate from the score): defensible, or clearly beaten by a feasible alternative?
  for (const r of judged.dominatedBy) feedback.alternatives.push(`"${r.label}" uses ${eur(r.result.cash)} cash, has an expected cost of ${eur(r.result.expectedCost)} and meets the service target in ${pct(r.result.pServiceMet)} of runs. It is clearly better on cost and service without needing more cash.`);
  const others = judged.frontier.filter((r) => !judged.dominatedBy.includes(r));
  for (const r of others) feedback.alternatives.push(`Also defensible: "${r.label}" (cash ${eur(r.result.cash)}, expected cost ${eur(r.result.expectedCost)}, service target met in ${pct(r.result.pServiceMet)} of runs).`);

  // Realized outcome: one seeded draw, the same for every plan. Reported, never scored.
  const draw = realizedDraw(scenario.seed);
  const realized = simulateOnce(prep, submission.plan, draw.L, draw.m);
  const realizedRefs = refs.filter((r) => !violations(prep, r.plan).length).map((r) => ({ label: r.label, total: simulateOnce(prep, r.plan, draw.L, draw.m).total })).sort((a, b) => a.total - b.total);
  const total = Object.values(scores).reduce((s, v) => s + v, 0);
  return {
    criteria: RUBRIC.map((c) => ({ ...c, score: scores[c.id] })),
    total, max: RUBRIC.reduce((s, c) => s + c.max, 0),
    decision: { defensible: judged.defensible, violations: broken, dominatedBy: judged.dominatedBy.map((r) => r.label), plan: mine, weakSpot: ws },
    outcome: { delayWeeks: draw.L, demandFactor: draw.m, cost: realized.total, fillRate: realized.fillRate, bestInHindsight: realizedRefs[0], rank: realizedRefs.filter((r) => r.total < realized.total).length + 1, of: realizedRefs.length + 1 },
    feedback,
  };
}
