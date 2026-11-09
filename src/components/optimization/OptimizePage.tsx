import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { ArrowLeft, CheckCircle2, CircleSlash, GitCompareArrows, Loader2, Scale, Sparkles, Trophy, Wand2 } from 'lucide-react';
import type { OptimizationOption, Project, ScenarioMetrics, Weights } from '@/types';
import { useStore } from '@/store/store';
import { actionable, useConflicts } from '@/store/derived';
import { changeSummary, generateOptions, rankOptions, type OptimizationResult } from '@/engine/optimization/optimize';
import { CATEGORY_LABELS, SEVERITY_LABELS } from '@/engine/conflicts/detect';
import { Badge, Button, Dialog, inputCls } from '@/components/ui/ui';
import { fmtNum, fmtSar, cn } from '@/utils/format';
import { fmtDate, fmtShort, dayIndex, HORIZON_DAYS, isoFromDay } from '@/utils/date';
import { ORGANIZATIONS } from '@/data/organizations';

const WEIGHT_LABELS: Record<keyof Weights, string> = {
  conflicts: 'عدد التعارضات',
  delay: 'تأخير المركبات',
  closureDays: 'أيام الإغلاق',
  detour: 'مسافة التحويل',
  accessibility: 'الوصول للأحياء',
  shift: 'حجم التغيير في الجدول',
};

export function OptimizePage() {
  const navigate = useNavigate();
  const projects = useStore((s) => s.projects);
  const economics = useStore((s) => s.economics);
  const weights = useStore((s) => s.weights);
  const setWeights = useStore((s) => s.setWeights);
  const selectedConflictId = useStore((s) => s.selectedConflictId);
  const selectConflict = useStore((s) => s.selectConflict);
  const conflicts = actionable(useConflicts(projects));
  const conflict = conflicts.find((c) => c.id === selectedConflictId) ?? conflicts[0] ?? null;
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [approve, setApprove] = useState<OptimizationOption | null>(null);
  const [showWeights, setShowWeights] = useState(false);

  useEffect(() => {
    if (!conflict) {
      setResult(null);
      return;
    }
    setBusy(true);
    const t = setTimeout(() => {
      setResult(generateOptions(conflict, projects, useStore.getState().weights, economics));
      setBusy(false);
    }, 30);
    return () => clearTimeout(t);
  }, [conflict?.id, projects, economics]); // eslint-disable-line react-hooks/exhaustive-deps

  const ranked = useMemo(() => {
    if (!result) return null;
    const options = result.options.map((o) => ({ ...o }));
    rankOptions(options, result.current, weights);
    return options;
  }, [result, weights]);

  useEffect(() => {
    if (ranked && conflict) useStore.getState().setLastOptimization({ conflictId: conflict.id, options: ranked });
  }, [ranked, conflict]);

  return (
    <div className="pointer-events-auto absolute inset-x-3 bottom-[150px] top-[68px] z-20 flex gap-3" data-testid="optimize-page">
      <section className="glass flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl">
        <div className="flex flex-wrap items-center gap-3 border-b border-white/6 p-4">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <Wand2 size={17} className="text-cyan-300" /> مركز تحسين الجدولة
          </h2>
          <select className={cn(inputCls, 'w-auto max-w-md py-1.5 text-[12.5px]')} value={conflict?.id ?? ''} onChange={(e) => selectConflict(e.target.value)} aria-label="التعارض" data-testid="opt-conflict-select">
            {conflicts.map((c) => (
              <option key={c.id} value={c.id}>
                {SEVERITY_LABELS[c.severity].ar} · {CATEGORY_LABELS[c.category]} · {c.projectIds.join(' ↔ ')}
              </option>
            ))}
          </select>
          <Button size="sm" variant={showWeights ? 'primary' : 'outline'} className="mr-auto" onClick={() => setShowWeights(!showWeights)} data-tour="weights">
            <Scale size={14} /> أوزان التقييم
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate('/compare')}>
            <GitCompareArrows size={14} /> قبل / بعد
          </Button>
        </div>
        {!conflict && (
          <div className="grid flex-1 place-items-center p-8 text-center">
            <div>
              <CheckCircle2 className="mx-auto text-emerald-400" size={36} />
              <div className="mt-2 font-semibold">لا توجد تعارضات تحتاج تحسيناً</div>
              <div className="mt-1 text-sm text-slate-400">جميع المشاريع منسقة في السيناريو الحالي.</div>
            </div>
          </div>
        )}
        {conflict && (
          <div className="scroll-thin flex-1 overflow-y-auto p-4">
            {showWeights && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mb-4 grid grid-cols-2 gap-x-6 gap-y-2 rounded-xl border border-white/8 bg-white/[0.02] p-3 lg:grid-cols-3" data-testid="weights-panel">
                {(Object.keys(WEIGHT_LABELS) as (keyof Weights)[]).map((k) => (
                  <label key={k} className="text-[12px]">
                    <div className="flex justify-between text-slate-300">
                      {WEIGHT_LABELS[k]} <span className="num text-cyan-300">{weights[k]}</span>
                    </div>
                    <input type="range" min={0} max={50} value={weights[k]} onChange={(e) => setWeights({ [k]: Number(e.target.value) })} className="w-full" aria-label={WEIGHT_LABELS[k]} data-testid={`weight-${k}`} />
                  </label>
                ))}
                <div className="col-span-full text-[10.5px] text-slate-500">
                  الدرجة = ١٠٠ − Σ(الوزن × القيمة ÷ أسوأ قيمة بين الوضع الحالي والبدائل) ÷ Σالأوزان × ١٠٠. الترتيب يتحدث فوراً.
                </div>
              </motion.div>
            )}
            {busy || !ranked || !result ? (
              <div className="grid h-64 place-items-center text-sm text-slate-400">
                <span className="flex items-center gap-2">
                  <Loader2 className="animate-spin" size={16} /> تشغيل المحاكاة لكل بديل عبر كامل الأفق الزمني…
                </span>
              </div>
            ) : (
              <>
                <CurrentStrip m={result.current} />
                <div className="mt-4 grid gap-3 xl:grid-cols-3" data-tour="options">
                  {ranked.map((o, i) => (
                    <OptionCard key={o.id} o={o} current={result.current} index={i} projects={projects} onApply={() => setApprove(o)} />
                  ))}
                </div>
                {ranked.every((o) => !o.feasible) && (
                  <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 text-[12.5px] text-amber-100">لم يجد المحسِّن بديلاً ممكناً ضمن قيود المرونة والأولوية والسلامة. الأسباب موضحة في كل بطاقة؛ يمكن مراجعة نافذة المرونة مع الجهات.</div>
                )}
                <Gantt projects={projects} options={ranked} conflictIds={conflict.projectIds} />
              </>
            )}
          </div>
        )}
      </section>
      <ApproveDialog option={approve} conflictId={conflict?.id ?? ''} projects={projects} onClose={() => setApprove(null)} onDone={() => navigate('/compare')} />
    </div>
  );
}

