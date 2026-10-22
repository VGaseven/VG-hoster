# WhatIf: business decision lab (Shahed's Hub → Work)

Working name in the code: **BizData Stack Sandbox** (`public/tools/bizdata/`). Promise: **"Learn to make and defend business decisions with data."**

WhatIf is a browser-based simulator for business, economics, finance, accounting, marketing and operations students. Students investigate a business problem, trace evidence, compare strategies and defend a decision. Code is a supporting tool, not the destination. **Nothing needs installing**: no VS Code, extension, terminal, database, R or Python. The old VS Code extension (`feature/biz-data-sandbox`) is optional legacy reference only; WhatIf does not use it.

Status: review branch `claude/bizdata-stack-sandbox`, **not deployed**. See `HANDOVER.md` for branch state and next steps.

---

## 1. What exists today

One complete mission, **Rotterdam Port Bottleneck**, at a fictional company (*Kestrel Home Goods B.V.*) with synthetic data.

| Step | What the student does |
|---|---|
| Briefing | Reads a COO memo: the problem, their role, constraints (emergency cash, Antwerp barge slots, 95% service target, DC space), available evidence and the deliverable. Fictional news outlet only. |
| Investigate | Browses every table with column definitions and blank-value counts; in Guided/Assisted mode uses spreadsheet-style filters that can become SQL; runs real SQL in the "Explore the data" drawer for three tasks (predict → run → explain); opens the Excel ↔ code bridge. |
| Company status (always visible) | Six simulated KPIs. Each opens a trace: source rows, filters and joins, formula, before/after values, and how an assumption changes the result. "Inventory value at risk" stays empty until the student's own query passes. |
| Compare strategies | Builds a plan: reroute containers (checkboxes, slot limit), emergency buy (radio: none / EU / Turkey + weeks-of-cover slider), early order and lease space (independent checkboxes). Saves up to five plans and compares them under identical seeded scenarios: cash, expected cost, P10–P90 range, fill rate, chance of meeting the service target, excess stock, constraint status. Optional assumption sliders. |
| Decide & defend | Links evidence (passed or failed queries, KPI traces, the comparison), writes a recommendation, states expected cost, fill rate and downside cost, names when the plan would be wrong, and may explicitly accept a service shortfall. Submission is blocked until the evidence gate is met. |
| Review | Rubric (10 points), decision quality (defensible or not, and why), feedback in four groups (calculation errors, unsupported claims, constraint issues, defensible alternatives), then one simulated "what happened next" outcome that is shown but never scored. |
| Portfolio | Private BizData completion record; Replay and verify (re-runs the saved SQL on the same dataset and re-scores); export JSON / Markdown; editable CV bullets. |
| Fresh variant | New seed, same rules, different numbers. Independent mode on a fresh variant without hints is the only route to "completed independently". |

Three learning modes: **Guided** (spreadsheet filters first, annotated worked queries, all hints shown), **Assisted** (templates to complete, optional hints counted, reference query can be revealed and is recorded), **Independent** (fresh dataset, blank editor, no hints, no spreadsheet helper).

## 2. What genuinely executes, what is simulated, what is only shown

| Capability | Status |
|---|---|
| SQL | **Executes for real**: SQLite compiled to WebAssembly (sql.js 1.15.1) in a Web Worker in the student's browser. Fresh in-memory copy of the mission data per run, `PRAGMA query_only = ON`, 4-second limit with cancel, 1,000 displayed rows. |
| Answer checking | **Real**: compares what the query returns with answers computed independently from the tables. Accepts any valid query (aliases, order, joins, CTEs, subqueries). No pattern matching on query text. |
| Company, data, port delay, demand, outcomes | **Simulated**: synthetic and seeded; the company and news outlet are fictional. |
| Strategy forecast | **Simulated, transparent model** (§4): weekly per-product simulation, 400 seeded Monte Carlo runs. A teaching model, not a forecast of any real port or market. |
| Rubric and feedback | **Real, deterministic** rules over checked results and the model (§5). No AI judge. |
| Excel formulas | **Shown only** (not executed). |
| R and Python | **Shown only**, labelled "not executed in this release". |
| SAP, EViews, Power BI | **Not included and not connected.** Not claimed anywhere in the tool. |
| Portfolio storage | **Real, private, this browser only** (see §6). Not synced, not uploaded. |

## 3. Scenario data dictionary (`lib/dataset.js`)

