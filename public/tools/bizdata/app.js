// BizData Stack Sandbox: Rotterdam Port Bottleneck. Runs entirely in the browser; reads no Hub data.
import { buildScenario, toSqlScript, BASE_SEED, SCHEMA, COMPANY, BRIEFING_DELAY, DATASET_VERSION } from "./lib/dataset.js";
import { CHECKS, grade, expected } from "./lib/checks.js";
import { prepare, draws, evaluatePlan, planCash, violations, EMPTY_PLAN, DEFAULT_ASSUMPTIONS, ASSUMPTIONS, simulateOnce, exposedProducts } from "./lib/model.js";
import { evaluate, RUBRIC } from "./lib/rubric.js";
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
const eur = (v) => (v < 0 ? "−€" : "€") + Math.round(Math.abs(v)).toLocaleString("en-GB");
const pct = (v, d = 1) => (v * 100).toFixed(d) + "%";
const say = (text) => { $("live").textContent = ""; requestAnimationFrame(() => ($("live").textContent = text)); };
const store = createStore("bizdata");

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
    if (this.pending) this.cancel("Replaced by a new run.");
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2);
      const timer = setTimeout(() => this.cancel(`Stopped after ${limitMs / 1000} seconds. Check for a join without a condition or an endless recursive query.`), limitMs);
      this.pending = { id, resolve, reject, timer };
      this.worker.postMessage({ type: "run", id, sql });
    });
  }
  cancel(reason = "Run cancelled.") {
    if (!this.pending) return;
    const { reject, timer } = this.pending;
    clearTimeout(timer); this.pending = null;
    this.worker.terminate(); this.spawn(); // a fresh worker and database: nothing from the stopped run survives
    reject(new Error(reason));
  }
}

// ---------- state ----------
const STEPS = [
  { id: "briefing", label: "Briefing" },
  { id: "evidence", label: "Investigate" },
  { id: "strategy", label: "Compare strategies" },
  { id: "defend", label: "Decide & defend" },
  { id: "review", label: "Review" },
  { id: "portfolio", label: "Portfolio" },
];
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
  if (S.mode === "guided") { S.revealed = true; return `-- Worked example: read each line, predict the result, then run it.\n${c.reference}`; }
  if (S.mode === "assisted") return c.assisted;
  return `-- ${c.task}\n-- Tables: ${Object.keys(S.scenario.tables).join(", ")}\n`;
}

// ---------- KPIs and lineage ----------
function current() { return evaluatePlan(S.prep, S.plan, S.sample); }
function renderKpis() {
  const e = current(), info = S.prep.info;
  const cover = S.prep.products.reduce((s, p) => s + p.onHand, 0) / S.prep.products.reduce((s, p) => s + p.weekly_demand_units, 0);
  const varPassed = S.results.exposure?.grade?.pass;
  const items = [
    { id: "cash", label: "Emergency cash committed", value: `${eur(e.cash)} of ${eur(info.emergency_budget_eur)}`, warn: e.cash > info.emergency_budget_eur },
    { id: "var", label: "Inventory value at risk", value: varPassed ? eur(S.exp.exposure ? Object.values(S.exp.exposure).reduce((s, x) => s + x.value, 0) : 0) : "Not analysed yet", note: varPassed ? "From your checked query" : "Run the exposure query" },
    { id: "fill", label: "Forecast fill rate (8 weeks)", value: pct(e.expectedFill), note: `Target ${pct(info.service_target, 0)} · met in ${pct(e.pServiceMet, 0)} of runs`, warn: e.pServiceMet < 0.5 },
    { id: "cost", label: "Expected disruption cost", value: eur(e.expectedCost), note: `Range ${eur(e.p10)} – ${eur(e.p90)} (P10–P90)` },
    { id: "cover", label: "Stock cover today", value: cover.toFixed(1) + " weeks", note: "All products, Venlo DC" },
    { id: "excess", label: "Excess stock at week 8", value: eur(e.expectedExcess), note: "Inventory exposure after the crisis" },
  ];
  $("kpis").replaceChildren(...items.map((k) => h("button", { type: "button", class: "kpi" + (k.warn ? " warn" : ""), onclick: () => openLineage(k.id), "aria-describedby": "simNote" },
    h("span", { class: "kpi-label", text: k.label }), h("span", { class: "kpi-value", text: k.value }), k.note && h("span", { class: "kpi-note", text: k.note }), h("span", { class: "kpi-trace", text: "Trace →" }))));
}

function tableEl(columns, rows, { max = 60, highlight } = {}) {
  return h("div", { class: "table-wrap", tabindex: "0", role: "region", "aria-label": "Data table" },
    h("table", {}, h("thead", {}, h("tr", {}, columns.map((c) => h("th", { scope: "col", text: c })))),
      h("tbody", {}, rows.slice(0, max).map((r, i) => h("tr", { class: highlight?.(r, i) ? "hl" : null }, r.map((v) => (v === null ? h("td", { class: "null" }, h("span", { class: "null-badge", text: "blank" })) : h("td", { text: typeof v === "number" && !Number.isInteger(v) ? v.toFixed(2) : String(v) }))))))),
    rows.length > max ? h("p", { class: "muted", text: `Showing ${max} of ${rows.length} rows.` }) : null);
}