function CurrentStrip({ m }: { m: ScenarioMetrics }) {
  const items = [
    ['التعارضات الحالية', fmtNum(m.conflicts)],
    ['أيام إغلاق المقاطع', fmtNum(m.closureSegmentDays)],
    ['تأخير المركبات', `${fmtNum(m.vehicleHoursDelay)} م-س`],
    ['مؤشر الوصول', fmtNum(m.accessibilityScore, 1)],
    ['الأثر الاقتصادي', fmtSar(m.economicCostSar)],
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-white/6 bg-white/[0.02] px-4 py-2.5 text-[12px]">
      <span className="font-semibold text-slate-300">الوضع الحالي (قبل القرار):</span>
      {items.map(([k, v]) => (
        <span key={k} className="text-slate-400">
          {k}: <span className="num font-semibold text-slate-100">{v}</span>
        </span>
      ))}
    </div>
  );
}

function Delta({ before, after, lowerIsBetter = true, unit = '', digits = 0 }: { before: number; after: number; lowerIsBetter?: boolean; unit?: string; digits?: number }) {
  const d = after - before;
  const good = lowerIsBetter ? d < -1e-6 : d > 1e-6;
  const bad = lowerIsBetter ? d > 1e-6 : d < -1e-6;
  return (
    <span className={cn('num text-[11px]', good ? 'text-emerald-400' : bad ? 'text-red-400' : 'text-slate-500')}>
      {d > 0 ? '+' : ''}
      {fmtNum(d, digits)}
      {unit}
    </span>
  );
}

