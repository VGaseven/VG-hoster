// Load a reviewed project inventory into the Hub: sections, projects, recorded status, links and real session links.
// Usage (on the bridge computer):  node --env-file=.env scripts/import-hub-inventory.mjs <inventory.json | bridge:<project>/<path>> [--dry-run]
// The inventory itself is private and is not kept in this repository. Re-running it is safe: existing records are updated.
import fs from "node:fs";

const [source, flag] = process.argv.slice(2);
const dry = flag === "--dry-run";
const base = (process.env.BRIDGE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/$/, "");
const headers = { "Content-Type": "application/json", ...(process.env.BRIDGE_TOKEN ? { Authorization: `Bearer ${process.env.BRIDGE_TOKEN}` } : {}) };
if (!source) { console.error("Give an inventory file, or bridge:<project>/<path> for a file saved on the bridge."); process.exit(1); }

async function api(path, body) {
  const r = await fetch(`${base}/api/${path}`, body ? { method: "POST", headers, body: JSON.stringify(body) } : { headers });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path}: ${data.error || r.status}`);
  return data;
}

let text;
if (source.startsWith("bridge:")) {
  const [project, ...rest] = source.slice(7).split("/");
  text = (await api(`file?${new URLSearchParams({ project, path: rest.join("/") })}`)).content;
} else text = fs.readFileSync(source, "utf8");
const inv = JSON.parse(text);

const SECTIONS = ["work", "uni", "personal", "gaming", "skills"];
const existing = new Set((await api("projects")).map((p) => p.name));
const step = async (label, fn) => { console.log((dry ? "would " : "") + label); if (!dry) await fn(); };

for (const s of SECTIONS) if (!existing.has(s)) await step(`create section ${s}`, () => api("projects", { name: s, description: inv.sections?.[s] || "" }));
for (const p of inv.projects || []) {
  if (!SECTIONS.includes(p.section)) throw new Error(`${p.name}: unknown section ${p.section}`);
  if (!existing.has(p.name)) await step(`create project ${p.name}`, () => api("projects", { name: p.name, description: p.description || "" }));
  await step(`place ${p.name} in ${p.section}`, () => api("project-parent", { project: p.name, parent: p.section }));
  await step(`record details for ${p.name} (${p.status || "unknown"})`, () => api("project-meta",
    { project: p.name, status: p.status || "unknown", last_step: p.last_step || "", remaining: p.remaining || "", links: p.links || [] }));
  for (const s of p.sessions || []) await step(`link session ${s.title}`, () => api("sessions",
    { project: p.name, id: s.id, source: s.source, source_url: s.url, title: s.title, status: s.status || "unknown", summary: s.summary || "" }));
}
console.log(dry ? "Dry run only; nothing was changed." : "Inventory imported.");
