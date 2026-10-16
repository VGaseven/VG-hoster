// n8n: named webhook workflows the AIs may trigger. Only workflows listed in N8N_WORKFLOWS can be called.
// N8N_WORKFLOWS='{"send_email":{"url":"https://n8n.example.com/webhook/abc","description":"Email someone"},"deploy":"https://…"}'

function workflows() {
  try { return JSON.parse(process.env.N8N_WORKFLOWS || "{}"); } catch { throw new Error("N8N_WORKFLOWS is not valid JSON"); }
}

export const listWorkflows = () =>
  Object.entries(workflows()).map(([name, w]) => ({ name, description: typeof w === "string" ? "" : w.description || "" }));

export async function triggerWorkflow({ name, payload = {} }, actor) {
  const w = workflows()[name];
  if (!w) throw new Error(`Unknown workflow "${name}". Available: ${listWorkflows().map((x) => x.name).join(", ") || "none (set N8N_WORKFLOWS)"}`);
  const url = typeof w === "string" ? w : w.url;
  const headers = { "Content-Type": "application/json" };
  if (process.env.N8N_WEBHOOK_SECRET) headers["X-Bridge-Secret"] = process.env.N8N_WEBHOOK_SECRET;
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify({ workflow: name, from: actor, at: new Date().toISOString(), payload }),
    signal: AbortSignal.timeout(60000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`n8n workflow "${name}" failed: HTTP ${r.status} ${text.slice(0, 500)}`);
  return `Workflow "${name}" ran (HTTP ${r.status}).\n${text.slice(0, 5000)}`;
}

// ---- n8n API: lets the team list, build and switch workflows through the bridge. ----
// The bridge runs next to n8n, so it reaches it on localhost; cloud agents never need their own n8n connection.
// N8N_API_KEY comes from n8n → Settings → n8n API. N8N_API_URL defaults to http://localhost:5678.
const n8nBase = () => (process.env.N8N_API_URL || "http://localhost:5678").replace(/\/$/, "");
export const n8nReady = () => !!process.env.N8N_API_KEY;
const ID_RE = /^[\w-]+$/;

async function n8nApi(path, { method = "GET", body } = {}) {
  if (!n8nReady()) throw new Error("n8n isn't connected to the bridge yet: add N8N_API_KEY (n8n → Settings → n8n API) to ~/VG-hoster/.env and restart the bridge.");
  const r = await fetch(`${n8nBase()}/api/v1${path}`, {
    method, headers: { "X-N8N-API-KEY": process.env.N8N_API_KEY, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) throw new Error(`n8n ${r.status}: ${typeof data === "string" ? data.slice(0, 500) : data.message || JSON.stringify(data).slice(0, 500)}`);
  return data;
}
const checkId = (id) => { if (!ID_RE.test(String(id))) throw new Error(`Bad workflow id "${id}"`); return id; };
const webhookPaths = (w) => (w.nodes || []).filter((n) => /webhook/i.test(n.type || "")).map((n) => n.parameters?.path).filter(Boolean);

export async function n8nListWorkflows() {
  const r = await n8nApi("/workflows?limit=100");
  return (r.data || r).map((w) => ({ id: w.id, name: w.name, active: w.active, nodes: (w.nodes || []).length, webhooks: webhookPaths(w), updated: w.updatedAt }));
}
export const n8nGetWorkflow = ({ id }) => n8nApi(`/workflows/${checkId(id)}`);

// Create (no id) or replace (with id) a workflow. Only the fields n8n accepts are sent.
export async function n8nSaveWorkflow({ id, name, nodes, connections = {}, settings = {} }) {
  const body = { name, nodes, connections, settings: { executionOrder: "v1", ...settings } };
  const w = id ? await n8nApi(`/workflows/${checkId(id)}`, { method: "PUT", body }) : await n8nApi("/workflows", { method: "POST", body });
  return { id: w.id, name: w.name, active: w.active, webhooks: webhookPaths(w), edit_url: `${n8nBase()}/workflow/${w.id}` };
}
export async function n8nSetActive({ id, active }) {
  const w = await n8nApi(`/workflows/${checkId(id)}/${active ? "activate" : "deactivate"}`, { method: "POST" });
  return { id: w.id, name: w.name, active: w.active };
}
export const n8nDeleteWorkflow = async ({ id }) => { await n8nApi(`/workflows/${checkId(id)}`, { method: "DELETE" }); return `Deleted workflow ${id}`; };
export async function n8nExecutions({ workflowId, limit = 10 }) {
  const q = new URLSearchParams({ limit: String(Math.min(limit, 50)), ...(workflowId ? { workflowId: checkId(workflowId) } : {}) });
  const r = await n8nApi(`/executions?${q}`);
  return (r.data || r).map((e) => ({ id: e.id, workflowId: e.workflowId, status: e.status, startedAt: e.startedAt, stoppedAt: e.stoppedAt }));
}
// Run an active workflow that starts with a Webhook node, by its webhook path.
export async function n8nRunWebhook({ path, payload = {}, test = false }, actor) {
  if (!/^[\w-]+(\/[\w-]+)*$/.test(path)) throw new Error(`Bad webhook path "${path}"`);
  const r = await fetch(`${n8nBase()}/${test ? "webhook-test" : "webhook"}/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: actor, at: new Date().toISOString(), payload }),
    signal: AbortSignal.timeout(60000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`n8n webhook "${path}" failed: HTTP ${r.status} ${text.slice(0, 500)}`);
  return `Ran webhook "${path}" (HTTP ${r.status}).\n${text.slice(0, 5000)}`;
}
