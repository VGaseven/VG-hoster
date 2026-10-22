// WhatIf · Everyday Economics. Code-optional calculators over the tested models in lib/finance.js.
// Synthetic demo data for a fictional country. No verdicts: cash flows, ranges, constraints and the user's priorities.
import { DEMO, carOwnership, carLoanVsCash, monthlyPayment, rentVsBuy, rentVsBuyRange } from "./lib/finance.js";
import { createStore, download } from "../shared/store.js";

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
const CUR = "VAL";
const money = (v) => (v < 0 ? "−" : "") + Math.round(Math.abs(v)).toLocaleString("en-GB") + " " + CUR;
const pct = (v, d = 1) => (v * 100).toFixed(d) + "%";
const months = (m) => (m >= 12 && m % 12 === 0 ? `${m / 12} years` : `${m} months`);
const say = (t) => { $("live").textContent = ""; requestAnimationFrame(() => ($("live").textContent = t)); };
const store = createStore("everyday");

// ---------- inputs: every assumption is visible and editable ----------
const FIELDS = {
  car: [
    ["startingFunds", "Savings available today", "money", "The same starting money is used for both options."],
    ["price", "Car price", "money"],
    ["fees", "Registration and dealer fees", "money"],
    ["downPayment", "Down payment if you take the loan", "money"],
    ["annualRate", "Loan interest rate (per year)", "pct"],
    ["termMonths", "Loan term", "months"],
    ["monthlyRunning", "Running costs per month (insurance, fuel, maintenance)", "money"],
    ["holdMonths", "How long you keep the car", "months"],
    ["salePrice", "Expected sale price when you sell", "money", "An assumption: second-hand prices vary."],
    ["investReturnYear", "Return on money you keep invested (per year)", "pct", "What your savings could earn if not spent on the car."],
  ],
  home: [
    ["startingFunds", "Savings available today", "money", "The same starting money is used for renting and buying."],
    ["monthlyIncome", "Household income per month (after tax)", "money", "Used only for the affordability check."],
    ["homePrice", "Home price", "money"],
    ["downPaymentPct", "Down payment", "pct"],
    ["purchaseCostsPct", "Purchase costs (taxes, legal, fees)", "pct", "Paid up front, on top of the down payment."],
    ["mortgageRate", "Mortgage interest rate (per year)", "pct"],
    ["mortgageMonths", "Mortgage term", "months"],
    ["ownerCostsPctYear", "Owner costs per year (maintenance, property charges)", "pct", "As a share of the home's value."],
    ["insuranceMonthly", "Home insurance per month", "money"],
    ["sellingCostsPct", "Selling costs if you sell at the end", "pct"],
    ["homeGrowthYear", "Home price growth (per year)", "pct"],
    ["monthlyRent", "Rent per month today", "money"],
    ["rentGrowthYear", "Rent growth (per year)", "pct"],
    ["investReturnYear", "Return on money you keep invested (per year)", "pct"],
    ["months", "Time horizon", "months"],
  ],
};
const PRIORITIES = ["Flexibility to move", "Stability and control over my home", "Keeping cash available", "Building ownership", "Lower monthly cost", "Less maintenance responsibility"];

const saved = store.get("everyday-inputs", null);
const S = {
  tab: store.get("everyday-tab", "car"),
  car: { ...DEMO.car, ...(saved?.car || {}) },
  home: { ...DEMO.housing, ...(saved?.home || {}) },
  priorities: saved?.priorities || [],
  note: saved?.note || "",
  includeAmounts: false, // share cards exclude amounts by default
};
const save = () => { store.set("everyday-inputs", { car: S.car, home: S.home, priorities: S.priorities, note: S.note }); store.set("everyday-tab", S.tab); };

function demoLabel() {
  $("demoLabel").replaceChildren(
    h("strong", { text: `${DEMO.label}. ` }), "These are fictional example numbers you can change. This is a learning tool, not financial advice.",
    h("dl", {}, [["Country", DEMO.country], ["Currency", DEMO.currency], ["Units", DEMO.units], ["Period", DEMO.period], ["Source", DEMO.source]].flatMap(([k, v]) => [h("dt", { text: k }), h("dd", { text: v })])));
}

