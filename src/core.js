// All bridge operations. Used by both the MCP tools and the dashboard API.
import { randomUUID } from "node:crypto";
import { all, get, run, db } from "./db.js";
import { ask, embed, spend, webSearch } from "./llm.js";
import { notify } from "./notify.js";

const id = () => randomUUID().slice(0, 8);
const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const APPROVAL_ACTIONS = new Set((process.env.REQUIRE_APPROVAL ?? "forget,delete_file,create_schedule,delete_task").split(",").filter(Boolean));
const MAX_AI_CALLS_PER_MIN = Number(process.env.MAX_AI_CALLS_PER_MIN || 20);
const callTimes = [];

export function log(actor, action, detail = "") {
  run("INSERT INTO activity (actor, action, detail) VALUES (?,?,?)", actor, action, String(detail).slice(0, 500));
}

// Stops ChatGPT and Claude from ping-ponging forever.
function loopGuard() {
  const t = Date.now();
  while (callTimes.length && t - callTimes[0] > 60_000) callTimes.shift();
  if (callTimes.length >= MAX_AI_CALLS_PER_MIN) throw new Error(`Loop limit: ${MAX_AI_CALLS_PER_MIN} AI-to-AI calls per minute reached. Wait or raise MAX_AI_CALLS_PER_MIN.`);
  callTimes.push(t);
}

// ---------- tasks ----------
export function createTask({ title, details = "", assignee = "anyone", project = "default", parent = null }, actor) {
  const t = { id: id(), title, details, assignee, project, parent };
  run("INSERT INTO tasks (id, project, title, details, assignee, parent) VALUES (?,?,?,?,?,?)", t.id, project, title, details, assignee, parent);
  log(actor, "create_task", `${t.id} ${title} -> ${assignee}`);
  return getTask(t.id);
}
export function getTask(tid) {
  const t = get("SELECT * FROM tasks WHERE id = ?", tid);
  if (t) t.notes = all("SELECT author, note, at FROM task_notes WHERE task_id = ? ORDER BY id", tid);
  return t;
}
export function listTasks({ project, status, assignee } = {}) {
  return all("SELECT * FROM tasks ORDER BY updated DESC").filter((t) =>
    (!project || t.project === project) && (!status || t.status === status) && (!assignee || t.assignee === assignee))
    .map((t) => ({ ...t, notes: all("SELECT author, note, at FROM task_notes WHERE task_id = ? ORDER BY id", t.id) }));
}
export function updateTask({ id: tid, note, status, assignee }, actor) {
  if (!get("SELECT id FROM tasks WHERE id = ?", tid)) throw new Error(`No task ${tid}`);
  if (note) run("INSERT INTO task_notes (task_id, author, note) VALUES (?,?,?)", tid, actor, note);
  if (status) run("UPDATE tasks SET status = ? WHERE id = ?", status, tid);
  if (assignee) run("UPDATE tasks SET assignee = ? WHERE id = ?", assignee, tid);
  run("UPDATE tasks SET updated = ? WHERE id = ?", now(), tid);
  log(actor, "update_task", `${tid} ${status || ""} ${assignee ? "-> " + assignee : ""} ${note || ""}`);
  if (status === "done") notify(`Task done by ${actor}: ${get("SELECT title FROM tasks WHERE id = ?", tid).title}`);
  return getTask(tid);
}
export function deleteTask({ id: tid }, actor) {
  run("DELETE FROM task_notes WHERE task_id = ?", tid);
  run("DELETE FROM tasks WHERE id = ?", tid);
  log(actor, "delete_task", tid);
  return `Deleted task ${tid}`;
}
export function handoff({ id: tid, to, summary }, actor) {
  return updateTask({ id: tid, assignee: to, status: "open", note: `HANDOFF to ${to}: ${summary}` }, actor);
}

// ---------- memory ----------
const cosine = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] ** 2; y += b[i] ** 2; } return d / Math.sqrt(x * y); };
const parseMem = (m) => ({ ...m, tags: JSON.parse(m.tags), pinned: !!m.pinned, embedding: undefined });