function openLineage(id) {
  S.viewed.add(id); save();
  const t = S.scenario.tables, asOf = S.prep.info.as_of_date, body = [];
  const productOf = (s) => t.products.find((p) => p.product_id === s.product_id.trim().toUpperCase());
  const delayed = t.shipments.filter((s) => s.status !== "arrived" && s.eta_date < asOf);
  let title = "";
  const section = (label, ...kids) => h("section", { class: "lin" }, h("h3", { text: label }), ...kids);
  if (id === "var") {
    title = "Inventory value at risk";
    if (!S.results.exposure?.grade?.pass) body.push(h("p", { class: "callout", text: "Run and pass the exposure query first. The trace below shows the rows it should use, so you can check your own result against them." }));
    const exact = delayed.filter((s) => t.products.some((p) => p.product_id === s.product_id));
    const total = (rows) => rows.reduce((sum, s) => sum + s.quantity_units * productOf(s).unit_value_eur, 0);
    body.push(section("Source rows", h("p", { text: `${delayed.length} delayed shipments (not arrived and ETA before ${asOf}), each joined to its product.` }),
      tableEl(["shipment_id", "product_id (as stored)", "status", "eta_date", "quantity_units", "unit_value_eur", "value_eur"], delayed.map((s) => [s.shipment_id, s.product_id, s.status, s.eta_date, s.quantity_units, productOf(s).unit_value_eur, s.quantity_units * productOf(s).unit_value_eur]), { highlight: (r) => r[1] !== r[1].toUpperCase() })));
    body.push(section("Filters and joins", h("ul", {}, h("li", { text: "Filter: status <> 'arrived' AND eta_date < as_of_date. A blank actual_arrival_date is not used, because 3 arrived shipments have no date keyed in." }), h("li", { text: "Join: shipments → products on UPPER(TRIM(product_id)). One key is stored in lower case (highlighted)." }))));
    body.push(section("Formula", h("pre", { class: "code", text: "value at risk = Σ quantity_units × unit_value_eur   over delayed shipments" })));
    body.push(section("Before and after", h("dl", { class: "ba" }, h("dt", { text: "Exact-match join (drops the lower-case key)" }), h("dd", { text: eur(total(exact)) }), h("dt", { text: "Normalised join (all delayed shipments)" }), h("dd", { text: eur(total(delayed)) }))));
    body.push(section("Effect on the decision", h("p", { text: "This is a fact on the as-of date, so no assumption changes it. It sizes the problem: the emergency budget is set at 75% of this value, so you cannot buy full cover for everything." })));
  } else if (id === "cash") {
    title = "Emergency cash committed";
    const lines = [];
    for (const sid of S.plan.reroute) { const r = S.prep.reroute.find((x) => x.shipment_id === sid); lines.push(["Reroute " + sid, "reroute_options.extra_cost_eur", r.extra_cost_eur]); }
    for (const p of exposedProducts(S.prep, S.plan)) {
      if (S.plan.backup !== "none" && S.plan.coverWeeks > 0) { const b = S.prep.backup.find((x) => x.product_id === p.product_id && x.supplier.includes(S.plan.backup === "eu" ? "(EU)" : "(TR)")); const u = Math.ceil(p.weekly_demand_units * S.plan.coverWeeks); lines.push([`Buy ${u} × ${p.product_id} (${b.supplier})`, `units × ${p.unit_value_eur} × (1 + ${b.premium_pct})`, u * p.unit_value_eur * (1 + b.premium_pct)]); }
      if (S.plan.earlyOrder) lines.push([`Early order ${p.product_id}`, `2 weeks × ${p.weekly_demand_units} × ${p.unit_value_eur}`, p.weekly_demand_units * 2 * p.unit_value_eur]);
    }
    if (S.plan.lease) lines.push(["Lease extra space", `${S.prep.warehouse.lease_cost_eur_week} × ${S.prep.info.horizon_weeks} weeks`, S.prep.warehouse.lease_cost_eur_week * S.prep.info.horizon_weeks]);
    body.push(section("Source rows (your current plan)", lines.length ? tableEl(["Item", "Formula", "Cash (EUR)"], lines.map((l) => [l[0], l[1], Math.round(l[2])])) : h("p", { text: "Your plan commits no cash yet." })));
    body.push(section("Formula", h("pre", { class: "code", text: `cash = reroute fees + emergency buys at full price + early orders + lease\nlimit: emergency_budget_eur = ${eur(S.prep.info.emergency_budget_eur)} (mission_info)` })));
    body.push(section("Effect on the decision", h("p", { text: "Cash is known in advance and does not depend on the delay. Keeping cash back is a legitimate trade-off against a lower expected cost." })));
  } else if (id === "freight") {
    title = "Freight invoiced for delayed shipments";
    const ids = new Set(delayed.map((s) => s.shipment_id));
    const rows = t.freight_invoices.filter((f) => ids.has(f.shipment_id));
    body.push(section("Source rows", tableEl(["invoice_id", "shipment_id", "amount_eur"], rows.map((f) => [f.invoice_id, f.shipment_id, f.amount_eur]), { highlight: (r) => S.scenario.traps.duplicateInvoices.includes(r[0]) })));
    body.push(section("Before and after", h("dl", { class: "ba" }, h("dt", { text: "Plain SUM" }), h("dd", { text: eur(S.exp.naiveFreight) }), h("dt", { text: "Each invoice once" }), h("dd", { text: eur(S.exp.freight) }))));
  } else {
    const e = current();
    title = { fill: "Forecast fill rate", cost: "Expected disruption cost", cover: "Stock cover today", excess: "Excess stock at week 8" }[id];
    if (id === "cover") {
      body.push(section("Source rows", tableEl(["product_id", "on_hand_units", "weekly_demand_units", "weeks of cover"], S.prep.products.map((p) => [p.product_id, p.onHand, p.weekly_demand_units, Number((p.onHand / p.weekly_demand_units).toFixed(1))]))));
      body.push(section("Formula", h("pre", { class: "code", text: "cover = Σ on_hand_units ÷ Σ weekly_demand_units   (inventory joined to products)" })));
    } else {
      body.push(section("Where it comes from", h("p", { text: `The strategy model runs your plan through ${S.sample.length} seeded scenarios of the port delay and demand, week by week, per product. These are the inputs and rules:` }), h("ul", {}, ASSUMPTIONS.map((a) => h("li", { text: a })))));
      const b = e.breakdown;
      body.push(section("Breakdown (expected values)", tableEl(["Component", "EUR"], [["Lost margin (unmet demand)", Math.round(b.lostMargin)], ["Emergency-buy premium", Math.round(b.premium)], ["Reroute fees", Math.round(b.rerouteFees)], ["Holding cost", Math.round(b.holding)], ["Storage (overflow / lease)", Math.round(b.storage)], ["Markdown on excess", Math.round(b.markdown)], ["Total", Math.round(e.expectedCost)]])));
      const at = (L) => simulateOnce(S.prep, S.plan, L, 1);
      body.push(section("How an assumption changes it", tableEl(["If the port releases after", "Cost of your plan", "Fill rate"], [2, 3, 4, 5, 6].map((L) => [`${L} weeks`, Math.round(at(L).total), pct(at(L).fillRate)])),
        h("p", { class: "muted", text: "Compare this with another plan in Compare strategies: the plan that is cheapest at 2 weeks is often not the cheapest at 6." })));
    }
  }
  $("lineageTitle").textContent = "Trace: " + title;
  $("lineageBody").replaceChildren(h("p", { class: "sim-tag", text: "Simulated figures for a fictional company." }), ...body);
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
    h("h2", { id: "h-briefing", text: "COO briefing" }),
    h("article", { class: "memo" },
      h("p", { class: "memo-head" }, h("strong", { text: "From: " }), "Sanne de Vries, Chief Operating Officer · ", h("strong", { text: "To: " }), "You, supply-chain analyst · ", h("strong", { text: "Date: " }), info.as_of_date),
      h("p", { class: "memo-head" }, h("strong", { text: "Company: " }), COMPANY.name, " (fictional). ", COMPANY.note),
      h("h3", { text: "The problem" }),
      h("p", { text: `Congestion at Rotterdam is holding ${held} of our containers at the terminal, and at least one vessel is late at sea. The port's latest estimate is that the backlog clears in ${BRIEFING_DELAY.min} to ${BRIEFING_DELAY.max} weeks, most likely ${BRIEFING_DELAY.mode}. Our Venlo DC has only one to three weeks of stock on most lines.` }),
      h("p", { class: "fictional-news", text: "Port Ledger Daily (fictional outlet): “Terminal backlog: carriers warn of multi-week releases.”" }),
      h("h3", { text: "Your decision" }),
      h("p", { text: "Should we reroute selected containers via Antwerp, buy safety stock from a backup supplier, bring forward the next regular order, lease extra warehouse space, or combine these?" }),
      h("h3", { text: "Constraints" }),
      h("ul", {}, h("li", { text: `Emergency cash: up to ${eur(info.emergency_budget_eur)}.` }), h("li", { text: `Antwerp barge slots this week: ${info.antwerp_slots} containers.` }), h("li", { text: `Service target: ${pct(info.service_target, 0)} fill rate over the next ${info.horizon_weeks} weeks.` }), h("li", { text: `DC space: ${S.prep.warehouse.free_pallet_positions} free pallet positions; overflow costs €${S.prep.warehouse.overflow_rate_eur_pallet_week} per pallet per week.` })),
      h("h3", { text: "Evidence you have" }),
      h("p", { text: "Shipment, product, inventory, freight-invoice, reroute-quote, backup-supplier and warehouse tables from our systems. Treat them with care: they were exported quickly and have not been cleaned." }),
      h("h3", { text: "What I need from you" }),
      h("p", { text: "A recommendation I can take to the board: what to do, what it costs in cash and expected cost, what service we should expect, which evidence supports it, and when it would turn out to be the wrong call." })),
    h("section", { class: "card" }, h("h3", { text: "How this mission works" }),
      h("ol", {}, h("li", { text: "Investigate: inspect the tables and run SQL to find delayed shipments and the value at risk." }), h("li", { text: "Compare strategies: build at least two plans and compare them under the same assumptions." }), h("li", { text: "Decide and defend: link your evidence, state your numbers and the risks." }), h("li", { text: "Review: get feedback on your analysis and decision, separately from what happened by chance." }), h("li", { text: "Save a private, replayable record, then try a fresh variant on your own." })),
      h("p", { class: "muted", text: "You can explore strategies at any time. Final submission needs checked evidence." })),
    honestyCard(),
    modeCard());
}

