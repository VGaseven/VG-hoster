// Everyday Economics (later WhatIf track): personal-finance cash-flow models. SIMULATION CORE ONLY, no UI yet.
// Inputs are synthetic demo data for a fictional place; nothing here describes a real market.
// Conventions: monthly periods; amounts in the scenario's currency; outflows negative, inflows positive.
// Nothing is graded right or wrong: functions return cash flows, totals, ranges and constraint checks.

/** Fixed monthly payment for a fully amortizing loan (principal + interest). Zero rate is handled. */
export function monthlyPayment(principal, annualRate, months) {
  if (principal <= 0) return 0;
  const r = annualRate / 12;
  return r === 0 ? principal / months : (principal * r) / (1 - Math.pow(1 + r, -months));
}

/** Month-by-month schedule: payment, interest, principal and balance after each payment. */
export function loanSchedule(principal, annualRate, months) {
  const pay = monthlyPayment(principal, annualRate, months), r = annualRate / 12, rows = [];
  let balance = principal;
  for (let m = 1; m <= months; m++) {
    const interest = balance * r;
    const principalPart = m === months ? balance : pay - interest; // last payment clears rounding
    balance = Math.max(0, balance - principalPart);
    rows.push({ month: m, payment: principalPart + interest, interest, principal: principalPart, balance });
  }
  return rows;
}

const sum = (xs) => xs.reduce((s, x) => s + x, 0);

/**
 * Car: buy with a loan (or cash when downPayment = price), keep it holdMonths, then sell.
 * Cash flows from the buyer's side. The loan pays the seller directly, so the buyer's month-0 cash is only the
 * down payment and fees. The financed principal is then paid through repayments, never charged a second time.
 * At sale, the buyer receives the sale price minus the remaining loan balance (net of debt).
 */
export function carOwnership({ price, downPayment, annualRate, termMonths, fees = 0, monthlyRunning, holdMonths, salePrice }) {
  if (downPayment > price) throw new Error("Down payment cannot exceed the price.");
  const loan = price - downPayment;
  const schedule = loan > 0 ? loanSchedule(loan, annualRate, termMonths) : [];
  const flows = [{ month: 0, label: "Down payment and fees", amount: -(downPayment + fees) }];
  let interestPaid = 0, principalRepaid = 0;
  for (let m = 1; m <= holdMonths; m++) {
    const row = schedule[m - 1];
    const repayment = row ? row.payment : 0;
    if (row) { interestPaid += row.interest; principalRepaid += row.principal; }
    flows.push({ month: m, label: "Loan repayment + running costs", amount: -(repayment + monthlyRunning) });
  }
  const remainingDebt = holdMonths >= schedule.length ? 0 : schedule[holdMonths - 1]?.balance ?? loan;
  flows.push({ month: holdMonths, label: "Sale price minus remaining loan", amount: salePrice - remainingDebt });
  const netCost = -sum(flows.map((f) => f.amount));
  return {
    flows, netCost, loan, remainingDebt,
    breakdown: { downPayment, fees, principalRepaid, interestPaid, running: monthlyRunning * holdMonths, salePrice, remainingDebt },
    // Identity used by the tests: the financed principal is counted exactly once.
    identity: price + fees + interestPaid + monthlyRunning * holdMonths - salePrice,
  };
}

/**
 * Rent vs buy from EQUAL starting funds over `months`, monthly periods, complete cash flows.
 * Buyer: pays the down payment and purchase costs from the funds and invests the rest. Renter: invests all funds.
 * Each month both households have the same budget: the larger of the two housing costs. Whoever pays less invests
 * the difference, so neither side gets free money. Terminal wealth: buyer = home value after selling costs −
 * remaining mortgage + investments; renter = investments. Break-even is the first month in which the buyer's
 * wealth (if they sold then) is at least the renter's; it may not occur within the horizon (null).
 */
