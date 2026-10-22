// WhatIf / BizData Stack Sandbox: full student journey in a real browser (Chromium via Playwright).
// Run manually against a throwaway local Hub (see HANDOVER.md §4), never the live Hub:
//   NPM_ROOT=$(npm root -g) WHATIF_URL=http://127.0.0.1:34570 node test/whatif-journey.mjs <screenshot-dir>
// Prints each stage; "errors: none" at the end means no page or console errors.
import path from "node:path";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(path.join(process.env.NPM_ROOT, "playwright"));
const out = process.argv[2] || ".", base = process.env.WHATIF_URL || "http://127.0.0.1:34570";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const p = await ctx.newPage();
const errors = []; p.on("pageerror", e => errors.push("pageerror: " + e.message)); p.on("console", m => m.type() === "error" && errors.push("console: " + m.text()));
p.on("dialog", d => d.accept());
const log = (...a) => console.log(...a);
const step = async (name) => { await p.click(`.step-btn:has-text("${name}")`); await p.waitForTimeout(150); };
const runTask = async (title, predict) => {
  await p.click(`.task-tab:has-text("${title}")`);
  if (predict) await p.fill("#predict", predict);
  await p.click("#runBtn");
  await p.waitForSelector("#resultBox .check, #resultBox .result.error", { timeout: 15000 });
  return (await p.textContent("#resultBox")).replace(/\s+/g, " ").slice(0, 160);
};
await p.goto(base + "/tools/bizdata/"); await p.evaluate(() => localStorage.clear()); await p.reload();

// 1. Investigate (guided)
await step("Investigate");
log("spreadsheet filters:", await p.isVisible(".filters"), "| sumifs:", (await p.textContent("#sumifs")).slice(0, 40));
log("delayed:", await runTask("Find the delayed shipments", "13"));
await p.fill("#explain", "Thirteen shipments are late, so several product lines will run short within two weeks.");
await p.check("#resultBox input[type=checkbox]");
log("exposure:", await runTask("Put a value on the exposure", "€110k"));
await p.check("#resultBox input[type=checkbox]");
log("freight:", await runTask("Data quality: freight", ""));
log("KPI value at risk now:", (await p.textContent(".kpi:nth-child(2) .kpi-value")));
// Lineage
await p.click(".kpi:nth-child(2)"); await p.waitForSelector("#lineage[open]");
log("lineage sections:", await p.$$eval("#lineageBody h3", h => h.map(x => x.textContent).join(" | ")));
await p.click("#closeLineage");

// 2. Sandbox safety: write attempt, runaway query, recovery
await p.click('.task-tab:has-text("Find the delayed")');
await p.fill("#editor", "DELETE FROM shipments;"); await p.click("#runBtn"); await p.waitForSelector("#resultBox .result.error");
log("write attempt:", (await p.textContent("#resultBox")).slice(0, 90));
await p.fill("#editor", "WITH RECURSIVE r(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM r) SELECT count(*) FROM r;");
const t0 = Date.now(); await p.click("#runBtn"); await p.waitForSelector("#resultBox .result.error", { timeout: 15000 });
log("runaway:", (await p.textContent("#resultBox")).slice(0, 80), `(${Date.now() - t0} ms)`);
await p.click('button:has-text("Reset query")');
// Keyboard: focus editor and press Ctrl+Enter
await p.focus("#editor"); await p.keyboard.press("Control+Enter");
await p.waitForSelector("#resultBox .check", { timeout: 15000 });
log("after reset + Ctrl+Enter:", (await p.textContent("#resultBox .check")).slice(0, 60));

// 3. Compare strategies
await step("Compare strategies");
const boxes = await p.$$(".reroute input"); for (const bx of boxes.slice(0, 2)) await bx.check();
await p.check('input[name=backup][value=eu]');
await p.click('button:has-text("Save this plan for comparison")');
await p.click('button:has-text("Clear plan")');
for (const bx of (await p.$$(".reroute input")).slice(0, 4)) await bx.check();
await p.click('button:has-text("Save this plan for comparison")');
// current plan = option B (4 reroutes); then go back to plan A: 2 reroutes + EU 1 wk
await p.click('button:has-text("Clear plan")');
for (const bx of (await p.$$(".reroute input")).slice(0, 2)) await bx.check();
await p.check('input[name=backup][value=eu]');
const rows = await p.$$eval("#forecast tbody tr", rs => rs.map(r => [...r.children].map(c => c.textContent)));
log("comparison rows:", rows.map(r => `${r[0]} ${r[1]} cost ${r[3]} fill ${r[5]} svc ${r[6]} ${r[8]}`).join(" || "));
await p.check("#forecast input[type=checkbox]");
await p.screenshot({ path: out + "/strategy.png", fullPage: true });
const now = rows.find(r => r[0] === "Now");
const num = (s) => Number(s.replace(/[^0-9.]/g, ""));

