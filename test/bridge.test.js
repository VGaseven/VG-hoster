// End-to-end tests: starts the real server against mock GitHub, Telegram and n8n endpoints. No API keys needed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execSync } from "node:child_process";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TOKEN = "test-token", HOOK_SECRET = "hook-secret", CHAT = "42";
const tgQueue = [], tgSent = [], ghIssues = [], n8nCalls = [], n8nStore = [];
let mock, bridge, base, mockUrl, tmp, updateId = 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 5000, every = 50) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error("timed out"); await sleep(every); }
}

before(async () => {
  mock = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const json = (code, v) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(v)); };
      const b = body ? JSON.parse(body) : {};
      if (req.url === "/gh/repos/o/r/issues") { ghIssues.push(b); return json(201, { number: 7, html_url: "https://github.com/o/r/issues/7" }); }
      if (req.url === "/anth/v1/messages") {
        const last = JSON.stringify(b.messages.at(-1).content);
        const text = /please research markets/.test(last) ? "ROUTE: SESSION Market research" : /please build the faq/.test(last) ? "ROUTE: BUILD Add a FAQ page" : "Of course! Happy to help the team.";
        return json(200, { id: "m1", type: "message", role: "assistant", model: b.model, stop_reason: "end_turn",
          content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 5 } });
      }
      if (req.url === "/n8napi/webhook/hello") return json(200, { ok: true, got: b.payload });
      if (req.url.startsWith("/n8napi/")) {
        if (req.headers["x-n8n-api-key"] !== "k") return json(401, { message: "unauthorized" });
        const u = req.url.slice("/n8napi".length);
        if (u === "/api/v1/workflows" && req.method === "POST") { n8nStore.push({ ...b, id: "w1", active: false }); return json(200, n8nStore.at(-1)); }
        if (u.startsWith("/api/v1/workflows?")) return json(200, { data: n8nStore });
        if (u === "/api/v1/workflows/w1/activate") { n8nStore[0].active = true; return json(200, n8nStore[0]); }
        if (u === "/api/v1/workflows/w1" && req.method === "DELETE") { n8nStore.length = 0; return json(200, {}); }
        return json(404, { message: "not found" });
      }
      if (req.url === "/n8n/hook") { n8nCalls.push(b); return json(200, { ok: true }); }
      if (req.url === "/tg/botT/getUpdates") { if (!tgQueue.length) await sleep(100); return json(200, { ok: true, result: tgQueue.splice(0) }); }
      if (req.url.startsWith("/tg/botT/")) { tgSent.push({ method: req.url.split("/").pop(), ...b }); return json(200, { ok: true, result: {} }); }
      json(404, {});
    });
  }).listen(0);
  await new Promise((r) => mock.once("listening", r));
  mockUrl = `http://127.0.0.1:${mock.address().port}`;

  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-test-"));
  // A pretend GitHub: a bare repo as "origin", and a clone that plays the bridge's own folder.
  const sh = (cmd, cwd = tmp) => execSync(cmd, { cwd, stdio: "pipe" });
  sh("git init -q --bare -b main origin.git");
  sh(`git clone -q origin.git live && cd live && git config user.email t@t && git config user.name t && echo hi > README.md && printf 'require("http").createServer((q, r) => r.end("ok")).listen(process.env.PORT);\n' > server.js && git add . && git commit -qm init && git push -q origin main`);
  // Fake Codex for building: writes a file in the folder it's given and leaves a summary.
  const fake = path.join(tmp, "codex");
  fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require("fs"), path = require("path"); let input = "";
