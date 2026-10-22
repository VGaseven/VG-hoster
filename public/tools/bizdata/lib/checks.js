// Result-based SQL checks. A query passes when its output contains the right facts, whatever the column names,
// row order, joins or style used. Expected answers are computed here in JavaScript, independently of any SQL.
import { daysBetween } from "./dataset.js";
import { L } from "../../shared/i18n.js";

const norm = (v) => (v === null || v === undefined ? null : String(v).trim().toUpperCase());
const num = (v) => (typeof v === "number" ? v : v !== null && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);

/** The ground truth for each check, from the raw tables. */
export function expected(scenario) {
  const t = scenario.tables, asOf = t.mission_info[0].as_of_date;
  const product = (id) => t.products.find((p) => p.product_id === norm(id));
  const delayed = t.shipments.filter((s) => s.status !== "arrived" && s.eta_date < asOf);
  const byProduct = {};
  for (const s of delayed) {
    const id = norm(s.product_id), p = product(id);
    byProduct[id] ??= { units: 0, value: 0 };
    byProduct[id].units += s.quantity_units;
    byProduct[id].value += s.quantity_units * p.unit_value_eur;
  }
  const delayedIds = new Set(delayed.map((s) => s.shipment_id));
  const uniqueInvoices = new Map();
  for (const f of t.freight_invoices) if (delayedIds.has(f.shipment_id)) uniqueInvoices.set(f.invoice_id, f.amount_eur);
  const naiveFreight = t.freight_invoices.filter((f) => delayedIds.has(f.shipment_id)).reduce((s, f) => s + f.amount_eur, 0);
  return {
    delayed: new Map(delayed.map((s) => [s.shipment_id, daysBetween(s.eta_date, asOf)])),
    exposure: byProduct,
    freight: [...uniqueInvoices.values()].reduce((s, v) => s + v, 0),
    naiveFreight,
    asOf,
  };
}