function honestyCard() {
  return h("section", { class: "card honesty" }, h("h3", { text: "What is real here and what is simulated" }),
    h("ul", {},
      h("li", {}, h("strong", { text: "Real: " }), "your SQL runs in real SQLite (sql.js, WebAssembly) inside your browser, on an isolated read-only copy of the mission data. Results are checked by comparing what your query returns."),
      h("li", {}, h("strong", { text: "Simulated: " }), "the company, its data, the port delay and every outcome. The strategy forecast is a transparent teaching model with seeded randomness, not a prediction of any real port or market."),
      h("li", {}, h("strong", { text: "Shown only: " }), "R and Python equivalents in the Excel bridge are not executed in this release. No SAP, EViews, Excel or Power BI product is included or connected.")));
}

function modeCard() {
  const fresh = S.seed !== BASE_SEED;
  return h("section", { class: "card" }, h("h3", { text: "Learning modes" }),
    h("dl", { class: "modes" },
      h("dt", { text: "Guided" }), h("dd", { text: "Spreadsheet-style filters first, then annotated worked queries and every hint shown." }),
      h("dt", { text: "Assisted" }), h("dd", { text: "Query templates to complete, with optional hints. Hints used are recorded." }),
      h("dt", { text: "Independent" }), h("dd", { text: "A fresh dataset, a blank editor and no hints, to show you can transfer the skill." })),
    h("p", {}, `Dataset ${DATASET_VERSION}, seed ${S.seed} (${fresh ? "fresh variant" : "base mission"}). `),
    h("button", { type: "button", onclick: () => freshVariant() }, fresh ? "Start another fresh variant" : "Start a fresh variant"),
    h("p", { class: "muted", text: "Your record shows the mode, the dataset and the help you used. Only work on a fresh variant without hints counts as independent." }));
}

function freshVariant() {
  if (!confirm("Start a fresh variant? Your current work on this dataset stays in your portfolio only if you submitted it.")) return;
  const seed = 100000 + Math.floor(Math.random() * 899999);
  start(seed, S.mode, "briefing");
  say(`Fresh variant ready: seed ${seed}.`);
}

// ---------- Investigate ----------
function renderEvidence() {
  const sec = $("step-evidence");
  sec.replaceChildren(h("h2", { id: "h-evidence", text: "Investigate the evidence" }),
    h("div", { class: "cols" }, h("div", { id: "explorer", class: "card" }), h("div", { id: "quality", class: "card" })),
    h("details", { id: "drawer", class: "card drawer", open: true }, h("summary", {}, h("span", { class: "drawer-title", text: "Explore the data" }), h("span", { class: "muted", text: " · run SQL against the mission tables" })), h("div", { id: "workbench" })),
    h("details", { class: "card drawer" }, h("summary", {}, h("span", { class: "drawer-title", text: "Excel ↔ code bridge" }), h("span", { class: "muted", text: " · the same business question in Excel, SQL, R and Python" })), bridgeEl()));
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
  box.replaceChildren(h("h3", { text: "Evidence explorer" }),
    h("label", { for: "tablePick", text: "Table" }),
    h("select", { id: "tablePick", onchange: (e) => { S.table = e.target.value; save(); renderExplorer(); } }, Object.keys(t).map((k) => h("option", { value: k, selected: k === S.table ? true : null, text: `${k} (${t[k].length} rows)` }))),
    h("p", { class: "muted", text: doc._about || "" }),
    h("details", {}, h("summary", { text: "Column definitions and missing values" }), h("dl", { class: "schema" }, cols.flatMap((c, i) => [h("dt", {}, c, nulls[i] ? h("span", { class: "null-badge", text: `${nulls[i]} blank` }) : null), h("dd", { text: doc[c] || "" })]))),
    spreadsheet ? filterBar() : null,
    spreadsheet ? h("p", { class: "sumifs", id: "sumifs" }) : null,
    tableEl(cols, shown.map((r) => cols.map((c) => r[c])), { highlight: (r) => r.includes(null) }));
  if (spreadsheet) updateSumifs(shown);
}
function filterBar() {
  const f = S.filters, statuses = ["arrived", "in_transit", "held_at_port"];
  const products = [...new Set(S.scenario.tables.shipments.map((s) => s.product_id))].sort();
  const changed = () => { save(); renderExplorer(); };
  return h("fieldset", { class: "filters" }, h("legend", { text: "Spreadsheet filters (like AutoFilter)" }),
    h("div", { class: "filter-row" }, statuses.map((s) => h("label", {}, h("input", { type: "checkbox", checked: f.statuses.includes(s), onchange: (e) => { f.statuses = e.target.checked ? [...f.statuses, s] : f.statuses.filter((x) => x !== s); changed(); } }), " status = ", s))),
    h("label", {}, h("input", { type: "checkbox", checked: f.beforeAsOf, onchange: (e) => { f.beforeAsOf = e.target.checked; changed(); } }), ` ETA before the as-of date (${S.prep.info.as_of_date})`),
    h("label", {}, " product_id ", h("select", { onchange: (e) => { f.product = e.target.value; changed(); } }, h("option", { value: "", text: "(all)" }), products.map((p) => h("option", { value: p, selected: f.product === p ? true : null, text: p })))),
    h("div", { class: "filter-actions" }, h("button", { type: "button", class: "ghost", onclick: () => useFiltersAsSql() }, "Use these filters as SQL")));
}
function filterSql() {
  const f = S.filters, w = [];
  if (f.statuses.length) w.push(`status IN (${f.statuses.map((s) => `'${s}'`).join(", ")})`); else w.push("1 = 0");
  if (f.beforeAsOf) w.push(`eta_date < '${S.prep.info.as_of_date}'`);
  if (f.product) w.push(`product_id = '${f.product}'`);
  return `-- Generated from the spreadsheet filters\nSELECT shipment_id, product_id, status, eta_date,\n       CAST(julianday('${S.prep.info.as_of_date}') - julianday(eta_date) AS INTEGER) AS days_late,\n       quantity_units\nFROM shipments\nWHERE ${w.join("\n  AND ")};`;
}
function updateSumifs(rows) {
  const units = rows.reduce((s, r) => s + r.quantity_units, 0);
  $("sumifs").replaceChildren(h("strong", { text: `${rows.length} rows · ${units.toLocaleString("en-GB")} units` }), " · Excel: ", h("code", { text: `=COUNTIFS(...)` }), " and ", h("code", { text: `=SUMIFS(quantity_units, ...)` }), " give the same numbers.");
}
function useFiltersAsSql() {
  const id = "delayed";
  if (S.dirty[id] && !confirm("Your edited query will be replaced by the one generated from the filters. Continue?")) { say("Your edited query was kept."); return; }
  S.checkId = id; S.code[id] = filterSql(); S.dirty[id] = true; save();
  renderWorkbench(); $("drawer").open = true; $("editor").focus();
  say("The filters are now a SQL query in the editor.");
}

