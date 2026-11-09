import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Box, Camera, CheckCircle2, ChevronLeft, Construction, Eye, GitCompareArrows, History, Minus, Pause, Play, Plus, Radar, RotateCcw, RotateCw, Route, Sparkles, SkipForward, Square, TrafficCone } from 'lucide-react';
import { TwinScene, type CameraView } from './TwinScene';
import { createDataSource, DEMO_EXCAVATIONS, DEMO_HISTORY, type ConflictResult, type Excavation, type HistoricalState } from './adapter';
import { assignTwin, closuresOf, day, detectTwinConflicts, metricsFor, recommend, roadVc } from './model';
import { PROTOTYPE_LABEL_AR, PROTOTYPE_LABEL_EN, TWIN_ROADS } from './layout';
import { cn, fmtNum } from '@/utils/format';

const SCENARIO_DATE = '2026-12-14'; // both excavations planned to overlap on this day
const roadName = (id: string) => TWIN_ROADS.find((r) => r.id === id)?.nameAr ?? id;

type Rec = ReturnType<typeof recommend>;

export default function TwinPage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<TwinScene | null>(null);
  const [source] = useState(createDataSource);
  const [excavations, setExcavations] = useState<Excavation[]>(DEMO_EXCAVATIONS);
  const [history, setHistory] = useState<HistoricalState[]>(DEMO_HISTORY);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [aOn, setAOn] = useState(false);
  const [bOn, setBOn] = useState(false);
  const [detected, setDetected] = useState(false);
  const [rec, setRec] = useState<Rec | null>(null);
  const [applied, setApplied] = useState(false);
  const [compare, setCompare] = useState(false);
  const [compareView, setCompareView] = useState<'before' | 'after'>('after');
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const [toggles, setToggles] = useState({ traffic: true, construction: true, routes: true });
  const [kit, setKit] = useState<'checking' | 'missing' | 'loaded'>('checking');
  const [demo, setDemo] = useState<{ step: number; playing: boolean } | null>(null);

  useEffect(() => {
    void source.loadExcavations().then(setExcavations);
    void source.loadHistory().then(setHistory);
    return source.subscribe(() => {});
  }, [source]);

  useEffect(() => {
    if (!hostRef.current) return;
    const s = new TwinScene(hostRef.current);
    s.onKit = (k) => setKit(k === 'loaded' ? 'loaded' : 'missing');
    s.paused = true;
    sceneRef.current = s;
    Object.assign(window as object, { __twin: s });
    const ro = new ResizeObserver(() => s.resize());
    ro.observe(hostRef.current);
    return () => {
      ro.disconnect();
      s.dispose();
    };
  }, []);

  // ── derive the active excavations for the current view ──
  const A = excavations.find((e) => e.id === 'EXC-A')!;
  const B = excavations.find((e) => e.id === 'EXC-B')!;
  const scheduled = (e: Excavation) => (applied && rec && e.id === rec.projectId ? { ...e, start: rec.to.start, end: rec.to.end } : e);
  const covers = (e: Excavation, at: string) => day(e.start) <= day(at) && day(at) <= day(e.end);

  const active: Excavation[] = useMemo(() => {
    if (histIdx !== null) {
      const at = history[histIdx].at;
      return excavations.map(scheduled).filter((e) => covers(e, at));
    }
    if (compare) return compareView === 'before' ? [A, B] : [A, scheduled(B)].filter((e) => covers(e, SCENARIO_DATE));
    return [aOn ? A : null, bOn ? scheduled(B) : null].filter((e): e is Excavation => !!e && covers(e, SCENARIO_DATE));
  }, [histIdx, history, excavations, compare, compareView, aOn, bOn, A, B, applied, rec]); // eslint-disable-line react-hooks/exhaustive-deps

  const conflicts: ConflictResult[] = useMemo(() => (detected || compare || histIdx !== null ? detectTwinConflicts(active) : []), [active, detected, compare, histIdx]);
  const metrics = useMemo(() => metricsFor(active, conflicts), [active, conflicts]);
  const before = useMemo(() => metricsFor([A, B], detectTwinConflicts([A, B])), [A, B]);
  const afterList = rec ? [A, { ...B, start: rec.to.start, end: rec.to.end }].filter((e) => covers(e, SCENARIO_DATE)) : [A];
  const after = useMemo(() => metricsFor(afterList, detectTwinConflicts(afterList)), [rec]); // eslint-disable-line react-hooks/exhaustive-deps

  // push state into the 3D scene
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const assignment = assignTwin(closuresOf(active));
    s.setState({
      active,
      assignment,
      vcByRoad: roadVc(assignment),
      affected: metrics.affectedRoadIds,
      conflictRoads: conflicts.flatMap((c) => c.projectIds.map((id) => excavations.find((e) => e.id === id)!.roadId)),
      recommendedRoads: applied && !compare ? ['B-0', 'B-1', 'B-2', 'B-3'] : [],
    });
  }, [active, conflicts, metrics, applied, compare, excavations]);

  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    s.paused = !started || paused;
    s.speed = speed;
  }, [started, paused, speed]);
  useEffect(() => sceneRef.current?.setToggles(toggles), [toggles]);

  const view = (v: CameraView) => sceneRef.current?.setView(v);
  const resetAll = () => {
    setAOn(false);
    setBOn(false);
    setDetected(false);
    setRec(null);
    setApplied(false);
    setCompare(false);
    setHistIdx(null);
    setStarted(true);
    setPaused(false);
    view('aerial');
  };
  const detect = () => {
    setDetected(true);
    const c = detectTwinConflicts([A, B].filter((e) => (e.id === 'EXC-A' ? aOn : bOn)));
    if (c[0]) setRec(recommend(excavations, c[0]));
  };
  const apply = () => {
    const c = detectTwinConflicts([A, B]);
    const r = rec ?? (c[0] ? recommend(excavations, c[0]) : null);
    if (!r) return;
    setRec(r);
    setApplied(true);
    setCompare(false);
  };

  // ── guided demo (≈ 75 s) ──
  const DEMO: { title: string; body: string; ms: number; run: () => void }[] = [
    { title: 'حركة طبيعية', body: 'خمسة مربعات مستوحاة من حي النخيل: الطريق الرئيسي، الشارع البديل، والجسر. الحركة منسابة.', ms: 8000, run: () => (resetAll(), view('aerial')) },
    { title: 'الحفرية أ — الطريق الرئيسي', body: 'مرفق المياه يغلق مسارين من ثلاثة على طريق الأمير تركي الأول: الحركة تتباطأ وجزء منها يتحوّل إلى شارع النخيل.', ms: 11000, run: () => (setAOn(true), setTimeout(() => view('construction'), 50)) },
    { title: 'الحفرية ب — مسار التحويل نفسه', body: 'مزود اتصالات يخطط — بشكل مستقل — لإغلاق مسار على شارع النخيل في نفس الأسبوع.', ms: 10000, run: () => (setBOn(true), view('aerial')) },
    { title: 'رصد يكشف التعارض', body: 'التداخل الزمني + الطريق المغلق هو بديل الآخر ⇒ تعارض مسار التحويل، مع تقدير الزيادة في الازدحام.', ms: 12000, run: () => detect() },
    { title: 'توصية رصد', body: 'تأخير الموعد حسب الأولوية: تأجيل الحفرية ب لتبدأ بعد انتهاء أ، فيبقى شارع النخيل مفتوحاً.', ms: 10000, run: () => detect() },
    { title: 'تطبيق التوصية', body: 'يُعاد جدولة الحفرية ب؛ يعود المسار البديل متاحاً (بالأخضر) وتنساب الحركة المحوّلة.', ms: 12000, run: () => apply() },
    { title: 'قبل / بعد', body: 'مقارنة الحالتين بنفس الطلب المروري: الازدحام، تأخير الرحلة، والطرق المتأثرة — تقديرات نموذجية.', ms: 12000, run: () => setCompare(true) },
  ];
  useEffect(() => {
    if (!demo) return;
    DEMO[demo.step].run();
    if (!demo.playing || demo.step >= DEMO.length - 1) return;
    const t = setTimeout(() => setDemo((d) => (d ? { ...d, step: d.step + 1 } : d)), DEMO[demo.step].ms);
    return () => clearTimeout(t);
  }, [demo?.step, demo?.playing]); // eslint-disable-line react-hooks/exhaustive-deps

  const Btn = ({ onClick, children, active: on, testid, disabled }: { onClick: () => void; children: React.ReactNode; active?: boolean; testid?: string; disabled?: boolean }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      className={cn('flex h-8 items-center gap-1.5 rounded-lg border px-2 text-[11.5px] transition active:scale-[0.97] disabled:opacity-35', on ? 'border-violet-400/60 bg-violet-500/20 text-white' : 'border-white/10 bg-white/[0.03] text-slate-200 hover:border-violet-400/40')}
    >
      {children}
    </button>
  );

  const status = histIdx !== null ? `السجل: ${history[histIdx].labelAr}` : compare ? `المقارنة — ${compareView === 'before' ? 'قبل' : 'بعد'}` : applied ? 'بعد تطبيق توصية رصد' : detected && conflicts.length ? 'تعارض مكتشف' : aOn || bOn ? 'أعمال حفر نشطة' : 'حركة طبيعية';

  return (
    <div className="relative h-full w-full" data-testid="twin-page">
      <div ref={hostRef} className="absolute inset-0" data-testid="twin-canvas" />

      {/* header */}
      <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start gap-2">
        <div className="glass pointer-events-auto rounded-xl px-3 py-2">
          <div className="text-[13px] font-bold">رصد — النموذج ثلاثي الأبعاد (٥ مربعات)</div>
          <div className="text-[10.5px] text-slate-400">
            {PROTOTYPE_LABEL_AR} · {PROTOTYPE_LABEL_EN}
          </div>
        </div>
        <div className="glass pointer-events-auto rounded-xl px-3 py-2 text-[11px]">
          <span className="rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 font-semibold text-amber-300" data-testid="twin-demo-data">
            {source.synthetic ? 'DEMO DATA / SIMULATED' : source.name}
          </span>
          <span className={cn('mr-2', kit === 'loaded' ? 'text-emerald-300' : 'text-slate-400')} data-testid="twin-kit-status">
            {kit === 'loaded' ? 'مشهد KitBash3D من Blender محمّل' : kit === 'missing' ? 'مبانٍ وجسر مؤقتة — بانتظار ملفات KitBash3D' : '…'}
          </span>
        </div>
        <div className="glass pointer-events-auto mr-auto rounded-xl px-3 py-2 text-[12px] font-semibold" data-testid="twin-status">
          {status}
        </div>
      </div>

      {/* controls (start side) */}
      <div className="glass scroll-thin absolute bottom-24 right-3 top-[76px] w-[250px] space-y-3 overflow-y-auto rounded-2xl p-3" data-testid="twin-controls">
        <Section title="المحاكاة">
          <Btn onClick={() => (setStarted(true), setPaused(false))} active={started && !paused} testid="tw-start">
            <Play size={13} /> {started ? 'استئناف' : 'بدء المحاكاة'}
          </Btn>
          <Btn onClick={() => setPaused(true)} active={paused} testid="tw-pause" disabled={!started}>
            <Pause size={13} /> إيقاف مؤقت
          </Btn>
          <Btn onClick={resetAll} testid="tw-reset">
            <RotateCcw size={13} /> إعادة ضبط
          </Btn>
          <div className="col-span-2 flex items-center gap-1 text-[11px]">
            السرعة
            {[0.5, 1, 2, 4].map((s) => (
              <button key={s} onClick={() => setSpeed(s)} className={cn('num rounded px-1.5 py-0.5', speed === s ? 'bg-violet-500/30 text-white' : 'text-slate-400')} data-testid={`tw-speed-${s}`}>
                {s}×
              </button>
            ))}
          </div>
        </Section>
        <Section title="السيناريو">
          <Btn onClick={resetAll} active={!aOn && !bOn && !compare && histIdx === null} testid="tw-normal">
            <Route size={13} /> حركة طبيعية
          </Btn>
          <Btn onClick={() => (setAOn(true), setHistIdx(null), setCompare(false), setStarted(true))} active={aOn} testid="tw-exc-a">
            <Construction size={13} /> تفعيل الحفرية أ
          </Btn>
          <Btn onClick={() => (setBOn(true), setHistIdx(null), setCompare(false), setStarted(true))} active={bOn && !applied} testid="tw-exc-b">
            <TrafficCone size={13} /> تفعيل الحفرية ب
          </Btn>
          <Btn onClick={detect} active={detected} testid="tw-detect" disabled={!aOn || !bOn}>
            <Radar size={13} /> كشف التعارض
          </Btn>
          <Btn onClick={apply} active={applied} testid="tw-apply" disabled={!detected || !conflicts.length && !applied}>
            <Sparkles size={13} /> تطبيق توصية رصد
          </Btn>
          <Btn onClick={() => (setCompare(!compare), setHistIdx(null))} active={compare} testid="tw-compare" disabled={!rec}>
            <GitCompareArrows size={13} /> قبل / بعد
          </Btn>
        </Section>
        <Section title="الخريطة">
          <Btn onClick={() => sceneRef.current?.zoom(0.75)} testid="tw-zoom-in">
            <Plus size={13} /> تكبير
          </Btn>
          <Btn onClick={() => sceneRef.current?.zoom(1.33)} testid="tw-zoom-out">
            <Minus size={13} /> تصغير
          </Btn>
          <Btn onClick={() => sceneRef.current?.rotate(Math.PI / 8)} testid="tw-rotate">
            <RotateCw size={13} /> تدوير
          </Btn>
          <Btn onClick={() => view('aerial')} testid="tw-reset-cam">
            <Camera size={13} /> إعادة الكاميرا
          </Btn>
          <Btn onClick={() => view('construction')} testid="tw-focus" disabled={!active.length}>
            <Construction size={13} /> التركيز على الحفرية
          </Btn>
          <Btn onClick={() => setToggles((t) => ({ ...t, traffic: !t.traffic }))} active={toggles.traffic} testid="tw-tg-traffic">
            <Eye size={13} /> الحركة
          </Btn>
          <Btn onClick={() => setToggles((t) => ({ ...t, construction: !t.construction }))} active={toggles.construction} testid="tw-tg-construction">
            <Square size={13} /> مناطق العمل
          </Btn>
          <Btn onClick={() => setToggles((t) => ({ ...t, routes: !t.routes }))} active={toggles.routes} testid="tw-tg-routes">
            <Route size={13} /> المسارات
          </Btn>
        </Section>
        <Section title="الكاميرا">
          <Btn onClick={() => view('aerial')} testid="tw-cam-aerial">
            <Box size={13} /> منظور جوي
          </Btn>
          <Btn onClick={() => view('street')} testid="tw-cam-street">
            <Eye size={13} /> مستوى الشارع
          </Btn>
          <Btn onClick={() => view('bridge')} testid="tw-cam-bridge">
            <Route size={13} /> منظر الجسر
          </Btn>
          <Btn onClick={() => view('construction')} testid="tw-cam-construction" disabled={!active.length}>
            <Construction size={13} /> موقع الحفر
          </Btn>
        </Section>
        <button onClick={() => setDemo({ step: 0, playing: true })} className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#6c5dd3] text-[13px] font-semibold text-white" data-testid="tw-guided">
          <Sparkles size={15} /> بدء العرض الموجّه
        </button>
      </div>

      {/* intelligence panel (end side) */}
      <div className="glass scroll-thin absolute bottom-24 left-3 top-[76px] w-[300px] overflow-y-auto rounded-2xl p-3" data-testid="twin-intel">
        <div className="mb-2 text-[13px] font-semibold text-violet-200">لوحة ذكاء رصد</div>
        <div className="grid grid-cols-2 gap-1.5">
          <KV k="حفريات نشطة" v={metrics.activeExcavations} testid="m-exc" />
          <KV k="إغلاقات طرق" v={metrics.activeClosures} testid="m-clo" />
          <KV k="تعارضات مكتشفة" v={metrics.detectedConflicts} tone={metrics.detectedConflicts ? 'text-red-300' : undefined} testid="m-conf" />
          <KV k="مركبات محوّلة/ساعة" v={fmtNum(metrics.reroutedVehPerHour)} testid="m-rer" />
          <KV k="مؤشر الازدحام (V/C)" v={`${metrics.congestionIndex}%`} tone={metrics.maxVc > 1.3 ? 'text-red-300' : metrics.maxVc > 1 ? 'text-amber-300' : 'text-emerald-300'} testid="m-cong" />
          <KV k="زمن رحلة المحور" v={`${fmtNum(metrics.corridorTripMin, 2)} د`} sub={`طبيعي ${fmtNum(metrics.corridorTripMinNormal, 2)} د`} testid="m-trip" />
          <KV k="تأخير المركبات" v={fmtNum(metrics.delayVehHours)} sub="مركبة-ساعة/ساعة ذروة" testid="m-delay" />
          <KV k="متوسط التأخير/رحلة" v={`${fmtNum(metrics.avgDelayMin * 60)} ث`} testid="m-avg" />
        </div>
        <div className="mt-2 text-[10.5px] text-slate-500">جميع الأرقام تقديرات من نموذج محاكاة محلي (طلب مروري تركيبي) — ليست قياسات حقيقية.</div>
        <div className="mt-3 text-[11.5px] font-semibold text-slate-300">الطرق المتأثرة</div>
        <div className="mt-1 flex flex-wrap gap-1" data-testid="m-affected">
          {[...new Set(metrics.affectedRoadIds.map(roadName))].map((n) => (
            <span key={n} className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10.5px] text-red-200">
              {n}
            </span>
          ))}
          {!metrics.affectedRoadIds.length && <span className="text-[11px] text-slate-500">لا يوجد</span>}
        </div>
        {conflicts.map((c) => (
          <div key={c.id} className="mt-3 rounded-xl border border-red-400/40 bg-red-500/10 p-2.5 text-[11.5px]" data-testid="tw-conflict-card">
            <div className="flex items-center gap-1.5 font-semibold text-red-200">
              <AlertTriangle size={14} /> تعارض مسار التحويل
            </div>
            <div className="mt-1 leading-relaxed text-slate-200">{c.explanationAr}</div>
            <div className="num mt-1 text-slate-400">
              تداخل {c.overlapDays} يوم ({c.overlapStart} → {c.overlapEnd}) · تحويل ~{fmtNum(c.divertedVehPerHour)} مركبة/ساعة · زيادة الازدحام المقدرة +{c.congestionIncreasePct}%
            </div>
          </div>
        ))}
        <div className="mt-3 rounded-xl border border-violet-400/30 bg-violet-500/[0.07] p-2.5 text-[11.5px]" data-testid="tw-recommendation">
          <div className="font-semibold text-violet-200">الإجراء الموصى به</div>
          {rec ? (
            <>
              <div className="mt-1 text-slate-200">{rec.titleAr}</div>
              <div className="mt-1 leading-relaxed text-slate-300">{rec.reasonAr}</div>
              <div className="num mt-1 text-slate-400">
                {rec.projectId}: {rec.from.start}→{rec.from.end} ⟵ <span className="text-emerald-300">{rec.to.start}→{rec.to.end}</span>
              </div>
              {applied && (
                <div className="mt-1 flex items-center gap-1 text-emerald-300">
                  <CheckCircle2 size={13} /> طُبِّقت — شارع النخيل متاح كمسار بديل
                </div>
              )}
            </>
          ) : (
            <div className="mt-1 text-slate-400">لا توجد توصية — فعّل الحفريتين ثم «كشف التعارض».</div>
          )}
        </div>
        {compare && (
          <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-2.5 text-[11.5px]" data-testid="tw-compare-table">
            <div className="mb-1 flex items-center justify-between font-semibold">
              قبل / بعد التوصية
              <div className="flex rounded bg-white/5 p-0.5 text-[10.5px]">
                {(['before', 'after'] as const).map((v) => (
                  <button key={v} onClick={() => setCompareView(v)} className={cn('rounded px-1.5', compareView === v ? 'bg-violet-500/30' : 'text-slate-400')} data-testid={`tw-view-${v}`}>
                    {v === 'before' ? 'عرض قبل' : 'عرض بعد'}
                  </button>
                ))}
              </div>
            </div>
            <table className="w-full">
              <tbody className="num">
                {(
                  [
                    ['التعارضات', before.detectedConflicts, after.detectedConflicts, 0],
                    ['إغلاقات متزامنة', before.activeClosures, after.activeClosures, 0],
                    ['مؤشر الازدحام %', before.congestionIndex, after.congestionIndex, 0],
                    ['زمن رحلة المحور (د)', before.corridorTripMin, after.corridorTripMin, 2],
                    ['تأخير المركبات (م-س)', before.delayVehHours, after.delayVehHours, 0],
                  ] as const
                ).map(([k, b, a, d]) => (
                  <tr key={k} className="border-t border-white/5">
                    <td className="py-1 text-slate-300">{k}</td>
                    <td className="text-slate-500">{fmtNum(b, d)}</td>
                    <td className={a < b ? 'text-emerald-300' : a > b ? 'text-red-300' : ''}>{fmtNum(a, d)}</td>
                    <td className="text-[10px] text-slate-500">{b ? `${fmtNum(((a - b) / b) * 100, 0)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* historical replay */}
      <div className="glass absolute bottom-3 left-3 right-3 flex items-center gap-3 rounded-xl px-3 py-2" data-testid="tw-history">
        <button onClick={() => setHistIdx(histIdx === null ? 0 : null)} className={cn('flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px]', histIdx !== null ? 'bg-violet-500/25 text-white' : 'text-slate-300')} data-testid="tw-history-toggle">
          <History size={14} /> وضع السجل
        </button>
        <input type="range" min={0} max={history.length - 1} value={histIdx ?? 0} disabled={histIdx === null} onChange={(e) => setHistIdx(Number(e.target.value))} className="flex-1" aria-label="السجل الزمني" data-testid="tw-history-slider" />
        <div className="num w-56 text-[11.5px] text-slate-300">{histIdx !== null ? `${history[histIdx].at} — ${history[histIdx].labelAr}` : 'طوابع زمنية تركيبية'}</div>
      </div>

      {/* guided demo */}
      {demo && (
        <div className="glass-strong absolute bottom-20 left-1/2 w-[520px] -translate-x-1/2 rounded-2xl p-4" data-testid="tw-guided-card">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-violet-300">
            <Sparkles size={13} /> العرض الموجّه · {demo.step + 1}/{DEMO.length}
            <button className="mr-auto text-slate-400 hover:text-white" onClick={() => setDemo(null)} data-testid="tw-guided-close">
              إغلاق
            </button>
          </div>
          <div className="mt-2 flex gap-1">
            {DEMO.map((_, i) => (
              <span key={i} className={cn('h-1 flex-1 rounded-full', i <= demo.step ? 'bg-violet-400' : 'bg-white/10')} />
            ))}
          </div>
          <div className="mt-2 text-[15px] font-semibold" data-testid="tw-guided-title">
            {DEMO[demo.step].title}
          </div>
          <div className="mt-1 text-[12.5px] leading-relaxed text-slate-300">{DEMO[demo.step].body}</div>
          <div className="mt-3 flex gap-1.5">
            <Btn onClick={() => setDemo({ ...demo, playing: !demo.playing })} testid="tw-guided-pause">
              {demo.playing ? <Pause size={13} /> : <Play size={13} />} {demo.playing ? 'إيقاف مؤقت' : 'متابعة'}
            </Btn>
            <Btn onClick={() => setDemo({ ...demo, step: Math.min(DEMO.length - 1, demo.step + 1) })} testid="tw-guided-skip">
              <SkipForward size={13} /> تخطي
            </Btn>
            <Btn onClick={() => setDemo({ step: 0, playing: true })} testid="tw-guided-restart">
              <RotateCcw size={13} /> من البداية
            </Btn>
            <ChevronLeft className="hidden" />
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold text-slate-400">{title}</div>
      <div className="grid grid-cols-2 gap-1.5">{children}</div>
    </div>
  );
}

function KV({ k, v, sub, tone, testid }: { k: string; v: React.ReactNode; sub?: string; tone?: string; testid?: string }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.03] p-2">
      <div className="text-[10.5px] text-slate-400">{k}</div>
      <div className={cn('num text-[15px] font-semibold', tone)} data-testid={testid}>
        {v}
      </div>
      {sub && <div className="text-[9.5px] text-slate-500">{sub}</div>}
    </div>
  );
}
