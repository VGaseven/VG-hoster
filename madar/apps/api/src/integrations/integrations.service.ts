import { z } from 'zod';
import { Db } from '../db/db';
import { Actor } from '../common/actor';
import { AppError } from '../common/errors';
import { audit } from '../common/audit';
import { zonedToUtc } from '../common/time';
import { parseCsv } from './csv';

/**
 * ربط الموارد البشرية والحضور.
 * البداية: ملف بيانات معتمد (CSV) من الجهة. لاحقًا: API رسمي عند إتاحته (HttpHrSource).
 * كل استيراد يُسجَّل في import_batches مع أخطاء كل سطر.
 */

const bool = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v === '' ? true : ['1', 'true', 'yes', 'نعم'].includes(v.toLowerCase())));

export const HrRow = z.object({
  external_id: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  site_code: z.string().min(1),
  district: z.string().optional().default(''), // "المدينة/الحي" أو اسم الحي
  eligible: bool,
  work_hours: z.string().optional().transform((v) => (v ? Number(v) : 8)).pipe(z.number().min(1).max(16)),
  travel_mode: z.enum(['DRIVE', 'TRANSIT', 'TWO_WHEELER', 'WALK']).optional().default('DRIVE'),
  role: z.enum(['employee', 'admin']).optional().default('employee'),
});

export const LeaveRow = z.object({
  external_id: z.string().min(1),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const AttendanceRow = z.object({
  external_id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  check_in: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/), // الوقت المحلي للجهة
});

export interface HrSource {
  fetchEmployees(): Promise<Record<string, string>[]>;
}

/** مصدر API رسمي للموارد البشرية (يُضبط عبر HR_API_URL و HR_API_TOKEN) ويعيد مصفوفة JSON بنفس الحقول */
export class HttpHrSource implements HrSource {
  constructor(private readonly url: string, private readonly token?: string, private readonly fetchImpl: typeof fetch = fetch) {}
  async fetchEmployees() {
    const res = await this.fetchImpl(this.url, { headers: this.token ? { Authorization: `Bearer ${this.token}` } : {} });
    if (!res.ok) throw new AppError('HR_API_ERROR', `تعذّر الاتصال بنظام الموارد البشرية (${res.status})`, 502);
    const data = await res.json();
    if (!Array.isArray(data)) throw new AppError('HR_API_ERROR', 'استجابة غير متوقعة من نظام الموارد البشرية', 502);
    return data.map((r: any) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v == null ? '' : String(v)])));
  }
}

type RowError = { row: number; error: string };

export class IntegrationsService {
  constructor(private readonly db: Db) {}