function fieldEl(group, [key, label, kind, help]) {
  const v = S[group][key], id = `${group}-${key}`;
  const shown = kind === "pct" ? +(v * 100).toFixed(3) : v;
  return h("div", {},
    h("label", { for: id, text: `${label}${kind === "pct" ? " (%)" : kind === "months" ? " (months)" : ` (${CUR})`}` }),
    h("input", { id, type: "number", inputmode: "decimal", step: kind === "pct" ? "0.1" : kind === "months" ? "1" : "100", min: "0", value: String(shown), "aria-describedby": help ? id + "-help" : null,
      oninput: (e) => {
        const n = Number(e.target.value);
        const ok = e.target.value !== "" && Number.isFinite(n) && n >= 0 && (kind !== "months" || (Number.isInteger(n) && n >= 1 && n <= 600));
        e.target.classList.toggle("invalid", !ok);
        e.target.setAttribute("aria-invalid", String(!ok));
        if (!ok) return;
        S[group][key] = kind === "pct" ? n / 100 : n;
        save(); renderResults(); renderShare();
      } }),
    help ? h("p", { class: "field-help", id: id + "-help", text: help }) : null);
}

function renderTabs() {
  const tabs = [["car", "Car: loan or cash"], ["home", "Home: rent or buy"]];
  $("tabs").replaceChildren(...tabs.map(([id, label]) => h("li", {}, h("button", { type: "button", class: "step-btn", "aria-current": S.tab === id ? "page" : null, onclick: () => { S.tab = id; save(); render(true); renderShare(); } }, label))));
}

function render(focus) {
  renderTabs();
  const g = S.tab;
  $("stage").replaceChildren(
    h("div", { class: "cols wide" },
      h("section", { class: "card" }, h("h2", { id: "h-inputs", tabindex: "-1", text: g === "car" ? "Your assumptions: car" : "Your assumptions: home" }),
        h("p", { class: "muted", text: "Every number below is an assumption. Change any of them; results update immediately." }),
        h("div", { class: "form-grid" }, FIELDS[g].map((f) => fieldEl(g, f))),
        h("div", { class: "row" }, h("button", { type: "button", class: "ghost", onclick: () => { S[g] = { ...(g === "car" ? DEMO.car : DEMO.housing) }; save(); render(); renderShare(); say("Example values restored."); } }, "Restore the example values"))),
      h("section", { class: "card", id: "results", "aria-live": "polite" })),
    priorityCard(), shareCard());
  renderResults();
  if (focus) $("h-inputs").focus();
}

function figure(label, value, note) { return h("div", { class: "figure" }, h("span", { class: "label", text: label }), h("span", { class: "value", text: value }), note ? h("span", { class: "note", text: note }) : null); }
function table(cols, rows) {
  return h("div", { class: "table-wrap", tabindex: "0", role: "region", "aria-label": "Table" }, h("table", {}, h("thead", {}, h("tr", {}, cols.map((c) => h("th", { scope: "col", text: c })))), h("tbody", {}, rows.map((r) => h("tr", {}, r.map((v) => h("td", { text: String(v) })))))));
}

function renderResults() {
  const box = $("results"); if (!box) return;
  if (S.tab === "car") return renderCar(box);
  return renderHome(box);
}

function renderCar(box) {
  const p = S.car;
  if (p.downPayment > p.price) return box.replaceChildren(h("h2", { text: "Results" }), h("p", { class: "callout warn", text: "The down payment cannot be larger than the price." }));
  const cmp = carLoanVsCash(p);
  const loan = carOwnership(p), cash = carOwnership({ ...p, downPayment: p.price });
  const pay = monthlyPayment(p.price - p.downPayment, p.annualRate, p.termMonths);
  const range = [0, 0.03, 0.05, 0.08].map((r) => { const c = carLoanVsCash({ ...p, investReturnYear: r }); return c.feasible ? [pct(r, 0), money(c.loanWealth), money(c.cashWealth), describeDiff(c.difference, "the loan", "paying cash")] : [pct(r, 0), "-", "-", "Not enough savings to pay cash"]; });
  box.replaceChildren(h("h2", { text: "Results (synthetic demo data)" }),
    h("div", { class: "figures" },
      figure("Monthly loan repayment", money(pay), "Principal plus interest"),
      figure("Interest paid while you own it", money(loan.breakdown.interestPaid)),
      figure("Loan still owed when you sell", money(loan.remainingDebt), "Repaid from the sale price"),
      figure("Net cost with the loan", money(loan.netCost), `over ${months(p.holdMonths)}`),
      figure("Net cost paying cash", money(cash.netCost), `over ${months(p.holdMonths)}`)),
    cmp.feasible
      ? h("div", { class: "callout no-verdict" }, h("strong", { text: "From the same savings: " }), `after ${months(p.holdMonths)}, the loan route ends with ${money(cmp.loanWealth)} and the cash route with ${money(cmp.cashWealth)} (cash in investments plus the car's sale, minus any debt). ${describeDiff(cmp.difference, "The loan route", "The cash route")}. This depends on the assumptions, especially the interest rate and the return on kept savings.`)
      : h("p", { class: "callout warn", text: cmp.reason + " The net costs above still apply." }),
    h("h3", { text: "How the return on kept savings changes it" }),
    table(["Return on savings", "Loan route ends with", "Cash route ends with", "Difference"], range),
    h("details", {}, h("summary", { text: "Show how it is calculated" }),
      h("ul", {},
        h("li", { text: "Month 0: you pay the down payment and fees. The loan pays the seller, so the full price is not charged again." }),
        h("li", { text: "Each month: the loan repayment (principal + interest) and running costs." }),
        h("li", { text: "At the end: you receive the sale price minus the loan still owed." }),
        h("li", { text: `Net cost = price + fees + interest + running costs − sale price = ${money(loan.identity)} (matches ${money(loan.netCost)}).` }),
        h("li", { text: "From the same savings: the cash route invests what it does not spend, and each month invests what the loan route repays, so both spend the same each month." })),
      table(["Month", "Cash flow (loan route)", "What it is"], loan.flows.filter((f, i, all) => i < 4 || i >= all.length - 2).map((f) => [f.month, money(f.amount), f.label]))));
}

