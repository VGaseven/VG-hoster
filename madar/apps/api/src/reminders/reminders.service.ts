import { Db } from '../db/db';
import { localTime } from '../common/time';

export interface Notifier {
  send(n: { employeeId: string; email: string; name: string; kind: string; text: string; payload: any }): Promise<void>;
}

/** يرسل التذكيرات إلى Webhook تضبطه الجهة (بريد/SMS/تطبيق)، أو يسجّلها فقط عند عدم الضبط */
export class WebhookNotifier implements Notifier {
  constructor(private readonly url?: string, private readonly fetchImpl: typeof fetch = fetch) {}
  async send(n: Parameters<Notifier['send']>[0]) {
    if (!this.url) {
      console.log(`[reminder] ${n.kind} -> ${n.email}: ${n.text}`);
      return;
    }
    const res = await this.fetchImpl(this.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(n) });
    if (!res.ok) throw new Error(`webhook ${res.status}`);
  }
}

export function reminderText(kind: string, p: { date: string; start: string; end: string }, departAt?: string) {
  if (kind === 'reminder_evening') return `تذكير: موعد حضورك غدًا ${p.date} بين ${p.start} و${p.end}.`;
  return departAt
    ? `حان وقت الاستعداد: موعدك ${p.start}–${p.end}. الانطلاق المقترح ${departAt}.`
    : `حان وقت الاستعداد: موعدك اليوم ${p.start}–${p.end}.`;
}

export class RemindersService {
  constructor(private readonly db: Db, private readonly notifier: Notifier) {}

  /** يرسل التذكيرات المستحقة؛ آمن للتشغيل من أكثر من نسخة بفضل SKIP LOCKED */
  async dispatchDue(limit = 100): Promise<number> {
    return this.db.tx(async (c) => {
      const due = (
        await c.query(
          `SELECT n.*, e.email, e.name, b.planned_departure, o.timezone
             FROM notifications n
             JOIN employees e ON e.id=n.employee_id
             JOIN organizations o ON o.id=e.org_id
             LEFT JOIN bookings b ON b.id=n.booking_id
            WHERE n.sent_at IS NULL AND NOT n.cancelled AND n.send_at <= now()
            ORDER BY n.send_at
            LIMIT $1
            FOR UPDATE OF n SKIP LOCKED`,
          [limit],
        )
      ).rows;
      for (const n of due) {
        const depart = n.planned_departure ? localTime(n.timezone, new Date(n.planned_departure)) : undefined;
        try {
          await this.notifier.send({ employeeId: n.employee_id, email: n.email, name: n.name, kind: n.kind, text: reminderText(n.kind, n.payload, depart), payload: n.payload });
          await c.query(`UPDATE notifications SET sent_at=now() WHERE id=$1`, [n.id]);
        } catch (e) {
          console.warn(`[reminder] failed ${n.id}: ${(e as Error).message}`); // يُعاد المحاولة في الدورة التالية
        }
      }
      return due.length;
    });
  }

  /** حذف تقديرات الرحلات المنتهية — لا نؤرشف نتائج خدمة الخرائط */
  async purgeEstimates(): Promise<number> {
    const r = await this.db.query(`DELETE FROM trip_estimate_cache WHERE expires_at <= now() RETURNING cache_key`);
    return r.length;
  }
}
