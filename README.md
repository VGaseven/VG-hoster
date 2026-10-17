# VG-hoster — Team Bridge
You talk to **Dots (ChatGPT)**. Dots briefs you and passes work to **Claude** (thinking, writing, reviewing) and **Claude Code** (builds in your GitHub repo).
Everyone shares memory, tasks, files, skills and a team chat. You stay in control from Telegram or the dashboard.

```
You ⇄ Dots (ChatGPT) ──┐
You ⇄ Claude.ai ───────┼──► Bridge (MCP) ──► tasks · memory · approvals · n8n
Claude Code ───────────┘         │
                                 └─► GitHub issue "@claude …" ──► Claude Code Action ──► PR ──► you approve
You ⇄ Telegram: /status · Approve/Reject buttons · stop · /resume
```

## Who controls whom
- **You're the boss.** Dots is your front desk; Claude and Claude Code do the work.
- **No duplicate work:** an agent must `claim_task` (or `next_task`) before working. Claims are atomic, so two agents can never hold the same task. Abandoned claims expire after `CLAIM_TTL_MIN` (120).
- **Approval levels:**
  - 🔴 red actions wait for your OK: Approve/Reject buttons in Telegram or the dashboard (`REQUIRE_APPROVAL`; default: deleting memories, files or tasks, creating schedules, n8n workflows).
  - 🟡 yellow actions run and notify you (`NOTIFY_ACTIONS`).
  - 🟢 everything else just runs.
  An AI can never approve anything.
- **Kill switch:** send `stop` (or `/pause`) to the Telegram bot, press ⏸ in the dashboard, or have any AI call `pause_all`. Every AI tool, schedule and dispatch stops. Only you can `/resume`.
- **Loop limit, budget cap, activity log:** as before (`MAX_AI_CALLS_PER_MIN`, `DAILY_BUDGET_USD`, Activity tab).

## Free mode: your subscriptions do the thinking
By default (`AI_ENGINE=subscription`) every "ask Claude", "ask ChatGPT", debate, review, split, schedule and skill runs through
**Claude Code** and **Codex on the computer that runs the bridge**, signed in with your Claude and ChatGPT plans. Nothing is billed to an API.
- **Sign in once** on that computer: `claude` → `/login` (choose your Claude account), and `codex login` → **Sign in with ChatGPT**.
- **API keys are hidden** from Claude Code and Codex, so they can't bill the API by accident even if `.env` still has them.
- **Automatic switch:** if one hits its plan limit, the other answers (the reply says so), and the tired one rests for `LIMIT_COOLDOWN_MIN`.
- **Local AI (optional):** set `LOCAL_MODEL` to an Ollama model and a free AI on the computer's GPU joins as a third teammate (`ask_local`, team chat → Local AI). It also answers when both plans are resting.
- **Check it:** dashboard → Settings → **Test them**.
- Memory search uses keywords in this mode (meaning-based search needs the OpenAI API).
- Set `AI_ENGINE=api` to go back to paying per message.

## Group chat: everyone sees everything
- **Telegram is the group chat on your phone:** type anything to the bot and it goes into the group chat (`@claude`, `@codex`, `uni: …` all work). Every teammate's reply is pushed to Telegram the moment it's written. (`TELEGRAM_MIRROR=0` turns the pushes off.)
One chat for you, Bob (ChatGPT Dots), the Claude app, Claude Code, Codex and the Local AI.
- **One @ each:** `@claude` decides by itself: a quick answer, a GitHub build (pull request) or a new session in your Claude app. `@codex` answers, or for real work opens a task in your **Codex app** (needs `CODEX_CLOUD_ENV`; without it Codex does the task on this computer). `@claude-code` and `@cloud` still force a path.
- **Wake someone:** write `@codex`, `@claude`, `@local` or `@all` in a message (dashboard, Bob, Claude app, anywhere). They answer in the chat a minute later, on your subscriptions. In the dashboard, a message with no @mention goes to Codex.
- **Codex builds for real:** when `@codex` decides a request is a task, Codex works on this computer with permission to change files, in a private copy on branch `team/<id>` (folder `~/team-work`), then the bridge pushes it and posts a link to open the pull request. Any agent can also call `build_task`.
- **Self-update:** any agent (or Settings) can call `self_update`: the bridge pulls the newest code and restarts itself (launchd on Mac, the scheduled task on Windows). Nobody has to restart it by hand.
- **Real code work:** write `@claude-code …` (add `repo:owner/name` to pick a repository). It becomes a GitHub issue; Claude Code builds it on a branch and the pull request link comes back to the chat, so you can watch the work on GitHub.
- **Give work:** a task assigned to `codex`, `claude` or `local` starts right away on the PC; "✅ … finished" appears in the chat. Code changes still go to `claude-code` on GitHub. (`AUTO_WORK=0` turns the auto-start off.)
- **Bob is the notifier:** Bob calls `get_updates` every 30 minutes and tells you what finished and what needs you. Apps can't be woken from the bridge, so this is how Bob finds out.

## Setup (about 20 minutes)
1. **Deploy.** Render → New → Blueprint → this repo/branch (uses `render.yaml`). Or use the `Dockerfile` on Railway, Fly.io or a VPS, and mount `/data`.
   Set `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`. `BRIDGE_TOKEN` and `GITHUB_WEBHOOK_SECRET` are generated; copy them from Render. All options: `.env.example`.
