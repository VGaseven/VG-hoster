// BizData Stack Sandbox (Hub → Work): dataset, real SQL grading, model, rubric and portfolio honesty.
import { test } from "node:test";
import assert from "node:assert/strict";
import initSqlJs from "sql.js";
import { buildScenario, toSqlScript, BASE_SEED } from "../public/tools/bizdata/lib/dataset.js";
import { CHECKS, grade, expected } from "../public/tools/bizdata/lib/checks.js";
import { prepare, draws, evaluatePlan, judgePlan, referencePlans, realizedDraw, EMPTY_PLAN, violations, weakSpot } from "../public/tools/bizdata/lib/model.js";
import { evaluate } from "../public/tools/bizdata/lib/rubric.js";
import { buildRecord, cvBullets, demonstrated, toMarkdown } from "../public/tools/bizdata/lib/portfolio.js";
import { BRIDGE } from "../public/tools/bizdata/lib/bridge.js";

const SQL = await initSqlJs();
const base = buildScenario(BASE_SEED);

// Mirrors public/tools/bizdata/sql-worker.js: a fresh read-only database per run, last statement's result.
function run(scenario, sql) {
  const db = new SQL.Database();
  db.run(toSqlScript(scenario));
  db.run("PRAGMA query_only = ON");
  try {
    const res = db.exec(sql);
    const last = res[res.length - 1] || { columns: [], values: [] };
    return { columns: last.columns, values: last.values };
  } finally { db.close(); }
}
const check = (id) => CHECKS.find((c) => c.id === id);
const gradeSql = (id, sql, sc = base) => grade(id, run(sc, sql), sc);

test("scenarios are deterministic per seed, differ between seeds and contain the data-quality traps", () => {
  assert.deepEqual(buildScenario(BASE_SEED), buildScenario(BASE_SEED));
  assert.notDeepEqual(buildScenario(BASE_SEED).tables.shipments, buildScenario(77).tables.shipments);
  const t = base.tables;
  assert.equal(base.traps.missingArrivalDate.length, 3);
  for (const id of base.traps.missingArrivalDate) { const s = t.shipments.find((x) => x.shipment_id === id); assert.equal(s.status, "arrived"); assert.equal(s.actual_arrival_date, null); }
  assert.match(t.shipments.find((s) => s.shipment_id === base.traps.lowercaseProduct).product_id, /^p-\d+$/);
  for (const id of base.traps.duplicateInvoices) assert.equal(t.freight_invoices.filter((f) => f.invoice_id === id).length, 2);
  const atSea = t.shipments.find((s) => s.shipment_id === base.traps.atSeaLate);
  assert.equal(atSea.status, "in_transit"); assert.ok(atSea.eta_date < t.mission_info[0].as_of_date);
});

test("the dataset loads into real SQLite with every row", () => {
  for (const [table, rows] of Object.entries(base.tables)) assert.equal(run(base, `SELECT COUNT(*) FROM ${table}`).values[0][0], rows.length, table);
});

test("every reference query passes its own check, on the base mission and on fresh variants", () => {
  for (const seed of [BASE_SEED, 7, 42, 999]) {
    const sc = buildScenario(seed);
    for (const c of CHECKS) { const g = gradeSql(c.id, c.reference, sc); assert.ok(g.pass, `${c.id} seed ${seed}: ${JSON.stringify(g.messages)}`); }
  }
});

