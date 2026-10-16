# VG-hoster — Team Bridge
ChatGPT and Claude work as **equal coworkers** for you. They share memory, tasks, files, skills and a team chat, and each can call the other.
You run everything from one dashboard.

## Who controls whom
- **You're the boss.** ChatGPT and Claude are peers. Each can call the other (`ask_claude`, `ask_chatgpt`, `debate`, `review`).
- **Approvals:** risky actions an AI starts wait for your OK in the dashboard. By default these are deleting memories, files or tasks and creating schedules. Change the list with `REQUIRE_APPROVAL`.
- **Loop limit:** caps AI-to-AI calls per minute, so they can't ping-pong forever (`MAX_AI_CALLS_PER_MIN`, default 20).
- **Activity log:** every action is recorded with who did it.

## The dashboard (`/`)
| Tab | What you do there |
|---|---|
| Chat | One team thread. Message Claude, ChatGPT, both, or start a debate. |
| Tasks | Kanban board by assignee. Drag to hand off, "Do it" to have the AI work the task now, "Split with AI" to break a goal into subtasks. |
| Memory | Search (by meaning when OpenAI is configured), pin core memories, edit, delete, import (paste a ChatGPT memory list), export. |
| Files | Shared workspace with full version history. |
| Skills | Shared playbooks either AI can run. |
| Schedules | Cron jobs: an AI runs a prompt on a schedule, posts to chat and notifies you. |
| Approvals | Approve or reject AI requests. |
| Settings | Your profile, AI roles, per-project lead, models, temperature and budget, connector URLs. |
| Activity | Who did what, plus API spend. |

## MCP tools (40)
`get_briefing` · tasks: `create_task` `list_tasks` `update_task` `handoff` `split_task` `work_task` `delete_task` ·
memory: `remember` `recall` `update_memory` `forget` `import_memories` · personalization: `get_profile` `set_profile` `set_role` `list_projects` `save_project` ·
skills: `list_skills` `save_skill` `run_skill` · coworkers: `ask_claude` `ask_chatgpt` `debate` `review` `team_chat` `read_team_chat` ·
files: `write_file` `read_file` `list_files` `file_history` `delete_file` · web: `web_search` `fetch_url` ·
scheduling: `create_schedule` `list_schedules` `set_schedule_enabled` `notify_human` · oversight: `activity_log` `usage`

## Run
Needs Node 22.13 or newer. Data is stored in SQLite at `data/bridge.db`, with daily backups (the last 7 are kept).
```bash
npm install
BRIDGE_TOKEN=pick-a-secret ANTHROPIC_API_KEY=... OPENAI_API_KEY=... npm start
```
Deploy: `render.yaml` (Render, with a persistent disk) or the `Dockerfile` (Railway, Fly.io, a VPS). Mount `/data` so data survives restarts.

| Env | Purpose |
|---|---|
| `BRIDGE_TOKEN` | Required in production. Protects the dashboard and MCP endpoint. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | Let each AI be called by the other, and let the dashboard reach them. OpenAI also powers meaning-based memory search. |
| `CLAUDE_MODEL`, `GPT_MODEL` | Default models (each project can override). |
| `DAILY_BUDGET_USD` | Hard daily spend cap. `PRICES` overrides per-model prices. |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`, `DISCORD_WEBHOOK_URL`, `NOTIFY_WEBHOOK_URL` | Notifications. |
| `REQUIRE_APPROVAL`, `MAX_AI_CALLS_PER_MIN`, `RATE_LIMIT_PER_MIN`, `TZ`, `DB_FILE`, `BACKUP_DIR` | Guard rails, rate limits, time zone and storage locations. |

## Connect
Copy the URLs from **Settings → Connect your apps**:
- **ChatGPT:** Settings → Apps & Connectors → Advanced → Developer mode → Create connector, using `https://HOST/mcp?agent=chatgpt&token=…`
- **Claude.ai:** Settings → Connectors → Add custom connector, using `https://HOST/mcp?agent=claude&token=…`
- **Claude Code:** `claude mcp add --transport http bridge "https://HOST/mcp?agent=claude&token=…"`

Then tell each app: *"Call get_briefing at the start of every chat."*

## Limits
- The AIs act only while you're chatting with them, or when a schedule fires. Neither runs on its own otherwise.
- The apps' built-in memories aren't merged; the shared memory lives here.
- Login uses a token in the URL, not OAuth. Keep the URLs private.
