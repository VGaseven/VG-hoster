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
const { askViaCli, engineStatus } = await import("../src/cli.js");

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
