// Runs Claude Code and Codex on this computer, signed in with your Claude and ChatGPT subscriptions.
// No API keys: they are removed from the child's environment so the CLIs can't bill the API by accident.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Apps started at login get a short PATH, so also look where Claude Code and Codex usually install (Mac and Windows).
const WIN = process.platform === "win32";
const EXTRA_DIRS = [path.join(os.homedir(), ".local", "bin"), path.join(os.homedir(), ".claude", "local"), "/opt/homebrew/bin", "/usr/local/bin",
  path.join(os.homedir(), ".npm-global", "bin"), ...(process.env.APPDATA ? [path.join(process.env.APPDATA, "npm")] : [])];
const EXTS = WIN ? [".exe", ".cmd", ""] : [""];
// Returns { cmd, pre }: the program to start and any arguments that go before ours.
// Windows npm installs are .cmd files, which Node can't start safely with arguments, so we run their JavaScript with Node directly.
function findBin(name) {
  let file = name;
  if (!/[\\/]/.test(name)) {
    const dirs = [...(process.env.PATH || "").split(path.delimiter), ...EXTRA_DIRS];
    search: for (const d of dirs) for (const ext of EXTS) {
      const f = path.join(d, name + ext);
      try { fs.accessSync(f, fs.constants.X_OK); if (fs.statSync(f).isFile()) { file = f; break search; } } catch { /* keep looking */ }
    }
  }
  if (file.toLowerCase().endsWith(".cmd")) {
    const m = fs.readFileSync(file, "utf8").match(/%dp0%[\\/]?(node_modules[^"]+?\.(?:js|mjs|cjs))/i);
    if (m) return { cmd: process.execPath, pre: [path.join(path.dirname(file), m[1])] };
  }
  return { cmd: file, pre: [] };
}
const CLAUDE_BIN = findBin(process.env.CLAUDE_BIN || "claude");
const CODEX_BIN = findBin(process.env.CODEX_BIN || "codex");
const TIMEOUT_MS = Number(process.env.CLI_TIMEOUT_MIN || 10) * 60_000;
const MAX_PARALLEL = Number(process.env.CLI_MAX_PARALLEL || 2);
const COOLDOWN_MS = Number(process.env.LIMIT_COOLDOWN_MIN || 30) * 60_000;
const API_VARS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_API_KEY"];
const LIMIT_RE = /usage limit|session limit|rate limit|limit reached|hit your .*limit|quota|429|too many requests/i;

export class LimitError extends Error {}

function cleanEnv() {
  const env = { ...process.env, PATH: [process.env.PATH, ...EXTRA_DIRS].filter(Boolean).join(path.delimiter) };
  for (const k of API_VARS) delete env[k];
  return env;
}

// A small queue so the Mac runs at most MAX_PARALLEL AI jobs at once.
let running = 0;
const waiting = [];
async function slot(fn) {
  if (running >= MAX_PARALLEL) await new Promise((r) => waiting.push(r));
  running++;
  try { return await fn(); } finally { running--; waiting.shift()?.(); }
}

function exec({ cmd, pre }, args, input, timeoutMs = TIMEOUT_MS) {
  const bin = path.basename(pre[0] || cmd);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...pre, ...args], { env: cleanEnv(), cwd: os.tmpdir(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`${bin} took longer than ${Math.round(timeoutMs / 1000)}s (is it signed in?)`)); }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e.code === "ENOENT" ? new Error(`${bin} is not installed on this computer`) : e); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    child.stdin.end(input);
  });
}

function fail(name, text) {
  const msg = String(text || "").trim().slice(-800) || `${name} failed`;
  return LIMIT_RE.test(msg) ? new LimitError(`${name} hit its plan limit: ${msg}`) : new Error(`${name}: ${msg}`);
}

