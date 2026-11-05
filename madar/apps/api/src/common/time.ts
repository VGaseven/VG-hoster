/** أدوات الوقت: نحفظ التاريخ والوقت المحليين للجهة ونحوّلها إلى لحظة UTC عند الحاجة */

/** فرق المنطقة الزمنية عن UTC بالدقائق عند لحظة معينة */
export function tzOffsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** يحوّل تاريخًا ووقتًا محليين (YYYY-MM-DD, HH:MM[:SS]) إلى لحظة UTC */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm, ss = 0] = time.split(':').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
  const off1 = tzOffsetMinutes(tz, guess);
  const first = new Date(guess.getTime() - off1 * 60000);
  const off2 = tzOffsetMinutes(tz, first);
  return off1 === off2 ? first : new Date(guess.getTime() - off2 * 60000);
}

/** تاريخ اليوم المحلي للجهة YYYY-MM-DD */
export function localDate(tz: string, at = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

export function localTime(tz: string, at: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = الأحد */
export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** pg يعيد DATE كنص عند ضبط المحلل؛ نوحّد الشكل */
export function hhmm(t: string): string {
  return t.slice(0, 5);
}