process.stdin.on("data", (d) => (input += d)).on("end", () => {
  const a = process.argv; const dir = a[a.indexOf("--cd") + 1];
  fs.writeFileSync(path.join(dir, "faq.html"), "<h1>FAQ</h1>");
  fs.writeFileSync(a[a.indexOf("-o") + 1], "Added faq.html with a FAQ heading.");
});`);
  fs.chmodSync(fake, 0o755);
  const port = 20000 + Math.floor(Math.random() * 20000);
  base = `http://127.0.0.1:${port}`;
  bridge = spawn(process.execPath, ["--no-warnings", "server.js"], {
    cwd: path.join(import.meta.dirname, ".."),
    env: { PATH: process.env.PATH, AI_ENGINE: "api", CLAUDE_CHAT_MODE: "quick", BRIDGE_DIR: path.join(tmp, "live"), WORK_DIR: path.join(tmp, "work"), CODEX_BIN: path.join(tmp, "codex"),
      SELF_UPDATE_NO_RESTART: "1", HOME: tmp, ANTHROPIC_API_KEY: "x", ANTHROPIC_BASE_URL: `${mockUrl}/anth`, N8N_API_URL: `${mockUrl}/n8napi`, N8N_API_KEY: "k", PORT: String(port), BRIDGE_TOKEN: TOKEN, DB_FILE: path.join(tmp, "b.db"), TRUST_PROXY: "0",
      GITHUB_TOKEN: "gh", GITHUB_REPO: "o/r", GITHUB_API_URL: `${mockUrl}/gh`, GITHUB_WEBHOOK_SECRET: HOOK_SECRET,
      TELEGRAM_BOT_TOKEN: "T", TELEGRAM_CHAT_ID: CHAT, TELEGRAM_API_URL: `${mockUrl}/tg`,
      N8N_WORKFLOWS: JSON.stringify({ ping: { url: `${mockUrl}/n8n/hook`, description: "test hook" } }) },
    stdio: ["ignore", "inherit", "inherit"],
  });
  await waitFor(() => fetch(`${base}/health`).then((r) => r.ok, () => false), 10000);
});

