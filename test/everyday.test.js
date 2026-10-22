// Everyday Economics simulation core: the cash-flow rules Shahed set before any of it is used for teaching.
import { test } from "node:test";
import assert from "node:assert/strict";
import { monthlyPayment, loanSchedule, carOwnership, carLoanVsCash, rentVsBuy, rentVsBuyRange, DEMO } from "../public/tools/everyday/lib/finance.js";

const close = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test("loan payments include principal and interest, and the schedule pays the loan off exactly", () => {
  close(monthlyPayment(20000, 0.06, 60), 386.66);            // standard amortization result
  close(monthlyPayment(12000, 0, 24), 500);                   // zero-rate loans are handled
  const s = loanSchedule(20000, 0.06, 60);
  close(s.at(-1).balance, 0);
  close(s.reduce((x, r) => x + r.principal, 0), 20000);       // principal repaid exactly once
  assert.ok(s.reduce((x, r) => x + r.interest, 0) > 0);
  for (const r of s) close(r.payment, r.principal + r.interest);
});

test("car: the financed principal is never counted twice (down payment + repayments + net sale)", () => {
  const c = carOwnership(DEMO.car);
  close(c.netCost, c.identity);                               // = price + fees + interest + running − sale
  // The rejected formula (full price PLUS every repayment) overstates the cost by exactly the principal repaid.
  const naive = DEMO.car.price + DEMO.car.fees + c.flows.slice(1, -1).reduce((x, f) => x - f.amount, 0) - DEMO.car.salePrice;
  close(naive - c.netCost, DEMO.car.price - DEMO.car.downPayment - c.remainingDebt);
  // Month 0 is only the down payment and fees, not the full price.
  close(c.flows[0].amount, -(DEMO.car.downPayment + DEMO.car.fees));
  // Selling before the loan ends: the remaining debt is repaid from the sale proceeds.
  assert.ok(c.remainingDebt > 0);
  close(c.flows.at(-1).amount, DEMO.car.salePrice - c.remainingDebt);
});

test("car: cash purchase and full-term loan follow the same rules", () => {
  const cash = carOwnership({ ...DEMO.car, downPayment: DEMO.car.price });
  close(cash.netCost, DEMO.car.price + DEMO.car.fees + DEMO.car.monthlyRunning * DEMO.car.holdMonths - DEMO.car.salePrice);
  assert.equal(cash.breakdown.interestPaid, 0);
  const full = carOwnership({ ...DEMO.car, holdMonths: 60 });
  assert.equal(full.remainingDebt, 0);
  close(full.netCost, full.identity);
  assert.ok(carOwnership(DEMO.car).netCost > cash.netCost, "financing adds interest");
});

test("rent vs buy starts from equal funds and includes the down payment, purchase costs and terminal values", () => {
  const r = rentVsBuy(DEMO.housing);
  assert.equal(r.feasible, true);
  close(r.upFront.downPayment + r.upFront.purchaseCosts + r.upFront.investedByBuyer, r.upFront.investedByRenter);
  close(r.upFront.downPayment, DEMO.housing.homePrice * DEMO.housing.downPaymentPct);
  assert.ok(r.upFront.purchaseCosts > 0);
  assert.equal(r.timeline.length, DEMO.housing.months);       // consistent monthly periods
  // Terminal buyer wealth = home after selling costs − remaining mortgage + investments.
  const last = r.timeline.at(-1);
  assert.ok(r.end.remainingDebt > 0 && r.end.homeValue > DEMO.housing.homePrice);
  assert.ok(last.buyerCost > DEMO.housing.insuranceMonthly, "owner costs include mortgage, ownership costs and insurance");
});

test("break-even may never happen within the horizon, and the model says so instead of inventing one", () => {
  const never = rentVsBuy({ ...DEMO.housing, months: 24, homeGrowthYear: 0 });
  assert.equal(never.feasible, true);
  assert.equal(never.breakEvenMonth, null);
  const later = rentVsBuy({ ...DEMO.housing, months: 360, homeGrowthYear: 0.04, investReturnYear: 0.03 });
  assert.ok(Number.isInteger(later.breakEvenMonth) && later.breakEvenMonth > 1);
});

test("no verdicts: ranges, affordability and infeasibility are reported, not right/wrong", () => {
  const range = rentVsBuyRange(DEMO.housing);
  assert.equal(range.cases.length, 9);
  assert.ok(range.minDifference < range.maxDifference);
  const r = rentVsBuy(DEMO.housing);
  assert.ok(r.affordability && typeof r.affordability.withinLimit === "boolean");
  assert.ok(!("correct" in r) && !("verdict" in r) && !("score" in r));
  const tooPoor = rentVsBuy({ ...DEMO.housing, startingFunds: 20000 });
  assert.equal(tooPoor.feasible, false);
  assert.match(tooPoor.reason, /up front/);
});

test("demo data is labelled synthetic with currency, country, units, period and source", () => {
  assert.equal(DEMO.label, "Synthetic demo data");
  for (const k of ["country", "currency", "units", "period", "source"]) assert.ok(DEMO[k]?.length > 5, k);
  assert.match(DEMO.country, /Fictional/);
  assert.match(DEMO.source, /Not historical, not production data/);
  assert.doesNotMatch(`${DEMO.label} ${DEMO.period}`, /production|historical/i);
  assert.doesNotMatch(JSON.stringify(DEMO), /top \d+%|percentile|ranking/i);
});

test("car loan vs cash compares terminal wealth from equal funds, so interest and kept-cash returns both count", () => {
  const c = carLoanVsCash(DEMO.car);
  assert.equal(c.feasible, true);
  // With no investment return and no interest, the two must end equal: financing alone creates no money.
  const flat = carLoanVsCash({ ...DEMO.car, annualRate: 0, investReturnYear: 0 });
  close(flat.difference, 0);
  // Interest with no investment return: paying cash ends ahead by roughly the interest paid.
  const noReturn = carLoanVsCash({ ...DEMO.car, investReturnYear: 0 });
  close(-noReturn.difference, noReturn.loan.breakdown.interestPaid, 1);
  // A high return on kept cash can favour the loan: no fixed answer.
  assert.ok(carLoanVsCash({ ...DEMO.car, investReturnYear: 0.12 }).difference > 0);
  assert.equal(carLoanVsCash({ ...DEMO.car, startingFunds: 10000 }).feasible, false);
});