  private async batch(actor: Actor, kind: string, source: string, total: number, ok: number, errors: RowError[]) {
    const b = await this.db.one(
      `INSERT INTO import_batches(org_id, kind, source, row_count, ok_count, errors, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [actor.orgId, kind, source, total, ok, JSON.stringify(errors.slice(0, 500)), actor.id],
    );
    await audit(this.db.pool, { orgId: actor.orgId, actorId: actor.id, action: `import.${kind}`, entity: 'import_batch', entityId: b!.id, data: { total, ok } });
    return { batchId: b!.id, total, ok, failed: errors.length, errors: errors.slice(0, 50) };
  }

  async importHr(actor: Actor, rows: Record<string, string>[], source = 'file') {
    const sites = new Map((await this.db.query(`SELECT id, code FROM sites WHERE org_id=$1`, [actor.orgId])).map((s) => [s.code, s.id]));
    const districts = await this.db.query(`SELECT id, city, name FROM districts`);
    const findDistrict = (v: string) => {
      if (!v) return null;
      const [a, b] = v.split('/').map((x) => x.trim());
      return districts.find((d) => (b ? d.city === a && d.name === b : d.name === a))?.id;
    };
    const errors: RowError[] = [];
    let ok = 0;
    for (const [i, raw] of rows.entries()) {
      const p = HrRow.safeParse(raw);
      if (!p.success) { errors.push({ row: i + 2, error: p.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') }); continue; }
      const r = p.data;
      const siteId = sites.get(r.site_code);
      if (!siteId) { errors.push({ row: i + 2, error: `رمز مقر غير معروف: ${r.site_code}` }); continue; }
      const districtId = findDistrict(r.district);
      if (districtId === undefined) { errors.push({ row: i + 2, error: `حي غير معروف: ${r.district}` }); continue; }
      try {
        await this.db.query(
          `INSERT INTO employees(org_id, external_id, name, email, site_id, district_id, eligible, work_hours, travel_mode, role)
           VALUES ($1,$2,$3,lower($4),$5,$6,$7,$8,$9,$10)
           ON CONFLICT (org_id, external_id) DO UPDATE SET
             name=EXCLUDED.name, email=EXCLUDED.email, site_id=EXCLUDED.site_id,
             district_id=COALESCE(EXCLUDED.district_id, employees.district_id),
             eligible=EXCLUDED.eligible, work_hours=EXCLUDED.work_hours, travel_mode=EXCLUDED.travel_mode,
             role=EXCLUDED.role, active=true`,
          [actor.orgId, r.external_id, r.name, r.email, siteId, districtId, r.eligible, r.work_hours, r.travel_mode, r.role],
        );
        ok++;
      } catch (e: any) {
        errors.push({ row: i + 2, error: e.code === '23505' ? 'البريد مستخدم لموظف آخر' : e.message });
      }
    }
    return this.batch(actor, 'hr', source, rows.length, ok, errors);
  }

  async importLeaves(actor: Actor, rows: Record<string, string>[]) {
    const errors: RowError[] = [];
    let ok = 0;
    for (const [i, raw] of rows.entries()) {
      const p = LeaveRow.safeParse(raw);
      if (!p.success || p.data.end_date < p.data.start_date) { errors.push({ row: i + 2, error: 'سطر إجازة غير صالح' }); continue; }
      const emp = await this.db.one(`SELECT id FROM employees WHERE org_id=$1 AND external_id=$2`, [actor.orgId, p.data.external_id]);
      if (!emp) { errors.push({ row: i + 2, error: `موظف غير معروف: ${p.data.external_id}` }); continue; }
      await this.db.query(
        `INSERT INTO leaves(employee_id, start_date, end_date)
         SELECT $1,$2,$3 WHERE NOT EXISTS (SELECT 1 FROM leaves WHERE employee_id=$1 AND start_date=$2 AND end_date=$3)`,
        [emp.id, p.data.start_date, p.data.end_date],
      );
      ok++;
    }
    return this.batch(actor, 'leaves', 'file', rows.length, ok, errors);
  }

  async importAttendance(actor: Actor, rows: Record<string, string>[], source: 'file' | 'api' = 'file') {
    const errors: RowError[] = [];
    let ok = 0;
    for (const [i, raw] of rows.entries()) {
      const p = AttendanceRow.safeParse(raw);
      if (!p.success) { errors.push({ row: i + 2, error: 'سطر حضور غير صالح' }); continue; }
      const emp = await this.db.one(`SELECT id FROM employees WHERE org_id=$1 AND external_id=$2`, [actor.orgId, p.data.external_id]);
      if (!emp) { errors.push({ row: i + 2, error: `موظف غير معروف: ${p.data.external_id}` }); continue; }
      const at = zonedToUtc(p.data.date, p.data.check_in, actor.tz);
      await this.db.query(
        `INSERT INTO attendance(employee_id, date, check_in_at, source) VALUES ($1,$2,$3,$4)
         ON CONFLICT (employee_id, date) DO UPDATE SET check_in_at=LEAST(attendance.check_in_at, EXCLUDED.check_in_at), source=EXCLUDED.source`,
        [emp.id, p.data.date, at, source],
      );
      ok++;
    }
    return this.batch(actor, 'attendance', source, rows.length, ok, errors);
  }

  importCsv(actor: Actor, kind: 'hr' | 'leaves' | 'attendance', csv: string) {
    const rows = parseCsv(csv);
    if (rows.length > 20000) throw new AppError('TOO_LARGE', 'الملف كبير جدًا (الحد ٢٠٬٠٠٠ سطر)');
    if (kind === 'hr') return this.importHr(actor, rows);
    if (kind === 'leaves') return this.importLeaves(actor, rows);
    return this.importAttendance(actor, rows);
  }

  async syncHr(actor: Actor, src: HrSource) {
    return this.importHr(actor, await src.fetchEmployees(), 'api');
  }

  batches(orgId: string) {
    return this.db.query(
      `SELECT id, kind, source, row_count, ok_count, jsonb_array_length(errors) AS error_count, created_at
         FROM import_batches WHERE org_id=$1 ORDER BY created_at DESC LIMIT 30`,
      [orgId],
    );
  }
}