after(() => { bridge?.kill(); mock?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function mcp(agent, name, args = {}) {
  const r = await fetch(`${base}/mcp?agent=${agent}&token=${TOKEN}`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const raw = await r.text();
  const line = raw.split("\n").find((l) => l.startsWith("data: "));
  const j = JSON.parse(line ? line.slice(6) : raw);
  const text = j.result?.content?.[0]?.text ?? JSON.stringify(j.error);
  let json = null; try { json = JSON.parse(text); } catch {}
  return { error: !!j.result?.isError || !!j.error, text, json };
}
async function api(p, method = "GET", body) {
  const r = await fetch(`${base}/api/${p}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
}
const tgSend = (update) => tgQueue.push({ update_id: updateId++, ...update });
const tgCallback = (data, chatId = CHAT, fromId = CHAT) =>
  tgSend({ callback_query: { id: `cb${updateId}`, from: { id: Number(fromId) }, data, message: { message_id: 1, chat: { id: Number(chatId), type: "private" }, text: "req" } } });
const tgText = (text) => tgSend({ message: { message_id: 2, from: { id: Number(CHAT) }, chat: { id: Number(CHAT), type: "private" }, text } });

test("rejects missing or wrong tokens", async () => {
  assert.equal((await fetch(`${base}/api/overview`)).status, 401);
  assert.equal((await fetch(`${base}/api/overview?token=nope`)).status, 401);
  assert.equal((await fetch(`${base}/api/overview?token=%E0%A4%A`)).status, 401); // malformed encoding doesn't crash
  assert.equal((await fetch(`${base}/api/overview?token=${TOKEN}`)).status, 200);
});

test("two agents claiming one task: exactly one wins", async () => {
  const t = (await mcp("chatgpt", "create_task", { title: "race", project: "race" })).json;
  const [a, b] = await Promise.all([mcp("claude", "claim_task", { id: t.id }), mcp("chatgpt", "claim_task", { id: t.id })]);
  assert.equal([a, b].filter((x) => !x.error).length, 1);
  const winner = a.error ? "chatgpt" : "claude", loser = a.error ? "claude" : "chatgpt";
  assert.match((a.error ? a : b).text, /already claimed/);
  assert.ok((await mcp(loser, "update_task", { id: t.id, status: "done" })).error, "loser can't change it");
  assert.ok(!(await mcp(loser, "update_task", { id: t.id, note: "fyi" })).error, "loser can still add a note");
  const done = await mcp(winner, "update_task", { id: t.id, status: "done", note: "finished" });
  assert.equal(done.json.status, "done");
});

test("next_task never hands the same task to two agents", async () => {
  for (let i = 0; i < 4; i++) await mcp("chatgpt", "create_task", { title: `job ${i}`, project: "pool" });
  const got = await Promise.all(Array.from({ length: 8 }, (_, i) => mcp(i % 2 ? "claude" : "chatgpt", "next_task", { project: "pool" })));
  const ids = got.filter((g) => g.json?.id).map((g) => g.json.id);
  assert.equal(ids.length, 4);
  assert.equal(new Set(ids).size, 4);
});

test("red actions wait for approval; Telegram buttons approve once; strangers are ignored", async () => {
  const t = (await mcp("chatgpt", "create_task", { title: "to delete" })).json;
  const r = await mcp("chatgpt", "delete_task", { id: t.id });
  const aid = r.text.match(/request (\w+)/)[1];
  const msg = await waitFor(() => tgSent.find((m) => m.method === "sendMessage" && m.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data === `ap:${aid}:y`));
  assert.match(msg.text, /delete_task/);

  tgCallback(`ap:${aid}:y`, "999", "999"); // wrong chat
  await waitFor(() => tgSent.find((m) => m.method === "answerCallbackQuery" && m.text === "Not allowed"));
  assert.ok((await api("tasks")).body.some((x) => x.id === t.id), "still there");

  tgCallback(`ap:${aid}:y`);
  await waitFor(async () => !(await api("tasks")).body.some((x) => x.id === t.id));
  const again = await api(`approvals/${aid}`, "POST", { approve: true });
  assert.equal(again.status, 400);
  assert.match(again.body.error, /already approved/);
});

test("kill switch: anyone can pause, AIs are stopped, only the human resumes", async () => {
  tgText("stop");
  await waitFor(async () => (await api("overview")).body.paused);
  const blocked = await mcp("claude", "create_task", { title: "nope" });
  assert.ok(blocked.error); assert.match(blocked.text, /paused/);
  const brief = await mcp("chatgpt", "get_briefing");
  assert.equal(brief.json.team.paused, true, "read-only tools still work");
  assert.ok(!(await mcp("claude", "pause_all", { reason: "again" })).error);
  assert.ok((await mcp("claude", "resume_all")).error, "no resume tool for AIs");
  tgText("/resume");
  await waitFor(async () => !(await api("overview")).body.paused);
  assert.ok(!(await mcp("claude", "create_task", { title: "back to work" })).error);
  tgText("/status");
  await waitFor(() => tgSent.find((m) => m.method === "sendMessage" && /Team running/.test(m.text)));
});

test("n8n workflows need approval, then run with the payload", async () => {
  assert.deepEqual((await mcp("chatgpt", "list_workflows")).json, [{ name: "ping", description: "test hook" }]);
  const r = await mcp("chatgpt", "trigger_workflow", { name: "ping", payload: { to: "me" } });
  const aid = r.text.match(/request (\w+)/)[1];
  assert.equal(n8nCalls.length, 0);
  const ok = await api(`approvals/${aid}`, "POST", { approve: true });
  assert.match(ok.body, /ran \(HTTP 200\)/);
  assert.equal(n8nCalls[0].payload.to, "me");
  assert.equal(n8nCalls[0].from, "chatgpt");
});

test("claude-code tasks become GitHub issues and webhooks report back", async () => {
  const t = (await mcp("chatgpt", "create_task", { title: "Build the pricing page", details: "3 plans", assignee: "claude-code" })).json;
  assert.equal(t.github_url, "https://github.com/o/r/issues/7");
  assert.equal(t.claimed_by, "claude-code");
  assert.match(ghIssues.at(-1).body, /^@claude Build the pricing page/);
  assert.match(ghIssues.at(-1).body, new RegExp(`bridge-task:${t.id}`));
  assert.match((await mcp("chatgpt", "dispatch_task", { id: t.id })).text, /already sent/);
  assert.ok((await mcp("claude", "claim_task", { id: t.id })).error, "nobody else can grab it");

  const hook = async (event, payload, secret = HOOK_SECRET) => {
    const body = JSON.stringify({ repository: { full_name: "o/r" }, ...payload });
    const sig = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
    return fetch(`${base}/github/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "X-GitHub-Event": event, "X-Hub-Signature-256": sig }, body });
  };
  assert.equal((await hook("issues", { action: "closed", issue: { number: 7 } }, "wrong")).status, 401);
  await hook("issue_comment", { action: "created", issue: { number: 7 }, comment: { user: { type: "Bot" }, body: "Working on it", html_url: "https://x" } });
  await hook("pull_request", { action: "opened", pull_request: { title: "Pricing", body: "Closes #7", html_url: "https://github.com/o/r/pull/8" } });
  await hook("issues", { action: "closed", issue: { number: 7, state_reason: "completed", html_url: "https://github.com/o/r/issues/7" } });
  const after = (await api("tasks")).body.find((x) => x.id === t.id);
  assert.equal(after.status, "done");
  const notes = after.notes.map((n) => n.note).join("\n");
  assert.match(notes, /Working on it/);
  assert.match(notes, /pull\/8/);
});

