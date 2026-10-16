// VG-hoster bridge: MCP server for ChatGPT + Claude, plus a dashboard where you work with both.
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMcp } from "./src/mcp.js";
import * as core from "./src/core.js";
import * as sched from "./src/scheduler.js";
import { db, DB_FILE } from "./src/db.js";
import { anthropic, openai } from "./src/llm.js";
import { notify } from "./src/notify.js";

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.BRIDGE_TOKEN;
const RATE_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN || 120);
if (!TOKEN) console.warn("WARNING: BRIDGE_TOKEN not set — anyone with the URL can use the bridge.");

const app = express();
app.use(express.json({ limit: "10mb" }));

// Simple per-IP rate limit.
const hits = new Map();
app.use((req, res, next) => {
  const key = req.ip, t = Date.now(), list = (hits.get(key) || []).filter((x) => t - x < 60_000);
  list.push(t); hits.set(key, list);
  if (list.length > RATE_PER_MIN) return res.status(429).json({ error: "rate limited" });
  next();
});

const tokenOf = (req) => req.query.token || (req.headers.authorization || "").replace(/^Bearer /, "") ||
  (req.headers.cookie || "").match(/(?:^|;\s*)bridge_token=([^;]+)/)?.[1];
const auth = (req, res, next) => (!TOKEN || decodeURIComponent(tokenOf(req) || "") === TOKEN ? next() : res.status(401).json({ error: "unauthorized" }));

app.get("/health", (_req, res) => res.json({ ok: true, claude: !!anthropic, chatgpt: !!openai, db: DB_FILE }));

// ---- MCP endpoint (stateless). Use ?agent=chatgpt or ?agent=claude on each connector URL. ----
app.post("/mcp", auth, async (req, res) => {
  const actor = ["claude", "chatgpt"].includes(req.query.agent) ? req.query.agent : "unknown-agent";
  const server = buildMcp(actor);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.get("/mcp", (_req, res) => res.status(405).set("Allow", "POST").end());

// ---- Dashboard API (you are "human") ----
const api = express.Router();
api.use(auth);
const h = (fn) => async (req, res) => { try { res.json(await fn({ ...req.query, ...req.body, ...req.params })); } catch (e) { res.status(400).json({ error: e.message }); } };
const H = "human";
api.get("/overview", h(() => ({ health: { claude: !!anthropic, chatgpt: !!openai }, usage: core.usage(), projects: core.listProjects(),
  pending: core.listApprovals().filter((a) => a.status === "pending").length })));
api.get("/chat", h((a) => core.listMessages(a)));
api.post("/chat", h((a) => core.teamChat(a, H)));
api.get("/tasks", h((a) => core.listTasks(a)));
api.post("/tasks", h((a) => core.createTask(a, H)));
api.patch("/tasks/:id", h((a) => core.updateTask(a, H)));
api.delete("/tasks/:id", h((a) => core.deleteTask(a, H)));
api.post("/tasks/:id/work", h((a) => core.workTask(a, H)));
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

sched.startScheduler();
app.listen(PORT, () => console.log(`Bridge on http://localhost:${PORT}  (dashboard /, MCP /mcp)`));
