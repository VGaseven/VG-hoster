// WhatIf · Everyday Economics. Code-optional calculators over the tested models in lib/finance.js.
// Synthetic demo data for a fictional country. No verdicts: cash flows, ranges, constraints and the user's priorities.
import { DEMO, carOwnership, carLoanVsCash, monthlyPayment, rentVsBuy, rentVsBuyRange } from "./lib/finance.js";
import { createStore, download } from "../shared/store.js";
import { L, lang, applyLang, switchLang } from "../shared/i18n.js";

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
const CUR = L("VAL", "فال");
// The currency is a word ("VAL" / "فال"), so normal text direction already reads correctly in both languages.
const money = (v) => (v < 0 ? "−" : "") + Math.round(Math.abs(v)).toLocaleString("en-GB") + " " + CUR;
const pct = (v, d = 1) => (v * 100).toFixed(d) + "%";
const months = (m) => (m >= 12 && m % 12 === 0 ? L(`${m / 12} years`, `${m / 12} سنوات`) : L(`${m} months`, `${m} شهرًا`));
const say = (t) => { $("live").textContent = ""; requestAnimationFrame(() => ($("live").textContent = t)); };
const store = createStore("everyday");

// ---------- inputs: every assumption is visible and editable ----------
const FIELDS = {
  car: [
    ["startingFunds", L("Savings available today", "المدخرات المتاحة اليوم"), "money", L("The same starting money is used for both options.", "تُستخدم المدخرات نفسها في الخيارين.")],
    ["price", L("Car price", "سعر السيارة"), "money"],
    ["fees", L("Registration and dealer fees", "رسوم التسجيل والوكيل"), "money"],
    ["downPayment", L("Down payment if you take the loan", "الدفعة الأولى إذا أخذت القرض"), "money"],
    ["annualRate", L("Loan interest rate (per year)", "سعر فائدة القرض (سنويًا)"), "pct"],
    ["termMonths", L("Loan term", "مدة القرض"), "months"],
    ["monthlyRunning", L("Running costs per month (insurance, fuel, maintenance)", "تكاليف التشغيل الشهرية (تأمين، وقود، صيانة)"), "money"],
    ["holdMonths", L("How long you keep the car", "مدة احتفاظك بالسيارة"), "months"],
    ["salePrice", L("Expected sale price when you sell", "سعر البيع المتوقع عند البيع"), "money", L("An assumption: second-hand prices vary.", "افتراض: أسعار المستعمل تتفاوت.")],
    ["investReturnYear", L("Return on money you keep invested (per year)", "العائد على المال المستثمر (سنويًا)"), "pct", L("What your savings could earn if not spent on the car.", "ما يمكن أن تكسبه مدخراتك إن لم تُنفق على السيارة.")],
  ],
  home: [
    ["startingFunds", L("Savings available today", "المدخرات المتاحة اليوم"), "money", L("The same starting money is used for renting and buying.", "تُستخدم المدخرات نفسها للإيجار وللشراء.")],
    ["monthlyIncome", L("Household income per month (after tax)", "دخل الأسرة الشهري (بعد الضريبة)"), "money", L("Used only for the affordability check.", "يُستخدم فقط لفحص القدرة على التحمّل.")],
    ["homePrice", L("Home price", "سعر المنزل"), "money"],
    ["downPaymentPct", L("Down payment", "الدفعة الأولى"), "pct"],
    ["purchaseCostsPct", L("Purchase costs (taxes, legal, fees)", "تكاليف الشراء (ضرائب، رسوم قانونية، رسوم أخرى)"), "pct", L("Paid up front, on top of the down payment.", "تُدفع مقدمًا، فوق الدفعة الأولى.")],
    ["mortgageRate", L("Mortgage interest rate (per year)", "سعر فائدة التمويل العقاري (سنويًا)"), "pct"],
    ["mortgageMonths", L("Mortgage term", "مدة التمويل العقاري"), "months"],
    ["ownerCostsPctYear", L("Owner costs per year (maintenance, property charges)", "تكاليف الملكية السنوية (صيانة، رسوم العقار)"), "pct", L("As a share of the home's value.", "كنسبة من قيمة المنزل.")],
    ["insuranceMonthly", L("Home insurance per month", "تأمين المنزل الشهري"), "money"],
    ["sellingCostsPct", L("Selling costs if you sell at the end", "تكاليف البيع إن بعت في النهاية"), "pct"],
    ["homeGrowthYear", L("Home price growth (per year)", "نمو سعر المنزل (سنويًا)"), "pct"],
    ["monthlyRent", L("Rent per month today", "الإيجار الشهري اليوم"), "money"],
    ["rentGrowthYear", L("Rent growth (per year)", "نمو الإيجار (سنويًا)"), "pct"],
    ["investReturnYear", L("Return on money you keep invested (per year)", "العائد على المال المستثمر (سنويًا)"), "pct"],
    ["months", L("Time horizon", "الأفق الزمني"), "months"],
  ],
};
// Stable ids are stored; labels follow the page language.
const PRIORITIES = [["flexibility", L("Flexibility to move", "مرونة الانتقال")], ["stability", L("Stability and control over my home", "الاستقرار والتحكم في منزلي")], ["cash", L("Keeping cash available", "إبقاء النقد متاحًا")], ["ownership", L("Building ownership", "بناء الملكية")], ["monthly", L("Lower monthly cost", "تكلفة شهرية أقل")], ["maintenance", L("Less maintenance responsibility", "مسؤولية صيانة أقل")]];
const priorityLabels = () => PRIORITIES.filter(([id]) => S.priorities.includes(id)).map(([, label]) => label);

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
    h("strong", { text: L(`${DEMO.label}. `, "بيانات تجريبية اصطناعية. ") }), L("These are fictional example numbers you can change. This is a learning tool, not financial advice.", "هذه أرقام مثال خيالية يمكنك تغييرها. هذه أداة تعلّم، وليست نصيحة مالية."),
    h("dl", {}, [[L("Country", "الدولة"), L(DEMO.country, "خيالية (فالوريا)")], [L("Currency", "العملة"), L(DEMO.currency, "فال (وحدة عملة خيالية)")], [L("Units", "الوحدات"), L(DEMO.units, "المبالغ بالفال؛ الزمن بالأشهر؛ المعدلات سنوية وتُحوَّل إلى شهرية")], [L("Period", "الفترة"), L(DEMO.period, "قيم توضيحية لعام 2026، وليست أسعارًا مرصودة")], [L("Source", "المصدر"), L(DEMO.source, "مُختلقة للتعليم. ليست تاريخية ولا بيانات إنتاج ولا عينة من أي سوق حقيقي.")]].flatMap(([k, v]) => [h("dt", { text: k }), h("dd", { text: v })])));
}

