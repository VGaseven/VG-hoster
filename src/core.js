// All bridge operations. Used by both the MCP tools and the dashboard API.
import { randomUUID } from "node:crypto";
import { all, get, run, db } from "./db.js";
import { ask, embed, spend, webSearch } from "./llm.js";
import { notify } from "./notify.js";
import { safeFetchText } from "./safefetch.js";
import { createIssue, githubReady, REPO_RE } from "./github.js";

const id = () => randomUUID().slice(0, 8);
const stamp = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);
const now = () => stamp(Date.now());
const MAX_AI_CALLS_PER_MIN = Number(process.env.MAX_AI_CALLS_PER_MIN || 20);
const callTimes = [];

export function log(actor, action, detail = "") {
  run("INSERT INTO activity (actor, action, detail) VALUES (?,?,?)", actor, action, String(detail).slice(0, 500));
}

// ---------- settings & kill switch ----------
export const getSetting = (key, fallback = null) => get("SELECT value FROM settings WHERE key = ?", key)?.value ?? fallback;
const setSetting = (key, value) => run("INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, String(value));
export const isPaused = () => getSetting("paused") === "1";
export function assertRunning() {
  if (isPaused()) throw new Error("The team is paused by the human (kill switch). Only read-only tools work until the human resumes.");
}
// Anyone may pull the brake; only the human may release it.
export function pauseAll({ reason = "" } = {}, actor) {
  setSetting("paused", "1");
  setSetting("paused_info", `${actor} at ${now()}${reason ? ": " + reason : ""}`);
  log(actor, "pause_all", reason);
  notify(`⛔ All AI work paused by ${actor}${reason ? ": " + reason : ""}.\nResume from the dashboard or send /resume here.`);
  return "Paused. All AI work is stopped until the human resumes it.";
}
export function resumeAll(_args, actor) {
  if (actor !== "human") throw new Error("Only the human can resume the team.");
  setSetting("paused", "0");
  log(actor, "resume_all");
  notify("▶️ Team resumed.");
  return "Resumed.";
}

// ---------- approval levels ----------
// 🔴 red: an AI must get the human's OK first.  🟡 yellow: runs, and the human is notified.  🟢 green: just runs.
// The env lists add to the built-in ones, so tools added later are still covered even if an older .env sets these lists.
const envSet = (name, builtIn) => new Set([...builtIn.split(","), ...(process.env[name] ?? "").split(",")].map((s) => s.trim()).filter(Boolean));
const RED = envSet("REQUIRE_APPROVAL", "forget,delete_file,create_schedule,delete_task,trigger_workflow,n8n_run_webhook,n8n_delete_workflow");
const YELLOW = envSet("NOTIFY_ACTIONS", "save_project,set_role,save_skill,import_memories,set_schedule_enabled,dispatch_task,n8n_save_workflow,n8n_set_active");
export const levelOf = (name) => (RED.has(name) ? "red" : YELLOW.has(name) ? "yellow" : "green");

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
  feedEvent(project, actor, `📋 New task for @${assignee}: ${title}${details ? `\n${clip(details, 400)}` : ""}`);
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
// A claim older than CLAIM_TTL_MIN counts as abandoned, so a stuck task can be picked up again.
const claimCutoff = () => stamp(Date.now() - Number(process.env.CLAIM_TTL_MIN || 120) * 60_000);
const heldByOther = (t, actor) => t.claimed_by && t.claimed_by !== actor && t.status === "in_progress" && t.claimed_at >= claimCutoff();

// Atomic: of two agents claiming the same task at once, exactly one wins.
export function claimTask({ id: tid }, actor, { override = false } = {}) {
  const t = get("SELECT * FROM tasks WHERE id = ?", tid);
  if (!t) throw new Error(`No task ${tid}`);
  if (t.status === "done") throw new Error(`Task ${tid} is already done`);
  if (heldByOther(t, actor)) throw new Error(`Task ${tid} is already claimed by ${t.claimed_by} (since ${t.claimed_at}). Pick another task.`);
  if (!override && actor !== "human" && ![actor, "anyone"].includes(t.assignee))
    throw new Error(`Task ${tid} is assigned to ${t.assignee}, not you. Ask for a handoff instead.`);
  const r = run(`UPDATE tasks SET status = 'in_progress', claimed_by = ?, claimed_at = ?, updated = ?,
      assignee = CASE WHEN ? THEN ? WHEN assignee = 'anyone' THEN ? ELSE assignee END
    WHERE id = ? AND status != 'done' AND (claimed_by IS NULL OR claimed_by = ? OR status != 'in_progress' OR claimed_at < ?)`,
    actor, now(), now(), override ? 1 : 0, actor, actor, tid, actor, claimCutoff());
  if (!r.changes) {
    const c = get("SELECT claimed_by, claimed_at FROM tasks WHERE id = ?", tid);
    throw new Error(`Task ${tid} is already claimed by ${c.claimed_by} (since ${c.claimed_at}). Pick another task.`);
  }
  log(actor, "claim_task", tid);
  return getTask(tid);
}
// Claim the oldest open task meant for this agent.
export function nextTask({ project } = {}, actor) {
  const open = all(`SELECT id FROM tasks WHERE status = 'open' AND assignee IN (?, 'anyone') ${project ? "AND project = ?" : ""} ORDER BY created, rowid`,
    actor, ...(project ? [project] : []));
  for (const { id: tid } of open) {
    try { return claimTask({ id: tid }, actor); } catch { /* someone else got it first; try the next one */ }
  }
  return "No open tasks for you right now.";
}
const releaseClaim = (tid) => run("UPDATE tasks SET claimed_by = NULL, claimed_at = NULL WHERE id = ?", tid);

export function updateTask({ id: tid, note, status, assignee }, actor) {
  const t = get("SELECT * FROM tasks WHERE id = ?", tid);
  if (!t) throw new Error(`No task ${tid}`);
  if ((status || assignee) && actor !== "human" && heldByOther(t, actor))
    throw new Error(`Task ${tid} is claimed by ${t.claimed_by}. You can add a note, but only ${t.claimed_by} or the human can change it.`);
  // Starting work goes through the atomic claim, so two agents can't both start the same task.
  if (status === "in_progress" && actor !== "human" && t.claimed_by !== actor) claimTask({ id: tid }, actor);
  if (note) run("INSERT INTO task_notes (task_id, author, note) VALUES (?,?,?)", tid, actor, note);
  if (status) run("UPDATE tasks SET status = ? WHERE id = ?", status, tid);
  if (assignee) run("UPDATE tasks SET assignee = ? WHERE id = ?", assignee, tid);
  if (status === "open" || (assignee && assignee !== t.claimed_by)) releaseClaim(tid);
  run("UPDATE tasks SET updated = ? WHERE id = ?", now(), tid);
  log(actor, "update_task", `${tid} ${status || ""} ${assignee ? "-> " + assignee : ""} ${note || ""}`);
  if (status === "done") notify(`Task done by ${actor}: ${t.title}`);
  const what = status === "done" ? "✅ Done" : status === "in_progress" ? "🔨 Working on" : assignee ? `↪️ Handed to @${assignee}` : "📝 Note on";
  if (status || assignee || note) feedEvent(t.project, actor, `${what}: ${t.title}${note ? `\n${clip(note, 1500)}` : ""}`);
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

// ---------- Claude Code worker ----------
// A task for "claude-code" becomes a GitHub issue that mentions @claude; the Claude Code GitHub Action picks it up,
// works in the repo and opens a PR. GitHub webhooks (handleGithubEvent) report progress back onto the task.
export async function dispatchTask({ id: tid, repo, instructions = "" }, actor) {
  assertRunning();
  if (!githubReady()) throw new Error("GitHub isn't set up (GITHUB_TOKEN + GITHUB_REPO). A Claude Code session can still take it with next_task.");
  const t = getTask(tid);
  if (!t) throw new Error(`No task ${tid}`);
  if (t.github_url) throw new Error(`Task ${tid} was already sent to Claude Code: ${t.github_url}`);
  const target = repo || process.env.GITHUB_REPO;
  if (!REPO_RE.test(target)) throw new Error(`Bad repo "${target}" (expected owner/name)`);
  claimTask({ id: tid }, "claude-code", { override: true });
  const notes = t.notes.map((n) => `- **${n.author}:** ${n.note}`).join("\n");
  const body = `@claude ${t.title}\n\n${t.details || ""}\n${instructions ? `\n${instructions}\n` : ""}${notes ? `\n### Notes so far\n${notes}\n` : ""}
---
Bridge task \`${t.id}\` (project \`${t.project}\`), sent by ${actor}.
Do the work on a branch and open a pull request for the human to review. Never merge it yourself.
Put "Closes #<this issue's number>" in the pull request description so the task is marked done when the human merges it.
<!-- bridge-task:${t.id} -->`;
  let issue;
  try {
    issue = await createIssue(target, { title: t.title, body, labels: ["claude-task"] });
  } catch (e) {
    releaseClaim(tid);
    run("UPDATE tasks SET status = 'open' WHERE id = ?", tid);
    throw e;
  }
  run("UPDATE tasks SET github_repo = ?, github_issue = ?, github_url = ? WHERE id = ?", target, issue.number, issue.url, tid);
  updateTask({ id: tid, note: `Sent to Claude Code: ${issue.url}` }, actor);
  notify(`🛠 Sent to Claude Code: ${t.title}\n${issue.url}`);
  return getTask(tid);
}
// Called after a task is created or reassigned: tasks for claude-code go straight to GitHub when it's set up.
export async function route(task, actor) {
  if (["claude", "codex", "local"].includes(task?.assignee) && task.status === "open" && process.env.AUTO_WORK !== "0" && process.env.AI_ENGINE !== "api") {
    const job = workTask({ id: task.id }, actor)
      .then((t) => postMessage({ text: `✅ ${CHAT_AUTHOR[task.assignee]} finished "${t.title}". Result is on the task.`, project: t.project }, CHAT_AUTHOR[task.assignee]))
      .catch((e) => postMessage({ text: `⚠️ ${CHAT_AUTHOR[task.assignee]} couldn't do "${task.title}": ${e.message}`, project: task.project }, "bridge"));
    pendingReplies.add(job); job.finally(() => pendingReplies.delete(job));
    return { ...task, note: `${CHAT_AUTHOR[task.assignee]} started on it now. You'll see "✅ finished" in the team chat.` };
  }
  if (task?.assignee !== "claude-code" || task.github_url || task.status === "done" || !githubReady() || process.env.AUTO_DISPATCH === "0") return task;
  try { return await dispatchTask({ id: task.id }, actor); } catch (e) { return { ...getTask(task.id), dispatch_error: e.message }; }
}

const taskByIssue = (repo, number) => get("SELECT * FROM tasks WHERE github_repo = ? AND github_issue = ?", repo, number);
export function handleGithubEvent(event, p) {
  const repo = p.repository?.full_name;
  if (event === "issue_comment" && p.action === "created" && p.comment?.user?.type === "Bot") {
    const t = taskByIssue(repo, p.issue?.number);
    if (!t) return "ignored";
    updateTask({ id: t.id, note: `Claude Code: ${p.comment.body.slice(0, 1500)}\n${p.comment.html_url}` }, "claude-code");
    return "noted";
  }
  if (event === "pull_request" && p.action === "opened") {
    const body = `${p.pull_request?.body || ""}`;
    const ids = new Set([...body.matchAll(/bridge-task:([\w-]+)/g)].map((m) => m[1]));
    for (const m of body.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi)) { const t = taskByIssue(repo, Number(m[1])); if (t) ids.add(t.id); }
    let n = 0;
    for (const tid of ids) {
      if (!getTask(tid)) continue;
      updateTask({ id: tid, note: `Pull request ready for your review: ${p.pull_request.html_url}` }, "claude-code");
      n++;
    }
    if (n) notify(`👀 Claude Code opened a PR for review: ${p.pull_request.title}\n${p.pull_request.html_url}`);
    return n ? "noted" : "ignored";
  }
  if (event === "issues" && ["closed", "reopened"].includes(p.action)) {
    const t = taskByIssue(repo, p.issue?.number);
    if (!t) return "ignored";
    if (p.action === "reopened") {
      updateTask({ id: t.id, status: "in_progress", note: "GitHub issue reopened" }, "human");
      return "reopened";
    }
    if (p.issue.state_reason === "not_planned") {
      updateTask({ id: t.id, status: "open", assignee: "human", note: "GitHub issue closed as not planned — back to you." }, "human");
      return "returned";
    }
    updateTask({ id: t.id, status: "done", note: `Finished on GitHub: ${p.issue.html_url}` }, "claude-code");
    return "done";
  }
  return "ignored";
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
// feed: also show the question and the answer in the team chat, so the human can watch the AIs work together.
export async function askAgent({ agent, prompt, project = "default", feed = true }, actor) {
  assertRunning();
  loopGuard();
  log(actor, `ask_${agent}`, prompt);
  if (feed) postMessage({ text: `→ @${agent}: ${clip(prompt, 600)}`, project }, actor);
  const reply = await ask(agent, prompt, { project });
  if (feed) postMessage({ text: clip(reply, 4000), project }, agent);
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
  const coder = githubReady() ? `, or "claude-code" for anything that changes code or files in the GitHub repo` : "";
  const reply = await askAgent({ agent: planner, project, prompt: `Break this goal into 2-8 concrete subtasks and assign each to "claude" or "chatgpt" based on their roles${coder}.
Reply ONLY with JSON: [{"title":"...","details":"...","assignee":"claude|chatgpt${coder ? "|claude-code" : ""}"}]\n\nGoal: ${goal}` }, actor);
  const json = reply.match(/\[[\s\S]*\]/);
  if (!json) throw new Error(`Planner did not return a task list:\n${reply}`);
  const valid = ["claude", "chatgpt", ...(coder ? ["claude-code"] : [])];
  const parent = createTask({ title: goal, project, assignee: "anyone" }, actor);
  const subs = [];
  for (const s of JSON.parse(json[0])) {
    const t = createTask({ title: String(s.title), details: String(s.details || ""), assignee: valid.includes(s.assignee) ? s.assignee : "anyone", project, parent: parent.id }, planner);
    subs.push(await route(t, planner));
  }
  return { parent, subtasks: subs };
}
// Have an agent work an assigned task now and record the result on it.
export async function workTask({ id: tid, agent }, actor) {
  const t = getTask(tid);
  if (!t) throw new Error(`No task ${tid}`);
  if (t.assignee === "claude-code" && !agent) return dispatchTask({ id: tid }, actor);
  const who = agent || (["claude", "chatgpt", "codex", "local"].includes(t.assignee) ? t.assignee : "claude");
  assertRunning();
  claimTask({ id: tid }, who, { override: actor === "human" });
  try {
    const notes = t.notes.map((n) => `- ${n.author}: ${n.note}`).join("\n");
    const result = await askAgent({ agent: who, project: t.project, prompt: `Do this task and give the finished result.\n\nTask: ${t.title}\n${t.details}\n\nNotes so far:\n${notes || "(none)"}`, feed: false }, actor);
    return updateTask({ id: tid, status: "done", note: result }, who);
  } catch (e) {
    releaseClaim(tid);
    run("UPDATE tasks SET status = 'open' WHERE id = ?", tid);
    throw e;
  }
}

// ---------- team chat ----------
export const listMessages = ({ project = "default", limit = 100 } = {}) =>
  all("SELECT * FROM messages WHERE project = ? ORDER BY id DESC LIMIT ?", project, limit).reverse();
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n) + "…" : String(s));
// Team activity (tasks, notes, handoffs) shows up in the team chat too. The human's own dashboard clicks don't, to keep it readable.
function feedEvent(project, actor, text) {
  if (actor !== "human") postMessage({ text, project }, actor);
}
export function postMessage({ text, project = "default" }, actor) {
  run("INSERT INTO messages (project, author, text) VALUES (?,?,?)", project, actor, text);
  return listMessages({ project, limit: 1 })[0];
}
// ---------- group chat ----------
// One shared chat for the human, Bob, the Claude app, Claude Code, Codex and the Local AI. Whoever is talked to, everyone sees it.
// Mention someone to wake them: @claude, @codex, @local, or @all. They answer on the PC (subscriptions, no API cost).
// Bob (ChatGPT Dots) and the chat apps can't be woken from here; they read new posts with get_updates.
export const CHAT_AUTHOR = { claude: "claude", chatgpt: "codex", codex: "codex", local: "local" };
const MENTIONS = { claude: ["claude"], codex: ["codex"], chatgpt: ["codex"], gpt: ["codex"], local: ["local"], all: ["claude", "codex"], everyone: ["claude", "codex"] };
export function mentionsIn(text) {
  const found = new Set();
  for (const m of String(text).matchAll(/@([a-z]+)/gi)) for (const a of MENTIONS[m[1].toLowerCase()] || []) found.add(a);
  return [...found];
}
const pendingReplies = new Set();
// Wake the given agents to reply in the background, so the person or app posting never waits minutes for an answer.
function wake(agents, { text, project, actor }) {
  for (const a of agents) {
    const job = (async () => {
      const thread = listMessages({ project, limit: 30 }).map((m) => `${m.author}: ${m.text}`).join("\n\n");
      const prompt = `Team chat so far:\n${thread || "(start)"}\n\nYou were mentioned by ${actor}. Reply as yourself in the team chat. ` +
        `If they asked for work, do it and give the result. Keep it short.`;
      try { postMessage({ text: await askAgent({ agent: a, prompt, project, feed: false }, actor), project }, CHAT_AUTHOR[a]); }
      catch (e) { postMessage({ text: `(${CHAT_AUTHOR[a]} couldn't answer: ${e.message})`, project }, "bridge"); }
    })();
    pendingReplies.add(job);
    job.finally(() => pendingReplies.delete(job));
  }
}
export const waitForReplies = () => Promise.all([...pendingReplies]);
// to: "auto" = whoever is @mentioned (the human's own messages go to Codex when nobody is), "none" = just post,
// or a name ("claude", "codex"/"chatgpt", "local", "both") to wake them directly.
export function teamChat({ text, to = "auto", project = "default" }, actor = "human") {
  if (to === "debate") { postMessage({ text, project }, actor); return debate({ question: text, project }, actor).then((r) => [postMessage({ text: r, project }, "team")]); }
  const posted = postMessage({ text, project }, actor);
  let agents = to === "auto" || to === "none" ? mentionsIn(text) : to === "both" ? ["claude", "codex"] : [to === "chatgpt" ? "codex" : to];
  if (to === "auto" && !agents.length && actor === "human") agents = ["codex"];
  if (agents.length) { assertRunning(); wake(agents, { text, project, actor }); }
  return { posted, answering: agents.map((a) => CHAT_AUTHOR[a]) };
}

