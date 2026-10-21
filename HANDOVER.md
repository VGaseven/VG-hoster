# Handover to Codex: WhatIf (BizData Stack Sandbox) in Shahed's Hub → Work

From: Claude (Claude Code cloud session `session_015QKAdd5eRGjM3TghfoCeyV`)
To: Codex
Status: **Claude has stopped editing this branch.** It is yours to continue. Nothing has been merged or deployed.

---

## 1. Goal and latest requirements

Build **WhatIf** (working name in the code: *BizData Stack Sandbox*), a browser-based business-decision simulator, inside Shahed's Hub under **Work only** (not Uni, no multi-section support). Promise: *"Learn to make and defend business decisions with data."*

The user's full specification (the long BizData prompt in the Claude session) is the main spec. Key points:

- **No VS Code, extension, terminal, local database, R or Python for students.** Everything runs in the browser. The old VS Code extension stays only as optional legacy reference (branch `feature/biz-data-sandbox`); the browser tool must not depend on it.
- **One complete mission first: "Rotterdam Port Bottleneck"** (fictional company, synthetic data). Flow: briefing → inspect data → real SQL → trace metrics to source rows → compare ≥2 strategies under the same assumptions → see cash/cost/service/risk → submit with linked evidence and a defense → outcome-based feedback → private replayable record → fresh variant.
- **Real SQL execution in a bounded sandbox.** No regex grading, no fake success messages. Result-based checks; different valid queries accepted.
- **Decision quality separate from realized outcome.** Several strategies can be defensible. No forced single answer.
- **Three modes:** Guided / Assisted / Independent. Record the mode and assistance used; guided work must never be shown as independent mastery.
- **Data lineage:** click a KPI → source rows, filters/joins, formula, before/after, assumption effect.
- **Excel → SQL/R/Python bridge:** curated, tested mappings only; R/Python shown, not executed, and labelled.
- **Private portfolios** (no public sharing yet); "BizData completion record", no accreditation claims; CV bullets only from what was actually done.
- **Do not:** deploy, activate billing, publish profiles, overwrite unrelated branches, ask for login tokens in chat, delete the user's Notion entries.

**Later track (not started): Everyday Economics.** The user added corrections that must be followed when it is built:
1. Label data "synthetic demo data" with currency, country, units, time period and source status. Never claim anything about a real local market.
2. Financed purchases (e.g. a car): model down payment, repayments (principal + interest), running costs and sale proceeds net of remaining debt consistently. Do not charge the full price **and** loan repayments without counting loan proceeds (double-counting).
3. Rent vs buy: equal starting funds, consistent monthly periods, complete cash flows, including the down payment, fees, insurance, maintenance and terminal asset/debt values.
4. Do not grade life choices as right or wrong. Assess calculation, affordability and reasoning; show ranges and trade-offs; break-even may never occur within the horizon.
5. Code is optional for everyday users; assumptions and calculations must be inspectable without SQL/Python.
6. Financial inputs and portfolios stay private. Share cards need a preview and explicit export, with amounts excluded by default. No invented rankings ("top 5%") or market-research claims.

## 2. Branches and source status

