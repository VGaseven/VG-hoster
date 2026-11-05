export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) {
    super(message);
  }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'madar' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined' && !location.pathname.startsWith('/login')) location.href = '/login';
    throw new ApiError(res.status, data.code ?? 'ERROR', data.message ?? 'تعذّر تنفيذ الطلب', data.details);
  }
  return data as T;
}

export interface Slot {
  id: string; date: string; start: string; end: string; quota: number; minStaff: number;
  booked: number; remaining: number; closed: boolean; full: boolean; past?: boolean;
}

export interface Me {
  id: string; name: string; email: string; role: 'employee' | 'admin'; eligible: boolean; travelMode: string;
  preferredStart: string | null; siteId: string | null; siteName: string | null; district: string | null; districtId: string | null; orgName: string; timezone: string;
}

const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export const dayName = (date: string) => DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
export const shortDate = (date: string) =>
  new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
export const clock = (iso: string, tz = 'Asia/Riyadh') =>
  new Intl.DateTimeFormat('ar-SA-u-nu-latn', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(new Date(iso));
export const mins = (s: number) => `${Math.round(s / 60)} د`;

/** "07:30" -> "7:30 ص" */
export const fmtTime = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'ص' : 'م';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
};

/** لحظة ISO -> "6:30 ص" بتوقيت الجهة */
export const clock12 = (iso: string, tz = 'Asia/Riyadh') => {
  const p = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).format(new Date(iso));
  return fmtTime(p);
};

export const longDate = (date: string) => `${dayName(date)} ${shortDate(date)}`;