// What changed since this agent last looked. Bob calls this on a schedule and tells the human what matters.
export function getUpdates({ project } = {}, actor) {
  const key = `cursor:${actor}`;
  const since = Number(getSetting(key, "0"));
  const rows = all("SELECT * FROM messages WHERE id > ? ORDER BY id LIMIT 200", since).filter((m) => !project || m.project === project);
  const last = all("SELECT MAX(id) id FROM messages")[0]?.id || since;
  setSetting(key, last);
  const others = rows.filter((m) => m.author !== actor);
  const isDone = (m) => /^(✅|finished|done)/i.test(m.text) || /\bstatus: done\b/i.test(m.text);
  const needsYou = [
    ...pendingApprovals().map((p) => `Approval waiting: ${p.action} (requested by ${p.actor})`),
    ...all("SELECT title, project FROM tasks WHERE assignee = 'human' AND status != 'done'").map((t) => `Task for you: ${t.title} [${t.project}]`),
    ...others.filter((m) => /@(bob|shahed|human|you)\b/i.test(m.text)).map((m) => `${m.author} asked: ${clip(m.text, 200)}`),
  ];
  return {
    new_messages: others.map((m) => `[${m.project}] ${m.author}: ${clip(m.text, 300)}`),
    finished: others.filter(isDone).map((m) => `[${m.project}] ${clip(m.text, 200)}`),
    needs_the_human: needsYou,
    tip: others.length ? "Tell the human the finished items and anything that needs them, in a few short lines." : "Nothing new. Don't notify the human.",
  };
}

