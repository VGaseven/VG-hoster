import { Body, Controller, Get, Inject, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentActor, Roles } from '../auth/guard';
import { Actor } from '../common/actor';
import { AppError } from '../common/errors';
import { audit } from '../common/audit';
import { parse, zDate, zTime, zUuid } from '../common/validation';
import { addDays, localDate } from '../common/time';
import { DB, Db } from '../db/db';
import { SlotsService, slotView } from '../slots/slots.service';
import { BookingsService } from '../bookings/bookings.service';
import { DashboardService } from './dashboard.service';
import { PeopleService } from './people.service';
import { HttpHrSource, IntegrationsService } from '../integrations/integrations.service';
import { AppConfig, CONFIG } from '../config';

const PolicyBody = z.object({
  earliestArrival: zTime,
  latestArrival: zTime,
  slotMinutes: z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(45), z.literal(60)]),
  defaultQuota: z.number().int().min(0).max(10000),
  defaultMinStaff: z.number().int().min(0).max(10000),
  workdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  bookingHorizonDays: z.number().int().min(1).max(90),
  changeCutoffHours: z.number().int().min(0).max(168),
  requireChangeApproval: z.boolean(),
  lateGraceMin: z.number().int().min(0).max(120),
});

@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SlotsService) private readonly slots: SlotsService,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(DashboardService) private readonly dash: DashboardService,
    @Inject(IntegrationsService) private readonly integrations: IntegrationsService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(PeopleService) private readonly people: PeopleService,
  ) {}

  /** يتحقق أن المقر يتبع جهة المسؤول (عزل الجهات) */
  private async site(a: Actor, siteId: string) {
    const s = await this.db.one(`SELECT * FROM sites WHERE id=$1 AND org_id=$2`, [parse(zUuid, siteId), a.orgId]);
    if (!s) throw new AppError('NOT_FOUND', 'المقر غير موجود', 404);
    return s;
  }

  private range(q: any, tz: string, back = 0) {
    const from = q.from ? parse(zDate, q.from) : addDays(localDate(tz), -back);
    const to = q.to ? parse(zDate, q.to) : addDays(from, 13);
    if (to < from || to > addDays(from, 92)) throw new AppError('VALIDATION', 'نطاق تاريخ غير صالح');
    return { from, to };
  }

  @Get('sites')
  sites(@CurrentActor() a: Actor) {
    return this.db.query(
      `SELECT s.id, s.code, s.name, s.lat, s.lng, s.entry_buffer_min AS "entryBufferMin",
              (SELECT count(*)::int FROM employees e WHERE e.site_id=s.id AND e.active AND e.eligible) AS "eligibleEmployees"
         FROM sites s WHERE s.org_id=$1 ORDER BY s.name`,
      [a.orgId],
    );
  }

  @Get('sites/:siteId/policy')
  async getPolicy(@CurrentActor() a: Actor, @Param('siteId') siteId: string) {
    await this.site(a, siteId);
    const p = await this.slots.policy(siteId);
    return {
      earliestArrival: p.earliest_arrival.slice(0, 5),
      latestArrival: p.latest_arrival.slice(0, 5),
      slotMinutes: p.slot_minutes,
      defaultQuota: p.default_quota,
      defaultMinStaff: p.default_min_staff,
      workdays: p.workdays,
      bookingHorizonDays: p.booking_horizon_days,
      changeCutoffHours: p.change_cutoff_hours,
      requireChangeApproval: p.require_change_approval,
      lateGraceMin: p.late_grace_min,
    };
  }

  @Put('sites/:siteId/policy')
  async putPolicy(@CurrentActor() a: Actor, @Param('siteId') siteId: string, @Body() body: unknown) {
    await this.site(a, siteId);
    const p = parse(PolicyBody, body);
    if (p.latestArrival <= p.earliestArrival) throw new AppError('VALIDATION', 'آخر وقت وصول يجب أن يكون بعد أول وقت');
    await this.db.query(
      `INSERT INTO policies(site_id, earliest_arrival, latest_arrival, slot_minutes, default_quota, default_min_staff, workdays,
                            booking_horizon_days, change_cutoff_hours, require_change_approval, late_grace_min, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
       ON CONFLICT (site_id) DO UPDATE SET earliest_arrival=$2, latest_arrival=$3, slot_minutes=$4, default_quota=$5,
         default_min_staff=$6, workdays=$7, booking_horizon_days=$8, change_cutoff_hours=$9, require_change_approval=$10,
         late_grace_min=$11, updated_at=now()`,
      [siteId, p.earliestArrival, p.latestArrival, p.slotMinutes, p.defaultQuota, p.defaultMinStaff, p.workdays,
       p.bookingHorizonDays, p.changeCutoffHours, p.requireChangeApproval, p.lateGraceMin],
    );
    // نعيد توليد الفترات المستقبلية غير المحجوزة لتعكس السياسة الجديدة
    const today = localDate(a.tz);
    const regen = await this.slots.regenerate(siteId, addDays(today, 1), addDays(today, p.bookingHorizonDays));
    await audit(this.db.pool, { orgId: a.orgId, actorId: a.id, action: 'policy.update', entity: 'site', entityId: siteId, data: p });
    return { ok: true, ...regen };
  }

  @Get('sites/:siteId/slots')
  async listSlots(@CurrentActor() a: Actor, @Param('siteId') siteId: string, @Query() q: any) {
    await this.site(a, siteId);
    const { from, to } = this.range(q, a.tz);
    return (await this.slots.list(siteId, from, to)).map(slotView);
  }

  @Patch('sites/:siteId/slots/:slotId')
  async patchSlot(@CurrentActor() a: Actor, @Param('siteId') siteId: string, @Param('slotId') slotId: string, @Body() body: unknown) {
    await this.site(a, siteId);
    const p = parse(z.object({ quota: z.number().int().min(0).optional(), minStaff: z.number().int().min(0).optional(), closed: z.boolean().optional() }), body);
    const s = await this.slots.updateSlot(siteId, parse(zUuid, slotId), p);
    await audit(this.db.pool, { orgId: a.orgId, actorId: a.id, action: 'slot.update', entity: 'slot', entityId: slotId, data: p });
    return slotView(s);
  }

  @Get('sites/:siteId/dashboard')
  async dashboard(@CurrentActor() a: Actor, @Param('siteId') siteId: string, @Query() q: any) {
    await this.site(a, siteId);
    const { from, to } = this.range(q, a.tz, 7);
    const [distribution, compliance, alerts] = await Promise.all([
      this.dash.distribution(siteId, from, to),
      this.dash.compliance(siteId, from, to, a.tz),
      this.dash.alerts(siteId, a.tz),
    ]);
    return { from, to, distribution, compliance, alerts };
  }

  /** جدول مواعيد الموظفين ليوم معين */
  @Get('sites/:siteId/roster')
  async roster(@CurrentActor() a: Actor, @Param('siteId') siteId: string, @Query('date') date?: string) {
    await this.site(a, siteId);
    return this.people.roster(siteId, date ? parse(zDate, date) : localDate(a.tz), a.tz);
  }

  /** ملخص كل موظف: موعده المعتاد والتزامه */
  @Get('sites/:siteId/employees')
  async employees(@CurrentActor() a: Actor, @Param('siteId') siteId: string) {
    await this.site(a, siteId);
    return this.people.summary(siteId, a.tz);
  }

  @Get('changes')
  changes(@CurrentActor() a: Actor) {
    return this.dash.pendingChanges(a.orgId);
  }

  @Post('changes/:id/decision')
  decide(@CurrentActor() a: Actor, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ approve: z.boolean(), note: z.string().max(500).optional() }), body);
    return this.bookings.decideChange(a, a.orgId, parse(zUuid, id), b.approve, b.note);
  }

  @Post('imports/:kind')
  importCsv(@CurrentActor() a: Actor, @Param('kind') kind: string, @Body() body: unknown) {
    const k = parse(z.enum(['hr', 'leaves', 'attendance']), kind);
    const { csv } = parse(z.object({ csv: z.string().min(1).max(5_000_000) }), body);
    return this.integrations.importCsv(a, k, csv);
  }

  @Post('integrations/hr/sync')
  syncHr(@CurrentActor() a: Actor) {
    if (!this.cfg.hrApi) throw new AppError('HR_API_NOT_CONFIGURED', 'لم يُضبط ربط API للموارد البشرية؛ استخدم استيراد الملف', 501);
    return this.integrations.syncHr(a, new HttpHrSource(this.cfg.hrApi.url, this.cfg.hrApi.token));
  }

  @Get('imports')
  imports(@CurrentActor() a: Actor) {
    return this.integrations.batches(a.orgId);
  }
}