All money in EUR; dates are ISO text (`YYYY-MM-DD`); the simulation is frozen on the **as-of date 2026-03-02** (use `mission_info.as_of_date`, never today's date). Base mission: dataset `rotterdam-v1`, seed `20260302`. Variants change products, quantities, dates, quotes and budget, not the rules.

| Table | Rows (base) | Key columns |
|---|---|---|
| `mission_info` | 1 | `as_of_date`, `horizon_weeks` (8), `emergency_budget_eur` (75% of value at risk, rounded to €5k), `antwerp_slots`, `service_target` (0.95), `holding_rate_per_year` (0.25), `markdown_rate` (0.15), `excess_cover_weeks` (6) |
| `products` | 8 | `product_id` (P-101…), `unit_value_eur` (landed cost), `gross_margin_per_unit_eur` (lost per unit not served), `weekly_demand_units`, `units_per_pallet` |
| `inventory` | 8 | `on_hand_units` (1.2–2.8 weeks of demand), `safety_stock_units`, `reorder_point_units` |
| `shipments` | 35–37 (36 in the base mission) | `status` (`arrived`, `in_transit`, `held_at_port`), `eta_date`, `actual_arrival_date`, `quantity_units` |
| `freight_invoices` | shipments + 2 | `invoice_id`, `shipment_id`, `amount_eur` |
| `reroute_options` | one per held container | `extra_cost_eur`, `arrival_days` |
| `backup_suppliers` | 2 per product | EU: +24%, 1 week; Turkey: +10%, 3 weeks |
| `warehouse` | 1 | `free_pallet_positions`, overflow €9/pallet/week, lease block and €2,400/week (8-week minimum) |

**Delayed** = not arrived and ETA before the as-of date, whatever the status says about location.

**Deliberate data-quality problems** (to detect, not blindly delete):

1. Three `arrived` shipments have a blank `actual_arrival_date`. A blank is a missing record, not a delay.
2. One held shipment's `product_id` is lower case (`p-10x`). An exact join silently drops it; normalise with `UPPER(TRIM())` or find it with a LEFT JOIN.
3. Two freight invoices were imported twice. A plain `SUM` double-counts them.
4. One vessel is past its ETA but still `in_transit` (at sea). It is delayed but cannot be rerouted.

## 4. Strategy model assumptions (`lib/model.js`, `ASSUMPTIONS`)

1. Weekly time steps from the as-of date (week 1 = days 0–6); horizon 8 weeks.
2. Delayed shipments are released together after L weeks of congestion and can be sold from week ⌊L⌋+1.
3. L follows the port's published estimate: triangular, minimum 1.5, most likely 3, maximum 7 weeks (changeable with the sliders for exploration only).
4. Shipments still at sea with a future ETA arrive on time (re-sequenced by the carrier).
5. A rerouted container arrives after its quoted `arrival_days`, for its quoted fee; only containers held at the port can be rerouted, up to the slot limit.
6. Demand = weekly demand × (1 + demand shift) × a common random factor (mean 1, s.d. 8%).
7. Unmet demand is lost; each lost unit costs `gross_margin_per_unit_eur`.
8. Emergency buys cover the chosen weeks of demand for each product still exposed after reroutes; the premium is a cost and the goods become inventory.
9. Bringing the next order forward adds 2 weeks of demand per exposed product in week 7 at normal cost.
10. Holding cost = ending stock value × 25% ÷ 52 per week; pallets above free space pay 3PL overflow; a lease adds space for a fixed weekly fee over the whole horizon.
11. Stock above 6 weeks of demand at the end of week 8 is cleared at a 15% markdown.
12. Cash used = emergency purchases at full price + reroute fees + lease + early orders; it must stay within the emergency budget.

**Decision quality** is judged with the briefing's forecast (the information available at the time), across the same 400 seeded runs for every plan. A plan is *defensible* when it breaks no constraint and no feasible reference plan is clearly better: at least 5% cheaper in expected cost with no lower chance of meeting the service target, or no more expensive with a 10-point better chance, **without needing more than 10% of the budget in extra cash**. Keeping cash is a legitimate trade-off, so several different strategies are defensible (tested on five seeds: low-cash rerouting, a small EU buy, and mixes).

## 5. Rubric (`lib/rubric.js`)

| Criterion | Points | How it is scored |
|---|---|---|
| Data and calculation correctness | 2 | Both required SQL checks pass (1 each). |
| Evidence quality and reproducibility | 2 | ≥ 2 linked items (1) including a passed SQL check (1). Dataset version, seed and queries are saved automatically. |
| Budget and operational constraints | 2 | Within budget and slots (1); meets the 95% target in ≥ half the runs, or the shortfall is explicitly accepted and explained (1). |
| Trade-offs and uncertainty | 2 | Names the delay direction in which the plan would be wrong, accepting either when they are within 20% (1); states the P90 downside cost within 10% (1). |
| Clarity of the recommendation | 2 | ≥ 25 words (1); expected cost within 5% and fill rate within 1 percentage point of the model (1). |

The **realized outcome** (one seeded draw, the same for every plan) is shown after submission with the plan's cost, fill rate and rank in hindsight. It never changes the score: a justified decision can meet bad luck, and a weak one can get lucky.

## 6. Privacy and isolation

- **Embedded in the Hub**, WhatIf runs in an iframe sandboxed **without** `allow-same-origin`: an opaque origin with no access to the Hub page, its storage, its cookies or its API. Verified in Chromium (`test/whatif-embedded.mjs`): `parent.document`, `localStorage`, `document.cookie` → SecurityError; `fetch('/api/…')` and `<img src=/api/…>` → blocked.
- **All files under `/tools/bizdata/`** are sent with a Content-Security-Policy that only allows the tool's own files, the two sql.js files, Google Fonts and `blob:` workers (`default-src 'none'`, `frame-ancestors 'self'`), plus `nosniff` and `no-referrer`. This also protects a direct visit.
- **Public routes:** the tool's files are public static files (like the Hub's own `hub.js`) and contain no data or secrets. Only `sql-wasm-browser.js` / `.wasm` are served from `node_modules`. `/api/*` returns 401 without a token (tested in `test/bridge.test.js`).
- **Student work** stays in the browser: opened directly, in the tool's own `localStorage`; embedded, the Hub keeps the tool's `bizdata-*` keys under a `tool:` prefix and answers only that iframe. Nothing is uploaded. Clearing browser data deletes records, so students should export important ones.
- Portfolios are **private**; there is no public sharing in this release. Records are titled "BizData completion record", say they are simulated exercises, and claim no accreditation or endorsement. CV bullets describe only what was done (mode, help used, checks passed, rubric).

