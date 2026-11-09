/**
 * «عرض سيناريو رصد» — the official RASD story as an automated but controllable demonstration.
 * Every scene is replayable; going back rebuilds the state deterministically from the seed.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useNavigate, type NavigateFunction } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Pause, Play, RefreshCcw, RotateCcw, Sparkles, X } from 'lucide-react';
import { useStore } from '@/store/store';
import { beforeProjects, getConflicts, getMetrics } from '@/store/derived';
import { generateOptions } from '@/engine/optimization/optimize';
import { projectMidpoint } from '@/engine/spatial/geometry';
import { STUDY_AREA_VIEW } from '@/data/network';
import { fmtNum, cn } from '@/utils/format';
import { Button } from '@/components/ui/ui';

const S = () => useStore.getState();
const A_ID = 'RASD-P01';
const B_ID = 'RASD-D01';

function demoConflict() {
  const ps = S().projects;
  return getConflicts(ps).find((c) => c.projectIds.includes(B_ID) && c.projectIds.includes(A_ID));
}

function recommended() {
  const c = demoConflict();
  if (!c) return null;
  const st = S();
  const r = generateOptions(c, st.projects, st.weights, st.economics);
  return { c, options: r.options, best: r.options.find((o) => o.recommended) ?? null, current: r.current };
}

function ensureApproved() {
  if (S().audit.some((a) => a.conflictId?.includes(B_ID) && (a.action === 'approve_option' || a.action === 'modify_option'))) return;
  const r = recommended();
  if (r?.best) S().approveOption(r.c.id, r.best, `عرض سيناريو رصد: اعتماد «${r.best.titleAr}» — يحل التعارض ويحترم قيود الجهتين.`);
}

export interface Scene {
  title: string;
  body: string | (() => string);
  ms: number;
  run: (nav: NavigateFunction, animated: boolean) => void;
}

export const SCENES: Scene[] = [
  {
    title: 'حي العليا في الرياض — ثلاثي الأبعاد',
    body: 'نطاق تجريبي صغير: حي واحد ومجموعة مشاريع افتراضية متقاربة على طريق الملك فهد وشارع العليا.',
    ms: 7000,
    run: (nav, animated) => {
      S().resetScenario();
      S().setViewMode('after');
      nav('/map');
      S().setSimDate('2026-12-08', 8);
      S().cameraCmd({ type: 'fly', center: STUDY_AREA_VIEW.center, zoom: 14, pitch: 60, bearing: -30, duration: animated ? 2600 : 0 });
    },
  },
  {
    title: 'إدخال المشاريع: المشروع الأول',
    body: 'مرفق المياه يسجّل خطته: إغلاق جزئي لمسارين على طريق الملك فهد (٦–٢٤ ديسمبر)، مع المدة ونطاق الإغلاق وقيود التنفيذ.',
    ms: 7500,
    run: (nav, animated) => {
      nav('/register');
      S().setDraft({ segmentId: 'KFR-THL-URB', from: 0.2, to: 0.7, pickStage: 'idle' });
      S().selectProject(A_ID);
      const a = S().projects.find((p) => p.id === A_ID)!;
      S().cameraCmd({ type: 'fly', center: projectMidpoint(a), zoom: 15.3, pitch: 60, duration: animated ? 2000 : 0 });
    },
  },
  {
    title: 'مشروع ثانٍ متقارب بجدول متداخل',
    body: 'مقاول صيانة الطرق يسجّل — بشكل مستقل — إغلاقاً كلياً لشارع العليا الموازي (١٢–٢٣ ديسمبر): المسار البديل الطبيعي.',
    ms: 7500,
    run: (nav, animated) => {
      S().setDraft({ segmentId: null, pickStage: 'idle' });
      const p = S().injectDemoConflict();
      nav('/');
      S().selectProject(p.id);
      S().cameraCmd({ type: 'fly', center: projectMidpoint(p), zoom: 15, pitch: 62, bearing: -15, duration: animated ? 2000 : 0 });
    },
  },
  {
    title: 'تحليل التعارض وإبراز الطرق المتأثرة',
    body: () => {
      const c = demoConflict();
      return c ? `قراءة المشاريع معاً بدل كل إغلاق منفرداً: ${c.explanationAr} ${c.evidence.find((e) => e.rule === 'detour')?.textAr ?? ''}` : '';
    },
    ms: 9000,
    run: (nav) => {
      nav('/conflicts');
      S().setSimDate('2026-12-16', 8);
      const c = demoConflict();
      if (c) {
        S().selectConflict(c.id);
        S().setHighlight(c.segmentIds);
      }
    },
  },
  {
    title: 'فتح البدائل الثلاثة',
    body: 'تقديم الموعد حسب المرونة · تأخير الموعد حسب الأولوية · نافذة مشتركة إذا أمكن فنياً — كل بديل يُقيَّم بمحاكاة الأفق الزمني كاملاً.',
    ms: 8000,
    run: (nav) => {
      S().setHighlight([]);
      const c = demoConflict();
      if (c) S().selectConflict(c.id);
      S().setFocusOption(null);
      nav('/optimize');
    },
  },
  {
    title: 'اختيار بديل ممكن وشرح المفاضلة',
    body: () => {
      const r = recommended();
      if (!r?.best) return 'لا يوجد بديل ممكن ضمن القيود.';
      const inf = r.options.filter((o) => !o.feasible).map((o) => o.titleAr).join(' و');
      return `البديل الموصى به: «${r.best.titleAr}». ${r.best.tradeoffsAr[0] ?? ''}${inf ? ` أما ${inf} فغير ممكن ضمن القيود.` : ''}`;
    },
    ms: 9500,
    run: (nav) => {
      nav('/optimize');
      const r = recommended();
      if (r?.best) S().setFocusOption(r.best.kind);
    },
  },
  {
    title: 'مراجعة الجهة المختصة واعتمادها',
    body: 'جهة التنسيق تراجع الأدلة: قبول أو رفض أو تعديل. يُوثَّق القرار وأسبابه في سجل التدقيق.',
    ms: 7500,
    run: (nav, animated) => {
      nav('/optimize');
      const r = recommended();
      if (!r?.best) return;
      if (animated) S().setReviewRequest(r.best.kind);
      else ensureApproved();
    },
  },
  {
    title: 'الخطة الأصلية مقابل الخطة المنسقة',
    body: 'نقارن خطتين للمشاريع نفسها: التعارضات، تكرار الإغلاق ومدته ونطاقه، ثم الأثر المروري المُنمذج كمؤشر مساند.',
    ms: 10000,
    run: (nav) => {
      ensureApproved();
      S().setFocusOption(null);
      S().setSimDate('2026-12-16', 8);
      nav('/compare');
    },
  },
  {
    title: 'تجربة المواطن: خطط لرحلة الغد قبل مفاجأة الإغلاق',
    body: 'الإغلاق المعتمد يظهر لمستخدم الطريق قبل يوم الرحلة، مع الالتفاف المقترح وأفضل وقت للانطلاق.',
    ms: 9500,
    run: (nav) => {
      ensureApproved();
      nav('/citizen');
    },
  },
  {
    title: 'نتيجة السيناريو',
    body: 'فرق واضح ومبررات قابلة للمراجعة — محسوب من النموذج نفسه، دون نسب تحسين مفترضة.',
    ms: 12000,
    run: (nav, animated) => {
      ensureApproved();
      nav('/');
      S().cameraCmd({ type: 'reset' });
      void animated;
    },
  },
];

export function startShow(scene = 0) {
  S().setTutorial({ active: false });
  S().setShow({ active: true, scene, playing: true });
}

export function RasdShow() {
  const show = useStore((s) => s.show);
  const setShow = useStore((s) => s.setShow);
  const projects = useStore((s) => s.projects);
  const economics = useStore((s) => s.economics);
  const navigate = useNavigate();
  const ranFor = useRef<number>(-1);
  const prev = useRef<number>(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scene = SCENES[show.scene];

  useEffect(() => {
    if (!show.active) {
      ranFor.current = -1;
      prev.current = -1;
      return;
    }
    if (ranFor.current !== show.scene) {
      const target = show.scene;
      // jumping backwards or skipping: rebuild state deterministically up to the target scene
      if (prev.current === -1 ? target > 0 : target !== prev.current + 1) for (let j = 0; j < target; j++) SCENES[j].run(navigate, false);
      SCENES[target].run(navigate, true);
      ranFor.current = target;
      prev.current = target;
    }
    if (!show.playing || show.scene >= SCENES.length - 1) return;
    timer.current = setTimeout(() => setShow({ scene: show.scene + 1 }), scene.ms);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [show.active, show.scene, show.playing, navigate, setShow, scene]);

  const results = useMemo(() => {
    if (!show.active || show.scene < SCENES.length - 1) return null;
    const b = getMetrics(beforeProjects(projects), economics);
    const a = getMetrics(projects, economics);
    return { b, a };
  }, [show.active, show.scene, projects, economics]);

  if (!show.active || !scene) return null;
  const body = typeof scene.body === 'function' ? scene.body() : scene.body;
  const go = (i: number) => setShow({ scene: Math.max(0, Math.min(SCENES.length - 1, i)) });

  return (
    <div className="pointer-events-none fixed bottom-[150px] left-4 z-[88] w-[460px]" data-testid="rasd-show">
      <AnimatePresence mode="wait">
        <motion.div key={show.scene} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="glass-strong pointer-events-auto rounded-2xl border-violet-400/30 p-4 shadow-[0_20px_60px_-20px_rgba(124,93,255,0.6)]">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-violet-300">
            <Sparkles size={13} /> عرض سيناريو رصد · المشهد {show.scene + 1} من {SCENES.length}
            <button onClick={() => setShow({ active: false })} className="mr-auto rounded p-0.5 text-slate-400 hover:text-white" aria-label="إغلاق العرض" data-testid="show-close">
              <X size={14} />
            </button>
          </div>
          <div className="mt-2 flex gap-1">
            {SCENES.map((s, i) => (
              <button key={i} onClick={() => go(i)} title={s.title} aria-label={`المشهد ${i + 1}`} className={cn('h-1.5 flex-1 rounded-full transition', i < show.scene ? 'bg-violet-400/70' : i === show.scene ? 'bg-violet-300' : 'bg-white/10')} />
            ))}
          </div>
          <div className="mt-3 text-[15px] font-semibold" data-testid="show-title">
            {scene.title}
          </div>
          <div className="mt-1 text-[12.5px] leading-relaxed text-slate-300" data-testid="show-body">
            {body}
          </div>
          {results && (
            <div className="mt-3 grid grid-cols-3 gap-2 text-center" data-testid="show-results">
              <Outcome title="إغلاقات أقل تكراراً" before={results.b.closureEpisodes} after={results.a.closureEpisodes} unit="مرة إغلاق" />
              <Outcome title="أثر أخف على الحركة" before={results.b.closureKmDays} after={results.a.closureKmDays} unit="كم-يوم" digits={1} sub={`تعارضات ${results.b.conflicts} ← ${results.a.conflicts}`} />
              <Outcome title="استعداد أفضل لمستخدم الطريق" before={results.b.visibleClosureShare} after={results.a.visibleClosureShare} unit="% معلن مسبقاً" lowerIsBetter={false} />
            </div>
          )}
          <div className="mt-3 flex items-center gap-1.5">
            <Button size="sm" variant="subtle" onClick={() => go(show.scene - 1)} disabled={show.scene === 0} data-testid="show-back">
              <ChevronRight size={14} /> السابق
            </Button>
            <Button size="sm" variant={show.playing ? 'outline' : 'primary'} onClick={() => setShow({ playing: !show.playing })} data-testid="show-pause">
              {show.playing ? <Pause size={14} /> : <Play size={14} />} {show.playing ? 'إيقاف مؤقت' : 'تشغيل'}
            </Button>
            <Button size="sm" variant="subtle" onClick={() => go(show.scene + 1)} disabled={show.scene === SCENES.length - 1} data-testid="show-next">
              التالي <ChevronLeft size={14} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              title="إعادة المشهد"
              onClick={() => {
                ranFor.current = -1;
                prev.current = show.scene - 1;
                setShow({ scene: show.scene });
                SCENES[show.scene].run(navigate, true);
                ranFor.current = show.scene;
                prev.current = show.scene;
              }}
              data-testid="show-replay"
            >
              <RefreshCcw size={13} />
            </Button>
            <Button size="sm" variant="ghost" className="mr-auto" onClick={() => (ranFor.current = -1, prev.current = -1, setShow({ scene: 0, playing: false }))} data-testid="show-reset">
              <RotateCcw size={13} /> من البداية
            </Button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Outcome({ title, before, after, unit, digits = 0, lowerIsBetter = true, sub }: { title: string; before: number; after: number; unit: string; digits?: number; lowerIsBetter?: boolean; sub?: string }) {
  const better = lowerIsBetter ? after < before : after > before;
  const same = Math.abs(after - before) < 1e-9;
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] p-2">
      <div className="text-[10.5px] font-semibold text-violet-200">{title}</div>
      <div className="num mt-1 text-[13px]">
        <span className="text-slate-500">{fmtNum(before, digits)}</span> → <b className={same ? 'text-slate-200' : better ? 'text-emerald-300' : 'text-red-300'}>{fmtNum(after, digits)}</b>
      </div>
      <div className="text-[10px] text-slate-500">{unit}</div>
      {sub && <div className="num text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}
