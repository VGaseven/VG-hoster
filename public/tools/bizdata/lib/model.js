// Strategy model for the Rotterdam mission. Transparent weekly simulation; every rule is listed in ASSUMPTIONS.
// It is a teaching model of a fictional company, not a forecast of any real port or market.
import { rng, triangular, normal } from "./prng.js";
import { L } from "../../shared/i18n.js";
import { BRIEFING_DELAY, daysBetween } from "./dataset.js";

export const ASSUMPTIONS = [
  L("Time runs in weeks from the as-of date (week 1 = days 0–6). The horizon is 8 weeks.", "يُحسب الزمن بالأسابيع من تاريخ القرار (الأسبوع 1 = الأيام 0–6). الأفق 8 أسابيع."),
  L("Delayed shipments (not arrived and past ETA) are released together when Rotterdam congestion clears, after a delay of L weeks. They can be sold from week ⌊L⌋+1.", "يُفرج عن الشحنات المتأخرة (لم تصل وتجاوزت الموعد المتوقع) معًا عند انتهاء ازدحام روتردام، بعد تأخير قدره L أسابيع. يمكن بيعها من الأسبوع ⌊L⌋+1."),
  L("L follows the port's published estimate: triangular, minimum 1.5, most likely 3, maximum 7 weeks, unless you change the assumption sliders.", "يتبع L تقدير الميناء المنشور: توزيع مثلثي، أدنى 1.5 والأرجح 3 وأقصى 7 أسابيع، ما لم تغيّر مؤشرات الافتراضات."),
  L("Shipments still at sea with a future ETA arrive on time; the carrier has re-sequenced them after the congestion.", "الشحنات التي ما زالت في البحر وموعدها المتوقع لم يحن تصل في موعدها؛ أعاد الناقل جدولتها بعد الازدحام."),
  L("A rerouted container arrives after its quoted arrival_days, for its quoted extra cost. Only containers held at the port can be rerouted.", "تصل الحاوية المعاد توجيهها بعد arrival_days المذكورة، بالتكلفة الإضافية المعروضة. لا يمكن إعادة توجيه إلا الحاويات المحتجزة في الميناء."),
  L("Demand each week = weekly_demand_units × (1 + demand shift) × a common random factor (mean 1, standard deviation 8%).", "الطلب كل أسبوع = weekly_demand_units × (1 + تغيّر الطلب) × عامل عشوائي مشترك (متوسطه 1 وانحرافه المعياري 8%)."),
  L("Unmet demand is lost (no backorders); each lost unit costs gross_margin_per_unit_eur.", "الطلب غير الملبّى يضيع (لا طلبات مؤجلة)؛ كل وحدة ضائعة تكلّف gross_margin_per_unit_eur."),
  L("Emergency buys cover the chosen number of weeks of demand for each product with a delayed shipment that is not fully rerouted. Their premium is a cost; the goods themselves become inventory.", "يغطي الشراء الطارئ عدد أسابيع الطلب المختار لكل منتج لديه شحنة متأخرة لم يُعد توجيهها بالكامل. علاوته تكلفة؛ أما البضاعة فتصبح مخزونًا."),
  L("Bringing the next regular order forward adds 2 weeks of demand per exposed product, arriving in week 7, at normal cost.", "تقديم الطلب المعتاد التالي يضيف طلب أسبوعين لكل منتج معرّض، يصل في الأسبوع 7، بالتكلفة العادية."),
  L("Holding cost = ending stock value × 25% ÷ 52 per week. Pallets above free space pay 3PL overflow per week; a lease adds space for a fixed weekly fee over the whole horizon.", "تكلفة الاحتفاظ = قيمة المخزون في نهاية الأسبوع × 25% ÷ 52 أسبوعيًا. المنصّات التي تتجاوز المساحة الفارغة تدفع رسوم تخزين خارجي أسبوعيًا؛ والاستئجار يضيف مساحة برسم أسبوعي ثابت طوال الأفق."),
  L("Stock above 6 weeks of demand at the end of week 8 is excess and is cleared at a 15% markdown.", "المخزون الذي يتجاوز طلب 6 أسابيع في نهاية الأسبوع 8 فائض ويُصفّى بتخفيض 15%."),
  L("Cash used = emergency purchases at their full price + reroute fees + lease + early orders. It must stay within the emergency budget.", "النقد المستخدم = المشتريات الطارئة بسعرها الكامل + رسوم إعادة التوجيه + الاستئجار + الطلبات المبكرة. يجب أن يبقى ضمن الميزانية الطارئة."),
];

export const EMPTY_PLAN = { reroute: [], backup: "none", coverWeeks: 0, earlyOrder: false, lease: false };
export const DEFAULT_ASSUMPTIONS = { delayMode: BRIEFING_DELAY.mode, delayMax: BRIEFING_DELAY.max, demandShiftPct: 0 };