## 7. Tests

| Test | How to run | Status |
|---|---|---|
| `test/bizdata.test.js` (14 tests: dataset, real-SQL grading with correct, alternative and wrong queries, read-only, missing data, repeatability, ≥ 2 defensible strategies, constraints, rubric, decision vs outcome, portfolio honesty, Excel bridge) | `npm test` | pass |
| `test/bridge.test.js` "WhatIf (Work tool) public routes …" | `npm test` | pass |
| `test/whatif-journey.mjs`: full student journey in Chromium, timeouts, read-only, replay, independent variant, 390 px | manual (see header) | pass |
| `test/whatif-embedded.mjs`: Hub → Work → sandboxed iframe, isolation probes, storage bridge, chat unaffected | manual (see header) | pass |

## 8. Known limitations

- The tool's own interface is English only; the Hub card and heading are bilingual.
- Colour contrast was chosen for WCAG AA but not measured with an automated checker; screen-reader testing has not been done.
- Fonts load from Google Fonts (as the Hub does).
- Records live in one browser on one device; there is no server-side backup or sync.
- Decision quality is judged against a fixed set of nine reference plans, not every possible plan.
- Fill-rate and P90 claims are compared numerically; free-text reasoning is not machine-judged (no AI judge).
- The cloud handoff (`02bff9a`) and the Mac-side Hub branch are not reconciled (see `HANDOVER.md`).

## 9. Roadmap (planned, not built)

1. Reconcile with the latest Hub sources; then Shahed reviews before any deployment.
2. More missions: finance (cash conversion, covenant headroom), accounting (accrual and invoice reconciliation), customer retention, operations; Saudi/Gulf scenarios; Arabic learning support.
3. Safe R and Python execution (for example WebR / Pyodide in a worker), added only when verified.
4. Visual data pipelines with inspectable transformations; optional timed boardroom challenges; earnings-call reviews grounded in the student's analysis; team consulting missions with roles and contribution history; instructor assignment and review.
5. Opt-in leaderboards that reward reasoning and correctness (never device speed); optional public portfolios and recruiter discovery only with explicit consent, preview, selective disclosure and unpublish.
6. Commercial models (freemium, subscriptions, institutional licences) are unvalidated ideas. If tiers are added, enforce them on the server; a front-end tier flag is presentation only.

### Later track: Everyday Economics (not started)

Personal-finance decisions (car, rent vs buy and similar) with these rules, from Shahed's corrections:

1. **Data labels:** "synthetic demo data", with currency, country, units, time period and source status shown. A handful of invented records cannot support claims about any real local market.
2. **Financed purchases:** model the down payment, loan repayments (principal plus interest), running costs and sale proceeds net of remaining debt consistently. Never charge the full purchase price *and* loan repayments without counting the loan proceeds; that double-counts the financed principal.
3. **Rent vs buy:** compare from equal starting funds, in consistent monthly periods, with complete cash flows: the down payment, purchase fees, insurance, maintenance and other ownership costs, and the terminal home value and remaining mortgage. Break-even may never occur within the chosen horizon, and the tool must say so.
4. **No right/wrong life choices:** assess the calculation, the affordability constraints and the reasoning; show ranges and trade-offs, including flexibility and personal priorities.
5. **Code is optional:** everyday users can inspect every assumption and calculation without SQL or Python, and are never blocked behind generated syntax.
6. **Privacy:** financial inputs and portfolios stay private. Share cards need a preview and explicit export, with sensitive amounts excluded by default. No invented rankings ("top 5%") or market-research claims.

The next step for this track is a tested simulation with clearly fictional inputs: no marketing, no public deployment.
