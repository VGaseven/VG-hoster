// VG-hoster bridge: MCP server for ChatGPT + Claude, plus a dashboard where you work with both.
import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMcp, AGENTS } from "./src/mcp.js";
import * as core from "./src/core.js";
import * as hub from "./src/hub.js";
import * as sched from "./src/scheduler.js";
import { db, DB_FILE } from "./src/db.js";
import { anthropic, openai, ENGINE } from "./src/llm.js";
import { engineStatus, checkEngines } from "./src/cli.js";
import { notify } from "./src/notify.js";
import { githubReady, verifySignature } from "./src/github.js";
import { listWorkflows } from "./src/n8n.js";
import { startTelegram } from "./src/telegram.js";

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.BRIDGE_TOKEN;
const RATE_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN || 120);
if (!TOKEN) console.warn("WARNING: BRIDGE_TOKEN not set — anyone with the URL can use the bridge.");

const app = express();
// Behind Render/Railway/Fly there is one proxy hop; this makes req.ip the real client. Set TRUST_PROXY=0 when exposed directly.
app.set("trust proxy", Number(process.env.TRUST_PROXY ?? 1));

// Simple per-IP rate limit.
const hits = new Map();
app.use((req, res, next) => {
  const key = req.ip, t = Date.now(), list = (hits.get(key) || []).filter((x) => t - x < 60_000);
  list.push(t); hits.set(key, list);
  if (list.length > RATE_PER_MIN) return res.status(429).json({ error: "rate limited" });
  next();
});
// Forget idle clients so the map can't grow forever.
setInterval(() => { const t = Date.now(); for (const [k, list] of hits) if (t - list[list.length - 1] > 60_000) hits.delete(k); }, 60_000).unref();

