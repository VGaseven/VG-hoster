# VG-hoster
bot 24/7 — an MCP bridge so **ChatGPT and Claude work together** on shared tasks.

## Tools exposed
| Tool | What it does |
|---|---|
| `create_task` / `list_tasks` / `update_task` | Shared task board (stored in `tasks.json`). Either AI can create, claim, add notes, hand off, finish. |
| `remember` / `recall` / `forget` | Shared memory (stored in `memory.json`). What one AI saves, the other can recall. |
| `ask_claude` | ChatGPT asks its coworker Claude. Claude is given the shared memory + open tasks as context. Needs `ANTHROPIC_API_KEY`. |
| `ask_chatgpt` | Claude asks its coworker ChatGPT, with the same shared context. Needs `OPENAI_API_KEY`. |

When a consulted coworker ends its reply with `REMEMBER: <fact>` lines, those facts are saved to shared memory automatically.

**Tip:** add to both apps' custom instructions: *"At the start of each chat, call `recall` from the bridge. Save important facts with `remember`. Ask your coworker via `ask_claude` / `ask_chatgpt` when a second opinion helps."*

## Run
```bash
npm install
BRIDGE_TOKEN=pick-a-secret ANTHROPIC_API_KEY=... OPENAI_API_KEY=... npm start
```
Host it somewhere public with HTTPS (Render, Railway, Fly.io, a VPS) or tunnel locally (`ngrok http 3000`).
Optional env: `PORT`, `TASKS_FILE`, `MEMORY_FILE`, `CLAUDE_MODEL`, `GPT_MODEL`.

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
