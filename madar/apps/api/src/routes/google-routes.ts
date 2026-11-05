import { Db } from '../db/db';
import { FallbackEstimator, LatLng, TravelMode, TripEstimate, TripEstimator } from './estimator';

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

/** "1234s" -> 1234 */
export function parseDuration(d: string | undefined): number | undefined {
  if (!d) return undefined;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(d);
  return m ? Math.round(Number(m[1])) : undefined;
}

export function buildRoutesRequest(origin: LatLng, dest: LatLng, departure: Date, mode: TravelMode, now = new Date()) {
  const body: Record<string, unknown> = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: { location: { latLng: { latitude: dest.lat, longitude: dest.lng } } },
    travelMode: mode,
    languageCode: 'ar',
    units: 'METRIC',
  };
  if (mode === 'DRIVE' || mode === 'TWO_WHEELER') body.routingPreference = 'TRAFFIC_AWARE';
  // Routes API لا يقبل وقت انطلاق في الماضي؛ إن كان الوقت قد مضى نطلب التقدير الحالي
  if (departure.getTime() > now.getTime() + 60_000) body.departureTime = departure.toISOString();
  return body;
}

/**
 * عميل Google Routes API مع ذاكرة مؤقتة قصيرة (TTL) لتقليل التكلفة.
 * لا نؤرشف النتائج ولا نستخدمها للتدريب؛ تُحذف بعد انتهاء صلاحيتها (انظر ReminderService.purge).
 * عند التعطل أو انتهاء المهلة نعود إلى التقدير الاحتياطي ونوسمه بذلك.
 */
export class GoogleRoutesEstimator implements TripEstimator {
  constructor(
    private readonly apiKey: string,
    private readonly db: Db | null,
    private readonly ttlMin = 60,
    private readonly fallback: TripEstimator = new FallbackEstimator(),
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 5000,
  ) {}

  private key(o: LatLng, d: LatLng, dep: Date, mode: TravelMode) {
    const r = (n: number) => n.toFixed(4);
    const slot = Math.floor(dep.getTime() / 300_000); // تقريب إلى ٥ دقائق
    return `${mode}:${r(o.lat)},${r(o.lng)}>${r(d.lat)},${r(d.lng)}@${slot}`;
  }

  async estimate(origin: LatLng, dest: LatLng, departure: Date, mode: TravelMode): Promise<TripEstimate> {
    const key = this.key(origin, dest, departure, mode);
    if (this.db) {
      const hit = await this.db.one(`SELECT duration_s, distance_m, source FROM trip_estimate_cache WHERE cache_key=$1 AND expires_at > now()`, [key]);
      if (hit) return { durationS: hit.duration_s, distanceM: hit.distance_m ?? undefined, source: hit.source };
    }
    let result: TripEstimate;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      const res = await this.fetchImpl(ROUTES_URL, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': 'routes.duration,routes.staticDuration,routes.distanceMeters',
        },
        body: JSON.stringify(buildRoutesRequest(origin, dest, departure, mode)),
      }).finally(() => clearTimeout(timer));
      if (!res.ok) throw new Error(`Routes API ${res.status}`);
      const json: any = await res.json();
      const route = json.routes?.[0];
      const durationS = parseDuration(route?.duration) ?? parseDuration(route?.staticDuration);
      if (durationS === undefined) throw new Error('Routes API: no route');
      result = { durationS, distanceM: route.distanceMeters, source: 'google' };
    } catch (e) {
      console.warn(`[routes] falling back: ${(e as Error).message}`);
      return this.fallback.estimate(origin, dest, departure, mode); // لا نخزّن الاحتياطي
    }
    if (this.db) {
      await this.db.query(
        `INSERT INTO trip_estimate_cache(cache_key, duration_s, distance_m, source, expires_at)
         VALUES ($1,$2,$3,$4, now() + ($5 || ' minutes')::interval)
         ON CONFLICT (cache_key) DO UPDATE SET duration_s=EXCLUDED.duration_s, distance_m=EXCLUDED.distance_m, expires_at=EXCLUDED.expires_at`,
        [key, result.durationS, result.distanceM ?? null, result.source, String(this.ttlMin)],
      );
    }
    return result;
  }
}