export const CHECKS = [
  {
    id: "delayed",
    title: L("Find the delayed shipments", "اعثر على الشحنات المتأخرة"),
    task: L("List every shipment that is delayed on the as-of date: not yet arrived and past its ETA. Show each shipment ID and how many days late it is.", "اعرض كل شحنة متأخرة في تاريخ القرار: لم تصل بعد وتجاوزت موعد وصولها المتوقع. أظهر رقم كل شحنة وعدد أيام تأخرها."),
    predict: L("Before you run it: how many shipments do you expect to be delayed?", "قبل التشغيل: كم شحنة تتوقع أن تكون متأخرة؟"),
    required: true,
    reference: `SELECT s.shipment_id,
       CAST(julianday(m.as_of_date) - julianday(s.eta_date) AS INTEGER) AS days_late
FROM shipments s
CROSS JOIN mission_info m
WHERE s.status <> 'arrived'
  AND s.eta_date < m.as_of_date
ORDER BY days_late DESC;`,
    assisted: `-- Which shipments are delayed on the as-of date (mission_info.as_of_date)?
-- Delayed = not arrived AND the ETA is before the as-of date.
SELECT s.shipment_id,
       CAST(julianday(m.as_of_date) - julianday(s.eta_date) AS INTEGER) AS days_late
FROM shipments s
CROSS JOIN mission_info m
WHERE /* add the two conditions here */ 1 = 1
ORDER BY days_late DESC;`,
    hints: [
      L("Use status, not actual_arrival_date: a blank arrival date does not mean the shipment is late. Three arrived shipments simply have no date keyed in.", "استخدم status وليس actual_arrival_date: تاريخ الوصول الفارغ لا يعني أن الشحنة متأخرة. ثلاث شحنات وصلت لكن لم يُدخل تاريخها."),
      L("Compare dates with the as-of date in mission_info, not with date('now'). The simulation is frozen on 2 March 2026.", "قارن التواريخ بتاريخ القرار في mission_info، لا بـ date('now'). المحاكاة مثبتة على 2 مارس 2026."),
      L("Condition sketch: s.status <> 'arrived' AND s.eta_date < m.as_of_date", "مخطط الشرط: s.status <> 'arrived' AND s.eta_date < m.as_of_date"),
    ],
  },
  {
    id: "exposure",
    title: L("Put a value on the exposure", "قدّر قيمة التعرّض"),
    task: L("For each product with delayed shipments, show the delayed units and the inventory value at risk (units × unit_value_eur). Every delayed shipment must be counted.", "لكل منتج لديه شحنات متأخرة، اعرض الوحدات المتأخرة وقيمة المخزون المعرّضة للخطر (الوحدات × unit_value_eur). يجب احتساب كل شحنة متأخرة."),
    predict: L("Before you run it: roughly what total value (€) is stuck in delayed shipments?", "قبل التشغيل: ما القيمة الإجمالية التقريبية (€) العالقة في الشحنات المتأخرة؟"),
    required: true,
    reference: `SELECT p.product_id,
       p.product_name,
       SUM(s.quantity_units)                    AS delayed_units,
       SUM(s.quantity_units * p.unit_value_eur) AS value_at_risk_eur
FROM shipments s
JOIN products p ON p.product_id = UPPER(TRIM(s.product_id))
CROSS JOIN mission_info m
WHERE s.status <> 'arrived'
  AND s.eta_date < m.as_of_date
GROUP BY p.product_id, p.product_name
ORDER BY value_at_risk_eur DESC;`,
    assisted: `-- Value at risk per product = delayed units × unit_value_eur
SELECT p.product_id,
       SUM(s.quantity_units)                    AS delayed_units,
       SUM(s.quantity_units * p.unit_value_eur) AS value_at_risk_eur
FROM shipments s
JOIN products p ON p.product_id = s.product_id   -- check: does every shipment find its product?
CROSS JOIN mission_info m
WHERE s.status <> 'arrived'
  AND s.eta_date < m.as_of_date
GROUP BY p.product_id
ORDER BY value_at_risk_eur DESC;`,
    hints: [
      L("Count the delayed shipments in your first query, then count the rows that survive the join. If they differ, a key does not match.", "عُدّ الشحنات المتأخرة في استعلامك الأول، ثم عُدّ الصفوف الباقية بعد الربط. إن اختلف العددان، فهناك مفتاح لا يتطابق."),
      L("One shipment's product_id was typed in lower case. An exact-match join silently drops it; try a LEFT JOIN to see it.", "كُتب product_id لإحدى الشحنات بأحرف صغيرة. الربط بالمطابقة التامة يُسقطها دون تنبيه؛ جرّب LEFT JOIN لتراها."),
      L("Normalise the key in the join: p.product_id = UPPER(TRIM(s.product_id))", "وحّد المفتاح في الربط: p.product_id = UPPER(TRIM(s.product_id))"),
    ],
  },
  {
    id: "freight",
    title: L("Data quality: freight already invoiced", "جودة البيانات: الشحن المفوتر سابقًا"),
    task: L("Optional challenge: total freight already invoiced for the delayed shipments, counting each invoice once.", "تحدٍّ اختياري: إجمالي الشحن المفوتر سابقًا للشحنات المتأخرة، مع احتساب كل فاتورة مرة واحدة."),
    predict: L("Before you run it: will a plain SUM over freight_invoices give the right answer?", "قبل التشغيل: هل يعطي SUM مباشر على freight_invoices الإجابة الصحيحة؟"),
    required: false,
    reference: `SELECT SUM(amount_eur) AS freight_invoiced_eur
FROM (
  SELECT DISTINCT f.invoice_id, f.amount_eur
  FROM freight_invoices f
  JOIN shipments s ON s.shipment_id = f.shipment_id
  CROSS JOIN mission_info m
  WHERE s.status <> 'arrived' AND s.eta_date < m.as_of_date
);`,
    assisted: `SELECT SUM(f.amount_eur) AS freight_invoiced_eur
FROM freight_invoices f
JOIN shipments s ON s.shipment_id = f.shipment_id
CROSS JOIN mission_info m
WHERE s.status <> 'arrived' AND s.eta_date < m.as_of_date;
-- Does any invoice_id appear more than once?`,
    hints: [
      L("Group freight_invoices by invoice_id and look for COUNT(*) > 1.", "جمّع freight_invoices حسب invoice_id وابحث عن COUNT(*) > 1."),
      L("Remove exact duplicates before summing: SELECT DISTINCT invoice_id, amount_eur …", "أزل التكرارات المطابقة قبل الجمع: SELECT DISTINCT invoice_id, amount_eur …"),
    ],
  },
];

/** Finds a result column whose values are all (normalised) members of `keys`. */
function keyColumn(result, keys) {
  let best = -1, bestHits = 0;
  result.columns.forEach((_, c) => {
    const vals = result.values.map((r) => norm(r[c]));
    const hits = vals.filter((v) => keys.has(v)).length;
    if (hits > bestHits && hits >= vals.length * 0.5) { best = c; bestHits = hits; }
  });
  return best;
}

