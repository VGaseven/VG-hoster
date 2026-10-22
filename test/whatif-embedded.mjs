// WhatIf inside Shahed's Hub → Work: sandboxed iframe, isolation probes, storage bridge, chat still working.
// Run manually against a THROWAWAY local Hub only (it creates projects and a chat message):
//   LOCAL_TEST_TOKEN=<the local server's BRIDGE_TOKEN> NPM_ROOT=$(npm root -g) node test/whatif-embedded.mjs <screenshot-dir>
// Expected: every probe "blocked", origin "null", toolLang null, the CSP refusals in "errors" are the probes themselves.
import path from "node:path";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(path.join(process.env.NPM_ROOT, "playwright"));
const base = process.env.WHATIF_URL || "http://127.0.0.1:34570", TOKEN = process.env.LOCAL_TEST_TOKEN, out = process.argv[2] || ".";
if (!TOKEN) throw new Error("Set LOCAL_TEST_TOKEN to the BRIDGE_TOKEN of your throwaway local server.");
const api = (p, body) => fetch(`${base}/api/${p}`, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` }, body: body && JSON.stringify(body) }).then(r => r.json());
for (const s of ["work", "uni"]) await api("projects", { name: s, description: s });
await api("projects", { name: "Client reel", description: "secret client brief" }); await api("project-parent", { project: "Client reel", parent: "work" });
await api("chat", { project: "work", text: "PRIVATE-CHAT-CANARY" }).catch(() => {});
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = []; p.on("pageerror", e => errors.push(e.message)); p.on("console", m => m.type() === "error" && errors.push(m.text()));
p.on("dialog", d => d.accept());
const log = (...a) => console.log(...a);
await p.goto(base + "/"); await p.evaluate(() => localStorage.setItem("hub-language", "en"));
await p.fill("#loginForm input", TOKEN); await p.click("#loginForm .primary, #loginForm button[type=submit]");
await p.waitForSelector("#chatsHome:not([hidden])");
await p.click("#projectsView"); await p.waitForSelector(".tool-card");
log("work section cards:", await p.$$eval(".hub-section", ss => ss.find(s => s.querySelector(".section-title").textContent === "Work")?.querySelectorAll(".card h3").length), "| tool card:", await p.textContent(".tool-card h3"));
log("uni section has tool:", await p.$$eval(".hub-section", ss => !!ss.find(s => s.querySelector(".section-title").textContent === "Uni")?.querySelector(".tool-card")));
await p.click(".tool-card"); await p.waitForSelector("#tool:not([hidden])");
log("iframe sandbox:", await p.getAttribute("#toolFrame", "sandbox"));
let f; for (let i = 0; i < 40 && !(f = p.frames().find(x => /tools\/bizdata/.test(x.url()))); i++) await p.waitForTimeout(100);
await f.waitForSelector(".kpi");
// Use the tool inside the frame.
await f.click('.step-btn:has-text("Investigate")'); await f.click("#runBtn");
await f.waitForSelector("#resultBox .check", { timeout: 15000 });
log("in-frame SQL:", (await f.textContent("#resultBox .check")).slice(0, 50));
// Isolation probes, run as the tool's own code would.
const probes = await f.evaluate(async () => {
  const r = {};
  r.origin = self.origin;
  try { r.parentDom = parent.document.title; } catch (e) { r.parentDom = "blocked: " + e.name; }
  try { r.storage = typeof localStorage.length; } catch (e) { r.storage = "blocked: " + e.name; }
  try { r.cookie = document.cookie; } catch (e) { r.cookie = "blocked: " + e.name; }
  try { const res = await fetch("/api/projects", { credentials: "include" }); r.api = "status " + res.status + " " + (await res.text()).slice(0, 60); } catch (e) { r.api = "blocked: " + e.name; }
  try { const res = await fetch(location.href.replace(/tools.*/, "api/chats")); r.api2 = "status " + res.status; } catch (e) { r.api2 = "blocked: " + e.name; }
  r.img = await new Promise((ok) => { const i = new Image(); i.onload = () => ok("loaded"); i.onerror = () => ok("blocked"); i.src = "/api/projects"; setTimeout(() => ok("timeout"), 2000); });
  parent.postMessage({ type: "whatif-store", op: "set", key: "hub-language", value: "\"ar\"" }, "*");
  parent.postMessage({ type: "whatif-store", op: "set", key: "bizdata-x", value: "\"ok\"" }, "*");
  await new Promise((ok) => setTimeout(ok, 300));
  r.canary = document.body.innerText.includes("PRIVATE-CHAT-CANARY") || document.body.innerText.includes("secret client brief");
  return r;
});
log("probes:", JSON.stringify(probes, null, 1));
log("hub storage:", JSON.stringify(await p.evaluate(() => ({ lang: localStorage.getItem("hub-language"), toolLang: localStorage.getItem("tool:hub-language"), toolX: localStorage.getItem("tool:bizdata-x"), wip: !!localStorage.getItem("tool:bizdata-wip") }))));
// Persistence through the Hub bridge.
await p.reload(); await p.fill("#loginForm input", TOKEN).catch(() => {}); await p.click("#loginForm .primary, #loginForm button[type=submit]").catch(() => {});
await p.waitForSelector("#tool:not([hidden])", { timeout: 15000 });
f = null; for (let i = 0; i < 40 && !(f = p.frames().find(x => /tools\/bizdata/.test(x.url()))); i++) await p.waitForTimeout(100);
await f.waitForSelector(".task-tab"); 
log("after reload, step:", (await f.textContent("[aria-current=step]")).trim(), "| task badge:", await f.textContent(".task-tab .badge").catch(() => "none"));
await p.screenshot({ path: out + "/embedded.png" });
// Hub chat still works from the tool page.
await p.click("#toolChat"); await p.waitForSelector("#project:not([hidden])");
await p.fill("#message", "Chat still works next to WhatIf"); await p.click("#send");
await p.waitForFunction(() => document.querySelector("#messages")?.textContent.includes("Chat still works"), null, { timeout: 10000 });
log("work chat:", await p.textContent("#projectName"), "message posted");
await p.click("#chatsView").catch(() => {}); 
log("errors:", errors.filter(e => !/401/.test(e)).length ? errors : "none (only pre-login 401s)");
await b.close();