test("different valid queries are accepted (aliases, literals, subqueries, LEFT JOIN, ordering)", () => {
  const delayed = [
    `SELECT eta_date, shipment_id AS id, julianday('2026-03-02') - julianday(eta_date) AS late FROM shipments WHERE status IN ('in_transit','held_at_port') AND eta_date < '2026-03-02'`,
    `WITH asof AS (SELECT as_of_date d FROM mission_info) SELECT shipment_id, CAST((SELECT julianday(d) FROM asof) - julianday(eta_date) AS INT) FROM shipments WHERE NOT status = 'arrived' AND eta_date < (SELECT d FROM asof) ORDER BY shipment_id`,
  ];
  for (const q of delayed) { const g = gradeSql("delayed", q); assert.ok(g.pass, q + JSON.stringify(g.messages)); }
  const exposure = [
    `SELECT UPPER(s.product_id) AS prod, SUM(s.quantity_units * p.unit_value_eur) AS v FROM shipments s LEFT JOIN products p ON p.product_id = UPPER(s.product_id) WHERE s.status != 'arrived' AND s.eta_date < '2026-03-02' GROUP BY UPPER(s.product_id)`,
    `SELECT p.product_id, (SELECT SUM(quantity_units) FROM shipments x WHERE UPPER(x.product_id) = p.product_id AND x.status <> 'arrived' AND x.eta_date < '2026-03-02') * p.unit_value_eur AS value FROM products p WHERE value IS NOT NULL`,
  ];
  for (const q of exposure) { const g = gradeSql("exposure", q); assert.ok(g.pass, q + JSON.stringify(g.messages)); }
  assert.ok(gradeSql("freight", `SELECT SUM(amount_eur) FROM freight_invoices WHERE rowid IN (SELECT MIN(rowid) FROM freight_invoices GROUP BY invoice_id) AND shipment_id IN (SELECT shipment_id FROM shipments WHERE status <> 'arrived' AND eta_date < '2026-03-02')`).pass);
});

test("incorrect analyses fail with specific, factual feedback", () => {
  // Treating a blank arrival date as "late" counts arrived shipments.
  let g = gradeSql("delayed", `SELECT shipment_id, julianday('2026-03-02') - julianday(eta_date) FROM shipments WHERE actual_arrival_date IS NULL AND eta_date < '2026-03-02'`);
  assert.equal(g.pass, false);
  assert.ok(g.messages.some((m) => m.text.includes("only the arrival date is missing")), JSON.stringify(g.messages));
  // Only looking at the port misses the late vessel still at sea.
  g = gradeSql("delayed", `SELECT shipment_id, julianday('2026-03-02') - julianday(eta_date) FROM shipments WHERE status = 'held_at_port'`);
  assert.equal(g.pass, false);
  assert.ok(g.messages.some((m) => m.text.includes("still at sea")));
  // Right rows but no days-late column.
  g = gradeSql("delayed", `SELECT shipment_id FROM shipments WHERE status <> 'arrived' AND eta_date < '2026-03-02'`);
  assert.equal(g.pass, false);
  assert.ok(g.messages.some((m) => m.text.includes("days late")));
  // Exact-match join drops the lower-case product key.
  g = gradeSql("exposure", check("exposure").assisted);
  assert.equal(g.pass, false);
  assert.ok(g.messages.some((m) => m.text.includes("lower case")), JSON.stringify(g.messages));
  // Plain SUM double-counts the duplicated invoices.
  g = gradeSql("freight", check("freight").assisted);
  assert.equal(g.pass, false);
  assert.ok(g.messages.some((m) => m.text.includes("twice")));
  // A grand total is not a per-product answer.
  assert.equal(gradeSql("exposure", `SELECT SUM(quantity_units) FROM shipments`).pass, false);
  // The assisted template is not a solution until the student completes it.
  assert.equal(gradeSql("delayed", check("delayed").assisted).pass, false);
});

test("the sandbox database is read-only: student SQL cannot change the data", () => {
  assert.throws(() => run(base, "DELETE FROM shipments"), /readonly|query_only|attempt to write/i);
  assert.throws(() => run(base, "DROP TABLE products"), /readonly|query_only|attempt to write/i);
  // Each run starts from the original data again (reset).
  assert.equal(run(base, "SELECT COUNT(*) FROM shipments").values[0][0], base.tables.shipments.length);
});

test("missing data is handled explicitly in the model: blank arrival dates on arrived shipments are not delayed", () => {
  const prep = prepare(base);
  const delayedIds = prep.products.flatMap((p) => p.delayed.map((d) => d.shipment_id));
  for (const id of base.traps.missingArrivalDate) assert.ok(!delayedIds.includes(id));
  assert.ok(delayedIds.includes(base.traps.lowercaseProduct), "the lower-case key still counts in the model");
  assert.deepEqual(new Set(delayedIds), new Set(expected(base).delayed.keys()));
});

