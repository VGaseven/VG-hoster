// BizData Stack Sandbox (WhatIf): Rotterdam Port Bottleneck. Runs entirely in the browser; reads no Hub data.
// Every visible text is English with its Arabic next to it: L("English", "العربية").
import { L, lang, applyLang, switchLang, dateLocale } from "../shared/i18n.js";
import { buildScenario, toSqlScript, BASE_SEED, SCHEMA, COMPANY, BRIEFING_DELAY, DATASET_VERSION } from "./lib/dataset.js";
import { CHECKS, grade, expected } from "./lib/checks.js";
import { prepare, draws, evaluatePlan, planCash, violations, EMPTY_PLAN, DEFAULT_ASSUMPTIONS, ASSUMPTIONS, simulateOnce, exposedProducts } from "./lib/model.js";
import { evaluate } from "./lib/rubric.js";
import { buildRecord, cvBullets, demonstrated, toMarkdown } from "./lib/portfolio.js";
import { BRIDGE, UNSUPPORTED_NOTE } from "./lib/bridge.js";
import { createStore, download } from "../shared/store.js";

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else if (k === "checked") el.checked = !!v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}
// In Arabic, money is wrapped in a left-to-right isolate (U+2066 … U+2069) so "€12,267" never flips around.
const eur = (v) => { const t = (v < 0 ? "−€" : "€") + Math.round(Math.abs(v)).toLocaleString("en-GB"); return lang() === "ar" ? "\u2066" + t + "\u2069" : t; };
// Display names only; the data tables (and SQL) keep the English product names.
const PRODUCT_AR = { "Oak dining chair": "كرسي طعام من خشب البلوط", "Linen duvet set": "طقم لحاف من الكتان", "Ceramic cookware set": "طقم أواني طهي خزفية", "LED floor lamp": "مصباح أرضي LED", "Wool rug 160x230": "سجادة صوف 160×230", "Glass storage jars (6)": "برطمانات تخزين زجاجية (6)", "Bamboo shelf unit": "وحدة رفوف من الخيزران", "Cotton towel bundle": "مجموعة مناشف قطنية", "Stainless kettle": "غلاية ستانلس", "Outdoor lounger": "كرسي استرخاء خارجي" };
const productName = (name) => L(name, PRODUCT_AR[name] || name);
const pct = (v, d = 1) => (v * 100).toFixed(d) + "%";
const weeks = (n) => L(`${n} weeks`, `${n} أسابيع`);
const say = (text) => { $("live").textContent = ""; requestAnimationFrame(() => ($("live").textContent = text)); };
const store = createStore("bizdata");
const ltr = (el) => { el.setAttribute("dir", "ltr"); return el; }; // code, SQL and IDs stay left-to-right

// ---------- SQL sandbox (Web Worker running SQLite) ----------
class Sandbox {
  constructor(script) { this.script = script; this.pending = null; this.spawn(); }
  spawn() {
    // A blob bootstrap works both opened directly and inside the Hub's sandboxed (opaque-origin) iframe.
    const base = new URL(".", import.meta.url).href;
    Sandbox.url ??= URL.createObjectURL(new Blob([`self.WHATIF_BASE = ${JSON.stringify(base)}; importScripts(${JSON.stringify(base + "sql-worker.js")});`], { type: "text/javascript" }));
    this.worker = new Worker(Sandbox.url);
    this.worker.onmessage = ({ data }) => {
      if (!this.pending || data.id !== this.pending.id) return;
      const { resolve, reject, timer } = this.pending;
      clearTimeout(timer); this.pending = null;
      data.type === "error" ? reject(new Error(data.message)) : resolve(data);
    };
    this.worker.postMessage({ type: "load", script: this.script });
  }
  load(script) { this.script = script; this.worker.postMessage({ type: "load", script }); }
  run(sql, limitMs = 4000) {
    if (this.pending) this.cancel(L("Replaced by a new run.", "استُبدل بتشغيل جديد."));
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2);
      const timer = setTimeout(() => this.cancel(L(`Stopped after ${limitMs / 1000} seconds. Check for a join without a condition or an endless recursive query.`, `توقف بعد ${limitMs / 1000} ثوانٍ. تحقّق من وجود ربط (JOIN) بلا شرط أو استعلام تكراري لا ينتهي.`)), limitMs);
      this.pending = { id, resolve, reject, timer };
      this.worker.postMessage({ type: "run", id, sql });
    });
  }
  cancel(reason = L("Run cancelled.", "أُلغي التشغيل.")) {
    if (!this.pending) return;
    const { reject, timer } = this.pending;
    clearTimeout(timer); this.pending = null;
    this.worker.terminate(); this.spawn(); // a fresh worker and database: nothing from the stopped run survives
    reject(new Error(reason));
  }
}

// ---------- state ----------
const STEPS = [
  { id: "briefing", label: L("Briefing", "الإحاطة") },
  { id: "evidence", label: L("Investigate", "التحقيق") },
  { id: "strategy", label: L("Compare strategies", "مقارنة الاستراتيجيات") },
  { id: "defend", label: L("Decide & defend", "القرار والدفاع") },
  { id: "review", label: L("Review", "المراجعة") },
  { id: "portfolio", label: L("Portfolio", "ملف الأعمال") },
];
const MODE_NAMES = { guided: L("Guided", "موجَّه"), assisted: L("Assisted", "بمساعدة"), independent: L("Independent", "مستقل") };
const S = {};
let sandbox;

function newState(seed, mode) {
  const scenario = buildScenario(seed);
  Object.assign(S, {
    seed, mode, scenario, prep: prepare(scenario), exp: expected(scenario),
    startedAt: new Date().toISOString(), step: S.step || "briefing",
    table: "shipments", filters: { statuses: ["held_at_port", "in_transit"], beforeAsOf: true, product: "" },
    checkId: "delayed", code: {}, dirty: {}, predictions: {}, explanations: {}, results: {}, queries: [],
    hintsShown: {}, hints: 0, revealed: false, viewed: new Set(), evidence: new Set(),
    plan: structuredClone(EMPTY_PLAN), assumptions: { ...DEFAULT_ASSUMPTIONS }, options: [],
    defense: { recommendation: "", claimedCost: "", claimedFillPct: "", claimedP90: "", weakSpot: "", acceptShortfall: false, shortfallReason: "", assumptionNote: "" },
    evaluation: null, record: null,
  });
  S.sample = draws(seed, S.assumptions);
  for (const c of CHECKS) S.code[c.id] = starterCode(c);
}
function starterCode(c) {
  if (S.mode === "guided") { S.revealed = true; return `-- ${L("Worked example: read each line, predict the result, then run it.", "مثال محلول: اقرأ كل سطر وتوقّع النتيجة ثم شغّله.")}\n${c.reference}`; }
  if (S.mode === "assisted") return c.assisted;
  return `-- ${c.task}\n-- ${L("Tables", "الجداول")}: ${Object.keys(S.scenario.tables).join(", ")}\n`;
}

// ---------- KPIs and lineage ----------
function current() { return evaluatePlan(S.prep, S.plan, S.sample); }
function renderKpis() {
  const e = current(), info = S.prep.info;
  const cover = S.prep.products.reduce((s, p) => s + p.onHand, 0) / S.prep.products.reduce((s, p) => s + p.weekly_demand_units, 0);
  const varPassed = S.results.exposure?.grade?.pass;
  const items = [
    { id: "cash", label: L("Emergency cash committed", "النقد الطارئ الملتزم به"), value: `${eur(e.cash)} ${L("of", "من")} ${eur(info.emergency_budget_eur)}`, warn: e.cash > info.emergency_budget_eur },
    { id: "var", label: L("Inventory value at risk", "قيمة المخزون المعرّضة للخطر"), value: varPassed ? eur(Object.values(S.exp.exposure).reduce((s, x) => s + x.value, 0)) : L("Not analysed yet", "لم يُحلَّل بعد"), note: varPassed ? L("From your checked query", "من استعلامك الذي نجح التحقق منه") : L("Run the exposure query", "شغّل استعلام التعرّض") },
    { id: "fill", label: L("Forecast fill rate (8 weeks)", "معدل تلبية الطلب المتوقع (8 أسابيع)"), value: pct(e.expectedFill), note: L(`Target ${pct(info.service_target, 0)} · met in ${pct(e.pServiceMet, 0)} of runs`, `الهدف ${pct(info.service_target, 0)} · تحقق في ${pct(e.pServiceMet, 0)} من المحاكاة`), warn: e.pServiceMet < 0.5 },
    { id: "cost", label: L("Expected disruption cost", "تكلفة الاضطراب المتوقعة"), value: eur(e.expectedCost), note: L(`Range ${eur(e.p10)} – ${eur(e.p90)} (P10–P90)`, `النطاق ${eur(e.p10)} – ${eur(e.p90)} (P10–P90)`) },
    { id: "cover", label: L("Stock cover today", "تغطية المخزون اليوم"), value: weeks(cover.toFixed(1)), note: L("All products, Venlo DC", "كل المنتجات، مركز التوزيع في فينلو") },
    { id: "excess", label: L("Excess stock at week 8", "المخزون الفائض في الأسبوع 8"), value: eur(e.expectedExcess), note: L("Inventory exposure after the crisis", "تعرّض المخزون بعد الأزمة") },
  ];
  $("kpis").replaceChildren(...items.map((k) => h("button", { type: "button", class: "kpi" + (k.warn ? " warn" : ""), onclick: () => openLineage(k.id), "aria-describedby": "simNote" },
    h("span", { class: "kpi-label", text: k.label }), h("span", { class: "kpi-value", text: k.value }), k.note && h("span", { class: "kpi-note", text: k.note }), h("span", { class: "kpi-trace", text: L("Trace →", "تتبّع ←") }))));
}

function tableEl(columns, rows, { max = 60, highlight, data = false } = {}) {
  const wrap = h("div", { class: "table-wrap", tabindex: "0", role: "region", "aria-label": L("Data table", "جدول بيانات") },
    h("table", {}, h("thead", {}, h("tr", {}, columns.map((c) => h("th", { scope: "col", text: c })))),
      h("tbody", {}, rows.slice(0, max).map((r, i) => h("tr", { class: highlight?.(r, i) ? "hl" : null }, r.map((v) => (v === null ? h("td", { class: "null" }, h("span", { class: "null-badge", text: L("blank", "فارغ") })) : h("td", { text: typeof v === "number" && !Number.isInteger(v) ? v.toFixed(2) : String(v) }))))))),
    rows.length > max ? h("p", { class: "muted", text: L(`Showing ${max} of ${rows.length} rows.`, `يُعرض ${max} من ${rows.length} صفًا.`) } ) : null);
  return data ? ltr(wrap) : wrap; // raw data tables keep column order left-to-right, like the SQL
}

