import type { NavigateFunction } from 'react-router';
import { useStore } from '@/store/store';
import { getConflicts } from '@/store/derived';
import { RIYADH_OVERVIEW } from '@/data/network';
import { projectMidpoint } from '@/engine/spatial/geometry';
import { dayIndex } from '@/utils/date';

export interface Stage {
  id: number;
  titleAr: string;
  bodyAr: string;
  /** apply the stage; animated=false is used when rewinding/skipping to rebuild state */
  run: (ctx: { navigate: NavigateFunction; animated: boolean }) => void | Promise<void>;
  durationMs: number;
}

const DEMO_ID = 'RASD-D01';
const A_ID = 'RASD-P01';

function st() {
  return useStore.getState();
}

function demoConflict() {
  const ps = st().projects;
  return getConflicts(ps).find((c) => c.projectIds.includes(DEMO_ID) && c.projectIds.includes(A_ID)) ?? getConflicts(ps).find((c) => c.projectIds.includes(DEMO_ID));
}

let calendarTimer: ReturnType<typeof setInterval> | null = null;
export function stopCalendar() {
  if (calendarTimer) clearInterval(calendarTimer);
  calendarTimer = null;
}

export const STAGES: Stage[] = [
  {
    id: 1,
    titleAr: 'نظرة على الرياض',
    bodyAr: 'نبدأ من منظور علوي لمدينة الرياض قبل التركيز على ممر العليا.',
    durationMs: 3500,
    run: ({ animated }) => {
      st().setViewMode('after');
      st().selectConflict(null);
      st().setHighlight([]);
      st().setSimDate('2026-12-08', 8);
      st().cameraCmd({ type: 'fly', center: RIYADH_OVERVIEW.center, zoom: RIYADH_OVERVIEW.zoom, pitch: 25, bearing: 0, duration: animated ? 2500 : 0 });
    },
  },
  {
    id: 2,
    titleAr: 'التحليق إلى الحي',
    bodyAr: 'الكاميرا تتجه إلى حي العليا حيث يمر طريق الملك فهد وشارع العليا.',
    durationMs: 4000,
    run: ({ animated }) => st().cameraCmd({ type: 'fly', center: [46.6775, 24.7045], zoom: 14.6, pitch: 62, bearing: -30, duration: animated ? 3200 : 0 }),
  },
  {
    id: 3,
    titleAr: 'المشروع (أ): مياه — طريق الملك فهد',
    bodyAr: 'مرفق المياه سجّل إغلاقاً جزئياً لمسارين على طريق الملك فهد بين التحلية والعروبة.',
    durationMs: 4000,
    run: () => {
      const a = st().projects.find((p) => p.id === A_ID)!;
      st().selectProject(A_ID);
      st().setHighlight(a.closures.map((c) => c.segmentId));
      st().cameraCmd({ type: 'fly', center: projectMidpoint(a), zoom: 15.4, pitch: 62, duration: 1800 });
    },
  },
  {
    id: 4,
    titleAr: 'المشروع (ب) يظهر: إعادة رصف شارع العليا',
    bodyAr: 'مقاول صيانة الطرق يسجّل — بشكل مستقل — إغلاقاً كلياً لشارع العليا الموازي، وهو المسار البديل الطبيعي.',
    durationMs: 4500,
    run: () => {
      const p = st().injectDemoConflict();
      st().selectProject(p.id);
      st().setHighlight([]);
      st().cameraCmd({ type: 'fly', center: projectMidpoint(p), zoom: 15.2, pitch: 60, bearing: -10, duration: 1800 });
    },
  },
  {
    id: 5,
    titleAr: 'تقدّم التقويم المحاكى',
    bodyAr: 'نُقدّم الزمن من ٨ ديسمبر حتى ١٦ ديسمبر لنرى متى يعمل المشروعان معاً.',
    durationMs: 4500,
    run: ({ animated }) => {
      stopCalendar();
      st().injectDemoConflict();
      const target = dayIndex('2026-12-16') + 8 / 24;
      if (!animated) {
        st().setSimTime(target);
        return;
      }
      st().setSimDate('2026-12-08', 8);
      calendarTimer = setInterval(() => {
        const t = st().simTime + 0.25;
        if (t >= target) {
          st().setSimTime(target);
          stopCalendar();
        } else st().setSimTime(t);
      }, 100);
    },
  },
  {
    id: 6,
    titleAr: 'كشف التداخل',
    bodyAr: 'محرك رصد يقارن الحدود المكانية والفترات الزمنية ونتائج نموذج الشبكة.',
    durationMs: 3500,
    run: () => {
      stopCalendar();
      st().injectDemoConflict();
      st().setSimTime(dayIndex('2026-12-16') + 8 / 24);
      const c = demoConflict();
      if (c) {
        st().selectConflict(c.id);
        st().toast({ tone: 'warning', title: 'رُصد تعارض جديد', body: `${c.projectIds.join(' ↔ ')}` });
      }
    },
  },
  {
    id: 7,
    titleAr: 'إبراز الطرق المتأثرة',
    bodyAr: 'تُبرز المقاطع المتأثرة باللون الأحمر: الطريق المغلق جزئياً ومساره البديل المغلق كلياً.',
    durationMs: 3500,
    run: () => {
      const c = demoConflict();
      if (c) {
        st().selectConflict(c.id);
        st().setHighlight(c.segmentIds);
        st().cameraCmd({ type: 'fly', center: c.location, zoom: 14.9, pitch: 65, bearing: -45, duration: 1800 });
      }
    },
  },
  {
    id: 8,
    titleAr: 'عرض تحذير التعارض',
    bodyAr: 'تحذير مبني على أدلة: نوع التعارض، الفترة المتداخلة، ودرجة الخطورة مع تفسيرها.',
    durationMs: 4500,
    run: () => {
      const c = demoConflict();
      if (c) st().selectConflict(c.id);
      st().selectProject(null);
    },
  },
  {
    id: 9,
    titleAr: 'محاكاة إعادة توجيه الحركة',
    bodyAr: 'في ساعة الذروة تتحول المركبات إلى الطرق المتبقية؛ لاحظ تباطؤ المركبات (أحمر) وتكوّن الطوابير.',
    durationMs: 5000,
    run: ({ animated }) => {
      st().setOverlay('vehicles', true);
      st().setOverlay('traffic', true);
      st().setSimDate('2026-12-16', 8);
      const c = demoConflict();
      if (c && animated) st().cameraCmd({ type: 'orbit', center: c.location });
    },
  },
  {
    id: 10,
    titleAr: 'الأثر المروري المُنمذج',
    bodyAr: 'مقارنة قبل/بعد إضافة المشروع (ب): التأخير الإضافي في ساعة الذروة يظهر في لوحة الأدلة.',
    durationMs: 4500,
    run: () => {
      st().cameraCmd({ type: 'stop' });
    },
  },
  {
    id: 11,
    titleAr: 'فتح مركز تحسين الجدولة',
    bodyAr: 'ننتقل إلى مركز التحسين لمقارنة ثلاثة بدائل واختيار الأنسب.',
    durationMs: 2500,
    run: ({ navigate }) => {
      const c = demoConflict();
      if (c) st().selectConflict(c.id);
      st().setHighlight([]);
      navigate('/optimize');
    },
  },
];

export function rebuildUpTo(i: number, navigate: NavigateFunction) {
  stopCalendar();
  for (let j = 0; j < i; j++) if (j !== 10) void STAGES[j].run({ navigate, animated: false });
}

export function resetScenarioStages() {
  stopCalendar();
  const s = st();
  if (s.projects.some((p) => p.id === DEMO_ID)) s.removeProject(DEMO_ID);
  s.selectConflict(null);
  s.selectProject(null);
  s.setHighlight([]);
  s.cameraCmd({ type: 'reset' });
}
