// WhatIf accessibility scan with axe-core (WCAG 2.0/2.1/2.2 A and AA rules) on every step of both tools.
// Run manually against a throwaway local Hub:
//   NPM_ROOT=$(npm root -g) WHATIF_URL=http://127.0.0.1:34570 node test/whatif-a11y.mjs
// Exits non-zero if any violation is found.
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(process.env.NPM_ROOT, "playwright"));
const axePath = require.resolve("axe-core/axe.min.js");
const base = process.env.WHATIF_URL || "http://127.0.0.1:34570";
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
p.on("dialog", (d) => d.accept());
let total = 0, checked = 0, needsReview = 0;
async function scan(label) {
  await p.addScriptTag({ path: axePath }).catch(() => {});
  const r = await p.evaluate(async () => await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } }));
  total += r.violations.length;
  const cc = r.passes.find((x) => x.id === "color-contrast");
  const review = r.incomplete.filter((x) => x.id === "color-contrast");
  if (process.env.SHOW_REVIEW) for (const x of review) for (const n of x.nodes.slice(0, 40)) console.log("   review:", n.target.join(" "), "·", (n.any[0]?.message || "").slice(0, 120));
  checked += cc ? cc.nodes.length : 0; needsReview += review.reduce((n, x) => n + x.nodes.length, 0);
  console.log(`${label}: ${r.violations.length ? r.violations.map((v) => `${v.id} (${v.impact}, ${v.nodes.length}×): ${v.nodes.slice(0, 2).map((n) => n.target.join(" ") + " " + (n.any[0]?.message || "").slice(0, 110)).join(" | ")}`).join("\n   ") : "no violations"}`);
}
// Axe needs to inject a script; the tool's CSP blocks inline scripts, so scan with CSP bypassed (rendering is unchanged).
await p.context().close().catch(() => {});
const ctx = await b.newContext({ bypassCSP: true, viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage(); page.on("dialog", (d) => d.accept());
Object.assign(p, { addScriptTag: page.addScriptTag.bind(page), evaluate: page.evaluate.bind(page) });
await page.goto(base + "/tools/bizdata/"); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForSelector(".kpi");
for (const s of ["Briefing", "Investigate", "Compare strategies", "Decide & defend"]) { await page.click(`.step-btn:has-text("${s}")`); await page.waitForTimeout(200); if (s === "Investigate") { await page.click("#runBtn"); await page.waitForSelector("#resultBox .check"); } await scan("WhatIf · " + s); }
await page.click(".kpi:nth-child(2)"); await page.waitForSelector("#lineage[open]"); await scan("WhatIf · trace dialog"); await page.keyboard.press("Escape");
await page.click('.step-btn:has-text("Review")'); await scan("WhatIf · Review (empty)");
// Filled-in review after a real submission.
await page.click('.step-btn:has-text("Investigate")');
for (const t of ["Find the delayed", "Put a value"]) { await page.click(`.task-tab:has-text("${t}")`); await page.click("#runBtn"); await page.waitForSelector("#resultBox .check"); await page.check("#resultBox input[type=checkbox]"); }
await page.click('.step-btn:has-text("Compare strategies")'); await page.click('button:has-text("Save this plan for comparison")');
await page.check('input[name=backup][value=eu]');
await page.click('.step-btn:has-text("Decide & defend")'); await page.fill("#d-rec", "Buy one week of EU cover for every exposed line so service stays near the target while most of the emergency budget stays available for a longer disruption.");
await page.fill("#d-claimedCost", "1"); await page.click("#submitBtn"); await page.waitForSelector("#h-review"); await scan("WhatIf · Review (submitted)");
await page.click('.step-btn:has-text("Portfolio")'); await scan("WhatIf · Portfolio");
await page.goto(base + "/tools/everyday/"); await page.waitForSelector(".figure"); await scan("Everyday · Car");
await page.click('.step-btn:has-text("Home")'); await page.waitForSelector("#home-homePrice"); await scan("Everyday · Home");
console.log("TOTAL violations:", total, "| colour-contrast checks passed on", checked, "elements; contrast needing manual review:", needsReview);
await b.close(); process.exit(total ? 1 : 0);
