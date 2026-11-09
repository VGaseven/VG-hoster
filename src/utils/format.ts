export function fmtNum(n: number, digits = 0, lang: 'ar' | 'en' = 'ar'): string {
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(Number.isFinite(n) ? n : 0);
}

export function fmtSar(n: number, lang: 'ar' | 'en' = 'ar'): string {
  if (Math.abs(n) >= 1e6) return `${fmtNum(n / 1e6, 2, lang)} ${lang === 'ar' ? 'مليون ر.س' : 'M SAR'}`;
  if (Math.abs(n) >= 1e3) return `${fmtNum(n / 1e3, 1, lang)} ${lang === 'ar' ? 'ألف ر.س' : 'k SAR'}`;
  return `${fmtNum(n, 0, lang)} ${lang === 'ar' ? 'ر.س' : 'SAR'}`;
}

export function pctChange(before: number, after: number): number | null {
  if (!Number.isFinite(before) || before === 0) return null;
  return ((after - before) / before) * 100;
}

export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}