function fieldEl(group, [key, label, kind, help]) {
  const v = S[group][key], id = `${group}-${key}`;
  const shown = kind === "pct" ? +(v * 100).toFixed(3) : v;
  return h("div", {},
    h("label", { for: id, text: `${label}${kind === "pct" ? " (%)" : kind === "months" ? L(" (months)", " (أشهر)") : ` (${CUR})`}` }),
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
  const tabs = [["car", L("Car: loan or cash", "السيارة: قرض أم نقدًا")], ["home", L("Home: rent or buy", "المنزل: إيجار أم شراء")]];
  $("tabs").replaceChildren(...tabs.map(([id, label]) => h("li", {}, h("button", { type: "button", class: "step-btn", "aria-current": S.tab === id ? "page" : null, onclick: () => { S.tab = id; save(); render(true); renderShare(); } }, label))));
}

function render(focus) {
  renderTabs();
  const g = S.tab;
  $("stage").replaceChildren(
    h("div", { class: "cols wide" },
      h("section", { class: "card" }, h("h2", { id: "h-inputs", tabindex: "-1", text: g === "car" ? L("Your assumptions: car", "افتراضاتك: السيارة") : L("Your assumptions: home", "افتراضاتك: المنزل") }),
        h("p", { class: "muted", text: L("Every number below is an assumption. Change any of them; results update immediately.", "كل رقم أدناه افتراض. غيّر أيًا منها؛ تتحدث النتائج فورًا.") }),
        h("div", { class: "form-grid" }, FIELDS[g].map((f) => fieldEl(g, f))),
        h("div", { class: "row" }, h("button", { type: "button", class: "ghost", onclick: () => { S[g] = { ...(g === "car" ? DEMO.car : DEMO.housing) }; save(); render(); renderShare(); say(L("Example values restored.", "استُعيدت قيم المثال.")); } }, L("Restore the example values", "استعد قيم المثال")))),
      h("section", { class: "card", id: "results", "aria-live": "polite" })),
    priorityCard(), shareCard());
  renderResults();
  if (focus) $("h-inputs").focus();
}

function figure(label, value, note) { return h("div", { class: "figure" }, h("span", { class: "label", text: label }), h("span", { class: "value", text: value }), note ? h("span", { class: "note", text: note }) : null); }
function table(cols, rows) {
  return h("div", { class: "table-wrap", tabindex: "0", role: "region", "aria-label": L("Table", "جدول") }, h("table", {}, h("thead", {}, h("tr", {}, cols.map((c) => h("th", { scope: "col", text: c })))), h("tbody", {}, rows.map((r) => h("tr", {}, r.map((v) => h("td", { text: String(v) })))))));
}

function renderResults() {
  const box = $("results"); if (!box) return;
  if (S.tab === "car") return renderCar(box);
  return renderHome(box);
}

function renderCar(box) {
  const p = S.car;
  if (p.downPayment > p.price) return box.replaceChildren(h("h2", { text: L("Results", "النتائج") }), h("p", { class: "callout warn", text: L("The down payment cannot be larger than the price.", "لا يمكن أن تتجاوز الدفعة الأولى السعر.") }));
  const cmp = carLoanVsCash(p);
  const loan = carOwnership(p), cash = carOwnership({ ...p, downPayment: p.price });
  const pay = monthlyPayment(p.price - p.downPayment, p.annualRate, p.termMonths);
  const range = [0, 0.03, 0.05, 0.08].map((r) => { const c = carLoanVsCash({ ...p, investReturnYear: r }); return c.feasible ? [pct(r, 0), money(c.loanWealth), money(c.cashWealth), describeDiff(c.difference, L("the loan", "القرض"), L("paying cash", "الدفع نقدًا"))] : [pct(r, 0), "-", "-", L("Not enough savings to pay cash", "المدخرات لا تكفي للدفع نقدًا")]; });
  const RESULTS = L("Results (synthetic demo data)", "النتائج (بيانات تجريبية اصطناعية)");
  box.replaceChildren(h("h2", { text: RESULTS }),
    h("div", { class: "figures" },
      figure(L("Monthly loan repayment", "القسط الشهري للقرض"), money(pay), L("Principal plus interest", "أصل القرض مع الفائدة")),
      figure(L("Interest paid while you own it", "الفائدة المدفوعة خلال الملكية"), money(loan.breakdown.interestPaid)),
      figure(L("Loan still owed when you sell", "المتبقي من القرض عند البيع"), money(loan.remainingDebt), L("Repaid from the sale price", "يُسدَّد من سعر البيع")),
      figure(L("Net cost with the loan", "صافي التكلفة مع القرض"), money(loan.netCost), L(`over ${months(p.holdMonths)}`, `خلال ${months(p.holdMonths)}`)),
      figure(L("Net cost paying cash", "صافي التكلفة بالدفع نقدًا"), money(cash.netCost), L(`over ${months(p.holdMonths)}`, `خلال ${months(p.holdMonths)}`))),
    cmp.feasible
      ? h("div", { class: "callout no-verdict" }, h("strong", { text: L("From the same savings: ", "من المدخرات نفسها: ") }), L(`after ${months(p.holdMonths)}, the loan route ends with ${money(cmp.loanWealth)} and the cash route with ${money(cmp.cashWealth)} (cash in investments plus the car's sale, minus any debt). ${describeDiff(cmp.difference, "The loan route", "The cash route")}. This depends on the assumptions, especially the interest rate and the return on kept savings.`, `بعد ${months(p.holdMonths)}، ينتهي مسار القرض بـ ${money(cmp.loanWealth)} ومسار النقد بـ ${money(cmp.cashWealth)} (المال المستثمر مع ثمن بيع السيارة، ناقص أي دين). ${describeDiff(cmp.difference, "مسار القرض", "مسار النقد")}. يعتمد ذلك على الافتراضات، خاصة سعر الفائدة والعائد على المدخرات.`))
      : h("p", { class: "callout warn", text: L(cmp.reason + " The net costs above still apply.", "المدخرات لا تكفي للدفع نقدًا. صافي التكاليف أعلاه ما زال صحيحًا.") }),
    h("h3", { text: L("How the return on kept savings changes it", "كيف يغيّر العائد على المدخرات النتيجة") }),
    table([L("Return on savings", "العائد على المدخرات"), L("Loan route ends with", "ينتهي مسار القرض بـ"), L("Cash route ends with", "ينتهي مسار النقد بـ"), L("Difference", "الفرق")], range),
    h("details", {}, h("summary", { text: L("Show how it is calculated", "اعرض طريقة الحساب") }),
      h("ul", {},
        h("li", { text: L("Month 0: you pay the down payment and fees. The loan pays the seller, so the full price is not charged again.", "الشهر 0: تدفع الدفعة الأولى والرسوم. القرض يدفع للبائع، فلا يُحتسب السعر الكامل مرة ثانية.") }),
        h("li", { text: L("Each month: the loan repayment (principal + interest) and running costs.", "كل شهر: قسط القرض (أصل + فائدة) وتكاليف التشغيل.") }),
        h("li", { text: L("At the end: you receive the sale price minus the loan still owed.", "في النهاية: تحصل على سعر البيع ناقص ما تبقى من القرض.") }),
        h("li", { text: L(`Net cost = price + fees + interest + running costs − sale price = ${money(loan.identity)} (matches ${money(loan.netCost)}).`, `صافي التكلفة = السعر + الرسوم + الفائدة + تكاليف التشغيل − سعر البيع = ${money(loan.identity)} (يطابق ${money(loan.netCost)}).`) }),
        h("li", { text: L("From the same savings: the cash route invests what it does not spend, and each month invests what the loan route repays, so both spend the same each month.", "من المدخرات نفسها: يستثمر مسار النقد ما لا ينفقه، ويستثمر كل شهر ما يسدده مسار القرض، فيُنفق المساران المبلغ نفسه شهريًا.") })),
      table([L("Month", "الشهر"), L("Cash flow (loan route)", "التدفق النقدي (مسار القرض)"), L("What it is", "ما هو")], loan.flows.filter((f, i, all) => i < 4 || i >= all.length - 2).map((f) => [f.month, money(f.amount), FLOW_LABELS[f.label] || f.label]))));
}

const FLOW_LABELS = { "Down payment and fees": L("Down payment and fees", "الدفعة الأولى والرسوم"), "Loan repayment + running costs": L("Loan repayment + running costs", "قسط القرض + تكاليف التشغيل"), "Sale price minus remaining loan": L("Sale price minus remaining loan", "سعر البيع ناقص المتبقي من القرض") };
function describeDiff(d, a, b) {
  if (Math.abs(d) < 1) return L("Both end the same", "ينتهي الخياران بالمبلغ نفسه");
  return d > 0 ? L(`${a} ends ${money(d)} ahead`, `${a} يتقدّم بـ ${money(d)}`) : L(`${b} ends ${money(-d)} ahead`, `${b} يتقدّم بـ ${money(-d)}`);
}

function renderHome(box) {
  const p = S.home, r = rentVsBuy(p);
  if (!r.feasible) return box.replaceChildren(h("h2", { text: L("Results", "النتائج") }), h("p", { class: "callout warn", text: L(r.reason + " Change the savings, price or down payment to compare.", `الشراء يحتاج ${money(p.homePrice * (p.downPaymentPct + p.purchaseCostsPct))} مقدمًا؛ والمدخرات ${money(p.startingFunds)}. غيّر المدخرات أو السعر أو الدفعة الأولى للمقارنة.`) }));
  const range = rentVsBuyRange(p);
  const m1 = r.timeline[0];
  const ahead = range.cases.filter((c) => c.difference > 0).length;
  const yearly = r.timeline.filter((t) => t.month % 12 === 0 || t.month === r.timeline.length);
  const month = (m) => L(`Month ${m}`, `الشهر ${m}`);
  box.replaceChildren(h("h2", { text: L("Results (synthetic demo data)", "النتائج (بيانات تجريبية اصطناعية)") }),
    h("div", { class: "figures" },
      figure(L("Paid up front to buy", "المدفوع مقدمًا للشراء"), money(r.upFront.downPayment + r.upFront.purchaseCosts), L(`Down payment ${money(r.upFront.downPayment)} + costs ${money(r.upFront.purchaseCosts)}`, `الدفعة الأولى ${money(r.upFront.downPayment)} + التكاليف ${money(r.upFront.purchaseCosts)}`)),
      figure(L("Owning, month 1", "التملّك، الشهر 1"), money(m1.buyerCost), L("Mortgage + owner costs + insurance", "قسط التمويل + تكاليف الملكية + التأمين")),
      figure(L("Renting, month 1", "الإيجار، الشهر 1"), money(m1.renterCost)),
      figure(L(`Buying route after ${months(p.months)}`, `مسار الشراء بعد ${months(p.months)}`), money(r.end.buyerWealth), L("Home after selling costs − mortgage + investments", "المنزل بعد تكاليف البيع − التمويل + الاستثمارات")),
      figure(L(`Renting route after ${months(p.months)}`, `مسار الإيجار بعد ${months(p.months)}`), money(r.end.renterWealth), L("Investments", "الاستثمارات")),
      figure(L("Break-even", "نقطة التعادل"), r.breakEvenMonth ? month(r.breakEvenMonth) : L("Not within the horizon", "ليست ضمن الأفق"), r.breakEvenMonth ? L("First month buying is at least level", "أول شهر يتساوى فيه الشراء على الأقل") : L(`Buying does not catch up within ${months(p.months)} with these assumptions`, `لا يلحق الشراء خلال ${months(p.months)} بهذه الافتراضات`))),
    r.affordability ? h("p", { class: "callout" + (r.affordability.withinLimit ? "" : " warn") }, h("strong", { text: L("Affordability check: ", "فحص القدرة على التحمّل: ") }), L(`owning would take up to ${pct(r.affordability.peakHousingShare)} of income per month; a common rule of thumb limit is ${pct(r.affordability.limit, 0)}. ${r.affordability.withinLimit ? "Within that limit." : "Above that limit: a constraint to take seriously, whatever the long-run numbers say."}`, `سيستهلك التملّك حتى ${pct(r.affordability.peakHousingShare)} من الدخل شهريًا؛ والحد الشائع كقاعدة تقريبية ${pct(r.affordability.limit, 0)}. ${r.affordability.withinLimit ? "ضمن هذا الحد." : "فوق هذا الحد: قيد يجب أخذه بجدية مهما قالت أرقام المدى الطويل."}`)) : null,
    h("div", { class: "callout no-verdict" }, h("strong", { text: L("No right answer: ", "لا توجد إجابة صحيحة: ") }), L(`with these assumptions ${describeDiff(r.end.difference, "buying", "renting")}. Across 9 combinations of home growth and investment return, buying ends ahead in ${ahead} and renting in ${9 - ahead}, from ${money(range.minDifference)} to ${money(range.maxDifference)} for buying vs renting. Flexibility, stability and what you value are not in these numbers.`, `بهذه الافتراضات ${describeDiff(r.end.difference, "الشراء", "الإيجار")}. عبر 9 تركيبات من نمو سعر المنزل وعائد الاستثمار، يتقدّم الشراء في ${ahead} والإيجار في ${9 - ahead}، من ${money(range.minDifference)} إلى ${money(range.maxDifference)} للشراء مقابل الإيجار. المرونة والاستقرار وما تقدّره ليست في هذه الأرقام.`)),
    h("h3", { text: L("Range: home growth × return on savings", "النطاق: نمو سعر المنزل × العائد على المدخرات") }),
    table([L("Home growth / year", "نمو المنزل / سنة"), L("Return on savings / year", "العائد على المدخرات / سنة"), L("Buying vs renting at the end", "الشراء مقابل الإيجار في النهاية"), L("Break-even", "نقطة التعادل")], range.cases.map((c) => [pct(c.homeGrowthYear), pct(c.investReturnYear), money(c.difference), c.breakEvenMonth ? month(c.breakEvenMonth) : L("None", "لا يوجد")])),
    h("details", {}, h("summary", { text: L("Show how it is calculated", "اعرض طريقة الحساب") }),
      h("ul", {},
        h("li", { text: L("Both routes start with the same savings. Buying pays the down payment and purchase costs and invests the rest; renting invests all of it.", "يبدأ المساران بالمدخرات نفسها. الشراء يدفع الدفعة الأولى وتكاليف الشراء ويستثمر الباقي؛ والإيجار يستثمر كل المدخرات.") }),
        h("li", { text: L("Each month both routes have the same budget: whichever housing cost is higher. The cheaper route invests the difference, so neither gets free money.", "كل شهر للمسارين الميزانية نفسها: تكلفة السكن الأعلى منهما. المسار الأرخص يستثمر الفرق، فلا يحصل أي منهما على مال مجاني.") }),
        h("li", { text: L("Owning costs = mortgage payment (principal + interest) + owner costs (a yearly share of the home's value) + insurance. Rent grows by the rent growth rate.", "تكاليف التملّك = قسط التمويل (أصل + فائدة) + تكاليف الملكية (نسبة سنوية من قيمة المنزل) + التأمين. ويزيد الإيجار بمعدل نمو الإيجار.") }),
        h("li", { text: L("At any month, the buying route's wealth = home value minus selling costs, minus the mortgage still owed, plus investments.", "في أي شهر، ثروة مسار الشراء = قيمة المنزل ناقص تكاليف البيع، ناقص المتبقي من التمويل، زائد الاستثمارات.") }),
        h("li", { text: L("Annual rates are converted to equivalent monthly rates.", "تُحوَّل المعدلات السنوية إلى معدلات شهرية مكافئة.") })),
      table([L("Month", "الشهر"), L("Owning cost", "تكلفة التملّك"), L("Rent", "الإيجار"), L("Buying route", "مسار الشراء"), L("Renting route", "مسار الإيجار"), L("Mortgage owed", "المتبقي من التمويل")], yearly.map((t) => [t.month, money(t.buyerCost), money(t.renterCost), money(t.buyerWealth), money(t.renterWealth), money(t.debt)]))));
}

function priorityCard() {
  return h("section", { class: "card" }, h("h2", { text: L("What matters to you", "ما يهمّك") }),
    h("p", { class: "muted", text: L("The numbers leave things out. Tick what matters for your decision. This is for your own reflection and is never scored.", "الأرقام لا تشمل كل شيء. حدّد ما يهمّ في قرارك. هذا لتأملك الشخصي ولا يُقيَّم أبدًا.") }),
    h("fieldset", {}, h("legend", { text: L("Priorities", "الأولويات") }), PRIORITIES.map(([id, label]) => h("label", { class: "block" }, h("input", { type: "checkbox", checked: S.priorities.includes(id), onchange: (e) => { S.priorities = e.target.checked ? [...S.priorities, id] : S.priorities.filter((x) => x !== id); save(); renderShare(); } }), " ", label))),
    h("label", { for: "note", text: L("Your own note (optional, stays private)", "ملاحظتك الخاصة (اختيارية، تبقى خاصة)") }),
    h("textarea", { id: "note", rows: "2", value: S.note, oninput: (e) => { S.note = e.target.value; save(); renderShare(); } }));
}

function shareText() {
  const lines = [L(`WhatIf · Everyday money (${DEMO.label}, ${DEMO.country})`, "ماذا لو · قرارات المال اليومية (بيانات تجريبية اصطناعية، دولة خيالية: فالوريا)")];
  if (S.tab === "car") {
    const c = carLoanVsCash(S.car), p = S.car;
    lines.push(L(`Question: take a car loan or pay cash, keeping the car ${months(p.holdMonths)}.`, `السؤال: قرض سيارة أم الدفع نقدًا، مع الاحتفاظ بالسيارة ${months(p.holdMonths)}.`));
    if (c.feasible) lines.push(S.includeAmounts ? L(`With my assumptions: ${describeDiff(c.difference, "the loan route", "the cash route")}. Interest paid: ${money(c.loan.breakdown.interestPaid)}.`, `بافتراضاتي: ${describeDiff(c.difference, "مسار القرض", "مسار النقد")}. الفائدة المدفوعة: ${money(c.loan.breakdown.interestPaid)}.`) : L(`With my assumptions, ${c.difference > 0 ? "the loan route" : "the cash route"} came out ahead; the result depends mainly on the interest rate and the return on savings.`, `بافتراضاتي، تقدّم ${c.difference > 0 ? "مسار القرض" : "مسار النقد"}؛ وتعتمد النتيجة أساسًا على سعر الفائدة والعائد على المدخرات.`));
  } else {
    const r = rentVsBuy(S.home), p = S.home;
    lines.push(L(`Question: rent or buy over ${months(p.months)}.`, `السؤال: إيجار أم شراء خلال ${months(p.months)}.`));
    if (r.feasible) {
      const range = rentVsBuyRange(p), ahead = range.cases.filter((x) => x.difference > 0).length;
      lines.push(S.includeAmounts ? L(`With my assumptions: ${describeDiff(r.end.difference, "buying", "renting")}; range ${money(range.minDifference)} to ${money(range.maxDifference)}.`, `بافتراضاتي: ${describeDiff(r.end.difference, "الشراء", "الإيجار")}؛ النطاق من ${money(range.minDifference)} إلى ${money(range.maxDifference)}.`) : L(`Buying came out ahead in ${ahead} of 9 assumption sets.`, `تقدّم الشراء في ${ahead} من 9 مجموعات افتراضات.`));
      lines.push(r.breakEvenMonth ? L(`Break-even: month ${r.breakEvenMonth}.`, `نقطة التعادل: الشهر ${r.breakEvenMonth}.`) : L("No break-even within the horizon.", "لا نقطة تعادل ضمن الأفق."));
    } else lines.push(L("Buying was not possible with the savings entered.", "لم يكن الشراء ممكنًا بالمدخرات المدخلة."));
  }
  if (S.priorities.length) lines.push(L(`What matters to me: ${priorityLabels().join(", ")}.`, `ما يهمّني: ${priorityLabels().join("، ")}.`));
  lines.push(L("Fictional example numbers. Not financial advice.", "أرقام مثال خيالية. ليست نصيحة مالية."));
  return lines.join("\n");
}
function shareCard() {
  return h("section", { class: "card share" }, h("h2", { text: L("Share card (optional)", "بطاقة المشاركة (اختيارية)") }),
    h("p", { class: "muted", text: L("Nothing is shared unless you download this card yourself. Money amounts are left out unless you include them. Your private note is never included.", "لا يُشارك شيء ما لم تنزّل هذه البطاقة بنفسك. تُستبعد المبالغ المالية ما لم تضمّنها. ملاحظتك الخاصة لا تُضمَّن أبدًا.") }),
    h("label", { class: "inline" }, h("input", { type: "checkbox", id: "includeAmounts", checked: S.includeAmounts, onchange: (e) => { S.includeAmounts = e.target.checked; renderShare(); } }), L(" Include money amounts", " ضمّن المبالغ المالية")),
    h("h3", { text: L("Preview", "معاينة") }), h("pre", { id: "sharePreview" }),
    h("button", { type: "button", onclick: () => { download("whatif-everyday-card.txt", shareText()); say(L("Share card downloaded.", "نُزّلت بطاقة المشاركة.")); } }, L("Download share card", "نزّل بطاقة المشاركة")));
}
function renderShare() { const el = $("sharePreview"); if (el) el.textContent = shareText(); }

/** Texts that live in index.html, plus the language switch. */
function translateStatic() {
  document.title = L("WhatIf · Everyday money · Shahed’s Hub", "ماذا لو · قرارات المال اليومية · مركز شهد");
  document.querySelector(".skip").textContent = L("Skip to the calculator", "انتقل إلى الحاسبة");
  document.querySelector(".bar .eyebrow").textContent = L("WhatIf · Everyday Economics", "ماذا لو · الاقتصاد اليومي");
  document.querySelector(".bar h1").textContent = L("Everyday money decisions", "قرارات المال اليومية");
  document.querySelector(".promise").textContent = L("See the full cash flows behind a choice, change any assumption, and decide what matters to you.", "شاهد التدفقات النقدية الكاملة وراء أي خيار، وغيّر أي افتراض، وقرّر ما يهمّك.");
  $("demoLabel").setAttribute("aria-label", L("About this data", "عن هذه البيانات"));
  document.querySelector(".steps").setAttribute("aria-label", L("Calculators", "الحاسبات"));
  document.querySelector(".bar").append(h("button", { type: "button", id: "langBtn", class: "ghost", lang: lang() === "ar" ? "en" : "ar", onclick: () => switchLang(store, "everyday-lang") }, lang() === "ar" ? "English" : "العربية"));
}

await store.load();
if (applyLang(store, "everyday-lang")) await new Promise(() => {}); // reloading with ?lang=
translateStatic();
// Re-read after the Hub bridge (embedded mode) delivered saved inputs.
const again = store.get("everyday-inputs", null);
if (again) { Object.assign(S.car, again.car || {}); Object.assign(S.home, again.home || {}); S.priorities = again.priorities || []; S.note = again.note || ""; S.tab = store.get("everyday-tab", S.tab); }
demoLabel();
render(false);
renderShare();
