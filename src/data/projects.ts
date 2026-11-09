/**
 * SYNTHETIC demonstration projects. These are NOT real upcoming government roadworks.
 * Geography: real road names in the Olaya corridor (see network.ts). Dates within the
 * simulation horizon (Dec 2026 – Feb 2027). Costs use a fixed seed for reproducibility.
 */
import type { CitizenJourney, Place, Project } from '@/types';
import { DATA_SEED, mulberry32 } from '@/utils/random';

type Seed = Omit<Project, 'schedule' | 'estimatedCostSar' | 'synthetic' | 'createdAt' | 'status'> & {
  status?: Project['status'];
  costBand: [number, number];
};

const SEEDS: Seed[] = [
  // ── Scenario 1: two conflicting roadworks on the same King Fahd Rd block ──
  {
    id: 'RASD-P01',
    title: 'إعادة تأهيل خط مياه رئيسي — طريق الملك فهد',
    orgId: 'water',
    category: 'water',
    closures: [{ segmentId: 'KFR-THL-URB', from: 0.2, to: 0.7 }],
    proposed: { start: '2026-12-06', end: '2026-12-24' },
    workHours: { start: 0, end: 24 },
    priority: 'high',
    earliestStart: '2026-12-01',
    latestEnd: '2027-01-31',
    closureType: 'partial',
    affectedLanes: 2,
    neighborhood: 'حي العليا',
    costBand: [8e6, 14e6],
  },
  {
    id: 'RASD-P02',
    title: 'تمديد كابلات جهد متوسط — طريق الملك فهد',
    orgId: 'electricity',
    category: 'electricity',
    closures: [{ segmentId: 'KFR-THL-URB', from: 0.45, to: 0.95 }],
    proposed: { start: '2026-12-10', end: '2026-12-24' },
    workHours: { start: 0, end: 24 },
    priority: 'medium',
    earliestStart: '2026-12-08',
    latestEnd: '2027-02-20',
    closureType: 'partial',
    affectedLanes: 2,
    neighborhood: 'حي العليا',
    costBand: [5e6, 9e6],
  },
  // ── Scenario 2: closure blocking another project's detour (north blocks) ──
  {
    id: 'RASD-P03',
    title: 'مد ألياف بصرية — طريق الملك فهد شمال العروبة',
    orgId: 'telecom',
    category: 'telecom',
    closures: [{ segmentId: 'KFR-URB-KAR', from: 0.3, to: 0.8 }],
    proposed: { start: '2027-01-05', end: '2027-01-25' },
    workHours: { start: 0, end: 24 },
    priority: 'medium',
    earliestStart: '2026-12-20',
    latestEnd: '2027-02-28',
    closureType: 'partial',
    affectedLanes: 3,
    neighborhood: 'حي الورود',
    costBand: [3e6, 6e6],
  },
  {
    id: 'RASD-P04',
    title: 'تطوير الأرصفة والإنارة — شارع العليا (شمال)',
    orgId: 'municipality',
    category: 'municipal',
    closures: [{ segmentId: 'OLY-URB-KAR', from: 0, to: 1 }],
    proposed: { start: '2027-01-10', end: '2027-02-01' },
    workHours: { start: 7, end: 19 },
    priority: 'low',
    earliestStart: '2026-12-15',
    latestEnd: '2027-03-01',
    closureType: 'full',
    affectedLanes: 3,
    neighborhood: 'حي الورود',
    costBand: [6e6, 11e6],
  },
  // ── Scenario 3: multiple utility works repeatedly closing Al Urubah Rd ──
  {
    id: 'RASD-P05',
    title: 'توصيلات مياه للمباني — طريق العروبة',
    orgId: 'water',
    category: 'water',
    closures: [{ segmentId: 'URB-KFR-OLY', from: 0.1, to: 0.9 }],
    proposed: { start: '2027-01-03', end: '2027-01-12' },
    workHours: { start: 0, end: 24 },
    priority: 'medium',
    earliestStart: '2026-12-20',
    latestEnd: '2027-02-28',
    closureType: 'partial',
    affectedLanes: 2,
    neighborhood: 'برج المملكة',
    costBand: [1.5e6, 3e6],
  },
  {
    id: 'RASD-P06',
    title: 'نقل كابينة اتصالات — طريق العروبة',
    orgId: 'telecom',
    category: 'telecom',
    closures: [{ segmentId: 'URB-KFR-OLY', from: 0.3, to: 0.7 }],
    proposed: { start: '2027-01-20', end: '2027-01-28' },
    workHours: { start: 8, end: 20 },
    priority: 'medium',
    earliestStart: '2027-01-01',
    latestEnd: '2027-02-28',
    closureType: 'partial',
    affectedLanes: 1,
    neighborhood: 'برج المملكة',
    costBand: [0.8e6, 1.6e6],
  },
  {
    id: 'RASD-P07',
    title: 'تعزيز شبكة التوزيع الكهربائي — طريق العروبة',
    orgId: 'electricity',
    category: 'electricity',
    closures: [{ segmentId: 'URB-KFR-OLY', from: 0.05, to: 0.6 }],
    proposed: { start: '2027-02-05', end: '2027-02-14' },
    workHours: { start: 0, end: 24 },
    priority: 'high',
    earliestStart: '2027-01-05',
    latestEnd: '2027-02-28',
    closureType: 'partial',
    affectedLanes: 2,
    neighborhood: 'برج المملكة',
    costBand: [2e6, 4e6],
  },
  // ── Scenario 4: high-priority project with zero schedule flexibility ──
  {
    id: 'RASD-P08',
    title: 'إصلاح طارئ لمغذٍّ كهربائي — طريق مكة المكرمة',
    orgId: 'electricity',
    category: 'electricity',
    closures: [{ segmentId: 'MAK-TAK-KFR', from: 0.35, to: 0.75 }],
    proposed: { start: '2026-12-08', end: '2026-12-20' },
    workHours: { start: 0, end: 24 },
    priority: 'critical',
    earliestStart: '2026-12-08',
    latestEnd: '2026-12-20',
    closureType: 'partial',
    affectedLanes: 2,
    neighborhood: 'حي أم الحمام الشرقي',
    costBand: [1e6, 2e6],
  },
  {
    id: 'RASD-P09',
    title: 'إعادة سفلتة — طريق مكة المكرمة بين التخصصي والملك فهد',
    orgId: 'roads',
    category: 'road_maintenance',
    closures: [{ segmentId: 'MAK-TAK-KFR', from: 0.5, to: 1 }],
    proposed: { start: '2026-12-12', end: '2026-12-28' },
    workHours: { start: 0, end: 24 },
    priority: 'low',
    earliestStart: '2026-12-10',
    latestEnd: '2027-02-15',
    closureType: 'partial',
    affectedLanes: 2,
    neighborhood: 'حي أم الحمام الشرقي',
    costBand: [2e6, 3.5e6],
  },
  // ── Independent works (no conflict expected) ──
  {
    id: 'RASD-P10',
    title: 'صيانة دورية ليلية — طريق مكة المكرمة شرق العليا',
    orgId: 'roads',
    category: 'road_maintenance',
    closures: [{ segmentId: 'MAK-OLY-E', from: 0.1, to: 0.9 }],
    proposed: { start: '2027-02-01', end: '2027-02-10' },
    workHours: { start: 0, end: 6 },
    priority: 'low',
    earliestStart: '2027-01-15',
    latestEnd: '2027-02-28',
    closureType: 'partial',
    affectedLanes: 1,
    neighborhood: 'حي السليمانية',
    costBand: [0.6e6, 1.2e6],
    status: 'approved',
  },
  {
    id: 'RASD-P11',
    title: 'صيانة غرف تفتيش — شارع التخصصي (جنوب)',
    orgId: 'water',
    category: 'water',
    closures: [{ segmentId: 'TAK-MAK-THL', from: 0.2, to: 0.5 }],
    proposed: { start: '2026-12-01', end: '2026-12-05' },
    workHours: { start: 9, end: 15 },
    priority: 'medium',
    earliestStart: '2026-12-01',
    latestEnd: '2026-12-31',
    closureType: 'partial',
    affectedLanes: 1,
    neighborhood: 'حي أم الحمام الشرقي',
    costBand: [0.3e6, 0.7e6],
    status: 'scheduled',
  },
  {
    id: 'RASD-P12',
    title: 'توسعة شبكة الجيل الخامس — طريق الملك عبدالله',
    orgId: 'telecom',
    category: 'telecom',
    closures: [{ segmentId: 'KAR-TAK-KFR', from: 0.4, to: 0.6 }],
    proposed: { start: '2027-02-15', end: '2027-02-25' },
    workHours: { start: 0, end: 6 },
    priority: 'low',
    earliestStart: '2027-01-15',
    latestEnd: '2027-03-01',
    closureType: 'partial',
    affectedLanes: 1,
    neighborhood: 'حي الرحمانية',
    costBand: [0.9e6, 1.8e6],
    status: 'approved',
  },
  {
    id: 'RASD-P13',
    title: 'إصلاح فواصل تمدد جسر — طريق الملك فهد جنوب طريق مكة',
    orgId: 'roads',
    category: 'road_maintenance',
    closures: [{ segmentId: 'KFR-S-MAK', from: 0.2, to: 0.6 }],
    proposed: { start: '2027-01-15', end: '2027-01-22' },
    workHours: { start: 0, end: 6 },
    priority: 'high',
    earliestStart: '2027-01-10',
    latestEnd: '2027-02-10',
    closureType: 'partial',
    affectedLanes: 2,
    neighborhood: 'حي المعذر الشمالي',
    costBand: [1.2e6, 2.4e6],
    status: 'scheduled',
  },
];