function renderQuality() {
  const box = $("quality"), traps = S.scenario.traps;
  const level = S.mode === "guided" ? "full" : S.mode === "assisted" ? "hint" : "none";
  box.replaceChildren(h("h3", { text: "Data quality" }),
    h("p", { text: "These exports have not been cleaned. Look for problems before you trust a number, and decide what each problem means rather than deleting rows." }),
    level === "none" ? h("p", { class: "muted", text: "Independent mode: no pointers. Use the column definitions and your queries." }) :
      h("ul", {}, [
        level === "full" ? `${traps.missingArrivalDate.length} shipments have status 'arrived' but a blank actual_arrival_date. A blank is a missing record, not a delay.` : "Some arrival dates are blank. Does a blank mean late?",
        level === "full" ? `Shipment ${traps.lowercaseProduct} stores its product_id in lower case, so an exact join to products drops it.` : "Does every shipment find its product when you join?",
        level === "full" ? `Invoices ${traps.duplicateInvoices.join(" and ")} were imported twice into freight_invoices.` : "Are there invoices that appear more than once?",
        level === "full" ? `${traps.atSeaLate} is past its ETA but still at sea ('in_transit'). It is delayed, but cannot be rerouted.` : "Is every late shipment at the port?",
      ].map((x) => h("li", { text: x }))),
    h("button", { type: "button", class: "ghost", onclick: () => openLineage("freight") }, "Trace the freight-invoice total"));
}

function renderWorkbench() {
  const c = CHECKS.find((x) => x.id === S.checkId), r = S.results[c.id];
  const wb = $("workbench");
  const hintsAllowed = S.mode === "assisted", shown = S.hintsShown[c.id] || 0;
  wb.replaceChildren(
    h("div", { class: "task-tabs", role: "tablist", "aria-label": "Analysis tasks" }, CHECKS.map((x) => h("button", { type: "button", role: "tab", "aria-selected": String(x.id === c.id), class: "task-tab", onclick: () => { S.checkId = x.id; save(); renderWorkbench(); } },
      x.title, S.results[x.id]?.grade ? h("span", { class: "badge " + (S.results[x.id].grade.pass ? "ok" : "no"), text: S.results[x.id].grade.pass ? "✓ checked" : "not yet" }) : null, x.required ? null : h("span", { class: "badge", text: "optional" })))),
    h("p", { class: "task", text: c.task }),
    h("label", { for: "predict", text: c.predict }),
    h("input", { id: "predict", type: "text", value: S.predictions[c.id] || "", oninput: (e) => { S.predictions[c.id] = e.target.value; save(); } }),
    h("label", { for: "editor", text: "SQL (SQLite). Ctrl+Enter or ⌘+Enter runs it. Tab indents; press Esc first to move focus out." }),
    h("textarea", { id: "editor", class: "editor", spellcheck: "false", autocapitalize: "off", autocomplete: "off", rows: "14", value: S.code[c.id],
      oninput: (e) => { S.code[c.id] = e.target.value; S.dirty[c.id] = true; save(); }, onkeydown: editorKeys }),
    h("div", { class: "wb-actions" },
      h("button", { type: "button", class: "primary", id: "runBtn", onclick: runCurrent }, "Run query"),
      h("button", { type: "button", id: "cancelBtn", disabled: true, onclick: () => sandbox.cancel() }, "Cancel"),
      h("button", { type: "button", class: "ghost", onclick: () => { if (S.dirty[c.id] && !confirm("Replace your query with the starting version?")) return; S.code[c.id] = starterCode(c); S.dirty[c.id] = false; save(); renderWorkbench(); } }, "Reset query"),
      hintsAllowed && shown < c.hints.length ? h("button", { type: "button", class: "ghost", onclick: () => { S.hintsShown[c.id] = shown + 1; S.hints++; save(); renderWorkbench(); } }, `Hint ${shown + 1} of ${c.hints.length}`) : null,
      hintsAllowed ? h("button", { type: "button", class: "ghost", onclick: () => { if (!confirm("Show the reference query? Your record will note that you saw it.")) return; S.revealed = true; S.code[c.id] = c.reference; S.dirty[c.id] = true; save(); renderWorkbench(); } }, "Show a reference query") : null),
    S.mode === "guided" ? h("ul", { class: "hints" }, c.hints.map((x) => h("li", { text: x }))) : null,
    hintsAllowed && shown ? h("ul", { class: "hints" }, c.hints.slice(0, shown).map((x) => h("li", { text: x }))) : null,
    h("div", { id: "resultBox", "aria-live": "polite" }, r ? resultEl(c, r) : h("p", { class: "muted", text: "Run the query to see the result and the check." })));
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
  $("resultBox").replaceChildren(h("p", { class: "muted", text: "Running in the sandbox…" }));
  try {
    const res = await sandbox.run(sql);
    const g = grade(c.id, res, S.scenario, S.exp);
    S.results[c.id] = { result: res, grade: g, sql, at: new Date().toISOString() };
    S.queries.push({ check: c.id, sql, pass: g.pass, ms: res.ms, rows: res.rowCount, at: S.results[c.id].at });
    say(g.pass ? "Query checked: correct." : "Query ran. The check found something to fix.");
  } catch (err) {
    S.results[c.id] = { error: err.message, sql };
    S.queries.push({ check: c.id, sql, pass: false, error: err.message, at: new Date().toISOString() });
    say("The query did not run: " + err.message);
  }
  save(); renderWorkbench(); renderKpis();
}
function resultEl(c, r) {
  if (r.error) return h("div", { class: "result error", role: "alert" }, h("strong", { text: "The query did not run. " }), r.error);
  const g = r.grade, f = g.facts || {};
  const actual = c.id === "delayed" ? f.count ?? f.unique : c.id === "exposure" ? (f.total ? eur(f.total) : null) : null;
  return h("div", { class: "result" },
    h("p", { class: "muted", text: `${r.result.rowCount} row${r.result.rowCount === 1 ? "" : "s"} · ${r.result.ms} ms · real SQLite in your browser${r.result.truncated ? " · first 1,000 rows shown" : ""}` }),
    tableEl(r.result.columns, r.result.values, { max: 50 }),
    h("div", { class: "check " + (g.pass ? "ok" : "no") }, h("strong", { text: g.pass ? "Check passed: the result matches the source data." : "Check: not yet." }),
      g.messages.length ? h("ul", {}, g.messages.map((m) => h("li", { text: m.text }))) : null),
    S.predictions[c.id] && g.pass && actual !== null ? h("p", { class: "predict" }, h("strong", { text: "Predict → run: " }), `you predicted "${S.predictions[c.id]}"; the checked result is ${actual}.`) : null,
    h("label", { for: "explain", text: "Explain: what does this result mean for the business? (one or two sentences)" }),
    h("textarea", { id: "explain", rows: "2", value: S.explanations[c.id] || "", oninput: (e) => { S.explanations[c.id] = e.target.value; save(); } }),
    h("label", { class: "inline" }, h("input", { type: "checkbox", checked: S.evidence.has("check:" + c.id), onchange: (e) => { e.target.checked ? S.evidence.add("check:" + c.id) : S.evidence.delete("check:" + c.id); save(); } }), " Link this result as evidence for my recommendation"));
}

