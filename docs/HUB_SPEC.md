# Shahed's Hub — build brief for Codex

**Who:** Shahed. Economics & finance student, full-time job in media production (creative field). Not a developer:
she should never need Terminal to use this. Only she uses the hub. Others may only view her public website.

**Where:** this repo, branch `claude/chatgpt-claude-mcp-bridge`. The Team Bridge server (`server.js`, `src/`) already runs on
her Mac at `https://bridge.shahed.win`. Build the new hub **inside this server**: serve it at `/`, keep the current
dashboard at `/classic` (`public/index.html` → `public/classic.html`). Use the existing `/api/*` routes and add new ones
in `server.js` + `src/core.js`. Don't break the MCP endpoint (`/mcp`), the GitHub webhook, Telegram, or `npm test`.

## 1. What it is (in one line)
**A calm, organized map of everything Shahed makes. Her AI team keeps it updated, and Bob keeps her informed.**
It's a personal project library, like GitHub but visual. It is not a list of links, and it is not sections per tool.

## 2. The #1 problem it solves
Things are scattered: projects, files and AI chats live in GitHub, Bob's ChatGPT chats and folders on her Mac.
The hub puts each project in one place, with everything that happened to it.

## 3. Organize by PROJECT, not by tool or life area
- Each project / website is one item: e.g. **Uni site 1, Uni site 2, Uni site 3** (each already has summaries, books,
  flashcards and deadlines), **My website**, **Roblox game**, **Project X**, **Team Bridge** itself.
- Figma, After Effects, Blender, n8n, Obsidian are **tools working in the background**. They are not shown as sections.
  At most a small icon on a project that uses them, and a quiet **Connections** page in settings.
- **No "personal" section.** Leave personal life out for now.
- Use the existing `projects` table (name, description). Add columns via `ALTER TABLE` in `src/db.js`:
  `kind` (website | study | creative | code | other), `emoji`, `color`, `github_repo`, `live_url`, `tags` (JSON),
  `status` (active | paused | done), `created`.

## 4. Screens
### Home = 🗺️ Map of everything
- A calm, zoomable map: each project is a soft round bubble (emoji + name + last update), connected by lines.
- **Links between projects are suggested by the AIs** (shared topics like economics, design, video; shared tools).
  Add table `project_links (a, b, reason, by, accepted INTEGER DEFAULT 0)`. Suggested links are dotted with a
  "Keep / Remove" choice; accepted ones are solid. Add an MCP tool `suggest_link` so any agent can propose one.
- Tap a bubble → project page. A search box and a "+ New project" button (also: any AI can create one when Shahed
  says "start a project called X" → MCP tool `create_project`).
- A small strip on top: "Since yesterday: 3 things finished · 1 needs you" (from tasks/messages).
- Mobile (iPhone): the map becomes a vertical list of project cards with the same info; the map is still one tap away.

### Project page (tabs, one project at a time)
1. **🕒 Timeline:** every change on the project over time: who (Shahed, Bob, Claude, Codex, Claude Code, Local AI),
   what, when, with links (PRs, files). Built from `messages`, `task_notes`, `activity`, `files` and GitHub events
   for that project. Newest first, grouped by day.
2. **📂 Files:** files saved on the bridge for this project (`files` table), plus links to its GitHub repo and live site.
3. **💬 Chat:** the group chat for this project (`/api/chat?project=`). Typing `@codex`, `@claude`, `@local`, `@cloud`,
   `@claude-code`, `@all` works as it does today. Show who is answering, and refresh every 5 s while waiting.
4. **🎓 Study** (only for `kind=study`): one review screen pulling the uni site's summaries, books, flashcards and
   deadlines. Start simple: those sites' content is linked by URL, and flashcards/deadlines can be saved as project
   files (`flashcards.json`, `deadlines.json`). Flashcard flip-and-rate review; deadlines sorted with days left.
5. **💼 Portfolio:** one button "Turn this project into a CV case study". It asks `@claude` (via the existing
   `askAgent`) to write a short case study in **economics/finance language**: problem, decisions, tools, result,
   time saved, cost, return. It's saved as a project file `portfolio.md`, editable, with a copy button.
   The goal: show tech/creative projects to finance employers. That problem is real for her.

### 💡 Idea inbox
A quick box on Home: type an idea (later voice). `@claude` turns it into a short project plan and offers
"Make it a project". Ideas live in project `inbox`.

### Settings (quiet, one page)
Language, Connections status (Claude, Codex, Local AI, GitHub, n8n, Telegram: the existing `/api/overview` health),
"Test them" button (existing `/api/engines/check`), link to `/classic`.

## 5. Look & feel
- **Calm and organized**, like a tidy notebook. Lots of white space, quiet. Not a busy dashboard, and not a dark tech panel.
- **Light mode only.** Soft pastel palette: lavender `#f6f2ff` page, white cards, pastel accents (peach `#ffd3bd`,
  mint `#c4eedb`, lavender `#ddd2fb`, pink `#ffd0e1`, sky `#cfe5ff`, butter `#fff0b3`), plum text `#3b3355`,
  lavender button `#7b5cd6`. Give each project its own pastel color.
- **Round, friendly fonts:** Baloo 2 for headings, Nunito for text; Arabic: Baloo Bhaijaan 2 (Google Fonts).
- Rounded cards (20–28 px), soft shadows, chunky but calm buttons. Small, gentle animations; respect reduced motion.
- Optional small cute characters for the agents in the chat and timeline (simple SVG faces: Claude lavender, Codex
  blue, Bob mint with a dot, Local AI green). Keep them small.
- **Bilingual:** English and Arabic (right-to-left), with a language switch at the top. Remember the choice.
- **Short text everywhere.** Headlines plus one or two lines; details open on tap.
- Works great on **iPhone** (she often uses her phone) and desktop.

## 6. Access
- Private: only Shahed. Keep the existing `BRIDGE_TOKEN` login (ask once, remember it in the browser), with a clean,
  friendly login screen. Passkey login is a later step; leave room for it.
- Never show tokens in the UI except on the Settings → Connections page, behind a "show" tap.

## 7. Build order (one pull request per milestone)
1. Static hub shell at `/` (fonts, colors, language switch, login) + Home as project cards + project page with
   **Chat** and **Files**. Old dashboard moved to `/classic`.
2. **Map** + `project_links` + `suggest_link` / `create_project` MCP tools.
3. **Timeline**.
4. **Study** tab.
5. **Portfolio** generator + **Idea inbox**.

## 8. Rules
- Plain HTML/CSS/JS in `public/` (no build step), like the current dashboard. Small, readable files.
- Add tests to `test/bridge.test.js` for every new API route / MCP tool; `npm test` must pass.
- Work on a new branch from `claude/chatgpt-claude-mcp-bridge` and open a pull request into it; never merge yourself.
- No secrets in code, commits or messages.
- When a milestone is done, post one line in the team chat: "✅ Hub milestone N done: <PR link>", so Bob can tell Shahed.