| Item | Value |
|---|---|
| This branch | `claude/bizdata-stack-sandbox` |
| Base commit | `2ce15e4`: merge of `claude/hub-sections-inventory` (Work/Uni/… sections) into `claude/whatsapp-chat-nav` (chat list). Made by Claude, not yet reviewed by the user. |
| Earlier review branch (keep, do not deploy) | `claude/hub-work-bizdata-sandbox`: first Hub integration that framed the old VS Code sandbox under Work. Superseded by this branch for the new tool, but the user asked to keep it for review. |
| Legacy extension (keep) | `feature/biz-data-sandbox` |
| **Missing: cloud handoff** | ZIP for `codex/cloud-chat-state-slice` @ `02bff9a`. Never arrived in the Claude session; the commit is not on GitHub. **Not reconciled.** |
| **Missing: Mac-side work** | Branch `claude/hub-core-chat-implementation` (on Shahed's Mac). Not on GitHub. **Not reconciled.** |

Because of the two missing sources, this branch must **not** be called current or deployed. Reconcile first (see next steps).

## 3. What exists (relevant files)

All new tool files are static and live under `public/tools/bizdata/` (served by the existing `express.static("public")`).

| File | Purpose | State |
|---|---|---|
| `lib/prng.js` | Seeded PRNG, triangular and normal samples | Done, tested |
| `lib/dataset.js` | Synthetic Rotterdam dataset per seed (8 products, ~17 open shipments, invoices, reroute quotes, backup suppliers, warehouse), column docs, SQL loader script. Deliberate data-quality traps: 3 arrived shipments with blank arrival date, 1 lower-case product key, 2 duplicated freight invoices, 1 vessel late at sea | Done, tested |
| `lib/model.js` | Transparent weekly simulation + 400 seeded Monte Carlo draws; cash, constraints (budget, Antwerp slots), cash-aware dominance, reference plans, weak-spot (regret), realized draw | Done, tested |
| `lib/checks.js` | Three SQL tasks (delayed shipments, value at risk per product, optional deduplicated freight). Result-based grading with specific feedback | Done, tested |
| `lib/rubric.js` | 5-criterion rubric (10 points), feedback in 4 categories, decision quality vs realized outcome | Done, tested |
| `lib/portfolio.js` | Completion record, honest "demonstrated" label, CV bullets, Markdown export | Done, tested |
| `lib/bridge.js` | 4 curated Excel ↔ SQL/R/Python mappings with stated differences | Done; SQL tested |
| `sql-worker.js` | Web Worker: sql.js (SQLite WASM), fresh read-only DB per run, 1,000-row cap, friendly errors | Written, **not run in a browser yet** |
| `app.js` | Whole UI: KPI strip with lineage dialogs, steps (Briefing, Investigate, Compare strategies, Decide & defend, Review, Portfolio), SQL workbench (predict → run → explain), spreadsheet filters, strategy builder + chart, defense gate, review, portfolio replay/export | Written, **syntax-checked only, never loaded in a browser** |
| `index.html` | Page shell | Written, untested in a browser |
| `test/bizdata.test.js` | 14 Node tests using real SQLite (sql.js) | **14/14 pass** |
| `package.json` / lock | Adds `sql.js@1.15.1` dependency | Installed, 0 vulnerabilities |
| `.gitignore` | Exception so `public/tools/bizdata/lib/` is tracked (the root `lib/` Python rule was hiding it) | Done |

### Not yet created (the page will not work until these exist)

1. **`public/tools/bizdata/app.css`**: no stylesheet yet. The page will render unstyled.
2. **Vendor files for the worker:** `public/tools/bizdata/vendor/` is empty. The worker calls `importScripts("vendor/sql-wasm-browser.js")` and loads `vendor/sql-wasm-browser.wasm`. Planned approach: add two explicit routes in `server.js` that send `node_modules/sql.js/dist/sql-wasm-browser.js` and `.wasm` (do not expose the whole `node_modules`). Copying the two files into `vendor/` also works but adds about 650 KB to git.
3. **Hub wiring under Work:** nothing in `public/hub.js` or `public/index.html` points to the new tool yet on this branch. The working pattern exists on `claude/hub-work-bizdata-sandbox` (commit `e6f7c5e`): a `TOOLS` registry in `hub.js`, a Tool card at the top of the Work section, a `#tool=<id>` route, a `<section id="tool">` with an `<iframe src="/tools/bizdata/">`, a "Chat with the team about it" button linking to the Work group chat, and a `toolChat` label fix (set the text in JS because `translate()` runs before late strings exist). Port that pattern; do **not** port its `biz-data-sandbox/media` route (the new tool must not depend on the extension).
4. **`docs/BIZDATA_STACK_SANDBOX.md`:** scenario data dictionary, assumptions (already in `lib/model.js` `ASSUMPTIONS`), rubric, and the execution-vs-simulation table.
5. **Browser end-to-end test** of the full student journey, keyboard and phone widths.

## 4. Install, run and test

```bash
git fetch origin claude/bizdata-stack-sandbox
git checkout claude/bizdata-stack-sandbox
npm ci                                 # installs express, sql.js, …
node --test test/bizdata.test.js       # tool tests only (fast)
npm test                               # whole suite (Hub + tool)
node scripts/version-hub-assets.mjs    # required after ANY change to public/hub.js or public/hub.css
```

Local run (throwaway data; never point at the live Hub database):

```bash
mkdir -p /tmp/hubtest
BRIDGE_TOKEN=<any local test value> DB_FILE=/tmp/hubtest/b.db HOME=/tmp/hubtest \
  BRIDGE_DIR=/tmp/hubtest WORK_DIR=/tmp/hubtest/w TRUST_PROXY=0 PORT=3000 node server.js
# Hub:  http://localhost:3000/        Tool directly: http://localhost:3000/tools/bizdata/
```

## 5. Test results (actually run, in the Claude container, Node 22.22.0)

| Suite | Result |
|---|---|
| `node --test test/bizdata.test.js` | **14 / 14 pass** |
| `npm test` (39 Hub tests + 14 tool tests) | **53 / 53 pass** |
| `node --check` on `app.js`, `sql-worker.js`, all `lib/*.js` | pass (syntax only) |
| Browser test of the new tool | **not run** (no CSS, no vendor route, no Hub wiring yet) |
| Keyboard / responsive / reduced-motion checks | **not run** |

What the 14 tool tests prove: deterministic seeds; data traps present; dataset loads into real SQLite; every reference query passes on the base mission and 3 variants; alternative valid queries pass; wrong analyses fail with specific messages (blank date ≠ late, late vessel at sea, missing days-late column, exact join drops the lower-case key, duplicate invoices); student SQL cannot write (read-only); missing data handled in the model; repeatable results; ≥2 strategy families defensible on 5 seeds and no reference plan below 80% fill; budget and slot constraints; full-mark defense vs weak defense vs over-budget; decision credit independent of the realized draw; portfolio honesty (guided ≠ independent, no credential language); Excel bridge SQL runs.

## 6. Decisions, known issues, and things not to change

- **SQL runs only in the student's browser** (Web Worker + WASM), never on the Hub server. The worker receives only the mission tables. Keep it that way. Every run builds a fresh in-memory DB with `PRAGMA query_only = ON`; the page terminates and respawns the worker after 4 s (cancel and reset).
- **Grading is result-based** (`lib/checks.js`). Expected answers are computed in JavaScript from the tables, independently of the reference SQL. Don't replace this with pattern matching on query text.
- **Decision judgement uses the briefing forecast** (`DEFAULT_ASSUMPTIONS`), not the student's sliders. The realized outcome is one seeded draw shared by all plans and is never scored.
- **Dominance is cash-aware** (`dominates()` in `lib/model.js`): keeping cash is a legitimate trade-off. This is what makes several strategies defensible. If you retune numbers, keep the test "at least two different kinds of strategy are defensible" passing.
- **The dataset uses Fisher–Yates shuffling**, not a random `sort()` comparator; the latter gives different scenarios in different browsers.
- **Data is synthetic and the company is fictional** (Kestrel Home Goods B.V.; "Port Ledger Daily" is a fictional outlet). Keep the "Simulated" labels.
- **Root `.gitignore` has `lib/`** (Python leftovers). The exception `!public/tools/bizdata/lib/` must stay, or the core modules disappear from commits.
- **Known gap in `app.js`:** `submit()` builds the record's query list with an index-mismatch risk (`.filter(Boolean)` before mapping to `CHECKS[i]`). If a task was never run, labels can shift. Fix by mapping over `CHECKS` first and then filtering.
- **Known gap:** `app.js` has not been exercised, so expect runtime bugs on first load.
- **Isolation of the iframe (planned, unverified):** the tool is same-origin with the Hub. Student SQL never runs as JavaScript, so it cannot read Hub storage. The tool's JavaScript itself does not call `/api/*`. A test for "no `/api/` in tool files" and a check of the public routes are still to be added. Tool files are public static files (like the Hub's own `hub.js`) and must contain no data or secrets.
- **Do not:** deploy; merge into `master` or the Mac's running branch; force-push; delete `claude/hub-work-bizdata-sandbox`, `feature/biz-data-sandbox` or the user's Notion entries; ask Shahed for tokens in chat.

