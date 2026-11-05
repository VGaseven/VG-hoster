import { Db } from '../db/db';
import { hhmm, localDate } from '../common/time';

/**
 * لوحة الجهة: توزيع الحضور على الفترات والالتزام الفعلي.
 * تعتمد فقط على بيانات مدار (الحجوزات) وبيانات الحضور المعتمدة من الجهة، وليس على نتائج Google.
 */
export class DashboardService {
  constructor(private readonly db: Db) {}

  async distribution(siteId: string, from: string, to: string) {
    const rows = await this.db.query(
      `SELECT s.id, s.date, s.start_time, s.end_time, s.quota, s.min_staff, s.booked_count, s.closed,
              count(a.id) FILTER (WHERE a.id IS NOT NULL) AS attended
         FROM slots s
         LEFT JOIN bookings b ON b.slot_id=s.id AND b.status='active'
         LEFT JOIN attendance a ON a.employee_id=b.employee_id AND a.date=s.date
        WHERE s.site_id=$1 AND s.date BETWEEN $2 AND $3
        GROUP BY s.id ORDER BY s.date, s.start_time`,
      [siteId, from, to],
    );
    const byDate = new Map<string, any[]>();
    for (const r of rows) {
      const list = byDate.get(r.date) ?? [];
      list.push({
        slotId: r.id,
        start: hhmm(r.start_time),
        end: hhmm(r.end_time),
        quota: r.quota,
        minStaff: r.min_staff,
        booked: r.booked_count,
        attended: Number(r.attended),
        closed: r.closed,
        utilization: r.quota ? r.booked_count / r.quota : 0,
        underCovered: r.booked_count < r.min_staff,
      });
      byDate.set(r.date, list);
    }
    return [...byDate.entries()].map(([date, slots]) => ({
      date,
      totalBooked: slots.reduce((a, s) => a + s.booked, 0),
      totalQuota: slots.reduce((a, s) => a + s.quota, 0),
      slots,
    }));
  }

  /**
   * الالتزام: مقارنة الحجز بالحضور الفعلي المعتمد.
   * on_time: الوصول قبل نهاية الفترة + مهلة السماح، late: بعدها، no_record: لا يوجد سجل حضور (قد يكون غيابًا أو تأخر استيراد).
   */
  async compliance(siteId: string, from: string, to: string, tz: string) {
    const today = localDate(tz);
    const r = await this.db.one(
      `SELECT
         count(*) AS total,
         count(*) FILTER (WHERE a.id IS NOT NULL AND (a.check_in_at AT TIME ZONE $4) <= (b.date + s.end_time + make_interval(mins => p.late_grace_min))) AS on_time,
         count(*) FILTER (WHERE a.id IS NOT NULL AND (a.check_in_at AT TIME ZONE $4) >  (b.date + s.end_time + make_interval(mins => p.late_grace_min))) AS late,
         count(*) FILTER (WHERE a.id IS NOT NULL AND (a.check_in_at AT TIME ZONE $4) < (b.date + s.start_time - interval '30 minutes')) AS very_early,
         count(*) FILTER (WHERE a.id IS NULL) AS no_record
       FROM bookings b
       JOIN slots s ON s.id=b.slot_id
       JOIN policies p ON p.site_id=s.site_id
       LEFT JOIN attendance a ON a.employee_id=b.employee_id AND a.date=b.date
      WHERE s.site_id=$1 AND b.status='active' AND b.date BETWEEN $2 AND LEAST($3::date, $5::date - 1)`,
      [siteId, from, to, tz, today],
    );
    const total = Number(r.total);
    const withRecord = total - Number(r.no_record);
    return {
      period: { from, to: to < today ? to : today },
      total,
      onTime: Number(r.on_time),
      late: Number(r.late),
      veryEarly: Number(r.very_early),
      noRecord: Number(r.no_record),
      onTimeRate: withRecord ? Number(r.on_time) / withRecord : null,
      note: 'تُحسب النسبة على الحجوزات التي لها سجل حضور معتمد فقط',
    };
  }

  /** فترات قادمة (لم تبدأ بعد) حجوزاتها أقل من الحد الأدنى للتغطية */
  async alerts(siteId: string, tz: string) {
    const under = await this.db.query(
      `SELECT date, start_time, booked_count, min_staff FROM slots
        WHERE site_id=$1 AND (date + start_time) > (now() AT TIME ZONE $2)
          AND booked_count < min_staff AND NOT closed
        ORDER BY date, start_time LIMIT 50`,
      [siteId, tz],
    );
    return under.map((u) => ({
      kind: 'under_coverage',
      date: u.date,
      start: hhmm(u.start_time),
      booked: u.booked_count,
      minStaff: u.min_staff,
    }));
  }

  async pendingChanges(orgId: string) {
    return this.db.query(
      `SELECT cr.id, cr.reason, cr.created_at, e.name AS employee, b.date,
              to_char(os.start_time,'HH24:MI') AS from_start, to_char(ns.start_time,'HH24:MI') AS to_start,
              ns.quota - ns.booked_count AS to_remaining
         FROM change_requests cr
         JOIN employees e ON e.id=cr.employee_id
         JOIN bookings b ON b.id=cr.booking_id
         JOIN slots os ON os.id=b.slot_id
         JOIN slots ns ON ns.id=cr.new_slot_id
        WHERE e.org_id=$1 AND cr.status='pending'
        ORDER BY b.date, cr.created_at`,
      [orgId],
    );
  }
}
