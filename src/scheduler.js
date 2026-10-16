// Recurring jobs: an agent runs a prompt on a cron schedule, even when you're away.
import cron from "node-cron";
import { randomUUID } from "node:crypto";
import { all, get, run } from "./db.js";
import { askAgent, log, postMessage } from "./core.js";
import { notify } from "./notify.js";

const jobs = new Map();

async function fire(s) {
  try {
    const result = await askAgent({ agent: s.agent, prompt: s.prompt, project: s.project }, "scheduler");
    run("UPDATE schedules SET last_run = ?, last_result = ? WHERE id = ?", new Date().toISOString(), result.slice(0, 20000), s.id);
    postMessage({ text: `⏰ Scheduled job ${s.id}:\n${result}`, project: s.project }, s.agent);
    if (s.notify) await notify(`⏰ ${s.agent} (${s.id}): ${result.slice(0, 1500)}`);
  } catch (e) {
    run("UPDATE schedules SET last_run = ?, last_result = ? WHERE id = ?", new Date().toISOString(), `error: ${e.message}`, s.id);
  }
}

function arm(s) {
  jobs.get(s.id)?.stop();
  if (s.enabled) jobs.set(s.id, cron.schedule(s.cron, () => fire(s), { timezone: process.env.TZ || "UTC" }));
}

export function startScheduler() { for (const s of all("SELECT * FROM schedules")) arm(s); }

export function createSchedule({ cron: expr, agent, prompt, project = "default", notify: n = true }, actor) {
  if (!cron.validate(expr)) throw new Error(`Invalid cron expression: ${expr} (e.g. "0 9 * * 1-5" = weekdays 9am)`);
  const sid = randomUUID().slice(0, 8);
  run("INSERT INTO schedules (id, project, cron, agent, prompt, notify) VALUES (?,?,?,?,?,?)", sid, project, expr, agent, prompt, n ? 1 : 0);
  arm(get("SELECT * FROM schedules WHERE id = ?", sid));
  log(actor, "create_schedule", `${sid} ${expr} ${agent}: ${prompt}`);
  return get("SELECT * FROM schedules WHERE id = ?", sid);
}
export const listSchedules = () => all("SELECT * FROM schedules ORDER BY created");
export function setSchedule({ id, enabled }, actor) {
  run("UPDATE schedules SET enabled = ? WHERE id = ?", enabled ? 1 : 0, id);
  arm(get("SELECT * FROM schedules WHERE id = ?", id));
  log(actor, enabled ? "enable_schedule" : "disable_schedule", id);
  return get("SELECT * FROM schedules WHERE id = ?", id);
}
export function deleteSchedule({ id }, actor) {
  jobs.get(id)?.stop(); jobs.delete(id);
  run("DELETE FROM schedules WHERE id = ?", id);
  log(actor, "delete_schedule", id);
  return `Deleted schedule ${id}`;
}
export async function runScheduleNow({ id }) { const s = get("SELECT * FROM schedules WHERE id = ?", id); if (!s) throw new Error(`No schedule ${id}`); await fire(s); return get("SELECT * FROM schedules WHERE id = ?", id); }
