// Transparent rubric for the boardroom defense. Decision quality is judged on the information available when the
// decision was made (the briefing's delay forecast); the realized outcome is reported separately and never scored.
import { L } from "../../shared/i18n.js";
import { prepare, draws, judgePlan, weakSpot, simulateOnce, realizedDraw, referencePlans, violations, DEFAULT_ASSUMPTIONS } from "./model.js";

export const RUBRIC = [
  { id: "correctness", label: L("Data and calculation correctness", "صحة البيانات والحسابات"), max: 2, how: L("Both required SQL checks pass on the sandbox data (1 point each).", "ينجح تحقّقا SQL المطلوبان على بيانات بيئة العزل (نقطة لكل منهما).") },
  { id: "evidence", label: L("Evidence quality and reproducibility", "جودة الأدلة وقابلية إعادة الإنتاج"), max: 2, how: L("At least two pieces of evidence are linked, including a passed SQL check. The dataset version, seed and queries are saved automatically.", "رُبط دليلان على الأقل، منهما تحقق SQL ناجح. تُحفظ نسخة البيانات والبذرة والاستعلامات تلقائيًا.") },
  { id: "constraints", label: L("Budget and operational constraints", "الميزانية والقيود التشغيلية"), max: 2, how: L("1 point: within the emergency budget and Antwerp slots. 1 more: the plan meets the 95% service target in at least half of the forecast runs, or the defense explicitly accepts the shortfall and explains why.", "نقطة: ضمن الميزانية الطارئة وخانات أنتويرب. ونقطة أخرى: تحقق الخطة هدف الخدمة 95% في نصف المحاكاة على الأقل، أو يقبل الدفاع صراحة بالنقص ويشرح السبب.") },
  { id: "tradeoffs", label: L("Trade-offs and uncertainty", "المفاضلات وعدم اليقين"), max: 2, how: L("1 point: you correctly name the delay condition in which your plan would be the wrong choice. 1 point: you state a downside (90th-percentile) cost within 10% of your plan's.", "نقطة: تحدد بشكل صحيح حالة التأخير التي تجعل خطتك الخيار الخطأ. ونقطة: تذكر تكلفة السيناريو السيئ (المئين 90) بفارق لا يتجاوز 10% عن تكلفة خطتك.") },
  { id: "clarity", label: L("Clarity of the recommendation", "وضوح التوصية"), max: 2, how: L("1 point: the recommendation explains the plan in at least 25 words. 1 point: the expected cost you quote is within 5% of the model and the fill rate within 1 percentage point.", "نقطة: تشرح التوصية الخطة في 25 كلمة على الأقل. ونقطة: التكلفة المتوقعة التي تذكرها ضمن 5% من النموذج ومعدل التلبية ضمن نقطة مئوية واحدة.") },
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
  for (const k of ["delayed", "exposure"]) if (!submission.checks?.[k]?.pass) feedback.calculation.push(L(`The "${k}" SQL check has not passed yet${submission.checks?.[k]?.messages?.[0] ? ": " + submission.checks[k].messages[0].text : "."}`, `لم ينجح تحقق SQL «${k}» بعد${submission.checks?.[k]?.messages?.[0] ? ": " + submission.checks[k].messages[0].text : "."}`));

  // 2. Evidence
  const ev = submission.evidence || [];
  const validated = ev.filter((e) => e.kind === "check" && e.pass);
  scores.evidence = (ev.length >= 2 ? 1 : 0) + (validated.length >= 1 ? 1 : 0);
  if (ev.length < 2) feedback.unsupported.push(L("Link at least two pieces of evidence (a query result, a KPI, a comparison) to your recommendation.", "اربط دليلين على الأقل (نتيجة استعلام، مؤشر، مقارنة) بتوصيتك."));
  if (!validated.length) feedback.unsupported.push(L("None of your linked evidence is a passed SQL check, so the numbers behind your claim are not verified.", "لا يوجد بين أدلتك المرتبطة تحقق SQL ناجح، لذا فالأرقام وراء ادعائك غير مُتحقق منها."));
  for (const e of ev.filter((e) => e.kind === "check" && !e.pass)) feedback.unsupported.push(L(`You linked "${e.label}", but that query has not passed its check. Evidence should be correct before it is cited.`, `ربطت «${e.label}»، لكن ذلك الاستعلام لم ينجح في التحقق. يجب أن يكون الدليل صحيحًا قبل الاستشهاد به.`));

  // 3. Constraints
  const broken = violations(prep, submission.plan);
  const meets = mine.pServiceMet >= 0.5;
  const acknowledged = d.acceptShortfall && String(d.shortfallReason || "").trim().split(/\s+/).length >= 8;
  scores.constraints = broken.length ? 0 : 1 + (meets || acknowledged ? 1 : 0);
  for (const v of broken) feedback.constraints.push(v.text);
  if (!meets) feedback.constraints.push(L(`Your plan meets the 95% service target in ${pct(mine.pServiceMet)} of forecast runs (expected fill rate ${pct(mine.expectedFill)}).${acknowledged ? " You accepted this shortfall explicitly, which is a legitimate choice when it is explained." : " Either strengthen the plan or state that you accept the shortfall and why."}`, `تحقق خطتك هدف الخدمة 95% في ${pct(mine.pServiceMet)} من المحاكاة (معدل التلبية المتوقع ${pct(mine.expectedFill)}).${acknowledged ? " قبلت هذا النقص صراحة، وهو خيار مشروع عندما يُشرح." : " إما أن تقوّي الخطة أو تذكر أنك تقبل النقص ولماذا."}`));

  // 4. Trade-offs and uncertainty
  const ws = weakSpot(prep, submission.plan, refs);
  const named = ws.accepted.includes(d.weakSpot);
  const p90ok = within(Number(d.claimedP90), mine.p90, 0.1);
  scores.tradeoffs = (named ? 1 : 0) + (p90ok ? 1 : 0);
  if (!named) feedback.unsupported.push(L(`You said your plan is weakest if the delay is ${d.weakSpot ? (d.weakSpot === "shorter" ? "shorter" : "longer") : "(not stated)"} than expected. The model shows its largest regret if the delay is ${ws.worst} (${eur(ws.regret[ws.worst])} above the best alternative in that case).`, `قلت إن خطتك تكون أضعف إذا كان التأخير ${d.weakSpot ? (d.weakSpot === "shorter" ? "أقصر" : "أطول") : "(غير محدد)"} من المتوقع. يُظهر النموذج أكبر ندم لها إذا كان التأخير ${ws.worst === "shorter" ? "أقصر" : "أطول"} (${eur(ws.regret[ws.worst])} فوق أفضل بديل في تلك الحالة).`));
  if (!p90ok) feedback.unsupported.push(L(`Your downside cost ${Number.isFinite(Number(d.claimedP90)) && d.claimedP90 !== "" ? eur(Number(d.claimedP90)) : "(not stated)"} does not match the plan's 90th-percentile cost of ${eur(mine.p90)}.`, `تكلفة السيناريو السيئ التي ذكرتها ${Number.isFinite(Number(d.claimedP90)) && d.claimedP90 !== "" ? eur(Number(d.claimedP90)) : "(غير محددة)"} لا تطابق تكلفة المئين 90 للخطة وهي ${eur(mine.p90)}.`));

  // 5. Clarity
  const words = String(d.recommendation || "").trim().split(/\s+/).filter(Boolean).length;
  const costOk = within(Number(d.claimedCost), mine.expectedCost, 0.05), fillOk = d.claimedFillPct !== "" && d.claimedFillPct !== undefined && Math.abs(Number(d.claimedFillPct) / 100 - mine.expectedFill) <= 0.01;
  scores.clarity = (words >= 25 ? 1 : 0) + (costOk && fillOk ? 1 : 0);
  if (words < 25) feedback.unsupported.push(L(`The recommendation has ${words} words. Explain what you will do, why, and what it costs (25 words or more).`, `تحتوي التوصية على ${words} كلمة. اشرح ماذا ستفعل ولماذا وكم يكلّف (25 كلمة أو أكثر).`));
  if (!costOk) feedback.unsupported.push(L(`You quoted an expected cost of ${d.claimedCost ? eur(Number(d.claimedCost)) : "(none)"}; the model gives ${eur(mine.expectedCost)} for your plan.`, `ذكرت تكلفة متوقعة قدرها ${d.claimedCost ? eur(Number(d.claimedCost)) : "(لا شيء)"}؛ ويعطي النموذج ${eur(mine.expectedCost)} لخطتك.`));
  if (!fillOk) feedback.unsupported.push(L(`You quoted a fill rate of ${d.claimedFillPct ? d.claimedFillPct + "%" : "(none)"}; the model gives ${pct(mine.expectedFill)}.`, `ذكرت معدل تلبية قدره ${d.claimedFillPct ? d.claimedFillPct + "%" : "(لا شيء)"}؛ ويعطي النموذج ${pct(mine.expectedFill)}.`));

  // Decision quality (separate from the score): defensible, or clearly beaten by a feasible alternative?
  for (const r of judged.dominatedBy) feedback.alternatives.push(L(`"${r.label}" uses ${eur(r.result.cash)} cash, has an expected cost of ${eur(r.result.expectedCost)} and meets the service target in ${pct(r.result.pServiceMet)} of runs. It is clearly better on cost and service without needing more cash.`, `«${r.label}» تستخدم ${eur(r.result.cash)} نقدًا، وتكلفتها المتوقعة ${eur(r.result.expectedCost)}، وتحقق هدف الخدمة في ${pct(r.result.pServiceMet)} من المحاكاة. إنها أفضل بوضوح في التكلفة والخدمة دون الحاجة إلى نقد إضافي.`));
  const others = judged.frontier.filter((r) => !judged.dominatedBy.includes(r));
  for (const r of others) feedback.alternatives.push(L(`Also defensible: "${r.label}" (cash ${eur(r.result.cash)}, expected cost ${eur(r.result.expectedCost)}, service target met in ${pct(r.result.pServiceMet)} of runs).`, `قابل للدفاع عنه أيضًا: «${r.label}» (النقد ${eur(r.result.cash)}، التكلفة المتوقعة ${eur(r.result.expectedCost)}، تحقق هدف الخدمة في ${pct(r.result.pServiceMet)} من المحاكاة).`));

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
