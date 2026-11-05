/**
 * اختبارات تكامل على PostgreSQL حقيقية (قاعدة madar_test).
 * TEST_DATABASE_URL=postgres://madar:madar@localhost:5432/madar_test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../src/db/db';
import { seed } from '../src/db/seed';
import { SlotsService } from '../src/slots/slots.service';
import { BookingsService } from '../src/bookings/bookings.service';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { IntegrationsService } from '../src/integrations/integrations.service';
import { RemindersService } from '../src/reminders/reminders.service';
import { Actor } from '../src/common/actor';
import { AppError } from '../src/common/errors';
import { addDays, localDate, weekday } from '../src/common/time';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://madar:madar@localhost:5432/madar_test';
const db = new Db(url);
const slots = new SlotsService(db);
const bookings = new BookingsService(db, slots);
const TZ = 'Asia/Riyadh';
let orgId: string;
let siteId: string;
let admin: Actor;

const actorFor = async (email: string): Promise<Actor> => {
  const e = (await db.one(`SELECT id, role, site_id FROM employees WHERE email=$1`, [email]))!;
  return { id: e.id, orgId, role: e.role, siteId: e.site_id, tz: TZ };
};

/** يوم العمل رقم n بعد اليوم (كل رقم يعطي تاريخًا مختلفًا) */
const workday = (n: number) => {
  let d = localDate(TZ);
  for (let k = 0; k < n; ) {
    d = addDays(d, 1);
    if ([0, 1, 2, 3, 4].includes(weekday(d))) k++;
  }
  return d;
};

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'OK';
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
};

before(async () => {
  ({ orgId, siteId } = await seed(db));
  admin = await actorFor('admin@demo.madar.sa');
  await db.query(`UPDATE policies SET booking_horizon_days=30 WHERE site_id=$1`, [siteId]);
  // موظفون إضافيون لاختبار التزامن
  for (let i = 0; i < 14; i++) {
    await db.query(`INSERT INTO employees(org_id, external_id, name, email, site_id) VALUES ($1,$2,$3,$4,$5)`, [orgId, `T${i}`, `موظف ${i}`, `t${i}@test.sa`, siteId]);
  }
});
after(() => db.close());

test('concurrent bookings never exceed the slot quota', async () => {
  const date = workday(9);
  const [slot] = await slots.list(siteId, date, date);
  await slots.updateSlot(siteId, slot.id, { quota: 3 });
  const actors = await Promise.all(Array.from({ length: 12 }, (_, i) => actorFor(`t${i}@test.sa`)));
  const results = await Promise.all(actors.map((a) => code(bookings.book(a, [{ date, slotId: slot.id }]))));
  assert.equal(results.filter((r) => r === 'OK').length, 3);
  assert.equal(results.filter((r) => r === 'SLOT_FULL').length, 9);
  const s = await db.one(`SELECT booked_count FROM slots WHERE id=$1`, [slot.id]);
  const active = await db.one(`SELECT count(*)::int AS n FROM bookings WHERE slot_id=$1 AND status='active'`, [slot.id]);
  assert.equal(s.booked_count, 3);
  assert.equal(active.n, 3);
});

test('full slot returns nearest alternatives; weekly booking is all-or-nothing', async () => {
  const d1 = workday(9);
  const d2 = workday(10);
  const a = await actorFor('t11@test.sa');
  const [full] = await slots.list(siteId, d1, d1);
  const [free] = await slots.list(siteId, d2, d2);
  try {
    await bookings.book(a, [{ date: d2, slotId: free.id }, { date: d1, slotId: full.id }]);
    assert.fail('should be full');
  } catch (e: any) {
    assert.equal(e.code, 'SLOT_FULL');
    const alts = e.details.alternatives;
    assert.ok(alts.length > 0 && alts.length <= 3);
    assert.ok(alts.every((x: any) => x.remaining > 0 && x.id !== full.id));
  }
  const none = await db.one(`SELECT count(*)::int AS n FROM bookings WHERE employee_id=$1 AND status='active'`, [a.id]);
  assert.equal(none.n, 0, 'nothing booked when one day fails');
  const freeAfter = await db.one(`SELECT booked_count FROM slots WHERE id=$1`, [free.id]);
  assert.equal(freeAfter.booked_count, free.booked_count, 'counter rolled back');
});

test('one active booking per day; leave blocks booking', async () => {
  const date = workday(11);
  const a = await actorFor('t10@test.sa');
  const day = await slots.list(siteId, date, date);
  assert.equal(await code(bookings.book(a, [{ date, slotId: day[1].id }])), 'OK');
  assert.equal(await code(bookings.book(a, [{ date, slotId: day[2].id }])), 'ALREADY_BOOKED');
  const leaveDay = workday(12);
  await db.query(`INSERT INTO leaves(employee_id, start_date, end_date) VALUES ($1,$2,$2)`, [a.id, leaveDay]);
  const ld = await slots.list(siteId, leaveDay, leaveDay);
  assert.equal(await code(bookings.book(a, [{ date: leaveDay, slotId: ld[0].id }])), 'ON_LEAVE');
  assert.equal(await code(bookings.book(a, [{ date: addDays(localDate(TZ), 40), slotId: ld[0].id }])), 'BEYOND_HORIZON');
});