// 4. Decide & defend
await step("Decide & defend");
log("gate before:", await p.$$eval("#gate li", l => l.map(x => x.className).join(",")), "| submit disabled:", await p.isDisabled("#submitBtn"));
await p.fill("#d-rec", "Reroute the two most valuable held containers through Antwerp and buy one week of EU cover for the remaining exposed lines, keeping cash in reserve in case the port backlog lasts longer than forecast.");
await p.fill("#d-claimedCost", String(num(now[3])));
await p.fill("#d-claimedFillPct", String(num(now[5])));
await p.fill("#d-claimedP90", String(num(now[4].split("–")[1])));
await p.check('input[name=weak][value=longer]');
log("gate after:", await p.$$eval("#gate li", l => l.map(x => x.className).join(",")), "| submit disabled:", await p.isDisabled("#submitBtn"));
await p.click("#submitBtn");
await p.waitForSelector("#h-review");
log("review:", (await p.textContent("#step-review h3")), "|", (await p.textContent(".verdict")).slice(0, 60));
log("feedback counts:", await p.$$eval(".fb h4", h => h.map(x => x.textContent).join(" | ")));
log("outcome:", (await p.textContent("#step-review .card:nth-child(2) p:nth-of-type(3)")).slice(0, 140));
await p.screenshot({ path: out + "/review.png", fullPage: true });

log("live:", await p.textContent("#live"), "| stored:", await p.evaluate(() => { try { return (JSON.parse(localStorage.getItem("bizdata-portfolio")) || []).length; } catch (e) { return "parse error " + e.message; } }));
log("store test:", await p.evaluate(() => { try { localStorage.setItem("x", "1"); return "ok " + JSON.stringify(localStorage).length; } catch (e) { return e.name + ": " + e.message; } }));
// 5. Portfolio
await p.click('button:has-text("Open my portfolio")'); await p.waitForTimeout(500);
log("errors at portfolio:", errors); log("portfolio:", (await p.innerText("#step-portfolio")).slice(0, 700));
log("record:", (await p.textContent(".record p")).slice(0, 140));
log("cv:", (await p.inputValue(".record textarea")).split("\n")[0].slice(0, 120));
await p.click('button:has-text("Replay and verify")');
await p.waitForFunction(() => document.querySelector(".replay")?.textContent.length > 15, null, { timeout: 20000 });
log("replay:", await p.textContent(".replay"));
const [dl] = await Promise.all([p.waitForEvent("download"), p.click('button:has-text("Export Markdown")')]);
log("export:", dl.suggestedFilename());

// 6. Persistence across reload
await p.reload(); await p.waitForTimeout(800);
log("after reload step:", await p.textContent("[aria-current=step]"), "| records:", await p.$$eval(".record", r => r.length));

// 7. Independent fresh variant
await p.check('input[name=mode][value=independent]');
await step("Briefing"); await p.click('button:has-text("fresh variant")'); await p.waitForTimeout(300);
log("sim note:", (await p.textContent("#simNote")).slice(0, 100));
await step("Investigate");
log("independent editor:", JSON.stringify((await p.inputValue("#editor")).slice(0, 60)), "| hint buttons:", await p.$$eval('button', bs => bs.filter(b => /Hint|reference/.test(b.textContent)).length), "| filters shown:", await p.isVisible(".filters"));

// 8. Phone width, every step
await p.setViewportSize({ width: 390, height: 844 });
for (const s of ["Briefing", "Investigate", "Compare strategies", "Decide & defend", "Review", "Portfolio"]) {
  await step(s); const o = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 0) log("overflow at", s, o, "px");
}
await step("Compare strategies"); await p.screenshot({ path: out + "/phone-strategy.png", fullPage: false });
log("phone check done");
log("errors:", errors.length ? errors : "none");
await b.close();
