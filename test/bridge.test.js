// End-to-end tests: starts the real server against mock GitHub, Telegram and n8n endpoints. No API keys needed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TOKEN = "test-token", HOOK_SECRET = "hook-secret", CHAT = "42";
const tgQueue = [], tgSent = [], ghIssues = [], n8nCalls = [];
let mock, bridge, base, mockUrl, tmp, updateId = 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error("timed out"); await sleep(50); }
}

before(async () => {
  mock = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const json = (code, v) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(v)); };
      const b = body ? JSON.parse(body) : {};
      if (req.url === "/gh/repos/o/r/issues") { ghIssues.push(b); return json(201, { number: 7, html_url: "https://github.com/o/r/issues/7" }); }
      if (req.url === "/anth/v1/messages") return json(200, { id: "m1", type: "message", role: "assistant", model: b.model, stop_reason: "end_turn",
        content: [{ type: "text", text: "Of course! Happy to help the team." }], usage: { input_tokens: 10, output_tokens: 5 } });
      if (req.url === "/n8n/hook") { n8nCalls.push(b); return json(200, { ok: true }); }
      if (req.url === "/tg/botT/getUpdates") { if (!tgQueue.length) await sleep(100); return json(200, { ok: true, result: tgQueue.splice(0) }); }
      if (req.url.startsWith("/tg/botT/")) { tgSent.push({ method: req.url.split("/").pop(), ...b }); return json(200, { ok: true, result: {} }); }
      json(404, {});
    });
  }).listen(0);
  await new Promise((r) => mock.once("listening", r));
  mockUrl = `http://127.0.0.1:${mock.address().port}`;

  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-test-"));
  const port = 20000 + Math.floor(Math.random() * 20000);
  base = `http://127.0.0.1:${port}`;
  bridge = spawn(process.execPath, ["--no-warnings", "server.js"], {
    cwd: path.join(import.meta.dirname, ".."),
    env: { PATH: process.env.PATH, ANTHROPIC_API_KEY: "x", ANTHROPIC_BASE_URL: `${mockUrl}/anth`, PORT: String(port), BRIDGE_TOKEN: TOKEN, DB_FILE: path.join(tmp, "b.db"), TRUST_PROXY: "0",
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