test('pending change keeps the previous booking until approval', async () => {
  const date = workday(11);
  const a = await actorFor('t10@test.sa');
  const day = await slots.list(siteId, date, date);
  const [mine] = await bookings.mine(a, date, date);
  const target = day[3];
  const r: any = await bookings.requestChange(a, mine.id, target.id, 'موعد المدرسة');
  assert.equal(r.status, 'pending');
  let [still] = await bookings.mine(a, date, date);
  assert.equal(still.slot.id, day[1].id, 'old slot still active');
  assert.equal(still.pendingChange?.start, target.start_time.slice(0, 5));
  assert.equal(await code(bookings.requestChange(a, mine.id, day[4].id, undefined)), 'PENDING_EXISTS');

  const d: any = await bookings.decideChange(admin, orgId, r.changeRequestId, true);
  assert.equal(d.status, 'approved');
  [still] = await bookings.mine(a, date, date);
  assert.equal(still.slot.id, target.id);
  const counts = await db.query(`SELECT id, booked_count FROM slots WHERE id = ANY($1)`, [[day[1].id, target.id]]);
  const m = Object.fromEntries(counts.map((c) => [c.id, c.booked_count]));
  assert.equal(m[day[1].id], day[1].booked_count - 1);
  assert.equal(m[target.id], target.booked_count + 1);
});

test('approval fails safely when the target slot filled up meanwhile', async () => {
  const date = workday(12);
  const a = await actorFor('t9@test.sa');
  const day = await slots.list(siteId, date, date);
  await bookings.book(a, [{ date, slotId: day[0].id }]);
  const r: any = await bookings.requestChange(a, (await bookings.mine(a, date, date))[0].id, day[2].id, undefined);
  await slots.updateSlot(siteId, day[2].id, { quota: day[2].booked_count });
  assert.equal(await code(bookings.decideChange(admin, orgId, r.changeRequestId, true)), 'SLOT_FULL');
  const [b] = await bookings.mine(a, date, date);
  assert.equal(b.slot.id, day[0].id, 'previous booking kept');
  assert.ok(b.pendingChange, 'request still pending');
  assert.deepEqual(await bookings.decideChange(admin, orgId, r.changeRequestId, false, 'لا توجد سعة'), { status: 'rejected' });
});

test('change cutoff is enforced and cancel releases the slot', async () => {
  const a = await actorFor('t13@test.sa');
  const date = workday(9);
  const day = await slots.list(siteId, date, date);
  const [b] = await bookings.book(a, [{ date, slotId: day[1].id }]);
  const nearlyThere = new Date(new Date(b.startsAt).getTime() - 3600_000);
  assert.equal(await code(bookings.requestChange(a, b.id, day[2].id, undefined, nearlyThere)), 'CHANGE_CUTOFF');
  const before = (await db.one(`SELECT booked_count FROM slots WHERE id=$1`, [day[1].id])).booked_count;
  await bookings.cancel(a, b.id);
  assert.equal((await db.one(`SELECT booked_count FROM slots WHERE id=$1`, [day[1].id])).booked_count, before - 1);
  const n = await db.one(`SELECT count(*)::int AS n FROM notifications WHERE booking_id=$1 AND NOT cancelled`, [b.id]);
  assert.equal(n.n, 0, 'reminders cancelled');
});

test('HR + attendance import feed the compliance dashboard', async () => {
  const integ = new IntegrationsService(db);
  const hr = await integ.importCsv(admin, 'hr', [
    'external_id,name,email,site_code,district,eligible,work_hours',
    'N1,موظف جديد,new1@test.sa,HQ,الرياض/الملقا,true,8',
    'N2,بلا مقر,new2@test.sa,XX,,true,8',
    'N3,بريد خاطئ,not-an-email,HQ,,true,8',
  ].join('\n'));
  assert.equal(hr.ok, 1);
  assert.equal(hr.failed, 2);

  // حجز في الماضي مع حضور معتمد (نُدخله مباشرة لأن الحجز في الماضي ممنوع عبر الخدمة)
  const past = addDays(localDate(TZ), -1);
  await slots.ensureSlots(siteId, past, past);
  const slot = (await db.one(`SELECT * FROM slots WHERE site_id=$1 AND date=$2 ORDER BY start_time LIMIT 1`, [siteId, past]))
    ?? (await db.one(`INSERT INTO slots(site_id,date,start_time,end_time,quota) VALUES ($1,$2,'07:00','07:30',5) RETURNING *`, [siteId, past]));
  const emps = await db.query(`SELECT id, external_id FROM employees WHERE external_id IN ('E001','E002','E003')`);
  for (const e of emps) await db.query(`INSERT INTO bookings(employee_id, slot_id, date) VALUES ($1,$2,$3)`, [e.id, slot.id, past]);
  const end = slot.end_time.slice(0, 5);
  const late = `${String(Number(end.slice(0, 2)) + 1).padStart(2, '0')}:${end.slice(3)}`;
  const att = await integ.importCsv(admin, 'attendance', `external_id,date,check_in\nE001,${past},${slot.start_time.slice(0, 5)}\nE002,${past},${late}\nZZZ,${past},07:00`);
  assert.equal(att.ok, 2);

  const c = await new DashboardService(db).compliance(siteId, past, past, TZ);
  assert.equal(c.total, 3);
  assert.equal(c.onTime, 1);
  assert.equal(c.late, 1);
  assert.equal(c.noRecord, 1);
  assert.equal(c.onTimeRate, 0.5);
});

test('reminders are dispatched once', async () => {
  const sent: any[] = [];
  const r = new RemindersService(db, { async send(n) { sent.push(n); } });
  await db.query(`UPDATE notifications SET send_at = now() - interval '1 minute' WHERE id = (SELECT id FROM notifications WHERE NOT cancelled AND sent_at IS NULL LIMIT 1)`);
  assert.equal(await r.dispatchDue(), 1);
  assert.equal(await r.dispatchDue(), 0);
  assert.match(sent[0].text, /موعد/);
});