export function rentVsBuy(p) {
  const {
    startingFunds, homePrice, downPaymentPct, purchaseCostsPct, mortgageRate, mortgageMonths,
    monthlyRent, rentGrowthYear, homeGrowthYear, ownerCostsPctYear, insuranceMonthly, sellingCostsPct,
    investReturnYear, months, monthlyIncome, maxHousingShare = 0.35,
  } = p;
  const down = homePrice * downPaymentPct, purchaseCosts = homePrice * purchaseCostsPct;
  if (down + purchaseCosts > startingFunds) return { feasible: false, reason: `Buying needs ${Math.round(down + purchaseCosts)} up front; starting funds are ${startingFunds}.` };
  const schedule = loanSchedule(homePrice - down, mortgageRate, mortgageMonths);
  const g = (yr) => Math.pow(1 + yr, 1 / 12) - 1; // monthly equivalent of an annual rate
  const ri = g(investReturnYear), rh = g(homeGrowthYear), rr = g(rentGrowthYear);
  let buyerInv = startingFunds - down - purchaseCosts, renterInv = startingFunds, home = homePrice, rent = monthlyRent;
  const timeline = [];
  let breakEven = null, peakShare = 0;
  for (let m = 1; m <= months; m++) {
    const mort = schedule[m - 1]?.payment ?? 0;
    const ownerCosts = (home * ownerCostsPctYear) / 12 + insuranceMonthly;
    const buyerCost = mort + ownerCosts, renterCost = rent;
    const budget = Math.max(buyerCost, renterCost);
    buyerInv = buyerInv * (1 + ri) + (budget - buyerCost);
    renterInv = renterInv * (1 + ri) + (budget - renterCost);
    home *= 1 + rh;
    const debt = schedule[m - 1]?.balance ?? 0;
    const buyerWealth = home * (1 - sellingCostsPct) - debt + buyerInv;
    if (breakEven === null && buyerWealth >= renterInv) breakEven = m;
    if (monthlyIncome) peakShare = Math.max(peakShare, buyerCost / monthlyIncome);
    timeline.push({ month: m, buyerCost, renterCost, buyerWealth, renterWealth: renterInv, homeValue: home, debt });
    rent *= 1 + rr;
  }
  const end = timeline[timeline.length - 1];
  return {
    feasible: true,
    upFront: { downPayment: down, purchaseCosts, investedByBuyer: startingFunds - down - purchaseCosts, investedByRenter: startingFunds },
    end: { buyerWealth: end.buyerWealth, renterWealth: end.renterWealth, difference: end.buyerWealth - end.renterWealth, homeValue: end.homeValue, remainingDebt: end.debt },
    breakEvenMonth: breakEven, // null = no break-even within the horizon
    affordability: monthlyIncome ? { peakHousingShare: peakShare, limit: maxHousingShare, withinLimit: peakShare <= maxHousingShare } : null,
    timeline,
  };
}

/** Ranges instead of a verdict: the same comparison under low / base / high home growth and investment return. */
export function rentVsBuyRange(p, spread = { homeGrowthYear: 0.02, investReturnYear: 0.02 }) {
  const out = [];
  for (const hg of [-1, 0, 1]) for (const ir of [-1, 0, 1]) {
    const r = rentVsBuy({ ...p, homeGrowthYear: p.homeGrowthYear + hg * spread.homeGrowthYear, investReturnYear: p.investReturnYear + ir * spread.investReturnYear });
    if (r.feasible) out.push({ homeGrowthYear: p.homeGrowthYear + hg * spread.homeGrowthYear, investReturnYear: p.investReturnYear + ir * spread.investReturnYear, difference: r.end.difference, breakEvenMonth: r.breakEvenMonth });
  }
  const diffs = out.map((x) => x.difference).sort((a, b) => a - b);
  return { cases: out, minDifference: diffs[0], maxDifference: diffs[diffs.length - 1] };
}

/**
 * Car: loan vs paying cash, from EQUAL starting funds (>= the price) over holdMonths, equal monthly budgets.
 * Cash buyer: pays the price and fees at month 0, invests the rest, and each month invests what the loan buyer
 * repays. Loan buyer: pays the down payment and fees, invests the rest, repays monthly. Both run the car and sell it
 * at the end; the loan buyer repays the remaining debt from the sale. Compares terminal wealth, so interest costs
 * and the investment return on kept cash are both counted.
 */
export function carLoanVsCash(p) {
  const { startingFunds, price, fees = 0, investReturnYear } = p;
  if (startingFunds < price + fees) return { feasible: false, reason: `Paying cash needs ${Math.round(price + fees)}; starting funds are ${startingFunds}.` };
  const loan = carOwnership(p), cash = carOwnership({ ...p, downPayment: price });
  const ri = Math.pow(1 + investReturnYear, 1 / 12) - 1;
  let loanInv = startingFunds - p.downPayment - fees, cashInv = startingFunds - price - fees;
  for (let m = 1; m <= p.holdMonths; m++) {
    const loanOut = -loan.flows[m].amount, cashOut = -cash.flows[m].amount, budget = Math.max(loanOut, cashOut);
    loanInv = loanInv * (1 + ri) + (budget - loanOut);
    cashInv = cashInv * (1 + ri) + (budget - cashOut);
  }
  const loanWealth = loanInv + loan.flows.at(-1).amount, cashWealth = cashInv + cash.flows.at(-1).amount;
  return { feasible: true, loan, cash, loanWealth, cashWealth, difference: loanWealth - cashWealth };
}

/** Clearly fictional demo inputs. Labels travel with the data so no screen can show numbers without them. */
export const DEMO = {
  label: "Synthetic demo data",
  country: "Fictional (Valoria)",
  currency: "VAL (fictional currency unit)",
  units: "Money in VAL; time in months; rates are annual, converted to monthly",
  period: "Illustrative 2026 values, not observed prices",
  source: "Invented for teaching. Not historical, not production data, not a sample of any real market.",
  car: { startingFunds: 30000, price: 24000, downPayment: 4000, annualRate: 0.069, termMonths: 60, fees: 450, monthlyRunning: 310, holdMonths: 48, salePrice: 11500, investReturnYear: 0.05 },
  housing: {
    startingFunds: 70000, homePrice: 300000, downPaymentPct: 0.2, purchaseCostsPct: 0.03, mortgageRate: 0.055, mortgageMonths: 360,
    monthlyRent: 1350, rentGrowthYear: 0.03, homeGrowthYear: 0.025, ownerCostsPctYear: 0.012, insuranceMonthly: 70, sellingCostsPct: 0.06,
    investReturnYear: 0.05, months: 120, monthlyIncome: 6200,
  },
};