// ---- GitHub webhook: Claude Code progress (comments, PRs, closed issues) flows back onto tasks. Needs the raw body for the signature. ----
app.post("/github/webhook", express.raw({ type: "*/*", limit: "5mb" }), (req, res) => {
  if (!process.env.GITHUB_WEBHOOK_SECRET) return res.status(404).json({ error: "GitHub webhook not configured" });
  if (!verifySignature(req.body, req.get("x-hub-signature-256"))) return res.status(401).json({ error: "bad signature" });
  try { res.json({ result: core.handleGithubEvent(req.get("x-github-event"), JSON.parse(req.body.toString("utf8"))) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.use(express.json({ limit: "10mb" }));

const tokenOf = (req) => req.query.token || (req.headers.authorization || "").replace(/^Bearer /, "") ||
  (req.headers.cookie || "").match(/(?:^|;\s*)bridge_token=([^;]+)/)?.[1];
const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const digest = (s) => crypto.createHash("sha256").update(String(s)).digest();
const tokenOk = (given) => crypto.timingSafeEqual(digest(given), digest(TOKEN)); // constant-time compare
const auth = (req, res, next) => (!TOKEN || tokenOk(decode(tokenOf(req) || "")) ? next() : res.status(401).json({ error: "unauthorized" }));

// "Remember this device": a signed, httpOnly cookie for the hub, so the token itself is never stored in the browser.
// It only opens /api (not /mcp). Changing BRIDGE_TOKEN signs out every device.
const DEVICE_DAYS = Number(process.env.DEVICE_LOGIN_DAYS || 365);
const sign = (v) => crypto.createHmac("sha256", String(TOKEN)).update("hub-device:" + v).digest("base64url");
const deviceOk = (req) => {
  const [exp, mac] = ((req.headers.cookie || "").match(/(?:^|;\s*)hub_device=([^;]+)/)?.[1] || "").split(".");
  if (!exp || !mac || Number(exp) < Date.now()) return false;
  const a = Buffer.from(mac), b = Buffer.from(sign(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const deviceCookie = (req, value, maxAge) => `hub_device=${value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}` +
  (req.secure || req.get("x-forwarded-proto") === "https" ? "; Secure" : "");
const apiAuth = (req, res, next) => (TOKEN && deviceOk(req) ? next() : auth(req, res, next));

app.get("/health", (_req, res) => res.json({ ok: true }));

// ---- MCP endpoint (stateless). Use ?agent=chatgpt, ?agent=claude or ?agent=claude-code on each connector URL. ----
app.post("/mcp", auth, async (req, res) => {
  if (process.env.HUB_PREVIEW === "1") return res.status(403).json({error:"MCP is disabled in the isolated review preview"});
  const actor = AGENTS.includes(req.query.agent) ? req.query.agent : "unknown-agent";
  const server = buildMcp(actor);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.get("/mcp", (_req, res) => res.status(405).set("Allow", "POST").end());

// ---- Dashboard API (you are "human") ----
const api = express.Router();
api.post("/logout", (req, res) => res.set("Set-Cookie", deviceCookie(req, "", 0)).json({ ok: true }));
api.use(apiAuth);
// Explicit local review mode: no external actions, group mentions cannot wake agents.
if (process.env.HUB_PREVIEW === '1') api.use((req,res,next)=>{
 if(req.method==='GET'||['/direct','/sessions','/results'].includes(req.path))return next();
 if(req.path==='/chat')return res.json({posted:core.postMessage({text:String(req.body.text||''),project:req.body.project},'human'),answering:[]});
 return res.status(403).json({error:'Review preview: external actions disabled'});
});
api.post("/login", (req, res) => {
  if (!TOKEN || req.body?.remember === false) return res.json({ ok: true, remembered: false });
  const exp = String(Date.now() + DEVICE_DAYS * 86_400_000);
  res.set("Set-Cookie", deviceCookie(req, `${exp}.${sign(exp)}`, DEVICE_DAYS * 86_400)).json({ ok: true, remembered: true, days: DEVICE_DAYS });
});
const h = (fn) => async (req, res) => { try { res.json(await fn({ ...req.query, ...req.body, ...req.params })); } catch (e) { res.status(400).json({ error: e.message }); } };
const H = "human";
const sub = ENGINE === "subscription";
api.get("/overview", h(() => ({ health: { engine: ENGINE, engines: sub ? engineStatus() : null, claude: sub || !!anthropic, chatgpt: sub || !!openai, github: githubReady(), github_webhook: !!process.env.GITHUB_WEBHOOK_SECRET,
  telegram: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID), n8n: listWorkflows().map((w) => w.name) },
  usage: core.usage(), projects: core.listProjects(), pending: core.pendingApprovals().length,
  paused: core.isPaused(), paused_info: core.getSetting("paused_info") })));
api.get("/status", h((a) => core.teamStatus(a)));
api.post("/engines/check", h(() => checkEngines()));
api.post("/update", h((a) => core.updateBridge(a, H)));
api.post("/tasks/:id/build", h((a) => core.buildTaskById(a, H)));
api.post("/pause", h((a) => core.pauseAll(a, H)));
api.post("/resume", h((a) => core.resumeAll(a, H)));
api.get('/direct', h(hub.directMessages));
api.get('/direct-status', h(hub.directStatus));
api.post('/direct', h(hub.sendDirect));
api.get('/sessions', h(hub.sessions));
api.post('/sessions', h(hub.registerSession));
api.get('/results', h(hub.results));
api.post('/results', h(hub.setResult));
api.get('/decisions', h(hub.decisions));
api.get('/search', h(hub.search));
api.get('/chat-message', h(hub.message));
api.get('/children', h(hub.children));
api.post('/project-parent', h(hub.setParent));
api.get('/project-meta', h(hub.projectMeta));
api.post('/project-meta', h(hub.setProjectMeta));
api.get("/chat", h((a) => core.listMessages(a)));
api.post("/chat", h((a) => core.teamChat(a, H)));
api.get("/tasks", h((a) => core.listTasks(a)));
api.post("/tasks", h((a) => core.route(core.createTask(a, H), H)));
api.patch("/tasks/:id", h((a) => { const t = core.updateTask(a, H); return a.assignee ? core.route(t, H) : t; }));
api.delete("/tasks/:id", h((a) => core.deleteTask(a, H)));
api.post("/tasks/:id/work", h((a) => core.workTask(a, H)));
api.post("/tasks/:id/dispatch", h((a) => core.dispatchTask(a, H)));
api.post("/split", h((a) => core.splitTask(a, H)));
api.post("/debate", h((a) => core.debate(a, H)));
api.post("/review", h((a) => core.review(a, H)));
api.get("/memories", h((a) => core.recall({ ...a, limit: Number(a.limit || 500) })));
api.post("/memories", h((a) => core.remember({ ...a, pinned: !!a.pinned }, H)));
api.patch("/memories/:id", h((a) => core.updateMemory(a, H)));
api.delete("/memories/:id", h((a) => core.forget(a, H)));
api.get("/memories/export", (_req, res) => res.attachment("memories.json").json(core.exportMemories()));
api.post("/memories/import", h((a) => core.importMemories(a, H)));
api.get("/profile", h(() => ({ profile: core.getProfile(), roles: core.getRoles() })));
api.post("/profile", h((a) => core.setProfile(a, H)));
api.post("/roles", h((a) => core.setRole(a, H)));
api.get("/projects", h(() => core.listProjects()));
api.post("/projects", h((a) => core.saveProject(a, H)));
api.get("/skills", h(() => core.listSkills()));
api.post("/skills", h((a) => core.saveSkill(a, H)));
api.delete("/skills/:name", h((a) => core.deleteSkill(a, H)));
api.post("/skills/:name/run", h((a) => core.runSkill(a, H)));
api.get("/files", h((a) => core.listFiles(a)));
api.get("/file", h((a) => core.readFile(a)));
api.get("/file/history", h((a) => core.fileHistory(a)));
api.post("/file", h((a) => core.writeFile(a, H)));
api.delete("/file", h((a) => core.deleteFile(a, H)));
api.get("/schedules", h(() => sched.listSchedules()));
api.post("/schedules", h((a) => sched.createSchedule(a, H)));
api.patch("/schedules/:id", h((a) => sched.setSchedule(a, H)));
api.delete("/schedules/:id", h((a) => sched.deleteSchedule(a, H)));
api.post("/schedules/:id/run", h((a) => sched.runScheduleNow(a)));
api.get("/approvals", h(() => core.listApprovals()));
api.post("/approvals/:id", h((a) => core.decideApproval(a)));
api.get("/activity", h((a) => core.activity(a)));
api.post("/notify", h((a) => notify(a.message)));
api.post("/backup", h(() => backup()));
app.use("/api", api);

app.get("/classic", (_req, res) => res.sendFile(path.join(import.meta.dirname, "public/classic.html")));
app.use(express.static(path.join(import.meta.dirname, "public")));

// ---- Backups: daily snapshot, keep the last 7 ----
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(path.dirname(DB_FILE), "backups");
function backup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `bridge-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const old = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".db")).sort().slice(0, -7);
  for (const f of old) fs.unlinkSync(path.join(BACKUP_DIR, f));
  return { file };
}
setInterval(() => { try { backup(); } catch (e) { console.error("backup failed", e.message); } }, 24 * 3600_000).unref();

// TRIAL_START: a self-update test run of new code; it only has to answer /health, so it starts no background work.
if (!process.env.TRIAL_START) sched.startScheduler();
if (!process.env.TRIAL_START && startTelegram()) console.log("Telegram remote control on (/status, /approvals, /pause, /resume)");
app.listen(PORT, process.env.HOST || "0.0.0.0", () => console.log(`Bridge on http://localhost:${PORT}  (dashboard /, MCP /mcp)`));