function openLineage(id) {
  S.viewed.add(id); save();
  const t = S.scenario.tables, asOf = S.prep.info.as_of_date, body = [];
  const productOf = (s) => t.products.find((p) => p.product_id === s.product_id.trim().toUpperCase());
  const delayed = t.shipments.filter((s) => s.status !== "arrived" && s.eta_date < asOf);
  let title = "";
  const section = (label, ...kids) => h("section", { class: "lin" }, h("h3", { text: label }), ...kids);
  const effect = L("Effect on the decision", "الأثر على القرار");
  if (id === "var") {
    title = L("Inventory value at risk", "قيمة المخزون المعرّضة للخطر");
    if (!S.results.exposure?.grade?.pass) body.push(h("p", { class: "callout", text: L("Run and pass the exposure query first. The trace below shows the rows it should use, so you can check your own result against them.", "شغّل استعلام التعرّض وتحقّق من نجاحه أولًا. يعرض التتبّع أدناه الصفوف التي يجب أن يستخدمها، لتقارن نتيجتك بها.") }));
    const exact = delayed.filter((s) => t.products.some((p) => p.product_id === s.product_id));
    const total = (rows) => rows.reduce((sum, s) => sum + s.quantity_units * productOf(s).unit_value_eur, 0);
    body.push(section(L("Source rows", "صفوف المصدر"), h("p", { text: L(`${delayed.length} delayed shipments (not arrived and ETA before ${asOf}), each joined to its product.`, `${delayed.length} شحنة متأخرة (لم تصل وموعد وصولها المتوقع قبل ${asOf})، كل منها مربوطة بمنتجها.`) }),
      tableEl(["shipment_id", "product_id (as stored)", "status", "eta_date", "quantity_units", "unit_value_eur", "value_eur"], delayed.map((s) => [s.shipment_id, s.product_id, s.status, s.eta_date, s.quantity_units, productOf(s).unit_value_eur, s.quantity_units * productOf(s).unit_value_eur]), { highlight: (r) => r[1] !== r[1].toUpperCase(), data: true })));
    body.push(section(L("Filters and joins", "المرشّحات والروابط"), h("ul", {}, h("li", { text: L("Filter: status <> 'arrived' AND eta_date < as_of_date. A blank actual_arrival_date is not used, because 3 arrived shipments have no date keyed in.", "المرشّح: status <> 'arrived' AND eta_date < as_of_date. لا يُستخدم actual_arrival_date الفارغ، لأن 3 شحنات وصلت دون إدخال تاريخها.") }), h("li", { text: L("Join: shipments → products on UPPER(TRIM(product_id)). One key is stored in lower case (highlighted).", "الربط: shipments ← products على UPPER(TRIM(product_id)). أحد المفاتيح مخزّن بأحرف صغيرة (مظلَّل).") }))));
    body.push(section(L("Formula", "المعادلة"), ltr(h("pre", { class: "code", text: "value at risk = Σ quantity_units × unit_value_eur   over delayed shipments" }))));
    body.push(section(L("Before and after", "قبل وبعد"), h("dl", { class: "ba" }, h("dt", { text: L("Exact-match join (drops the lower-case key)", "ربط بمطابقة تامة (يُسقط المفتاح ذا الأحرف الصغيرة)") }), h("dd", { text: eur(total(exact)) }), h("dt", { text: L("Normalised join (all delayed shipments)", "ربط بعد توحيد المفاتيح (كل الشحنات المتأخرة)") }), h("dd", { text: eur(total(delayed)) }))));
    body.push(section(effect, h("p", { text: L("This is a fact on the as-of date, so no assumption changes it. It sizes the problem: the emergency budget is set at 75% of this value, so you cannot buy full cover for everything.", "هذه حقيقة في تاريخ القرار، فلا يغيّرها أي افتراض. إنها تحدد حجم المشكلة: الميزانية الطارئة تساوي 75% من هذه القيمة، فلا يمكن شراء تغطية كاملة لكل شيء.") })));
  } else if (id === "cash") {
    title = L("Emergency cash committed", "النقد الطارئ الملتزم به");
    const lines = [];
    for (const sid of S.plan.reroute) { const r = S.prep.reroute.find((x) => x.shipment_id === sid); lines.push([L("Reroute ", "إعادة توجيه ") + sid, "reroute_options.extra_cost_eur", r.extra_cost_eur]); }
    for (const p of exposedProducts(S.prep, S.plan)) {
      if (S.plan.backup !== "none" && S.plan.coverWeeks > 0) { const b = S.prep.backup.find((x) => x.product_id === p.product_id && x.supplier.includes(S.plan.backup === "eu" ? "(EU)" : "(TR)")); const u = Math.ceil(p.weekly_demand_units * S.plan.coverWeeks); lines.push([L(`Buy ${u} × ${p.product_id} (${b.supplier})`, `شراء ${u} × ${p.product_id} (${b.supplier})`), `units × ${p.unit_value_eur} × (1 + ${b.premium_pct})`, u * p.unit_value_eur * (1 + b.premium_pct)]); }
      if (S.plan.earlyOrder) lines.push([L(`Early order ${p.product_id}`, `طلب مبكر ${p.product_id}`), `2 weeks × ${p.weekly_demand_units} × ${p.unit_value_eur}`, p.weekly_demand_units * 2 * p.unit_value_eur]);
    }
    if (S.plan.lease) lines.push([L("Lease extra space", "استئجار مساحة إضافية"), `${S.prep.warehouse.lease_cost_eur_week} × ${S.prep.info.horizon_weeks} weeks`, S.prep.warehouse.lease_cost_eur_week * S.prep.info.horizon_weeks]);
    body.push(section(L("Source rows (your current plan)", "صفوف المصدر (خطتك الحالية)"), lines.length ? tableEl([L("Item", "البند"), L("Formula", "المعادلة"), L("Cash (EUR)", "النقد (يورو)")], lines.map((l) => [l[0], l[1], Math.round(l[2])])) : h("p", { text: L("Your plan commits no cash yet.", "خطتك لا تلتزم بأي نقد بعد.") })));
    body.push(section(L("Formula", "المعادلة"), ltr(h("pre", { class: "code", text: `cash = reroute fees + emergency buys at full price + early orders + lease\nlimit: emergency_budget_eur = ${eur(S.prep.info.emergency_budget_eur)} (mission_info)` }))));
    body.push(section(effect, h("p", { text: L("Cash is known in advance and does not depend on the delay. Keeping cash back is a legitimate trade-off against a lower expected cost.", "النقد معروف مسبقًا ولا يعتمد على التأخير. الاحتفاظ بالنقد مفاضلة مشروعة مقابل تكلفة متوقعة أقل.") })));
  } else if (id === "freight") {
    title = L("Freight invoiced for delayed shipments", "الشحن المفوتر للشحنات المتأخرة");
    const ids = new Set(delayed.map((s) => s.shipment_id));
    const rows = t.freight_invoices.filter((f) => ids.has(f.shipment_id));
    body.push(section(L("Source rows", "صفوف المصدر"), tableEl(["invoice_id", "shipment_id", "amount_eur"], rows.map((f) => [f.invoice_id, f.shipment_id, f.amount_eur]), { highlight: (r) => S.scenario.traps.duplicateInvoices.includes(r[0]), data: true })));
    body.push(section(L("Before and after", "قبل وبعد"), h("dl", { class: "ba" }, h("dt", { text: L("Plain SUM", "SUM مباشر") }), h("dd", { text: eur(S.exp.naiveFreight) }), h("dt", { text: L("Each invoice once", "كل فاتورة مرة واحدة") }), h("dd", { text: eur(S.exp.freight) }))));
  } else {
    const e = current();
    title = { fill: L("Forecast fill rate", "معدل التلبية المتوقع"), cost: L("Expected disruption cost", "تكلفة الاضطراب المتوقعة"), cover: L("Stock cover today", "تغطية المخزون اليوم"), excess: L("Excess stock at week 8", "المخزون الفائض في الأسبوع 8") }[id];
    if (id === "cover") {
      body.push(section(L("Source rows", "صفوف المصدر"), tableEl(["product_id", "on_hand_units", "weekly_demand_units", "weeks of cover"], S.prep.products.map((p) => [p.product_id, p.onHand, p.weekly_demand_units, Number((p.onHand / p.weekly_demand_units).toFixed(1))]), { data: true })));
      body.push(section(L("Formula", "المعادلة"), ltr(h("pre", { class: "code", text: "cover = Σ on_hand_units ÷ Σ weekly_demand_units   (inventory joined to products)" }))));
    } else {
      body.push(section(L("Where it comes from", "من أين يأتي"), h("p", { text: L(`The strategy model runs your plan through ${S.sample.length} seeded scenarios of the port delay and demand, week by week, per product. These are the inputs and rules:`, `يمرّر نموذج الاستراتيجيات خطتك عبر ${S.sample.length} سيناريو ثابت البذرة لتأخير الميناء والطلب، أسبوعًا بأسبوع ولكل منتج. هذه هي المدخلات والقواعد:`) }), h("ul", {}, ASSUMPTIONS.map((a) => h("li", { text: a })))));
      const b = e.breakdown;
      body.push(section(L("Breakdown (expected values)", "التفصيل (قيم متوقعة)"), tableEl([L("Component", "المكوّن"), L("EUR", "يورو")], [[L("Lost margin (unmet demand)", "الهامش المفقود (طلب غير ملبّى)"), Math.round(b.lostMargin)], [L("Emergency-buy premium", "علاوة الشراء الطارئ"), Math.round(b.premium)], [L("Reroute fees", "رسوم إعادة التوجيه"), Math.round(b.rerouteFees)], [L("Holding cost", "تكلفة الاحتفاظ بالمخزون"), Math.round(b.holding)], [L("Storage (overflow / lease)", "التخزين (فائض / استئجار)"), Math.round(b.storage)], [L("Markdown on excess", "تخفيض سعر الفائض"), Math.round(b.markdown)], [L("Total", "المجموع"), Math.round(e.expectedCost)]])));
      const at = (Lw) => simulateOnce(S.prep, S.plan, Lw, 1);
      body.push(section(L("How an assumption changes it", "كيف يغيّره افتراض واحد"), tableEl([L("If the port releases after", "إذا أفرج الميناء بعد"), L("Cost of your plan", "تكلفة خطتك"), L("Fill rate", "معدل التلبية")], [2, 3, 4, 5, 6].map((Lw) => [weeks(Lw), Math.round(at(Lw).total), pct(at(Lw).fillRate)])),
        h("p", { class: "muted", text: L("Compare this with another plan in Compare strategies: the plan that is cheapest at 2 weeks is often not the cheapest at 6.", "قارن ذلك بخطة أخرى في مقارنة الاستراتيجيات: الخطة الأرخص عند أسبوعين ليست غالبًا الأرخص عند 6 أسابيع.") })));
    }
  }
  $("lineageTitle").textContent = L("Trace: ", "تتبّع: ") + title;
  $("lineageBody").replaceChildren(h("p", { class: "sim-tag", text: L("Simulated figures for a fictional company.", "أرقام محاكاة لشركة خيالية.") }), ...body);
  $("lineage").showModal();
}

// ---------- steps ----------
function renderSteps() {
  $("steps").replaceChildren(...STEPS.map((s, i) => h("li", {}, h("button", { type: "button", class: "step-btn", "aria-current": s.id === S.step ? "step" : null, onclick: () => go(s.id) }, h("span", { class: "step-no", text: String(i + 1) }), s.label))));
}
function go(step, { focus = true } = {}) {
  S.step = step; save();
  for (const s of STEPS) $("step-" + s.id).hidden = s.id !== step;
  renderSteps();
  ({ briefing: renderBriefing, evidence: renderEvidence, strategy: renderStrategy, defend: renderDefend, review: renderReview, portfolio: renderPortfolio })[step]();
  const heading = $("h-" + step);
  if (heading) { heading.tabIndex = -1; if (focus) heading.focus({ preventScroll: false }); }
}

