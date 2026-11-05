import { Db, Queryable } from '../db/db';
import { AppError } from '../common/errors';
import { addDays, hhmm, minutesToTime, timeToMinutes, weekday } from '../common/time';

export interface Policy {
  site_id: string;
  earliest_arrival: string;
  latest_arrival: string;
  slot_minutes: number;
  default_quota: number;
  default_min_staff: number;
  workdays: number[];
  booking_horizon_days: number;
  change_cutoff_hours: number;
  require_change_approval: boolean;
  late_grace_min: number;
}

export interface SlotRow {
  id: string;
  site_id: string;
  date: string;
  start_time: string;
  end_time: string;
  quota: number;
  min_staff: number;
  booked_count: number;
  closed: boolean;
}

export function slotView(s: SlotRow) {
  return {
    id: s.id,
    siteId: s.site_id,
    date: s.date,
    start: hhmm(s.start_time),
    end: hhmm(s.end_time),
    quota: s.quota,
    minStaff: s.min_staff,
    booked: s.booked_count,
    remaining: Math.max(0, s.quota - s.booked_count),
    closed: s.closed,
    full: s.closed || s.booked_count >= s.quota,
  };
}

/** فترات اليوم حسب سياسة المقر */
export function slotTimes(p: Pick<Policy, 'earliest_arrival' | 'latest_arrival' | 'slot_minutes'>): Array<{ start: string; end: string }> {
  const out: Array<{ start: string; end: string }> = [];
  const last = timeToMinutes(p.latest_arrival);
  for (let t = timeToMinutes(p.earliest_arrival); t < last; t += p.slot_minutes) {
    out.push({ start: minutesToTime(t), end: minutesToTime(Math.min(t + p.slot_minutes, last)) });
  }
  return out;
}

export class SlotsService {
  constructor(private readonly db: Db) {}

  async policy(siteId: string, q: Queryable = this.db.pool): Promise<Policy> {
    const r = await q.query(`SELECT * FROM policies WHERE site_id=$1`, [siteId]);
    if (!r.rows[0]) throw new AppError('NO_POLICY', 'لم تُحدَّد سياسة المرونة لهذا المقر بعد', 409);
    return r.rows[0];
  }

  /** ينشئ الفترات الناقصة (أيام العمل فقط) دون المساس بالموجودة */
  async ensureSlots(siteId: string, from: string, to: string): Promise<void> {
    const p = await this.policy(siteId);
    const times = slotTimes(p);
    const values: unknown[] = [];
    const rows: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (!p.workdays.includes(weekday(d))) continue;
      for (const t of times) {
        const i = values.length;
        values.push(siteId, d, t.start, t.end, p.default_quota, p.default_min_staff);
        rows.push(`($${i + 1},$${i + 2},$${i + 3},$${i + 4},$${i + 5},$${i + 6})`);
      }
    }
    if (!rows.length) return;
    await this.db.query(
      `INSERT INTO slots(site_id, date, start_time, end_time, quota, min_staff) VALUES ${rows.join(',')}
       ON CONFLICT (site_id, date, start_time) DO NOTHING`,
      values,
    );
  }

  async list(siteId: string, from: string, to: string): Promise<SlotRow[]> {
    await this.ensureSlots(siteId, from, to);
    return this.db.query<SlotRow>(
      `SELECT * FROM slots WHERE site_id=$1 AND date BETWEEN $2 AND $3 ORDER BY date, start_time`,
      [siteId, from, to],
    );
  }

  /**
   * بدائل عند امتلاء فترة: أقرب الفترات المتاحة في اليوم نفسه،
   * مع تفضيل الفترات التي لم تبلغ الحد الأدنى للتغطية.
   */
  async alternatives(siteId: string, date: string, desiredStart: string, excludeSlotId?: string, limit = 3): Promise<SlotRow[]> {
    return this.db.query<SlotRow>(
      `SELECT * FROM slots
        WHERE site_id=$1 AND date=$2 AND NOT closed AND booked_count < quota AND ($3::uuid IS NULL OR id <> $3)
        ORDER BY abs(extract(epoch FROM (start_time - $4::time))),
                 (booked_count < min_staff) DESC,
                 start_time
        LIMIT $5`,
      [siteId, date, excludeSlotId ?? null, desiredStart, limit],
    );
  }

  async updateSlot(siteId: string, slotId: string, patch: { quota?: number; minStaff?: number; closed?: boolean }): Promise<SlotRow> {
    return this.db.tx(async (c) => {
      const cur = (await c.query<SlotRow>(`SELECT * FROM slots WHERE id=$1 AND site_id=$2 FOR UPDATE`, [slotId, siteId])).rows[0];
      if (!cur) throw new AppError('NOT_FOUND', 'الفترة غير موجودة', 404);
      if (patch.quota !== undefined && patch.quota < cur.booked_count) {
        throw new AppError('QUOTA_BELOW_BOOKED', `لا يمكن خفض الحصة إلى أقل من عدد الحجوزات الحالية (${cur.booked_count})`, 409);
      }
      const r = await c.query<SlotRow>(
        `UPDATE slots SET quota=COALESCE($2,quota), min_staff=COALESCE($3,min_staff), closed=COALESCE($4,closed) WHERE id=$1 RETURNING *`,
        [slotId, patch.quota ?? null, patch.minStaff ?? null, patch.closed ?? null],
      );
      return r.rows[0];
    });
  }

  /** يعيد توليد الفترات المستقبلية غير المحجوزة بعد تعديل السياسة */
  async regenerate(siteId: string, from: string, to: string): Promise<{ removed: number }> {
    const r = await this.db.query(
      `DELETE FROM slots s WHERE site_id=$1 AND date BETWEEN $2 AND $3 AND booked_count=0
         AND NOT EXISTS (SELECT 1 FROM change_requests cr WHERE cr.new_slot_id=s.id AND cr.status='pending')
         AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.slot_id=s.id)
       RETURNING id`,
      [siteId, from, to],
    );
    await this.ensureSlots(siteId, from, to);
    return { removed: r.length };
  }
}
