export interface LatLng { lat: number; lng: number }
export type TravelMode = 'DRIVE' | 'TRANSIT' | 'TWO_WHEELER' | 'WALK';

export interface TripEstimate {
  durationS: number;
  distanceM?: number;
  /** google = Routes API، fallback = تقدير تقريبي داخلي عند غياب المفتاح أو تعطل الخدمة */
  source: 'google' | 'fallback';
}

export interface TripEstimator {
  estimate(origin: LatLng, dest: LatLng, departure: Date, mode: TravelMode): Promise<TripEstimate>;
}

export function haversineM(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * تقدير احتياطي تقريبي (افتراض وليس قياسًا): مسافة الخط المستقيم × معامل الطرق ÷ سرعة حسب ساعة الذروة.
 * يُستخدم فقط عند غياب مفتاح Google أو تعطل الخدمة، ويُعرض للموظف بوصفه تقديرًا تقريبيًا.
 */
export class FallbackEstimator implements TripEstimator {
  constructor(private readonly tz = 'Asia/Riyadh') {}

  async estimate(origin: LatLng, dest: LatLng, departure: Date, mode: TravelMode): Promise<TripEstimate> {
    const road = haversineM(origin, dest) * 1.35;
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: this.tz, hour: '2-digit', hourCycle: 'h23' }).format(departure));
    const peak = hour >= 6 && hour < 9;
    const kmh = { DRIVE: peak ? 30 : 48, TWO_WHEELER: peak ? 28 : 40, TRANSIT: 22, WALK: 4.8 }[mode];
    const durationS = Math.round((road / 1000 / kmh) * 3600) + (mode === 'DRIVE' ? 120 : 0);
    return { durationS, distanceM: Math.round(road), source: 'fallback' };
  }
}