function describeDiff(d, a, b) {
  if (Math.abs(d) < 1) return "Both end the same";
  return d > 0 ? `${a} ends ${money(d)} ahead` : `${b} ends ${money(-d)} ahead`;
}

function renderHome(box) {
  const p = S.home, r = rentVsBuy(p);
  if (!r.feasible) return box.replaceChildren(h("h2", { text: "Results" }), h("p", { class: "callout warn", text: r.reason + " Change the savings, price or down payment to compare." }));
  const range = rentVsBuyRange(p);
  const m1 = r.timeline[0];
  const ahead = range.cases.filter((c) => c.difference > 0).length;
  const yearly = r.timeline.filter((t) => t.month % 12 === 0 || t.month === r.timeline.length);
  box.replaceChildren(h("h2", { text: "Results (synthetic demo data)" }),
    h("div", { class: "figures" },
      figure("Paid up front to buy", money(r.upFront.downPayment + r.upFront.purchaseCosts), `Down payment ${money(r.upFront.downPayment)} + costs ${money(r.upFront.purchaseCosts)}`),
      figure("Owning, month 1", money(m1.buyerCost), "Mortgage + owner costs + insurance"),
      figure("Renting, month 1", money(m1.renterCost)),
      figure(`Buying route after ${months(p.months)}`, money(r.end.buyerWealth), "Home after selling costs − mortgage + investments"),
      figure(`Renting route after ${months(p.months)}`, money(r.end.renterWealth), "Investments"),
      figure("Break-even", r.breakEvenMonth ? `Month ${r.breakEvenMonth}` : "Not within the horizon", r.breakEvenMonth ? "First month buying is at least level" : `Buying does not catch up within ${months(p.months)} with these assumptions`)),
    r.affordability ? h("p", { class: "callout" + (r.affordability.withinLimit ? "" : " warn") }, h("strong", { text: "Affordability check: " }), `owning would take up to ${pct(r.affordability.peakHousingShare)} of income per month; a common rule of thumb limit is ${pct(r.affordability.limit, 0)}. ${r.affordability.withinLimit ? "Within that limit." : "Above that limit: a constraint to take seriously, whatever the long-run numbers say."}`) : null,
    h("div", { class: "callout no-verdict" }, h("strong", { text: "No right answer: " }), `with these assumptions ${describeDiff(r.end.difference, "buying", "renting")}. Across 9 combinations of home growth and investment return, buying ends ahead in ${ahead} and renting in ${9 - ahead}, from ${money(range.minDifference)} to ${money(range.maxDifference)} for buying vs renting. Flexibility, stability and what you value are not in these numbers.`),
    h("h3", { text: "Range: home growth × return on savings" }),
    table(["Home growth / year", "Return on savings / year", "Buying vs renting at the end", "Break-even"], range.cases.map((c) => [pct(c.homeGrowthYear), pct(c.investReturnYear), money(c.difference), c.breakEvenMonth ? `Month ${c.breakEvenMonth}` : "None"])),
    h("details", {}, h("summary", { text: "Show how it is calculated" }),
      h("ul", {},
        h("li", { text: "Both routes start with the same savings. Buying pays the down payment and purchase costs and invests the rest; renting invests all of it." }),
        h("li", { text: "Each month both routes have the same budget: whichever housing cost is higher. The cheaper route invests the difference, so neither gets free money." }),
        h("li", { text: "Owning costs = mortgage payment (principal + interest) + owner costs (a yearly share of the home's value) + insurance. Rent grows by the rent growth rate." }),
        h("li", { text: "At any month, the buying route's wealth = home value minus selling costs, minus the mortgage still owed, plus investments." }),
        h("li", { text: "Annual rates are converted to equivalent monthly rates." })),
      table(["Month", "Owning cost", "Rent", "Buying route", "Renting route", "Mortgage owed"], yearly.map((t) => [t.month, money(t.buyerCost), money(t.renterCost), money(t.buyerWealth), money(t.renterWealth), money(t.debt)]))));
}

