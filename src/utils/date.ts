/** Deterministic calendar helpers. Day indices are relative to the simulation horizon start. */
export const HORIZON_START = '2026-12-01';
export const HORIZON_DAYS = 92; // 2026-12-01 … 2027-03-02
export const TODAY_SIM = '2026-11-09';

const MS_DAY = 86_400_000;
const base = Date.parse(`${HORIZON_START}T00:00:00Z`);

export function dayIndex(iso: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - base) / MS_DAY);
}

export function isoFromDay(day: number): string {
  return new Date(base + Math.floor(day) * MS_DAY).toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  return isoFromDay(dayIndex(iso) + n);
}

export function durationDays(s: { start: string; end: string }): number {
  return dayIndex(s.end) - dayIndex(s.start) + 1;
}

export function overlapDays(a: { start: string; end: string }, b: { start: string; end: string }) {
  const s = Math.max(dayIndex(a.start), dayIndex(b.start));
  const e = Math.min(dayIndex(a.end), dayIndex(b.end));
  if (e < s) return null;
  return { start: isoFromDay(s), end: isoFromDay(e), days: e - s + 1 };
}

export function gapDays(a: { start: string; end: string }, b: { start: string; end: string }): number {
  if (dayIndex(a.end) < dayIndex(b.start)) return dayIndex(b.start) - dayIndex(a.end) - 1;
  if (dayIndex(b.end) < dayIndex(a.start)) return dayIndex(a.start) - dayIndex(b.end) - 1;
  return -1;
}

const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(iso: string, lang: 'ar' | 'en' = 'ar'): string {
  const [y, m, d] = iso.split('-').map(Number);
  return lang === 'ar' ? `${d} ${AR_MONTHS[m - 1]} ${y}` : `${d} ${EN_MONTHS[m - 1]} ${y}`;
}

export function fmtShort(iso: string, lang: 'ar' | 'en' = 'ar'): string {
  const [, m, d] = iso.split('-').map(Number);
  return lang === 'ar' ? `${d} ${AR_MONTHS[m - 1]}` : `${d} ${EN_MONTHS[m - 1]}`;
}

export function fmtHour(h: number): string {
  const hh = Math.floor(h) % 24;
  const mm = Math.round((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm === 60 ? 0 : mm).padStart(2, '0')}`;
}

export function fmtWorkHours(w: { start: number; end: number }, lang: 'ar' | 'en' = 'ar') {
  if (w.start === 0 && w.end === 24) return lang === 'ar' ? 'إغلاق مستمر ٢٤ ساعة' : 'Continuous 24h';
  return `${fmtHour(w.start)} – ${fmtHour(w.end % 24 === 0 ? 24 : w.end).replace('24:00', '24:00')}`;
}