function renderBriefing() {
  const info = S.prep.info, t = S.scenario.tables;
  const held = t.shipments.filter((s) => s.status === "held_at_port").length;
  $("step-briefing").replaceChildren(
    h("h2", { id: "h-briefing", text: L("COO briefing", "إحاطة مدير العمليات") }),
    h("article", { class: "memo" },
      h("p", { class: "memo-head" }, h("strong", { text: L("From: ", "من: ") }), L("Sanne de Vries, Chief Operating Officer · ", "سانه دي فريس، مديرة العمليات · "), h("strong", { text: L("To: ", "إلى: ") }), L("You, supply-chain analyst · ", "أنت، محلل سلاسل الإمداد · "), h("strong", { text: L("Date: ", "التاريخ: ") }), info.as_of_date),
      h("p", { class: "memo-head" }, h("strong", { text: L("Company: ", "الشركة: ") }), COMPANY.name, L(" (fictional). ", " (خيالية). "), L(COMPANY.note, "مستورد خيالي متوسط الحجم للأدوات المنزلية. يشتري من آسيا، ويشحن عبر روتردام، ويبيع من مركز توزيع واحد في فينلو لشركاء التجزئة.")),
      h("h3", { text: L("The problem", "المشكلة") }),
      h("p", { text: L(`Congestion at Rotterdam is holding ${held} of our containers at the terminal, and at least one vessel is late at sea. The port's latest estimate is that the backlog clears in ${BRIEFING_DELAY.min} to ${BRIEFING_DELAY.max} weeks, most likely ${BRIEFING_DELAY.mode}. Our Venlo DC has only one to three weeks of stock on most lines.`, `يحتجز الازدحام في روتردام ${held} من حاوياتنا في المحطة، وسفينة واحدة على الأقل متأخرة في البحر. آخر تقدير للميناء أن التراكم سيُحل خلال ${BRIEFING_DELAY.min} إلى ${BRIEFING_DELAY.max} أسابيع، والأرجح ${BRIEFING_DELAY.mode}. لدى مركز التوزيع في فينلو مخزون يكفي أسبوعًا إلى ثلاثة أسابيع فقط لمعظم المنتجات.`) }),
      h("p", { class: "fictional-news", text: L("Port Ledger Daily (fictional outlet): “Terminal backlog: carriers warn of multi-week releases.”", "«بورت ليدجر ديلي» (وسيلة إعلامية خيالية): «تراكم في المحطة: الناقلون يحذّرون من إفراج يستغرق أسابيع.»") }),
      h("h3", { text: L("Your decision", "قرارك") }),
      h("p", { text: L("Should we reroute selected containers via Antwerp, buy safety stock from a backup supplier, bring forward the next regular order, lease extra warehouse space, or combine these?", "هل نعيد توجيه حاويات مختارة عبر أنتويرب، أم نشتري مخزون أمان من مورّد احتياطي، أم نقدّم موعد الطلب المعتاد التالي، أم نستأجر مساحة تخزين إضافية، أم نجمع بين ذلك؟") }),
      h("h3", { text: L("Constraints", "القيود") }),
      h("ul", {}, h("li", { text: L(`Emergency cash: up to ${eur(info.emergency_budget_eur)}.`, `النقد الطارئ: حتى ${eur(info.emergency_budget_eur)}.`) }), h("li", { text: L(`Antwerp barge slots this week: ${info.antwerp_slots} containers.`, `خانات النقل النهري من أنتويرب هذا الأسبوع: ${info.antwerp_slots} حاويات.`) }), h("li", { text: L(`Service target: ${pct(info.service_target, 0)} fill rate over the next ${info.horizon_weeks} weeks.`, `هدف الخدمة: معدل تلبية ${pct(info.service_target, 0)} خلال ${info.horizon_weeks} أسابيع القادمة.`) }), h("li", { text: L(`DC space: ${S.prep.warehouse.free_pallet_positions} free pallet positions; overflow costs €${S.prep.warehouse.overflow_rate_eur_pallet_week} per pallet per week.`, `مساحة المركز: ${S.prep.warehouse.free_pallet_positions} موضع منصّة فارغ؛ التخزين الإضافي يكلّف €${S.prep.warehouse.overflow_rate_eur_pallet_week} لكل منصّة أسبوعيًا.`) })),
      h("h3", { text: L("Evidence you have", "الأدلة المتاحة لك") }),
      h("p", { text: L("Shipment, product, inventory, freight-invoice, reroute-quote, backup-supplier and warehouse tables from our systems. Treat them with care: they were exported quickly and have not been cleaned.", "جداول الشحنات والمنتجات والمخزون وفواتير الشحن وعروض إعادة التوجيه والمورّدين الاحتياطيين والمستودع من أنظمتنا. تعامل معها بحذر: صُدّرت على عجل ولم تُنظَّف.") }),
      h("h3", { text: L("What I need from you", "ما أحتاجه منك") }),
      h("p", { text: L("A recommendation I can take to the board: what to do, what it costs in cash and expected cost, what service we should expect, which evidence supports it, and when it would turn out to be the wrong call.", "توصية أقدّمها لمجلس الإدارة: ماذا نفعل، وكم تكلّف نقدًا وتكلفةً متوقعة، وأي مستوى خدمة نتوقع، وأي أدلة تدعمها، ومتى قد يتبيّن أنها القرار الخطأ.") })),
    h("section", { class: "card" }, h("h3", { text: L("How this mission works", "كيف تعمل هذه المهمة") }),
      h("ol", {}, h("li", { text: L("Investigate: inspect the tables and run SQL to find delayed shipments and the value at risk.", "التحقيق: افحص الجداول وشغّل SQL لإيجاد الشحنات المتأخرة والقيمة المعرّضة للخطر.") }), h("li", { text: L("Compare strategies: build at least two plans and compare them under the same assumptions.", "مقارنة الاستراتيجيات: ابنِ خطتين على الأقل وقارن بينهما بالافتراضات نفسها.") }), h("li", { text: L("Decide and defend: link your evidence, state your numbers and the risks.", "القرار والدفاع: اربط أدلتك واذكر أرقامك والمخاطر.") }), h("li", { text: L("Review: get feedback on your analysis and decision, separately from what happened by chance.", "المراجعة: احصل على ملاحظات حول تحليلك وقرارك، منفصلة عمّا حدث بالصدفة.") }), h("li", { text: L("Save a private, replayable record, then try a fresh variant on your own.", "احفظ سجلًا خاصًا قابلًا لإعادة التشغيل، ثم جرّب نسخة جديدة بنفسك.") })),
      h("p", { class: "muted", text: L("You can explore strategies at any time. Final submission needs checked evidence.", "يمكنك استكشاف الاستراتيجيات في أي وقت. التقديم النهائي يتطلب أدلة تم التحقق منها.") })),
    honestyCard(),
    modeCard());
}

function honestyCard() {
  return h("section", { class: "card honesty" }, h("h3", { text: L("What is real here and what is simulated", "ما الحقيقي هنا وما المحاكى") }),
    h("ul", {},
      h("li", {}, h("strong", { text: L("Real: ", "حقيقي: ") }), L("your SQL runs in real SQLite (sql.js, WebAssembly) inside your browser, on an isolated read-only copy of the mission data. Results are checked by comparing what your query returns.", "يعمل SQL الخاص بك على SQLite حقيقي (sql.js وWebAssembly) داخل متصفحك، على نسخة معزولة للقراءة فقط من بيانات المهمة. يُتحقق من النتائج بمقارنة ما يعيده استعلامك.")),
      h("li", {}, h("strong", { text: L("Simulated: ", "محاكى: ") }), L("the company, its data, the port delay and every outcome. The strategy forecast is a transparent teaching model with seeded randomness, not a prediction of any real port or market.", "الشركة وبياناتها وتأخير الميناء وكل النتائج. توقعات الاستراتيجيات نموذج تعليمي شفاف بعشوائية ثابتة البذرة، وليست تنبؤًا لأي ميناء أو سوق حقيقي.")),
      h("li", {}, h("strong", { text: L("Shown only: ", "للعرض فقط: ") }), L("R and Python equivalents in the Excel bridge are not executed in this release. No SAP, EViews, Excel or Power BI product is included or connected.", "مكافئات R وPython في جسر Excel لا تُنفَّذ في هذا الإصدار. لا يتضمن الأداة أو يتصل بها أي منتج من SAP أو EViews أو Excel أو Power BI."))));
}

function modeCard() {
  const fresh = S.seed !== BASE_SEED;
  return h("section", { class: "card" }, h("h3", { text: L("Learning modes", "أنماط التعلّم") }),
    h("dl", { class: "modes" },
      h("dt", { text: MODE_NAMES.guided }), h("dd", { text: L("Spreadsheet-style filters first, then annotated worked queries and every hint shown.", "مرشّحات بأسلوب جداول البيانات أولًا، ثم استعلامات محلولة مشروحة وكل التلميحات ظاهرة.") }),
      h("dt", { text: MODE_NAMES.assisted }), h("dd", { text: L("Query templates to complete, with optional hints. Hints used are recorded.", "قوالب استعلام لإكمالها، مع تلميحات اختيارية. يُسجَّل استخدام التلميحات.") }),
      h("dt", { text: MODE_NAMES.independent }), h("dd", { text: L("A fresh dataset, a blank editor and no hints, to show you can transfer the skill.", "مجموعة بيانات جديدة ومحرر فارغ وبلا تلميحات، لتُظهر قدرتك على نقل المهارة.") })),
    h("p", {}, L(`Dataset ${DATASET_VERSION}, seed ${S.seed} (${fresh ? "fresh variant" : "base mission"}). `, `مجموعة البيانات ${DATASET_VERSION}، البذرة ${S.seed} (${fresh ? "نسخة جديدة" : "المهمة الأساسية"}). `)),
    h("button", { type: "button", onclick: () => freshVariant() }, fresh ? L("Start another fresh variant", "ابدأ نسخة جديدة أخرى") : L("Start a fresh variant", "ابدأ نسخة جديدة")),
    h("p", { class: "muted", text: L("Your record shows the mode, the dataset and the help you used. Only work on a fresh variant without hints counts as independent.", "يُظهر سجلك النمط ومجموعة البيانات والمساعدة التي استخدمتها. لا يُحتسب مستقلًا إلا العمل على نسخة جديدة دون تلميحات.") }));
}

function freshVariant() {
  if (!confirm(L("Start a fresh variant? Your current work on this dataset stays in your portfolio only if you submitted it.", "بدء نسخة جديدة؟ يبقى عملك الحالي على هذه البيانات في ملف أعمالك فقط إذا كنت قد قدّمته."))) return;
  const seed = 100000 + Math.floor(Math.random() * 899999);
  start(seed, S.mode, "briefing");
  say(L(`Fresh variant ready: seed ${seed}.`, `النسخة الجديدة جاهزة: البذرة ${seed}.`));
}

// ---------- Investigate ----------
function renderEvidence() {
  const sec = $("step-evidence");
  sec.replaceChildren(h("h2", { id: "h-evidence", text: L("Investigate the evidence", "تحقّق من الأدلة") }),
    h("div", { class: "cols" }, h("div", { id: "explorer", class: "card" }), h("div", { id: "quality", class: "card" })),
    h("details", { id: "drawer", class: "card drawer", open: true }, h("summary", {}, h("span", { class: "drawer-title", text: L("Explore the data", "استكشف البيانات") }), h("span", { class: "muted", text: L(" · run SQL against the mission tables", " · شغّل SQL على جداول المهمة") })), h("div", { id: "workbench" })),
    h("details", { class: "card drawer" }, h("summary", {}, h("span", { class: "drawer-title", text: L("Excel ↔ code bridge", "جسر Excel ↔ الشيفرة") }), h("span", { class: "muted", text: L(" · the same business question in Excel, SQL, R and Python", " · السؤال التجاري نفسه في Excel وSQL وR وPython") })), bridgeEl()));
  renderExplorer(); renderQuality(); renderWorkbench();
}

