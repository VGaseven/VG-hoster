// SQLite storage (built into Node 22+, no native build needed).
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export const DB_FILE = process.env.DB_FILE || "data/bridge.db";
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
export const db = new DatabaseSync(DB_FILE);

db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS projects (name TEXT PRIMARY KEY, description TEXT DEFAULT '', lead TEXT DEFAULT 'anyone',
  claude_model TEXT, gpt_model TEXT, temperature REAL, budget_usd REAL, created TEXT DEFAULT CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO projects (name, description) VALUES ('default', 'General work');
CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, project TEXT DEFAULT 'default', title TEXT, details TEXT DEFAULT '',
  assignee TEXT DEFAULT 'anyone', status TEXT DEFAULT 'open', parent TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP, updated TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS task_notes (id INTEGER PRIMARY KEY, task_id TEXT, author TEXT, note TEXT, at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, project TEXT DEFAULT 'default', text TEXT, author TEXT, tags TEXT DEFAULT '[]',
  pinned INTEGER DEFAULT 0, embedding TEXT, at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS profile (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS roles (agent TEXT PRIMARY KEY, role TEXT);
INSERT OR IGNORE INTO roles VALUES ('claude', 'Builder and reviewer: writes code and documents, checks work carefully.');
INSERT OR IGNORE INTO roles VALUES ('chatgpt', 'Researcher and brainstormer: explores ideas, gathers information, drafts options.');
CREATE TABLE IF NOT EXISTS skills (name TEXT PRIMARY KEY, description TEXT, steps TEXT, author TEXT, updated TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS files (path TEXT, project TEXT DEFAULT 'default', version INTEGER, content TEXT, author TEXT,
  deleted INTEGER DEFAULT 0, at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (project, path, version));
CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, project TEXT DEFAULT 'default', author TEXT, text TEXT, at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY, actor TEXT, action TEXT, detail TEXT, at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS usage (id INTEGER PRIMARY KEY, project TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL, at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS schedules (id TEXT PRIMARY KEY, project TEXT DEFAULT 'default', cron TEXT, agent TEXT, prompt TEXT,
  notify INTEGER DEFAULT 1, enabled INTEGER DEFAULT 1, last_run TEXT, last_result TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, actor TEXT, action TEXT, args TEXT, status TEXT DEFAULT 'pending',
  result TEXT, at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
INSERT OR IGNORE INTO roles VALUES ('claude-code', 'Engineer with repo access: builds and changes code in GitHub, opens pull requests for the human to review.');
`);

export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

// Columns added after the first release; existing databases get them on startup.
const addColumn = (table, def) => {
  if (!all(`PRAGMA table_info(${table})`).some((c) => c.name === def.split(" ")[0])) db.exec(`ALTER TABLE ${table} ADD COLUMN ${def}`);
};
for (const c of ["claimed_by TEXT", "claimed_at TEXT", "github_repo TEXT", "github_issue INTEGER", "github_url TEXT"]) addColumn("tasks", c);
