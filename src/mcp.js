// MCP tools exposed to ChatGPT, Claude and Claude Code. The caller's identity comes from ?agent= on the connector URL.
// Every tool runs through core.runAction, which applies the approval level (red / yellow / green) and the kill switch.
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as core from "./core.js";
import * as sched from "./scheduler.js";
import { notify } from "./notify.js";
import * as n8n from "./n8n.js";
const { listWorkflows, triggerWorkflow } = n8n;
import { githubReady } from "./github.js";

export const AGENTS = ["claude", "chatgpt", "claude-code"];
const Agent = z.enum(["claude", "chatgpt"]); // agents the bridge can call through their APIs
const Member = z.enum(AGENTS);
const Assignee = z.enum([...AGENTS, "anyone", "human"]);
const Status = z.enum(["open", "in_progress", "done"]);
const project = z.string().default("default").describe("Project name; keeps memory, tasks and files separate");
const out = (v) => ({ content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });

// Tool table: handlers take (args, actor). readOnly tools keep working while the team is paused.
const TOOLS = [];
const tool = (name, description, schema, fn, { readOnly = false } = {}) => TOOLS.push({ name, description, schema, fn, readOnly });

// Overview
tool("get_briefing", "Start here: your role, the human's profile, core memories, your tasks, what everyone is doing, pending approvals, kill-switch state and recent team chat.",
  { project }, async ({ project: p }, actor) => ({
    you: actor, roles: core.getRoles(), profile: core.getProfile(),
    core_memories: (await core.recall({ project: p })).filter((m) => m.pinned),
    recent_memories: (await core.recall({ project: p, limit: 15 })).filter((m) => !m.pinned),
    my_tasks: core.listTasks({ project: p }).filter((t) => t.status !== "done" && [actor, "anyone"].includes(t.assignee)),
    team: core.teamStatus({ project: p }),
    team_chat: core.listMessages({ project: p, limit: 10 }), projects: core.listProjects().map((x) => x.name),
    integrations: { claude_code_via_github: githubReady(), n8n_workflows: listWorkflows().map((w) => w.name), n8n_builder: n8n.n8nReady() },
  }), { readOnly: true });
tool("team_status", "Quick status for the human: who is working on what, open tasks, pending approvals, paused or not, spend today.",
  { project: z.string().optional() }, (a) => core.teamStatus(a), { readOnly: true });

// Tasks
tool("create_task", "Create a shared task. assignee 'claude-code' sends it to Claude Code to build in the GitHub repo.",
  { title: z.string(), details: z.string().optional(), assignee: Assignee.default("anyone"), project },
  (a, actor) => core.route(core.createTask(a, actor), actor));
tool("list_tasks", "List shared tasks.", { project: z.string().optional(), status: Status.optional(), assignee: Assignee.optional() },
  (a) => core.listTasks(a), { readOnly: true });
tool("claim_task", "Claim a task before working on it. Only one agent can hold a task; if someone else has it you'll get an error, so pick another.",
  { id: z.string() }, (a, actor) => core.claimTask(a, actor));
tool("next_task", "Claim the oldest open task assigned to you (or to anyone) and return it. Use this to pick up work without duplicating anyone.",
  { project: z.string().optional() }, (a, actor) => core.nextTask(a, actor));
tool("update_task", "Add a note/result and/or change status or assignee. Setting status open releases your claim.",
  { id: z.string(), note: z.string().optional(), status: Status.optional(), assignee: Assignee.optional() }, (a, actor) => core.updateTask(a, actor));
tool("handoff", "Hand a task to a coworker with a summary of where it stands.", { id: z.string(), to: Assignee, summary: z.string() },
  async (a, actor) => core.route(core.handoff(a, actor), actor));
tool("split_task", "Break a big goal into subtasks assigned to the team.", { goal: z.string(), project, planner: Agent.default("claude") },
  (a, actor) => core.splitTask(a, actor));
tool("work_task", "Have an agent do a task right now; the result is saved on the task.", { id: z.string(), agent: Agent.optional() },
  (a, actor) => core.workTask(a, actor));