function renderExplorer() {
  const t = S.scenario.tables, rows = t[S.table], cols = Object.keys(rows[0]), doc = SCHEMA[S.table] || {};
  const nulls = cols.map((c) => rows.filter((r) => r[c] === null).length);
  let shown = rows;
  const spreadsheet = S.table === "shipments" && S.mode !== "independent";
  if (spreadsheet) {
    const f = S.filters, asOf = S.prep.info.as_of_date;
    shown = rows.filter((r) => f.statuses.includes(r.status) && (!f.beforeAsOf || r.eta_date < asOf) && (!f.product || r.product_id === f.product));
  }
  const box = $("explorer");
  box.replaceChildren(h("h3", { text: L("Evidence explorer", "مستكشف الأدلة") }),
    h("label", { for: "tablePick", text: L("Table", "الجدول") }),
    ltr(h("select", { id: "tablePick", onchange: (e) => { S.table = e.target.value; save(); renderExplorer(); } }, Object.keys(t).map((k) => h("option", { value: k, selected: k === S.table ? true : null, text: `${k} (${t[k].length} ${L("rows", "صفًا")})` })))),
    h("p", { class: "muted", text: doc._about || "" }),
    h("details", {}, h("summary", { text: L("Column definitions and missing values", "تعريفات الأعمدة والقيم المفقودة") }), h("dl", { class: "schema" }, cols.flatMap((c, i) => [h("dt", {}, ltr(h("span", { text: c })), nulls[i] ? h("span", { class: "null-badge", text: L(`${nulls[i]} blank`, `${nulls[i]} فارغ`) }) : null), h("dd", { text: doc[c] || "" })]))),
    spreadsheet ? filterBar() : null,
    spreadsheet ? h("p", { class: "sumifs", id: "sumifs" }) : null,
    tableEl(cols, shown.map((r) => cols.map((c) => r[c])), { highlight: (r) => r.includes(null), data: true }));
  if (spreadsheet) updateSumifs(shown);
}
function filterBar() {
  const f = S.filters, statuses = ["arrived", "in_transit", "held_at_port"];
  const products = [...new Set(S.scenario.tables.shipments.map((s) => s.product_id))].sort();
  const changed = () => { save(); renderExplorer(); };
  return h("fieldset", { class: "filters" }, h("legend", { text: L("Spreadsheet filters (like AutoFilter)", "مرشّحات جدول البيانات (مثل التصفية التلقائية)") }),
    h("div", { class: "filter-row" }, statuses.map((s) => h("label", {}, h("input", { type: "checkbox", checked: f.statuses.includes(s), onchange: (e) => { f.statuses = e.target.checked ? [...f.statuses, s] : f.statuses.filter((x) => x !== s); changed(); } }), " status = ", ltr(h("span", { text: s }))))),
    h("label", {}, h("input", { type: "checkbox", checked: f.beforeAsOf, onchange: (e) => { f.beforeAsOf = e.target.checked; changed(); } }), L(` ETA before the as-of date (${S.prep.info.as_of_date})`, ` موعد الوصول المتوقع قبل تاريخ القرار (${S.prep.info.as_of_date})`)),
    h("label", {}, " product_id ", h("select", { onchange: (e) => { f.product = e.target.value; changed(); } }, h("option", { value: "", text: L("(all)", "(الكل)") }), products.map((p) => h("option", { value: p, selected: f.product === p ? true : null, text: p })))),
    h("div", { class: "filter-actions" }, h("button", { type: "button", class: "ghost", onclick: () => useFiltersAsSql() }, L("Use these filters as SQL", "حوّل هذه المرشّحات إلى SQL"))));
}
function filterSql() {
  const f = S.filters, w = [];
  if (f.statuses.length) w.push(`status IN (${f.statuses.map((s) => `'${s}'`).join(", ")})`); else w.push("1 = 0");
  if (f.beforeAsOf) w.push(`eta_date < '${S.prep.info.as_of_date}'`);
  if (f.product) w.push(`product_id = '${f.product}'`);
  return `-- ${L("Generated from the spreadsheet filters", "أُنشئ من مرشّحات جدول البيانات")}\nSELECT shipment_id, product_id, status, eta_date,\n       CAST(julianday('${S.prep.info.as_of_date}') - julianday(eta_date) AS INTEGER) AS days_late,\n       quantity_units\nFROM shipments\nWHERE ${w.join("\n  AND ")};`;
}
function updateSumifs(rows) {
  const units = rows.reduce((s, r) => s + r.quantity_units, 0);
  $("sumifs").replaceChildren(h("strong", { text: L(`${rows.length} rows · ${units.toLocaleString("en-GB")} units`, `${rows.length} صفًا · ${units.toLocaleString("en-GB")} وحدة`) }), " · Excel: ", ltr(h("code", { text: `=COUNTIFS(...)` })), L(" and ", " و"), ltr(h("code", { text: `=SUMIFS(quantity_units, ...)` })), L(" give the same numbers.", " تعطيان الأرقام نفسها."));
}
function useFiltersAsSql() {
  const id = "delayed";
  if (S.dirty[id] && !confirm(L("Your edited query will be replaced by the one generated from the filters. Continue?", "سيُستبدل استعلامك المعدَّل بالاستعلام المُنشأ من المرشّحات. متابعة؟"))) { say(L("Your edited query was kept.", "احتُفظ باستعلامك المعدَّل.")); return; }
  S.checkId = id; S.code[id] = filterSql(); S.dirty[id] = true; save();
  renderWorkbench(); $("drawer").open = true; $("editor").focus();
  say(L("The filters are now a SQL query in the editor.", "أصبحت المرشّحات استعلام SQL في المحرر."));
}

function renderQuality() {
  const box = $("quality"), traps = S.scenario.traps;
  const level = S.mode === "guided" ? "full" : S.mode === "assisted" ? "hint" : "none";
  box.replaceChildren(h("h3", { text: L("Data quality", "جودة البيانات") }),
    h("p", { text: L("These exports have not been cleaned. Look for problems before you trust a number, and decide what each problem means rather than deleting rows.", "لم تُنظَّف هذه البيانات المصدّرة. ابحث عن المشكلات قبل أن تثق بأي رقم، وقرّر ماذا تعني كل مشكلة بدل حذف الصفوف.") }),
    level === "none" ? h("p", { class: "muted", text: L("Independent mode: no pointers. Use the column definitions and your queries.", "النمط المستقل: بلا إرشادات. استخدم تعريفات الأعمدة واستعلاماتك.") }) :
      h("ul", {}, [
        level === "full" ? L(`${traps.missingArrivalDate.length} shipments have status 'arrived' but a blank actual_arrival_date. A blank is a missing record, not a delay.`, `${traps.missingArrivalDate.length} شحنات حالتها 'arrived' لكن actual_arrival_date فارغ. الفراغ سجل ناقص، وليس تأخيرًا.`) : L("Some arrival dates are blank. Does a blank mean late?", "بعض تواريخ الوصول فارغة. هل يعني الفراغ تأخيرًا؟"),
        level === "full" ? L(`Shipment ${traps.lowercaseProduct} stores its product_id in lower case, so an exact join to products drops it.`, `الشحنة ${traps.lowercaseProduct} تخزّن product_id بأحرف صغيرة، فيُسقطها الربط بالمطابقة التامة مع products.`) : L("Does every shipment find its product when you join?", "هل تجد كل شحنة منتجها عند الربط؟"),
        level === "full" ? L(`Invoices ${traps.duplicateInvoices.join(" and ")} were imported twice into freight_invoices.`, `الفاتورتان ${traps.duplicateInvoices.join(" و")} استُوردتا مرتين إلى freight_invoices.`) : L("Are there invoices that appear more than once?", "هل توجد فواتير تظهر أكثر من مرة؟"),
        level === "full" ? L(`${traps.atSeaLate} is past its ETA but still at sea ('in_transit'). It is delayed, but cannot be rerouted.`, `${traps.atSeaLate} تجاوزت موعد وصولها المتوقع لكنها ما زالت في البحر ('in_transit'). إنها متأخرة، لكن لا يمكن إعادة توجيهها.`) : L("Is every late shipment at the port?", "هل كل شحنة متأخرة موجودة في الميناء؟"),
      ].map((x) => h("li", { text: x }))),
    h("button", { type: "button", class: "ghost", onclick: () => openLineage("freight") }, L("Trace the freight-invoice total", "تتبّع إجمالي فواتير الشحن")));
}