const DRAWS = 400;

/** Pre-computes per-product facts the simulation needs. */
export function prepare(scenario) {
  const t = scenario.tables, info = t.mission_info[0], asOf = info.as_of_date;
  const products = t.products.map((p) => {
    const ship = t.shipments.filter((s) => s.product_id.trim().toUpperCase() === p.product_id);
    const delayed = ship.filter((s) => s.status !== "arrived" && s.eta_date < asOf);
    const onTime = ship.filter((s) => s.status !== "arrived" && s.eta_date >= asOf).map((s) => ({ units: s.quantity_units, week: Math.floor(daysBetween(asOf, s.eta_date) / 7) + 1 }));
    return { ...p, onHand: t.inventory.find((i) => i.product_id === p.product_id).on_hand_units, delayed, onTime };
  });
  return { info, products, reroute: t.reroute_options, backup: t.backup_suppliers, warehouse: t.warehouse[0] };
}

/** Products exposed to the delay after the plan's reroutes. */
export function exposedProducts(prep, plan) {
  return prep.products.filter((p) => p.delayed.some((s) => !plan.reroute.includes(s.shipment_id)));
}

/** Cash committed by a plan (known in advance, does not depend on the delay). */
export function planCash(prep, plan) {
  let cash = 0;
  for (const id of plan.reroute) cash += prep.reroute.find((r) => r.shipment_id === id)?.extra_cost_eur || 0;
  const exposed = exposedProducts(prep, plan);
  if (plan.backup !== "none" && plan.coverWeeks > 0) {
    for (const p of exposed) {
      const b = backupOf(prep, p.product_id, plan.backup);
      cash += Math.ceil(p.weekly_demand_units * plan.coverWeeks) * p.unit_value_eur * (1 + b.premium_pct);
    }
  }
  if (plan.earlyOrder) for (const p of exposed) cash += p.weekly_demand_units * 2 * p.unit_value_eur;
  if (plan.lease) cash += prep.warehouse.lease_cost_eur_week * prep.info.horizon_weeks;
  return Math.round(cash);
}
const unitsOf = (prep, id) => prep.products.flatMap((p) => p.delayed).find((d) => d.shipment_id === id)?.quantity_units || 0;

/** Rules a plan must respect: the emergency budget and the number of Antwerp barge slots. */
export function violations(prep, plan) {
  const out = [];
  const cash = planCash(prep, plan);
  if (cash > prep.info.emergency_budget_eur) out.push({ kind: "budget", text: L(`Uses €${cash.toLocaleString("en-GB")} cash; the emergency budget is €${prep.info.emergency_budget_eur.toLocaleString("en-GB")}.`, `تستخدم €${cash.toLocaleString("en-GB")} نقدًا؛ والميزانية الطارئة €${prep.info.emergency_budget_eur.toLocaleString("en-GB")}.`) });
  if (plan.reroute.length > prep.info.antwerp_slots) out.push({ kind: "slots", text: L(`Reroutes ${plan.reroute.length} containers; only ${prep.info.antwerp_slots} Antwerp slots are available.`, `تعيد توجيه ${plan.reroute.length} حاويات؛ والمتاح ${prep.info.antwerp_slots} خانات فقط في أنتويرب.`) });
  return out;
}
const backupOf = (prep, productId, kind) => prep.backup.find((b) => b.product_id === productId && (kind === "eu" ? b.supplier.includes("(EU)") : b.supplier.includes("(TR)")));