tool("dispatch_task", "Send a task to Claude Code: it becomes a GitHub issue for @claude, who works in the repo and opens a PR for the human.",
  { id: z.string(), repo: z.string().optional().describe("owner/name; defaults to GITHUB_REPO"), instructions: z.string().optional() },
  (a, actor) => core.dispatchTask(a, actor));
tool("delete_task", "Delete a task.", { id: z.string() }, (a, actor) => core.deleteTask(a, actor));

// Memory
tool("remember", "Save a fact, preference or decision to shared memory. pinned = core memory always shown to every AI.",
  { text: z.string(), tags: z.array(z.string()).default([]), pinned: z.boolean().default(false), project }, (a, actor) => core.remember(a, actor));
tool("recall", "Search shared memory by meaning (or keywords). Empty query lists recent.",
  { query: z.string().default(""), project: z.string().optional(), tag: z.string().optional(), limit: z.number().default(20) },
  (a) => core.recall(a), { readOnly: true });
tool("update_memory", "Edit, pin/unpin, retag or move a memory.",
  { id: z.string(), text: z.string().optional(), pinned: z.boolean().optional(), tags: z.array(z.string()).optional(), project: z.string().optional() },
  (a, actor) => core.updateMemory(a, actor));
tool("forget", "Delete a memory.", { id: z.string() }, (a, actor) => core.forget(a, actor));
tool("import_memories", "Import memories: a JSON array or one memory per line (e.g. a pasted ChatGPT memory list).",
  { data: z.string(), source: z.string().default("import"), project }, (a, actor) => core.importMemories(a, actor));

// Personalization
tool("get_profile", "Read the human's profile (name, goals, tone, language, dislikes...).", {}, () => core.getProfile(), { readOnly: true });
tool("set_profile", "Set one profile field. Empty value removes it.", { key: z.string(), value: z.string() }, (a, actor) => core.setProfile(a, actor));
tool("set_role", "Set a team member's role.", { agent: Member, role: z.string() }, (a, actor) => core.setRole(a, actor));
tool("list_projects", "List projects with settings and spend.", {}, () => core.listProjects(), { readOnly: true });
tool("save_project", "Create or update a project (description, lead, models, temperature, budget).",
  { name: z.string(), description: z.string().optional(), lead: Assignee.optional(), claude_model: z.string().optional(), gpt_model: z.string().optional(),
    temperature: z.number().optional(), budget_usd: z.number().optional() }, (a, actor) => core.saveProject(a, actor));

// Skills
tool("list_skills", "List shared playbooks every AI can follow.", {}, () => core.listSkills(), { readOnly: true });
tool("save_skill", "Create or update a playbook.", { name: z.string(), description: z.string(), steps: z.string() }, (a, actor) => core.saveSkill(a, actor));
tool("run_skill", "Have an agent follow a playbook on some input.", { name: z.string(), input: z.string().default(""), agent: Agent.default("claude"), project },
  (a, actor) => core.runSkill(a, actor));

// Coworkers
tool("ask_claude", "Ask your coworker Claude. It sees shared memory, profile and tasks.", { prompt: z.string(), project },
  (a, actor) => core.askAgent({ ...a, agent: "claude" }, actor));
tool("ask_chatgpt", "Ask your coworker ChatGPT. It sees shared memory, profile and tasks.", { prompt: z.string(), project },
  (a, actor) => core.askAgent({ ...a, agent: "chatgpt" }, actor));
tool("debate", "Both AIs answer, critique each other, then a final combined answer.",
  { question: z.string(), rounds: z.number().min(0).max(3).default(1), project, judge: Agent.default("claude") }, (a, actor) => core.debate(a, actor));
tool("review", "One AI drafts, the other reviews, the drafter revises.", { request: z.string(), drafter: Agent.default("chatgpt"), project },
  (a, actor) => core.review(a, actor));
tool("team_chat", "Post to the shared team chat the human sees in the dashboard. to=none just posts.",
  { text: z.string(), to: z.enum(["none", "claude", "chatgpt", "both"]).default("none"), project },
  (a, actor) => (a.to === "none" ? core.postMessage(a, actor) : core.teamChat(a, actor)));
tool("read_team_chat", "Read the shared team chat.", { project, limit: z.number().default(30) }, (a) => core.listMessages(a), { readOnly: true });