function renderWorkbench() {
  const c = CHECKS.find((x) => x.id === S.checkId), r = S.results[c.id];
  const wb = $("workbench");
  const hintsAllowed = S.mode === "assisted", shown = S.hintsShown[c.id] || 0;
  wb.replaceChildren(
    h("div", { class: "task-tabs", role: "tablist", "aria-label": L("Analysis tasks", "مهام التحليل") }, CHECKS.map((x) => h("button", { type: "button", role: "tab", "aria-selected": String(x.id === c.id), class: "task-tab", onclick: () => { S.checkId = x.id; save(); renderWorkbench(); } },
      x.title, S.results[x.id]?.grade ? h("span", { class: "badge " + (S.results[x.id].grade.pass ? "ok" : "no"), text: S.results[x.id].grade.pass ? L("✓ checked", "✓ تم التحقق") : L("not yet", "ليس بعد") }) : null, x.required ? null : h("span", { class: "badge", text: L("optional", "اختياري") })))),
    h("p", { class: "task", text: c.task }),
    h("label", { for: "predict", text: c.predict }),
    h("input", { id: "predict", type: "text", value: S.predictions[c.id] || "", oninput: (e) => { S.predictions[c.id] = e.target.value; save(); } }),
    h("label", { for: "editor", text: L("SQL (SQLite). Ctrl+Enter or ⌘+Enter runs it. Tab indents; press Esc first to move focus out.", "SQL (SQLite). اضغط Ctrl+Enter أو ⌘+Enter للتشغيل. Tab يضيف مسافة بادئة؛ اضغط Esc أولًا للخروج من المحرر.") }),
    ltr(h("textarea", { id: "editor", class: "editor", spellcheck: "false", autocapitalize: "off", autocomplete: "off", rows: "14", value: S.code[c.id],
      oninput: (e) => { S.code[c.id] = e.target.value; S.dirty[c.id] = true; save(); }, onkeydown: editorKeys })),
    h("div", { class: "wb-actions" },
      h("button", { type: "button", class: "primary", id: "runBtn", onclick: runCurrent }, L("Run query", "شغّل الاستعلام")),
      h("button", { type: "button", id: "cancelBtn", disabled: true, onclick: () => sandbox.cancel() }, L("Cancel", "إلغاء")),
      h("button", { type: "button", class: "ghost", onclick: () => { if (S.dirty[c.id] && !confirm(L("Replace your query with the starting version?", "استبدال استعلامك بالنسخة الأولى؟"))) return; S.code[c.id] = starterCode(c); S.dirty[c.id] = false; save(); renderWorkbench(); } }, L("Reset query", "إعادة ضبط الاستعلام")),
      hintsAllowed && shown < c.hints.length ? h("button", { type: "button", class: "ghost", onclick: () => { S.hintsShown[c.id] = shown + 1; S.hints++; save(); renderWorkbench(); } }, L(`Hint ${shown + 1} of ${c.hints.length}`, `تلميح ${shown + 1} من ${c.hints.length}`)) : null,
      hintsAllowed ? h("button", { type: "button", class: "ghost", onclick: () => { if (!confirm(L("Show the reference query? Your record will note that you saw it.", "عرض الاستعلام المرجعي؟ سيذكر سجلك أنك اطلعت عليه."))) return; S.revealed = true; S.code[c.id] = c.reference; S.dirty[c.id] = true; save(); renderWorkbench(); } }, L("Show a reference query", "اعرض استعلامًا مرجعيًا")) : null),
    S.mode === "guided" ? h("ul", { class: "hints" }, c.hints.map((x) => h("li", { text: x }))) : null,
    hintsAllowed && shown ? h("ul", { class: "hints" }, c.hints.slice(0, shown).map((x) => h("li", { text: x }))) : null,
    h("div", { id: "resultBox", "aria-live": "polite" }, r ? resultEl(c, r) : h("p", { class: "muted", text: L("Run the query to see the result and the check.", "شغّل الاستعلام لترى النتيجة والتحقق.") })));
}
function editorKeys(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); runCurrent(); return; }
  if (e.key === "Escape") { e.target.dataset.esc = "1"; return; }
  if (e.key === "Tab" && !e.shiftKey && e.target.dataset.esc !== "1") { e.preventDefault(); e.target.setRangeText("  ", e.target.selectionStart, e.target.selectionEnd, "end"); e.target.dispatchEvent(new Event("input")); }
  e.target.dataset.esc = "";
}
async function runCurrent() {
  const c = CHECKS.find((x) => x.id === S.checkId), sql = S.code[c.id];
  $("runBtn").disabled = true; $("cancelBtn").disabled = false;
  $("resultBox").replaceChildren(h("p", { class: "muted", text: L("Running in the sandbox…", "يجري التشغيل في بيئة العزل…") }));
  try {
    const res = await sandbox.run(sql);
    const g = grade(c.id, res, S.scenario, S.exp);
    S.results[c.id] = { result: res, grade: g, sql, at: new Date().toISOString() };
    S.queries.push({ check: c.id, sql, pass: g.pass, ms: res.ms, rows: res.rowCount, at: S.results[c.id].at });
    say(g.pass ? L("Query checked: correct.", "تم التحقق من الاستعلام: صحيح.") : L("Query ran. The check found something to fix.", "اشتغل الاستعلام. وجد التحقق ما يحتاج إلى إصلاح."));
  } catch (err) {
    S.results[c.id] = { error: err.message, sql };
    S.queries.push({ check: c.id, sql, pass: false, error: err.message, at: new Date().toISOString() });
    say(L("The query did not run: ", "لم يعمل الاستعلام: ") + err.message);
  }
  save(); renderWorkbench(); renderKpis();
}
function resultEl(c, r) {
  if (r.error) return h("div", { class: "result error", role: "alert" }, h("strong", { text: L("The query did not run. ", "لم يعمل الاستعلام. ") }), r.error);
  const g = r.grade, f = g.facts || {};
  const actual = c.id === "delayed" ? f.count ?? f.unique : c.id === "exposure" ? (f.total ? eur(f.total) : null) : null;
  const n = r.result.rowCount;
  return h("div", { class: "result" },
    h("p", { class: "muted", text: L(`${n} row${n === 1 ? "" : "s"} · ${r.result.ms} ms · real SQLite in your browser${r.result.truncated ? " · first 1,000 rows shown" : ""}`, `${n} صف · ${r.result.ms} ملّي ثانية · SQLite حقيقي في متصفحك${r.result.truncated ? " · تُعرض أول 1,000 صف" : ""}`) }),
    tableEl(r.result.columns, r.result.values, { max: 50, data: true }),
    h("div", { class: "check " + (g.pass ? "ok" : "no") }, h("strong", { text: g.pass ? L("Check passed: the result matches the source data.", "نجح التحقق: النتيجة تطابق بيانات المصدر.") : L("Check: not yet.", "التحقق: ليس بعد.") }),
      g.messages.length ? h("ul", {}, g.messages.map((m) => h("li", { text: m.text }))) : null),
    S.predictions[c.id] && g.pass && actual !== null ? h("p", { class: "predict" }, h("strong", { text: L("Predict → run: ", "توقّع ← تشغيل: ") }), L(`you predicted "${S.predictions[c.id]}"; the checked result is ${actual}.`, `توقعت «${S.predictions[c.id]}»؛ والنتيجة التي تم التحقق منها ${actual}.`)) : null,
    h("label", { for: "explain", text: L("Explain: what does this result mean for the business? (one or two sentences)", "اشرح: ماذا تعني هذه النتيجة للشركة؟ (جملة أو جملتان)") }),
    h("textarea", { id: "explain", rows: "2", value: S.explanations[c.id] || "", oninput: (e) => { S.explanations[c.id] = e.target.value; save(); } }),
    h("label", { class: "inline" }, h("input", { type: "checkbox", checked: S.evidence.has("check:" + c.id), onchange: (e) => { e.target.checked ? S.evidence.add("check:" + c.id) : S.evidence.delete("check:" + c.id); save(); } }), L(" Link this result as evidence for my recommendation", " اربط هذه النتيجة كدليل لتوصيتي")));
}

function bridgeEl() {
  return h("div", { class: "bridge" }, h("p", { class: "muted", text: UNSUPPORTED_NOTE }),
    BRIDGE.map((b) => h("article", { class: "bridge-item" }, h("h4", { text: b.concept }), h("p", { text: b.business }),
      h("div", { class: "bridge-grid" },
        codeCard("Excel", b.excel, L("Formula (not executed here)", "معادلة (لا تُنفَّذ هنا)")),
        codeCard("SQL", b.sql, L("Runs in the sandbox", "تعمل في بيئة العزل"), () => { const id = S.checkId; if (S.dirty[id] && !confirm(L("Replace your edited query with this example?", "استبدال استعلامك المعدَّل بهذا المثال؟"))) return; S.code[id] = `-- Excel bridge: ${b.concept}\n${b.sql}`; S.dirty[id] = true; save(); renderWorkbench(); $("drawer").open = true; $("editor").focus(); }),
        codeCard("R (dplyr)", b.r, L("Shown only, not executed", "للعرض فقط، لا يُنفَّذ")),
        codeCard("Python (pandas)", b.python, L("Shown only, not executed", "للعرض فقط، لا يُنفَّذ"))),
      h("h5", { text: L("Differences that matter", "فروق مهمة") }), h("ul", {}, b.differences.map((d) => h("li", { text: d }))))));
}
function codeCard(name, code, note, action) {
  return h("figure", { class: "code-card" }, h("figcaption", {}, h("strong", { text: name }), " · ", note), ltr(h("pre", { class: "code", text: code })), action ? h("button", { type: "button", class: "ghost", onclick: action }, L("Open in the editor", "افتح في المحرر")) : null);
}