test("model results and realized outcomes repeat exactly for the same seed", () => {
  const prep = prepare(base);
  const plan = { ...EMPTY_PLAN, backup: "eu", coverWeeks: 1 };
  assert.deepEqual(evaluatePlan(prep, plan, draws(BASE_SEED)), evaluatePlan(prep, plan, draws(BASE_SEED)));
  assert.deepEqual(realizedDraw(BASE_SEED), realizedDraw(BASE_SEED));
  assert.notDeepEqual(realizedDraw(BASE_SEED), realizedDraw(BASE_SEED + 1));
});

test("at least two different kinds of strategy are defensible, and no option is a guaranteed disaster", () => {
  for (const seed of [BASE_SEED, 7, 42, 1234, 99991]) {
    const prep = prepare(buildScenario(seed));
    const j = judgePlan(prep, EMPTY_PLAN, draws(seed));
    const families = new Set(j.frontier.map((f) => (f.plan.reroute.length && f.plan.backup !== "none" ? "mix" : f.plan.reroute.length ? "reroute" : f.plan.backup !== "none" ? "buy" : f.plan.earlyOrder ? "early" : "hold")));
    assert.ok(families.size >= 2, `seed ${seed}: only ${[...families]}`);
    const sample = draws(seed);
    for (const r of referencePlans(prep)) { const e = evaluatePlan(prep, r.plan, sample); assert.ok(e.expectedFill > 0.8, `${r.id} fill ${e.expectedFill}`); }
  }
});

test("constraints are enforced: over budget and over the Antwerp slot limit", () => {
  const prep = prepare(base);
  assert.deepEqual(violations(prep, EMPTY_PLAN), []);
  assert.ok(violations(prep, { ...EMPTY_PLAN, backup: "eu", coverWeeks: 4 }).some((v) => v.kind === "budget"));
  assert.ok(violations(prep, { ...EMPTY_PLAN, reroute: prep.reroute.map((r) => r.shipment_id) }).some((v) => v.kind === "slots"));
});

function goodSubmission(sc, planId) {
  const prep = prepare(sc), sample = draws(sc.seed);
  const plan = referencePlans(prep).find((r) => r.id === planId).plan;
  const e = evaluatePlan(prep, plan, sample);
  const checks = Object.fromEntries(CHECKS.map((c) => [c.id, gradeSql(c.id, c.reference, sc)]));
  return {
    seed: sc.seed, plan, checks,
    evidence: [{ id: "delayed", label: "Delayed shipments", kind: "check", pass: true }, { id: "exposure", label: "Value at risk", kind: "check", pass: true }],
    defense: {
      recommendation: "Reroute the containers with the most margin per euro of fee and buy one week of EU cover, because it keeps service near target while holding back cash for a longer disruption.",
      claimedCost: Math.round(e.expectedCost), claimedFillPct: (e.expectedFill * 100).toFixed(1), claimedP90: Math.round(e.p90),
      weakSpot: weakSpot(prep, plan).worst, acceptShortfall: e.pServiceMet < 0.5, shortfallReason: "We keep cash for the longer disruption risk and accept a short service dip on low-margin lines.",
    },
  };
}

test("rubric: a complete, evidenced defense of a defensible plan scores full marks; weaknesses are named by category", () => {
  const sub = goodSubmission(base, "mix-1");
  const ev = evaluate(base, sub);
  assert.equal(ev.total, ev.max, JSON.stringify(ev.feedback));
  assert.equal(ev.decision.defensible, true);
  // Same plan, wrong numbers and no evidence: unsupported claims, not calculation errors.
  const weak = evaluate(base, { ...sub, evidence: [], defense: { ...sub.defense, claimedCost: 1000, claimedFillPct: "99.9", recommendation: "Do the mix." } });
  assert.ok(weak.total < ev.total);
  assert.ok(weak.feedback.unsupported.length >= 3);
  assert.equal(weak.feedback.calculation.length, 0);
  // Over budget: constraint violation reported.
  const over = evaluate(base, { ...sub, plan: { ...EMPTY_PLAN, backup: "eu", coverWeeks: 4 } });
  assert.equal(over.criteria.find((c) => c.id === "constraints").score, 0);
  assert.ok(over.feedback.constraints.some((t) => t.includes("emergency budget")));
});