function OptionCard({ o, current, index, projects, onApply }: { o: OptimizationOption; current: ScenarioMetrics; index: number; projects: Project[]; onApply: () => void }) {
  const m = o.metrics;
  const letter = ['أ', 'ب', 'ج'][index];
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08 }}
      className={cn('relative flex flex-col rounded-2xl border p-4', o.recommended ? 'border-emerald-400/50 bg-emerald-400/[0.05] shadow-[0_0_40px_-16px_rgba(52,211,153,0.6)]' : o.feasible ? 'border-white/10 bg-white/[0.02]' : 'border-white/6 bg-white/[0.01] opacity-80')}
      data-testid={`option-${o.kind}`}
    >
      {o.recommended && (
        <span className="absolute -top-2.5 right-4 flex items-center gap-1 rounded-full bg-emerald-400 px-2.5 py-0.5 text-[11px] font-bold text-slate-950">
          <Trophy size={12} /> الخيار الموصى به
        </span>
      )}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[11px] text-slate-500">الخيار {letter}</div>
          <div className="text-[15px] font-semibold">{o.titleAr}</div>
        </div>
        {o.feasible ? <Badge tone="emerald">ممكن</Badge> : <Badge tone="rose">غير ممكن</Badge>}
      </div>
      {o.feasible && m ? (
        <>
          <div className="mt-3">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>الدرجة الموزونة</span>
              <span className="num text-sm font-bold text-white">{fmtNum(o.score, 1)}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-white/8">
              <motion.div initial={{ width: 0 }} animate={{ width: `${Math.max(2, o.score)}%` }} className={cn('h-full rounded-full', o.recommended ? 'bg-emerald-400' : 'bg-cyan-400/70')} />
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            {o.changes.map((c) => {
              const p = projects.find((x) => x.id === c.projectId)!;
              const s = changeSummary(c);
              return (
                <div key={c.projectId} className="rounded-lg bg-black/20 p-2 text-[11.5px]">
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: ORGANIZATIONS[p.orgId].color }} />
                    <span className="truncate text-slate-200">{p.title}</span>
                  </div>
                  <div className="num mt-1 flex items-center gap-1.5 text-slate-400">
                    <span className="line-through decoration-slate-600">{fmtShort(c.from.start)}–{fmtShort(c.from.end)}</span>
                    <ArrowLeft size={11} />
                    <span className="text-cyan-200">{fmtShort(c.to.start)}–{fmtShort(c.to.end)}</span>
                    <span className={cn('mr-auto', s.delta > 0 ? 'text-amber-300' : s.delta < 0 ? 'text-sky-300' : 'text-slate-500')}>{s.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11.5px]">
            <Metric k="التعارضات" v={fmtNum(m.conflicts)} d={<Delta before={current.conflicts} after={m.conflicts} />} />
            <Metric k="أيام الإغلاق" v={fmtNum(m.closureSegmentDays)} d={<Delta before={current.closureSegmentDays} after={m.closureSegmentDays} />} />
            <Metric k="التأخير (م-س)" v={fmtNum(m.vehicleHoursDelay)} d={<Delta before={current.vehicleHoursDelay} after={m.vehicleHoursDelay} />} />
            <Metric k="الوصول" v={fmtNum(m.accessibilityScore, 1)} d={<Delta before={current.accessibilityScore} after={m.accessibilityScore} lowerIsBetter={false} digits={1} />} />
            <Metric k="التحويل (م-كم)" v={fmtNum(m.detourVehicleKm)} d={<Delta before={current.detourVehicleKm} after={m.detourVehicleKm} />} />
            <Metric k="الأثر الاقتصادي" v={fmtSar(m.economicCostSar)} d={<Delta before={current.economicCostSar / 1000} after={m.economicCostSar / 1000} unit="k" />} />
          </dl>
          <ul className="mt-3 space-y-1 text-[11.5px] leading-relaxed text-slate-400">
            {o.tradeoffsAr.map((t, i) => (
              <li key={i}>• {t}</li>
            ))}
            {m.vehicleHoursDelay > current.vehicleHoursDelay && <li className="text-amber-300/90">• النموذج يُظهر أن هذا البديل لا يقلل التأخير الإجمالي (ينقل الأثر إلى فترة أخرى).</li>}
          </ul>
          <Button variant={o.recommended ? 'success' : 'outline'} className="mt-auto w-full translate-y-2" onClick={onApply} data-testid={`apply-${o.kind}`}>
            <Sparkles size={14} /> تطبيق الحل
          </Button>
        </>
      ) : (
        <div className="mt-3 flex gap-2 rounded-lg bg-black/20 p-3 text-[12px] leading-relaxed text-slate-300">
          <CircleSlash size={16} className="mt-0.5 shrink-0 text-rose-300" />
          <span>{o.infeasibleReasonAr}</span>
        </div>
      )}
    </motion.div>
  );
}

function Metric({ k, v, d }: { k: string; v: string; d: React.ReactNode }) {
  return (
    <div>
      <dt className="text-slate-500">{k}</dt>
      <dd className="flex items-baseline gap-1.5">
        <span className="num font-semibold text-slate-100">{v}</span>
        {d}
      </dd>
    </div>
  );
}