function bridgeEl() {
  return h("div", { class: "bridge" }, h("p", { class: "muted", text: UNSUPPORTED_NOTE }),
    BRIDGE.map((b) => h("article", { class: "bridge-item" }, h("h4", { text: b.concept }), h("p", { text: b.business }),
      h("div", { class: "bridge-grid" },
        codeCard("Excel", b.excel, "Formula (not executed here)"),
        codeCard("SQL", b.sql, "Runs in the sandbox", () => { const id = S.checkId; if (S.dirty[id] && !confirm("Replace your edited query with this example?")) return; S.code[id] = `-- Excel bridge: ${b.concept}\n${b.sql}`; S.dirty[id] = true; save(); renderWorkbench(); $("drawer").open = true; $("editor").focus(); }),
        codeCard("R (dplyr)", b.r, "Shown only, not executed"),
        codeCard("Python (pandas)", b.python, "Shown only, not executed")),
      h("h5", { text: "Differences that matter" }), h("ul", {}, b.differences.map((d) => h("li", { text: d }))))));
}
function codeCard(lang, code, note, action) {
  return h("figure", { class: "code-card" }, h("figcaption", {}, h("strong", { text: lang }), " · ", note), h("pre", { class: "code", text: code }), action ? h("button", { type: "button", class: "ghost", onclick: action }, "Open in the editor") : null);
}

