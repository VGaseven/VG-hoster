import { useEffect, useLayoutEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Play, RotateCcw, X } from 'lucide-react';
import { useStore } from '@/store/store';
import { getConflicts, actionable } from '@/store/derived';
import { generateOptions } from '@/engine/optimization/optimize';
import { Button } from '@/components/ui/ui';

interface Step {
  title: string;
  body: string;
  route?: string;
  target?: string;
  demoLabel?: string;
  demo?: () => void;
  prepare?: () => void;
}

const S = () => useStore.getState();

export const TUTORIAL_STEPS: Step[] = [
  { title: 'مرحباً بك في رصد', body: 'رصد منصة لتنسيق إغلاقات الطرق قبل حدوثها: تسجّل الجهات مشاريعها، ويكشف النظام التعارضات، ويقترح جداول أفضل، ثم يعتمد متخذ القرار الخطة ويطّلع المواطن على الإغلاقات مسبقاً.', route: '/' },
  { title: 'استكشف الرياض ثلاثية الأبعاد', body: 'استخدم أدوات الكاميرا للتكبير والتدوير والإمالة والتبديل بين 2D و3D، أو شغّل جولة سينمائية.', route: '/map', target: '[data-tour="map-controls"]', demoLabel: 'تشغيل الجولة', demo: () => S().cameraCmd({ type: 'tour' }) },
  { title: 'سجّل مشروع بنية تحتية', body: 'من صفحة التسجيل تختار الجهة ونوع العمل والتواريخ وساعات العمل والأولوية والمرونة والمسارات المتأثرة.', route: '/register', target: '[data-tour="register-panel"]' },
  { title: 'حدّد حدود الإغلاق', body: 'انقر على مقطع طريق في الخريطة لتحديد بداية الإغلاق، ثم انقر مرة أخرى لتحديد نهايته — أو استخدم القائمة والمنزلقات.', route: '/register', target: '[data-tour="pick-segment"]', demoLabel: 'تحديد مقطع تجريبي', demo: () => S().setDraft({ segmentId: 'TAK-THL-URB', from: 0.2, to: 0.7, pickStage: 'idle' }) },
  { title: 'اكشف المشاريع المتداخلة', body: 'يقارن المحرك كل زوج من المشاريع مكانياً (Turf) وزمنياً (التواريخ وساعات العمل) وشبكياً (نموذج التوزيع المروري).', route: '/conflicts', target: '[data-tour="conflicts-panel"]', prepare: () => S().selectConflict(null) },
  {
    title: 'افهم تحذير التعارض',
    body: 'كل تحذير يوضّح النوع ونوع الدليل (هندسي مؤكد / شبكي مُنمذج / قرب فقط) والفترة المتأثرة ودرجة الخطورة مع تفصيلها.',
    route: '/conflicts',
    target: '[data-testid="conflict-warning"]',
    prepare: () => {
      const c = actionable(getConflicts(S().projects))[0];
      if (c) S().selectConflict(c.id);
    },
  },
  { title: 'راجع ثلاثة بدائل للجدولة', body: 'تقديم التنفيذ، تأخيره، أو نافذة عمل منسقة — كل بديل يُقيَّم بمحاكاة كاملة مع درجة موزونة شفافة يمكنك تعديل أوزانها.', route: '/optimize', target: '[data-tour="options"]' },
  {
    title: 'طبّق الخطة المحسّنة',
    body: 'اضغط «تطبيق الحل» على البديل الموصى به ثم أكّد الاعتماد مع المبررات. تتحدث الجداول والخريطة والخط الزمني ومعلومات المواطنين ويُسجَّل القرار.',
    route: '/optimize',
    target: '[data-tour="options"]',
    demoLabel: 'اعتماد البديل الموصى به',
    demo: () => {
      const st = S();
      const c = actionable(getConflicts(st.projects)).find((x) => x.id === st.selectedConflictId) ?? actionable(getConflicts(st.projects))[0];
      if (!c) return;
      const r = generateOptions(c, st.projects, st.weights, st.economics);
      const best = r.options.find((o) => o.recommended);
      if (best) {
        st.approveOption(c.id, best, 'اعتماد عبر الدليل التفاعلي');
        st.toast({ tone: 'success', title: 'تم اعتماد الخطة', body: best.titleAr });
      }
    },
  },
  { title: 'قارن قبل وبعد', body: 'نفس الطلب المروري ونفس الافتراضات — الفرق فقط في الجدول. المؤشرات محسوبة من النموذج وليست أرقاماً ثابتة.', route: '/compare', target: '[data-testid="compare-metrics"]' },
  { title: 'استكشف رحلة المواطن', body: 'يختار المواطن رحلة مستقبلية فيرى الإغلاق المعتمد على مساره، والمسار البديل، والفرق في الزمن والمسافة، وأفضل وقت للانطلاق.', route: '/citizen', target: '[data-testid="citizen-page"] aside' },
  { title: 'صدّر فيديو المحاكاة', body: 'من استوديو المحاكاة اختر الدقة والمدة ونمط الكاميرا ثم اضغط «تصدير MP4» — يُنفَّذ التصيير فعلياً عبر Remotion في عامل محلي.', route: '/studio', target: '[data-tour="render"]' },
];

