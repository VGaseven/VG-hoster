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