/** Project injected by the interactive "محاكاة تعارض جديد" scenario. */
export const DEMO_CONFLICT_PROJECT_SEED: Seed = {
  id: 'RASD-D01',
  title: 'إعادة رصف شاملة — شارع العليا بين التحلية والعروبة (مشروع افتراضي)',
  orgId: 'roads',
  category: 'road_maintenance',
  closures: [{ segmentId: 'OLY-THL-URB', from: 0.1, to: 0.9 }],
  proposed: { start: '2026-12-12', end: '2026-12-23' },
  workHours: { start: 0, end: 24 },
  priority: 'low',
  earliestStart: '2026-12-01',
  latestEnd: '2027-02-28',
  closureType: 'full',
  affectedLanes: 3,
  neighborhood: 'برج المملكة',
  costBand: [3e6, 5e6],
};

function materialize(seeds: Seed[], seed: number): Project[] {
  const rnd = mulberry32(seed);
  return seeds.map((s) => {
    const { costBand, status, ...rest } = s;
    const cost = Math.round((costBand[0] + rnd() * (costBand[1] - costBand[0])) / 1000) * 1000;
    return {
      ...rest,
      schedule: { ...s.proposed },
      estimatedCostSar: cost,
      status: status ?? 'submitted',
      createdAt: '2026-11-01T09:00:00Z',
      synthetic: true as const,
    };
  });
}

