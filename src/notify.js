// Push notifications to Telegram, Discord or any webhook (all optional).
export async function notify(message) {
  const jobs = [];
  const { TELEGRAM_BOT_TOKEN: tg, TELEGRAM_CHAT_ID: chat, DISCORD_WEBHOOK_URL: discord, NOTIFY_WEBHOOK_URL: hook } = process.env;
  const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (tg && chat) jobs.push(post(`https://api.telegram.org/bot${tg}/sendMessage`, { chat_id: chat, text: message.slice(0, 4000) }));
  if (discord) jobs.push(post(discord, { content: message.slice(0, 1900) }));
  if (hook) jobs.push(post(hook, { text: message }));
  const r = await Promise.allSettled(jobs);
  return jobs.length ? `Sent to ${r.filter((x) => x.status === "fulfilled").length}/${jobs.length} channels` : "No notification channel configured";
}
