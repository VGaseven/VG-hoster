// MCP bridge: lets ChatGPT and Claude share a task board and consult each other.
import express from "express";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.BRIDGE_TOKEN; // optional: required as ?token= or Bearer header
const DB = process.env.TASKS_FILE || "tasks.json";
const MEM = process.env.MEMORY_FILE || "memory.json";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const GPT_MODEL = process.env.GPT_MODEL || "gpt-5";

const load = () => (fs.existsSync(DB) ? JSON.parse(fs.readFileSync(DB, "utf8")) : []);
const save = (tasks) => fs.writeFileSync(DB, JSON.stringify(tasks, null, 2));
const loadMem = () => (fs.existsSync(MEM) ? JSON.parse(fs.readFileSync(MEM, "utf8")) : []);
const saveMem = (m) => fs.writeFileSync(MEM, JSON.stringify(m, null, 2));
const Who = z.enum(["chatgpt", "claude", "human"]);

// Shared context handed to whichever AI is consulted, so coworkers know what the other knows.
function teamContext(self) {
  const mem = loadMem().map((m) => `- [${m.id}] (${m.author}${m.tags.length ? ", " + m.tags.join(",") : ""}) ${m.text}`).join("\n") || "(none)";
  const open = load().filter((t) => t.status !== "done")
    .map((t) => `- [${t.id}] ${t.title} -> ${t.assignee} (${t.status})${t.notes.length ? " last note: " + t.notes.at(-1).note : ""}`).join("\n") || "(none)";
  const other = self === "claude" ? "ChatGPT" : "Claude";
  return `You are working as a coworker alongside ${other} and a human. You share a memory and task board.\n\nShared memories:\n${mem}\n\nOpen tasks:\n${open}\n\nIf you learn something worth keeping, end your reply with lines of the form "REMEMBER: <fact>".`;
}

// Pull "REMEMBER:" lines from a coworker's reply into shared memory.
function absorb(reply, author) {
  const facts = [...reply.matchAll(/^REMEMBER:\s*(.+)$/gm)].map((m) => m[1].trim());
  if (facts.length) {
    const mem = loadMem();
    for (const f of facts) mem.push({ id: randomUUID().slice(0, 8), text: f, author, tags: [], at: new Date().toISOString() });
    saveMem(mem);
  }
  return facts;
}

const text = (v) => ({ content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
const openai = process.env.OPENAI_API_KEY ? new OpenAI() : null;

function buildServer() {
  const server = new McpServer({ name: "vg-hoster-bridge", version: "1.0.0" });

  server.registerTool("create_task", {
    description: "Create a shared task both ChatGPT and Claude can see and work on.",
    inputSchema: { title: z.string(), details: z.string().optional(), assignee: z.enum(["chatgpt", "claude", "anyone"]).default("anyone") },
  }, async ({ title, details, assignee }) => {
    const tasks = load();
    const task = { id: randomUUID().slice(0, 8), title, details: details || "", assignee, status: "open", notes: [], created: new Date().toISOString() };
    tasks.push(task);
    save(tasks);
    return text(task);
  });

  server.registerTool("list_tasks", {
    description: "List shared tasks, optionally filtered by status or assignee.",
    inputSchema: { status: z.enum(["open", "in_progress", "done"]).optional(), assignee: z.enum(["chatgpt", "claude", "anyone"]).optional() },
  }, async ({ status, assignee }) =>
    text(load().filter((t) => (!status || t.status === status) && (!assignee || t.assignee === assignee))));

  server.registerTool("update_task", {
    description: "Add a note (progress, result, handoff) to a task and/or change its status or assignee.",
    inputSchema: {
      id: z.string(), author: z.enum(["chatgpt", "claude", "human"]), note: z.string().optional(),
      status: z.enum(["open", "in_progress", "done"]).optional(), assignee: z.enum(["chatgpt", "claude", "anyone"]).optional(),
    },
  }, async ({ id, author, note, status, assignee }) => {
    const tasks = load();
    const task = tasks.find((t) => t.id === id);
    if (!task) return { ...text(`No task ${id}`), isError: true };
    if (note) task.notes.push({ author, note, at: new Date().toISOString() });
    if (status) task.status = status;
    if (assignee) task.assignee = assignee;
    save(tasks);
    return text(task);
  });

  server.registerTool("remember", {
    description: "Save a fact, preference, or decision to the memory shared by ChatGPT and Claude.",
    inputSchema: { text: z.string(), author: Who, tags: z.array(z.string()).default([]) },
  }, async ({ text: t, author, tags }) => {
    const mem = loadMem();
    const m = { id: randomUUID().slice(0, 8), text: t, author, tags, at: new Date().toISOString() };
    mem.push(m);
    saveMem(mem);
    return text(m);
  });

  server.registerTool("recall", {
    description: "Search shared memory (both AIs' memories). Empty query returns everything. Call this at the start of a conversation.",
    inputSchema: { query: z.string().default(""), tag: z.string().optional() },
  }, async ({ query, tag }) => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return text(loadMem().filter((m) => (!tag || m.tags.includes(tag)) && words.every((w) => m.text.toLowerCase().includes(w))));
  });

  server.registerTool("forget", {
    description: "Delete a shared memory by id.",
    inputSchema: { id: z.string() },
  }, async ({ id }) => {
    const mem = loadMem();
    const kept = mem.filter((m) => m.id !== id);
    saveMem(kept);
    return text(kept.length < mem.length ? `Forgot ${id}` : `No memory ${id}`);
  });

  server.registerTool("ask_claude", {
    description: "Ask your coworker Claude (sees shared memory + tasks) for help, a second opinion, or a review. Needs ANTHROPIC_API_KEY on the server.",
    inputSchema: { prompt: z.string() },
  }, async ({ prompt }) => {
    if (!anthropic) return { ...text("ANTHROPIC_API_KEY not set"), isError: true };
    const r = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 4096, system: teamContext("claude"), messages: [{ role: "user", content: prompt }] });
    const reply = r.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    absorb(reply, "claude");
    return text(reply);
  });

  server.registerTool("ask_chatgpt", {
    description: "Ask your coworker ChatGPT (sees shared memory + tasks) for help, a second opinion, or a review. Needs OPENAI_API_KEY on the server.",
    inputSchema: { prompt: z.string() },
  }, async ({ prompt }) => {
    if (!openai) return { ...text("OPENAI_API_KEY not set"), isError: true };
    const r = await openai.responses.create({ model: GPT_MODEL, instructions: teamContext("chatgpt"), input: prompt });
    absorb(r.output_text, "chatgpt");
    return text(r.output_text);
  });

  return server;
}

const app = express();
app.use(express.json({ limit: "4mb" }));
app.get("/", (_req, res) => res.send("vg-hoster MCP bridge: POST /mcp"));
app.post("/mcp", async (req, res) => {
  if (TOKEN) {
    const given = req.query.token || (req.headers.authorization || "").replace(/^Bearer /, "");
    if (given !== TOKEN) return res.status(401).json({ error: "unauthorized" });
  }
  // Stateless: a fresh server + transport per request.
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(PORT, () => console.log(`MCP bridge on http://localhost:${PORT}/mcp`));