// ---------- Compare strategies ----------
function renderStrategy() {
  $("step-strategy").replaceChildren(h("h2", { id: "h-strategy", text: "Compare strategies" }),
    h("p", { class: "muted", text: "Explore freely. Every option below is run through the same seeded scenarios, so differences come from the plan, not from luck." }),
    h("div", { class: "cols wide" }, h("div", { id: "planner", class: "card" }), h("div", { id: "forecast", class: "card" })));
  renderPlanner(); renderForecast();
}
function renderPlanner() {
  const p = S.plan, info = S.prep.info, box = $("planner");
  const heldRows = S.prep.reroute.map((r) => { const s = S.prep.products.flatMap((x) => x.delayed.map((d) => ({ ...d, prod: x }))).find((d) => d.shipment_id === r.shipment_id); return { r, s }; });
  const changed = () => { save(); renderForecast(); renderKpis(); renderPlannerStatus(); };
  box.replaceChildren(h("h3", { text: "Build a plan" }),
    h("fieldset", {}, h("legend", { text: `Reroute via Antwerp (choose up to ${info.antwerp_slots})` }),
      h("p", { id: "slotStatus", class: "muted" }),
      h("div", { class: "reroute-list" }, heldRows.map(({ r, s }) => h("label", { class: "reroute" },
        h("input", { type: "checkbox", checked: p.reroute.includes(r.shipment_id), onchange: (e) => { p.reroute = e.target.checked ? [...p.reroute, r.shipment_id] : p.reroute.filter((x) => x !== r.shipment_id); changed(); } }),
        h("span", {}, h("strong", { text: r.shipment_id }), ` · ${s.prod.product_name} · ${s.quantity_units} units · margin at stake ${eur(s.quantity_units * s.prod.gross_margin_per_unit_eur)} · fee ${eur(r.extra_cost_eur)} · arrives in ${r.arrival_days} days`))))),
    h("fieldset", {}, h("legend", { text: "Emergency buy from a backup supplier" }),
      [["none", "No emergency buy"], ["eu", "Brabant Home Supply (EU): +24% price, arrives in 1 week"], ["tr", "Izmir Home Partners (TR): +10% price, arrives in 3 weeks"]].map(([v, l]) =>
        h("label", { class: "block" }, h("input", { type: "radio", name: "backup", value: v, checked: p.backup === v, onchange: () => { p.backup = v; if (v !== "none" && !p.coverWeeks) p.coverWeeks = 1; renderPlanner(); changed(); } }), " ", l)),
      h("label", { for: "cover", text: `Weeks of demand to buy for each exposed product: ${p.coverWeeks}` , id: "coverLabel"}),
      h("input", { id: "cover", type: "range", min: "0", max: "4", step: "0.5", value: String(p.coverWeeks), disabled: p.backup === "none" ? true : null, "aria-describedby": "coverLabel",
        oninput: (e) => { p.coverWeeks = Number(e.target.value); $("coverLabel").textContent = `Weeks of demand to buy for each exposed product: ${p.coverWeeks}`; changed(); } })),
    h("fieldset", {}, h("legend", { text: "Other actions (independent of each other)" }),
      h("label", { class: "block" }, h("input", { type: "checkbox", checked: p.earlyOrder, onchange: (e) => { p.earlyOrder = e.target.checked; changed(); } }), " Bring the next regular order forward (2 weeks of demand, arrives week 7, normal price)"),
      h("label", { class: "block" }, h("input", { type: "checkbox", checked: p.lease, onchange: (e) => { p.lease = e.target.checked; changed(); } }), ` Lease ${S.prep.warehouse.lease_block_pallets} extra pallet positions (${eur(S.prep.warehouse.lease_cost_eur_week)}/week, 8-week minimum)`)),
    h("div", { id: "planStatus" }),
    h("div", { class: "row" },
      h("button", { type: "button", class: "primary", onclick: saveOption }, "Save this plan for comparison"),
      h("button", { type: "button", class: "ghost", onclick: () => { S.plan = structuredClone(EMPTY_PLAN); save(); renderPlanner(); changed(); } }, "Clear plan")),
    assumptionsEl());
  renderPlannerStatus();
}
function renderPlannerStatus() {
  const v = violations(S.prep, S.plan);
  $("slotStatus").textContent = `${S.plan.reroute.length} of ${S.prep.info.antwerp_slots} slots used.`;
  $("planStatus").replaceChildren(v.length ? h("div", { class: "callout warn", role: "status" }, h("strong", { text: "This plan breaks a constraint: " }), v.map((x) => x.text).join(" ")) : h("p", { class: "muted", role: "status", text: `Cash committed: ${eur(planCash(S.prep, S.plan))} of ${eur(S.prep.info.emergency_budget_eur)}.` }));
}
function assumptionsEl() {
  const a = S.assumptions;
  const set = (k, v) => { a[k] = v; S.sample = draws(S.seed, a); save(); renderForecast(); renderKpis(); };
  const slider = (k, label, min, max, step, unit) => h("div", { class: "slider" },
    h("label", { for: "as-" + k, id: "asl-" + k, text: `${label}: ${a[k]}${unit}` }),
    h("input", { id: "as-" + k, type: "range", min, max, step, value: String(a[k]), oninput: (e) => { const v = Number(e.target.value); $("asl-" + k).textContent = `${label}: ${v}${unit}`; set(k, v); } }));
  const changed = a.delayMode !== DEFAULT_ASSUMPTIONS.delayMode || a.delayMax !== DEFAULT_ASSUMPTIONS.delayMax || a.demandShiftPct !== 0;
  return h("details", { class: "assumptions", open: changed ? true : null }, h("summary", { text: "Assumptions (optional)" }),
    h("p", { class: "muted", text: `The briefing forecast is ${BRIEFING_DELAY.min}–${BRIEFING_DELAY.max} weeks, most likely ${BRIEFING_DELAY.mode}. Your decision is judged against that forecast. If you change these sliders to explore, explain why in your defense.` }),
    slider("delayMode", "Most likely port delay", "1.5", "6", "0.5", " weeks"),
    slider("delayMax", "Worst-case port delay", "4", "9", "0.5", " weeks"),
    slider("demandShiftPct", "Demand change vs plan", "-20", "20", "5", "%"),
    h("button", { type: "button", class: "ghost", onclick: () => { S.assumptions = { ...DEFAULT_ASSUMPTIONS }; S.sample = draws(S.seed, S.assumptions); save(); renderStrategy(); renderKpis(); } }, "Reset to the briefing forecast"));
}
function planLabel(p) {
  const parts = [];
  if (p.reroute.length) parts.push(`reroute ${p.reroute.length}`);
  if (p.backup !== "none" && p.coverWeeks) parts.push(`${p.backup.toUpperCase()} buy ${p.coverWeeks} wk`);
  if (p.earlyOrder) parts.push("early order");
  if (p.lease) parts.push("lease space");
  return parts.length ? parts.join(" + ") : "Hold steady (do nothing)";
}
function saveOption() {
  const key = JSON.stringify(S.plan);
  if (S.options.some((o) => JSON.stringify(o.plan) === key)) { say("This plan is already in the comparison."); return; }
  if (S.options.length >= 5) { say("You can compare up to five plans. Remove one first."); return; }
  S.options.push({ name: String.fromCharCode(65 + S.options.length), plan: structuredClone(S.plan) });
  save(); renderForecast(); say(`Saved as option ${S.options.at(-1).name}.`);
}
function renderForecast() {
  const box = $("forecast"); if (!box) return;
  const rows = [{ name: "Now", label: "Your current plan", plan: S.plan, current: true }, ...S.options.map((o) => ({ ...o, label: planLabel(o.plan) }))];
  if (!S.options.some((o) => planLabel(o.plan) === "Hold steady (do nothing)") && planLabel(S.plan) !== "Hold steady (do nothing)") rows.push({ name: "Base", label: "Hold steady (do nothing)", plan: EMPTY_PLAN, baseline: true });
  const results = rows.map((r) => ({ ...r, e: evaluatePlan(S.prep, r.plan, S.sample), v: violations(S.prep, r.plan) }));
  const maxCost = Math.max(...results.map((r) => r.e.p90)) * 1.08;
  const W = 600, rowH = 46, pad = 200, right = 78, chartH = results.length * rowH + 30;
  const x = (v) => pad + (W - pad - right) * (v / maxCost);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${chartH}`); svg.setAttribute("class", "chart"); svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Expected disruption cost per plan with the P10 to P90 range");
  const add = (tag, attrs, text) => { const el = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); if (text) el.textContent = text; svg.append(el); return el; };
  results.forEach((r, i) => {
    const y = 10 + i * rowH;
    add("text", { x: 0, y: y + 18, class: "c-label" }, `${r.name}: ${r.label.length > 26 ? r.label.slice(0, 25) + "…" : r.label}`);
    add("line", { x1: x(r.e.p10), x2: x(r.e.p90), y1: y + 14, y2: y + 14, class: "c-range" });
    add("rect", { x: pad, y: y + 6, width: Math.max(1, x(r.e.expectedCost) - pad), height: 16, rx: 4, class: "c-bar" + (r.current ? " now" : "") + (r.v.length ? " broken" : "") });
    add("text", { x: x(r.e.p90) + 6, y: y + 18, class: "c-val" }, eur(r.e.expectedCost));
  });
  add("text", { x: pad, y: chartH - 4, class: "c-axis" }, "Bar: expected cost · line: P10–P90 range (same scenarios for every plan)");
  const table = tableEl(["Option", "Plan", "Cash", "Expected cost", "P10–P90", "Fill rate", "Service target met", "Excess stock", "Constraints"],
    results.map((r) => [r.name, r.label, eur(r.e.cash), eur(r.e.expectedCost), `${eur(r.e.p10)} – ${eur(r.e.p90)}`, pct(r.e.expectedFill), pct(r.e.pServiceMet, 0) + " of runs", eur(r.e.expectedExcess), r.v.length ? r.v.map((v) => v.kind).join(", ") : "OK"]));
  const compared = S.options.length >= 1 && results.length >= 2;
  box.replaceChildren(h("h3", { text: "Executive forecast (simulated)" }), svg, table,
    S.options.length ? h("div", { class: "row" }, S.options.map((o) => h("button", { type: "button", class: "ghost", onclick: () => { S.options = S.options.filter((x) => x !== o); S.options.forEach((x, i) => (x.name = String.fromCharCode(65 + i))); save(); renderForecast(); } }, `Remove option ${o.name}`)),
      h("button", { type: "button", class: "ghost", onclick: () => openLineage("cost") }, "Trace the cost of the current plan")) : h("p", { class: "muted", text: "Save at least one plan to compare it with others. You need two or more compared strategies before you submit." }),
    compared ? h("label", { class: "inline" }, h("input", { type: "checkbox", checked: S.evidence.has("comparison"), onchange: (e) => { e.target.checked ? S.evidence.add("comparison") : S.evidence.delete("comparison"); save(); } }), " Link this comparison as evidence") : null);
}

// ---------- Decide & defend ----------
function evidenceItems() {
  const items = [];
  for (const c of CHECKS) if (S.results[c.id]?.grade) items.push({ id: "check:" + c.id, label: `SQL: ${c.title}`, kind: "check", pass: S.results[c.id].grade.pass });
  const lin = { var: "Trace: inventory value at risk", cash: "Trace: emergency cash", cost: "Trace: expected disruption cost", fill: "Trace: forecast fill rate", cover: "Trace: stock cover", excess: "Trace: excess stock", freight: "Trace: freight invoiced" };
  for (const id of S.viewed) items.push({ id: "kpi:" + id, label: lin[id], kind: "kpi" });
  if (S.options.length >= 1) items.push({ id: "comparison", label: `Strategy comparison (${S.options.length + 1} plans, same scenarios)`, kind: "comparison" });
  return items;
}
function gate() {
  const linked = evidenceItems().filter((i) => S.evidence.has(i.id));
  const req = CHECKS.filter((c) => c.required);
  return [
    { ok: req.every((c) => S.results[c.id]?.grade), text: "Run both required SQL analyses" },
    { ok: req.some((c) => S.results[c.id]?.grade?.pass), text: "At least one required analysis passes its check" },
    { ok: S.options.length >= 1, text: "Compare at least two strategies" },
    { ok: linked.length >= 2, text: "Link at least two pieces of evidence" },
    { ok: S.defense.recommendation.trim().length > 0, text: "Write a recommendation" },
  ];
}
function renderDefend() {
  const d = S.defense, sec = $("step-defend"), e = current();
  const items = evidenceItems();
  const field = (k, label, attrs = {}) => [h("label", { for: "d-" + k, text: label }), h("input", { id: "d-" + k, value: d[k], ...attrs, oninput: (ev) => { d[k] = ev.target.value; save(); renderGate(); } })];
  sec.replaceChildren(h("h2", { id: "h-defend", text: "Decide and defend" }),
    h("div", { class: "cols" },
      h("section", { class: "card" }, h("h3", { text: "Your decision" }),
        h("p", {}, h("strong", { text: planLabel(S.plan) }), ` · cash ${eur(e.cash)} · `, h("button", { type: "button", class: "link", onclick: () => go("strategy") }, "change the plan")),
        violations(S.prep, S.plan).length ? h("p", { class: "callout warn", text: violations(S.prep, S.plan).map((v) => v.text).join(" ") }) : null,
        h("fieldset", {}, h("legend", { text: "Evidence for your recommendation" }),
          items.length ? items.map((i) => h("label", { class: "block" }, h("input", { type: "checkbox", checked: S.evidence.has(i.id), onchange: (ev) => { ev.target.checked ? S.evidence.add(i.id) : S.evidence.delete(i.id); save(); renderGate(); } }), " ", i.label, i.kind === "check" ? h("span", { class: "badge " + (i.pass ? "ok" : "no"), text: i.pass ? "checked" : "not passed" }) : null))
            : h("p", { class: "muted", text: "Run queries, open KPI traces or compare strategies to create evidence you can link." }))),
      h("section", { class: "card" }, h("h3", { text: "Boardroom defense" }),
        h("label", { for: "d-rec", text: "Recommendation: what will we do, why, and what does it cost?" }),
        h("textarea", { id: "d-rec", rows: "5", value: d.recommendation, oninput: (ev) => { d.recommendation = ev.target.value; save(); renderGate(); } }),
        h("div", { class: "grid3" },
          h("div", {}, field("claimedCost", "Expected cost of the plan (€)", { type: "number", inputmode: "numeric" })),
          h("div", {}, field("claimedFillPct", "Expected fill rate (%)", { type: "number", step: "0.1", inputmode: "decimal" })),
          h("div", {}, field("claimedP90", "Downside cost, 90th percentile (€)", { type: "number", inputmode: "numeric" }))),
        h("fieldset", {}, h("legend", { text: "This plan would be the wrong choice if the port delay is…" }),
          [["shorter", "shorter than expected"], ["longer", "longer than expected"]].map(([v, l]) => h("label", { class: "block" }, h("input", { type: "radio", name: "weak", value: v, checked: d.weakSpot === v, onchange: () => { d.weakSpot = v; save(); } }), " ", l))),
        h("label", { class: "block" }, h("input", { type: "checkbox", checked: d.acceptShortfall, onchange: (ev) => { d.acceptShortfall = ev.target.checked; save(); renderDefend(); } }), " I accept that this plan may miss the 95% service target"),
        d.acceptShortfall ? [h("label", { for: "d-sr", text: "Why is that acceptable? (at least 8 words)" }), h("textarea", { id: "d-sr", rows: "2", value: d.shortfallReason, oninput: (ev) => { d.shortfallReason = ev.target.value; save(); } })] : null,
        h("label", { for: "d-an", text: "If you changed the forecast assumptions, which ones and why? (optional)" }),
        h("textarea", { id: "d-an", rows: "2", value: d.assumptionNote, oninput: (ev) => { d.assumptionNote = ev.target.value; save(); } }))),
    h("section", { class: "card" }, h("h3", { text: "Ready to submit?" }), h("ul", { id: "gate", class: "gate" }), h("button", { type: "button", class: "primary", id: "submitBtn", onclick: submit }, "Submit to the board"),
      h("p", { class: "muted", text: "Your numbers are compared with the model; quote them from Compare strategies or the KPI traces." })));
  renderGate();
}
function renderGate() {
  const g = gate();
  $("gate").replaceChildren(...g.map((x) => h("li", { class: x.ok ? "ok" : "no" }, h("span", { "aria-hidden": "true", text: x.ok ? "✓ " : "○ " }), x.text, h("span", { class: "visually-hidden", text: x.ok ? " (done)" : " (to do)" }))));
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
  S.record.explanations = { ...S.explanations }; S.record.predictions = { ...S.predictions };
  S.record.id = "rec-" + Date.now().toString(36);
  const list = store.get("bizdata-portfolio", []);
  list.unshift(S.record);
  const saved = store.set("bizdata-portfolio", list);
  save(); go("review");
  say(saved ? "Submitted. Your record is saved privately in this browser." : "Submitted. This browser blocked storage, so export your record from the Portfolio step.");
}

// ---------- Review ----------
function renderReview() {
  const sec = $("step-review"), ev = S.evaluation;
  if (!ev) { sec.replaceChildren(h("h2", { id: "h-review", text: "Review" }), h("p", { text: "Submit a recommendation to get feedback." }), h("button", { type: "button", onclick: () => go("defend") }, "Go to Decide & defend")); return; }
  const fb = ev.feedback, o = ev.outcome;
  const group = (title, list, cls) => h("section", { class: "fb " + cls }, h("h4", { text: `${title} (${list.length})` }), list.length ? h("ul", {}, list.map((t) => h("li", { text: t }))) : h("p", { class: "muted", text: "Nothing to report." }));
  sec.replaceChildren(h("h2", { id: "h-review", text: "Board review" }),
    h("div", { class: "cols" },
      h("section", { class: "card" }, h("h3", { text: `Rubric: ${ev.total} / ${ev.max}` }),
        tableEl(["Criterion", "Score", "How it is scored"], ev.criteria.map((c) => [c.label, `${c.score} / ${c.max}`, c.how]))),
      h("section", { class: "card" }, h("h3", { text: "Decision quality" }),
        h("p", { class: "verdict " + (ev.decision.defensible ? "ok" : "no"), text: ev.decision.defensible ? "Defensible: within the constraints, and no feasible alternative is clearly better on both cost and service without more cash." : ev.decision.violations.length ? "Not defensible as submitted: it breaks a constraint." : "Not defensible as submitted: a feasible alternative is clearly better (see below)." }),
        h("p", { class: "muted", text: "Judged on the briefing's delay forecast, the information you had when you decided." }),
        h("h4", { text: "What happened next (one simulated draw, not scored)" }),
        h("p", { text: `The port released after ${o.delayWeeks.toFixed(1)} weeks and demand ran at ${pct(o.demandFactor, 0)} of plan. Your plan's cost in this draw: ${eur(o.cost)}, fill rate ${pct(o.fillRate)}. In hindsight, "${o.bestInHindsight.label}" would have cost ${eur(o.bestInHindsight.total)}; your plan ranks ${o.rank} of ${o.of}.` }),
        h("p", { class: "callout", text: "A good decision can meet bad luck, and a weak one can get lucky. This outcome does not change your score." }))),
    h("div", { class: "fb-grid" }, group("Calculation errors", fb.calculation, "calc"), group("Unsupported claims", fb.unsupported, "claims"), group("Constraint issues", fb.constraints, "cons"), group("Defensible alternatives", fb.alternatives, "alt")),
    h("div", { class: "row" }, h("button", { type: "button", class: "primary", onclick: () => go("portfolio") }, "Open my portfolio"), h("button", { type: "button", onclick: () => freshVariant() }, "Try a fresh variant"), h("button", { type: "button", class: "ghost", onclick: () => go("defend") }, "Revise and resubmit")));
}