const flatten = (history, prompt) =>
  [...history.map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`), prompt].join("\n\n");

export async function runClaude({ system, prompt, history = [], model, web = false, timeoutMs }) {
  const args = ["-p", "--output-format", "json", "--no-session-persistence", "--strict-mcp-config",
    "--tools", web ? "WebSearch,WebFetch" : ""];
  if (web) args.push("--allowedTools", "WebSearch,WebFetch");
  if (system) args.push("--system-prompt", system);
  if (model) args.push("--model", model);
  const r = await slot(() => exec(CLAUDE_BIN, args, flatten(history, prompt), timeoutMs));
  let j = null;
  try { j = JSON.parse(r.out); } catch { /* not JSON: an error message */ }
  if (r.code !== 0 || !j || j.is_error) throw fail("Claude", j?.result || r.err || r.out);
  return String(j.result ?? "");
}

export async function runCodex({ system, prompt, history = [], model, timeoutMs }) {
  const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "codex-")), "last.txt");
  const args = ["exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--sandbox", "read-only", "--color", "never", "-o", outFile];
  if (model) args.push("--model", model);
  args.push("-");
  const input = (system ? `<instructions>\n${system}\n</instructions>\n\n` : "") + flatten(history, prompt);
  try {
    const r = await slot(() => exec(CODEX_BIN, args, input, timeoutMs));
    const text = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8").trim() : "";
    if (r.code !== 0 || !text) throw fail("Codex", r.err || r.out);
    return text;
  } finally { fs.rmSync(path.dirname(outFile), { recursive: true, force: true }); }
}

// ---- a free AI on this computer's own GPU (Ollama) ----
// Set LOCAL_MODEL (e.g. one you pulled with `ollama pull`) to turn it on. No plan limits; nothing leaves the computer.
const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
export const localEnabled = () => !!process.env.LOCAL_MODEL;
export async function runLocal({ system, prompt, history = [], timeoutMs = TIMEOUT_MS }) {
  if (!localEnabled()) throw new Error("The local AI is off (set LOCAL_MODEL)");
  const messages = [...(system ? [{ role: "system", content: system }] : []),
    ...history.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) })),
    { role: "user", content: prompt }];
  let r;
  try {
    r = await fetch(`${OLLAMA_URL}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.LOCAL_MODEL, messages, stream: false }), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) { throw new Error(`Local AI isn't running (${e.message}). Start Ollama on this computer.`); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`Local AI: ${j.error || r.status}`);
  return String(j.message?.content || "").replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
}

// ---- who answers, and switching when a plan runs out ----
const resting = {}; // engine -> time its limit is expected to be over
const isResting = (e) => (resting[e] || 0) > Date.now();
const ENGINES = { claude: runClaude, codex: runCodex, local: runLocal };
export const engineFor = (agent) => (agent === "claude" ? "claude" : agent === "local" ? "local" : "codex");

// Ask the engine for this agent. If its plan limit is hit, the other plan answers; if both are resting, the local AI does.
// A job given to the local AI goes to Codex, then Claude, if the local AI isn't running.
export async function askViaCli(agent, opts) {
  const first = engineFor(agent);
  let order;
  if (first === "local") order = ["local", "codex", "claude"];
  else {
    const second = first === "claude" ? "codex" : "claude";
    order = isResting(first) && !isResting(second) ? [second, first] : [first, second];
    if (localEnabled()) order.push("local");
  }
  let lastErr;
  for (const engine of order) {
    try {
      const text = await ENGINES[engine]({ ...opts, model: engine === first ? opts.model : undefined });
      delete resting[engine];
      return { text, engine, switched: engine !== first };
    } catch (e) {
      lastErr = e;
      const localDown = engine === "local" && first === "local";
      if (!(e instanceof LimitError) && !localDown) throw e;
      if (e instanceof LimitError) resting[engine] = Date.now() + COOLDOWN_MS;
    }
  }
  throw lastErr;
}

const restText = (e) => (isResting(e) ? `resting until ${new Date(resting[e]).toLocaleTimeString()}` : "ready");
export const engineStatus = () => ({ claude: restText("claude"), codex: restText("codex"), local: localEnabled() ? `on (${process.env.LOCAL_MODEL})` : "off" });

// Quick check that each engine is installed and signed in. Costs one tiny message each.
export async function checkEngines() {
  const out = {};
  for (const [name, fn] of Object.entries(ENGINES)) {
    if (name === "local" && !localEnabled()) continue;
    try { out[name] = { ok: true, reply: (await fn({ prompt: "Reply with just: ok", timeoutMs: 120_000 })).slice(0, 40) }; }
    catch (e) { out[name] = { ok: false, error: e.message }; }
  }
  return out;
}
