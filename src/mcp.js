// MCP tools exposed to ChatGPT and Claude. The caller's identity comes from ?agent= on the connector URL.
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as core from "./core.js";
import * as sched from "./scheduler.js";
import { notify } from "./notify.js";

const Agent = z.enum(["claude", "chatgpt"]);
const Assignee = z.enum(["claude", "chatgpt", "anyone", "human"]);
const Status = z.enum(["open", "in_progress", "done"]);
const project = z.string().default("default").describe("Project name; keeps memory, tasks and files separate");
const out = (v) => ({ content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });

export function buildMcp(actor) {
  const server = new McpServer({ name: "vg-hoster-bridge", version: "2.0.0" }, {
    instructions: `You are "${actor}" on a shared ChatGPT + Claude team bridge. The human is the boss; the two AIs are equal coworkers.
At the start of a conversation call get_briefing. Save durable facts with remember. Use ask_${actor === "claude" ? "chatgpt" : "claude"}, debate or review when a second opinion helps.
Check list_tasks for work assigned to you, and record results with update_task.`,
  });
  const tool = (name, description, schema, fn) =>
    server.registerTool(name, { description, inputSchema: schema }, async (args) => {
      try { return out(await fn(args)); } catch (e) { return { ...out(`Error: ${e.message}`), isError: true }; }
    });

  // Overview
  tool("get_briefing", "Start here: your role, the human's profile, core memories, open tasks, pending approvals and recent team chat.", { project },
    async ({ project: p }) => ({
      you: actor, roles: core.getRoles(), profile: core.getProfile(),
      core_memories: (await core.recall({ project: p })).filter((m) => m.pinned),
      recent_memories: (await core.recall({ project: p, limit: 15 })).filter((m) => !m.pinned),
      my_tasks: core.listTasks({ project: p }).filter((t) => t.status !== "done" && [actor, "anyone"].includes(t.assignee)),
      team_chat: core.listMessages({ project: p, limit: 10 }), projects: core.listProjects().map((x) => x.name),
    }));

  // Tasks
  tool("create_task", "Create a shared task.", { title: z.string(), details: z.string().optional(), assignee: Assignee.default("anyone"), project },
    (a) => core.createTask(a, actor));
  tool("list_tasks", "List shared tasks.", { project: z.string().optional(), status: Status.optional(), assignee: Assignee.optional() }, (a) => core.listTasks(a));
  tool("update_task", "Add a note/result and/or change status or assignee.", { id: z.string(), note: z.string().optional(), status: Status.optional(), assignee: Assignee.optional() },
    (a) => core.updateTask(a, actor));
  tool("handoff", "Hand a task to a coworker with a summary of where it stands.", { id: z.string(), to: Assignee, summary: z.string() }, (a) => core.handoff(a, actor));
  tool("split_task", "Break a big goal into subtasks assigned to Claude and ChatGPT.", { goal: z.string(), project, planner: Agent.default("claude") }, (a) => core.splitTask(a, actor));
  tool("work_task", "Have an agent do a task right now; the result is saved on the task.", { id: z.string(), agent: Agent.optional() }, (a) => core.workTask(a, actor));
  tool("delete_task", "Delete a task (may need the human's approval).", { id: z.string() }, (a) => core.guarded("delete_task", a, actor));

  // Memory
  tool("remember", "Save a fact, preference or decision to shared memory. pinned = core memory always shown to both AIs.",
    { text: z.string(), tags: z.array(z.string()).default([]), pinned: z.boolean().default(false), project }, (a) => core.remember(a, actor));
  tool("recall", "Search shared memory by meaning (or keywords). Empty query lists recent.", { query: z.string().default(""), project: z.string().optional(), tag: z.string().optional(), limit: z.number().default(20) },
    (a) => core.recall(a));
  tool("update_memory", "Edit, pin/unpin, retag or move a memory.", { id: z.string(), text: z.string().optional(), pinned: z.boolean().optional(), tags: z.array(z.string()).optional(), project: z.string().optional() },
    (a) => core.updateMemory(a, actor));
  tool("forget", "Delete a memory (may need the human's approval).", { id: z.string() }, (a) => core.guarded("forget", a, actor));
  tool("import_memories", "Import memories: a JSON array or one memory per line (e.g. a pasted ChatGPT memory list).", { data: z.string(), source: z.string().default("import"), project },
    (a) => core.importMemories(a, actor));

  // Personalization
  tool("get_profile", "Read the human's profile (name, goals, tone, language, dislikes...).", {}, () => core.getProfile());
  tool("set_profile", "Set one profile field. Empty value removes it.", { key: z.string(), value: z.string() }, (a) => core.setProfile(a, actor));
  tool("set_role", "Set an agent's role on the team.", { agent: Agent, role: z.string() }, (a) => core.setRole(a, actor));
  tool("list_projects", "List projects with settings and spend.", {}, () => core.listProjects());
  tool("save_project", "Create or update a project (description, lead, models, temperature, budget).",
    { name: z.string(), description: z.string().optional(), lead: Assignee.optional(), claude_model: z.string().optional(), gpt_model: z.string().optional(),
      temperature: z.number().optional(), budget_usd: z.number().optional() }, (a) => core.saveProject(a, actor));

  // Skills
  tool("list_skills", "List shared playbooks both AIs can follow.", {}, () => core.listSkills());
  tool("save_skill", "Create or update a playbook.", { name: z.string(), description: z.string(), steps: z.string() }, (a) => core.saveSkill(a, actor));
  tool("run_skill", "Have an agent follow a playbook on some input.", { name: z.string(), input: z.string().default(""), agent: Agent.default("claude"), project },
    (a) => core.runSkill(a, actor));

  // Coworkers
  tool("ask_claude", "Ask your coworker Claude. It sees shared memory, profile and tasks.", { prompt: z.string(), project }, (a) => core.askAgent({ ...a, agent: "claude" }, actor));
  tool("ask_chatgpt", "Ask your coworker ChatGPT. It sees shared memory, profile and tasks.", { prompt: z.string(), project }, (a) => core.askAgent({ ...a, agent: "chatgpt" }, actor));
  tool("debate", "Both AIs answer, critique each other, then a final combined answer.", { question: z.string(), rounds: z.number().min(0).max(3).default(1), project, judge: Agent.default("claude") },
    (a) => core.debate(a, actor));
  tool("review", "One AI drafts, the other reviews, the drafter revises.", { request: z.string(), drafter: Agent.default("chatgpt"), project }, (a) => core.review(a, actor));
  tool("team_chat", "Post to the shared team chat the human sees in the dashboard. to=none just posts.", { text: z.string(), to: z.enum(["none", "claude", "chatgpt", "both"]).default("none"), project },
    (a) => (a.to === "none" ? core.postMessage(a, actor) : core.teamChat(a, actor)));
  tool("read_team_chat", "Read the shared team chat.", { project, limit: z.number().default(30) }, (a) => core.listMessages(a));

  // Files
  tool("write_file", "Create/overwrite a file in the shared workspace (old versions kept).", { path: z.string(), content: z.string(), project }, (a) => core.writeFile(a, actor));
  tool("read_file", "Read a shared file (latest, or a given version).", { path: z.string(), project, version: z.number().optional() }, (a) => core.readFile(a).content);
  tool("list_files", "List files in the shared workspace.", { project }, (a) => core.listFiles(a));
  tool("file_history", "Show a file's versions.", { path: z.string(), project }, (a) => core.fileHistory(a));
  tool("delete_file", "Delete a shared file; history kept (may need approval).", { path: z.string(), project }, (a) => core.guarded("delete_file", a, actor));

  // Web
  tool("web_search", "Search the web and get an answer with sources.", { query: z.string(), project }, (a) => core.search(a, actor));
  tool("fetch_url", "Fetch a web page as text.", { url: z.string().url() }, (a) => core.fetchUrl(a, actor));

  // Scheduling & notifications
  tool("create_schedule", "Run a prompt on a schedule (cron, e.g. '0 9 * * 1-5' = weekdays 9am). May need approval.",
    { cron: z.string(), agent: Agent, prompt: z.string(), project, notify: z.boolean().default(true) }, (a) => core.guarded("create_schedule", a, actor));
  tool("list_schedules", "List scheduled jobs and their last results.", {}, () => sched.listSchedules());
  tool("set_schedule_enabled", "Pause or resume a scheduled job.", { id: z.string(), enabled: z.boolean() }, (a) => sched.setSchedule(a, actor));
  tool("notify_human", "Send the human a push notification (Telegram/Discord/webhook).", { message: z.string() }, async ({ message }) => { core.log(actor, "notify", message); return notify(`${actor}: ${message}`); });

  // Oversight
  tool("activity_log", "Recent actions by everyone.", { limit: z.number().default(50) }, (a) => core.activity(a));
  tool("usage", "API spend so far.", {}, () => core.usage());

  return server;
}
