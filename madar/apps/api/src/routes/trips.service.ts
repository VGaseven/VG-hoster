import { Db } from '../db/db';
import { Actor } from '../common/actor';
import { AppError } from '../common/errors';
import { zonedToUtc } from '../common/time';
import { TripEstimator } from './estimator';
import { googleMapsDirectionsUrl, planArrival } from './planner';

/** تقديرات الرحلة لفترة معينة من حي الموظف إلى مقره */
export class TripsService {
  constructor(private readonly db: Db, private readonly estimator: TripEstimator) {}

  private async context(actor: Actor) {
    const r = await this.db.one(
      `SELECT e.travel_mode, d.lat AS o_lat, d.lng AS o_lng, d.name AS district,
              s.lat AS d_lat, s.lng AS d_lng, s.entry_buffer_min, s.name AS site
         FROM employees e
         JOIN sites s ON s.id=e.site_id
         LEFT JOIN districts d ON d.id=e.district_id
        WHERE e.id=$1`,
      [actor.id],
    );
    if (!r) throw new AppError('NO_SITE', 'لم يُحدَّد مقر عملك', 409);
    return r;
  }

  async planForSlot(actor: Actor, slotId: string, now = new Date()) {
    const ctx = await this.context(actor);
    const slot = await this.db.one(`SELECT * FROM slots WHERE id=$1 AND site_id=$2`, [slotId, actor.siteId]);
    if (!slot) throw new AppError('NOT_FOUND', 'الفترة غير موجودة', 404);
    const slotStart = zonedToUtc(slot.date, slot.start_time, actor.tz);
    if (slotStart <= now) throw new AppError('PAST_SLOT', 'هذه الفترة بدأت بالفعل', 409);
    const dest = { lat: ctx.d_lat, lng: ctx.d_lng };
    const origin = ctx.o_lat == null ? undefined : { lat: ctx.o_lat, lng: ctx.o_lng };
    const navigationUrl = googleMapsDirectionsUrl(dest, ctx.travel_mode, origin);
    if (ctx.o_lat == null) {
      return { plan: null, navigationUrl, message: 'أضف حي الانطلاق لعرض تقديرات الرحلة' };
    }
    const plan = await planArrival(this.estimator, {
      origin: origin!,
      dest,
      mode: ctx.travel_mode,
      slotStart,
      slotEnd: zonedToUtc(slot.date, slot.end_time, actor.tz),
      entryBufferMin: ctx.entry_buffer_min,
      now,
    });
    return { plan, navigationUrl, district: ctx.district, site: ctx.site };
  }
}