function priorityCard() {
  return h("section", { class: "card" }, h("h2", { text: "What matters to you" }),
    h("p", { class: "muted", text: "The numbers leave things out. Tick what matters for your decision. This is for your own reflection and is never scored." }),
    h("fieldset", {}, h("legend", { text: "Priorities" }), PRIORITIES.map((pr) => h("label", { class: "block" }, h("input", { type: "checkbox", checked: S.priorities.includes(pr), onchange: (e) => { S.priorities = e.target.checked ? [...S.priorities, pr] : S.priorities.filter((x) => x !== pr); save(); renderShare(); } }), " ", pr))),
    h("label", { for: "note", text: "Your own note (optional, stays private)" }),
    h("textarea", { id: "note", rows: "2", value: S.note, oninput: (e) => { S.note = e.target.value; save(); renderShare(); } }));
}

function shareText() {
  const lines = [`WhatIf · Everyday money (${DEMO.label}, ${DEMO.country})`];
  if (S.tab === "car") {
    const c = carLoanVsCash(S.car), p = S.car;
    lines.push(`Question: take a car loan or pay cash, keeping the car ${months(p.holdMonths)}.`);
    if (c.feasible) lines.push(S.includeAmounts ? `With my assumptions: ${describeDiff(c.difference, "the loan route", "the cash route")}. Interest paid: ${money(c.loan.breakdown.interestPaid)}.` : `With my assumptions, ${c.difference > 0 ? "the loan route" : "the cash route"} came out ahead; the result depends mainly on the interest rate and the return on savings.`);
  } else {
    const r = rentVsBuy(S.home), p = S.home;
    lines.push(`Question: rent or buy over ${months(p.months)}.`);
    if (r.feasible) {
      const range = rentVsBuyRange(p), ahead = range.cases.filter((x) => x.difference > 0).length;
      lines.push(S.includeAmounts ? `With my assumptions: ${describeDiff(r.end.difference, "buying", "renting")}; range ${money(range.minDifference)} to ${money(range.maxDifference)}.` : `Buying came out ahead in ${ahead} of 9 assumption sets.`);
      lines.push(r.breakEvenMonth ? `Break-even: month ${r.breakEvenMonth}.` : "No break-even within the horizon.");
    } else lines.push("Buying was not possible with the savings entered.");
  }
  if (S.priorities.length) lines.push(`What matters to me: ${S.priorities.join(", ")}.`);
  lines.push("Fictional example numbers. Not financial advice.");
  return lines.join("\n");
}
function shareCard() {
  return h("section", { class: "card share" }, h("h2", { text: "Share card (optional)" }),
    h("p", { class: "muted", text: "Nothing is shared unless you download this card yourself. Money amounts are left out unless you include them. Your private note is never included." }),
    h("label", { class: "inline" }, h("input", { type: "checkbox", id: "includeAmounts", checked: S.includeAmounts, onchange: (e) => { S.includeAmounts = e.target.checked; renderShare(); } }), " Include money amounts"),
    h("h3", { text: "Preview" }), h("pre", { id: "sharePreview" }),
    h("button", { type: "button", onclick: () => { download("whatif-everyday-card.txt", shareText()); say("Share card downloaded."); } }, "Download share card"));
}
function renderShare() { const el = $("sharePreview"); if (el) el.textContent = shareText(); }

await store.load();
// Re-read after the Hub bridge (embedded mode) delivered saved inputs.
const again = store.get("everyday-inputs", null);
if (again) { Object.assign(S.car, again.car || {}); Object.assign(S.home, again.home || {}); S.priorities = again.priorities || []; S.note = again.note || ""; S.tab = store.get("everyday-tab", S.tab); }
demoLabel();
render(false);
renderShare();