// ---------- Compare strategies ----------
function renderStrategy() {
  $("step-strategy").replaceChildren(h("h2", { id: "h-strategy", text: L("Compare strategies", "مقارنة الاستراتيجيات") }),
    h("p", { class: "muted", text: L("Explore freely. Every option below is run through the same seeded scenarios, so differences come from the plan, not from luck.", "استكشف بحرية. كل خيار أدناه يمر عبر السيناريوهات نفسها ثابتة البذرة، فالفروق تأتي من الخطة لا من الحظ.") }),
    h("div", { class: "cols wide" }, h("div", { id: "planner", class: "card" }), h("div", { id: "forecast", class: "card" })));
  renderPlanner(); renderForecast();
}
function renderPlanner() {
  const p = S.plan, info = S.prep.info, box = $("planner");
  const heldRows = S.prep.reroute.map((r) => { const s = S.prep.products.flatMap((x) => x.delayed.map((d) => ({ ...d, prod: x }))).find((d) => d.shipment_id === r.shipment_id); return { r, s }; });
  const changed = () => { save(); renderForecast(); renderKpis(); renderPlannerStatus(); };
  const coverText = () => L(`Weeks of demand to buy for each exposed product: ${p.coverWeeks}`, `أسابيع الطلب التي تُشترى لكل منتج معرّض: ${p.coverWeeks}`);
  box.replaceChildren(h("h3", { text: L("Build a plan", "ابنِ خطة") }),
    h("fieldset", {}, h("legend", { text: L(`Reroute via Antwerp (choose up to ${info.antwerp_slots})`, `إعادة التوجيه عبر أنتويرب (اختر حتى ${info.antwerp_slots})`) }),
      h("p", { id: "slotStatus", class: "muted" }),
      h("div", { class: "reroute-list" }, heldRows.map(({ r, s }) => h("label", { class: "reroute" },
        h("input", { type: "checkbox", checked: p.reroute.includes(r.shipment_id), onchange: (e) => { p.reroute = e.target.checked ? [...p.reroute, r.shipment_id] : p.reroute.filter((x) => x !== r.shipment_id); changed(); } }),
        h("span", {}, h("strong", { text: r.shipment_id }), L(` · ${s.prod.product_name} · ${s.quantity_units} units · margin at stake ${eur(s.quantity_units * s.prod.gross_margin_per_unit_eur)} · fee ${eur(r.extra_cost_eur)} · arrives in ${r.arrival_days} days`, ` · ${productName(s.prod.product_name)} · ${s.quantity_units} وحدة · الهامش المعرّض ${eur(s.quantity_units * s.prod.gross_margin_per_unit_eur)} · الرسوم ${eur(r.extra_cost_eur)} · تصل خلال ${r.arrival_days} أيام`)))))),
    h("fieldset", {}, h("legend", { text: L("Emergency buy from a backup supplier", "شراء طارئ من مورّد احتياطي") }),
      [["none", L("No emergency buy", "بلا شراء طارئ")], ["eu", L("Brabant Home Supply (EU): +24% price, arrives in 1 week", "Brabant Home Supply (الاتحاد الأوروبي): سعر +24%، يصل خلال أسبوع")], ["tr", L("Izmir Home Partners (TR): +10% price, arrives in 3 weeks", "Izmir Home Partners (تركيا): سعر +10%، يصل خلال 3 أسابيع")]].map(([v, l]) =>
        h("label", { class: "block" }, h("input", { type: "radio", name: "backup", value: v, checked: p.backup === v, onchange: () => { p.backup = v; if (v !== "none" && !p.coverWeeks) p.coverWeeks = 1; renderPlanner(); changed(); } }), " ", l)),
      h("label", { for: "cover", text: coverText(), id: "coverLabel" }),
      h("input", { id: "cover", type: "range", min: "0", max: "4", step: "0.5", value: String(p.coverWeeks), disabled: p.backup === "none" ? true : null, "aria-describedby": "coverLabel",
        oninput: (e) => { p.coverWeeks = Number(e.target.value); $("coverLabel").textContent = coverText(); changed(); } })),
    h("fieldset", {}, h("legend", { text: L("Other actions (independent of each other)", "إجراءات أخرى (مستقلة عن بعضها)") }),
      h("label", { class: "block" }, h("input", { type: "checkbox", checked: p.earlyOrder, onchange: (e) => { p.earlyOrder = e.target.checked; changed(); } }), L(" Bring the next regular order forward (2 weeks of demand, arrives week 7, normal price)", " قدّم موعد الطلب المعتاد التالي (طلب أسبوعين، يصل في الأسبوع 7، بالسعر العادي)")),
      h("label", { class: "block" }, h("input", { type: "checkbox", checked: p.lease, onchange: (e) => { p.lease = e.target.checked; changed(); } }), L(` Lease ${S.prep.warehouse.lease_block_pallets} extra pallet positions (${eur(S.prep.warehouse.lease_cost_eur_week)}/week, 8-week minimum)`, ` استأجر ${S.prep.warehouse.lease_block_pallets} موضع منصّة إضافيًا (${eur(S.prep.warehouse.lease_cost_eur_week)} أسبوعيًا، بحد أدنى 8 أسابيع)`))),
    h("div", { id: "planStatus" }),
    h("div", { class: "row" },
      h("button", { type: "button", class: "primary", onclick: saveOption }, L("Save this plan for comparison", "احفظ هذه الخطة للمقارنة")),
      h("button", { type: "button", class: "ghost", onclick: () => { S.plan = structuredClone(EMPTY_PLAN); save(); renderPlanner(); changed(); } }, L("Clear plan", "امسح الخطة"))),
    assumptionsEl());
  renderPlannerStatus();
}
function renderPlannerStatus() {
  const v = violations(S.prep, S.plan);
  $("slotStatus").textContent = L(`${S.plan.reroute.length} of ${S.prep.info.antwerp_slots} slots used.`, `استُخدمت ${S.plan.reroute.length} من ${S.prep.info.antwerp_slots} خانات.`);
  $("planStatus").replaceChildren(v.length ? h("div", { class: "callout warn", role: "status" }, h("strong", { text: L("This plan breaks a constraint: ", "هذه الخطة تخالف قيدًا: ") }), v.map((x) => x.text).join(" ")) : h("p", { class: "muted", role: "status", text: L(`Cash committed: ${eur(planCash(S.prep, S.plan))} of ${eur(S.prep.info.emergency_budget_eur)}.`, `النقد الملتزم به: ${eur(planCash(S.prep, S.plan))} من ${eur(S.prep.info.emergency_budget_eur)}.`) }));
}
function assumptionsEl() {
  const a = S.assumptions;
  const set = (k, v) => { a[k] = v; S.sample = draws(S.seed, a); save(); renderForecast(); renderKpis(); };
  const slider = (k, label, min, max, step, unit) => h("div", { class: "slider" },
    h("label", { for: "as-" + k, id: "asl-" + k, text: `${label}: ${a[k]}${unit}` }),
    h("input", { id: "as-" + k, type: "range", min, max, step, value: String(a[k]), oninput: (e) => { const v = Number(e.target.value); $("asl-" + k).textContent = `${label}: ${v}${unit}`; set(k, v); } }));
  const changed = a.delayMode !== DEFAULT_ASSUMPTIONS.delayMode || a.delayMax !== DEFAULT_ASSUMPTIONS.delayMax || a.demandShiftPct !== 0;
  return h("details", { class: "assumptions", open: changed ? true : null }, h("summary", { text: L("Assumptions (optional)", "الافتراضات (اختياري)") }),
    h("p", { class: "muted", text: L(`The briefing forecast is ${BRIEFING_DELAY.min}–${BRIEFING_DELAY.max} weeks, most likely ${BRIEFING_DELAY.mode}. Your decision is judged against that forecast. If you change these sliders to explore, explain why in your defense.`, `توقّع الإحاطة ${BRIEFING_DELAY.min}–${BRIEFING_DELAY.max} أسابيع، والأرجح ${BRIEFING_DELAY.mode}. يُقيَّم قرارك وفق هذا التوقع. إن غيّرت هذه المؤشرات للاستكشاف، فاشرح السبب في دفاعك.`) }),
    slider("delayMode", L("Most likely port delay", "تأخير الميناء الأرجح"), "1.5", "6", "0.5", L(" weeks", " أسابيع")),
    slider("delayMax", L("Worst-case port delay", "تأخير الميناء في أسوأ الحالات"), "4", "9", "0.5", L(" weeks", " أسابيع")),
    slider("demandShiftPct", L("Demand change vs plan", "تغيّر الطلب عن الخطة"), "-20", "20", "5", "%"),
    h("button", { type: "button", class: "ghost", onclick: () => { S.assumptions = { ...DEFAULT_ASSUMPTIONS }; S.sample = draws(S.seed, S.assumptions); save(); renderStrategy(); renderKpis(); } }, L("Reset to the briefing forecast", "أعد إلى توقّع الإحاطة")));
}
const HOLD = () => L("Hold steady (do nothing)", "الثبات (عدم فعل شيء)");
function planLabel(p) {
  const parts = [];
  if (p.reroute.length) parts.push(L(`reroute ${p.reroute.length}`, `إعادة توجيه ${p.reroute.length}`));
  if (p.backup !== "none" && p.coverWeeks) parts.push(L(`${p.backup.toUpperCase()} buy ${p.coverWeeks} wk`, `شراء ${p.backup === "eu" ? "أوروبي" : "تركي"} ${p.coverWeeks} أسبوع`));
  if (p.earlyOrder) parts.push(L("early order", "طلب مبكر"));
  if (p.lease) parts.push(L("lease space", "استئجار مساحة"));
  return parts.length ? parts.join(" + ") : HOLD();
}
function saveOption() {
  const key = JSON.stringify(S.plan);
  if (S.options.some((o) => JSON.stringify(o.plan) === key)) { say(L("This plan is already in the comparison.", "هذه الخطة موجودة في المقارنة بالفعل.")); return; }
  if (S.options.length >= 5) { say(L("You can compare up to five plans. Remove one first.", "يمكنك مقارنة خمس خطط كحد أقصى. احذف واحدة أولًا.")); return; }
  S.options.push({ name: String.fromCharCode(65 + S.options.length), plan: structuredClone(S.plan) });
  save(); renderForecast(); say(L(`Saved as option ${S.options.at(-1).name}.`, `حُفظت كخيار ${S.options.at(-1).name}.`));
}
function renderForecast() {
  const box = $("forecast"); if (!box) return;
  const rows = [{ name: L("Now", "الآن"), label: L("Your current plan", "خطتك الحالية"), plan: S.plan, current: true }, ...S.options.map((o) => ({ ...o, label: planLabel(o.plan) }))];
  if (!S.options.some((o) => planLabel(o.plan) === HOLD()) && planLabel(S.plan) !== HOLD()) rows.push({ name: L("Base", "الأساس"), label: HOLD(), plan: EMPTY_PLAN, baseline: true });
  const results = rows.map((r) => ({ ...r, e: evaluatePlan(S.prep, r.plan, S.sample), v: violations(S.prep, r.plan) }));
  const maxCost = Math.max(...results.map((r) => r.e.p90)) * 1.08;
  const W = 600, rowH = 46, pad = 200, right = 78, chartH = results.length * rowH + 30;
  const x = (v) => pad + (W - pad - right) * (v / maxCost);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${chartH}`); svg.setAttribute("class", "chart"); svg.setAttribute("role", "img"); svg.setAttribute("direction", "ltr");
  svg.setAttribute("aria-label", L("Expected disruption cost per plan with the P10 to P90 range", "تكلفة الاضطراب المتوقعة لكل خطة مع النطاق من P10 إلى P90"));
  const add = (tag, attrs, text) => { const el = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); if (text) el.textContent = text; svg.append(el); return el; };
  results.forEach((r, i) => {
    const y = 10 + i * rowH;
    add("text", { x: 0, y: y + 18, class: "c-label" }, `${r.name}: ${r.label.length > 26 ? r.label.slice(0, 25) + "…" : r.label}`);
    add("line", { x1: x(r.e.p10), x2: x(r.e.p90), y1: y + 14, y2: y + 14, class: "c-range" });
    add("rect", { x: pad, y: y + 6, width: Math.max(1, x(r.e.expectedCost) - pad), height: 16, rx: 4, class: "c-bar" + (r.current ? " now" : "") + (r.v.length ? " broken" : "") });
    add("text", { x: x(r.e.p90) + 6, y: y + 18, class: "c-val" }, eur(r.e.expectedCost));
  });
  add("text", { x: pad, y: chartH - 4, class: "c-axis" }, L("Bar: expected cost · line: P10–P90 range (same scenarios for every plan)", "العمود: التكلفة المتوقعة · الخط: نطاق P10–P90 (السيناريوهات نفسها لكل خطة)"));
  const table = tableEl([L("Option", "الخيار"), L("Plan", "الخطة"), L("Cash", "النقد"), L("Expected cost", "التكلفة المتوقعة"), "P10–P90", L("Fill rate", "معدل التلبية"), L("Service target met", "تحقّق هدف الخدمة"), L("Excess stock", "المخزون الفائض"), L("Constraints", "القيود")],
    results.map((r) => [r.name, r.label, eur(r.e.cash), eur(r.e.expectedCost), `${eur(r.e.p10)} – ${eur(r.e.p90)}`, pct(r.e.expectedFill), L(pct(r.e.pServiceMet, 0) + " of runs", pct(r.e.pServiceMet, 0) + " من المحاكاة"), eur(r.e.expectedExcess), r.v.length ? r.v.map((v) => v.kind).join(", ") : L("OK", "سليمة")]));
  const compared = S.options.length >= 1 && results.length >= 2;
  box.replaceChildren(h("h3", { text: L("Executive forecast (simulated)", "التوقّع التنفيذي (محاكى)") }), svg, table,
    S.options.length ? h("div", { class: "row" }, S.options.map((o) => h("button", { type: "button", class: "ghost", onclick: () => { S.options = S.options.filter((x) => x !== o); S.options.forEach((x, i) => (x.name = String.fromCharCode(65 + i))); save(); renderForecast(); } }, L(`Remove option ${o.name}`, `احذف الخيار ${o.name}`))),
      h("button", { type: "button", class: "ghost", onclick: () => openLineage("cost") }, L("Trace the cost of the current plan", "تتبّع تكلفة الخطة الحالية"))) : h("p", { class: "muted", text: L("Save at least one plan to compare it with others. You need two or more compared strategies before you submit.", "احفظ خطة واحدة على الأقل لمقارنتها بغيرها. تحتاج إلى استراتيجيتين أو أكثر مقارَنتين قبل التقديم.") }),
    compared ? h("label", { class: "inline" }, h("input", { type: "checkbox", checked: S.evidence.has("comparison"), onchange: (e) => { e.target.checked ? S.evidence.add("comparison") : S.evidence.delete("comparison"); save(); } }), L(" Link this comparison as evidence", " اربط هذه المقارنة كدليل")) : null);
}

// ---------- Decide & defend ----------
function evidenceItems() {
  const items = [];
  for (const c of CHECKS) if (S.results[c.id]?.grade) items.push({ id: "check:" + c.id, label: `SQL: ${c.title}`, kind: "check", pass: S.results[c.id].grade.pass });
  const lin = { var: L("Trace: inventory value at risk", "تتبّع: قيمة المخزون المعرّضة للخطر"), cash: L("Trace: emergency cash", "تتبّع: النقد الطارئ"), cost: L("Trace: expected disruption cost", "تتبّع: تكلفة الاضطراب المتوقعة"), fill: L("Trace: forecast fill rate", "تتبّع: معدل التلبية المتوقع"), cover: L("Trace: stock cover", "تتبّع: تغطية المخزون"), excess: L("Trace: excess stock", "تتبّع: المخزون الفائض"), freight: L("Trace: freight invoiced", "تتبّع: الشحن المفوتر") };
  for (const id of S.viewed) items.push({ id: "kpi:" + id, label: lin[id], kind: "kpi" });
  if (S.options.length >= 1) items.push({ id: "comparison", label: L(`Strategy comparison (${S.options.length + 1} plans, same scenarios)`, `مقارنة الاستراتيجيات (${S.options.length + 1} خطط، السيناريوهات نفسها)`), kind: "comparison" });
  return items;
}
function gate() {
  const linked = evidenceItems().filter((i) => S.evidence.has(i.id));
  const req = CHECKS.filter((c) => c.required);
  return [
    { ok: req.every((c) => S.results[c.id]?.grade), text: L("Run both required SQL analyses", "شغّل تحليلَي SQL المطلوبين") },
    { ok: req.some((c) => S.results[c.id]?.grade?.pass), text: L("At least one required analysis passes its check", "تحليل مطلوب واحد على الأقل ينجح في التحقق") },
    { ok: S.options.length >= 1, text: L("Compare at least two strategies", "قارن بين استراتيجيتين على الأقل") },
    { ok: linked.length >= 2, text: L("Link at least two pieces of evidence", "اربط دليلين على الأقل") },
    { ok: S.defense.recommendation.trim().length > 0, text: L("Write a recommendation", "اكتب توصية") },
  ];
}
function renderDefend() {
  const d = S.defense, sec = $("step-defend"), e = current();
  const items = evidenceItems();
  const field = (k, label, attrs = {}) => [h("label", { for: "d-" + k, text: label }), h("input", { id: "d-" + k, value: d[k], ...attrs, oninput: (ev) => { d[k] = ev.target.value; save(); renderGate(); } })];
  sec.replaceChildren(h("h2", { id: "h-defend", text: L("Decide and defend", "القرار والدفاع") }),
    h("div", { class: "cols" },
      h("section", { class: "card" }, h("h3", { text: L("Your decision", "قرارك") }),
        h("p", {}, h("strong", { text: planLabel(S.plan) }), L(` · cash ${eur(e.cash)} · `, ` · النقد ${eur(e.cash)} · `), h("button", { type: "button", class: "link", onclick: () => go("strategy") }, L("change the plan", "غيّر الخطة"))),
        violations(S.prep, S.plan).length ? h("p", { class: "callout warn", text: violations(S.prep, S.plan).map((v) => v.text).join(" ") }) : null,
        h("fieldset", {}, h("legend", { text: L("Evidence for your recommendation", "أدلة توصيتك") }),
          items.length ? items.map((i) => h("label", { class: "block" }, h("input", { type: "checkbox", checked: S.evidence.has(i.id), onchange: (ev) => { ev.target.checked ? S.evidence.add(i.id) : S.evidence.delete(i.id); save(); renderGate(); } }), " ", i.label, i.kind === "check" ? h("span", { class: "badge " + (i.pass ? "ok" : "no"), text: i.pass ? L("checked", "تم التحقق") : L("not passed", "لم ينجح") }) : null))
            : h("p", { class: "muted", text: L("Run queries, open KPI traces or compare strategies to create evidence you can link.", "شغّل استعلامات أو افتح تتبّع المؤشرات أو قارن الاستراتيجيات لتكوين أدلة يمكنك ربطها.") }))),
      h("section", { class: "card" }, h("h3", { text: L("Boardroom defense", "الدفاع أمام مجلس الإدارة") }),
        h("label", { for: "d-rec", text: L("Recommendation: what will we do, why, and what does it cost?", "التوصية: ماذا سنفعل، ولماذا، وكم يكلّف؟") }),
        h("textarea", { id: "d-rec", rows: "5", value: d.recommendation, oninput: (ev) => { d.recommendation = ev.target.value; save(); renderGate(); } }),
        h("div", { class: "grid3" },
          h("div", {}, field("claimedCost", L("Expected cost of the plan (€)", "التكلفة المتوقعة للخطة (€)"), { type: "number", inputmode: "numeric" })),
          h("div", {}, field("claimedFillPct", L("Expected fill rate (%)", "معدل التلبية المتوقع (%)"), { type: "number", step: "0.1", inputmode: "decimal" })),
          h("div", {}, field("claimedP90", L("Downside cost, 90th percentile (€)", "تكلفة السيناريو السيئ، المئين 90 (€)"), { type: "number", inputmode: "numeric" }))),
        h("fieldset", {}, h("legend", { text: L("This plan would be the wrong choice if the port delay is…", "ستكون هذه الخطة الخيار الخطأ إذا كان تأخير الميناء…") }),
          [["shorter", L("shorter than expected", "أقصر من المتوقع")], ["longer", L("longer than expected", "أطول من المتوقع")]].map(([v, l]) => h("label", { class: "block" }, h("input", { type: "radio", name: "weak", value: v, checked: d.weakSpot === v, onchange: () => { d.weakSpot = v; save(); } }), " ", l))),
        h("label", { class: "block" }, h("input", { type: "checkbox", checked: d.acceptShortfall, onchange: (ev) => { d.acceptShortfall = ev.target.checked; save(); renderDefend(); } }), L(" I accept that this plan may miss the 95% service target", " أقبل أن هذه الخطة قد لا تحقق هدف الخدمة 95%")),
        d.acceptShortfall ? [h("label", { for: "d-sr", text: L("Why is that acceptable? (at least 8 words)", "لماذا يُعد ذلك مقبولًا؟ (8 كلمات على الأقل)") }), h("textarea", { id: "d-sr", rows: "2", value: d.shortfallReason, oninput: (ev) => { d.shortfallReason = ev.target.value; save(); } })] : null,
        h("label", { for: "d-an", text: L("If you changed the forecast assumptions, which ones and why? (optional)", "إن غيّرت افتراضات التوقع، فأيها ولماذا؟ (اختياري)") }),
        h("textarea", { id: "d-an", rows: "2", value: d.assumptionNote, oninput: (ev) => { d.assumptionNote = ev.target.value; save(); } }))),
    h("section", { class: "card" }, h("h3", { text: L("Ready to submit?", "جاهز للتقديم؟") }), h("ul", { id: "gate", class: "gate" }), h("button", { type: "button", class: "primary", id: "submitBtn", onclick: submit }, L("Submit to the board", "قدّم لمجلس الإدارة")),
      h("p", { class: "muted", text: L("Your numbers are compared with the model; quote them from Compare strategies or the KPI traces.", "تُقارَن أرقامك بالنموذج؛ انقلها من مقارنة الاستراتيجيات أو من تتبّع المؤشرات.") })));
  renderGate();
}
function renderGate() {
  const g = gate();
  $("gate").replaceChildren(...g.map((x) => h("li", { class: x.ok ? "ok" : "no" }, h("span", { "aria-hidden": "true", text: x.ok ? "✓ " : "○ " }), x.text, h("span", { class: "visually-hidden", text: x.ok ? L(" (done)", " (تم)") : L(" (to do)", " (مطلوب)") }))));
  $("submitBtn").disabled = !g.every((x) => x.ok);
}
function submit() {
  if (!gate().every((x) => x.ok)) return;
  const evidence = evidenceItems().filter((i) => S.evidence.has(i.id));
  const checks = Object.fromEntries(CHECKS.map((c) => [c.id, S.results[c.id]?.grade || { pass: false, messages: [] }]));
  const submission = { seed: S.seed, plan: structuredClone(S.plan), assumptions: { ...S.assumptions }, checks, evidence, defense: { ...S.defense } };
  S.evaluation = evaluate(S.scenario, submission);
  const lastPassing = CHECKS.filter((c) => S.results[c.id]?.sql).map((c) => ({ check: c.id, sql: S.results[c.id].sql, pass: !!S.results[c.id].grade?.pass }));
  S.record = buildRecord({ scenario: S.scenario, mode: S.mode, hints: S.hints, revealed: S.revealed, queries: lastPassing, checks, plan: submission.plan, assumptions: submission.assumptions, evidence, defense: submission.defense, evaluation: S.evaluation, startedAt: S.startedAt });
  S.record.explanations = { ...S.explanations }; S.record.predictions = { ...S.predictions }; S.record.language = lang();
  S.record.id = "rec-" + Date.now().toString(36);
  const list = store.get("bizdata-portfolio", []);
  list.unshift(S.record);
  const saved = store.set("bizdata-portfolio", list);
  save(); go("review");
  say(saved ? L("Submitted. Your record is saved privately in this browser.", "تم التقديم. حُفظ سجلك بشكل خاص في هذا المتصفح.") : L("Submitted. This browser blocked storage, so export your record from the Portfolio step.", "تم التقديم. منع هذا المتصفح التخزين، فصدّر سجلك من خطوة ملف الأعمال."));
}

// ---------- Review ----------
function renderReview() {
  const sec = $("step-review"), ev = S.evaluation;
  if (!ev) { sec.replaceChildren(h("h2", { id: "h-review", text: L("Review", "المراجعة") }), h("p", { text: L("Submit a recommendation to get feedback.", "قدّم توصية لتحصل على الملاحظات.") }), h("button", { type: "button", onclick: () => go("defend") }, L("Go to Decide & defend", "اذهب إلى القرار والدفاع"))); return; }
  const fb = ev.feedback, o = ev.outcome;
  const group = (title, list, cls) => h("section", { class: "fb " + cls }, h("h4", { text: `${title} (${list.length})` }), list.length ? h("ul", {}, list.map((t) => h("li", { text: t }))) : h("p", { class: "muted", text: L("Nothing to report.", "لا شيء للإبلاغ عنه.") }));
  sec.replaceChildren(h("h2", { id: "h-review", text: L("Board review", "مراجعة مجلس الإدارة") }),
    h("div", { class: "cols" },
      h("section", { class: "card" }, h("h3", { text: L(`Rubric: ${ev.total} / ${ev.max}`, `معايير التقييم: ${ev.total} / ${ev.max}`) }),
        tableEl([L("Criterion", "المعيار"), L("Score", "الدرجة"), L("How it is scored", "طريقة التقييم")], ev.criteria.map((c) => [c.label, `${c.score} / ${c.max}`, c.how]))),
      h("section", { class: "card" }, h("h3", { text: L("Decision quality", "جودة القرار") }),
        h("p", { class: "verdict " + (ev.decision.defensible ? "ok" : "no"), text: ev.decision.defensible ? L("Defensible: within the constraints, and no feasible alternative is clearly better on both cost and service without more cash.", "قابل للدفاع عنه: ضمن القيود، ولا يوجد بديل ممكن أفضل بوضوح في التكلفة والخدمة معًا دون نقد إضافي.") : ev.decision.violations.length ? L("Not defensible as submitted: it breaks a constraint.", "غير قابل للدفاع عنه كما قُدّم: يخالف قيدًا.") : L("Not defensible as submitted: a feasible alternative is clearly better (see below).", "غير قابل للدفاع عنه كما قُدّم: يوجد بديل ممكن أفضل بوضوح (انظر أدناه).") }),
        h("p", { class: "muted", text: L("Judged on the briefing's delay forecast, the information you had when you decided.", "قُيّم وفق توقّع التأخير في الإحاطة، أي المعلومات التي كانت لديك عند اتخاذ القرار.") }),
        h("h4", { text: L("What happened next (one simulated draw, not scored)", "ما حدث بعد ذلك (سحب محاكى واحد، لا يدخل في الدرجة)") }),
        h("p", { text: L(`The port released after ${o.delayWeeks.toFixed(1)} weeks and demand ran at ${pct(o.demandFactor, 0)} of plan. Your plan's cost in this draw: ${eur(o.cost)}, fill rate ${pct(o.fillRate)}. In hindsight, "${o.bestInHindsight.label}" would have cost ${eur(o.bestInHindsight.total)}; your plan ranks ${o.rank} of ${o.of}.`, `أفرج الميناء بعد ${o.delayWeeks.toFixed(1)} أسابيع وكان الطلب ${pct(o.demandFactor, 0)} من الخطة. تكلفة خطتك في هذا السحب: ${eur(o.cost)}، ومعدل التلبية ${pct(o.fillRate)}. بعد معرفة النتيجة، كانت «${o.bestInHindsight.label}» ستكلّف ${eur(o.bestInHindsight.total)}؛ ترتيب خطتك ${o.rank} من ${o.of}.`) }),
        h("p", { class: "callout", text: L("A good decision can meet bad luck, and a weak one can get lucky. This outcome does not change your score.", "قد يصادف القرار الجيد حظًا سيئًا، وقد يحالف الحظ قرارًا ضعيفًا. هذه النتيجة لا تغيّر درجتك.") }))),
    h("div", { class: "fb-grid" }, group(L("Calculation errors", "أخطاء الحساب"), fb.calculation, "calc"), group(L("Unsupported claims", "ادعاءات غير مدعومة"), fb.unsupported, "claims"), group(L("Constraint issues", "مشكلات القيود"), fb.constraints, "cons"), group(L("Defensible alternatives", "بدائل قابلة للدفاع عنها"), fb.alternatives, "alt")),
    h("div", { class: "row" }, h("button", { type: "button", class: "primary", onclick: () => go("portfolio") }, L("Open my portfolio", "افتح ملف أعمالي")), h("button", { type: "button", onclick: () => freshVariant() }, L("Try a fresh variant", "جرّب نسخة جديدة")), h("button", { type: "button", class: "ghost", onclick: () => go("defend") }, L("Revise and resubmit", "عدّل وأعد التقديم"))));
}