export function createSeedProjects(): Project[] {
  return materialize(SEEDS, DATA_SEED);
}

export function createDemoConflictProject(): Project {
  const [p] = materialize([DEMO_CONFLICT_PROJECT_SEED], DATA_SEED + 7);
  return { ...p, createdAt: '2026-11-09T10:00:00Z' };
}

export const SCENARIOS = [
  { id: 'S1', titleAr: 'مشروعان متعارضان على نفس المقطع', titleEn: 'Two conflicting roadworks', projectIds: ['RASD-P01', 'RASD-P02'], focusDate: '2026-12-16' },
  { id: 'S2', titleAr: 'إغلاق يحجب مسار التحويل لمشروع آخر', titleEn: 'Closure blocking another detour', projectIds: ['RASD-P03', 'RASD-P04'], focusDate: '2027-01-12' },
  { id: 'S3', titleAr: 'أعمال مرافق متكررة قابلة للتنسيق', titleEn: 'Repeated utility works to coordinate', projectIds: ['RASD-P05', 'RASD-P06', 'RASD-P07'], focusDate: '2027-01-08' },
  { id: 'S4', titleAr: 'مشروع حرج بمرونة جدولة محدودة', titleEn: 'Critical project, no flexibility', projectIds: ['RASD-P08', 'RASD-P09'], focusDate: '2026-12-14' },
] as const;

export const PLACES: Place[] = [
  { id: 'pl-rahmaniyah', nodeId: 'Z-RAHMANIYAH', nameAr: 'حي الرحمانية', nameEn: 'Ar Rahmaniyah' },
  { id: 'pl-wurud', nodeId: 'Z-WURUD', nameAr: 'حي الورود', nameEn: 'Al Wurud' },
  { id: 'pl-olaya', nodeId: 'Z-OLAYA', nameAr: 'حي العليا', nameEn: 'Al Olaya' },
  { id: 'pl-sulay', nodeId: 'Z-SULAYMANIYAH', nameAr: 'حي السليمانية', nameEn: 'As Sulaymaniyah' },
  { id: 'pl-kingdom', nodeId: 'Z-KINGDOM', nameAr: 'برج المملكة', nameEn: 'Kingdom Centre' },
  { id: 'pl-faisaliah', nodeId: 'Z-FAISALIAH', nameAr: 'برج الفيصلية', nameEn: 'Al Faisaliah Tower' },
  { id: 'pl-kfr-n', nodeId: 'G-KFR-N', nameAr: 'طريق الملك فهد — شمالاً', nameEn: 'King Fahd Rd (north)' },
  { id: 'pl-kfr-s', nodeId: 'G-KFR-S', nameAr: 'طريق الملك فهد — جنوباً', nameEn: 'King Fahd Rd (south)' },
  { id: 'pl-kar-w', nodeId: 'G-KAR-W', nameAr: 'طريق الملك عبدالله — غرباً', nameEn: 'King Abdullah Rd (west)' },
  { id: 'pl-mak-e', nodeId: 'G-MAK-E', nameAr: 'طريق مكة المكرمة — شرقاً', nameEn: 'Makkah Rd (east)' },
];

export const CITIZEN_JOURNEYS: CitizenJourney[] = [
  { id: 'J1', titleAr: 'من الرحمانية إلى برج الفيصلية — صباح الدوام', originPlaceId: 'pl-rahmaniyah', destinationPlaceId: 'pl-faisaliah', date: '2026-12-16', hour: 8 },
  { id: 'J2', titleAr: 'من حي الورود إلى طريق مكة — عودة المساء', originPlaceId: 'pl-wurud', destinationPlaceId: 'pl-mak-e', date: '2027-01-14', hour: 17 },
];
