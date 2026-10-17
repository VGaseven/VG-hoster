// Run manually: CHROME_BIN=/path/to/chrome node test/hub-ui.mjs
// Uses an isolated headless browser and mock API; never the live Bridge or browser profile.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hub-ui-"));
const chromeBin =
  process.env.CHROME_BIN ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let chrome, ws;
let calls = 0;
const direct = [];
let failChat = false;
const pending = new Map();
const requests = [];
const legacyAssets = Object.fromEntries(["hub.js", "hub.css"].map(file => [file, execFileSync("git", ["show", "036a4d024e8e42927904a652ceb7c4f5faa0ec65:public/" + file], {cwd: root})]));
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
      if(u.pathname==='/api/direct-status')return send(200,{capability:{available:false,reason:'provider_unavailable'},request:null});
      if(u.pathname==='/api/sessions'||u.pathname==='/api/results'||u.pathname==='/api/children')return send(200,[]);
      if(u.pathname==='/api/decisions')return send(200,{approvals:[],tasks:[]});
      if(u.pathname==='/api/search')return send(200,[{kind:'file',id:'notes.html',title:'notes.html'}]);
      if(u.pathname==='/api/direct'){if(req.method==='POST'){const p=JSON.parse(body);const m={...p,id:direct.length+1,author:'human',at:'2026-10-17 10:00:00'};direct.push(m);return send(200,{posted:m,answering:[],delivery:'stored'});}return send(200,direct.filter(m=>m.project===project&&m.agent===u.searchParams.get('agent')));}
      if (u.pathname === "/api/tasks") return send(200, [
        { id:"T-1", project:"Economics notes", title:"Review the outline", assignee:"codex", status:"in_progress" },
        { id:"T-other", project:"Creative <studio>", title:"Private other project", status:"done" }
      ]);
      if (u.pathname === "/api/chat") {
        if (failChat) return send(503, {});
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
    if (u.pathname === "/stale.html") {
      res.writeHead(200, {"Content-Type":"text/html", "Cache-Control":"no-store"});
      return res.end(fs.readFileSync(path.join(root,"public/index.html"),"utf8").replace(/\?v=[a-f0-9]+/g,""));
    }
    const asset = u.pathname.slice(1);
    if (legacyAssets[asset] && !u.search) {
      res.writeHead(200, {"Content-Type":asset.endsWith(".js")?"text/javascript":"text/css", "Cache-Control":"public, max-age=14400"});
      return res.end(legacyAssets[asset]);
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
  // Reproduce the customer's warm cache before loading the repaired release.
  await send("Page.navigate", { url: base + "/stale.html" });
  await wait('document.querySelector("#login") && !document.querySelector("#login").hidden');
  await evaluate('document.querySelector("#token").value="fixture-token";document.querySelector("#loginForm").requestSubmit(document.querySelector("#loginForm button"))');
  await wait('document.querySelectorAll(".card").length===2');
  await evaluate('document.querySelector(".card").click()');
  await wait('document.querySelectorAll(".message").length===1');
  await check('document.querySelector("[data-i18n=conversation]").textContent==="conversation" && !document.querySelector(".message .avatar")', "reproduces old cached JS with new HTML");
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
  await check('document.querySelector("[data-i18n=conversation]").textContent!=="conversation" && document.querySelector(".message .bubble")!==null && getComputedStyle(document.querySelector(".bubble")).borderRadius==="16px"', "versioned release renders translated bubbles despite cached legacy assets");
  await check(
    'document.querySelector("#projectName").textContent==="Economics notes"',
    "project navigation",
  );
  await check('avatar("claude").tagName==="IMG" && avatar("chatgpt").tagName==="IMG" && avatar("claude-code").textContent==="CL" && avatar("codex").textContent==="CO" && avatar("local").textContent==="LO" && avatar("human").textContent==="HU" && avatar("<unknown>").textContent==="<U"', "distinct known agent icons and safe unknown initials");
  await check('document.querySelectorAll(".work-item").length===1 && !document.querySelector("#workStatus").textContent.includes("Private other project")', "task isolation and actual recorded state");
  await check('document.querySelector("img.avatar").complete && document.querySelector("img.avatar").naturalWidth>0', "Figma avatar loads locally");
  await check('document.querySelector(".participant img.avatar").getBoundingClientRect().width===20 && document.querySelector(".participant img.avatar").getBoundingClientRect().height===20', "compact navigation avatars retain square geometry");
  await check('document.documentElement.scrollWidth<=320', "mobile RTL conversation fits");
  chats["Economics notes"].push(chats["Economics notes"][0], {id:3, author:"chatgpt", text:'<img src=x onerror="window.injected=true"> مرحبًا English', at:"2026-10-17 08:10:00"});
  await sleep(5300);
  await check('document.querySelectorAll(".message").length===2 && !document.querySelector(".bubble img") && !window.injected', "polling deduplicates IDs and escapes message HTML");
  failChat = true;
  await sleep(5300);
  await check('document.querySelector("#connection").textContent.includes("الاتصال")', "failed polling reports reconnecting");
  failChat = false;
  await sleep(5300);
  await check('document.querySelector("#connection").textContent==="محدّثة"', "polling recovers automatically");
  await evaluate('document.querySelector("#chatTab").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}))');
  await check('document.querySelector("#filesTab").getAttribute("aria-selected")==="true" && document.activeElement.id==="filesTab"', "keyboard tab navigation");
  if (process.env.CHAT_SCREENSHOT_DIR) {
    await evaluate('document.querySelector("#chatTab").click()');
    const mobileShot = await send("Page.captureScreenshot", { format:"png", captureBeyondViewport:true });
    fs.writeFileSync(path.join(process.env.CHAT_SCREENSHOT_DIR,"chat-mobile-rtl.png"),Buffer.from(mobileShot.data,"base64"));
    await evaluate('document.querySelector("#language").click()');
    await send("Emulation.setDeviceMetricsOverride", {width:1280,height:1100,deviceScaleFactor:1,mobile:false});
    const desktopShot = await send("Page.captureScreenshot",{format:"png"});
    fs.writeFileSync(path.join(process.env.CHAT_SCREENSHOT_DIR,"chat-desktop.png"),Buffer.from(desktopShot.data,"base64"));
    await evaluate('document.querySelector("#language").click()');
    await send("Emulation.setDeviceMetricsOverride", {width:320,height:740,deviceScaleFactor:1,mobile:true});
  }
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
  await wait('document.querySelectorAll(".message").length===3');
  await check(
    'document.querySelector("#answering").textContent.includes("claude")',
    "requested responder displayed",
  );
  await evaluate('new Promise(requestAnimationFrame)');
  await check('document.querySelector("#chatPanel").getBoundingClientRect().bottom<=innerHeight && document.querySelector("#send").getBoundingClientRect().bottom<=innerHeight', 'composer stays within viewport');
  await evaluate('document.querySelectorAll("#participants button")[2].click()');
  await wait('location.hash.includes("conversation=codex") && document.querySelectorAll(".message").length===0');
  await evaluate('document.querySelector("#message").value="Private <script>sentinel</script>";document.querySelector("#chatForm").requestSubmit(document.querySelector("#send"))');
  await wait('document.querySelectorAll(".message").length===1');
  await check('document.querySelector("#messages").textContent.includes("Private <script>sentinel</script>") && !document.querySelector(".bubble script")', 'private send is persisted and escaped');
  await evaluate('document.querySelectorAll("#participants button")[1].click()');
  await wait('location.hash.includes("conversation=claude") && document.querySelectorAll(".message").length===0');
  await check('!document.querySelector("#messages").textContent.includes("sentinel")', 'private agents have distinct histories');
  await evaluate('document.querySelectorAll("#participants button")[0].click()');
  await wait('location.hash.includes("conversation=group") && document.querySelectorAll(".message").length===3');
  await check('!document.querySelector("#messages").textContent.includes("sentinel")', 'private history never appears in group');
  for(let i=10;i<40;i++)chats['Economics notes'].push({id:i,author:'claude',text:'Long history '+i,at:'2026-10-17 10:00:00'});
  await sleep(5300);
  await evaluate('document.querySelector("#messages").scrollTop=0');
  chats['Economics notes'].push({id:50,author:'claude',text:'A new reply',at:'2026-10-17 10:00:00'});
  await sleep(5300);
  await check('document.querySelector("#messages").scrollTop===0 && !document.querySelector("#newMessages").hidden', 'new replies preserve reading position and show indicator');
  await evaluate('document.querySelector("#newMessages").click()');
  await check('document.querySelector("#newMessages").hidden && document.querySelector("#messages").scrollTop>0', 'new message indicator returns to latest');
  await evaluate('document.querySelector("#toggleWork").click()');
  await check('document.querySelector("#toggleWork").getAttribute("aria-expanded")==="true"', 'task rail expands on mobile');
  await evaluate('document.querySelector("#workFilter").value="done";document.querySelector("#workFilter").dispatchEvent(new Event("change"))');
  await check('document.querySelectorAll("#workStatus .work-item").length===0','task filter uses actual status');
  await evaluate('document.querySelector("#workFilter").value="all";document.querySelector("#workFilter").dispatchEvent(new Event("change"));document.querySelector("#toggleWork").click()');
  await evaluate('document.querySelector("#searchTab").click();document.querySelector("#unifiedSearch").value="notes";document.querySelector("#unifiedSearch").dispatchEvent(new Event("input"))');
  await wait('document.querySelector("#searchResults button")!==null');
  await evaluate('document.querySelector("#searchResults button").click()');
  await wait('!document.querySelector("#filePreview").hidden');
  await check('document.querySelector("#fileName").textContent==="notes.html"','unified search opens actual file preview');
  await evaluate('document.querySelector("#sessionsTab").click();document.querySelector("#sessionList button").click()');
  await check('document.querySelector("#metadata-source_url") && document.querySelector("#metadata-status").value==="unknown"','session editor starts with unknown status and explicit original link');
  await evaluate('document.querySelector("dialog[open]").close();document.querySelector("#chatTab").click();document.querySelector("#workStatus details:last-of-type").open=true;document.querySelector("#workStatus details:last-of-type button").click()');
  await check('document.querySelector("#metadata-files").multiple && document.querySelector("#metadata-session_id").value===""','result editor selects actual deliverables and leaves missing session unavailable');
  await evaluate('document.querySelector("dialog[open]").close()');
  await evaluate('document.querySelector("#generalChat").click()');
  await check('document.querySelector("#generalDialog").open && document.querySelector("#destination").value==="" && document.querySelector("#generalAgent").value!=="group"','general chat asks destination and defaults private');
  await evaluate('document.querySelector("#closeGeneral").click();document.querySelector("#back").click()');
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
  if(process.env.REVIEW_SCREENSHOT_DIR){
    await send('Page.navigate',{url:'http://127.0.0.1:4317/#project=default'});
    await wait('document.querySelectorAll(".message").length>=24');
    await evaluate('new Promise(requestAnimationFrame)');
    const desktop=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(process.env.REVIEW_SCREENSHOT_DIR,'overhaul-desktop.png'),Buffer.from(desktop.data,'base64'));
    await evaluate('document.querySelector("#language").click()');
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await evaluate('document.querySelector("#toggleWork").click();new Promise(requestAnimationFrame)');
    const mobile=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(process.env.REVIEW_SCREENSHOT_DIR,'overhaul-mobile-ar.png'),Buffer.from(mobile.data,'base64'));
    await evaluate('document.querySelectorAll("#participants button")[2].click()');
    await wait('location.hash.includes("conversation=codex") && document.querySelectorAll(".message").length===0');
    const dm=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(process.env.REVIEW_SCREENSHOT_DIR,'overhaul-private-ar.png'),Buffer.from(dm.data,'base64'));
  }
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