/** One deterministic run for a given delay L (weeks) and demand factor. Returns costs and service. */
export function simulateOnce(prep, plan, L, demandFactor) {
  const H = prep.info.horizon_weeks, w = prep.warehouse, holdingWeekly = prep.info.holding_rate_per_year / 52;
  const exposed = new Set(exposedProducts(prep, plan).map((p) => p.product_id));
  const releaseWeek = Math.floor(L) + 1;
  let lostMargin = 0, holding = 0, premium = 0, rerouteFees = 0, storage = 0, markdown = 0, demandTotal = 0, served = 0, stockoutWeeks = 0, excessValue = 0;
  const palletsByWeek = new Array(H + 1).fill(0);
  for (const id of plan.reroute) rerouteFees += prep.reroute.find((r) => r.shipment_id === id)?.extra_cost_eur || 0;

  for (const p of prep.products) {
    const arrivals = new Array(H + 2).fill(0);
    for (const s of p.onTime) if (s.week <= H) arrivals[Math.max(1, s.week)] += s.units;
    for (const s of p.delayed) {
      const r = plan.reroute.includes(s.shipment_id) && prep.reroute.find((x) => x.shipment_id === s.shipment_id);
      const week = r ? Math.floor(r.arrival_days / 7) + 1 : releaseWeek;
      if (week <= H) arrivals[week] += s.quantity_units;
    }
    if (exposed.has(p.product_id) && plan.backup !== "none" && plan.coverWeeks > 0) {
      const b = backupOf(prep, p.product_id, plan.backup), units = Math.ceil(p.weekly_demand_units * plan.coverWeeks);
      arrivals[Math.min(H + 1, b.lead_time_weeks + 1)] += units;
      premium += units * p.unit_value_eur * b.premium_pct;
    }
    if (exposed.has(p.product_id) && plan.earlyOrder) arrivals[7] += p.weekly_demand_units * 2;

    let inv = p.onHand;
    for (let week = 1; week <= H; week++) {
      inv += arrivals[week];
      const demand = p.weekly_demand_units * demandFactor;
      const sold = Math.min(inv, demand);
      inv -= sold;
      demandTotal += demand; served += sold;
      if (demand - sold > 0.5) stockoutWeeks++;
      lostMargin += (demand - sold) * p.gross_margin_per_unit_eur;
      holding += inv * p.unit_value_eur * holdingWeekly;
      palletsByWeek[week] += inv / p.units_per_pallet;
    }
    const excessUnits = Math.max(0, inv - p.weekly_demand_units * prep.info.excess_cover_weeks);
    excessValue += excessUnits * p.unit_value_eur;
    markdown += excessUnits * p.unit_value_eur * prep.info.markdown_rate;
  }
  const capacity = w.free_pallet_positions + (plan.lease ? w.lease_block_pallets : 0);
  for (let week = 1; week <= H; week++) storage += Math.max(0, palletsByWeek[week] - capacity) * w.overflow_rate_eur_pallet_week;
  if (plan.lease) storage += w.lease_cost_eur_week * H;
  const total = lostMargin + holding + premium + rerouteFees + storage + markdown;
  return { total, lostMargin, holding, premium, rerouteFees, storage, markdown, fillRate: served / demandTotal, stockoutWeeks, excessValue, peakPallets: Math.max(...palletsByWeek), capacity };
}

/** Delay / demand draws from the stated assumptions, seeded so results repeat exactly. */
export function draws(seed, assumptions = DEFAULT_ASSUMPTIONS, n = DRAWS) {
  const rand = rng(seed ^ 0x5eed);
  const mode = Math.min(Math.max(assumptions.delayMode, BRIEFING_DELAY.min), assumptions.delayMax);
  const out = [];
  for (let i = 0; i < n; i++) {
    const L = triangular(rand(), BRIEFING_DELAY.min, mode, Math.max(assumptions.delayMax, mode + 0.01));
    const m = Math.max(0.6, (1 + assumptions.demandShiftPct / 100) * (1 + 0.08 * normal(rand)));
    out.push({ L, m });
  }
  return out;
}

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];

/** Expected results and uncertainty for a plan over the same draws used for every plan (a fair comparison). */
export function evaluatePlan(prep, plan, sample) {
  const runs = sample.map((d) => simulateOnce(prep, plan, d.L, d.m));
  const totals = runs.map((r) => r.total).sort((a, b) => a - b);
  const mean = (k) => runs.reduce((s, r) => s + r[k], 0) / runs.length;
  return {
    cash: planCash(prep, plan),
    expectedCost: mean("total"), p10: quantile(totals, 0.1), p50: quantile(totals, 0.5), p90: quantile(totals, 0.9),
    expectedFill: mean("fillRate"), pServiceMet: runs.filter((r) => r.fillRate >= prep.info.service_target).length / runs.length,
    breakdown: { lostMargin: mean("lostMargin"), premium: mean("premium"), rerouteFees: mean("rerouteFees"), holding: mean("holding"), storage: mean("storage"), markdown: mean("markdown") },
    expectedExcess: mean("excessValue"), stockoutWeeks: mean("stockoutWeeks"),
  };
}

