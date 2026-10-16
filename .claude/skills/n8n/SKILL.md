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
Say in one line what you'll build and which logins it needs (e.g. Gmail login in n8n). Then build it through the Team Bridge — it runs next to n8n, so this works from anywhere (cloud Claude, Claude.ai, Codex):
1. `n8n_list_workflows` to avoid duplicates; `n8n_get_workflow` to copy patterns from an existing one.
2. `n8n_save_workflow` with n8n's workflow JSON (`name`, `nodes`, `connections`). Start with a Webhook node (POST, a short `path`) if the team should be able to run it; Schedule Trigger for timed jobs.
3. `n8n_set_active` with `active: true`.
4. Test: `n8n_run_webhook` (Shahed approves it), then `n8n_executions` to confirm it succeeded.
5. Report: name, trigger, what it does, how to turn it off (`n8n_set_active` false).

If the tools say n8n isn't connected, tell Shahed to add `N8N_API_KEY` (n8n → Settings → n8n API) to `~/VG-hoster/.env` and restart the bridge. If there are no Team Bridge tools at all, create nothing — tell him which app to use (Codex or Claude.ai with Team Bridge on).

Never ask for the n8n API key in chat. Workflows that message or email other people need Shahed's OK first.

## 4. Log it
Post one line to `team_chat`: "New automation: <name> — <what it does>".