// ---------- Portfolio ----------
function renderPortfolio() {
  const sec = $("step-portfolio"), list = store.get("bizdata-portfolio", []);
  sec.replaceChildren(h("h2", { id: "h-portfolio", text: L("Private portfolio", "ملف الأعمال الخاص") }),
    h("p", { class: "callout", text: L("Records are saved only in this browser on this device and are never shared. Export a file to keep a copy. Public sharing is not available in this release.", "تُحفظ السجلات في هذا المتصفح على هذا الجهاز فقط ولا تُشارك أبدًا. صدّر ملفًا للاحتفاظ بنسخة. المشاركة العامة غير متاحة في هذا الإصدار.") }),
    ...(list.length ? list.map((r) => recordCard(r)) : [h("p", { class: "muted", text: L("No records yet. Submit a recommendation to create your first BizData completion record.", "لا سجلات بعد. قدّم توصية لإنشاء أول سجل إنجاز BizData.") })]));
}
function recordCard(r) {
  const bullets = cvBullets(r).join("\n");
  return h("article", { class: "card record" },
    h("h3", { text: `${r.title}: ${r.mission_title}` }),
    h("p", { text: L(`${new Date(r.submitted_at).toLocaleString(dateLocale())} · seed ${r.seed} (${r.variant}) · ${r.mode} mode · ${demonstrated(r)} · rubric ${r.evaluation.total}/${r.evaluation.max} · ${r.evaluation.defensible ? "defensible decision" : "decision not defensible as submitted"}`, `${new Date(r.submitted_at).toLocaleString(dateLocale())} · البذرة ${r.seed} · النمط: ${MODE_NAMES[r.mode] || r.mode} · ${demonstrated(r)} · التقييم ${r.evaluation.total}/${r.evaluation.max} · ${r.evaluation.defensible ? "قرار قابل للدفاع عنه" : "قرار غير قابل للدفاع عنه كما قُدّم"}`) }),
    h("p", { class: "muted", text: L("A record of a simulated exercise with synthetic data. Not an accredited certificate; not endorsed by any employer, software vendor or professional body.", "سجل لتمرين محاكى ببيانات اصطناعية. ليس شهادة معتمدة، ولا تؤيده أي جهة توظيف أو شركة برمجيات أو هيئة مهنية.") }),
    h("label", { for: "cv-" + r.id, text: L("CV bullets (edit before use; they describe only what you did here)", "نقاط للسيرة الذاتية (عدّلها قبل الاستخدام؛ تصف فقط ما أنجزته هنا)") }),
    h("textarea", { id: "cv-" + r.id, rows: "4", value: bullets }),
    h("div", { class: "row" },
      h("button", { type: "button", onclick: (e) => replay(r, e.target) }, L("Replay and verify", "أعد التشغيل وتحقّق")),
      h("button", { type: "button", class: "ghost", onclick: () => download(`bizdata-${r.id}.json`, JSON.stringify(r, null, 2), "application/json") }, L("Export JSON", "صدّر JSON")),
      h("button", { type: "button", class: "ghost", onclick: () => download(`bizdata-${r.id}.md`, toMarkdown(r), "text/markdown") }, L("Export Markdown", "صدّر Markdown")),
      h("button", { type: "button", class: "ghost", onclick: async () => { try { await navigator.clipboard.writeText($("cv-" + r.id).value); say(L("CV bullets copied.", "نُسخت نقاط السيرة الذاتية.")); } catch { say(L("Copy was blocked; select the text instead.", "مُنع النسخ؛ حدّد النص بدلًا من ذلك.")); } } }, L("Copy CV bullets", "انسخ نقاط السيرة الذاتية")),
      h("button", { type: "button", class: "ghost danger", onclick: () => { if (!confirm(L("Delete this record from this browser?", "حذف هذا السجل من هذا المتصفح؟"))) return; store.set("bizdata-portfolio", store.get("bizdata-portfolio", []).filter((x) => x.id !== r.id)); renderPortfolio(); } }, L("Delete", "احذف"))),
    h("p", { class: "replay", id: "replay-" + r.id, "aria-live": "polite" }));
}
/** Rebuilds the dataset from the seed, re-runs the saved SQL in a fresh sandbox and re-scores the decision. */
async function replay(r, button) {
  const out = $("replay-" + r.id);
  button.disabled = true; out.textContent = L("Replaying…", "تجري إعادة التشغيل…");
  const scenario = buildScenario(r.seed), box = new Sandbox(toSqlScript(scenario));
  try {
    const checks = {};
    for (const c of CHECKS) {
      const q = r.execution.queries.find((x) => x.check === c.id);
      checks[c.id] = q ? grade(c.id, await box.run(q.sql), scenario) : { pass: false, messages: [] };
    }
    const ev = evaluate(scenario, { seed: r.seed, plan: r.plan, assumptions: r.assumptions, checks, evidence: r.evidence, defense: r.defense });
    const same = ev.total === r.evaluation.total && Math.abs(ev.outcome.cost - r.evaluation.outcome.cost) < 0.01 && Object.keys(checks).every((k) => checks[k].pass === r.checks[k].pass);
    out.textContent = same ? L(`Replay verified: the saved queries re-ran on dataset ${r.dataset_version} seed ${r.seed} with the same check results, rubric ${ev.total}/${ev.max} and outcome.`, `تم التحقق بإعادة التشغيل: أُعيد تشغيل الاستعلامات المحفوظة على مجموعة البيانات ${r.dataset_version} بالبذرة ${r.seed} بنتائج التحقق نفسها والتقييم ${ev.total}/${ev.max} والنتيجة نفسها.`) : L(`Replay differs from the saved record (rubric now ${ev.total}/${ev.max}). The record may come from an older version of the mission.`, `تختلف إعادة التشغيل عن السجل المحفوظ (التقييم الآن ${ev.total}/${ev.max}). قد يكون السجل من نسخة أقدم من المهمة.`);
  } catch (e) { out.textContent = L("Replay failed: ", "فشلت إعادة التشغيل: ") + e.message; }
  finally { box.worker.terminate(); button.disabled = false; }
}

