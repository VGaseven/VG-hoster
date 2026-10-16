// Runs Claude Code and Codex on this computer, signed in with your Claude and ChatGPT subscriptions.
// No API keys: they are removed from the child's environment so the CLIs can't bill the API by accident.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Apps started at login get a short PATH, so also look where Claude Code and Codex usually install.
const EXTRA_DIRS = [path.join(os.homedir(), ".local/bin"), path.join(os.homedir(), ".claude/local"), "/opt/homebrew/bin", "/usr/local/bin", path.join(os.homedir(), ".npm-global/bin")];
function findBin(name) {
  if (name.includes("/")) return name;
  const dirs = [...(process.env.PATH || "").split(path.delimiter), ...EXTRA_DIRS];
  for (const d of dirs) { const f = path.join(d, name); try { fs.accessSync(f, fs.constants.X_OK); return f; } catch { /* keep looking */ } }
  return name;
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

function exec(bin, args, input, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env: cleanEnv(), cwd: os.tmpdir(), stdio: ["pipe", "pipe", "pipe"] });
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

// ---- who answers, and switching when a plan runs out ----
const resting = {}; // engine -> time its limit is expected to be over
const isResting = (e) => (resting[e] || 0) > Date.now();
const ENGINES = { claude: runClaude, codex: runCodex };
export const engineFor = (agent) => (agent === "claude" ? "claude" : "codex");

// Ask the engine for this agent; if its plan limit is hit, the other one answers instead.
export async function askViaCli(agent, opts) {
  const first = engineFor(agent), second = first === "claude" ? "codex" : "claude";
  const order = isResting(first) && !isResting(second) ? [second, first] : [first, second];
  let lastErr;
  for (const engine of order) {
    try {
      const text = await ENGINES[engine]({ ...opts, model: engine === first ? opts.model : undefined });
      delete resting[engine];
      return { text, engine, switched: engine !== first };
    } catch (e) {
      lastErr = e;
      if (!(e instanceof LimitError)) throw e;
      resting[engine] = Date.now() + COOLDOWN_MS;
    }
  }
  throw lastErr;
}

export const engineStatus = () => ({
  claude: isResting("claude") ? `resting until ${new Date(resting.claude).toLocaleTimeString()}` : "ready",
  codex: isResting("codex") ? `resting until ${new Date(resting.codex).toLocaleTimeString()}` : "ready",
});

// Quick check that both CLIs are installed and signed in. Costs one tiny message each.
export async function checkEngines() {
  const out = {};
  for (const [name, fn] of Object.entries(ENGINES)) {
    try { out[name] = { ok: true, reply: (await fn({ prompt: "Reply with just: ok", timeoutMs: 120_000 })).slice(0, 40) }; }
    catch (e) { out[name] = { ok: false, error: e.message }; }
  }
  return out;
}
