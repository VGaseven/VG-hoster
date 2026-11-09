import { useMemo } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, Download, FileJson, Landmark, ShieldAlert, ShieldCheck, Timer, Route, Coins, CalendarCheck2, History } from 'lucide-react';
import { useStore } from '@/store/store';
import { actionable, beforeProjects, getConflicts, getMetrics } from '@/store/derived';
import { CATEGORIES, ORGANIZATIONS } from '@/data/organizations';
import { SCENARIOS } from '@/data/projects';
import { ZONES } from '@/data/network';
import { SEVERITY_LABELS } from '@/engine/conflicts/detect';
import { economicCost, ECONOMIC_FORMULA_AR } from '@/engine/economics/economics';
import { assign, zoneAccessibility } from '@/engine/traffic/assignment';
import { effectsAt } from '@/engine/traffic/effects';
import { closureLine } from '@/engine/spatial/geometry';
import { Button, Panel, SectionTitle, SimBadge, Stat, Toggle } from '@/components/ui/ui';
import { fmtNum, fmtSar, cn } from '@/utils/format';
import { HORIZON_DAYS, fmtDate } from '@/utils/date';
import { metricsCsv } from '@/utils/export';
import type { Project } from '@/types';

const tip = { contentStyle: { background: '#0a1220', border: '1px solid #334155', borderRadius: 8, fontSize: 12, direction: 'rtl' as const }, itemStyle: { color: '#e2e8f0' } };

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function AnalyticsPage() {
  const projects = useStore((s) => s.projects);
  const economics = useStore((s) => s.economics);
  const setEconomics = useStore((s) => s.setEconomics);
  const audit = useStore((s) => s.audit);
  const before = beforeProjects(projects);
  const mA = useMemo(() => getMetrics(projects, economics), [projects, economics]);
  const mB = useMemo(() => getMetrics(before, economics), [before, economics]);
  const cA = actionable(getConflicts(projects));
  const cB = actionable(getConflicts(before));
  const resolved = cB.filter((c) => !cA.some((x) => x.id === c.id)).length;
  const approved = projects.filter((p) => p.status === 'approved' || p.status === 'scheduled').length;

  const byOrg = Object.entries(ORGANIZATIONS).map(([k, o]) => ({ name: o.short, value: projects.filter((p) => p.orgId === k).length, color: o.color }));
  const byCat = Object.entries(CATEGORIES)
    .map(([k, c]) => ({ name: c.ar, value: projects.filter((p) => p.category === k).length }))
    .filter((x) => x.value > 0);
  const bySev = (['high', 'medium', 'low'] as const).map((s) => ({ name: SEVERITY_LABELS[s].ar, before: cB.filter((c) => c.severity === s).length, after: cA.filter((c) => c.severity === s).length }));
  const closuresByDate = mB.daily.map((d, i) => ({ date: d.date.slice(5), before: d.closedSegments, after: mA.daily[i].closedSegments }));
  const impact = [
    { name: 'التأخير (ألف م-س)', before: mB.vehicleHoursDelay / 1000, after: mA.vehicleHoursDelay / 1000 },
    { name: 'التحويل (ألف م-كم)', before: mB.detourVehicleKm / 1000, after: mA.detourVehicleKm / 1000 },
    { name: 'أيام إغلاق المقاطع', before: mB.closureSegmentDays, after: mA.closureSegmentDays },
    { name: 'التعارضات', before: mB.conflicts, after: mA.conflicts },
  ];
  const hood = useMemo(() => {
    const calc = (ps: Project[]) =>
      ZONES.map((z) => {
        let s = 0;
        for (let d = 0; d < HORIZON_DAYS; d++) s += 100 - zoneAccessibility(assign(effectsAt(ps, d, 8), 3), z.id);
        return s / HORIZON_DAYS;
      });
    const b = calc(before);
    const a = calc(projects);
    return ZONES.map((z, i) => ({ name: z.name, before: +b[i].toFixed(2), after: +a[i].toFixed(2) }));
  }, [projects, before]);
  const scen = SCENARIOS.map((s) => {
    const inS = (c: { projectIds: string[] }) => c.projectIds.every((id) => (s.projectIds as readonly string[]).includes(id));
    return { name: s.id, title: s.titleAr, before: cB.filter(inS).length, after: cA.filter(inS).length };
  });
  const econ = economicCost(mA.vehicleHoursDelay, mA.detourVehicleKm, economics);
  const econB = economicCost(mB.vehicleHoursDelay, mB.detourVehicleKm, economics);

  const exportJson = () =>
    download(
      'rasd-scenario-metrics.json',
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          disclaimer: 'Synthetic demonstration data. Traffic and economic values are model estimates, not real telemetry or official statistics.',
          assumptions: economics,
          before: { ...mB },
          after: { ...mA },
          projects: projects.map((p) => ({ ...p, geometry: { type: 'MultiLineString', coordinates: p.closures.map((c) => closureLine(c).geometry.coordinates) } })),
          conflicts: cA,
          audit,
        },
        null,
        2,
      ),
      'application/json',
    );

  return (
    <div className="scroll-thin h-full overflow-y-auto p-6" data-testid="analytics-page">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <BarChart3 className="text-violet-300" /> لوحة مؤشرات الأثر
        </h1>
        <SimBadge />
        <div className="mr-auto flex gap-2">
          <Button variant="outline" onClick={() => download('rasd-scenario-metrics.csv', metricsCsv(mB, mA, projects), 'text/csv;charset=utf-8')} data-testid="export-csv" data-tour="export">
            <Download size={15} /> تصدير CSV
          </Button>
          <Button variant="outline" onClick={exportJson} data-testid="export-json">
            <FileJson size={15} /> تصدير JSON
          </Button>
        </div>
      </div>
      <div className="mb-3 grid gap-3 md:grid-cols-3" data-testid="analytics-outcomes">
        {(
          [
            ['إغلاقات أقل تكراراً', 'مرات إغلاق المقاطع (إغلاقات متكررة)', `${fmtNum(mB.closureEpisodes)} (${mB.repeatedClosures})`, `${fmtNum(mA.closureEpisodes)} (${mA.repeatedClosures})`, mA.closureEpisodes <= mB.closureEpisodes],
            ['أثر أخف على الحركة', 'كم-يوم مغلق · التعارضات', `${fmtNum(mB.closureKmDays, 1)} · ${mB.conflicts}`, `${fmtNum(mA.closureKmDays, 1)} · ${mA.conflicts}`, mA.closureKmDays <= mB.closureKmDays],
            ['استعداد أفضل لمستخدم الطريق', 'نسبة الإغلاقات المعلنة قبل يوم الرحلة', `${fmtNum(mB.visibleClosureShare)}%`, `${fmtNum(mA.visibleClosureShare)}%`, mA.visibleClosureShare >= mB.visibleClosureShare],
          ] as const
        ).map(([t, h, b, a, good]) => (
          <Panel key={t} className="p-4">
            <div className="text-[13px] font-semibold text-violet-200">{t}</div>
            <div className="text-[11px] text-slate-500">{h}</div>
            <div className="num mt-2 text-lg">
              <span className="text-slate-500">{b}</span> <span className="text-slate-600">→</span> <b className={good ? 'text-emerald-300' : 'text-red-300'}>{a}</b>
            </div>
            <div className="text-[10.5px] text-slate-500">الخطة الأصلية → الخطة الحالية</div>
          </Panel>
        ))}
      </div>
      <div className="mb-2 text-[12px] font-semibold text-slate-400">مؤشرات تشغيلية ومُنمذجة مساندة</div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="المشاريع المسجلة" value={projects.length} icon={<Landmark size={12} />} />
        <Stat label="إغلاقات مخططة نشطة" value={projects.filter((p) => p.status !== 'rejected').length} icon={<CalendarCheck2 size={12} />} />
        <Stat label="تعارضات مكتشفة" value={cA.length} tone="text-red-300" icon={<ShieldAlert size={12} />} sub={`قبل التنسيق: ${cB.length}`} />
        <Stat label="تعارضات محلولة" value={resolved} tone="text-emerald-300" icon={<ShieldCheck size={12} />} />
        <Stat label="جداول معتمدة" value={approved} icon={<CalendarCheck2 size={12} />} />
        <Stat label="أيام إغلاق المقاطع" value={fmtNum(mA.closureSegmentDays)} sub={`قبل: ${fmtNum(mB.closureSegmentDays)}`} icon={<CalendarCheck2 size={12} />} />
        <Stat label="تأخير المركبات" value={fmtNum(mA.vehicleHoursDelay)} sub={`مركبة-ساعة · قبل: ${fmtNum(mB.vehicleHoursDelay)}`} icon={<Timer size={12} />} />
        <Stat label="مسافة التحويل" value={fmtNum(mA.detourVehicleKm)} sub={`مركبة-كم · قبل: ${fmtNum(mB.detourVehicleKm)}`} icon={<Route size={12} />} />
        <Stat label="مؤشر الوصول" value={fmtNum(mA.accessibilityScore, 1)} sub={`أسوأ يوم ${fmtNum(mA.worstAccessibility, 1)}`} icon={<ShieldCheck size={12} />} />
        <Stat label="الأثر الاقتصادي التقديري" value={fmtSar(mA.economicCostSar)} sub={`قبل: ${fmtSar(mB.economicCostSar)}`} icon={<Coins size={12} />} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <ChartCard title="المشاريع حسب الجهة">
          <PieChart>
            <Pie data={byOrg} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={3}>
              {byOrg.map((e) => (
                <Cell key={e.name} fill={e.color} />
              ))}
            </Pie>
            <Tooltip {...tip} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        </ChartCard>
        <ChartCard title="المشاريع حسب فئة البنية التحتية">
          <BarChart data={byCat} layout="vertical" margin={{ left: 20 }}>
            <CartesianGrid stroke="#1e293b" horizontal={false} />
            <XAxis type="number" stroke="#64748b" fontSize={11} allowDecimals={false} />
            <YAxis type="category" dataKey="name" stroke="#94a3b8" fontSize={11} width={110} orientation="right" />
            <Tooltip {...tip} />
            <Bar dataKey="value" name="مشاريع" fill="#22d3ee" radius={[4, 0, 0, 4]} />
          </BarChart>
        </ChartCard>
        <ChartCard title="التعارضات حسب الخطورة (قبل/بعد)">
          <BarChart data={bySev}>
            <CartesianGrid stroke="#1e293b" vertical={false} />
            <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
            <YAxis stroke="#64748b" fontSize={11} allowDecimals={false} />
            <Tooltip {...tip} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="before" name="قبل" fill="#f59e0b" radius={4} />
            <Bar dataKey="after" name="بعد" fill="#34d399" radius={4} />
          </BarChart>
        </ChartCard>
        <ChartCard title="المقاطع المغلقة حسب التاريخ" span>
          <AreaChart data={closuresByDate}>
            <CartesianGrid stroke="#1e293b" />
            <XAxis dataKey="date" stroke="#64748b" fontSize={10} interval={9} />
            <YAxis stroke="#64748b" fontSize={11} allowDecimals={false} />
            <Tooltip {...tip} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="stepAfter" dataKey="before" name="قبل" stroke="#f59e0b" fill="#f59e0b33" />
            <Area type="stepAfter" dataKey="after" name="بعد" stroke="#34d399" fill="#34d39933" />
          </AreaChart>
        </ChartCard>
        <ChartCard title="الأثر قبل/بعد">
          <BarChart data={impact}>
            <CartesianGrid stroke="#1e293b" vertical={false} />
            <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} />
            <YAxis stroke="#64748b" fontSize={11} />
            <Tooltip {...tip} formatter={(v: number) => fmtNum(v, 1)} />
            <Bar dataKey="before" name="قبل" fill="#f59e0b" radius={4} />
            <Bar dataKey="after" name="بعد" fill="#34d399" radius={4} />
          </BarChart>
        </ChartCard>
        <ChartCard title="تعطّل الأحياء (متوسط انخفاض مؤشر الوصول عند ٨ صباحاً)" span>
          <BarChart data={hood}>
            <CartesianGrid stroke="#1e293b" vertical={false} />
            <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
            <YAxis stroke="#64748b" fontSize={11} />
            <Tooltip {...tip} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="before" name="قبل" fill="#f59e0b" radius={4} />
            <Bar dataKey="after" name="بعد" fill="#34d399" radius={4} />
          </BarChart>
        </ChartCard>
        <ChartCard title="مقارنة السيناريوهات (عدد التعارضات)">
          <BarChart data={scen}>
            <CartesianGrid stroke="#1e293b" vertical={false} />
            <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
            <YAxis stroke="#64748b" fontSize={11} allowDecimals={false} />
            <Tooltip {...tip} labelFormatter={(l) => scen.find((s) => s.name === l)?.title ?? l} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="before" name="قبل" fill="#f59e0b" radius={4} />
            <Bar dataKey="after" name="بعد" fill="#34d399" radius={4} />
          </BarChart>
        </ChartCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel className="p-4" data-tour="economics">
          <SectionTitle icon={<Coins size={16} />}>نموذج الأثر الاقتصادي (توضيحي)</SectionTitle>
          <div className="grid grid-cols-2 gap-3 text-[12px]">
            <label>
              <div className="flex justify-between text-slate-400">
                قيمة الوقت (ر.س/ساعة-شخص) <span className="num text-cyan-300">{economics.valueOfTimeSarPerHour}</span>
              </div>
              <input type="range" min={10} max={120} value={economics.valueOfTimeSarPerHour} onChange={(e) => setEconomics({ valueOfTimeSarPerHour: Number(e.target.value) })} className="w-full" data-testid="vot" />
            </label>
            <label>
              <div className="flex justify-between text-slate-400">
                متوسط الإشغال (شخص/مركبة) <span className="num text-cyan-300">{economics.occupancy}</span>
              </div>
              <input type="range" min={1} max={2.5} step={0.1} value={economics.occupancy} onChange={(e) => setEconomics({ occupancy: Number(e.target.value) })} className="w-full" />
            </label>
            <label>
              <div className="flex justify-between text-slate-400">
                تكلفة التشغيل (ر.س/كم) <span className="num text-cyan-300">{economics.vehicleOperatingCostSarPerKm}</span>
              </div>
              <input type="range" min={0} max={2} step={0.05} value={economics.vehicleOperatingCostSarPerKm} onChange={(e) => setEconomics({ vehicleOperatingCostSarPerKm: Number(e.target.value) })} className="w-full" />
            </label>
            <Toggle label="تضمين تكلفة تشغيل المركبات" checked={economics.includeOperatingCost} onChange={(v) => setEconomics({ includeOperatingCost: v })} />
          </div>
          <div className="mt-3 space-y-1 rounded-lg bg-black/25 p-3 text-[11.5px] text-slate-300">
            {ECONOMIC_FORMULA_AR.map((f) => (
              <div key={f}>• {f}</div>
            ))}
          </div>
          <table className="mt-3 w-full text-[12px]">
            <thead className="text-slate-500">
              <tr>
                <th className="text-right font-medium">البند</th>
                <th className="text-right font-medium">قبل</th>
                <th className="text-right font-medium">بعد</th>
              </tr>
            </thead>
            <tbody className="num">
              <tr className="border-t border-white/5">
                <td className="py-1.5">ساعات تأخير المركبات</td>
                <td>{fmtNum(mB.vehicleHoursDelay)}</td>
                <td>{fmtNum(mA.vehicleHoursDelay)}</td>
              </tr>
              <tr className="border-t border-white/5">
                <td className="py-1.5">تكلفة التأخير</td>
                <td>{fmtSar(econB.delayCost)}</td>
                <td>{fmtSar(econ.delayCost)}</td>
              </tr>
              <tr className="border-t border-white/5">
                <td className="py-1.5">تكلفة التشغيل</td>
                <td>{fmtSar(econB.operatingCost)}</td>
                <td>{fmtSar(econ.operatingCost)}</td>
              </tr>
              <tr className="border-t border-white/10 font-bold">
                <td className="py-1.5">الإجمالي التقديري</td>
                <td>{fmtSar(econB.total)}</td>
                <td className={cn(econ.total < econB.total ? 'text-emerald-300' : 'text-slate-100')}>{fmtSar(econ.total)}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-[10.5px] leading-relaxed text-slate-500">الوحدات: ساعات المركبات من نموذج التوزيع المروري لكل ساعة في أفق ٩٢ يوماً؛ القيم الافتراضية للتوضيح فقط وليست إحصاءات حكومية سعودية معتمدة.</p>
        </Panel>
        <Panel className="p-4">
          <SectionTitle icon={<History size={16} />}>سجل التدقيق (القرارات)</SectionTitle>
          <div className="scroll-thin max-h-80 space-y-2 overflow-y-auto" data-testid="audit-log">
            {audit.length === 0 && <div className="py-6 text-center text-xs text-slate-500">لا توجد قرارات مسجلة بعد</div>}
            {audit.map((a) => (
              <div key={a.id} className="rounded-lg border border-white/6 bg-white/[0.02] p-2.5 text-[12px]">
                <div className="flex justify-between text-slate-400">
                  <span>{{ approve_option: 'اعتماد بديل', reject_option: 'رفض بديل', modify_option: 'اعتماد بديل معدّل', approve_project: 'اعتماد مشروع', reject_project: 'رفض مشروع', register_project: 'تسجيل مشروع', reset: 'إعادة ضبط', status_change: 'تغيير حالة' }[a.action]}</span>
                  <span className="num">{fmtDate(a.at.slice(0, 10))} {a.at.slice(11, 16)}</span>
                </div>
                <div className="mt-1 text-slate-200">{a.rationale}</div>
                {a.changes.map((c) => (
                  <div key={c.projectId} className="num mt-1 text-[11px] text-slate-500">
                    {c.projectId}: {c.from.start}→{c.from.end} ⟶ <span className="text-emerald-300">{c.to.start}→{c.to.end}</span>
                  </div>
                ))}
                <div className="mt-1 text-[10.5px] text-slate-600">{a.actor}</div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function ChartCard({ title, children, span }: { title: string; children: React.ReactElement; span?: boolean }) {
  return (
    <Panel className={cn('p-4', span && 'lg:col-span-2')}>
      <div className="mb-2 text-[13px] font-semibold">{title}</div>
      <div className="h-56" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}
