// Obsidian: the human's vault is a folder of Markdown notes on the computer the bridge runs on.
// OBSIDIAN_VAULT=/path/to/vault lets every agent (cloud ones too) list, search, read and write notes through the bridge.
import fs from "node:fs";
import path from "node:path";

const SKIP = new Set([".obsidian", ".trash", ".git", "node_modules"]);
const MAX_NOTE = 200_000; // characters returned or written per note

export const obsidianReady = () => !!process.env.OBSIDIAN_VAULT && fs.existsSync(process.env.OBSIDIAN_VAULT);

function vault() {
  if (!process.env.OBSIDIAN_VAULT) throw new Error("Obsidian isn't connected to the bridge yet: set OBSIDIAN_VAULT to the vault folder in ~/VG-hoster/.env and restart the bridge.");
  const root = fs.realpathSync(process.env.OBSIDIAN_VAULT);
  if (!fs.statSync(root).isDirectory()) throw new Error("OBSIDIAN_VAULT is not a folder.");
  return root;
}

// A note path inside the vault; ".md" is added when missing. Refuses anything that would leave the vault or touch its settings.
function resolveNote(root, rel) {
  let p = String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!p) throw new Error("Give a note path, e.g. \"Projects/Madar.md\".");
  if (!p.toLowerCase().endsWith(".md")) p += ".md";
  if (p.split("/").some((part) => part === ".." || SKIP.has(part))) throw new Error("That path is outside the notes.");
  const full = path.resolve(root, p);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error("That path is outside the vault.");
  // Follow symlinks for anything that already exists, so a link can't point the agents outside the vault.
  let probe = full;
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const real = fs.realpathSync(probe);
  if (real !== root && !real.startsWith(root + path.sep)) throw new Error("That path is outside the vault.");
  return { full, rel: p };
}

function* walk(root, dir = root) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(root, full);
    else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) yield path.relative(root, full).split(path.sep).join("/");
  }
}

export function obsidianList({ folder = "", limit = 200 } = {}) {
  const root = vault();
  const prefix = String(folder).replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const notes = [];
  for (const rel of walk(root)) {
    if (prefix && !rel.startsWith(prefix + "/")) continue;
    notes.push({ path: rel, modified: fs.statSync(path.join(root, rel)).mtime.toISOString() });
  }
  notes.sort((a, b) => b.modified.localeCompare(a.modified));
  return { total: notes.length, notes: notes.slice(0, limit) };
}

export function obsidianRead({ path: rel }) {
  const root = vault();
  const { full, rel: p } = resolveNote(root, rel);
  if (!fs.existsSync(full)) throw new Error(`No note "${p}" in the vault.`);
  const text = fs.readFileSync(full, "utf8");
  return { path: p, content: text.length > MAX_NOTE ? text.slice(0, MAX_NOTE) + "\n…(cut)" : text };
}

export function obsidianSearch({ query, limit = 20 }) {
  const root = vault();
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) throw new Error("Give something to search for.");
  const hits = [];
  for (const rel of walk(root)) {
    const text = fs.readFileSync(path.join(root, rel), "utf8");
    const hay = (rel + "\n" + text).toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    const at = text.toLowerCase().indexOf(words[0]);
    const snippet = at < 0 ? text.slice(0, 160) : text.slice(Math.max(0, at - 60), at + 100);
    hits.push({ path: rel, snippet: snippet.replace(/\s+/g, " ").trim() });
    if (hits.length >= limit) break;
  }
  return hits;
}

// mode: "create" (fails if the note exists), "append" (adds to the end, creating the note if needed) or "overwrite".
export function obsidianWrite({ path: rel, content, mode = "create" }) {
  const root = vault();
  const { full, rel: p } = resolveNote(root, rel);
  if (String(content).length > MAX_NOTE) throw new Error(`Note is too long (over ${MAX_NOTE} characters).`);
  const exists = fs.existsSync(full);
  if (mode === "create" && exists) throw new Error(`"${p}" already exists. Use mode "append" or "overwrite".`);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  if (mode === "append" && exists) {
    const before = fs.readFileSync(full, "utf8");
    fs.appendFileSync(full, (before.endsWith("\n") || !before ? "" : "\n") + content);
  } else fs.writeFileSync(full, content);
  return `${exists ? (mode === "append" ? "Added to" : "Replaced") : "Created"} "${p}" in the vault.`;
}
