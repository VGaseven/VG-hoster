# Handover to Codex: WhatIf (BizData Stack Sandbox) in Shahed's Hub → Work

From: Claude (Claude Code cloud session `session_015QKAdd5eRGjM3TghfoCeyV`)
To: Codex
Status: **Claude is still working on this branch.** This letter is a safety net, kept current at every checkpoint in case Claude hits its usage limit. Codex: take over only if Shahed says Claude has stopped, to avoid overlapping edits. Nothing has been merged or deployed.

Last checkpoint: milestone 6 (Everyday Economics screen in Hub → Work; shared storage module). Plan for the rest of this run: 7 accessibility (automated contrast), 8 Arabic in the tools, 9 Mission 2, 10 Python/R in the browser.

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
| `sql-worker.js` | Web Worker: sql.js (SQLite WASM), fresh read-only DB per run, 1,000-row cap, friendly errors | **Browser-tested** (read-only refusal, 4 s timeout, reset) |
| `app.js` | Whole UI: KPI strip with lineage dialogs, steps (Briefing, Investigate, Compare strategies, Decide & defend, Review, Portfolio), SQL workbench (predict → run → explain), spreadsheet filters, strategy builder + chart, defense gate, review, portfolio replay/export | **Browser-tested end to end** (§5) |
| `index.html`, `app.css` | Page shell; Hub-look stylesheet (light, responsive, visible focus, reduced motion) | **Browser-tested** at 1280 px and 390 px |
| `server.js` | Two explicit routes serve `node_modules/sql.js/dist/sql-wasm-browser.{js,wasm}` at `/tools/bizdata/vendor/` (nothing else from node_modules) | Done |
| `test/whatif-journey.mjs` | Manual browser test of the full student journey (Playwright + Chromium) | Passes (§5) |
| `test/bizdata.test.js` | 14 Node tests using real SQLite (sql.js) | **14/14 pass** |
| `package.json` / lock | Adds `sql.js@1.15.1` dependency | Installed, 0 vulnerabilities |
| `.gitignore` | Exception so `public/tools/bizdata/lib/` is tracked (the root `lib/` Python rule was hiding it) | Done |

### Not yet done

1. *(done in milestone 1: `app.css`)*
2. *(done in milestone 1: vendor routes in `server.js`)*
3. *(done in milestone 3)* **Hub wiring under Work.** Ported from `claude/hub-work-bizdata-sandbox` without its extension route: `TOOLS` registry in `public/hub.js` (WhatIf, section `work` only), Tool card at the top of Work and in project search, `#tool=bizdata` route, `<section id="tool">` with a **sandboxed** iframe, "Chat with the team about it" → Work group chat, English/Arabic heading. Original note kept below for history:
   Nothing in `public/hub.js` or `public/index.html` pointed to the new tool before milestone 3. The working pattern exists on `claude/hub-work-bizdata-sandbox` (commit `e6f7c5e`): a `TOOLS` registry in `hub.js`, a Tool card at the top of the Work section, a `#tool=<id>` route, a `<section id="tool">` with an `<iframe src="/tools/bizdata/">`, a "Chat with the team about it" button linking to the Work group chat, and a `toolChat` label fix (set the text in JS because `translate()` runs before late strings exist). Port that pattern; do **not** port its `biz-data-sandbox/media` route (the new tool must not depend on the extension).
