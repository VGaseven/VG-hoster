import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentActor } from '../auth/guard';
import { Actor } from '../common/actor';
import { AppError } from '../common/errors';
import { parse, zDate, zUuid } from '../common/validation';
import { addDays, localDate, zonedToUtc } from '../common/time';
import { DB, Db } from '../db/db';
import { SlotsService, slotView } from '../slots/slots.service';
import { BookingsService } from './bookings.service';
import { TripsService } from '../routes/trips.service';

const range = (q: any, tz: string) => {
  const from = q.from ? parse(zDate, q.from) : localDate(tz);
  const to = q.to ? parse(zDate, q.to) : addDays(from, 13);
  if (to < from || to > addDays(from, 62)) throw new AppError('VALIDATION', 'نطاق تاريخ غير صالح');
  return { from, to };
};

@Controller('me')
export class EmployeeController {
  constructor(
    @Inject(SlotsService) private readonly slots: SlotsService,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(TripsService) private readonly trips: TripsService,
    @Inject(DB) private readonly db: Db,
  ) {}

  @Get('slots')
  async listSlots(@CurrentActor() a: Actor, @Query() q: any) {
    if (!a.siteId) throw new AppError('NO_SITE', 'لم يُحدَّد مقر عملك', 409);
    const { from, to } = range(q, a.tz);
    const now = new Date();
    const policy = await this.slots.policy(a.siteId);
    const rows = await this.slots.list(a.siteId, from, addDays(localDate(a.tz), policy.booking_horizon_days) < to ? addDays(localDate(a.tz), policy.booking_horizon_days) : to);
    const leaves = await this.db.query(`SELECT start_date, end_date FROM leaves WHERE employee_id=$1 AND end_date >= $2 AND start_date <= $3`, [a.id, from, to]);
    return {
      policy: { slotMinutes: policy.slot_minutes, horizonDays: policy.booking_horizon_days, changeCutoffHours: policy.change_cutoff_hours, requireChangeApproval: policy.require_change_approval },
      leaves: leaves.map((l) => ({ from: l.start_date, to: l.end_date })),
      slots: rows.map((r) => {
        const v = slotView(r);
        const past = zonedToUtc(r.date, r.start_time, a.tz) <= now;
        return { ...v, past, full: v.full || past };
      }),
    };
  }

  @Get('slots/:id/plan')
  plan(@CurrentActor() a: Actor, @Param('id') id: string) {
    return this.trips.planForSlot(a, parse(zUuid, id));
  }

  @Get('bookings')
  mine(@CurrentActor() a: Actor, @Query() q: any) {
    const { from, to } = range(q, a.tz);
    return this.bookings.mine(a, from, to);
  }

  @Post('bookings')
  book(@CurrentActor() a: Actor, @Body() body: unknown) {
    const { items } = parse(
      z.object({ items: z.array(z.object({ date: zDate, slotId: zUuid, plannedDeparture: z.string().datetime().optional() })).min(1).max(14) }),
      body,
    );
    return this.bookings.book(a, items);
  }

  @Delete('bookings/:id')
  cancel(@CurrentActor() a: Actor, @Param('id') id: string) {
    return this.bookings.cancel(a, parse(zUuid, id));
  }

  @Post('bookings/:id/change')
  change(@CurrentActor() a: Actor, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ newSlotId: zUuid, reason: z.string().max(500).optional() }), body);
    return this.bookings.requestChange(a, parse(zUuid, id), b.newSlotId, b.reason);
  }

  @Delete('changes/:id')
  withdraw(@CurrentActor() a: Actor, @Param('id') id: string) {
    return this.bookings.withdrawChange(a, parse(zUuid, id));
  }

  @Get('districts')
  districts() {
    return this.db.query(`SELECT id, city, name FROM districts ORDER BY city, name`);
  }

  /** الموظف يحدد حي الانطلاق فقط (لا عنوان منزل دقيق) */
  @Put('district')
  async setDistrict(@CurrentActor() a: Actor, @Body() body: unknown) {
    const { districtId } = parse(z.object({ districtId: zUuid.nullable() }), body);
    await this.db.query(`UPDATE employees SET district_id=$2 WHERE id=$1`, [a.id, districtId]);
    return { ok: true };
  }

  @Put('travel-mode')
  async setMode(@CurrentActor() a: Actor, @Body() body: unknown) {
    const { travelMode } = parse(z.object({ travelMode: z.enum(['DRIVE', 'TRANSIT', 'TWO_WHEELER', 'WALK']) }), body);
    await this.db.query(`UPDATE employees SET travel_mode=$2 WHERE id=$1`, [a.id, travelMode]);
    return { ok: true };
  }
}
