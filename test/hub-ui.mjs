// Run manually: CHROME_BIN=/path/to/chrome node test/hub-ui.mjs
// Uses an isolated headless browser and mock API; never the live Bridge or browser profile.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hub-ui-"));
const chromeBin =
  process.env.CHROME_BIN ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let chrome, ws;
let calls = 0;
const pending = new Map();
const requests = [];
let projects = [
  { name: "Economics notes", description: "A quiet place to study." },
  { name: "Creative <studio>", description: "Films and ideas" },
];
const chats = {
  "Economics notes": [
    {
      id: 1,
      author: "claude",
      text: "Welcome to your project.",
      at: "2026-10-17 08:00:00",
    },
  ],
  "Creative <studio>": [],
};
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    const u = new URL(req.url, "http://localhost");
    const send = (code, data) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (u.pathname.startsWith("/api/")) {
      requests.push({
        url: req.url,
        auth: req.headers.authorization,
        cookie: req.headers.cookie,
        body,
      });
      if (req.headers.authorization !== "Bearer fixture-token")
        return send(401, { error: "unauthorized" });
      const project = u.searchParams.get("project");
      if (u.pathname === "/api/projects") {
        if (req.method === "POST") {
          const p = JSON.parse(body);
          projects.push(p);
          chats[p.name] = [];
          return send(200, p);
        }
        return send(200, projects);
      }
      if (u.pathname === "/api/chat") {
        if (req.method === "POST") {
          const p = JSON.parse(body);
          chats[p.project].push({
            id: 2,
            author: "human",
            text: p.text,
            at: "2026-10-17 09:00:00",
          });
          return send(200, { answering: ["claude"] });
        }
        return send(200, chats[project] || []);
      }
      if (u.pathname === "/api/files")
        return send(
          200,
          project === "Economics notes"
            ? [{ path: "notes.html", version: 2 }]
            : [],
        );
      if (u.pathname === "/api/file")
        return send(200, {
          path: "notes.html",
          content: '<img src=x onerror="window.injected=true">',
          version: 2,
        });
      return send(404, {});
    }
    const file = path.join(
      root,
      "public",
      u.pathname === "/" ? "index.html" : u.pathname,
    );
    if (
      !file.startsWith(path.join(root, "public") + path.sep) ||
      !fs.existsSync(file)
    ) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, {
      "Content-Type": file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "text/html",
    });
    res.end(fs.readFileSync(file));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++calls;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};