// ---------- web ----------
export async function fetchUrl({ url }, actor) {
  log(actor, "fetch_url", url);
  const r = await safeFetchText(url, { headers: { "User-Agent": "vg-hoster-bridge" } });
  const text = r.text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return `HTTP ${r.status}\n${text.slice(0, 20000)}`;
}
export async function search({ query, project = "default" }, actor) { log(actor, "web_search", query); return webSearch(query, project); }

// ---------- activity, usage, approvals ----------
export const activity = ({ limit = 100 } = {}) => all("SELECT * FROM activity ORDER BY id DESC LIMIT ?", limit);
export const usage = () => ({ ...spend(), by_model: all("SELECT model, SUM(input_tokens) input_tokens, SUM(output_tokens) output_tokens, SUM(cost_usd) cost_usd FROM usage GROUP BY model") });

// Every MCP tool registers its handler here, so any of them can be put behind an approval (REQUIRE_APPROVAL).
const ACTIONS = {};
export const registerAction = (name, fn) => { ACTIONS[name] = fn; };

// Runs an action for an actor, applying the approval level. The human is never gated.
export async function runAction(name, args, actor) {
  const fn = ACTIONS[name];
  if (!fn) throw new Error(`Unknown action ${name}`);
  if (actor === "human") return fn(args, actor);
  const level = levelOf(name);
  if (level === "red") return requestApproval(name, args, actor);
  const result = await fn(args, actor);
  if (level === "yellow") notify(`🟡 ${actor} ran ${name}: ${JSON.stringify(args).slice(0, 300)}`);
  return result;
}