4. *(done in milestone 4)* **`docs/WHATIF.md`**: what exists, executes vs simulated, data dictionary, assumptions, rubric, privacy and isolation, limitations, roadmap including Everyday Economics with Shahed's six corrections. README section added.
5. *(done)* Browser end-to-end tests (`test/whatif-journey.mjs`, `test/whatif-embedded.mjs`) and a keyboard pass.

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
| `npm test` (Hub + WhatIf + Everyday Economics) | **61 / 61 pass** at milestone 5 (earlier: 53 at milestone 1, 54 at milestone 3) |
| `node --check` on `app.js`, `sql-worker.js`, all `lib/*.js` | pass (syntax only) |
| `test/whatif-journey.mjs` in Chromium (tool opened directly at `/tools/bizdata/`, local throwaway server) | **passes, no page or console errors.** Covered: guided SQL for all 3 tasks with checks passing; KPI trace dialog; `DELETE` refused as read-only; endless recursive query stopped after ~4.3 s, then reset and Ctrl+Enter run works; two plans saved and compared; submit gate blocks until complete; review 9/10 (one deliberate wrong weak-spot answer), decision "defensible", outcome shown separately; record saved; replay re-ran the saved SQL and reproduced score and outcome; Markdown export; state survives reload; independent fresh variant has blank editor, no hints, no spreadsheet helper; no horizontal scroll at 390 px on all six steps |
| Keyboard (milestone 4, Chromium) | **pass**: first Tab reaches "Skip to the mission" (fixed: focus was moved to the heading on load); visible focus ring on every tabbed control; KPI trace opens with Enter, closes with Esc and focus returns to the KPI; steps by Enter; checkbox by Space, radio by arrow keys, slider by arrow keys; Ctrl+Enter runs SQL |
| Reduced motion | **pass**: with `prefers-reduced-motion: reduce`, buttons report no transitions |
| Screen reader, automated contrast checker | **not run** |
| `test/whatif-embedded.mjs` (Hub → Work → tool in the sandboxed iframe, local throwaway server) | **passes**: Work shows the WhatIf card, Uni does not; SQL passes inside the frame; all isolation probes blocked; progress survives a Hub reload via the bridge; the Work chat still posts messages |
| Known flake | Once, `npm test` showed 28 Hub failures while an extra local server and Chromium were starting in the same container; the Hub tests wait at most 10 s for their server. Immediately re-run: 53/53, twice. No code change involved. |

What the 14 tool tests prove: deterministic seeds; data traps present; dataset loads into real SQLite; every reference query passes on the base mission and 3 variants; alternative valid queries pass; wrong analyses fail with specific messages (blank date ≠ late, late vessel at sea, missing days-late column, exact join drops the lower-case key, duplicate invoices); student SQL cannot write (read-only); missing data handled in the model; repeatable results; ≥2 strategy families defensible on 5 seeds and no reference plan below 80% fill; budget and slot constraints; full-mark defense vs weak defense vs over-budget; decision credit independent of the realized draw; portfolio honesty (guided ≠ independent, no credential language); Excel bridge SQL runs.

### Isolation design (milestone 3, verified by `test/whatif-embedded.mjs`)

- The Hub embeds the tool with `sandbox="allow-scripts allow-downloads allow-modals"` and **no `allow-same-origin`**: the tool runs with an opaque origin and cannot read the Hub page, its storage, its cookies, or call `/api` with the Hub's "remember this device" cookie.
- `server.js` sends, for everything under `/tools/bizdata/`: a Content-Security-Policy that only allows the tool's own files, the two sql.js files (`connect-src …/tools/bizdata/vendor/`), Google Fonts and `blob:` workers (`default-src 'none'`, `frame-ancestors 'self'`); `Access-Control-Allow-Origin: *` (needed for an opaque-origin frame to load public static files; no credentials); `nosniff`; `no-referrer`. The CSP also protects a direct visit to `/tools/bizdata/`.
- The SQL worker starts from a small blob bootstrap (`app.js`, `Sandbox.spawn`) and uses absolute URLs (`WHATIF_BASE` in `sql-worker.js`), because a sandboxed page cannot start a same-site worker directly.
- Storage: opened directly, the tool uses its own `localStorage`. Embedded, it has none, so the Hub keeps its `bizdata-*` keys under a `tool:` prefix (`public/hub.js`, "WhatIf storage"). The Hub only answers messages from that iframe's window and only for `bizdata-*` keys; the tool cannot read or write Hub keys.
- Probe results (Chromium): origin `null`; `parent.document`, `localStorage`, `document.cookie` → SecurityError; `fetch('/api/projects')` and `/api/chats` → blocked by CSP; `<img src=/api/projects>` → blocked; bridge write to `hub-language` → ignored; no Hub chat or project text visible.
- Node test `test/bridge.test.js` ("WhatIf (Work tool) public routes …"): tool page and the two sql.js files are 200 with the right types; other `node_modules` paths and traversal attempts are not 200; tool files contain no `/api/`, `fetch(` or Hub storage reads; `/api/projects`, `/api/chats`, `/api/project-meta` return 401 without a token.