export async function remember({ text, tags = [], project = "default", pinned = false }, actor) {
  const m = { id: id(), text };
  const e = await embed(text);
  run("INSERT INTO memories (id, project, text, author, tags, pinned, embedding) VALUES (?,?,?,?,?,?,?)",
    m.id, project, text, actor, JSON.stringify(tags), pinned ? 1 : 0, e ? JSON.stringify(e) : null);
  log(actor, "remember", text);
  return parseMem(get("SELECT * FROM memories WHERE id = ?", m.id));
}
export async function recall({ query = "", project, tag, limit = 20 } = {}) {
  let rows = all("SELECT * FROM memories ORDER BY pinned DESC, at DESC")
    .filter((m) => (!project || m.project === project || m.project === "default") && (!tag || JSON.parse(m.tags).includes(tag)));
  if (!query) return rows.slice(0, limit).map(parseMem);
  const qe = await embed(query);
  if (qe) {
    // Meaning-based search when embeddings are available.
    rows = rows.map((m) => ({ m, s: m.embedding ? cosine(qe, JSON.parse(m.embedding)) : 0 })).sort((a, b) => b.s - a.s).map((x) => x.m);
    return rows.slice(0, limit).map(parseMem);
  }
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.map((m) => ({ m, s: words.filter((w) => m.text.toLowerCase().includes(w)).length })).filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s).slice(0, limit).map((x) => parseMem(x.m));
}
export function updateMemory({ id: mid, text, pinned, tags, project }, actor) {
  const m = get("SELECT * FROM memories WHERE id = ?", mid);
  if (!m) throw new Error(`No memory ${mid}`);
  run("UPDATE memories SET text = ?, pinned = ?, tags = ?, project = ? WHERE id = ?", text ?? m.text,
    pinned == null ? m.pinned : pinned ? 1 : 0, tags ? JSON.stringify(tags) : m.tags, project ?? m.project, mid);
  log(actor, "update_memory", mid);
  return parseMem(get("SELECT * FROM memories WHERE id = ?", mid));
}
export function forget({ id: mid }, actor) {
  const r = run("DELETE FROM memories WHERE id = ?", mid);
  log(actor, "forget", mid);
  return r.changes ? `Forgot ${mid}` : `No memory ${mid}`;
}
export function exportMemories() {
  return all("SELECT * FROM memories ORDER BY at").map(parseMem);
}
// Accepts a JSON array (strings or {text,...}) or plain text with one memory per line (e.g. a pasted ChatGPT memory list).
export async function importMemories({ data, project = "default", source = "import" }, actor) {
  let items;
  try { items = JSON.parse(data); } catch { items = data.split("\n").map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim()).filter(Boolean); }
  if (!Array.isArray(items)) items = [items];
  let n = 0;
  for (const it of items) {
    const text = typeof it === "string" ? it : it.text || it.content;
    if (!text) continue;
    await remember({ text, tags: [source, ...(it.tags || [])], project: it.project || project, pinned: !!it.pinned }, actor);
    n++;
  }
  return `Imported ${n} memories`;
}
async function absorb(reply, author, project) {
  for (const m of reply.matchAll(/^REMEMBER:\s*(.+)$/gm)) await remember({ text: m[1].trim(), project, tags: ["auto"] }, author);
}