function requestApproval(name, args, actor) {
  const aid = id();
  run("INSERT INTO approvals (id, actor, action, args) VALUES (?,?,?,?)", aid, actor, name, JSON.stringify(args));
  log(actor, "approval_requested", `${name} ${JSON.stringify(args)}`);
  notify(`🔴 ${actor} wants to run ${name}\n${JSON.stringify(args, null, 1).slice(0, 1500)}`,
    { buttons: [[{ text: "✅ Approve", data: `ap:${aid}:y` }, { text: "❌ Reject", data: `ap:${aid}:n` }]] });
  return `Needs the human's approval (request ${aid}). It runs as soon as they approve it in Telegram or the dashboard. Don't ask again.`;
}
export const listApprovals = () => all("SELECT * FROM approvals ORDER BY at DESC LIMIT 100");
export const pendingApprovals = () => all("SELECT id, actor, action, args, at FROM approvals WHERE status = 'pending' ORDER BY at");
// Only the human decides. The status flip is atomic, so approving twice (Telegram + dashboard) runs the action once.
export async function decideApproval({ id: aid, approve }) {
  const a = get("SELECT * FROM approvals WHERE id = ?", aid);
  if (!a || !run("UPDATE approvals SET status = 'running' WHERE id = ? AND status = 'pending'", aid).changes)
    throw new Error(a ? `Approval ${aid} was already ${a.status}` : `No approval ${aid}`);
  let result = "rejected", status = approve ? "approved" : "rejected";
  if (approve) {
    try { result = await ACTIONS[a.action](JSON.parse(a.args), a.actor); result = typeof result === "string" ? result : JSON.stringify(result); }
    catch (e) { result = `failed: ${e.message}`; status = "failed"; }
  }
  run("UPDATE approvals SET status = ?, result = ? WHERE id = ?", status, String(result).slice(0, 5000), aid);
  log("human", status, `${a.action} from ${a.actor}`);
  return result;
}

// One-glance summary for the human (Telegram /status, get_briefing).
export function teamStatus({ project } = {}) {
  const tasks = listTasks({ project }).filter((t) => t.status !== "done");
  return {
    paused: isPaused(), paused_info: isPaused() ? getSetting("paused_info") : undefined,
    pending_approvals: pendingApprovals(),
    in_progress: tasks.filter((t) => t.status === "in_progress").map(({ id, title, project, claimed_by, assignee, github_url }) => ({ id, title, project, by: claimed_by || assignee, github_url })),
    open: tasks.filter((t) => t.status === "open").map(({ id, title, project, assignee }) => ({ id, title, project, assignee })),
    spend: spend(),
  };
}

export { db };