/** Reference plans used to judge whether a submitted plan is dominated. They are not "the answer". */
export function referencePlans(prep) {
  const byValue = prep.reroute
    .map((r) => { const s = prep.products.flatMap((p) => p.delayed.map((d) => ({ ...d, p }))).find((d) => d.shipment_id === r.shipment_id); return { id: r.shipment_id, ratio: (s.quantity_units * s.p.gross_margin_per_unit_eur) / r.extra_cost_eur }; })
    .sort((a, b) => b.ratio - a.ratio);
  const slots = prep.info.antwerp_slots;
  const best = byValue.slice(0, slots).map((x) => x.id);
  const biggest = [...prep.reroute].sort((a, b) => unitsOf(prep, b.shipment_id) - unitsOf(prep, a.shipment_id)).slice(0, slots).map((r) => r.shipment_id);
  return [
    { id: "hold", label: L("Hold steady (do nothing)", "الثبات (عدم فعل شيء)"), plan: { ...EMPTY_PLAN } },
    { id: "reroute-best", label: L(`Reroute the ${slots} best-value containers`, `إعادة توجيه أفضل ${slots} حاويات قيمةً`), plan: { ...EMPTY_PLAN, reroute: best } },
    { id: "reroute-big", label: L(`Reroute the ${slots} largest containers`, `إعادة توجيه أكبر ${slots} حاويات`), plan: { ...EMPTY_PLAN, reroute: biggest } },
    { id: "eu-1", label: L("EU backup buy, 1 week's cover", "شراء احتياطي أوروبي، تغطية أسبوع"), plan: { ...EMPTY_PLAN, backup: "eu", coverWeeks: 1 } },
    { id: "eu-2", label: L("EU backup buy, 2 weeks' cover", "شراء احتياطي أوروبي، تغطية أسبوعين"), plan: { ...EMPTY_PLAN, backup: "eu", coverWeeks: 2 } },
    { id: "tr-2", label: L("Turkey backup buy, 2 weeks' cover", "شراء احتياطي تركي، تغطية أسبوعين"), plan: { ...EMPTY_PLAN, backup: "tr", coverWeeks: 2 } },
    { id: "early", label: L("Bring the next order forward", "تقديم موعد الطلب التالي"), plan: { ...EMPTY_PLAN, earlyOrder: true } },
    { id: "mix-1", label: L("Reroute best-value + EU 1 week", "إعادة توجيه الأفضل قيمةً + شراء أوروبي لأسبوع"), plan: { ...EMPTY_PLAN, reroute: best, backup: "eu", coverWeeks: 1 } },
    { id: "mix-tr", label: L("Reroute best-value + Turkey 1.5 weeks", "إعادة توجيه الأفضل قيمةً + شراء تركي لـ1.5 أسبوع"), plan: { ...EMPTY_PLAN, reroute: best, backup: "tr", coverWeeks: 1.5 } },
  ];
}

/**
 * b is clearly better than a: it costs at least 5% less with no lower chance of meeting the service target, or
 * costs no more with a 10-point better chance, and it does not need meaningfully more cash (slack: 10% of budget).
 * Keeping cash is a legitimate reason to accept higher expected cost, so cash is part of the comparison.
 */
export function dominates(prep, b, a) {
  if (b.cash > a.cash + 0.1 * prep.info.emergency_budget_eur) return false;
  return (b.expectedCost <= a.expectedCost * 0.95 && b.pServiceMet >= a.pServiceMet - 0.001) ||
    (b.expectedCost <= a.expectedCost && b.pServiceMet >= a.pServiceMet + 0.1);
}

/**
 * A plan is defensible when it is within budget and no reference plan is clearly better on both expected cost
 * and the chance of meeting the service target. Several different plans can be defensible at once.
 */
export function judgePlan(prep, plan, sample, refs = referencePlans(prep)) {
  const mine = evaluatePlan(prep, plan, sample);
  const scored = refs.map((r) => ({ ...r, result: evaluatePlan(prep, r.plan, sample) })).filter((r) => violations(prep, r.plan).length === 0);
  const dominatedBy = scored.filter((r) => dominates(prep, r.result, mine));
  const frontier = scored.filter((r) => !scored.some((o) => o !== r && dominates(prep, o.result, r.result)));
  const broken = violations(prep, plan);
  return { mine, violations: broken, defensible: broken.length === 0 && dominatedBy.length === 0, dominatedBy, frontier, scored };
}

/**
 * Where a plan is weakest: its regret (cost above the best reference plan) if the port releases early (1.8 weeks)
 * or late (6.2 weeks). Used to check the student's own statement of when the plan would be the wrong choice.
 * When both regrets are close (within 20%), either answer is accepted.
 */
export function weakSpot(prep, plan, refs = referencePlans(prep)) {
  const conditions = { shorter: 1.8, longer: 6.2 };
  const regret = {};
  for (const [k, L] of Object.entries(conditions)) {
    const best = Math.min(...refs.map((r) => simulateOnce(prep, r.plan, L, 1).total));
    regret[k] = simulateOnce(prep, plan, L, 1).total - best;
  }
  const worst = regret.longer >= regret.shorter ? "longer" : "shorter";
  const top = Math.max(regret.longer, regret.shorter);
  const accepted = Object.keys(regret).filter((k) => regret[k] >= top * 0.8);
  return { worst, accepted, regret };
}

/** The one outcome that "actually happens" after submission; seeded, independent of the plan chosen. */
export function realizedDraw(seed) {
  const rand = rng(seed ^ 0xa11ce);
  return { L: triangular(rand(), BRIEFING_DELAY.min, BRIEFING_DELAY.mode, BRIEFING_DELAY.max), m: 1 + 0.08 * normal(rand) };
}
