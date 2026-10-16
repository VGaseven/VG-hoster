---
name: n8n
description: Shahed's automation helper. Use when Shahed says "n8n", "automation", "automate", "workflow", "every morning…", "when X happens do Y", or calls /n8n. Recommends automations that fit what he's doing, then builds the chosen one in his n8n (or hands it to Codex).
---

# n8n — automations for Shahed

Shahed does not build workflows by hand. You recommend, he picks, the team builds.

## 1. Look before recommending
If the Team Bridge tools are available, call `get_briefing` (or `team_status` + `read_team_chat`) and `list_workflows` first, so ideas fit what he is actually doing and skip automations that already exist.

## 2. Recommend (always do this when the skill is called)
Ask one short question — "What do you want to automate?" — and offer 4–6 numbered ideas, picked for him right now. Pull from this menu, adjusted to his current tasks:

**Daily life**
- Morning brief at 8:00 (Asia/Riyadh): calendar + unread email summary + team status → email or Telegram
- Calendar from chat: "add X Tuesday 5pm" → Google Calendar event
- University emails → short summary + task on the bridge

**His AI team (Team Bridge)**
- Notify him when a task is done or Claude Code opens a PR
- Every evening: what each AI did today
- Weekly API spend report; warn at 80% of the daily budget

**Websites (VG-hoster, university site)**
- Uptime check every 10 min → alert if the site is down
- Contact form → email to Shahed + task for the team
- New PR merged → post the live link

**Messaging**
- WhatsApp/Telegram message "build X" → task for claude-code (official WhatsApp Business API only; personal-chat tools risk a ban)

Each idea: one line saying what happens and when. End with "Pick a number, or tell me your own idea."

## 3. Build the one he picks
Say in one line what you'll build and which accounts it needs (e.g. Gmail login in n8n). Then:

- **If you can reach n8n** (you run on his Mac, e.g. Codex, and have the n8n API key):
  1. `POST http://localhost:5678/api/v1/workflows` with header `X-N8N-API-KEY`, body = the workflow JSON (name, nodes, connections, settings).
  2. `POST /api/v1/workflows/{id}/activate`.
  3. If other AIs should trigger it, start it with a Webhook node (POST) and tell Shahed the one line to add to `N8N_WORKFLOWS` in `~/VG-hoster/.env`, then restart the bridge.
  4. Report: name, trigger, what it does, how to turn it off.
- **If you can't reach n8n** (you run in the cloud, like Claude Code on claude.ai): create a bridge task with `create_task`, assignee `chatgpt` (Codex is the automation engineer), with the full spec. Tell Shahed: "Sent to Codex — tell it to check its tasks."

Never ask for the n8n API key in a shared chat or the team chat. Workflows that send messages or emails to other people need Shahed's OK first.

## 4. Log it
Post one line to `team_chat`: "New automation: <name> — <what it does>".