// Files
tool("write_file", "Create/overwrite a file in the shared workspace (old versions kept).", { path: z.string(), content: z.string(), project },
  (a, actor) => core.writeFile(a, actor));
tool("read_file", "Read a shared file (latest, or a given version).", { path: z.string(), project, version: z.number().optional() },
  (a) => core.readFile(a).content, { readOnly: true });
tool("list_files", "List files in the shared workspace.", { project }, (a) => core.listFiles(a), { readOnly: true });
tool("file_history", "Show a file's versions.", { path: z.string(), project }, (a) => core.fileHistory(a), { readOnly: true });
tool("delete_file", "Delete a shared file; history kept.", { path: z.string(), project }, (a, actor) => core.deleteFile(a, actor));

// Web
tool("web_search", "Search the web and get an answer with sources.", { query: z.string(), project }, (a, actor) => core.search(a, actor));
tool("fetch_url", "Fetch a public web page as text.", { url: z.string().url() }, (a, actor) => core.fetchUrl(a, actor), { readOnly: true });

// n8n automations
tool("list_workflows", "List the n8n workflows you can trigger (email, deploy, CRM… whatever the human set up).", {}, () => listWorkflows(), { readOnly: true });
tool("trigger_workflow", "Run one of the human's n8n workflows with a JSON payload.", { name: z.string(), payload: z.record(z.string(), z.any()).default({}) },
  (a, actor) => { core.assertRunning(); core.log(actor, "trigger_workflow", a.name); return triggerWorkflow(a, actor); });

// n8n builder: the bridge runs next to n8n, so every agent (cloud ones too) can build and run workflows through it.
const Node = z.object({ name: z.string(), type: z.string(), typeVersion: z.number(), position: z.array(z.number()).length(2),
  parameters: z.record(z.string(), z.any()).default({}) }).passthrough();
tool("n8n_list_workflows", "List every workflow in the human's n8n (id, name, on/off, webhook paths).", {}, () => n8n.n8nListWorkflows(), { readOnly: true });
tool("n8n_get_workflow", "Read one n8n workflow in full (nodes and connections), e.g. before changing it.", { id: z.string() }, (a) => n8n.n8nGetWorkflow(a), { readOnly: true });
tool("n8n_save_workflow", "Create an n8n workflow (no id) or replace one (with id). Give n8n's workflow JSON: nodes and connections. Start with a Webhook node (POST) if agents should run it. It's created switched off; then call n8n_set_active.",
  { id: z.string().optional(), name: z.string(), nodes: z.array(Node).min(1), connections: z.record(z.string(), z.any()).default({}), settings: z.record(z.string(), z.any()).default({}) },
  (a, actor) => { core.assertRunning(); core.log(actor, "n8n_save_workflow", a.name); return n8n.n8nSaveWorkflow(a); });
tool("n8n_set_active", "Switch an n8n workflow on (active=true) or off.", { id: z.string(), active: z.boolean() },
  (a, actor) => { core.assertRunning(); core.log(actor, "n8n_set_active", `${a.id} ${a.active}`); return n8n.n8nSetActive(a); });
tool("n8n_run_webhook", "Run an active n8n workflow that starts with a Webhook node, by its path, with a JSON payload.",
  { path: z.string(), payload: z.record(z.string(), z.any()).default({}), test: z.boolean().default(false) },
  (a, actor) => { core.assertRunning(); core.log(actor, "n8n_run_webhook", a.path); return n8n.n8nRunWebhook(a, actor); });
tool("n8n_executions", "Recent n8n runs and whether they succeeded (optionally for one workflow).", { workflowId: z.string().optional(), limit: z.number().default(10) },
  (a) => n8n.n8nExecutions(a), { readOnly: true });
tool("n8n_delete_workflow", "Delete an n8n workflow.", { id: z.string() }, (a, actor) => { core.log(actor, "n8n_delete_workflow", a.id); return n8n.n8nDeleteWorkflow(a); });

// Scheduling & notifications
tool("create_schedule", "Run a prompt on a schedule (cron, e.g. '0 9 * * 1-5' = weekdays 9am).",
  { cron: z.string(), agent: Agent, prompt: z.string(), project, notify: z.boolean().default(true) }, (a, actor) => sched.createSchedule(a, actor));