function Gantt({ projects, options, conflictIds }: { projects: Project[]; options: OptimizationOption[]; conflictIds: string[] }) {
  const ids = [...new Set([...conflictIds, ...options.flatMap((o) => o.changes.map((c) => c.projectId))])];
  const rows = ids.map((id) => projects.find((p) => p.id === id)!).filter(Boolean);
  const pct = (d: number) => `${(d / HORIZON_DAYS) * 100}%`;
  const colors = { earlier: '#38bdf8', delay: '#f59e0b', coordinated: '#34d399' };
  return (
    <div className="mt-5 rounded-xl border border-white/6 bg-white/[0.02] p-3">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[11.5px] text-slate-400">
        <span className="font-semibold text-slate-300">مقارنة الجداول الزمنية</span>
        <span className="flex items-center gap-1"><span className="h-2 w-4 rounded-sm bg-slate-500" />الحالي</span>
        <span className="flex items-center gap-1"><span className="h-2 w-4 rounded-sm" style={{ background: colors.earlier }} />تقديم</span>
        <span className="flex items-center gap-1"><span className="h-2 w-4 rounded-sm" style={{ background: colors.delay }} />تأخير</span>
        <span className="flex items-center gap-1"><span className="h-2 w-4 rounded-sm" style={{ background: colors.coordinated }} />منسق</span>
      </div>
      <div className="space-y-2" dir="ltr">
        {rows.map((p) => (
          <div key={p.id} className="flex items-center gap-2">
            <div className="w-40 truncate text-right text-[11px] text-slate-300" dir="rtl" title={p.title}>{p.title}</div>
            <div className="relative h-7 flex-1 rounded bg-black/25">
              {[0, 31, 62].map((d) => (
                <span key={d} className="absolute inset-y-0 border-l border-white/5 text-[9px] text-slate-600" style={{ left: pct(d) }}>
                  &nbsp;{fmtShort(isoFromDay(d))}
                </span>
              ))}
              <div className="absolute top-0.5 h-2 rounded-sm bg-slate-500" style={{ left: pct(dayIndex(p.schedule.start)), width: pct(dayIndex(p.schedule.end) - dayIndex(p.schedule.start) + 1) }} />
              {options.flatMap((o) =>
                o.changes
                  .filter((c) => c.projectId === p.id)
                  .map((c) => (
                    <div key={o.id} className="absolute h-1.5 rounded-sm" style={{ top: o.kind === 'earlier' ? 11 : o.kind === 'delay' ? 15 : 19, left: pct(dayIndex(c.to.start)), width: pct(dayIndex(c.to.end) - dayIndex(c.to.start) + 1), background: colors[o.kind] }} />
                  )),
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ApproveDialog({ option, conflictId, projects, onClose, onDone }: { option: OptimizationOption | null; conflictId: string; projects: Project[]; onClose: () => void; onDone: () => void }) {
  const approveOption = useStore((s) => s.approveOption);
  const toast = useStore((s) => s.toast);
  const [rationale, setRationale] = useState('');
  useEffect(() => {
    if (option) setRationale(`اعتماد "${option.titleAr}" لأنه ${option.recommended ? 'الأعلى في التقييم الموزون' : 'يحقق متطلبات الجهات'} ويقلل التعارض في الممر.`);
  }, [option]);
  if (!option) return null;
  return (
    <Dialog
      open={!!option}
      onClose={onClose}
      title="اعتماد خطة التنفيذ المنسقة"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            variant="success"
            data-testid="confirm-approve"
            onClick={() => {
              approveOption(conflictId, option, rationale);
              toast({ tone: 'success', title: 'تم اعتماد الخطة', body: 'حُدّثت الجداول والخريطة والخط الزمني ومعلومات المواطنين، وسُجّل القرار في سجل التدقيق.' });
              onClose();
              onDone();
            }}
          >
            <CheckCircle2 size={15} /> اعتماد وتحديث الجداول
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px]">
        <div className="text-slate-300">
          البديل المختار: <b>{option.titleAr}</b>
        </div>
        <table className="w-full text-[12px]">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1 text-right font-medium">المشروع</th>
              <th className="py-1 text-right font-medium">الجدول السابق</th>
              <th className="py-1 text-right font-medium">الجدول المحدّث</th>
            </tr>
          </thead>
          <tbody>
            {option.changes.map((c) => (
              <tr key={c.projectId} className="border-t border-white/6">
                <td className="py-1.5">{projects.find((p) => p.id === c.projectId)?.title}</td>
                <td className="num py-1.5 text-slate-400">{fmtDate(c.from.start)} – {fmtDate(c.from.end)}</td>
                <td className="num py-1.5 text-emerald-300">{fmtDate(c.to.start)} – {fmtDate(c.to.end)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-[11.5px] text-slate-400">تاريخ الاعتماد: {fmtDate(new Date().toISOString().slice(0, 10))}</div>
        <textarea className={inputCls} rows={3} value={rationale} onChange={(e) => setRationale(e.target.value)} aria-label="مبررات القرار" />
      </div>
    </Dialog>
  );
}