## 6. Decisions, known issues, and things not to change

- **SQL runs only in the student's browser** (Web Worker + WASM), never on the Hub server. The worker receives only the mission tables. Keep it that way. Every run builds a fresh in-memory DB with `PRAGMA query_only = ON`; the page terminates and respawns the worker after 4 s (cancel and reset).
- **Grading is result-based** (`lib/checks.js`). Expected answers are computed in JavaScript from the tables, independently of the reference SQL. Don't replace this with pattern matching on query text.
- **Decision judgement uses the briefing forecast** (`DEFAULT_ASSUMPTIONS`), not the student's sliders. The realized outcome is one seeded draw shared by all plans and is never scored.
- **Dominance is cash-aware** (`dominates()` in `lib/model.js`): keeping cash is a legitimate trade-off. This is what makes several strategies defensible. If you retune numbers, keep the test "at least two different kinds of strategy are defensible" passing.
- **The dataset uses Fisher–Yates shuffling**, not a random `sort()` comparator; the latter gives different scenarios in different browsers.
- **Data is synthetic and the company is fictional** (Kestrel Home Goods B.V.; "Port Ledger Daily" is a fictional outlet). Keep the "Simulated" labels.
- **Root `.gitignore` has `lib/`** (Python leftovers). The exception `!public/tools/bizdata/lib/` must stay, or the core modules disappear from commits.
- *(fixed)* `submit()` query-list index mismatch; portfolio cards rendered as "[object HTMLElement]" (`replaceChildren` does not flatten arrays; use spread); active step button unreadable on hover; chart labels clipped.
- **Isolation of the iframe (planned, unverified):** the tool is same-origin with the Hub. Student SQL never runs as JavaScript, so it cannot read Hub storage. The tool's JavaScript itself does not call `/api/*`. A test for "no `/api/` in tool files" and a check of the public routes are still to be added. Tool files are public static files (like the Hub's own `hub.js`) and must contain no data or secrets.
- **Do not:** deploy; merge into `master` or the Mac's running branch; force-push; delete `claude/hub-work-bizdata-sandbox`, `feature/biz-data-sandbox` or the user's Notion entries; ask Shahed for tokens in chat.

## 7. Exact next steps for Codex

1. **First action:** check out `claude/bizdata-stack-sandbox`, run `npm ci && npm test`, and confirm 53/53 pass on your machine. Then start a local server (§4) and run `test/whatif-journey.mjs`.
2. Obtain and inspect the cloud handoff ZIP (`codex/cloud-chat-state-slice`, `02bff9a`: README, git bundle, patch, feature inventory) and the Mac branch `claude/hub-core-chat-implementation`. Decide the true Hub baseline. Rebase or merge this tool onto it **without overwriting** chat work (the tool is self-contained under `public/tools/bizdata/` plus a small `hub.js` / `index.html` / `hub.css` change).
3. *(done)* vendor routes. Still to add: a Node test that they return 200 with the right content types.
4. *(done)* `app.css`.
5. *(done)* browser journey. Still to do: full keyboard-only pass and reduced-motion check.
6. *(done)* Hub → Work wiring with a sandboxed iframe (§3 isolation design).
7. *(done)* `docs/WHATIF.md` and README section.
8. Audit against the full BizData spec and report real vs simulated vs missing. *(Public-route and iframe isolation checks are done and tested.)*
9. Everyday Economics: *(milestone 6: screen done at `/tools/everyday/`, Hub card under Work, `test/everyday-ui.mjs` passes; shared storage in `public/tools/shared/store.js`; Hub bridge allows the open tool's own prefix only; CSP now covers all of `/tools/`)*. *(milestone 5)* simulation core `public/tools/everyday/lib/finance.js` + `test/everyday.test.js` (7 pass). Next: a code-optional screen (every assumption and cash flow visible), ranges, private share cards with amounts excluded by default. Not in the Hub yet. `.gitignore` has `!public/tools/everyday/lib/` for the same `lib/` reason.
10. Commit and push after each milestone and keep this file updated. Do not deploy without Shahed's separate approval.
