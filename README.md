# VG-hoster
bot 24/7 — an MCP bridge so **ChatGPT and Claude work together** on shared tasks.

## Tools exposed
| Tool | What it does |
|---|---|
| `create_task` / `list_tasks` / `update_task` | Shared task board (stored in `tasks.json`). Either AI can create, claim, add notes, hand off, finish. |
| `ask_claude` | ChatGPT (or anyone) asks Claude directly. Needs `ANTHROPIC_API_KEY`. |
| `ask_chatgpt` | Claude (or anyone) asks GPT directly. Needs `OPENAI_API_KEY`. |

## Run
```bash
npm install
BRIDGE_TOKEN=pick-a-secret ANTHROPIC_API_KEY=... OPENAI_API_KEY=... npm start
```
Host it somewhere public with HTTPS (Render, Railway, Fly.io, a VPS) or tunnel locally (`ngrok http 3000`).
Optional env: `PORT`, `TASKS_FILE`, `CLAUDE_MODEL`, `GPT_MODEL`.

## Connect ChatGPT
Settings → Apps & Connectors → Advanced → enable **Developer mode** → Create connector:
URL `https://YOUR-HOST/mcp?token=pick-a-secret`, auth: none.

## Connect Claude
- Claude.ai: Settings → Connectors → Add custom connector → same URL.
- Claude Code: `claude mcp add --transport http bridge "https://YOUR-HOST/mcp?token=pick-a-secret"`

## Example flow
1. In ChatGPT: "Create a task for Claude: review my landing page copy."
2. In Claude: "List my tasks assigned to claude and do them; add your result as a note and mark done."
3. Back in ChatGPT: "Show task results." — or skip the hand-off and just say "ask_claude to review this".
