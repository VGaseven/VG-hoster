/**
 * بيانات تجريبية للعرض والتطوير فقط. الإحداثيات تقريبية لمراكز الأحياء.
 * تشغيل: npm run db:seed  (يمسح البيانات الحالية ويعيد إنشاءها)
 */
import { Db } from './db';
import { migrate } from './migrate';
import { addDays, localDate, weekday } from '../common/time';
import { SlotsService } from '../slots/slots.service';

const DISTRICTS: Array<[string, number, number]> = [
  ['الملقا', 24.812, 46.605],
  ['النرجس', 24.853, 46.656],
  ['الياسمين', 24.827, 46.64],
  ['العليا', 24.693, 46.685],
  ['الروضة', 24.735, 46.77],
  ['السويدي', 24.594, 46.675],
  ['قرطبة', 24.81, 46.735],
  ['الصحافة', 24.803, 46.633],
];

const EMPLOYEES: Array<[string, string, string, string]> = [
  ['E001', 'سارة العتيبي', 'sara@demo.madar.sa', 'الملقا'],
  ['E002', 'محمد القحطاني', 'mohammed@demo.madar.sa', 'الروضة'],
  ['E003', 'نورة الشهري', 'noura@demo.madar.sa', 'النرجس'],
  ['E004', 'عبدالله الدوسري', 'abdullah@demo.madar.sa', 'السويدي'],
  ['E005', 'ريم الحربي', 'reem@demo.madar.sa', 'الياسمين'],
  ['E006', 'فهد الغامدي', 'fahad@demo.madar.sa', 'قرطبة'],
  ['E007', 'هيا المطيري', 'haya@demo.madar.sa', 'العليا'],
  ['E008', 'خالد الزهراني', 'khalid@demo.madar.sa', 'الصحافة'],
];

export async function seed(db: Db) {
  await migrate(db, () => {});
  await db.query(`TRUNCATE organizations, districts, audit_log, trip_estimate_cache CASCADE`);
  const org = (await db.one(`INSERT INTO organizations(name, slug) VALUES ('جهة تجريبية','demo') RETURNING id`))!;
  const site = (await db.one(
    `INSERT INTO sites(org_id, code, name, lat, lng, entry_buffer_min) VALUES ($1,'HQ','المقر الرئيسي — حي الملك عبدالله المالي',24.7646,46.6402,10) RETURNING id`,
    [org.id],
  ))!;
  const districtIds = new Map<string, string>();
  for (const [name, lat, lng] of DISTRICTS) {
    const d = await db.one(`INSERT INTO districts(city, name, lat, lng) VALUES ('الرياض',$1,$2,$3) RETURNING id`, [name, lat, lng]);
    districtIds.set(name, d!.id);
  }
  await db.query(
    `INSERT INTO employees(org_id, external_id, name, email, role, site_id, district_id) VALUES ($1,'A001','مسؤول الجهة','admin@demo.madar.sa','admin',$2,$3)`,
    [org.id, site.id, districtIds.get('العليا')],
  );
  const empIds: string[] = [];
  for (const [ext, name, email, district] of EMPLOYEES) {
    const e = await db.one(
      `INSERT INTO employees(org_id, external_id, name, email, site_id, district_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [org.id, ext, name, email, site.id, districtIds.get(district)],
    );
    empIds.push(e!.id);
  }
  await db.query(
    `INSERT INTO policies(site_id, earliest_arrival, latest_arrival, slot_minutes, default_quota, default_min_staff, booking_horizon_days, change_cutoff_hours)
     VALUES ($1,'06:30','09:00',30,4,1,14,12)`,
    [site.id],
  );
  // بعض الحجوزات لتظهر لوحة التوزيع
  const slots = new SlotsService(db);
  const today = localDate('Asia/Riyadh');
  const end = addDays(today, 14);
  await slots.ensureSlots(site.id, addDays(today, 1), end);
  let d = addDays(today, 1);
  let booked = 0;
  while (booked < 3 && d <= end) {
    if ([0, 1, 2, 3, 4].includes(weekday(d))) {
      const daySlots = await db.query(`SELECT id FROM slots WHERE site_id=$1 AND date=$2 ORDER BY start_time`, [site.id, d]);
      for (const [i, empId] of empIds.slice(1).entries()) {
        const slot = daySlots[(i * 2 + booked) % daySlots.length];
        await db.query(`INSERT INTO bookings(employee_id, slot_id, date) VALUES ($1,$2,$3)`, [empId, slot.id, d]);
        await db.query(`UPDATE slots SET booked_count=booked_count+1 WHERE id=$1`, [slot.id]);
      }
      booked++;
    }
    d = addDays(d, 1);
  }
  return { orgId: org.id, siteId: site.id };
}

if (require.main === module) {
  const db = new Db(process.env.DATABASE_URL ?? 'postgres://madar:madar@localhost:5432/madar');
  seed(db)
    .then((r) => {
      console.log('seeded', r, '\nدخول تجريبي: admin@demo.madar.sa أو sara@demo.madar.sa');
      return db.close();
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
