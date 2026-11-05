import { LatLng, TravelMode, TripEstimator } from './estimator';

export interface DepartureOption {
  label: 'recommended' | 'safer' | 'latest';
  departAt: string;      // ISO
  arriveAt: string;      // ISO (عند الباب بعد هامش المشي والدخول)
  durationS: number;
  source: 'google' | 'fallback';
  onTime: boolean;
}

export interface ArrivalPlan {
  target: string;        // بداية الفترة (ISO)
  windowEnd: string;     // نهاية الفترة (ISO)
  entryBufferMin: number;
  options: DepartureOption[];
  approximate: boolean;  // true إذا كان أي تقدير احتياطيًا
}

const FIVE_MIN = 300_000;
const floor5 = (t: number) => Math.floor(t / FIVE_MIN) * FIVE_MIN;

/**
 * يجد وقت انطلاق يصل به الموظف عند بداية الفترة.
 * Routes API يقدّر الرحلة لوقت انطلاق معين، لذا نجرّب أوقات انطلاق متتالية حتى يتقارب التقدير
 * (عادة ٢–٣ طلبات)، ثم نضيف هامش المشي والدخول.
 */
export async function planArrival(
  est: TripEstimator,
  p: { origin: LatLng; dest: LatLng; mode: TravelMode; slotStart: Date; slotEnd: Date; entryBufferMin: number; now?: Date; maxIterations?: number },
): Promise<ArrivalPlan> {
  const now = p.now ?? new Date();
  const bufferMs = p.entryBufferMin * 60_000;
  const targetPark = p.slotStart.getTime() - bufferMs;
  let approximate = false;

  // تخمين أولي من تقدير عند (الهدف - ٣٠ دقيقة)
  let guess = await est.estimate(p.origin, p.dest, new Date(Math.max(now.getTime(), targetPark - 30 * 60_000)), p.mode);
  approximate ||= guess.source === 'fallback';
  let depart = floor5(targetPark - guess.durationS * 1000);
  let guessDep = NaN; // وقت الانطلاق الذي يخص التقدير المحفوظ في guess
  for (let i = 0; i < (p.maxIterations ?? 3); i++) {
    const e = await est.estimate(p.origin, p.dest, new Date(Math.max(now.getTime(), depart)), p.mode);
    approximate ||= e.source === 'fallback';
    guess = e;
    guessDep = depart;
    const next = floor5(targetPark - e.durationS * 1000);
    if (next === depart) break;
    depart = next;
  }

  const option = async (label: DepartureOption['label'], dep: number): Promise<DepartureOption> => {
    const d = Math.max(now.getTime(), dep);
    const e = dep === guessDep ? guess : await est.estimate(p.origin, p.dest, new Date(d), p.mode);
    approximate ||= e.source === 'fallback';
    const arrive = d + e.durationS * 1000 + bufferMs;
    return {
      label,
      departAt: new Date(d).toISOString(),
      arriveAt: new Date(arrive).toISOString(),
      durationS: e.durationS,
      source: e.source,
      onTime: arrive <= p.slotEnd.getTime(),
    };
  };

  const options = [
    await option('safer', depart - 10 * 60_000),
    await option('recommended', depart),
  ];
  // آخر وقت انطلاق يُبقي الوصول داخل الفترة
  const latestPark = p.slotEnd.getTime() - bufferMs;
  const latest = await option('latest', floor5(latestPark - guess.durationS * 1000));
  if (latest.departAt !== options[1].departAt) options.push(latest);

  return {
    target: p.slotStart.toISOString(),
    windowEnd: p.slotEnd.toISOString(),
    entryBufferMin: p.entryBufferMin,
    options,
    approximate,
  };
}

/** رابط مباشر لفتح الملاحة في Google Maps (Maps URLs) — لا يتطلب مفتاح API */
export function googleMapsDirectionsUrl(dest: LatLng, mode: TravelMode, origin?: LatLng): string {
  const travelmode = { DRIVE: 'driving', TRANSIT: 'transit', TWO_WHEELER: 'two-wheeler', WALK: 'walking' }[mode];
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api', '1');
  if (origin) u.searchParams.set('origin', `${origin.lat},${origin.lng}`);
  u.searchParams.set('destination', `${dest.lat},${dest.lng}`);
  u.searchParams.set('travelmode', travelmode);
  u.searchParams.set('dir_action', 'navigate');
  return u.toString();
}