test("decision quality is separate from the realized outcome", () => {
  // Two different defensible plans both get full decision credit, whatever the single realized draw did to them.
  for (const id of ["mix-1", "eu-1"]) {
    const ev = evaluate(base, goodSubmission(base, id));
    assert.equal(ev.decision.defensible, true, id);
    assert.equal(ev.total, ev.max, id);
    assert.ok(ev.outcome.rank >= 1 && Number.isFinite(ev.outcome.cost));
  }
  const a = evaluate(base, goodSubmission(base, "mix-1")), b = evaluate(base, goodSubmission(base, "eu-1"));
  assert.equal(a.outcome.delayWeeks, b.outcome.delayWeeks, "every plan faces the same realized draw");
});

test("portfolio records are private and CV bullets never overstate the mode or invent credentials", () => {
  const sub = goodSubmission(base, "mix-1"), evaluation = evaluate(base, sub);
  const rec = (mode, hints, revealed, sc = base) => buildRecord({ scenario: sc, mode, hints, revealed, queries: [], checks: sub.checks, plan: sub.plan, assumptions: {}, evidence: sub.evidence, defense: sub.defense, evaluation, startedAt: "2026-10-21T00:00:00Z" });
  const guided = rec("guided", 0, false);
  assert.equal(guided.sharing, "private");
  assert.match(demonstrated(guided), /guidance/);
  for (const b of cvBullets(guided)) assert.doesNotMatch(b, /independent|certified|accredited|employer|increased|saved €/i);
  assert.match(demonstrated(rec("independent", 0, false, buildScenario(7))), /independently on a fresh variant/);
  assert.doesNotMatch(demonstrated(rec("independent", 1, false, buildScenario(7))), /independently/);
  assert.doesNotMatch(demonstrated(rec("independent", 0, false)), /independently/, "the base mission is not a fresh variant");
  assert.match(toMarkdown(guided), /not an accredited certificate/);
});

test("Excel bridge SQL examples run on the sandbox data", () => {
  for (const b of BRIDGE) assert.ok(run(base, b.sql).columns.length > 0, b.id);
  const lookup = run(base, BRIDGE.find((b) => b.id === "lookup").sql);
  assert.ok(lookup.values.some((r) => r[2] === null), "the exact join leaves the lower-case key unmatched, as the notes say");
});

test("Arabic: generated feedback and labels switch language; English stays the default", async () => {
  const { setLang } = await import("../public/tools/shared/i18n.js");
  try {
    setLang("ar");
    const g = gradeSql("delayed", `SELECT shipment_id FROM shipments WHERE status = 'held_at_port'`);
    assert.ok(g.messages.length && g.messages.every((m) => /[؀-ۿ]/.test(m.text)), JSON.stringify(g.messages));
    const prep = prepare(base);
    assert.match(violations(prep, { ...EMPTY_PLAN, backup: "eu", coverWeeks: 4 })[0].text, /[؀-ۿ]/);
  } finally { setLang("en"); }
  assert.match(gradeSql("delayed", `SELECT shipment_id FROM shipments WHERE status = 'held_at_port'`).messages[0].text, /[a-z]/);
});

test("CV bullets only claim the data-quality skills whose checks passed", () => {
  const sub = { checks: { delayed: { pass: true, messages: [] }, exposure: { pass: false, messages: [] }, freight: { pass: false, messages: [] } } };
  const ev = evaluate(base, { ...goodSubmission(base, "mix-1"), checks: Object.fromEntries(Object.entries(sub.checks).map(([k, v]) => [k, { ...v, messages: [] }])) });
  const rec = buildRecord({ scenario: base, mode: "assisted", hints: 1, revealed: false, queries: [], checks: sub.checks, plan: EMPTY_PLAN, assumptions: {}, evidence: [], defense: {}, evaluation: ev, startedAt: "x" });
  const text = cvBullets(rec).join(" ");
  assert.match(text, /blank arrival date/);
  assert.doesNotMatch(text, /mismatched join key|duplicated invoices/);
});