## 7. Exact next steps for Codex

1. **First action:** check out `claude/bizdata-stack-sandbox`, run `npm ci && npm test`, and confirm 53/53 pass on your machine.
2. Obtain and inspect the cloud handoff ZIP (`codex/cloud-chat-state-slice`, `02bff9a`: README, git bundle, patch, feature inventory) and the Mac branch `claude/hub-core-chat-implementation`. Decide the true Hub baseline. Rebase or merge this tool onto it **without overwriting** chat work (the tool is self-contained under `public/tools/bizdata/` plus a small `hub.js` / `index.html` / `hub.css` change).
3. Add the two `sql.js` vendor routes in `server.js` and a Node test that they return 200 with the right content types.
4. Write `public/tools/bizdata/app.css` (Hub look: lavender `#f6f2ff` page, white cards, plum text `#3b3355`, accent `#7b5cd6`, Nunito / Baloo 2; light only; responsive; visible focus; `prefers-reduced-motion`).
5. Load `/tools/bizdata/` in a browser and fix runtime bugs. Then run the full journey: guided run → both checks pass → compare 2 plans → link evidence → submit → review → portfolio replay "verified" → fresh variant in independent mode. Also check timeouts and cancel (e.g. `WITH RECURSIVE r(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM r) SELECT * FROM r`), keyboard-only use, and 390 px width.
6. Wire the tool into Hub → Work using the pattern from `claude/hub-work-bizdata-sandbox` (section 3, item 3). Run `node scripts/version-hub-assets.mjs`.
7. Add `docs/BIZDATA_STACK_SANDBOX.md` and a README section: what exists, what executes, what is simulated, what is planned.
8. Audit against the full BizData spec and report real vs simulated vs missing. Verify public routes expose no Hub data (`/api/*` must return 401 without a token).
9. Only then start the Everyday Economics track, following the corrections in section 1.
10. Commit and push after each milestone and keep this file updated. Do not deploy without Shahed's separate approval.
