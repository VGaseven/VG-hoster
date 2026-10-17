// Subscription engine: fake "claude" and "codex" programs stand in for the real CLIs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-test-"));
const stub = (name, body) => { const f = path.join(dir, name); fs.writeFileSync(f, `#!/usr/bin/env node\n${body}`); fs.chmodSync(f, 0o755); return f; };
// Fake Claude: fails with a plan limit when CLAUDE_STATE says so; echoes whether an API key leaked through.
const claude = stub("claude", `
const fs = require("fs"); let input = ""; process.stdin.on("data", (d) => (input += d)).on("end", () => {
  if (fs.readFileSync(process.env.CLAUDE_STATE, "utf8") === "limit") { console.log(JSON.stringify({ is_error: true, result: "You've hit your session limit · resets 8pm" })); process.exit(1); }
  console.log(JSON.stringify({ is_error: false, result: "claude says hi; key=" + (process.env.ANTHROPIC_API_KEY || "none") + "; sys=" + process.argv.includes("--system-prompt") }));
});`);
const codex = stub("codex", `
const fs = require("fs"); let input = ""; process.stdin.on("data", (d) => (input += d)).on("end", () => {
  const out = process.argv[process.argv.indexOf("-o") + 1];
  fs.writeFileSync(out, "codex says hi; key=" + (process.env.OPENAI_API_KEY || "none") + "; got=" + input.includes("<instructions>"));
});`);
const state = path.join(dir, "state");
fs.writeFileSync(state, "ok");
Object.assign(process.env, { CLAUDE_BIN: claude, CODEX_BIN: codex, CLAUDE_STATE: state, ANTHROPIC_API_KEY: "secret", OPENAI_API_KEY: "secret" });
import http from "node:http";
// Fake Ollama for the local AI.
const ollama = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)).on("end", () => {
  const j = JSON.parse(b); res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: { content: `<think>hmm</think>local says hi to ${j.messages.at(-1).content} with ${j.model}` } }));
}); }).listen(0);
await new Promise((r) => ollama.once("listening", r));
process.env.OLLAMA_URL = `http://127.0.0.1:${ollama.address().port}`;
const { askViaCli, engineStatus } = await import("../src/cli.js");
import { after } from "node:test";
after(() => ollama.close());

test("each agent answers on its own subscription, with API keys hidden", async () => {
  const c = await askViaCli("claude", { system: "be nice", prompt: "hi" });
  assert.equal(c.engine, "claude"); assert.equal(c.switched, false);
  assert.match(c.text, /key=none; sys=true/);
  const g = await askViaCli("chatgpt", { system: "be nice", prompt: "hi" });
  assert.equal(g.engine, "codex");
  assert.match(g.text, /key=none; got=true/);
});

test("when Claude hits its plan limit, Codex answers and Claude rests", async () => {
  fs.writeFileSync(state, "limit");
  const r = await askViaCli("claude", { prompt: "hi" });
  assert.equal(r.engine, "codex"); assert.equal(r.switched, true);
  assert.match(engineStatus().claude, /resting/);
  // While resting, Codex goes first without trying Claude again.
  fs.writeFileSync(state, "ok");
  const r2 = await askViaCli("claude", { prompt: "hi" });
  assert.equal(r2.engine, "codex");
});

test("the local AI answers its own jobs, and covers when both plans are resting", async () => {
  process.env.LOCAL_MODEL = "tiny";
  const r = await askViaCli("local", { prompt: "you" });
  assert.equal(r.engine, "local"); assert.equal(r.text, "local says hi to you with tiny");
  fs.writeFileSync(state, "limit");
  // Claude is still resting from the earlier test; Codex is fine, so Codex answers first.
  assert.equal((await askViaCli("claude", { prompt: "x" })).engine, "codex");
  delete process.env.LOCAL_MODEL;
  fs.writeFileSync(state, "ok");
});

test("Windows npm .cmd launchers are run through Node", async () => {
  const win = fs.mkdtempSync(path.join(os.tmpdir(), "cli-win-"));
  const js = path.join(win, "node_modules", "@openai", "codex", "bin", "codex.js");
  fs.mkdirSync(path.dirname(js), { recursive: true });
  fs.writeFileSync(js, `const fs = require("fs"); process.stdin.resume().on("end", () => fs.writeFileSync(process.argv[process.argv.indexOf("-o") + 1], "from cmd shim"));`);
  const cmd = path.join(win, "codex.cmd");
  const rel = ["node_modules", "@openai", "codex", "bin", "codex.js"].join(path.sep === "/" ? "/" : "\\");
  fs.writeFileSync(cmd, `@ECHO off\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%${path.sep}${rel}" %*\r\n`);
  process.env.CODEX_BIN = cmd;
  const fresh = await import(`../src/cli.js?win=${Date.now()}`);
  assert.equal(await fresh.runCodex({ prompt: "hi" }), "from cmd shim");
});