/** Grades a query result for one check. Returns { pass, score, messages[], facts } with specific, factual feedback. */
export function grade(checkId, result, scenario, exp = expected(scenario)) {
  const out = { check: checkId, pass: false, messages: [], facts: {} };
  if (!result || !result.columns?.length) { out.messages.push({ kind: "calculation", text: L("The query returned no columns. Run a SELECT that returns rows.", "لم يُعد الاستعلام أي أعمدة. شغّل SELECT يعيد صفوفًا.") }); return out; }
  const traps = scenario.traps;

  if (checkId === "delayed") {
    const all = new Set(scenario.tables.shipments.map((s) => s.shipment_id));
    const c = keyColumn(result, all);
    if (c < 0) { out.messages.push({ kind: "calculation", text: L("No column holds shipment IDs (SH-…). Include s.shipment_id in the SELECT.", "لا يوجد عمود يحمل أرقام الشحنات (SH-…). أضف s.shipment_id إلى SELECT.") }); return out; }
    const ids = result.values.map((r) => norm(r[c]));
    const got = new Set(ids), want = new Set(exp.delayed.keys());
    const missing = [...want].filter((id) => !got.has(id)), extra = [...got].filter((id) => !want.has(id));
    out.facts = { rows: ids.length, unique: got.size, expected: want.size, missing, extra };
    if (ids.length !== got.size) out.messages.push({ kind: "calculation", text: L(`${ids.length - got.size} shipment(s) appear more than once. A join may be multiplying rows.`, `${ids.length - got.size} شحنة تظهر أكثر من مرة. قد يكون الربط يضاعف الصفوف.`) });
    const nullDate = extra.filter((id) => traps.missingArrivalDate.includes(id));
    if (nullDate.length) out.messages.push({ kind: "calculation", text: L(`You counted ${nullDate.join(", ")} as delayed. Their status is 'arrived'; only the arrival date is missing. A blank is not evidence of a delay.`, `احتسبت ${nullDate.join("، ")} كشحنات متأخرة. حالتها 'arrived'؛ تاريخ الوصول فقط هو المفقود. الفراغ ليس دليلًا على التأخير.`) });
    const notDue = extra.filter((id) => !nullDate.includes(id));
    if (notDue.length) out.messages.push({ kind: "calculation", text: L(`${notDue.length} shipment(s) you listed are not delayed on ${exp.asOf} (already arrived, or ETA still in the future): ${notDue.slice(0, 4).join(", ")}${notDue.length > 4 ? "…" : ""}.`, `${notDue.length} شحنة في قائمتك ليست متأخرة في ${exp.asOf} (وصلت فعلًا أو موعد وصولها لم يحن): ${notDue.slice(0, 4).join("، ")}${notDue.length > 4 ? "…" : ""}.`) });
    if (missing.includes(traps.atSeaLate)) out.messages.push({ kind: "calculation", text: L(`${traps.atSeaLate} is still at sea but already past its ETA. Delayed means "not arrived and past ETA", whatever the status says about where it is.`, `${traps.atSeaLate} ما زالت في البحر لكنها تجاوزت موعد وصولها المتوقع. المتأخرة تعني «لم تصل وتجاوزت الموعد المتوقع» أيًا كان مكانها بحسب الحالة.`) });
    const otherMissing = missing.filter((id) => id !== traps.atSeaLate);
    if (otherMissing.length) out.messages.push({ kind: "calculation", text: L(`${otherMissing.length} delayed shipment(s) are missing from your result, e.g. ${otherMissing.slice(0, 3).join(", ")}.`, `${otherMissing.length} شحنة متأخرة غير موجودة في نتيجتك، مثل ${otherMissing.slice(0, 3).join("، ")}.`) });
    // A days-late column must agree with the as-of date for every listed delayed shipment.
    const daysCol = result.columns.findIndex((_, k) => k !== c && result.values.every((r) => { const id = norm(r[c]), v = num(r[k]); return !exp.delayed.has(id) || (v !== null && Math.abs(v - exp.delayed.get(id)) <= 1); }) && result.values.some((r) => num(r[k]) !== null));
    if (daysCol < 0) out.messages.push({ kind: "calculation", text: L("Add a column with days late (as-of date minus ETA). julianday() turns ISO dates into numbers you can subtract.", "أضف عمودًا بعدد أيام التأخير (تاريخ القرار ناقص الموعد المتوقع). تحوّل julianday() تواريخ ISO إلى أرقام يمكن طرحها.") });
    out.pass = !missing.length && !extra.length && ids.length === got.size && daysCol >= 0;
    out.facts.count = got.size;
    return out;
  }

  if (checkId === "exposure") {
    const want = exp.exposure, ids = new Set(Object.keys(want));
    const c = keyColumn(result, new Set(scenario.tables.products.map((p) => p.product_id)));
    if (c < 0) { out.messages.push({ kind: "calculation", text: L("No column holds product IDs (P-…). Group by product_id and include it in the SELECT.", "لا يوجد عمود يحمل أرقام المنتجات (P-…). جمّع حسب product_id وأضفه إلى SELECT.") }); return out; }
    const rows = result.values.map((r) => ({ id: norm(r[c]), r }));
    const valueCol = result.columns.findIndex((_, k) => k !== c && rows.filter((x) => want[x.id]).some((x) => Math.abs((num(x.r[k]) ?? NaN) - want[x.id].value) < 1));
    const lowercaseProduct = norm(scenario.tables.shipments.find((s) => s.shipment_id === traps.lowercaseProduct).product_id);
    const wrong = [];
    for (const id of ids) {
      const row = rows.find((x) => x.id === id);
      const v = row && valueCol >= 0 ? num(row.r[valueCol]) : null;
      if (v === null || Math.abs(v - want[id].value) >= 1) wrong.push({ id, got: v, want: want[id].value });
    }
    const extra = rows.filter((x) => !ids.has(x.id)).map((x) => x.id);
    out.facts = { products: rows.length, expected: ids.size, totalExpected: Object.values(want).reduce((s, x) => s + x.value, 0), wrong, extra };
    if (valueCol < 0) out.messages.push({ kind: "calculation", text: L("No column matches value at risk for any product. Multiply quantity_units by unit_value_eur, then SUM per product.", "لا يطابق أي عمود القيمة المعرّضة للخطر لأي منتج. اضرب quantity_units في unit_value_eur ثم اجمع (SUM) لكل منتج.") });
    else {
      const dropped = wrong.find((w) => w.id === lowercaseProduct && (w.got === null || w.got < w.want));
      if (dropped) out.messages.push({ kind: "calculation", text: L(`${lowercaseProduct} is short by €${Math.round(dropped.want - (dropped.got || 0)).toLocaleString("en-GB")}. Shipment ${traps.lowercaseProduct} stores its product as lower case, so an exact join drops it. Normalise the key (UPPER/TRIM) or check with a LEFT JOIN.`, `${lowercaseProduct} ناقص بمقدار €${Math.round(dropped.want - (dropped.got || 0)).toLocaleString("en-GB")}. الشحنة ${traps.lowercaseProduct} تخزّن منتجها بأحرف صغيرة، فيُسقطها الربط بالمطابقة التامة. وحّد المفتاح (UPPER/TRIM) أو تحقّق باستخدام LEFT JOIN.`) });
      const others = wrong.filter((w) => w !== dropped);
      if (others.length) out.messages.push({ kind: "calculation", text: L(`${others.length} product value(s) differ from the source rows, e.g. ${others[0].id}: you have ${others[0].got === null ? "nothing" : "€" + Math.round(others[0].got).toLocaleString("en-GB")}, the delayed rows add up to €${Math.round(others[0].want).toLocaleString("en-GB")}. Check the delayed filter.`, `${others.length} قيمة منتج تختلف عن صفوف المصدر، مثل ${others[0].id}: لديك ${others[0].got === null ? "لا شيء" : "€" + Math.round(others[0].got).toLocaleString("en-GB")}، ومجموع الصفوف المتأخرة €${Math.round(others[0].want).toLocaleString("en-GB")}. تحقّق من مرشّح التأخير.`) });
    }
    if (extra.length) out.messages.push({ kind: "calculation", text: L(`${extra.length} product(s) in your result have no delayed shipment: ${extra.slice(0, 3).join(", ")}.`, `${extra.length} منتج في نتيجتك ليست له شحنة متأخرة: ${extra.slice(0, 3).join("، ")}.`) });
    out.pass = valueCol >= 0 && !wrong.length && !extra.length;
    out.facts.total = out.facts.totalExpected;
    return out;
  }

  if (checkId === "freight") {
    const values = result.values.flat().map(num).filter((v) => v !== null);
    const right = values.some((v) => Math.abs(v - exp.freight) < 1);
    const doubled = values.some((v) => Math.abs(v - exp.naiveFreight) < 1);
    out.facts = { expected: exp.freight, naive: exp.naiveFreight };
    if (doubled && !right) out.messages.push({ kind: "calculation", text: L(`€${Math.round(exp.naiveFreight).toLocaleString("en-GB")} counts ${traps.duplicateInvoices.length} invoices twice (${traps.duplicateInvoices.join(", ")} were imported twice). Remove exact duplicates before summing.`, `€${Math.round(exp.naiveFreight).toLocaleString("en-GB")} يحتسب ${traps.duplicateInvoices.length} فاتورة مرتين (${traps.duplicateInvoices.join(" و")} استُوردت مرتين). أزل التكرارات المطابقة قبل الجمع.`) });
    else if (!right) out.messages.push({ kind: "calculation", text: L("The total does not match the invoices for delayed shipments. Check the delayed filter and duplicates.", "المجموع لا يطابق فواتير الشحنات المتأخرة. تحقّق من مرشّح التأخير والتكرارات.") });
    out.pass = right;
    return out;
  }
  throw new Error("Unknown check " + checkId);
}