// ---------- profile, roles, projects ----------
export const getProfile = () => Object.fromEntries(all("SELECT key, value FROM profile").map((r) => [r.key, r.value]));
export function setProfile({ key, value }, actor) {
  if (value === "" || value == null) run("DELETE FROM profile WHERE key = ?", key);
  else run("INSERT INTO profile VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
  log(actor, "set_profile", `${key}=${value}`);
  return getProfile();
}
export const getRoles = () => Object.fromEntries(all("SELECT agent, role FROM roles").map((r) => [r.agent, r.role]));
export function setRole({ agent, role }, actor) {
  run("INSERT INTO roles VALUES (?, ?) ON CONFLICT(agent) DO UPDATE SET role = excluded.role", agent, role);
  log(actor, "set_role", `${agent}: ${role}`);
  return getRoles();
}
export const listProjects = () => all("SELECT * FROM projects ORDER BY created").map((p) => ({ ...p, ...spend(p.name) }));
export function saveProject({ name, description, lead, claude_model, gpt_model, temperature, budget_usd }, actor) {
  const p = get("SELECT * FROM projects WHERE name = ?", name) || {};
  run(`INSERT INTO projects (name, description, lead, claude_model, gpt_model, temperature, budget_usd) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(name) DO UPDATE SET description=excluded.description, lead=excluded.lead, claude_model=excluded.claude_model,
       gpt_model=excluded.gpt_model, temperature=excluded.temperature, budget_usd=excluded.budget_usd`,
    name, description ?? p.description ?? "", lead ?? p.lead ?? "anyone", claude_model ?? p.claude_model ?? null,
    gpt_model ?? p.gpt_model ?? null, temperature ?? p.temperature ?? null, budget_usd ?? p.budget_usd ?? null);
  log(actor, "save_project", name);
  return get("SELECT * FROM projects WHERE name = ?", name);
}

// ---------- skills (shared playbooks) ----------
export const listSkills = () => all("SELECT * FROM skills ORDER BY name");
export function saveSkill({ name, description, steps }, actor) {
  run(`INSERT INTO skills (name, description, steps, author, updated) VALUES (?,?,?,?,?)
       ON CONFLICT(name) DO UPDATE SET description=excluded.description, steps=excluded.steps, author=excluded.author, updated=excluded.updated`,
    name, description, steps, actor, now());
  log(actor, "save_skill", name);
  return get("SELECT * FROM skills WHERE name = ?", name);
}
export function deleteSkill({ name }, actor) { run("DELETE FROM skills WHERE name = ?", name); log(actor, "delete_skill", name); return `Deleted skill ${name}`; }
export async function runSkill({ name, input = "", agent = "claude", project = "default" }, actor) {
  const s = get("SELECT * FROM skills WHERE name = ?", name);
  if (!s) throw new Error(`No skill ${name}`);
  return askAgent({ agent, project, prompt: `Follow this playbook exactly.\n\nPLAYBOOK "${s.name}": ${s.description}\n${s.steps}\n\nINPUT:\n${input}` }, actor);
}

// ---------- shared files (versioned) ----------
export function writeFile({ path, content, project = "default" }, actor) {
  const v = (get("SELECT MAX(version) v FROM files WHERE project = ? AND path = ?", project, path)?.v || 0) + 1;
  run("INSERT INTO files (path, project, version, content, author) VALUES (?,?,?,?,?)", path, project, v, content, actor);
  log(actor, "write_file", `${project}/${path} v${v}`);
  return { path, project, version: v, bytes: content.length };
}
export function readFile({ path, project = "default", version }) {
  const f = version
    ? get("SELECT * FROM files WHERE project = ? AND path = ? AND version = ?", project, path, version)
    : get("SELECT * FROM files WHERE project = ? AND path = ? ORDER BY version DESC LIMIT 1", project, path);
  if (!f || f.deleted) throw new Error(`No file ${path}`);
  return f;
}
export function listFiles({ project = "default" } = {}) {
  return all(`SELECT f.path, f.version, f.author, f.at, LENGTH(f.content) bytes FROM files f
    WHERE f.project = ? AND f.version = (SELECT MAX(version) FROM files WHERE project = f.project AND path = f.path) AND f.deleted = 0 ORDER BY f.path`, project);
}
export const fileHistory = ({ path, project = "default" }) =>
  all("SELECT version, author, at, LENGTH(content) bytes, deleted FROM files WHERE project = ? AND path = ? ORDER BY version DESC", project, path);
export function deleteFile({ path, project = "default" }, actor) {
  const v = (get("SELECT MAX(version) v FROM files WHERE project = ? AND path = ?", project, path)?.v || 0) + 1;
  run("INSERT INTO files (path, project, version, content, author, deleted) VALUES (?,?,?,'',?,1)", path, project, v, actor);
  log(actor, "delete_file", `${project}/${path}`);
  return `Deleted ${path} (history kept)`;
}

// ---------- coworker calls ----------
export async function askAgent({ agent, prompt, project = "default" }, actor) {
  loopGuard();
  log(actor, `ask_${agent}`, prompt);
  const reply = await ask(agent, prompt, { project });
  await absorb(reply, agent, project);
  return reply;
}
// Both answer, critique each other, then one writes the final answer.
export async function debate({ question, rounds = 1, project = "default", judge = "claude" }, actor) {
  log(actor, "debate", question);
  let a = await askAgent({ agent: "claude", prompt: question, project }, actor);
  let b = await askAgent({ agent: "chatgpt", prompt: question, project }, actor);
  const transcript = [`## Claude\n${a}`, `## ChatGPT\n${b}`];
  for (let i = 0; i < rounds; i++) {
    const [a2, b2] = await Promise.all([
      askAgent({ agent: "claude", project, prompt: `Question: ${question}\n\nYour answer:\n${a}\n\nChatGPT's answer:\n${b}\n\nCritique ChatGPT's answer and improve yours.` }, actor),
      askAgent({ agent: "chatgpt", project, prompt: `Question: ${question}\n\nYour answer:\n${b}\n\nClaude's answer:\n${a}\n\nCritique Claude's answer and improve yours.` }, actor),
    ]);
    a = a2; b = b2;
    transcript.push(`## Round ${i + 1} — Claude\n${a}`, `## Round ${i + 1} — ChatGPT\n${b}`);
  }
  const final = await askAgent({ agent: judge, project, prompt: `Question: ${question}\n\nAnswer A (Claude):\n${a}\n\nAnswer B (ChatGPT):\n${b}\n\nWrite the single best final answer, combining the strongest points. Note any remaining disagreement.` }, actor);
  return `${transcript.join("\n\n")}\n\n## Final answer\n${final}`;
}
// One drafts, the other reviews, the first revises.
export async function review({ request, drafter = "chatgpt", project = "default" }, actor) {
  const reviewer = drafter === "claude" ? "chatgpt" : "claude";
  const draft = await askAgent({ agent: drafter, prompt: request, project }, actor);
  const critique = await askAgent({ agent: reviewer, project, prompt: `Review this work strictly. List concrete problems and fixes.\n\nRequest: ${request}\n\nDraft:\n${draft}` }, actor);
  const final = await askAgent({ agent: drafter, project, prompt: `Request: ${request}\n\nYour draft:\n${draft}\n\nReviewer feedback:\n${critique}\n\nProduce the revised final version.` }, actor);
  return `## Draft (${drafter})\n${draft}\n\n## Review (${reviewer})\n${critique}\n\n## Final (${drafter})\n${final}`;
}
// Ask the project lead to break a job into subtasks and assign them.
export async function splitTask({ goal, project = "default", planner = "claude" }, actor) {
  const reply = await askAgent({ agent: planner, project, prompt: `Break this goal into 2-8 concrete subtasks and assign each to "claude" or "chatgpt" based on their roles.
Reply ONLY with JSON: [{"title":"...","details":"...","assignee":"claude|chatgpt"}]\n\nGoal: ${goal}` }, actor);
  const json = reply.match(/\[[\s\S]*\]/);
  if (!json) throw new Error(`Planner did not return a task list:\n${reply}`);
  const parent = createTask({ title: goal, project, assignee: "anyone" }, actor);
  const subs = JSON.parse(json[0]).map((s) => createTask({ ...s, project, parent: parent.id }, planner));
  return { parent, subtasks: subs };
}
// Have an agent work an assigned task now and record the result on it.
export async function workTask({ id: tid, agent }, actor) {
  const t = getTask(tid);
  if (!t) throw new Error(`No task ${tid}`);
  const who = agent || (t.assignee === "anyone" ? "claude" : t.assignee);
  updateTask({ id: tid, status: "in_progress" }, who);
  const notes = t.notes.map((n) => `- ${n.author}: ${n.note}`).join("\n");
  const result = await askAgent({ agent: who, project: t.project, prompt: `Do this task and give the finished result.\n\nTask: ${t.title}\n${t.details}\n\nNotes so far:\n${notes || "(none)"}` }, actor);
  return updateTask({ id: tid, status: "done", note: result }, who);
}

// ---------- team chat ----------
export const listMessages = ({ project = "default", limit = 100 } = {}) =>
  all("SELECT * FROM messages WHERE project = ? ORDER BY id DESC LIMIT ?", project, limit).reverse();
export function postMessage({ text, project = "default" }, actor) {
  run("INSERT INTO messages (project, author, text) VALUES (?,?,?)", project, actor, text);
  return listMessages({ project, limit: 1 })[0];
}
// Chat in one space: the human talks, chosen agent(s) reply with the thread as context.
export async function teamChat({ text, to = "both", project = "default" }, actor = "human") {
  postMessage({ text, project }, actor);
  if (to === "debate") { const r = await debate({ question: text, project }, actor); return [postMessage({ text: r, project }, "team")]; }
  const thread = listMessages({ project, limit: 30 }).slice(0, -1).map((m) => `${m.author}: ${m.text}`).join("\n\n");
  const prompt = `Team chat so far:\n${thread || "(start)"}\n\n${actor}: ${text}\n\nReply as yourself in the team chat.`;
  const agents = to === "both" ? ["claude", "chatgpt"] : [to];
  const replies = await Promise.all(agents.map((a) => askAgent({ agent: a, prompt, project }, actor).catch((e) => `(error: ${e.message})`)));
  return agents.map((a, i) => postMessage({ text: replies[i], project }, a));
}

// ---------- web ----------
export async function fetchUrl({ url }, actor) {
  log(actor, "fetch_url", url);
  const r = await fetch(url, { headers: { "User-Agent": "vg-hoster-bridge" }, signal: AbortSignal.timeout(20000) });
  const body = await r.text();
  const text = body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return `HTTP ${r.status}\n${text.slice(0, 20000)}`;
}
export async function search({ query, project = "default" }, actor) { log(actor, "web_search", query); return webSearch(query, project); }

// ---------- activity, usage, approvals ----------
export const activity = ({ limit = 100 } = {}) => all("SELECT * FROM activity ORDER BY id DESC LIMIT ?", limit);
export const usage = () => ({ ...spend(), by_model: all("SELECT model, SUM(input_tokens) input_tokens, SUM(output_tokens) output_tokens, SUM(cost_usd) cost_usd FROM usage GROUP BY model") });

const RISKY = {}; // filled by registerRisky
export const registerRisky = (name, fn) => { RISKY[name] = fn; };
// AI-initiated risky actions wait for the human's OK in the dashboard.
export async function guarded(name, args, actor) {
  if (actor !== "human" && APPROVAL_ACTIONS.has(name)) {
    const aid = id();
    run("INSERT INTO approvals (id, actor, action, args) VALUES (?,?,?,?)", aid, actor, name, JSON.stringify(args));
    log(actor, "approval_requested", `${name} ${JSON.stringify(args)}`);
    notify(`${actor} wants to run ${name}. Approve in the dashboard.`);
    return `Needs the human's approval (request ${aid}). It will run once approved in the dashboard.`;
  }
  return RISKY[name](args, actor);
}
export const listApprovals = () => all("SELECT * FROM approvals ORDER BY at DESC LIMIT 100");
export async function decideApproval({ id: aid, approve }) {
  const a = get("SELECT * FROM approvals WHERE id = ? AND status = 'pending'", aid);
  if (!a) throw new Error(`No pending approval ${aid}`);
  let result = "rejected";
  if (approve) result = String(await RISKY[a.action](JSON.parse(a.args), a.actor));
  run("UPDATE approvals SET status = ?, result = ? WHERE id = ?", approve ? "approved" : "rejected", result, aid);
  log("human", approve ? "approved" : "rejected", `${a.action} from ${a.actor}`);
  return result;
}
registerRisky("forget", forget);
registerRisky("delete_file", deleteFile);
registerRisky("delete_task", deleteTask);

export { db };
