// Push notifications to Telegram, Discord or any webhook (all optional).
// buttons: [[{ text, data }]] — shown as tap buttons in Telegram (handled in telegram.js).
export const telegramApi = () => `${(process.env.TELEGRAM_API_URL || "https://api.telegram.org").replace(/\/$/, "")}/bot${process.env.TELEGRAM_BOT_TOKEN}`;

export async function notify(message, { buttons } = {}) {
  const jobs = [];
  const { TELEGRAM_BOT_TOKEN: tg, TELEGRAM_CHAT_ID: chat, DISCORD_WEBHOOK_URL: discord, NOTIFY_WEBHOOK_URL: hook } = process.env;
  const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  if (tg && chat) jobs.push(post(`${telegramApi()}/sendMessage`, { chat_id: chat, text: message.slice(0, 4000),
    ...(buttons ? { reply_markup: { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) } } : {}) }));
  if (discord) jobs.push(post(discord, { content: message.slice(0, 1900) }));
  if (hook) jobs.push(post(hook, { text: message }));
  const r = await Promise.allSettled(jobs);
  return jobs.length ? `Sent to ${r.filter((x) => x.status === "fulfilled").length}/${jobs.length} channels` : "No notification channel configured";
}