tool("list_schedules", "List scheduled jobs and their last results.", {}, () => sched.listSchedules(), { readOnly: true });
tool("set_schedule_enabled", "Pause or resume a scheduled job.", { id: z.string(), enabled: z.boolean() }, (a, actor) => sched.setSchedule(a, actor));
tool("notify_human", "Send the human a push notification (Telegram/Discord/webhook).", { message: z.string() },
  async ({ message }, actor) => { core.log(actor, "notify", message); return notify(`${actor}: ${message}`); });

// Oversight
tool("pending_approvals", "Requests waiting for the human's OK. You can remind the human, but only the human can approve (Telegram or dashboard).",
  {}, () => core.pendingApprovals(), { readOnly: true });
tool("pause_all", "Emergency stop: pause all AI work (tools, schedules, Claude Code dispatch). Only the human can resume.",
  { reason: z.string().default("") }, (a, actor) => core.pauseAll(a, actor), { readOnly: true });
tool("activity_log", "Recent actions by everyone.", { limit: z.number().default(50) }, (a) => core.activity(a), { readOnly: true });
tool("usage", "API spend so far.", {}, () => core.usage(), { readOnly: true });

for (const t of TOOLS) core.registerAction(t.name, t.fn);
export const TOOL_NAMES = TOOLS.map((t) => t.name);

const GROUP = `This bridge is the human's group chat with the whole team. The human talks to different AIs in different apps and must never have to repeat themselves:
- When the human asks you for something, first post a one-line summary with team_chat (to "none"), e.g. "Human asked: add a FAQ page".
- Before answering, check read_team_chat / get_briefing so you know what the human already told the others.
- Post short progress and results with team_chat or update_task so the others (and the human, in the dashboard) can see your work.`;
const INSTRUCTIONS = {
  chatgpt: `You are "chatgpt" (the human may call you Codex or Bop): the human's front desk for a team of AIs. You talk with the human, keep them briefed and pass work on.
${GROUP}
- Start every conversation with get_briefing. For "status?" or "what's happening?" use team_status and answer in a few short lines.
- Anything that needs code or the website built/changed: create_task with assignee "claude-code" (it goes to Claude Code on GitHub automatically). Tell the human the task and the link.
- Never approve anything yourself. If something waits in pending_approvals, remind the human to approve it in Telegram or the dashboard.
- If the human says stop/pause, call pause_all immediately.
- Save durable facts with remember. Use ask_claude, debate or review for a second opinion.`,
  claude: `You are "claude" on a shared team bridge. The human is the boss.
${GROUP}
At the start of a conversation call get_briefing. Save durable facts with remember. Use ask_chatgpt, debate or review when a second opinion helps.
Before working on a task call claim_task (or next_task); record results with update_task. Code changes go to "claude-code".`,
  "claude-code": `You are "claude-code": the engineer with repo access on a shared team bridge. The human is the boss; ChatGPT is their front desk.
${GROUP}
- Call get_briefing first, then next_task to claim work (never work a task you haven't claimed — that is how duplicates are avoided).
- Post progress with update_task notes (short, plain language — the front desk reads them to the human). Include PR links.
- Open pull requests for the human to review; never merge or deploy without their approval.
- When finished set status done; if blocked, update_task with the question and hand off to "human".`,
};

export function buildMcp(actor) {
  const server = new McpServer({ name: "vg-hoster-bridge", version: "3.0.0" },
    { instructions: INSTRUCTIONS[actor] || `You are "${actor}" on a shared team bridge. Call get_briefing first.` });
  for (const t of TOOLS) {
    const level = core.levelOf(t.name);
    const hint = level === "red" ? " (Needs the human's approval when an AI calls it.)" : level === "yellow" ? " (The human is notified.)" : "";
    server.registerTool(t.name, { description: t.description + hint, inputSchema: t.schema, annotations: { readOnlyHint: t.readOnly && t.name !== "pause_all" } }, async (args) => {
      try {
        if (!t.readOnly) core.assertRunning();
        return out(await core.runAction(t.name, args, actor));
      } catch (e) { return { ...out(`Error: ${e.message}`), isError: true }; }
    });
  }
  return server;
}
