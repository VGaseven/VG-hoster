import { PoolClient } from 'pg';
import { Db, Queryable } from '../db/db';
import { Actor } from '../common/actor';
import { AppError } from '../common/errors';
import { audit } from '../common/audit';
import { addDays, hhmm, localDate, weekday, zonedToUtc } from '../common/time';
import { Policy, SlotRow, SlotsService, slotView } from '../slots/slots.service';
import { googleMapsDirectionsUrl } from '../routes/planner';

export interface BookItem { date: string; slotId: string; plannedDeparture?: string }

interface EmployeeRow {
  id: string; org_id: string; site_id: string | null; eligible: boolean; active: boolean; travel_mode: any;
}

const isUniqueViolation = (e: any) => e?.code === '23505';

export class BookingsService {
  constructor(private readonly db: Db, private readonly slots: SlotsService) {}

  private async employee(q: Queryable, actor: Actor): Promise<EmployeeRow & { site_id: string }> {
    const e = (await q.query<EmployeeRow>(`SELECT * FROM employees WHERE id=$1 AND org_id=$2`, [actor.id, actor.orgId])).rows[0];
    if (!e || !e.active) throw new AppError('FORBIDDEN', 'الحساب غير نشط', 403);
    if (!e.eligible) throw new AppError('NOT_ELIGIBLE', 'وظيفتك غير مشمولة بالمرونة حسب بيانات الجهة', 403);
    if (!e.site_id) throw new AppError('NO_SITE', 'لم يُحدَّد مقر عملك في بيانات الجهة', 409);
    return e as EmployeeRow & { site_id: string };
  }

  private async onLeave(q: Queryable, employeeId: string, date: string): Promise<boolean> {
    const r = await q.query(`SELECT 1 FROM leaves WHERE employee_id=$1 AND $2::date BETWEEN start_date AND end_date LIMIT 1`, [employeeId, date]);
    return r.rowCount! > 0;
  }

  private slotStart(s: Pick<SlotRow, 'date' | 'start_time'>, tz: string) {
    return zonedToUtc(s.date, s.start_time, tz);
  }