// ---------- persistence of work in progress (this browser only) ----------
function save() {
  store.set("bizdata-wip", { seed: S.seed, mode: S.mode, step: S.step, table: S.table, filters: S.filters, checkId: S.checkId, code: S.code, dirty: S.dirty, predictions: S.predictions, explanations: S.explanations,
    results: Object.fromEntries(Object.entries(S.results).map(([k, v]) => [k, { ...v, result: v.result ? { ...v.result, values: v.result.values.slice(0, 200) } : undefined }])),
    queries: S.queries.slice(-50), hintsShown: S.hintsShown, hints: S.hints, revealed: S.revealed, viewed: [...S.viewed], evidence: [...S.evidence], plan: S.plan, assumptions: S.assumptions, options: S.options, defense: S.defense, evaluation: S.evaluation, record: S.record, startedAt: S.startedAt });
}
function start(seed, mode, step, { focus = true } = {}) {
  S.step = step;
  newState(seed, mode);
  if (sandbox) sandbox.load(toSqlScript(S.scenario)); else sandbox = new Sandbox(toSqlScript(S.scenario));
  for (const r of document.querySelectorAll('input[name="mode"]')) r.checked = r.value === mode;
  save(); renderSimNote(); renderKpis(); go(step, { focus });
}
function renderSimNote() {
  $("simNote").textContent = L(`Simulated: ${COMPANY.name} is fictional and every figure is synthetic (dataset ${DATASET_VERSION}, seed ${S.seed}). This is not live market, port or company data.`, `محاكاة: ${COMPANY.name} شركة خيالية وكل الأرقام اصطناعية (مجموعة البيانات ${DATASET_VERSION}، البذرة ${S.seed}). ليست بيانات سوق أو ميناء أو شركة حقيقية.`);
}
function restore() {
  const w = store.get("bizdata-wip", null);
  if (!w || typeof w.seed !== "number") return start(BASE_SEED, "guided", "briefing", { focus: false });
  newState(w.seed, w.mode || "guided");
  Object.assign(S, { step: w.step || "briefing", table: w.table || "shipments", filters: w.filters || S.filters, checkId: w.checkId || "delayed", code: { ...S.code, ...w.code }, dirty: w.dirty || {}, predictions: w.predictions || {}, explanations: w.explanations || {},
    results: w.results || {}, queries: w.queries || [], hintsShown: w.hintsShown || {}, hints: w.hints || 0, revealed: !!w.revealed, viewed: new Set(w.viewed || []), evidence: new Set(w.evidence || []),
    plan: w.plan || S.plan, assumptions: w.assumptions || S.assumptions, options: w.options || [], defense: { ...S.defense, ...w.defense }, evaluation: w.evaluation || null, record: w.record || null, startedAt: w.startedAt || S.startedAt });
  S.sample = draws(S.seed, S.assumptions);
  sandbox = new Sandbox(toSqlScript(S.scenario));
  for (const r of document.querySelectorAll('input[name="mode"]')) r.checked = r.value === S.mode;
  renderSimNote(); renderKpis(); go(S.step, { focus: false });
}

/** Texts that live in index.html. */
function translateStatic() {
  document.title = L("BizData Stack Sandbox · Shahed’s Hub", "مختبر قرارات الأعمال · مركز شهد");
  document.querySelector(".skip").textContent = L("Skip to the mission", "انتقل إلى المهمة");
  document.querySelector(".bar .eyebrow").textContent = L("BizData Stack Sandbox · Mission 1", "مختبر قرارات الأعمال · المهمة 1");
  document.querySelector(".bar h1").textContent = L("Rotterdam Port Bottleneck", "اختناق ميناء روتردام");
  document.querySelector(".promise").textContent = L("Learn to make and defend business decisions with data.", "تعلّم اتخاذ قرارات الأعمال والدفاع عنها بالبيانات.");
  document.querySelector("#mode legend").textContent = L("Learning mode", "نمط التعلّم");
  for (const input of document.querySelectorAll('#mode input[name="mode"]')) input.parentElement.lastChild.textContent = " " + MODE_NAMES[input.value];
  $("statusTitle").textContent = L("Company status (simulated)", "وضع الشركة (محاكى)");
  document.querySelector(".steps").setAttribute("aria-label", L("Mission steps", "خطوات المهمة"));
  $("closeLineage").textContent = L("Close", "إغلاق");
  const btn = h("button", { type: "button", id: "langBtn", class: "ghost", lang: lang() === "ar" ? "en" : "ar", onclick: () => switchLang(store, "bizdata-lang") }, lang() === "ar" ? "English" : "العربية");
  document.querySelector(".bar").append(btn);
}

// ---------- boot ----------
$("mode").addEventListener("change", (e) => {
  const mode = e.target.value;
  if (mode === "guided") S.revealed = true; // guided shows worked solutions
  S.mode = mode;
  for (const c of CHECKS) if (!S.dirty[c.id]) S.code[c.id] = starterCode(c);
  save(); go(S.step);
  say(mode === "independent" && S.seed === BASE_SEED ? L("Independent mode. Start a fresh variant from the briefing for it to count as independent.", "النمط المستقل. ابدأ نسخة جديدة من الإحاطة ليُحتسب العمل مستقلًا.") : L(`${MODE_NAMES[mode]} mode.`, `النمط: ${MODE_NAMES[mode]}.`));
});
$("closeLineage").onclick = () => $("lineage").close();
$("lineage").addEventListener("close", () => { if (S.step === "defend") renderDefend(); });
await store.load();
if (!applyLang(store, "bizdata-lang")) {
  translateStatic();
  restore();
}
