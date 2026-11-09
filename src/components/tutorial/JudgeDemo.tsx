import { useEffect, useRef, useState } from 'react';
import { useNavigate, type NavigateFunction } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { Sparkles, Square } from 'lucide-react';
import { useStore } from '@/store/store';
import { getConflicts } from '@/store/derived';
import { generateOptions } from '@/engine/optimization/optimize';
import { STAGES, stopCalendar } from '@/components/conflicts/scenarioStages';

interface Beat {
  caption: string;
  ms: number;
  run: (nav: NavigateFunction) => void;
}

const S = () => useStore.getState();

/** Automated ~2.5-minute walkthrough of the full RASD workflow for judges. */
export const BEATS: Beat[] = [
  {
    caption: 'رصد — منصة تنسيق إغلاقات الطرق في الرياض: ننسق قبل الإغلاق، ونتنبأ قبل التعطيل.',
    ms: 7000,
    run: (nav) => {
      S().resetScenario();
      S().setTutorial({ active: false });
      nav('/');
      S().cameraCmd({ type: 'reset' });
    },
  },
  { caption: 'توأم رقمي ثلاثي الأبعاد لممر العليا وطريق الملك فهد، مع حركة مرور محاكاة على شبكة الطرق.', ms: 11000, run: (nav) => (nav('/map'), S().setSimDate('2026-12-16', 8), S().cameraCmd({ type: 'tour' })) },
  { caption: 'المشكلة: جهتان تخططان لأعمالهما بشكل مستقل في نفس الحي…', ms: 3000, run: (nav) => nav('/conflicts') },
  ...STAGES.slice(0, 10).map<Beat>((s) => ({ caption: `${s.titleAr} — ${s.bodyAr}`, ms: Math.max(4200, s.durationMs + 600), run: (nav) => void s.run({ navigate: nav, animated: true }) })),
  {
    caption: 'مركز تحسين الجدولة: ثلاثة بدائل محسوبة بمحاكاة كاملة — تقديم، تأخير، أو نافذة منسقة — مع درجة موزونة شفافة.',
    ms: 12000,
    run: (nav) => {
      stopCalendar();
      const c = getConflicts(S().projects).find((x) => x.projectIds.includes('RASD-D01'));
      if (c) S().selectConflict(c.id);
      nav('/optimize');
    },
  },
  {
    caption: 'متخذ القرار يعتمد البديل الموصى به؛ تتحدث الجداول والخريطة والخط الزمني تلقائياً ويُسجَّل القرار.',
    ms: 7000,
    run: () => {
      const st = S();
      const c = getConflicts(st.projects).find((x) => x.id === st.selectedConflictId);
      if (!c) return;
      const best = generateOptions(c, st.projects, st.weights, st.economics).options.find((o) => o.recommended);
      if (best) {
        st.approveOption(c.id, best, `عرض الحكام: اعتماد "${best.titleAr}" كأفضل بديل ممكن`);
        st.toast({ tone: 'success', title: 'تم اعتماد الخطة المنسقة', body: best.titleAr });
      }
    },
  },
  {
    caption: 'تعارض آخر: مشروعا مياه وكهرباء على نفس مقطع طريق الملك فهد — الحل: منطقة عمل مشتركة واحدة.',
    ms: 7000,
    run: () => {
      const st = S();
      const c = getConflicts(st.projects).find((x) => x.id === 'C-RASD-P01-RASD-P02');
      if (!c) return;
      const best = generateOptions(c, st.projects, st.weights, st.economics).options.find((o) => o.recommended);
      if (best) st.approveOption(c.id, best, `عرض الحكام: ${best.titleAr} للمشروعين P01/P02`);
    },
  },
  { caption: 'قبل التنسيق / بعد التنسيق: نفس الطلب ونفس الافتراضات، والمؤشرات محسوبة من النموذج.', ms: 14000, run: (nav) => (nav('/compare'), S().setSimDate('2026-12-16', 8)) },
  { caption: 'تجربة المواطن: «خطط لمشوار بكرة من اليوم» — الإغلاق المعتمد، المسار البديل، وأفضل وقت للانطلاق.', ms: 12000, run: (nav) => nav('/citizen') },
  { caption: 'لوحة مؤشرات الأثر: التعارضات المحلولة، أيام الإغلاق، ساعات التأخير، والأثر الاقتصادي التوضيحي — مع تصدير CSV/JSON.', ms: 10000, run: (nav) => nav('/analytics') },
  { caption: 'استوديو المحاكاة: تصدير فيديو MP4 حتمي للمحاكاة عبر Remotion.', ms: 7000, run: (nav) => nav('/studio') },
  { caption: 'رصد — قرار أذكى، إغلاق أقل، مدينة أكثر انسيابية.', ms: 6000, run: (nav) => (nav('/'), S().cameraCmd({ type: 'reset' })) },
];

export const DEMO_TOTAL_MS = BEATS.reduce((s, b) => s + b.ms, 0);

export function JudgeDemo() {
  const active = useStore((s) => s.demo.active);
  const setDemo = useStore((s) => s.setDemo);
  const navigate = useNavigate();
  const [i, setI] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active) {
      setI(0);
      setElapsed(0);
      return;
    }
    const beat = BEATS[i];
    if (!beat) {
      setDemo(false);
      return;
    }
    beat.run(navigate);
    t.current = setTimeout(() => {
      setElapsed((e) => e + beat.ms);
      setI((x) => x + 1);
    }, beat.ms);
    return () => {
      if (t.current) clearTimeout(t.current);
    };
  }, [active, i, navigate, setDemo]);

  if (!active) return null;
  const beat = BEATS[Math.min(i, BEATS.length - 1)];
  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-[88] flex justify-center px-4" data-testid="judge-demo">
      <AnimatePresence mode="wait">
        <motion.div key={i} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="glass-strong pointer-events-auto w-full max-w-2xl rounded-2xl px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-cyan-300">
            <Sparkles size={13} /> وضع عرض الحكام · {i + 1}/{BEATS.length}
            <button
              onClick={() => {
                stopCalendar();
                S().cameraCmd({ type: 'stop' });
                setDemo(false);
              }}
              className="mr-auto flex items-center gap-1 rounded-md bg-white/5 px-2 py-0.5 text-slate-300 hover:bg-white/10"
              data-testid="demo-stop"
            >
              <Square size={11} /> إيقاف
            </button>
          </div>
          <div className="mt-1.5 text-[14px] leading-relaxed text-slate-100" data-testid="demo-caption">{beat.caption}</div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
            <motion.div className="h-full bg-gradient-to-l from-cyan-400 to-emerald-400" initial={{ width: `${(elapsed / DEMO_TOTAL_MS) * 100}%` }} animate={{ width: `${((elapsed + beat.ms) / DEMO_TOTAL_MS) * 100}%` }} transition={{ duration: beat.ms / 1000, ease: 'linear' }} />
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
