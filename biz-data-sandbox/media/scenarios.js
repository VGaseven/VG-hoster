// @ts-check
// BizData Sandbox data dictionary: every business module, its code samples and its simulation model.
// Code samples are template functions of the slider values so the code students read always matches
// the numbers the simulator shows.
(function () {
  'use strict';

  // ---------- helpers ----------

  /** Deterministic PRNG (mulberry32) so slider changes don't reshuffle the "data". */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Fixed array of standard-normal draws (Box-Muller). */
  function normals(seed, n) {
    const rand = rng(seed);
    const out = [];
    while (out.length < n) {
      const u = Math.max(rand(), 1e-12);
      const v = rand();
      const r = Math.sqrt(-2 * Math.log(u));
      out.push(r * Math.cos(2 * Math.PI * v), r * Math.sin(2 * Math.PI * v));
    }
    return out.slice(0, n);
  }

  const money = (v, digits = 0) =>
    (v < 0 ? '-$' : '$') +
    Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const moneyK = (v) => {
    const abs = Math.abs(v);
    if (abs >= 1e6) return (v < 0 ? '-$' : '$') + (abs / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return (v < 0 ? '-$' : '$') + (abs / 1e3).toFixed(1) + 'k';
    return money(v);
  };
  const int = (v) => Math.round(v).toLocaleString('en-US');
  const pct = (v, digits = 1) => (v * 100).toFixed(digits) + '%';
  const num = (v, digits = 2) => v.toFixed(digits);
  const stdev = (xs) => {
    const m = xs.reduce((s, x) => s + x, 0) / xs.length;
    return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
  };

  /** Adds `months` to a YYYY-MM month and returns [year, month]. */
  function addMonths(year, month, months) {
    const idx = year * 12 + (month - 1) + months;
    return [Math.floor(idx / 12), (idx % 12) + 1];
  }
  const ymLabel = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
  const eviewsDate = (y, m) => `${y}m${String(m).padStart(2, '0')}`;

  // ---------- Module 1: Marketing Analytics ----------

  const marketing = {
    id: 'marketing',
    name: 'Marketing Analytics',
    icon: '🛒',
    title: 'Scenario: Customer Lifetime Value & Cohort Retention',
    problem:
      'An omnichannel retailer wants to know how much a newly acquired customer is worth so the marketing team can set a ' +
      'maximum customer-acquisition cost (CAC). Pull yearly acquisition cohorts from the order pipeline with SQL, then ' +
      'project retention, margin and discounted lifetime value in R.',
    workflow: [
      { lang: 'sql', text: 'Build yearly acquisition cohorts and retention from completed orders.' },
      { lang: 'r', text: 'Estimate retention, project a 5-year cohort and compute discounted CLV.' },
    ],
    concepts: [
      ['Cohort', 'A group of customers who made their first purchase in the same period.'],
      ['Retention rate (r)', 'Share of last year’s active customers who buy again this year.'],
      ['CLV', 'Present value of the gross margin a customer generates: Σ m·rᵗ / (1+d)ᵗ = m·(1+d) / (1+d−r).'],
      ['Max CAC', 'The most you can spend to acquire a customer and still break even — CLV is the ceiling.'],
    ],
    languages: ['sql', 'r'],
    params: [
      { id: 'retention', label: 'Retention rate', min: 40, max: 95, step: 1, value: 80, unit: '%' },
      { id: 'aov', label: 'Average transaction value', min: 20, max: 500, step: 5, value: 85, unit: '$' },
      { id: 'freq', label: 'Purchases per customer / year', min: 1, max: 24, step: 1, value: 6, unit: '×' },
      { id: 'margin', label: 'Gross margin', min: 10, max: 80, step: 1, value: 35, unit: '%' },
      { id: 'discount', label: 'Discount rate (WACC)', min: 0, max: 20, step: 0.5, value: 10, unit: '%' },
      { id: 'cohort', label: 'New customers in cohort', min: 100, max: 10000, step: 100, value: 1000, unit: '' },
    ],
    captions: {
      sql: 'PostgreSQL · retail data warehouse',
      r: 'R · dplyr + ggplot2',
    },
    code: {
      sql: () => `-- Marketing Analytics: yearly acquisition cohorts and retention
-- Source: retail order pipeline (PostgreSQL data warehouse)
WITH first_orders AS (
    SELECT  customer_id,
            DATE_TRUNC('year', MIN(order_date))::date AS cohort_year
    FROM    sales.orders
    WHERE   order_status = 'COMPLETED'
    GROUP BY customer_id
),
activity AS (
    SELECT  f.cohort_year,
            o.customer_id,
            o.order_id,
            o.order_total,
            EXTRACT(YEAR FROM o.order_date)::int
              - EXTRACT(YEAR FROM f.cohort_year)::int AS years_since_first
    FROM    sales.orders o
    JOIN    first_orders f USING (customer_id)
    WHERE   o.order_status = 'COMPLETED'
)
SELECT  cohort_year,
        years_since_first,
        COUNT(DISTINCT customer_id)                                    AS active_customers,
        ROUND(COUNT(DISTINCT customer_id)::numeric
              / FIRST_VALUE(COUNT(DISTINCT customer_id)) OVER w, 4)    AS pct_of_cohort,
        ROUND(SUM(order_total) / COUNT(DISTINCT order_id), 2)         AS avg_order_value,
        ROUND(COUNT(DISTINCT order_id)::numeric
              / COUNT(DISTINCT customer_id), 2)                        AS orders_per_customer
FROM    activity
GROUP BY cohort_year, years_since_first
WINDOW  w AS (PARTITION BY cohort_year ORDER BY years_since_first)
ORDER BY cohort_year, years_since_first;`,
      r: (p) => `# Marketing Analytics: cohort projection and Customer Lifetime Value
library(DBI)
library(dplyr)
library(ggplot2)

con     <- dbConnect(RPostgres::Postgres(), dbname = "retail_dw")
cohorts <- dbGetQuery(con, readr::read_file("sql/cohort_retention.sql"))

# Year-over-year retention observed in the warehouse (sanity check vs. assumption)
observed_retention <- cohorts |>
  group_by(cohort_year) |>
  arrange(years_since_first, .by_group = TRUE) |>
  mutate(yoy = active_customers / lag(active_customers)) |>
  ungroup() |>
  summarise(mean_yoy = mean(yoy, na.rm = TRUE)) |>
  pull(mean_yoy)

# Planning assumptions (from the sandbox sliders)
retention   <- ${num(p.retention / 100)}
aov         <- ${p.aov}      # average transaction value ($)
freq        <- ${p.freq}       # purchases per customer per year
margin      <- ${num(p.margin / 100)}
discount    <- ${num(p.discount / 100, 3)}
cohort_size <- ${p.cohort}

annual_margin <- aov * freq * margin           # gross margin per active customer

projection <- tibble(year = 0:4) |>
  mutate(
    active_customers = cohort_size * retention^year,
    revenue          = active_customers * aov * freq,
    gross_margin     = revenue * margin,
    discounted_gm    = gross_margin / (1 + discount)^year
  )

clv_5yr      <- sum(projection$discounted_gm) / cohort_size
clv_lifetime <- annual_margin * (1 + discount) / (1 + discount - retention)

cat(sprintf("Observed YoY retention: %.1f%%\\n", 100 * observed_retention))
cat(sprintf("5-year CLV: $%.2f | Lifetime CLV (max CAC): $%.2f\\n", clv_5yr, clv_lifetime))

ggplot(projection, aes(factor(year), active_customers)) +
  geom_col(fill = "#3b82f6") +
  labs(x = "Years since acquisition", y = "Active customers",
       title = "Projected cohort decay") +
  theme_minimal()`,
    },
    simulate(p) {
      const r = p.retention / 100;
      const d = p.discount / 100;
      const m = p.margin / 100;
      const annualMargin = p.aov * p.freq * m;
      const rows = [];
      let pv = 0;
      for (let t = 0; t < 5; t++) {
        const active = p.cohort * Math.pow(r, t);
        const revenue = active * p.aov * p.freq;
        const gm = revenue * m;
        const disc = gm / Math.pow(1 + d, t);
        pv += disc;
        rows.push({ t, active, revenue, gm, disc });
      }
      const clv5 = pv / p.cohort;
      const clvLife = (annualMargin * (1 + d)) / (1 + d - r);
      const expectedLife = 1 / (1 - r);
      return {
        kpis: [
          { label: 'Lifetime CLV (max CAC)', value: money(clvLife, 2), tone: 'accent' },
          { label: '5-year CLV', value: money(clv5, 2) },
          { label: 'Expected customer lifetime', value: num(expectedLife, 1) + ' yrs' },
          { label: '5-yr cohort gross margin (PV)', value: moneyK(pv) },
        ],
        chart: {
          kind: 'bar',
          title: 'Active customers by year since acquisition',
          labels: rows.map((x) => 'Year ' + x.t),
          series: [{ name: 'Active customers', values: rows.map((x) => x.active), format: int }],
        },
        table: {
          columns: ['Year', 'Active customers', 'Revenue', 'Gross margin', 'Discounted GM'],
          rows: rows.map((x) => [String(x.t), int(x.active), moneyK(x.revenue), moneyK(x.gm), moneyK(x.disc)]),
        },
      };
    },
  };

  // ---------- Module 2: Corporate Finance ----------

  const FIN_DAYS = 60;
  const finIn = normals(20261021, FIN_DAYS);
  const finOut = normals(4242, FIN_DAYS);

  const finance = {
    id: 'finance',
    name: 'Corporate Finance',
    icon: '🏦',
    title: 'Scenario: Moving-Average Cash Flow Forecast',
    problem:
      'Treasury needs a two-week cash outlook to decide whether to draw on the revolving credit facility. Pull the last ' +
      '60 days of cash-account postings from the general ledger with SQL, then smooth daily net cash flow with a moving ' +
      'average in R and project the closing balance with a 95% band.',
    workflow: [
      { lang: 'sql', text: 'Aggregate daily cash in/out from the general ledger and roll up closing balances.' },
      { lang: 'r', text: 'Smooth net flow with a moving average and project balances over the forecast horizon.' },
    ],
    concepts: [
      ['General ledger (GL)', 'The system of record for every accounting posting; cash accounts hold the bank balances.'],
      ['Net cash flow', 'Cash in minus cash out for a period — the change in the cash balance.'],
      ['Moving average (MA)', 'Average of the last k days; smooths daily noise such as payroll spikes.'],
      ['Window choice', 'Match the window to the business cycle: a 14-day MA spans one bi-weekly payroll; a 7-day MA swings with it.'],
      ['Runway', 'Days until cash hits zero if the current average burn continues.'],
    ],
    languages: ['sql', 'r'],
    params: [
      { id: 'opening', label: 'Opening cash balance', min: 100, max: 5000, step: 50, value: 1200, unit: '$k' },
      { id: 'inflow', label: 'Avg daily cash inflow', min: 10, max: 200, step: 1, value: 85, unit: '$k' },
      { id: 'outflow', label: 'Avg daily cash outflow', min: 10, max: 200, step: 1, value: 82, unit: '$k' },
      { id: 'vol', label: 'Daily volatility', min: 0, max: 60, step: 1, value: 20, unit: '%' },
      { id: 'window', label: 'Moving-average window', min: 3, max: 30, step: 1, value: 14, unit: 'days' },
      { id: 'horizon', label: 'Forecast horizon', min: 7, max: 30, step: 1, value: 14, unit: 'days' },
    ],
    captions: {
      sql: 'PostgreSQL · ERP general ledger',
      r: 'R · dplyr + zoo',
    },
    code: {
      sql: (p) => `-- Corporate Finance: daily cash ledger balances (last ${FIN_DAYS} days)
-- Source: ERP general ledger (PostgreSQL)
WITH calendar AS (
    SELECT generate_series(CURRENT_DATE - INTERVAL '${FIN_DAYS} days',
                           CURRENT_DATE - INTERVAL '1 day',
                           INTERVAL '1 day')::date AS ledger_date
),
daily AS (
    SELECT  gl.posting_date::date                                     AS ledger_date,
            SUM(CASE WHEN gl.amount > 0 THEN  gl.amount ELSE 0 END)  AS cash_in,
            SUM(CASE WHEN gl.amount < 0 THEN -gl.amount ELSE 0 END)  AS cash_out
    FROM    finance.general_ledger    gl
    JOIN    finance.chart_of_accounts coa ON coa.account_id = gl.account_id
    WHERE   coa.account_class = 'CASH_AND_EQUIVALENTS'
      AND   gl.is_reversed    = FALSE
      AND   gl.posting_date  >= CURRENT_DATE - INTERVAL '${FIN_DAYS} days'
    GROUP BY gl.posting_date::date
)
SELECT  c.ledger_date,
        COALESCE(d.cash_in, 0)                            AS cash_in,
        COALESCE(d.cash_out, 0)                           AS cash_out,
        COALESCE(d.cash_in, 0) - COALESCE(d.cash_out, 0)  AS net_flow,
        ${p.opening * 1000}   -- opening balance from treasury (sandbox slider)
          + SUM(COALESCE(d.cash_in, 0) - COALESCE(d.cash_out, 0))
            OVER (ORDER BY c.ledger_date ROWS UNBOUNDED PRECEDING) AS closing_balance
FROM    calendar c
LEFT JOIN daily d USING (ledger_date)
ORDER BY c.ledger_date;`,
      r: (p) => `# Corporate Finance: moving-average cash flow forecast
library(DBI)
library(dplyr)
library(zoo)
library(ggplot2)

con    <- dbConnect(RPostgres::Postgres(), dbname = "erp_finance")
ledger <- dbGetQuery(con, readr::read_file("sql/daily_cash_ledger.sql")) |>
  arrange(ledger_date)

ma_window <- ${p.window}    # days in the moving average (sandbox slider)
horizon   <- ${p.horizon}   # days to forecast

ledger <- ledger |>
  mutate(ma_net = zoo::rollmeanr(net_flow, k = ma_window, fill = NA))

last_ma  <- tail(na.omit(ledger$ma_net), 1)
sigma    <- sd(ledger$net_flow)
last_bal <- tail(ledger$closing_balance, 1)
steps    <- seq_len(horizon)

forecast <- tibble(
  ledger_date = max(ledger$ledger_date) + steps,
  balance     = last_bal + last_ma * steps,
  lower_95    = balance - 1.96 * sigma * sqrt(steps),
  upper_95    = balance + 1.96 * sigma * sqrt(steps)
)

runway_days <- if (last_ma < 0) last_bal / abs(last_ma) else Inf
cat(sprintf("MA(%d) net flow: $%.0f/day | Runway: %s days\\n",
            ma_window, last_ma, format(round(runway_days))))

ggplot() +
  geom_line(data = ledger, aes(ledger_date, closing_balance)) +
  geom_ribbon(data = forecast, aes(ledger_date, ymin = lower_95, ymax = upper_95), alpha = 0.2) +
  geom_line(data = forecast, aes(ledger_date, balance), linetype = "dashed") +
  labs(x = NULL, y = "Cash balance ($)", title = "Cash position with MA forecast") +
  theme_minimal()`,
    },
    simulate(p) {
      const vol = p.vol / 100;
      const net = [];
      const bal = [];
      let b = p.opening * 1000;
      for (let t = 0; t < FIN_DAYS; t++) {
        // Payroll every 14 days adds a predictable outflow spike; MA smooths it out.
        const payroll = t % 14 === 13 ? 2.5 : 0.75;
        const cin = Math.max(0, p.inflow * 1000 * (1 + vol * finIn[t]));
        const cout = Math.max(0, p.outflow * 1000 * payroll * (1 + vol * finOut[t]) * (14 / (13 * 0.75 + 2.5)));
        net.push(cin - cout);
        b += cin - cout;
        bal.push(b);
      }
      const ma = [];
      for (let t = 0; t < FIN_DAYS; t++) {
        if (t + 1 < p.window) {
          ma.push(null);
        } else {
          let s = 0;
          for (let k = t - p.window + 1; k <= t; k++) s += net[k];
          ma.push(s / p.window);
        }
      }
      const lastMa = /** @type {number} */ (ma[FIN_DAYS - 1]);
      const sigma = stdev(net);
      const lastBal = bal[FIN_DAYS - 1];
      const fc = [];
      for (let h = 1; h <= p.horizon; h++) {
        const mid = lastBal + lastMa * h;
        const half = 1.96 * sigma * Math.sqrt(h);
        fc.push({ h, mid, lo: mid - half, hi: mid + half });
      }
      const end = fc[fc.length - 1];
      const runway = lastBal <= 0 ? 0 : lastMa < 0 ? lastBal / -lastMa : Infinity;
      const showHist = 30;
      const histBal = bal.slice(-showHist);
      const labels = [];
      for (let i = showHist; i >= 1; i--) labels.push('T-' + i);
      for (let h = 1; h <= p.horizon; h++) labels.push('T+' + h);
      const pad = (arr, before, after) => [...Array(before).fill(null), ...arr, ...Array(after).fill(null)];
      return {
        kpis: [
          { label: `Forecast balance (T+${p.horizon})`, value: moneyK(end.mid), tone: end.lo < 0 ? 'warn' : 'accent' },
          { label: `MA(${p.window}) net flow / day`, value: moneyK(lastMa), tone: lastMa < 0 ? 'warn' : undefined },
          { label: 'Current balance', value: moneyK(lastBal) },
          { label: 'Cash runway', value: lastBal <= 0 ? 'Overdrawn' : runway === Infinity ? 'Cash-generative' : Math.round(runway) + ' days', tone: runway < 60 ? 'warn' : undefined },
        ],
        chart: {
          kind: 'line',
          title: 'Closing cash balance — last 30 days and forecast (95% band)',
          labels,
          labelEvery: 7,
          format: moneyK,
          series: [
            { name: 'Actual balance', values: pad(histBal, 0, p.horizon) },
            { name: 'MA forecast', values: pad([lastBal, ...fc.map((x) => x.mid)], showHist - 1, 0), dashed: true },
          ],
          band: {
            lower: pad([lastBal, ...fc.map((x) => x.lo)], showHist - 1, 0),
            upper: pad([lastBal, ...fc.map((x) => x.hi)], showHist - 1, 0),
          },
          zeroLine: true,
        },
        table: {
          columns: ['Day', 'Forecast balance', 'Lower 95%', 'Upper 95%'],
          rows: fc.map((x) => ['T+' + x.h, moneyK(x.mid), moneyK(x.lo), moneyK(x.hi)]),
        },
      };
    },
  };

  // ---------- Module 3: Macro Forecasting ----------

  const MACRO_START = [2016, 1];
  const MACRO_MONTHS = 129; // 2016-01 .. 2026-09
  const macroShocks = normals(1979, MACRO_MONTHS);

  function macroDates(p) {
    const last = addMonths(MACRO_START[0], MACRO_START[1], MACRO_MONTHS - 1);
    const first = addMonths(last[0], last[1], 1);
    const end = addMonths(last[0], last[1], p.horizon);
    return { last, first, end };
  }

  const macro = {
    id: 'macro',
    name: 'Macro Forecasting',
    icon: '📈',
    title: 'Scenario: ARIMA Forecast of Consumer Price Inflation',
    problem:
      'The strategy team needs a 12-month CPI outlook to index supplier contracts and price lists. Pull the monthly CPI ' +
      'history from the economics data mart with SQL, test and prepare the series in R, then estimate an ' +
      'ARIMA(1,1,1) model on log CPI and produce the forecast with confidence bands in EViews.',
    workflow: [
      { lang: 'sql', text: 'Pull the latest vintage of monthly CPI (all items, seasonally adjusted).' },
      { lang: 'r', text: 'Check stationarity (ADF), inspect ACF/PACF, export a clean series.' },
      { lang: 'eviews', text: 'Estimate ARIMA(1,1,1) on log CPI, run diagnostics and forecast.' },
    ],
    concepts: [
      ['Integration (d)', 'Log CPI trends upward (unit root); differencing once gives monthly inflation, which is stationary.'],
      ['AR(1) φ', 'Persistence: how much of last month’s inflation surprise carries into this month.'],
      ['MA(1) θ', 'How much last month’s random shock feeds into this month.'],
      ['Forecast band', 'Uncertainty widens with the horizon because shocks accumulate in the level.'],
    ],
    languages: ['sql', 'r', 'eviews'],
    params: [
      { id: 'phi', label: 'AR(1) coefficient φ', min: -0.9, max: 0.95, step: 0.05, value: 0.5, unit: '' },
      { id: 'theta', label: 'MA(1) coefficient θ', min: -0.9, max: 0.9, step: 0.05, value: 0.3, unit: '' },
      { id: 'drift', label: 'Mean monthly inflation', min: 0, max: 1.2, step: 0.01, value: 0.25, unit: '%' },
      { id: 'sigma', label: 'Shock volatility (σ)', min: 0.05, max: 0.8, step: 0.01, value: 0.2, unit: 'pp' },
      { id: 'horizon', label: 'Forecast horizon', min: 6, max: 36, step: 1, value: 12, unit: 'months' },
    ],
    captions: {
      sql: 'PostgreSQL · economics data mart',
      r: 'R · tseries + forecast',
      eviews: 'EViews program (.prg)',
    },
    code: {
      sql: () => `-- Macro Forecasting: monthly CPI history (latest data vintage)
-- Source: economics data mart, mirrored from FRED (PostgreSQL)
SELECT  o.observation_date,
        o.index_value AS cpi_all_items
FROM    macro.economic_observations o
JOIN    macro.series s ON s.series_id = o.series_id
WHERE   s.series_code       = 'CPIAUCSL'      -- CPI-U, all items, seasonally adjusted
  AND   o.observation_date >= DATE '2016-01-01'
  AND   o.vintage_date = (
            SELECT MAX(v.vintage_date)
            FROM   macro.economic_observations v
            WHERE  v.series_id        = o.series_id
              AND  v.observation_date = o.observation_date
        )
ORDER BY o.observation_date;`,
      r: () => `# Macro Forecasting: prepare CPI for ARIMA modelling
library(DBI)
library(tseries)
library(forecast)

con <- dbConnect(RPostgres::Postgres(), dbname = "econ_mart")
cpi <- dbGetQuery(con, readr::read_file("sql/cpi_history.sql"))
cpi <- cpi[order(cpi$observation_date), ]
stopifnot(!anyNA(cpi$cpi_all_items))

cpi_ts <- ts(cpi$cpi_all_items, start = c(2016, 1), frequency = 12)
lcpi   <- log(cpi_ts)
dlcpi  <- 100 * diff(lcpi)          # monthly inflation, % points

# Identification: unit root in levels, stationary after one difference -> d = 1
adf.test(lcpi)                      # expect p > 0.05 (non-stationary)
adf.test(dlcpi)                     # expect p < 0.05 (stationary)
Acf(dlcpi, lag.max = 24)
Pacf(dlcpi, lag.max = 24)

# Cross-check the specification in R before the EViews run
fit_r <- Arima(lcpi, order = c(1, 1, 1), include.drift = TRUE)
summary(fit_r)
checkresiduals(fit_r)

# Hand-off file for EViews
write.csv(
  data.frame(obs = format(cpi$observation_date, "%Y-%m"), cpi = cpi$cpi_all_items),
  "cpi_clean.csv", row.names = FALSE
)`,
      eviews: (p) => {
        const { last, first, end } = macroDates(p);
        return `' Macro Forecasting: ARIMA(1,1,1) on log CPI
' Sandbox scenario: AR(1) = ${num(p.phi)}, MA(1) = ${num(p.theta)}, horizon = ${p.horizon} months

wfcreate(wf=macro_cpi, page=monthly) m 2016m01 ${eviewsDate(end[0], end[1])}
import "cpi_clean.csv" @freq m 2016m01

series lcpi  = log(cpi)
series dlcpi = 100 * d(lcpi)

' --- Identification ---------------------------------------------
smpl 2016m01 ${eviewsDate(last[0], last[1])}
lcpi.uroot(adf, trend, info=sic)     ' unit root in levels?
dlcpi.uroot(adf, const, info=sic)    ' stationary after 1st difference?
dlcpi.correl(24)                     ' ACF / PACF

' --- Estimation: d(lcpi) = c + AR(1) + MA(1) --------------------
equation eq_arima.ls d(lcpi) c ar(1) ma(1)
show eq_arima

' --- Diagnostics -------------------------------------------------
eq_arima.arma(type=root)             ' stationarity / invertibility
eq_arima.correl(24)                  ' residual Q-statistics
eq_arima.hist                        ' normality (Jarque-Bera)

' --- Forecast ${p.horizon} months ahead ------------------------------------
smpl ${eviewsDate(first[0], first[1])} ${eviewsDate(end[0], end[1])}
eq_arima.forecast(e, g) lcpi_f lcpi_se
series cpi_f  = exp(lcpi_f)
series cpi_lo = exp(lcpi_f - 1.96 * lcpi_se)
series cpi_hi = exp(lcpi_f + 1.96 * lcpi_se)

smpl 2024m01 ${eviewsDate(end[0], end[1])}
group g_fcst cpi cpi_f cpi_lo cpi_hi
freeze(gr_fcst) g_fcst.line
gr_fcst.addtext(t) "CPI: ARIMA(1,1,1) forecast with 95% band"
show gr_fcst`;
      },
    },
    simulate(p) {
      const mu = p.drift;
      const sigma = p.sigma;
      // Simulate monthly inflation d_t (in % points) as ARMA(1,1) around mu, then cumulate into log CPI.
      const d = [];
      const e = [];
      let prevD = mu;
      let prevE = 0;
      for (let t = 0; t < MACRO_MONTHS; t++) {
        const shock = sigma * macroShocks[t];
        const dt = mu + p.phi * (prevD - mu) + shock + p.theta * prevE;
        d.push(dt);
        e.push(shock);
        prevD = dt;
        prevE = shock;
      }
      const logCpi = [Math.log(100)];
      for (let t = 1; t < MACRO_MONTHS; t++) logCpi.push(logCpi[t - 1] + d[t] / 100);
      const cpi = logCpi.map(Math.exp);

      // Point forecasts and 95% bands for the integrated series.
      const H = p.horizon;
      const dF = [];
      let next = mu + p.phi * (d[MACRO_MONTHS - 1] - mu) + p.theta * e[MACRO_MONTHS - 1];
      for (let h = 1; h <= H; h++) {
        dF.push(next);
        next = mu + p.phi * (next - mu);
      }
      const psi = [1];
      for (let j = 1; j < H; j++) psi.push(Math.pow(p.phi, j - 1) * (p.phi + p.theta));
      const cumPsi = [];
      psi.reduce((s, x, j) => (cumPsi[j] = s + x), 0);
      const fc = [];
      let lf = logCpi[MACRO_MONTHS - 1];
      for (let h = 1; h <= H; h++) {
        lf += dF[h - 1] / 100;
        let v = 0;
        for (let i = 1; i <= h; i++) v += cumPsi[h - i] ** 2;
        const se = (sigma / 100) * Math.sqrt(v);
        fc.push({ h, mid: Math.exp(lf), lo: Math.exp(lf - 1.96 * se), hi: Math.exp(lf + 1.96 * se), mom: dF[h - 1] });
      }
      const allLevels = [...cpi, ...fc.map((x) => x.mid)];
      const yoyAt = (idx) => allLevels[idx] / allLevels[idx - 12] - 1;
      const lastIdx = MACRO_MONTHS - 1;
      const { last } = macroDates(p);

      const showHist = 48;
      const labels = [];
      for (let i = showHist - 1; i >= 0; i--) {
        const [y, m] = addMonths(last[0], last[1], -i);
        labels.push(ymLabel(y, m));
      }
      for (let h = 1; h <= H; h++) {
        const [y, m] = addMonths(last[0], last[1], h);
        labels.push(ymLabel(y, m));
      }
      const pad = (arr, before, after) => [...Array(before).fill(null), ...arr, ...Array(after).fill(null)];
      const lastCpi = cpi[lastIdx];
      const end = fc[H - 1];
      return {
        kpis: [
          { label: `Forecast CPI (${labels[labels.length - 1]})`, value: num(end.mid, 1), tone: 'accent' },
          { label: 'Inflation, latest y/y', value: pct(yoyAt(lastIdx)) },
          { label: `Inflation, y/y at horizon`, value: pct(yoyAt(lastIdx + H)) },
          { label: '95% band at horizon', value: `${num(end.lo, 1)} – ${num(end.hi, 1)}` },
        ],
        chart: {
          kind: 'line',
          title: 'CPI index (2016-01 = 100) — last 4 years and ARIMA forecast',
          labels,
          labelEvery: 12,
          format: (v) => num(v, 1),
          series: [
            { name: 'CPI (history)', values: pad(cpi.slice(-showHist), 0, H) },
            { name: 'ARIMA forecast', values: pad([lastCpi, ...fc.map((x) => x.mid)], showHist - 1, 0), dashed: true },
          ],
          band: {
            lower: pad([lastCpi, ...fc.map((x) => x.lo)], showHist - 1, 0),
            upper: pad([lastCpi, ...fc.map((x) => x.hi)], showHist - 1, 0),
          },
        },
        table: {
          columns: ['Month', 'CPI forecast', 'Lower 95%', 'Upper 95%', 'm/m %', 'y/y %'],
          rows: fc.map((x, i) => [
            labels[showHist + i],
            num(x.mid, 2),
            num(x.lo, 2),
            num(x.hi, 2),
            num(x.mom, 2),
            pct(yoyAt(lastIdx + x.h)),
          ]),
        },
      };
    },
  };

  /** @type {any} */ (window).BizScenarios = {
    modules: [marketing, finance, macro],
    languageNames: { sql: 'SQL', r: 'R', eviews: 'EViews' },
  };
})();