async function wait(expression) {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(expression)) return;
    await sleep(50);
  }
  throw new Error("Timed out: " + expression);
}
let checks = 0;
async function check(expression, label) {
  assert.equal(await evaluate(expression), true, label);
  checks++;
  console.log("PASS " + label);
}
try {
  chrome = spawn(
    chromeBin,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${tmp}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let port;
  for (let i = 0; i < 100; i++) {
    try {
      port = fs
        .readFileSync(path.join(tmp, "DevToolsActivePort"), "utf8")
        .split("\n")[0];
      break;
    } catch {
      await sleep(100);
    }
  }
  if (!port) throw new Error("Headless Chrome did not start");
  const pages = await (
    await fetch(`http://127.0.0.1:${port}/json/list`)
  ).json();
  ws = new WebSocket(
    pages.find(
      (p) => p.type === "page" && p.url === "about:blank",
    ).webSocketDebuggerUrl,
  );
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown")
      console.error(
        "Browser error:",
        m.params.exceptionDetails.exception?.description ||
          m.params.exceptionDetails.text,
      );
    if (m.id) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    }
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Network.setBlockedURLs", {
    urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*"],
  });
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: base });
  await wait(
    'document.querySelector("#login") && !document.querySelector("#login").hidden',
  );
  await check(
    'document.querySelector("#home").hidden',
    "private UI hidden before login",
  );
  await evaluate(
    'document.querySelector("#token").value="wrong";document.querySelector("#loginForm").requestSubmit(document.querySelector("#loginForm button"))',
  );
  await wait('document.querySelector("#notice").textContent.includes("token")');
  await evaluate(
    'document.querySelector("#token").value="fixture-token";document.querySelector("#loginForm").requestSubmit(document.querySelector("#loginForm button"))',
  );
  await wait('document.querySelectorAll(".card").length===2');
  await check(
    'document.querySelector("#token").value==="" && document.cookie==="" && sessionStorage.length===0 && !JSON.stringify(localStorage).includes("fixture-token")',
    "token remains absent from input and browser storage",
  );
  await check(
    'document.querySelectorAll(".card")[1].textContent.includes("<studio>") && !document.querySelector("studio")',
    "project names rendered as text",
  );
  await evaluate(
    'document.querySelector("#search").value="nothing";document.querySelector("#search").dispatchEvent(new Event("input"))',
  );
  await check(
    'document.querySelectorAll(".card").length===0 && document.querySelector(".empty")!==null',
    "search empty state",
  );
  await evaluate(
    'document.querySelector("#search").value="";document.querySelector("#search").dispatchEvent(new Event("input"));document.querySelector("#language").click()',
  );
  await check(
    'document.documentElement.dir==="rtl" && document.documentElement.lang==="ar" && localStorage.getItem("hub-language")==="ar"',
    "Arabic and language preference",
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 320,
    height: 740,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await check(
    "document.documentElement.scrollWidth<=320",
    "320px Arabic home has no horizontal overflow",
  );
  await evaluate('document.querySelector(".card").click()');
  await wait('document.querySelectorAll(".message").length===1');
  await check(
    'document.querySelector("#projectName").textContent==="Economics notes"',
    "project navigation",
  );
  await evaluate(
    'document.querySelector("#filesTab").click();document.querySelector(".file-row").click()',
  );
  await wait('!document.querySelector("#filePreview").hidden');
  await check(
    'document.querySelector("#fileContent").textContent.includes("<img") && !document.querySelector("#fileContent img") && !window.injected',
    "HTML file preview cannot execute",
  );
  await check(
    "document.documentElement.scrollWidth<=320",
    "320px Arabic file view has no overflow",
  );
  await evaluate(
    'document.querySelector("#chatTab").click();document.querySelector("#message").value="@claude Hello";document.querySelector("#chatForm").requestSubmit(document.querySelector("#send"))',
  );
  await wait('document.querySelectorAll(".message").length===2');
  await check(
    'document.querySelector("#answering").textContent.includes("claude")',
    "requested responder displayed",
  );
  await evaluate('document.querySelector("#back").click()');
  await wait('!document.querySelector("#home").hidden');
  await evaluate('document.querySelectorAll(".card")[1].click()');
  await wait(
    'document.querySelector("#projectName").textContent==="Creative <studio>"',
  );
  await check(
    '!document.querySelector("#messages").textContent.includes("Hello")',
    "project chat isolation",
  );
  await evaluate('document.querySelector("#back").click()');
  await wait('!document.querySelector("#home").hidden');
  await evaluate(
    'document.querySelector("#newProject").click();document.querySelector("#newName").value="New idea";document.querySelector("#projectForm").requestSubmit(document.querySelector("#projectForm .primary"))',
  );
  await wait('document.querySelector("#projectName").textContent==="New idea"');
  await check(
    '!document.querySelector("#projectDialog").open',
    "project creation",
  );
  await evaluate(
    'document.querySelector("#language").click();document.querySelector("#back").click()',
  );
  await wait('!document.querySelector("#home").hidden');
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  if (process.env.HUB_SCREENSHOT) {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      process.env.HUB_SCREENSHOT,
      Buffer.from(shot.data, "base64"),
    );
  }
  await evaluate('document.querySelector("#lock").click()');
  await check(
    'document.querySelector("#home").hidden && document.querySelector("#messages").textContent==="" && !document.querySelector("#login").hidden',
    "locking clears private content",
  );
  await send("Page.reload");
  await wait(
    'document.querySelector("#login") && !document.querySelector("#login").hidden',
  );
  await check(
    'document.querySelector("#home").hidden',
    "reload requires login again",
  );
  assert.ok(
    requests.every((r) => !r.cookie && !r.url.includes("fixture-token")),
  );
  checks++;
  console.log(
    `PASS auth never sent in cookies or URLs\n${checks} UI checks passed`,
  );
} catch (error) {
  console.error(await evaluate("document.body.innerText.slice(0,500)"));
  throw error;
} finally {
  ws?.close();
  chrome?.kill();
  server.close();
  await sleep(300);
  fs.rmSync(tmp, { recursive: true, force: true });
}