// ---------- Portfolio ----------
function renderPortfolio() {
  const sec = $("step-portfolio"), list = store.get("bizdata-portfolio", []);
  sec.replaceChildren(h("h2", { id: "h-portfolio", text: "Private portfolio" }),
    h("p", { class: "callout", text: "Records are saved only in this browser on this device and are never shared. Export a file to keep a copy. Public sharing is not available in this release." }),
    ...(list.length ? list.map((r) => recordCard(r)) : [h("p", { class: "muted", text: "No records yet. Submit a recommendation to create your first BizData completion record." })]));
}
function recordCard(r) {
  const bullets = cvBullets(r).join("\n");
  return h("article", { class: "card record" },
    h("h3", { text: `${r.title}: ${r.mission_title}` }),
    h("p", { text: `${new Date(r.submitted_at).toLocaleString("en-GB")} · seed ${r.seed} (${r.variant}) · ${r.mode} mode · ${demonstrated(r)} · rubric ${r.evaluation.total}/${r.evaluation.max} · ${r.evaluation.defensible ? "defensible decision" : "decision not defensible as submitted"}` }),
    h("p", { class: "muted", text: "A record of a simulated exercise with synthetic data. Not an accredited certificate; not endorsed by any employer, software vendor or professional body." }),
    h("label", { for: "cv-" + r.id, text: "CV bullets (edit before use; they describe only what you did here)" }),
    h("textarea", { id: "cv-" + r.id, rows: "4", value: bullets }),
    h("div", { class: "row" },
      h("button", { type: "button", onclick: (e) => replay(r, e.target) }, "Replay and verify"),
      h("button", { type: "button", class: "ghost", onclick: () => download(`bizdata-${r.id}.json`, JSON.stringify(r, null, 2), "application/json") }, "Export JSON"),
      h("button", { type: "button", class: "ghost", onclick: () => download(`bizdata-${r.id}.md`, toMarkdown(r), "text/markdown") }, "Export Markdown"),
      h("button", { type: "button", class: "ghost", onclick: async () => { try { await navigator.clipboard.writeText($("cv-" + r.id).value); say("CV bullets copied."); } catch { say("Copy was blocked; select the text instead."); } } }, "Copy CV bullets"),
      h("button", { type: "button", class: "ghost danger", onclick: () => { if (!confirm("Delete this record from this browser?")) return; store.set("bizdata-portfolio", store.get("bizdata-portfolio", []).filter((x) => x.id !== r.id)); renderPortfolio(); } }, "Delete")),
    h("p", { class: "replay", id: "replay-" + r.id, "aria-live": "polite" }));
}
/** Rebuilds the dataset from the seed, re-runs the saved SQL in a fresh sandbox and re-scores the decision. */
async function replay(r, button) {
  const out = $("replay-" + r.id);
  button.disabled = true; out.textContent = "Replaying…";
  const scenario = buildScenario(r.seed), box = new Sandbox(toSqlScript(scenario));
  try {
    const checks = {};
    for (const c of CHECKS) {
      const q = r.execution.queries.find((x) => x.check === c.id);
      checks[c.id] = q ? grade(c.id, await box.run(q.sql), scenario) : { pass: false, messages: [] };
    }
    const ev = evaluate(scenario, { seed: r.seed, plan: r.plan, assumptions: r.assumptions, checks, evidence: r.evidence, defense: r.defense });
    const same = ev.total === r.evaluation.total && Math.abs(ev.outcome.cost - r.evaluation.outcome.cost) < 0.01 && Object.keys(checks).every((k) => checks[k].pass === r.checks[k].pass);
    out.textContent = same ? `Replay verified: the saved queries re-ran on dataset ${r.dataset_version} seed ${r.seed} with the same check results, rubric ${ev.total}/${ev.max} and outcome.` : `Replay differs from the saved record (rubric now ${ev.total}/${ev.max}). The record may come from an older version of the mission.`;
  } catch (e) { out.textContent = "Replay failed: " + e.message; }
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
  $("simNote").textContent = `Simulated: ${COMPANY.name} is fictional and every figure is synthetic (dataset ${DATASET_VERSION}, seed ${S.seed}). This is not live market, port or company data.`;
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

// ---------- boot ----------
$("mode").addEventListener("change", (e) => {
  const mode = e.target.value;
  if (mode === "guided") S.revealed = true; // guided shows worked solutions
  S.mode = mode;
  for (const c of CHECKS) if (!S.dirty[c.id]) S.code[c.id] = starterCode(c);
  save(); go(S.step);
  say(mode === "independent" && S.seed === BASE_SEED ? "Independent mode. Start a fresh variant from the briefing for it to count as independent." : `${mode[0].toUpperCase() + mode.slice(1)} mode.`);
});
$("closeLineage").onclick = () => $("lineage").close();
$("lineage").addEventListener("close", () => { if (S.step === "defend") renderDefend(); });
await store.load();
restore();
