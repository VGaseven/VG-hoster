import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Columns2, GitCompareArrows, Pause, Play, SlidersHorizontal, Sparkles, Table2 } from 'lucide-react';
import type { ScenarioMetrics } from '@/types';
import { useStore, simDayOf, simHourOf } from '@/store/store';
import { beforeProjects, getMetrics } from '@/store/derived';
import { SimMap } from '@/components/map/SimMap';
import type { RasdMap } from '@/components/map/RasdMap';
import { Button, SimBadge } from '@/components/ui/ui';
import { fmtNum, fmtSar, pctChange, cn } from '@/utils/format';
import { HORIZON_DAYS, fmtDate, fmtHour, isoFromDay } from '@/utils/date';
import { STUDY_AREA_VIEW } from '@/data/network';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';

type Mode = 'split' | 'slider' | 'metrics';

export function ComparePage() {
  const all = useStore((s) => s.projects);
  const economics = useStore((s) => s.economics);
  const simTime = useStore((s) => s.simTime);
  const setSimTime = useStore((s) => s.setSimTime);
  const playing = useStore((s) => s.playing);
  const togglePlay = useStore((s) => s.togglePlay);
  const [mode, setMode] = useState<Mode>('split');
  const [slider, setSlider] = useState(50);
  const before = beforeProjects(all);
  const mB = useMemo(() => getMetrics(before, economics), [before, economics]);
  const mA = useMemo(() => getMetrics(all, economics), [all, economics]);
  const day = simDayOf(simTime);
  const hour = simHourOf(simTime);
  const maps = useRef<{ a?: RasdMap; b?: RasdMap }>({});
  const syncing = useRef(false);
  const decisions = useStore((s) => s.audit.filter((a) => a.action === 'approve_option').length);

  const link = (which: 'a' | 'b') => (m: RasdMap) => {
    maps.current[which] = m;
    m.map.on('move', () => {
      if (syncing.current) return;
      const other = maps.current[which === 'a' ? 'b' : 'a'];
      if (!other) return;
      syncing.current = true;
      other.jumpTo(m.getCamera());
      syncing.current = false;
    });
  };

  const animateTransition = () => {
    setMode('slider');
    let v = 0;
    const id = setInterval(() => {
      v += 2;
      setSlider(v);
      if (v >= 100) clearInterval(id);
    }, 30);
  };

  return (
    <div className="flex h-full flex-col" data-testid="compare-page">
      <header className="flex flex-wrap items-center gap-3 border-b border-white/6 px-5 py-3">
        <h1 className="flex items-center gap-2 text-base font-semibold">
          <GitCompareArrows size={18} className="text-cyan-300" /> قبل التنسيق / بعد التنسيق
        </h1>
        <SimBadge />
        <div className="flex rounded-lg bg-white/5 p-0.5 text-[12px]">
          {(
            [
              ['split', 'شاشة مقسومة', Columns2],
              ['slider', 'شريط مقارنة', SlidersHorizontal],
              ['metrics', 'المؤشرات', Table2],
            ] as const
          ).map(([k, l, I]) => (
            <button key={k} onClick={() => setMode(k)} className={cn('flex h-7 items-center gap-1.5 rounded-md px-2.5', mode === k ? 'bg-cyan-400/20 text-cyan-100' : 'text-slate-400')} data-testid={`mode-${k}`}>
              <I size={13} /> {l}
            </button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={animateTransition}>
          <Sparkles size={14} /> انتقال متحرك
        </Button>
        <div className="mr-auto flex items-center gap-2 text-[12px]" dir="ltr">
          <button onClick={togglePlay} className="grid h-8 w-8 place-items-center rounded-lg bg-cyan-400 text-slate-950" aria-label="تشغيل">
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <input type="range" min={0} max={HORIZON_DAYS - 0.01} step={0.01} value={simTime} onChange={(e) => setSimTime(Number(e.target.value))} className="w-56" aria-label="الزمن" />
          <span className="num w-36 text-slate-300" dir="rtl">
            {fmtDate(isoFromDay(day))} {fmtHour(hour)}
          </span>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {mode !== 'metrics' ? (
            mode === 'split' ? (
              <div className="grid h-full grid-cols-2 gap-px bg-white/10" dir="ltr">
                <MapPane title="قبل التنسيق" tone="amber" m={mB}>
                  <SimMap projects={before} day={day} hour={hour} onReady={link('b')} initialView={STUDY_AREA_VIEW} testid="map-before" />
                </MapPane>
                <MapPane title="بعد التنسيق" tone="emerald" m={mA}>
                  <SimMap projects={all} day={day} hour={hour} onReady={link('a')} initialView={STUDY_AREA_VIEW} testid="map-after" />
                </MapPane>
              </div>
            ) : (
              <div className="relative h-full" dir="ltr">
                <div className="absolute inset-0">
                  <SimMap projects={all} day={day} hour={hour} onReady={link('a')} initialView={STUDY_AREA_VIEW} testid="map-after" />
                </div>
                <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - slider}% 0 0)` }}>
                  <SimMap projects={before} day={day} hour={hour} onReady={link('b')} initialView={STUDY_AREA_VIEW} testid="map-before" />
                </div>
                <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-cyan-300 shadow-[0_0_14px_#22d3ee]" style={{ left: `${slider}%` }} />
                <input type="range" min={0} max={100} value={slider} onChange={(e) => setSlider(Number(e.target.value))} className="absolute bottom-6 left-1/2 w-1/2 -translate-x-1/2" aria-label="شريط المقارنة" data-testid="compare-slider" />
                <span className="glass absolute left-3 top-3 rounded-lg px-2.5 py-1 text-[12px] text-amber-200">قبل التنسيق</span>
                <span className="glass absolute right-3 top-3 rounded-lg px-2.5 py-1 text-[12px] text-emerald-200">بعد التنسيق</span>
              </div>
            )
          ) : (
            <DailyChart before={mB} after={mA} />
          )}
        </div>
        <aside className="scroll-thin w-[360px] shrink-0 overflow-y-auto border-r border-white/6 p-4">
          <MetricsTable before={mB} after={mA} />
          <div className="mt-4 rounded-xl bg-white/[0.03] p-3 text-[11px] leading-relaxed text-slate-500">
            كلا العرضين يستخدمان نفس الطلب المروري، ونفس الشبكة، ونفس دالة BPR، ونفس افتراضات الأثر الاقتصادي. الفرق الوحيد هو جدول التنفيذ. «قبل» = الجداول المقترحة أصلاً من الجهات؛ «بعد» = الجداول بعد القرارات المعتمدة ({decisions} قرار).
          </div>
        </aside>
      </div>
    </div>
  );
}

function MapPane({ title, tone, m, children }: { title: string; tone: 'amber' | 'emerald'; m: ScenarioMetrics; children: React.ReactNode }) {
  return (
    <div className="relative min-h-0">
      {children}
      <div className={cn('glass pointer-events-none absolute right-3 top-3 rounded-xl px-3 py-2 text-[12px]', tone === 'amber' ? 'text-amber-100' : 'text-emerald-100')} dir="rtl">
        <div className="font-semibold">{title}</div>
        <div className="mt-0.5 text-slate-300">
          تعارضات <span className="num">{m.conflicts}</span> · تأخير <span className="num">{fmtNum(m.vehicleHoursDelay)}</span> م-س
        </div>
      </div>
    </div>
  );
}

function MetricsTable({ before, after }: { before: ScenarioMetrics; after: ScenarioMetrics }) {
  const rows: [string, number, number, boolean, (n: number) => string][] = [
    ['التعارضات', before.conflicts, after.conflicts, true, (n) => fmtNum(n)],
    ['تعارضات مرتفعة', before.highConflicts, after.highConflicts, true, (n) => fmtNum(n)],
    ['أيام إغلاق المقاطع', before.closureSegmentDays, after.closureSegmentDays, true, (n) => fmtNum(n)],
    ['أيام فيها إغلاق', before.closureDays, after.closureDays, true, (n) => fmtNum(n)],
    ['تأخير المركبات (م-س)', before.vehicleHoursDelay, after.vehicleHoursDelay, true, (n) => fmtNum(n)],
    ['مسافة التحويل (م-كم)', before.detourVehicleKm, after.detourVehicleKm, true, (n) => fmtNum(n)],
    ['مؤشر الوصول (متوسط)', before.accessibilityScore, after.accessibilityScore, false, (n) => fmtNum(n, 1)],
    ['أسوأ يوم للوصول', before.worstAccessibility, after.worstAccessibility, false, (n) => fmtNum(n, 1)],
    ['الأثر الاقتصادي', before.economicCostSar, after.economicCostSar, true, (n) => fmtSar(n)],
  ];
  return (
    <div data-testid="compare-metrics">
      <div className="mb-2 text-[13px] font-semibold">المؤشرات المحسوبة من النموذج</div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-slate-500">
            <th className="py-1 text-right font-medium">المؤشر</th>
            <th className="py-1 text-right font-medium text-amber-300/80">قبل</th>
            <th className="py-1 text-right font-medium text-emerald-300/80">بعد</th>
            <th className="py-1 text-right font-medium">التغير</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, b, a, lower, f]) => {
            const pc = pctChange(b, a);
            const better = lower ? a < b - 1e-9 : a > b + 1e-9;
            const worse = lower ? a > b + 1e-9 : a < b - 1e-9;
            return (
              <motion.tr key={k} layout className="border-t border-white/5">
                <td className="py-1.5 text-slate-300">{k}</td>
                <td className="num py-1.5 text-slate-400">{f(b)}</td>
                <td className="num py-1.5 text-slate-100">{f(a)}</td>
                <td className={cn('num py-1.5 font-semibold', better ? 'text-emerald-400' : worse ? 'text-red-400' : 'text-slate-500')} data-testid={`delta-${k}`}>
                  {pc === null ? (a === b ? '—' : f(a - b)) : `${pc > 0 ? '+' : ''}${fmtNum(pc, 1)}%`}
                </td>
              </motion.tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DailyChart({ before, after }: { before: ScenarioMetrics; after: ScenarioMetrics }) {
  const data = before.daily.map((d, i) => ({ date: d.date.slice(5), before: Math.round(d.vehicleHoursDelay), after: Math.round(after.daily[i]?.vehicleHoursDelay ?? 0) }));
  const [w, setW] = useState(0);
  useEffect(() => setW(1), []);
  return (
    <div className="h-full p-6" dir="ltr">
      <div className="mb-2 text-right text-sm font-semibold" dir="rtl">
        تأخير المركبات اليومي (مركبة-ساعة) — قبل وبعد التنسيق
      </div>
      {w > 0 && (
        <ResponsiveContainer width="100%" height="90%">
          <LineChart data={data}>
            <CartesianGrid stroke="#1e293b" />
            <XAxis dataKey="date" stroke="#64748b" fontSize={11} interval={6} />
            <YAxis stroke="#64748b" fontSize={11} />
            <Tooltip contentStyle={{ background: '#0a1220', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
            <Legend />
            <Line type="monotone" dataKey="before" name="قبل" stroke="#f59e0b" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="after" name="بعد" stroke="#34d399" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