2. **Dashboard:** open `https://YOUR-APP/` and paste the token. **Settings → Connect your apps** shows every URL below.
3. **Dots (ChatGPT):** Settings → Apps & Connectors → Advanced → Developer mode → Create connector → `https://YOUR-APP/mcp?agent=chatgpt&token=…`.
   Then tell it once: *"You're Dots. Call get_briefing at the start of every chat."*
4. **Claude.ai:** Settings → Connectors → Add custom connector → `https://YOUR-APP/mcp?agent=claude&token=…`
5. **Claude Code** (on your computer, inside your website repo):
   `claude mcp add --transport http bridge "https://YOUR-APP/mcp?agent=claude-code&token=…"`, and copy `templates/CLAUDE.md` into that repo.
6. **Claude Code on GitHub** (lets Dots get things built while you're away):
   - In the website repo, run `claude` → `/install-github-app`, or copy `templates/claude.yml` to `.github/workflows/` and add the `ANTHROPIC_API_KEY` secret.
   - Create a fine-grained GitHub token with **Issues: read/write** on that repo. Set `GITHUB_TOKEN` and `GITHUB_REPO=owner/repo` on the bridge.
   - Repo → Settings → Webhooks → Add: URL `https://YOUR-APP/github/webhook`, content type `application/json`, secret = `GITHUB_WEBHOOK_SECRET`, events: **Issues, Issue comments, Pull requests**.
7. **Telegram:** create a bot with @BotFather and set `TELEGRAM_BOT_TOKEN`. Message the bot once, then open `https://api.telegram.org/bot<token>/getUpdates` to find your chat id and set `TELEGRAM_CHAT_ID`. Send `/status` to test it.
8. **n8n (optional):** create workflows that start with a **Webhook** node and set
   `N8N_WORKFLOWS={"send_email":{"url":"https://n8n…/webhook/…","description":"Email a customer"}}`. AIs see them via `list_workflows`/`trigger_workflow`.

**Test it:** tell Dots *"Have Claude Code add a FAQ section to the homepage."* You should get a Telegram ping with the GitHub issue, then a PR to review. Merge the PR, and the task turns done.

## What a task looks like
`open` → claimed (`in_progress`, 🔒 by one agent) → `done`. For Claude Code: task → GitHub issue → bot comments and the PR are added as notes → issue closed by your merge → done.
Closed as "not planned" → the task comes back to you.

## The dashboard (`/`)
| Tab | What you do there |
|---|---|
| Chat | One team thread. Message Claude, ChatGPT, both, or start a debate. |
| Tasks | Kanban by assignee (incl. Claude Code). Drag to hand off, "Do it", "Send to Claude Code", "Split with AI". 🔒 shows who holds a task. |
| Memory | Search (by meaning when OpenAI is configured), pin core memories, edit, delete, import, export. |
| Files | Shared workspace with full version history. |
| Skills | Shared playbooks any AI can run. |
| Schedules | Cron jobs: an AI runs a prompt on a schedule, posts to chat and notifies you. |
| Approvals | Approve or reject AI requests (same as the Telegram buttons). |
| Settings | Profile, roles, projects, connector URLs, integration status. |
| Activity | Who did what, plus API spend. |
| ⏸ Pause all | Kill switch (red bar + Resume while paused). |

## MCP tools (48)
`get_briefing` `team_status` · tasks: `create_task` `list_tasks` `claim_task` `next_task` `update_task` `handoff` `split_task` `work_task` `dispatch_task` `delete_task` ·
memory: `remember` `recall` `update_memory` `forget` `import_memories` · personalization: `get_profile` `set_profile` `set_role` `list_projects` `save_project` ·
skills: `list_skills` `save_skill` `run_skill` · coworkers: `ask_claude` `ask_chatgpt` `debate` `review` `team_chat` `read_team_chat` ·
files: `write_file` `read_file` `list_files` `file_history` `delete_file` · web: `web_search` `fetch_url` · n8n: `list_workflows` `trigger_workflow` ·
scheduling: `create_schedule` `list_schedules` `set_schedule_enabled` `notify_human` · oversight: `pending_approvals` `pause_all` `activity_log` `usage`

## Run locally
Needs Node 22.13 or newer. Data is stored in SQLite at `data/bridge.db`, with daily backups (the last 7 are kept).
```bash
npm install
cp .env.example .env   # fill it in, then:
node --env-file=.env server.js
npm test               # end-to-end tests against mock GitHub/Telegram/n8n, no keys needed
```

## Security notes
- The token is in the connector URLs, so keep them private. Rotate `BRIDGE_TOKEN` if one leaks.
- `fetch_url` only reaches public addresses (no localhost, private ranges or cloud metadata), and checks each redirect.
- GitHub webhooks are verified with HMAC. Telegram commands are accepted only from `TELEGRAM_CHAT_ID` (plus `TELEGRAM_ADMIN_IDS` in groups).
- Claude Code opens PRs; merging stays with you. Protect your main branch so nothing lands without review.

## Limits
- The chat apps act only while you're chatting with them. Schedules and Claude Code on GitHub keep working while you're away.
- The apps' built-in memories aren't merged; the shared memory lives here.
