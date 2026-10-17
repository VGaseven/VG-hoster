// Telegram remote control: Approve/Reject buttons, /status, /approvals, /pause (or "stop"), /resume.
// Uses long polling, so no public webhook setup is needed. Only TELEGRAM_CHAT_ID (and, in a group, TELEGRAM_ADMIN_IDS) can control the team.
import * as core from "./core.js";
import { telegramApi } from "./notify.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function tg(method, body, timeoutMs = 15000) {
  const r = await fetch(`${telegramApi()}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs) });
  return r.json();
}
const say = (chat_id, text, buttons) => tg("sendMessage", { chat_id, text: text.slice(0, 4000),
  ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}) });
const HELP = `This is your team group chat 💬
Just type: everything goes to the group chat, and every teammate's reply comes here.
• @claude …: Claude answers, builds, or opens a session
• @codex …: Codex answers or builds
• @local …: the free AI on your computer
• @all …: Claude + Codex
• No @: Codex answers
• Start with uni: / work: to pick a project

/status: what everyone is doing
/approvals: things waiting for your OK
/pause or "stop": stop all AI work · /resume: start again`;
const approvalButtons = (aid) => [[{ text: "✅ Approve", callback_data: `ap:${aid}:y` }, { text: "❌ Reject", callback_data: `ap:${aid}:n` }]];

// Who may press buttons / send commands.
function isBoss(chat, from) {
  if (!chat || String(chat.id) !== String(process.env.TELEGRAM_CHAT_ID)) return false;
  if (chat.type === "private") return true;
  const admins = (process.env.TELEGRAM_ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return admins.includes(String(from?.id));
}

function statusText() {
  const s = core.teamStatus();
  const lines = [s.paused ? `⛔ PAUSED (${s.paused_info})` : "✅ Team running"];
  lines.push(`💸 Spend today: $${s.spend.today_usd.toFixed(2)}`);
  if (s.pending_approvals.length) lines.push(`🔴 ${s.pending_approvals.length} waiting for your OK — send /approvals`);
  lines.push("", `🔨 In progress (${s.in_progress.length}):`, ...s.in_progress.slice(0, 10).map((t) => `• ${t.title} — ${t.by}${t.github_url ? ` ${t.github_url}` : ""}`));
  lines.push("", `📋 Open (${s.open.length}):`, ...s.open.slice(0, 10).map((t) => `• ${t.title} → ${t.assignee}`));
  return lines.join("\n");
}

export async function handleUpdate(u) {
  const cb = u.callback_query;
  if (cb) {
    if (!isBoss(cb.message?.chat, cb.from)) return tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Not allowed" });
    const m = /^ap:([\w-]+):([yn])$/.exec(cb.data || "");
    if (!m) return tg("answerCallbackQuery", { callback_query_id: cb.id });
    let verdict;
    try {
      const result = await core.decideApproval({ id: m[1], approve: m[2] === "y" });
      verdict = m[2] === "y" ? `✅ Approved\n${String(result).slice(0, 1000)}` : "❌ Rejected";
    } catch (e) { verdict = `⚠️ ${e.message}`; }
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: verdict.split("\n")[0] });
    return tg("editMessageText", { chat_id: cb.message.chat.id, message_id: cb.message.message_id, text: `${cb.message.text || ""}\n\n${verdict}`.slice(0, 4000) });
  }
  const msg = u.message;
  if (!msg?.text || !isBoss(msg.chat, msg.from)) return;
  const text = msg.text.trim(), cmd = text.split(/[\s@]/)[0].toLowerCase(), chat = msg.chat.id;
  if (cmd === "/pause" || /^stop!?$/i.test(text)) return say(chat, core.pauseAll({ reason: text.replace(/^\/pause\s*/i, "").replace(/^stop!?$/i, "") }, "human"));
  if (cmd === "/resume") return say(chat, core.resumeAll({}, "human"));
  if (cmd === "/status") return say(chat, statusText());
  if (cmd === "/approvals") {
    const p = core.pendingApprovals();
    if (!p.length) return say(chat, "Nothing is waiting for your approval.");
    for (const a of p) await say(chat, `🔴 ${a.actor} wants to run ${a.action}\n${a.args.slice(0, 1500)}`, approvalButtons(a.id));
    return;
  }
  if (cmd === "/help" || cmd === "/start") return say(chat, HELP);
  // Anything else is a message to the group chat. "uni: …" / "work: …" picks the project; @claude, @codex, @local, @all wake teammates.
  const pm = /^([a-z][\w-]{1,30}):\s+/i.exec(text);
  const project = pm && core.listProjects().some((p) => p.name === pm[1].toLowerCase()) ? pm[1].toLowerCase() : "default";
  const r = core.teamChat({ text, to: "auto", project }, "human");
  const who = r.answering?.length ? r.answering.join(", ") : "nobody (just posted)";
  return say(chat, `📨 In the group chat${project !== "default" ? ` [${project}]` : ""}. Answering: ${who}`);
}

export function startTelegram() {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_POLL === "0") return false;
  let offset = 0;
  (async () => {
    for (;;) {
      try {
        const r = await tg("getUpdates", { offset, timeout: 25, allowed_updates: ["message", "callback_query"] }, 35000);
        if (!r.ok) {
          console.error("Telegram:", r.description, r.error_code === 409 ? "(another getUpdates/webhook is using this bot; set TELEGRAM_POLL=0 or delete the webhook)" : "");
          await sleep(r.error_code === 409 ? 60000 : 10000);
          continue;
        }
        for (const u of r.result) {
          offset = u.update_id + 1;
          await handleUpdate(u).catch((e) => console.error("Telegram update failed:", e.message));
        }
      } catch (e) {
        if (e.name !== "TimeoutError") console.error("Telegram poll error:", e.message);
        await sleep(3000);
      }
    }
  })();
  return true;
}
