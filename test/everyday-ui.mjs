// WhatIf · Everyday money: browser test of both calculators, share card privacy, persistence, phone width.
// Run manually against a throwaway local Hub (see HANDOVER.md §4):
//   NPM_ROOT=$(npm root -g) WHATIF_URL=http://127.0.0.1:34570 node test/everyday-ui.mjs <screenshot-dir>
import path from "node:path";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(path.join(process.env.NPM_ROOT, "playwright"));
const base = process.env.WHATIF_URL || "http://127.0.0.1:34570", out = process.argv[2] || ".";
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true }); const p = await ctx.newPage();
const errors = []; p.on("pageerror", e => errors.push(e.message)); p.on("console", m => m.type() === "error" && errors.push(m.text()));
const log = (...a) => console.log(...a);
await p.goto(base + "/tools/everyday/"); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector(".figure");
log("demo label:", (await p.textContent("#demoLabel")).slice(0, 90));
log("car figures:", await p.$$eval(".figure", fs => fs.map(f => f.innerText.replace(/\n/g, ": ")).join(" | ")));
log("car callout:", (await p.textContent(".no-verdict")).slice(0, 200));
// Change an assumption: zero interest and zero return -> both end the same.
await p.fill("#car-annualRate", "0"); await p.fill("#car-investReturnYear", "0");
log("zero rate & return:", (await p.textContent(".no-verdict")).match(/Both end the same|ends [^.]+ahead/)?.[0]);
await p.fill("#car-annualRate", "abc").catch(() => {}); 
await p.fill("#car-termMonths", "0"); log("invalid input flagged:", await p.getAttribute("#car-termMonths", "aria-invalid"));
await p.click('button:has-text("Restore the example values")');
// Share card: amounts hidden by default
const prev = await p.textContent("#sharePreview");
log("share (default):", prev.replace(/\n/g, " / "));
log("share has amounts by default:", /\d[\d,]* VAL/.test(prev));
await p.check("#includeAmounts"); log("share with amounts:", /\d[\d,]* VAL/.test(await p.textContent("#sharePreview")));
const [dl] = await Promise.all([p.waitForEvent("download"), p.click('button:has-text("Download share card")')]); log("download:", dl.suggestedFilename());
// Home tab
await p.click('.step-btn:has-text("Home")'); await p.waitForSelector("#home-homePrice");
log("home figures:", await p.$$eval(".figure", fs => fs.map(f => f.innerText.replace(/\n/g, ": ")).join(" | ")));
log("affordability:", (await p.textContent("#results .callout")).slice(0, 140));
log("range rows:", await p.$$eval("#results table tbody tr", r => r.length));
await p.fill("#home-months", "24"); log("24 months break-even:", await p.$$eval(".figure", fs => fs.find(f => f.innerText.startsWith("Break-even")).innerText.replace(/\n/g, ": ")));
await p.fill("#home-startingFunds", "20000"); log("not enough savings:", (await p.textContent("#results")).slice(0, 120));
await p.fill("#home-startingFunds", "70000"); await p.fill("#home-months", "120");
await p.check('text=Flexibility to move'); log("share mentions priority:", (await p.textContent("#sharePreview")).includes("Flexibility"));
await p.fill("#note", "PRIVATE NOTE"); log("private note kept out of card:", !(await p.textContent("#sharePreview")).includes("PRIVATE NOTE"));
await p.reload(); await p.waitForSelector(".figure");
log("after reload tab & priority kept:", await p.textContent("[aria-current=page]"), await p.isChecked('text=Flexibility to move'));
await p.screenshot({ path: out + "/everyday-home.png", fullPage: true });
await p.setViewportSize({ width: 390, height: 844 }); log("phone overflow px:", await p.evaluate(() => document.documentElement.scrollWidth - innerWidth));
log("errors:", errors.length ? errors : "none"); await b.close();
