// WhatIf in Arabic: RTL layout, translated screens and feedback, LTR code/data, axe scan, language switch.
// Run manually against a throwaway local Hub: NPM_ROOT=$(npm root -g) node test/whatif-arabic.mjs <screenshot-dir>
// "english words left" lists Latin words outside code/IDs; remaining ones should be data values (table/column/status/supplier names).
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(process.env.NPM_ROOT, "playwright"));
const base = process.env.WHATIF_URL || "http://127.0.0.1:34570", out = process.argv[2] || ".";
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, bypassCSP: true }); const p = await ctx.newPage();
const errors = []; p.on("pageerror", e => errors.push(e.message)); p.on("console", m => m.type() === "error" && errors.push(m.text())); p.on("dialog", d => d.accept());
const log = (...a) => console.log(...a);
const latin = async (sel) => (await p.$$eval(sel, (els) => els.map((e) => e.innerText).join(" "))).replace(/[A-Z_]{2,}[\w-]*|[a-z_]+_[a-z_]+|SH-\d+|P-\d+|SQL|SQLite|Excel|R|Python|pandas|dplyr|WebAssembly|sql\.js|SAP|EViews|Power BI|BizData|Kestrel Home Goods B\.V\.|Brabant Home Supply|Izmir Home Partners|P10|P90|ETA|\bVAL\b|JSON|Markdown|English|Ctrl|Enter|Esc|Tab|COUNTIFS|SUMIFS|julianday|CV|EU|TR|DC/g, "").match(/[A-Za-z]{4,}/g) || [];
await p.goto(base + "/tools/bizdata/?lang=ar"); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector(".kpi");
log("dir:", await p.evaluate(() => document.documentElement.dir), "| h1:", await p.textContent("h1"), "| steps:", await p.$$eval(".step-btn", (b) => b.map((x) => x.innerText.replace(/\n/g, " ")).join(" | ")));
log("english words left on briefing:", [...new Set(await latin("main, header, .kpis"))].slice(0, 15).join(", ") || "none");
await p.click('.step-btn:has-text("التحقيق")'); await p.click("#runBtn"); await p.waitForSelector("#resultBox .check");
log("check msg:", (await p.textContent("#resultBox .check strong")));
log("editor dir:", await p.getAttribute("#editor", "dir"), "| data table dir:", await p.$eval("#resultBox .table-wrap", (e) => e.getAttribute("dir")));
log("english words left on investigate:", [...new Set(await latin("#step-evidence"))].slice(0, 20).join(", ") || "none");
await p.click('.task-tab:has-text("قدّر")'); await p.fill("#editor", "SELECT p.product_id, SUM(s.quantity_units*p.unit_value_eur) FROM shipments s JOIN products p ON p.product_id = s.product_id WHERE s.status <> 'arrived' AND s.eta_date < '2026-03-02' GROUP BY 1"); await p.click("#runBtn"); await p.waitForSelector("#resultBox .check");
log("wrong-join feedback:", (await p.textContent("#resultBox .check li")).slice(0, 120));
await p.screenshot({ path: out + "/ar-investigate.png", fullPage: false });
await p.click('.step-btn:has-text("مقارنة")'); await p.click('button:has-text("احفظ هذه الخطة")'); await p.check('input[name=backup][value=eu]');
log("english words left on strategy:", [...new Set(await latin("#step-strategy"))].slice(0, 20).join(", ") || "none");
await p.screenshot({ path: out + "/ar-strategy.png", fullPage: true });
await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
const ax = await p.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations.map((v) => v.id + ":" + v.nodes.length));
log("axe (Arabic, strategy):", ax.length ? ax : "no violations");
await p.setViewportSize({ width: 390, height: 844 }); log("phone overflow px:", await p.evaluate(() => document.documentElement.scrollWidth - innerWidth));
// Everyday in Arabic
await p.setViewportSize({ width: 1280, height: 900 });
await p.goto(base + "/tools/everyday/?lang=ar"); await p.waitForSelector(".figure");
log("everyday dir:", await p.evaluate(() => document.documentElement.dir), "| first figure:", (await p.textContent(".figure")).replace(/\s+/g, " "));
log("english words left on everyday car:", [...new Set(await latin("main, header, #demoLabel"))].slice(0, 15).join(", ") || "none");
await p.click('.step-btn:has-text("المنزل")'); await p.waitForSelector("#home-homePrice");
log("english words left on everyday home:", [...new Set(await latin("main"))].slice(0, 15).join(", ") || "none");
await p.check("text=مرونة الانتقال"); log("share card:", (await p.textContent("#sharePreview")).replace(/\n/g, " / ").slice(0, 200));
await p.screenshot({ path: out + "/ar-everyday.png", fullPage: true });
// Switch back via the in-tool button
await p.click("#langBtn"); await p.waitForSelector(".figure"); log("after switch:", await p.evaluate(() => document.documentElement.dir), await p.textContent("h1"), "| priority kept:", await p.isChecked("text=Flexibility to move"));
log("errors:", errors.length ? errors : "none"); await b.close();