  /** حجز موعد يوم أو أسبوع كامل — الكل أو لا شيء */
  async book(actor: Actor, items: BookItem[], now = new Date()) {
    if (!items.length) throw new AppError('VALIDATION', 'لا توجد أيام للحجز');
    const dates = new Set(items.map((i) => i.date));
    if (dates.size !== items.length) throw new AppError('VALIDATION', 'لا يمكن حجز أكثر من فترة في اليوم نفسه');

    try {
      return await this.db.tx(async (c) => {
        const emp = await this.employee(c, actor);
        const policy = await this.slots.policy(emp.site_id, c);
        const today = localDate(actor.tz, now);
        const created: any[] = [];
        // ترتيب ثابت لتفادي الجمود (deadlock) عند الحجوزات المتزامنة
        const sorted = [...items].sort((a, b) => a.slotId.localeCompare(b.slotId));
        for (const it of sorted) {
          await this.validateDate(c, emp, policy, it.date, today);
          // زيادة مشروطة ذرّية: لا تتجاوز الحصة مهما تزامنت الطلبات
          const slot = (
            await c.query<SlotRow>(
              `UPDATE slots SET booked_count = booked_count + 1
                WHERE id=$1 AND site_id=$2 AND date=$3 AND NOT closed AND booked_count < quota
                RETURNING *`,
              [it.slotId, emp.site_id, it.date],
            )
          ).rows[0];
          if (!slot) await this.throwUnavailable(c, emp.site_id, it.slotId, it.date);
          if (this.slotStart(slot!, actor.tz) <= now) throw new AppError('PAST_SLOT', 'لا يمكن حجز فترة بدأت بالفعل', 409);
          const b = (
            await c.query(
              `INSERT INTO bookings(employee_id, slot_id, date, planned_departure) VALUES ($1,$2,$3,$4) RETURNING *`,
              [emp.id, slot!.id, it.date, it.plannedDeparture ?? null],
            )
          ).rows[0];
          await this.scheduleReminders(c, actor, b, slot!, now);
          created.push({ ...b, slot: slot! });
        }
        await audit(c, { orgId: actor.orgId, actorId: actor.id, action: 'booking.create', entity: 'booking', data: { items } });
        return created.map((b) => this.view(b, b.slot, actor));
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError('ALREADY_BOOKED', 'لديك حجز قائم في أحد هذه الأيام؛ استخدم طلب التغيير', 409);
      if (e instanceof AppError && e.code === 'SLOT_FULL') {
        // البدائل تُحسب بعد التراجع عن المعاملة لتعكس الحالة الفعلية
        const d = e.details as { date: string; start: string; slotId: string; siteId: string };
        const alts = await this.slots.alternatives(d.siteId, d.date, d.start, d.slotId);
        throw new AppError('SLOT_FULL', e.message, 409, { ...d, alternatives: alts.map(slotView) });
      }
      throw e;
    }
  }

  private async validateDate(c: Queryable, emp: EmployeeRow, policy: Policy, date: string, today: string) {
    if (date < today) throw new AppError('PAST_DATE', 'لا يمكن الحجز لتاريخ مضى', 409);
    if (date > addDays(today, policy.booking_horizon_days)) {
      throw new AppError('BEYOND_HORIZON', `الحجز متاح حتى ${policy.booking_horizon_days} يومًا مقدمًا`, 409);
    }
    if (!policy.workdays.includes(weekday(date))) throw new AppError('NOT_WORKDAY', 'هذا اليوم ليس يوم عمل', 409);
    if (await this.onLeave(c, emp.id, date)) throw new AppError('ON_LEAVE', `لديك إجازة مسجلة في ${date}`, 409);
  }

  private async throwUnavailable(c: Queryable, siteId: string, slotId: string, date: string): Promise<never> {
    const s = (await c.query<SlotRow>(`SELECT * FROM slots WHERE id=$1`, [slotId])).rows[0];
    if (!s || s.site_id !== siteId || s.date !== date) throw new AppError('NOT_FOUND', 'الفترة غير موجودة لمقرك في هذا التاريخ', 404);
    if (s.closed) throw new AppError('SLOT_FULL', `الفترة ${hhmm(s.start_time)} مغلقة`, 409, { date, start: s.start_time, slotId, siteId });
    throw new AppError('SLOT_FULL', `الفترة ${hhmm(s.start_time)} يوم ${date} بلغت حصتها`, 409, { date, start: s.start_time, slotId, siteId });
  }

  async cancel(actor: Actor, bookingId: string, now = new Date()) {
    return this.db.tx(async (c) => {
      const b = (
        await c.query(
          `SELECT b.*, s.start_time, s.date AS slot_date FROM bookings b JOIN slots s ON s.id=b.slot_id
            WHERE b.id=$1 AND b.employee_id=$2 FOR UPDATE OF b`,
          [bookingId, actor.id],
        )
      ).rows[0];
      if (!b) throw new AppError('NOT_FOUND', 'الحجز غير موجود', 404);
      if (b.status !== 'active') throw new AppError('NOT_ACTIVE', 'الحجز ليس نشطًا', 409);
      if (zonedToUtc(b.slot_date, b.start_time, actor.tz) <= now) throw new AppError('PAST_SLOT', 'لا يمكن إلغاء فترة بدأت', 409);
      await c.query(`UPDATE bookings SET status='cancelled', cancelled_at=now() WHERE id=$1`, [b.id]);
      await c.query(`UPDATE slots SET booked_count = booked_count - 1 WHERE id=$1`, [b.slot_id]);
      await c.query(`UPDATE change_requests SET status='withdrawn', decided_at=now() WHERE booking_id=$1 AND status='pending'`, [b.id]);
      await c.query(`UPDATE notifications SET cancelled=true WHERE booking_id=$1 AND sent_at IS NULL`, [b.id]);
      await audit(c, { orgId: actor.orgId, actorId: actor.id, action: 'booking.cancel', entity: 'booking', entityId: b.id });
      return { ok: true };
    });
  }

  /**
   * طلب تغيير الفترة داخل اليوم نفسه. إن كانت السياسة تتطلب اعتمادًا،
   * يبقى الموعد السابق ساريًا حتى يُعتمد الطلب.
   */
  async requestChange(actor: Actor, bookingId: string, newSlotId: string, reason: string | undefined, now = new Date()) {
    const result = await this.db.tx(async (c) => {
      const b = (
        await c.query(
          `SELECT b.*, s.start_time, s.site_id FROM bookings b JOIN slots s ON s.id=b.slot_id
            WHERE b.id=$1 AND b.employee_id=$2 FOR UPDATE OF b`,
          [bookingId, actor.id],
        )
      ).rows[0];
      if (!b || b.status !== 'active') throw new AppError('NOT_FOUND', 'الحجز النشط غير موجود', 404);
      if (b.slot_id === newSlotId) throw new AppError('VALIDATION', 'الفترة الجديدة مطابقة للحالية');
      const policy = await this.slots.policy(b.site_id, c);
      const cutoff = zonedToUtc(b.date, b.start_time, actor.tz).getTime() - policy.change_cutoff_hours * 3600_000;
      if (now.getTime() > cutoff) {
        throw new AppError('CHANGE_CUTOFF', `يجب طلب التغيير قبل ${policy.change_cutoff_hours} ساعة على الأقل من الموعد`, 409);
      }
      const ns = (await c.query<SlotRow>(`SELECT * FROM slots WHERE id=$1`, [newSlotId])).rows[0];
      if (!ns || ns.site_id !== b.site_id || ns.date !== b.date) throw new AppError('VALIDATION', 'الفترة الجديدة يجب أن تكون في اليوم والمقر نفسيهما');
      if (ns.closed || ns.booked_count >= ns.quota) {
        const alts = await this.slots.alternatives(b.site_id, b.date, ns.start_time, ns.id);
        throw new AppError('SLOT_FULL', `الفترة ${hhmm(ns.start_time)} بلغت حصتها`, 409, { alternatives: alts.map(slotView) });
      }
      let cr;
      try {
        cr = (
          await c.query(
            `INSERT INTO change_requests(booking_id, employee_id, new_slot_id, reason) VALUES ($1,$2,$3,$4) RETURNING *`,
            [b.id, actor.id, newSlotId, reason ?? null],
          )
        ).rows[0];
      } catch (e) {
        if (isUniqueViolation(e)) throw new AppError('PENDING_EXISTS', 'لديك طلب تغيير معلّق لهذا الحجز', 409);
        throw e;
      }
      await audit(c, { orgId: actor.orgId, actorId: actor.id, action: 'change.request', entity: 'change_request', entityId: cr.id });
      return { cr, autoApprove: !policy.require_change_approval };
    });
    if (result.autoApprove) return this.decideChange(null, actor.orgId, result.cr.id, true, 'اعتماد تلقائي حسب السياسة', now);
    return { status: 'pending', changeRequestId: result.cr.id };
  }

  async withdrawChange(actor: Actor, id: string) {
    const r = await this.db.query(
      `UPDATE change_requests SET status='withdrawn', decided_at=now() WHERE id=$1 AND employee_id=$2 AND status='pending' RETURNING id`,
      [id, actor.id],
    );
    if (!r.length) throw new AppError('NOT_FOUND', 'لا يوجد طلب معلّق', 404);
    return { ok: true };
  }

  /** اعتماد أو رفض طلب تغيير (مسؤول الجهة) */
  async decideChange(admin: Actor | null, orgId: string, id: string, approve: boolean, note?: string, now = new Date()) {
    return this.db.tx(async (c) => {
      const cr = (
        await c.query(
          `SELECT cr.*, e.org_id, o.timezone FROM change_requests cr
             JOIN employees e ON e.id=cr.employee_id JOIN organizations o ON o.id=e.org_id
            WHERE cr.id=$1 AND e.org_id=$2 FOR UPDATE OF cr`,
          [id, orgId],
        )
      ).rows[0];
      if (!cr) throw new AppError('NOT_FOUND', 'الطلب غير موجود', 404);
      if (cr.status !== 'pending') throw new AppError('NOT_PENDING', 'الطلب ليس معلّقًا', 409);
      if (!approve) {
        await c.query(`UPDATE change_requests SET status='rejected', decided_by=$2, decided_at=now(), decision_note=$3 WHERE id=$1`, [id, admin?.id ?? null, note ?? null]);
        await audit(c, { orgId, actorId: admin?.id, action: 'change.reject', entity: 'change_request', entityId: id });
        return { status: 'rejected' };
      }
      const old = (await c.query(`SELECT * FROM bookings WHERE id=$1 FOR UPDATE`, [cr.booking_id])).rows[0];
      if (!old || old.status !== 'active') {
        await c.query(`UPDATE change_requests SET status='failed', decided_at=now(), decision_note='الحجز الأصلي لم يعد نشطًا' WHERE id=$1`, [id]);
        return { status: 'failed' };
      }
      const ns = (
        await c.query<SlotRow>(
          `UPDATE slots SET booked_count = booked_count + 1 WHERE id=$1 AND NOT closed AND booked_count < quota RETURNING *`,
          [cr.new_slot_id],
        )
      ).rows[0];
      if (!ns) {
        // نبقي الطلب معلّقًا والموعد السابق ساريًا
        throw new AppError('SLOT_FULL', 'الفترة المطلوبة امتلأت؛ يمكن رفض الطلب أو رفع الحصة', 409);
      }
      await c.query(`UPDATE bookings SET status='superseded', cancelled_at=now() WHERE id=$1`, [old.id]);
      await c.query(`UPDATE slots SET booked_count = booked_count - 1 WHERE id=$1`, [old.slot_id]);
      await c.query(`UPDATE notifications SET cancelled=true WHERE booking_id=$1 AND sent_at IS NULL`, [old.id]);
      const nb = (
        await c.query(`INSERT INTO bookings(employee_id, slot_id, date) VALUES ($1,$2,$3) RETURNING *`, [old.employee_id, ns.id, old.date])
      ).rows[0];
      await c.query(`UPDATE change_requests SET status='approved', decided_by=$2, decided_at=now(), decision_note=$3 WHERE id=$1`, [id, admin?.id ?? null, note ?? null]);
      const empActor: Actor = { id: old.employee_id, orgId, role: 'employee', siteId: ns.site_id, tz: cr.timezone };
      await this.scheduleReminders(c, empActor, nb, ns, now);
      await audit(c, { orgId, actorId: admin?.id, action: 'change.approve', entity: 'change_request', entityId: id, data: { newBooking: nb.id } });
      return { status: 'approved', booking: this.view(nb, ns, empActor) };
    });
  }

  private async scheduleReminders(c: PoolClient | Queryable, actor: Actor, booking: any, slot: SlotRow, now: Date) {
    const start = zonedToUtc(slot.date, slot.start_time, actor.tz);
    const evening = zonedToUtc(addDays(slot.date, -1), '20:00', actor.tz);
    const departure = booking.planned_departure ? new Date(new Date(booking.planned_departure).getTime() - 15 * 60_000) : new Date(start.getTime() - 90 * 60_000);
    const rows: Array<[string, Date]> = [
      ['reminder_evening', evening],
      ['reminder_departure', departure],
    ];
    for (const [kind, at] of rows) {
      if (at <= now) continue;
      await c.query(
        `INSERT INTO notifications(employee_id, booking_id, kind, send_at, payload) VALUES ($1,$2,$3,$4,$5)`,
        [booking.employee_id, booking.id, kind, at, JSON.stringify({ date: slot.date, start: hhmm(slot.start_time), end: hhmm(slot.end_time) })],
      );
    }
  }

  view(b: any, s: SlotRow, actor: Actor) {
    return {
      id: b.id,
      date: b.date,
      status: b.status,
      slot: slotView(s),
      startsAt: zonedToUtc(s.date, s.start_time, actor.tz).toISOString(),
      plannedDeparture: b.planned_departure,
    };
  }

  async mine(actor: Actor, from: string, to: string) {
    const rows = await this.db.query(
      `SELECT b.id, b.date, b.status, b.planned_departure, s.*, b.id AS booking_id, s.id AS slot_id_,
              st.lat, st.lng, st.name AS site_name, e.travel_mode,
              dd.lat AS o_lat, dd.lng AS o_lng, dd.name AS district_name,
              cr.id AS cr_id, cr.status AS cr_status, ns.start_time AS cr_start, ns.end_time AS cr_end
         FROM bookings b
         JOIN slots s ON s.id=b.slot_id
         JOIN sites st ON st.id=s.site_id
         JOIN employees e ON e.id=b.employee_id
         LEFT JOIN districts dd ON dd.id=e.district_id
         LEFT JOIN change_requests cr ON cr.booking_id=b.id AND cr.status='pending'
         LEFT JOIN slots ns ON ns.id=cr.new_slot_id
        WHERE b.employee_id=$1 AND b.status='active' AND b.date BETWEEN $2 AND $3
        ORDER BY b.date`,
      [actor.id, from, to],
    );
    return rows.map((r) => ({
      ...this.view({ id: r.booking_id, date: r.date, status: r.status, planned_departure: r.planned_departure }, { ...r, id: r.slot_id_ }, actor),
      site: { name: r.site_name, lat: r.lat, lng: r.lng },
      // الملاحة تبدأ من مركز حي الانطلاق الذي اختاره الموظف (وليس موقعه الحالي)
      navigationUrl: googleMapsDirectionsUrl({ lat: r.lat, lng: r.lng }, r.travel_mode, r.o_lat == null ? undefined : { lat: r.o_lat, lng: r.o_lng }),
      district: r.district_name ?? null,
      pendingChange: r.cr_id ? { id: r.cr_id, start: hhmm(r.cr_start), end: hhmm(r.cr_end) } : null,
    }));
  }
}