test("fetch_url refuses private and internal addresses", async () => {
  for (const url of ["http://127.0.0.1:1/", "http://localhost/", "http://[::1]/", "http://10.0.0.5/", "http://169.254.169.254/latest/meta-data", "http://[::ffff:127.0.0.1]/"]) {
    const r = await mcp("chatgpt", "fetch_url", { url });
    assert.ok(r.error, url);
    assert.match(r.text, /Blocked/, url);
  }
});

test("the team chat shows AI-to-AI messages and agent activity", async () => {
  const r = await mcp("chatgpt", "ask_claude", { prompt: "Do you love me?", project: "feed" });
  assert.ok(!r.error, r.text);
  await mcp("chatgpt", "create_task", { title: "Write slogans", assignee: "claude", project: "feed" });
  const chat = (await api("chat?project=feed")).body.map((m) => `${m.author}: ${m.text}`);
  assert.ok(chat.includes("chatgpt: → @claude: Do you love me?"), chat.join("\n"));
  assert.ok(chat.includes("claude: Of course! Happy to help the team."), chat.join("\n"));
  assert.ok(chat.some((m) => m.startsWith("chatgpt: 📋 New task for @claude: Write slogans")), chat.join("\n"));
});

test("agents build, switch on and run n8n workflows through the bridge", async () => {
  const saved = await mcp("claude", "n8n_save_workflow", { name: "Hello", nodes: [
    { name: "Webhook", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 0], parameters: { path: "hello", httpMethod: "POST" } }] });
  assert.ok(!saved.error, saved.text);
  assert.deepEqual(saved.json.webhooks, ["hello"]);
  assert.equal((await mcp("claude", "n8n_set_active", { id: "w1", active: true })).json.active, true);
  assert.equal((await mcp("chatgpt", "n8n_list_workflows")).json[0].active, true);
  const run = await mcp("chatgpt", "n8n_run_webhook", { path: "hello", payload: { a: 1 } });
  const aid = run.text.match(/request (\w+)/)[1];
  assert.match((await api(`approvals/${aid}`, "POST", { approve: true })).body, /Ran webhook "hello" \(HTTP 200\)/);
  assert.match((await mcp("claude", "n8n_delete_workflow", { id: "w1" })).text, /Needs the human's approval/);
  assert.ok((await mcp("claude", "n8n_run_webhook", { path: "../etc" })).text.includes("approval"), "path check runs after approval");
});

test("group chat: an @mention wakes that teammate, and Bob's get_updates shows what's new", async () => {
  await mcp("chatgpt", "get_updates", { project: "group" }); // start Bob's cursor here
  const r = await mcp("claude", "team_chat", { text: "Shahed wants a FAQ page. @claude can you outline it?", project: "group" });
  assert.ok(!r.error, r.text);
  assert.deepEqual(r.json.answering, ["claude"]);
  const reply = await waitFor(async () => (await api("chat?project=group")).body.find((m) => m.author === "claude" && /Happy to help/.test(m.text)));
  assert.ok(reply);
  const u = (await mcp("chatgpt", "get_updates", { project: "group" })).json;
  assert.ok(u.new_messages.some((m) => /FAQ page/.test(m)));
  assert.ok(u.new_messages.some((m) => /Happy to help/.test(m)));
  const again = (await mcp("chatgpt", "get_updates", { project: "group" })).json;
  assert.equal(again.new_messages.length, 0, "nothing new the second time");
  // A plain post with no @mention wakes nobody.
  assert.deepEqual((await mcp("claude", "team_chat", { text: "just a note", project: "group" })).json.answering, []);
});

