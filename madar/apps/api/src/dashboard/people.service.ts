import { Db } from '../db/db';
import { hhmm, localDate, addDays } from '../common/time';

/** رؤية المسؤول لمواعيد موظفيه: جدول اليوم وملخص كل موظف */
export class PeopleService {
  constructor(private readonly db: Db) {}

  /** كل موظفي المقر في يوم معين: موعده، حيّه، وقت انطلاقه المخطط، حضوره الفعلي، إجازته */
  async roster(siteId: string, date: string, tz: string) {
    const rows = await this.db.query(
      `SELECT e.id, e.name, e.external_id, e.eligible, d.name AS district,
              b.id AS booking_id, s.start_time, s.end_time, b.planned_departure,
              a.check_in_at,
              EXISTS (SELECT 1 FROM leaves l WHERE l.employee_id=e.id AND $2::date BETWEEN l.start_date AND l.end_date) AS on_leave,
              to_char(ns.start_time,'HH24:MI') AS change_to,
              p.late_grace_min
         FROM employees e
         LEFT JOIN districts d ON d.id=e.district_id
         LEFT JOIN bookings b ON b.employee_id=e.id AND b.date=$2 AND b.status='active'
         LEFT JOIN slots s ON s.id=b.slot_id
         LEFT JOIN change_requests cr ON cr.booking_id=b.id AND cr.status='pending'
         LEFT JOIN slots ns ON ns.id=cr.new_slot_id
         LEFT JOIN attendance a ON a.employee_id=e.id AND a.date=$2
         LEFT JOIN policies p ON p.site_id=e.site_id
        WHERE e.site_id=$1 AND e.active AND e.role='employee'
        ORDER BY s.start_time NULLS LAST, e.name`,
      [siteId, date],
    );
    const fmt = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
    return rows.map((r) => {
      let status: string;
      if (r.on_leave) status = 'leave';
      else if (!r.eligible) status = 'not_eligible';
      else if (!r.booking_id) status = 'no_booking';
      else if (r.check_in_at) {
        const checkIn = fmt(r.check_in_at);
        const end = hhmm(r.end_time);
        const [eh, em] = end.split(':').map(Number);
        const limit = eh * 60 + em + (r.late_grace_min ?? 0);
        const [ch, cm] = checkIn.split(':').map(Number);
        status = ch * 60 + cm <= limit ? 'on_time' : 'late';
      } else status = 'booked';
      return {
        id: r.id,
        name: r.name,
        externalId: r.external_id,
        district: r.district,
        start: r.start_time ? hhmm(r.start_time) : null,
        end: r.end_time ? hhmm(r.end_time) : null,
        plannedDeparture: r.planned_departure ? fmt(r.planned_departure) : null,
        checkIn: r.check_in_at ? fmt(r.check_in_at) : null,
        pendingChangeTo: r.change_to,
        status,
      };
    });
  }

  /** ملخص كل موظف لآخر ٣٠ يومًا: موعده المعتاد، عدد الحجوزات، الالتزام */
  async summary(siteId: string, tz: string) {
    const today = localDate(tz);
    const from = addDays(today, -30);
    const rows = await this.db.query(
      `SELECT e.id, e.name, e.external_id, d.name AS district, e.travel_mode,
              to_char(e.preferred_start,'HH24:MI') AS preferred,
              count(b.id) FILTER (WHERE b.date < $3) AS past_bookings,
              count(b.id) FILTER (WHERE b.date >= $3) AS upcoming,
              count(a.id) FILTER (WHERE b.date < $3 AND (a.check_in_at AT TIME ZONE $4) <= (b.date + s.end_time + make_interval(mins => p.late_grace_min))) AS on_time,
              count(a.id) FILTER (WHERE b.date < $3 AND (a.check_in_at AT TIME ZONE $4) > (b.date + s.end_time + make_interval(mins => p.late_grace_min))) AS late,
              mode() WITHIN GROUP (ORDER BY s.start_time) AS usual_start
         FROM employees e
         LEFT JOIN districts d ON d.id=e.district_id
         LEFT JOIN bookings b ON b.employee_id=e.id AND b.status='active' AND b.date >= $2
         LEFT JOIN slots s ON s.id=b.slot_id
         LEFT JOIN policies p ON p.site_id=s.site_id
         LEFT JOIN attendance a ON a.employee_id=e.id AND a.date=b.date
        WHERE e.site_id=$1 AND e.active AND e.role='employee'
        GROUP BY e.id, d.name
        ORDER BY e.name`,
      [siteId, from, today, tz],
    );
    return rows.map((r) => {
      const onTime = Number(r.on_time);
      const late = Number(r.late);
      return {
        id: r.id,
        name: r.name,
        externalId: r.external_id,
        district: r.district,
        travelMode: r.travel_mode,
        usualStart: r.usual_start ? hhmm(r.usual_start) : r.preferred,
        upcoming: Number(r.upcoming),
        pastBookings: Number(r.past_bookings),
        onTime,
        late,
        onTimeRate: onTime + late ? onTime / (onTime + late) : null,
      };
    });
  }
}
