import type { Category, OrgId, Priority, ProjectStatus } from '@/types';

/** Generic, clearly simulated organization labels (no real agency attribution). */
export const ORGANIZATIONS: Record<OrgId, { ar: string; en: string; color: string; short: string }> = {
  municipality: { ar: 'الجهة البلدية (محاكاة)', en: 'Municipality (simulated)', color: '#a78bfa', short: 'بلدية' },
  water: { ar: 'مرفق المياه (محاكاة)', en: 'Water utility (simulated)', color: '#38bdf8', short: 'مياه' },
  electricity: { ar: 'مرفق الكهرباء (محاكاة)', en: 'Electricity utility (simulated)', color: '#facc15', short: 'كهرباء' },
  telecom: { ar: 'مزود الاتصالات (محاكاة)', en: 'Telecom provider (simulated)', color: '#f472b6', short: 'اتصالات' },
  roads: { ar: 'مقاول صيانة الطرق (محاكاة)', en: 'Road maintenance contractor (simulated)', color: '#fb923c', short: 'طرق' },
};

export const CATEGORIES: Record<Category, { ar: string; en: string }> = {
  water: { ar: 'شبكات المياه', en: 'Water network' },
  electricity: { ar: 'البنية الكهربائية', en: 'Electrical infrastructure' },
  telecom: { ar: 'الاتصالات والألياف', en: 'Telecom / fibre' },
  road_maintenance: { ar: 'صيانة الطرق', en: 'Road maintenance' },
  municipal: { ar: 'أعمال بلدية', en: 'Municipal works' },
  drainage: { ar: 'تصريف الأمطار', en: 'Storm drainage' },
};

/** Which categories may share one trench / work zone (coordinated execution). */
export const SHARED_ZONE_COMPATIBLE: Record<Category, Category[]> = {
  water: ['electricity', 'telecom', 'drainage', 'water'],
  electricity: ['water', 'telecom', 'electricity'],
  telecom: ['water', 'electricity', 'telecom', 'drainage'],
  drainage: ['water', 'telecom', 'drainage'],
  road_maintenance: ['municipal'],
  municipal: ['road_maintenance'],
};

export const PRIORITIES: Record<Priority, { ar: string; en: string; rank: number }> = {
  critical: { ar: 'حرجة', en: 'Critical', rank: 4 },
  high: { ar: 'عالية', en: 'High', rank: 3 },
  medium: { ar: 'متوسطة', en: 'Medium', rank: 2 },
  low: { ar: 'منخفضة', en: 'Low', rank: 1 },
};

export const STATUSES: Record<ProjectStatus, { ar: string; en: string; tone: string }> = {
  draft: { ar: 'مسودة', en: 'Draft', tone: 'slate' },
  submitted: { ar: 'مُقدَّم', en: 'Submitted', tone: 'sky' },
  conflict_detected: { ar: 'تعارض مكتشف', en: 'Conflict detected', tone: 'red' },
  under_review: { ar: 'قيد المراجعة', en: 'Under review', tone: 'amber' },
  alternative_proposed: { ar: 'بديل مقترح', en: 'Alternative proposed', tone: 'violet' },
  approved: { ar: 'معتمد', en: 'Approved', tone: 'emerald' },
  rejected: { ar: 'مرفوض', en: 'Rejected', tone: 'rose' },
  scheduled: { ar: 'مجدول', en: 'Scheduled', tone: 'teal' },
};