test("group chat: @claude-code becomes a GitHub issue for Claude Code, and the link comes back to the chat", async () => {
  const before = ghIssues.length;
  const r = await api("chat", "POST", { text: "@claude-code add a FAQ section to the homepage", project: "build" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.answering, ["claude-code (GitHub)"], "no Codex reply when it's a build request");
  await waitFor(() => ghIssues.length > before);
  const issue = ghIssues.at(-1);
  assert.equal(issue.title, "add a FAQ section to the homepage");
  assert.match(issue.body, /^@claude add a FAQ section/);
  const msg = await waitFor(async () => (await api("chat?project=build")).body.find((m) => /Claude Code is on it: https:\/\/github.com\/o\/r\/issues\/7/.test(m.text)));
  assert.equal(msg.author, "claude-code");
});

test("group chat: @cloud queues a task for a Claude app session", async () => {
  const r = await api("chat", "POST", { text: "@cloud write a study plan for my exams", project: "cloudq" });
  assert.deepEqual(r.body.answering, ["claude (cloud session, within the hour)"]);
  const tasks = (await mcp("claude", "list_tasks", { project: "cloudq" })).json;
  const t = (Array.isArray(tasks) ? tasks : tasks.tasks || []).find((x) => x.assignee === "cloud");
  assert.equal(t.title, "write a study plan for my exams");
});

test("a Claude app session (actor claude) can claim an @cloud task", async () => {
  await api("chat", "POST", { text: "@cloud tidy my notes", project: "cloudclaim" });
  const list = (await mcp("claude", "list_tasks", { project: "cloudclaim" })).json;
  const t = (Array.isArray(list) ? list : list.tasks).find((x) => x.assignee === "cloud");
  const c = await mcp("claude", "claim_task", { id: t.id });
  assert.ok(!c.error, c.text);
  assert.ok((await mcp("chatgpt", "claim_task", { id: t.id })).error, "others still can't take it");
});

test("one @claude: Claude decides between answering, building on GitHub and a cloud session", async () => {
  const before = ghIssues.length;
  await api("chat", "POST", { text: "@claude please build the faq page on my site", project: "route" });
  await waitFor(() => ghIssues.length > before);
  assert.equal(ghIssues.at(-1).title, "Add a FAQ page");
  await api("chat", "POST", { text: "@claude please research markets for my portfolio", project: "route" });
  const chat = async () => { const r = await api("chat?project=route"); if (!Array.isArray(r.body)) throw new Error(`chat: ${r.status} ${JSON.stringify(r.body)}`); return r.body; };
  const queued = await waitFor(async () => (await chat()).find((m) => /Queued for Claude in your Claude app/.test(m.text)), 8000, 500);
  assert.ok(queued);
  const list = (await mcp("claude", "list_tasks", { project: "route" })).json;
  assert.ok((Array.isArray(list) ? list : list.tasks).some((t) => t.assignee === "cloud" && t.title === "Market research"));
  assert.ok(!(await chat()).some((m) => /^ROUTE:/.test(m.text)), "routing lines never show in the chat");
});

test("build_task: Codex builds in a private branch and the pull-request link comes back", async () => {
  const t = (await mcp("chatgpt", "create_task", { title: "Add a FAQ page", project: "buildp" })).json;
  const r = await mcp("claude", "build_task", { id: t.id });
  assert.ok(!r.error, r.text);
  const msg = await waitFor(async () => (await mcp("claude", "read_team_chat", { project: "buildp" })).json.find((m) => /✅ Codex finished "Add a FAQ page"/.test(m.text)), 15000, 300);
  assert.match(msg.text, /compare\/main\.\.\.team\//);
  assert.match(msg.text, /Added faq.html/);
  const branches = execSync("git branch --list 'team/*'", { cwd: path.join(tmp, "origin.git") }).toString();
  assert.match(branches, new RegExp(`team/${t.id}`));
});

test("self_update pulls new bridge code (restart switched off in tests)", async () => {
  execSync(`git clone -q origin.git other && cd other && git config user.email t@t && git config user.name t && echo v2 >> README.md && git commit -qam v2 && git push -q origin main`, { cwd: tmp, stdio: "pipe" });
  const r = await mcp("claude", "self_update");
  assert.ok(!r.error, r.text);
  assert.equal(r.json.updated, true);
  assert.equal(r.json.restarting, false);
  assert.equal((await mcp("claude", "self_update")).json.updated, false, "second time: already up to date");
});

test("Telegram is the group chat: your message goes in, every teammate's reply comes back to Telegram", async () => {
  const sentBefore = tgSent.length;
  tgText("@claude hello from my phone");
  const reply = await waitFor(async () => (await mcp("chatgpt", "read_team_chat", { project: "default", limit: 10 })).json.find((m) => m.author === "claude" && /Happy to help/.test(m.text)), 8000, 300);
  assert.ok(reply);
  const pushed = await waitFor(() => tgSent.slice(sentBefore).find((m) => m.method === "sendMessage" && /^🟣 Claude: Of course/.test(m.text)), 8000, 200);
  assert.ok(pushed, "Claude's reply was pushed to Telegram");
  assert.ok(tgSent.slice(sentBefore).some((m) => /In the group chat\. Answering: claude/.test(m.text || "")));
});

test("hub shell and classic dashboard coexist without exposing project data", async () => {
  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /Shahed’s Hub/);
  assert.match(html, /id="loginForm"/);
  assert.match(html, /src="\/hub.js"/);
  const classic = await fetch(`${base}/classic`);
  assert.equal(classic.status, 200);
  assert.match(await classic.text(), /Team Bridge/);
  assert.equal((await fetch(`${base}/hub.css`)).status, 200);
  assert.equal((await fetch(`${base}/api/projects`)).status, 401);
  assert.equal((await fetch(`${base}/api/files?project=hub-a`)).status, 401);
  assert.equal((await fetch(`${base}/mcp`)).status, 405);
});

test("hub APIs isolate chat and versioned files by project", async () => {
  await api('projects', 'POST', {name:'hub-a',description:'First project'});
  await api('projects', 'POST', {name:'hub-b',description:'Second project'});
  await api('chat','POST',{project:'hub-a',text:'Only project A',to:'none'});
  await api('file','POST',{project:'hub-a',path:'notes.html',content:'<script>not executable</script>'});
  await api('file','POST',{project:'hub-a',path:'notes.html',content:'Updated text'});
  assert.ok((await api('chat?project=hub-a')).body.some(m=>m.text==='Only project A'));
  assert.deepEqual((await api('chat?project=hub-b')).body,[]);
  assert.deepEqual((await api('files?project=hub-b')).body,[]);
  assert.equal((await api('files?project=hub-a')).body[0].version,2);
  assert.equal((await api('file?project=hub-a&path=notes.html')).body.content,'Updated text');
  assert.equal((await api('file?project=hub-b&path=notes.html')).status,400);
});

test("self_update rolls back when the new version can't start", async () => {
  execSync(`cd other && git pull -q && printf 'throw new Error("broken build")\\n' > server.js && git add . && git commit -qm broken && git push -q origin main`, { cwd: tmp, stdio: "pipe", shell: "/bin/bash" });
  const before = execSync("git rev-parse --short HEAD", { cwd: path.join(tmp, "live") }).toString().trim();
  const r = (await mcp("claude", "self_update")).json;
  assert.equal(r.updated, false);
  assert.equal(r.rolled_back, true);
  assert.match(r.error, /didn't start/);
  assert.equal(execSync("git rev-parse --short HEAD", { cwd: path.join(tmp, "live") }).toString().trim(), before, "still on the old version");
});

test("hub remembers a device with a signed cookie, never the token itself", async () => {
  const get = async (url, opts) => { // the shared per-IP rate limit may still be full from earlier tests
    for (let i = 0; ; i++) { const r = await fetch(url, opts); if (r.status !== 429 || i > 30) return r; await new Promise((ok) => setTimeout(ok, 2000)); }
  };
  assert.equal((await get(`${base}/api/login`, { method: "POST" })).status, 401);
  const r = await get(`${base}/api/login`, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: "{}" });
  assert.equal((await r.json()).remembered, true);
  const set = r.headers.get("set-cookie");
  assert.match(set, /^hub_device=\d+\.[\w-]+; Path=\/api; HttpOnly; SameSite=Strict; Max-Age=\d+/);
  assert.ok(!set.includes(TOKEN));
  const cookie = set.split(";")[0];
  assert.equal((await get(`${base}/api/projects`, { headers: { Cookie: cookie } })).status, 200);
  const [exp, mac] = cookie.slice("hub_device=".length).split(".");
  assert.equal((await get(`${base}/api/projects`, { headers: { Cookie: `hub_device=${Number(exp) + 1}.${mac}` } })).status, 401, "tampered cookie");
  assert.equal((await get(`${base}/mcp?agent=claude`, { method: "POST", headers: { Cookie: cookie } })).status, 401, "device cookie doesn't open MCP");
  const out = await get(`${base}/api/logout`, { method: "POST" });
  assert.match(out.headers.get("set-cookie"), /hub_device=; .*Max-Age=0/);
});