export function Tutorial() {
  const tutorial = useStore((s) => s.tutorial);
  const setTutorial = useStore((s) => s.setTutorial);
  const navigate = useNavigate();
  const step = TUTORIAL_STEPS[tutorial.step];
  const [rect, setRect] = useState<DOMRect | null>(null);
  /** The card is shown only once it has reached its final position (avoids mis-clicks while it moves). */
  const [placed, setPlaced] = useState(false);

  useEffect(() => {
    if (!tutorial.active || !step) return;
    if (step.route) navigate(step.route);
    if (!S().panels.left) S().togglePanel('left', true);
    step.prepare?.();
  }, [tutorial.active, tutorial.step]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    setPlaced(false);
    setRect(null);
    if (!tutorial.active) return;
    if (!step?.target) {
      const t = setTimeout(() => setPlaced(true), 350);
      return () => clearTimeout(t);
    }
    let raf = 0;
    const started = performance.now();
    let stableSince = 0;
    let last: DOMRect | null = null;
    const find = () => {
      const el = document.querySelector(step.target!);
      const now = performance.now();
      if (el) {
        const r = el.getBoundingClientRect();
        const same = last && Math.abs(last.x - r.x) < 1 && Math.abs(last.y - r.y) < 1 && Math.abs(last.width - r.width) < 1 && Math.abs(last.height - r.height) < 1;
        if (!same) {
          last = r;
          stableSince = now;
          setRect(r);
        } else if (now - stableSince > 250) setPlaced(true);
      } else if (now - started > 2500) setPlaced(true); // target unavailable (e.g. collapsed panel) → centred card
      raf = requestAnimationFrame(find);
    };
    find();
    return () => cancelAnimationFrame(raf);
  }, [tutorial.active, tutorial.step, step]);

  if (!tutorial.active || !step) return null;
  const n = TUTORIAL_STEPS.length;
  const close = () => setTutorial({ active: false });
  const go = (i: number) => setTutorial({ step: Math.max(0, Math.min(n - 1, i)) });

  // Tooltip placement: beside the target if there is room, otherwise centered
  const W = 360;
  let style: React.CSSProperties = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  if (rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const spaceLeft = rect.left;
    const spaceRight = vw - rect.right;
    const top = Math.min(Math.max(16, rect.top), vh - 280);
    if (spaceLeft > W + 24) style = { left: rect.left - W - 16, top };
    else if (spaceRight > W + 24) style = { left: rect.right + 16, top };
    else style = { left: Math.min(vw - W - 16, Math.max(16, rect.left)), top: rect.bottom + 16 < vh - 260 ? rect.bottom + 16 : Math.max(16, rect.top - 270) };
  }

  return (
    <div className="fixed inset-0 z-[85]" data-testid="tutorial">
      {rect ? <div className="tour-spotlight" style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }} /> : <div className="fixed inset-0 bg-slate-950/60" />}
      <AnimatePresence mode="wait">
        {placed && (
        <motion.div key={tutorial.step} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0 } }} className="glass-strong fixed z-[86] rounded-2xl p-4 shadow-2xl" style={{ ...style, width: W }} role="dialog" aria-label="دليل استخدام منصة رصد">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-cyan-300">دليل استخدام منصة رصد · {tutorial.step + 1}/{n}</span>
            <button onClick={close} className="rounded p-1 text-slate-400 hover:text-white" aria-label="تخطي الدليل" data-testid="tutorial-skip">
              <X size={15} />
            </button>
          </div>
          <div className="mt-2 flex gap-1">
            {TUTORIAL_STEPS.map((_, i) => (
              <span key={i} className={`h-1 flex-1 rounded-full ${i <= tutorial.step ? 'bg-cyan-400' : 'bg-white/10'}`} />
            ))}
          </div>
          <h3 className="mt-3 text-[15px] font-semibold" data-testid="tutorial-title">{step.title}</h3>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-300">{step.body}</p>
          {step.demo && (
            <Button size="sm" variant="subtle" className="mt-3" onClick={step.demo} data-testid="tutorial-demo">
              <Play size={13} /> {step.demoLabel}
            </Button>
          )}
          <div className="mt-4 flex items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => go(tutorial.step - 1)} disabled={tutorial.step === 0} data-testid="tutorial-back">
              <ChevronRight size={14} /> السابق
            </Button>
            {tutorial.step < n - 1 ? (
              <Button size="sm" variant="primary" onClick={() => go(tutorial.step + 1)} data-testid="tutorial-next">
                التالي <ChevronLeft size={14} />
              </Button>
            ) : (
              <Button size="sm" variant="success" onClick={close} data-testid="tutorial-finish">
                إنهاء الدليل
              </Button>
            )}
            <Button size="sm" variant="ghost" className="mr-auto" onClick={() => go(0)} data-testid="tutorial-restart">
              <RotateCcw size={13} /> من البداية
            </Button>
          </div>
        </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
