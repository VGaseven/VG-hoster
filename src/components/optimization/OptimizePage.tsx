import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { ArrowLeft, CheckCircle2, CircleSlash, GitCompareArrows, Loader2, PencilLine, Scale, Send, ShieldQuestion, Trophy, Wand2, XCircle } from 'lucide-react';
import type { Conflict, OptimizationOption, Project, ScenarioMetrics, ScheduleChange, Weights } from '@/types';
import { useStore } from '@/store/store';
import { actionable, getConflicts, useConflicts } from '@/store/derived';
import { applyChanges, changeSummary, evaluateSchedule, generateOptions, rankOptions, type OptimizationResult } from '@/engine/optimization/optimize';
import { CATEGORY_LABELS, SEVERITY_LABELS } from '@/engine/conflicts/detect';
import { Badge, Button, Dialog, inputCls } from '@/components/ui/ui';
import { fmtNum, fmtSar, cn } from '@/utils/format';
import { addDays, fmtDate, fmtShort, dayIndex, durationDays, HORIZON_DAYS, isoFromDay } from '@/utils/date';
import { ORGANIZATIONS } from '@/data/organizations';
import { WorkflowStepper } from '@/components/layout/WorkflowStepper';

const WEIGHT_LABELS: Record<keyof Weights, string> = {
  conflicts: 'عدد التعارضات',
  repeat: 'تكرار الإغلاق',
  closureDays: 'مدة الإغلاق × نطاقه',
  delay: 'تأخير المركبات (مُنمذج)',
  accessibility: 'الوصول للأحياء (مُنمذج)',
  detour: 'مسافة الالتفاف (مُنمذج)',
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
  const focusOption = useStore((s) => s.focusOption);
  const conflicts = actionable(useConflicts(projects));
  const conflict = conflicts.find((c) => c.id === selectedConflictId) ?? conflicts[0] ?? null;
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<OptimizationOption | null>(null);
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
    if (ranked && conflict) {
      useStore.getState().setLastOptimization({ conflictId: conflict.id, options: ranked });
      if (ranked.some((o) => o.feasible)) useStore.getState().markAlternativeProposed(conflict.projectIds);
    }
  }, [ranked, conflict]);

  // the RASD scenario show can open the review of a given option
  const reviewRequest = useStore((s) => s.reviewRequest);
  useEffect(() => {
    if (!reviewRequest || !ranked) return;
    const o = ranked.find((x) => x.kind === reviewRequest);
    if (o?.feasible) setReview(o);
    useStore.getState().setReviewRequest(null);
  }, [reviewRequest, ranked]);

  return (
    <div className="pointer-events-auto absolute inset-x-3 bottom-[150px] top-[68px] z-20 flex gap-3" data-testid="optimize-page">
      <section className="glass flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl">
        <div className="flex flex-wrap items-center gap-3 border-b border-white/6 p-4">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <Wand2 size={17} className="text-violet-300" /> مقارنة البدائل قبل الاعتماد
          </h2>
          <select className={cn(inputCls, 'w-auto max-w-md py-1.5 text-[12.5px]')} value={conflict?.id ?? ''} onChange={(e) => selectConflict(e.target.value)} aria-label="التعارض" data-testid="opt-conflict-select">
            {conflicts.map((c) => (
              <option key={c.id} value={c.id}>
                {SEVERITY_LABELS[c.severity].ar} · {CATEGORY_LABELS[c.category]} · {c.projectIds.join(' ↔ ')}
              </option>
            ))}
          </select>
          <div className="mr-auto hidden xl:block">
            <WorkflowStepper compact />
          </div>
          <Button size="sm" variant={showWeights ? 'primary' : 'outline'} onClick={() => setShowWeights(!showWeights)} data-tour="weights">
            <Scale size={14} /> أوزان الترتيب
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate('/compare')}>
            <GitCompareArrows size={14} /> الخطتان
          </Button>
        </div>
        {!conflict && (
          <div className="grid flex-1 place-items-center p-8 text-center">
            <div>
              <CheckCircle2 className="mx-auto text-emerald-400" size={36} />
              <div className="mt-2 font-semibold">لا توجد تعارضات تحتاج قراراً</div>
              <div className="mt-1 text-sm text-slate-400">جميع المشاريع منسقة في الخطة الحالية.</div>
            </div>
          </div>
        )}
        {conflict && (
          <div className="scroll-thin flex-1 overflow-y-auto p-4">
            {showWeights && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mb-4 grid grid-cols-2 gap-x-6 gap-y-2 rounded-xl border border-white/8 bg-white/[0.02] p-3 lg:grid-cols-4" data-testid="weights-panel">
                {(Object.keys(WEIGHT_LABELS) as (keyof Weights)[]).map((k) => (
                  <label key={k} className="text-[12px]">
                    <div className="flex justify-between text-slate-300">
                      {WEIGHT_LABELS[k]} <span className="num text-violet-300">{weights[k] ?? 0}</span>
                    </div>
                    <input type="range" min={0} max={50} value={weights[k] ?? 0} onChange={(e) => setWeights({ [k]: Number(e.target.value) })} className="w-full" aria-label={WEIGHT_LABELS[k]} data-testid={`weight-${k}`} />
                  </label>
                ))}
                <div className="col-span-full text-[10.5px] text-slate-500">
                  الدرجة = ١٠٠ − Σ(الوزن × القيمة ÷ أسوأ قيمة بين الخطة الأصلية والبدائل) ÷ Σالأوزان × ١٠٠. المؤشرات المُنمذجة مساندة فقط. النافذة المشتركة لا تُوصى تلقائياً.
                </div>
              </motion.div>
            )}
            {busy || !ranked || !result ? (
              <div className="grid h-64 place-items-center text-sm text-slate-400">
                <span className="flex items-center gap-2">
                  <Loader2 className="animate-spin" size={16} /> تقييم كل بديل عبر كامل الأفق الزمني…
                </span>
              </div>
            ) : (
              <div className="grid gap-3 xl:grid-cols-[240px_1fr]">
                <OriginalPlan conflict={conflict} projects={projects} m={result.current} />
                <div>
                  <div className="grid gap-3 xl:grid-cols-3" data-tour="options">
                    {ranked.map((o, i) => (
                      <OptionCard key={o.id} o={o} current={result.current} index={i} projects={projects} conflict={conflict} focused={focusOption === o.kind} onReview={() => setReview(o)} />
                    ))}
                  </div>
                  {ranked.every((o) => !o.feasible) && (
                    <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 text-[12.5px] text-amber-100">لم يُعثر على بديل ممكن ضمن قيود المرونة والأولوية والسلامة. الأسباب موضحة في كل بطاقة؛ يمكن للجهة المختصة مراجعة نوافذ المرونة مع الجهات المنفذة.</div>
                  )}
                  <Gantt projects={projects} options={ranked} conflictIds={conflict.projectIds} />
                </div>
              </div>
            )}
          </div>
        )}
      </section>
      <DecisionReview option={review} conflictId={conflict?.id ?? ''} projects={projects} current={result?.current ?? null} onClose={() => setReview(null)} onDone={() => navigate('/compare')} />
    </div>
  );
}

function OriginalPlan({ conflict, projects, m }: { conflict: Conflict; projects: Project[]; m: ScenarioMetrics }) {
  const ps = conflict.projectIds.map((id) => projects.find((p) => p.id === id)!).filter(Boolean);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4" data-testid="original-plan">
      <div className="text-[11px] font-semibold text-violet-300">الخطة الأصلية</div>
      <div className="mt-1 text-[14px] font-semibold">تداخل أعمال داخل الحي</div>
      <div className="mt-3 space-y-2">
        {ps.map((p) => (
          <div key={p.id} className="rounded-lg bg-black/20 p-2 text-[11.5px]">
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: ORGANIZATIONS[p.orgId].color }} />
              <span className="text-slate-200">{p.title}</span>
            </div>
            <div className="num mt-1 text-slate-400">
              {fmtShort(p.schedule.start)} – {fmtShort(p.schedule.end)}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-lg bg-red-500/[0.07] p-2 text-[11.5px] leading-relaxed text-red-100">
        {SEVERITY_LABELS[conflict.severity].ar} · {CATEGORY_LABELS[conflict.category]}
        {conflict.overlap && <div className="text-red-200/70">تداخل {conflict.overlap.days} يوم</div>}
      </div>
      <dl className="mt-3 space-y-1 text-[11.5px] text-slate-400">
        <div className="flex justify-between">
          <dt>التعارضات</dt>
          <dd className="num text-slate-100">{m.conflicts}</dd>
        </div>
        <div className="flex justify-between">
          <dt>مرات الإغلاق</dt>
          <dd className="num text-slate-100">{m.closureEpisodes}</dd>
        </div>
        <div className="flex justify-between">
          <dt>كم-يوم مغلق</dt>
          <dd className="num text-slate-100">{fmtNum(m.closureKmDays, 1)}</dd>
        </div>
      </dl>
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

function conflictDiff(projects: Project[], changes: ScheduleChange[]) {
  const before = new Set(actionable(getConflicts(projects)).map((c) => c.id));
  const afterList = actionable(getConflicts(applyChanges(projects, changes)));
  const after = new Set(afterList.map((c) => c.id));
  return { resolved: [...before].filter((x) => !after.has(x)).length, introduced: afterList.filter((c) => !before.has(c.id)) };
}

function OptionCard({ o, current, index, projects, conflict, focused, onReview }: { o: OptimizationOption; current: ScenarioMetrics; index: number; projects: Project[]; conflict: Conflict; focused: boolean; onReview: () => void }) {
  const m = o.metrics;
  const diff = useMemo(() => (o.feasible ? conflictDiff(projects, o.changes) : null), [o, projects]);
  const resolvesTarget = diff ? !actionable(getConflicts(applyChanges(projects, o.changes))).some((c) => c.id === conflict.id) : false;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0, scale: focused ? 1.02 : 1 }}
      transition={{ delay: index * 0.08 }}
      className={cn(
        'relative flex flex-col rounded-2xl border p-4',
        o.recommended ? 'border-violet-400/60 bg-violet-500/[0.07] shadow-[0_0_40px_-16px_rgba(139,92,246,0.7)]' : o.feasible ? 'border-white/10 bg-white/[0.02]' : 'border-white/6 bg-white/[0.01] opacity-80',
        focused && 'ring-2 ring-cyan-300/70',
      )}
      data-testid={`option-${o.kind}`}
    >
      {o.recommended && (
        <span className="absolute -top-2.5 right-4 flex items-center gap-1 rounded-full bg-violet-500 px-2.5 py-0.5 text-[11px] font-bold text-white">
          <Trophy size={12} /> الخيار الموصى به
        </span>
      )}
      {o.requiresTechnicalConfirmation && o.feasible && (
        <span className="absolute -top-2.5 right-4 flex items-center gap-1 rounded-full border border-amber-400/50 bg-ink-900 px-2.5 py-0.5 text-[11px] font-semibold text-amber-200" title="لا يُوصى بالنافذة المشتركة تلقائياً">
          <ShieldQuestion size={12} /> {o.topScore ? 'الأعلى تقييماً · ' : ''}يتطلب تأكيداً فنياً
        </span>
      )}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[11px] text-slate-500">البديل {index + 1}</div>
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
              <motion.div initial={{ width: 0 }} animate={{ width: `${Math.max(2, o.score)}%` }} className={cn('h-full rounded-full', o.recommended ? 'bg-violet-400' : 'bg-cyan-400/70')} />
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
          {diff && (
            <div className="mt-2 text-[11.5px]" data-testid={`conflict-diff-${o.kind}`}>
              <span className={resolvesTarget ? 'text-emerald-300' : 'text-red-300'}>{resolvesTarget ? '✓ يحل التعارض المحدد' : '✗ لا يحل التعارض المحدد'}</span>
              <span className="text-slate-500"> · يحل {diff.resolved} · </span>
              <span className={diff.introduced.length ? 'text-amber-300' : 'text-slate-500'}>تعارضات جديدة محتملة: {diff.introduced.length}</span>
              {diff.introduced.slice(0, 2).map((c) => (
                <div key={c.id} className="num text-[10.5px] text-amber-200/70">
                  {CATEGORY_LABELS[c.category]} · {c.projectIds.join(' ↔ ')}
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 text-[10.5px] font-semibold text-violet-300">النتائج الرئيسية</div>
          <dl className="mt-1 grid grid-cols-3 gap-x-2 gap-y-2 text-[11.5px]">
            <Metric k="التعارضات" v={fmtNum(m.conflicts)} d={<Delta before={current.conflicts} after={m.conflicts} />} />
            <Metric k="مرات الإغلاق" v={fmtNum(m.closureEpisodes)} d={<Delta before={current.closureEpisodes} after={m.closureEpisodes} />} />
            <Metric k="كم-يوم مغلق" v={fmtNum(m.closureKmDays, 1)} d={<Delta before={current.closureKmDays} after={m.closureKmDays} digits={1} />} />
          </dl>
          <div className="mt-2 text-[10.5px] text-slate-500">مؤشرات مُنمذجة مساندة</div>
          <dl className="mt-1 grid grid-cols-3 gap-x-2 gap-y-1 text-[11px]">
            <Metric k="التأخير (م-س)" v={fmtNum(m.vehicleHoursDelay)} d={<Delta before={current.vehicleHoursDelay} after={m.vehicleHoursDelay} />} />
            <Metric k="الوصول" v={fmtNum(m.accessibilityScore, 1)} d={<Delta before={current.accessibilityScore} after={m.accessibilityScore} lowerIsBetter={false} digits={1} />} />
            <Metric k="أثر اقتصادي" v={fmtSar(m.economicCostSar)} d={null} />
          </dl>
          <ul className="mt-3 space-y-1 text-[11.5px] leading-relaxed text-slate-400">
            {o.tradeoffsAr.map((t, i) => (
              <li key={i}>• {t}</li>
            ))}
            {m.vehicleHoursDelay > current.vehicleHoursDelay && <li className="text-amber-300/90">• النموذج يُظهر أن هذا البديل لا يقلل التأخير المروري الإجمالي (ينقل الأثر إلى فترة أخرى).</li>}
          </ul>
          <Button variant={o.recommended ? 'primary' : 'outline'} className="mt-auto w-full translate-y-2" onClick={onReview} data-testid={`apply-${o.kind}`}>
            <Send size={14} /> إرسال للمراجعة
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
      <dd className="flex flex-wrap items-baseline gap-1">
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
  const colors = { earlier: '#38bdf8', delay: '#a78bfa', coordinated: '#34d399' };
  return (
    <div className="mt-5 rounded-xl border border-white/6 bg-white/[0.02] p-3">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[11.5px] text-slate-400">
        <span className="font-semibold text-slate-300">مقارنة الجداول الزمنية</span>
        <span className="flex items-center gap-1"><span className="h-2 w-4 rounded-sm bg-slate-500" />الأصلي</span>
        <span className="flex items-center gap-1"><span className="h-2 w-4 rounded-sm" style={{ background: colors.earlier }} />تقديم</span>
        <span className="flex items-center gap-1"><span className="h-2 w-4 rounded-sm" style={{ background: colors.delay }} />تأخير</span>
        <span className="flex items-center gap-1"><span className="h-2 w-4 rounded-sm" style={{ background: colors.coordinated }} />نافذة مشتركة</span>
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

/** «مراجعة الجهة: قبول أو رفض أو تعديل» */
function DecisionReview({ option, conflictId, projects, current, onClose, onDone }: { option: OptimizationOption | null; conflictId: string; projects: Project[]; current: ScenarioMetrics | null; onClose: () => void; onDone: () => void }) {
  const approveOption = useStore((s) => s.approveOption);
  const rejectOption = useStore((s) => s.rejectOption);
  const economics = useStore((s) => s.economics);
  const toast = useStore((s) => s.toast);
  const [mode, setMode] = useState<'review' | 'modify' | 'reject'>('review');
  const [rationale, setRationale] = useState('');
  const [techOk, setTechOk] = useState(false);
  const [starts, setStarts] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!option) return;
    setMode('review');
    setTechOk(false);
    setStarts(Object.fromEntries(option.changes.map((c) => [c.projectId, c.to.start])));
    setRationale(`اعتماد «${option.titleAr}» ${option.recommended ? 'وهو الخيار الموصى به في الترتيب الموزون' : 'وفق تقدير الجهة المختصة'}؛ القيود محترمة والأسباب موثقة.`);
  }, [option]);

  const modified: ScheduleChange[] = useMemo(() => {
    if (!option) return [];
    return option.changes.map((c) => {
      const p = projects.find((x) => x.id === c.projectId)!;
      const st = starts[c.projectId] ?? c.to.start;
      return { ...c, to: { start: st, end: addDays(st, durationDays(p.schedule) - 1) } };
    });
  }, [option, starts, projects]);
  const modErrors = modified.flatMap((c) => {
    const p = projects.find((x) => x.id === c.projectId)!;
    const e: string[] = [];
    if (dayIndex(c.to.start) < dayIndex(p.earliestStart)) e.push(`${p.id}: قبل أبكر موعد مسموح (${fmtShort(p.earliestStart)})`);
    if (dayIndex(c.to.end) > dayIndex(p.latestEnd)) e.push(`${p.id}: بعد آخر موعد إنجاز (${fmtShort(p.latestEnd)})`);
    return e;
  });
  const isModified = option ? modified.some((c, i) => c.to.start !== option.changes[i].to.start) : false;
  const modMetrics = useMemo(() => (mode === 'modify' && isModified && !modErrors.length ? evaluateSchedule(applyChanges(projects, modified), economics) : null), [mode, isModified, modErrors.length, projects, modified, economics]);

  if (!option) return null;
  const needsTech = option.requiresTechnicalConfirmation;
  const approve = () => {
    const finalOpt = mode === 'modify' && isModified ? { ...option, changes: modified } : option;
    approveOption(conflictId, finalOpt, rationale, mode === 'modify' && isModified);
    toast({ tone: 'success', title: mode === 'modify' && isModified ? 'اعتُمدت الخطة بعد التعديل' : 'اعتمدت الجهة المختصة الخطة', body: 'حُدّثت الجداول والخريطة والخط الزمني، وأصبحت الإغلاقات المعتمدة ظاهرة لمستخدمي الطريق.' });
    onClose();
    onDone();
  };
  return (
    <Dialog
      open={!!option}
      onClose={onClose}
      title="مراجعة الجهة المختصة — قبول أو رفض أو تعديل"
      wide
      footer={
        mode === 'reject' ? (
          <>
            <Button variant="ghost" onClick={() => setMode('review')}>رجوع</Button>
            <Button
              variant="danger"
              data-testid="confirm-reject"
              disabled={rationale.trim().length < 5}
              onClick={() => {
                rejectOption(conflictId, option, rationale);
                toast({ tone: 'warning', title: 'رُفض البديل', body: 'سُجّل القرار وأسبابه؛ يبقى التعارض قائماً للمراجعة.' });
                onClose();
              }}
            >
              <XCircle size={15} /> تأكيد الرفض
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" className="text-rose-300" onClick={() => (setMode('reject'), setRationale(''))} data-testid="decision-reject">
              <XCircle size={15} /> رفض
            </Button>
            <Button variant="outline" onClick={() => setMode(mode === 'modify' ? 'review' : 'modify')} data-testid="decision-modify">
              <PencilLine size={15} /> {mode === 'modify' ? 'إلغاء التعديل' : 'تعديل'}
            </Button>
            <Button variant="success" data-testid="confirm-approve" disabled={(needsTech && !techOk) || (mode === 'modify' && modErrors.length > 0)} onClick={approve}>
              <CheckCircle2 size={15} /> {mode === 'modify' && isModified ? 'اعتماد بعد التعديل' : 'قبول واعتماد'}
            </Button>
          </>
        )
      }
    >
      <div className="grid gap-4 text-[13px] md:grid-cols-2">
        <div className="space-y-3">
          <div className="text-slate-300">
            البديل: <b>{option.titleAr}</b> {option.recommended && <Badge tone="violet">موصى به</Badge>}
          </div>
          <table className="w-full text-[12px]">
            <thead className="text-slate-500">
              <tr>
                <th className="py-1 text-right font-medium">المشروع</th>
                <th className="py-1 text-right font-medium">الجدول السابق</th>
                <th className="py-1 text-right font-medium">الجدول المقترح</th>
              </tr>
            </thead>
            <tbody>
              {modified.map((c) => {
                const p = projects.find((x) => x.id === c.projectId)!;
                return (
                  <tr key={c.projectId} className="border-t border-white/6 align-top">
                    <td className="py-1.5">{p.title}</td>
                    <td className="num py-1.5 text-slate-400">{fmtDate(c.from.start)} – {fmtDate(c.from.end)}</td>
                    <td className="num py-1.5 text-emerald-300">
                      {mode === 'modify' ? (
                        <input type="date" className={cn(inputCls, 'num py-1 text-[12px]')} value={starts[c.projectId]} min={p.earliestStart} max={p.latestEnd} onChange={(e) => e.target.value && setStarts({ ...starts, [c.projectId]: e.target.value })} data-testid={`modify-start-${c.projectId}`} />
                      ) : null}
                      {fmtDate(c.to.start)} – {fmtDate(c.to.end)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {modErrors.map((e) => (
            <div key={e} className="text-[11.5px] text-red-300">{e}</div>
          ))}
          {needsTech && (
            <label className="flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/5 p-2.5 text-[12px] text-amber-100">
              <input type="checkbox" checked={techOk} onChange={(e) => setTechOk(e.target.checked)} className="mt-0.5" data-testid="tech-confirm" />
              تم التأكيد الفني من الجهتين المنفذتين على إمكانية العمل في نافذة/منطقة عمل مشتركة (السلامة، المسارات، الحفرية).
            </label>
          )}
          <textarea className={inputCls} rows={3} value={rationale} onChange={(e) => setRationale(e.target.value)} aria-label="مبررات القرار" placeholder={mode === 'reject' ? 'سبب الرفض (إلزامي)' : 'مبررات القرار'} data-testid="decision-rationale" />
          <div className="text-[11px] text-slate-500">يُسجَّل القرار وأسبابه وتاريخه في سجل التدقيق ({fmtDate(new Date().toISOString().slice(0, 10))}).</div>
        </div>
        <div className="space-y-2 rounded-xl bg-white/[0.03] p-3 text-[12px]">
          <div className="font-semibold text-slate-300">الأدلة الداعمة للقرار</div>
          {current && (mode === 'modify' && modMetrics ? modMetrics : option.metrics) && (
            <EvidenceTable current={current} next={(mode === 'modify' && modMetrics ? modMetrics : option.metrics)!} label={mode === 'modify' && modMetrics ? 'بعد التعديل' : 'البديل'} />
          )}
          <ul className="space-y-1 text-[11.5px] text-slate-400">
            {option.tradeoffsAr.map((t) => (
              <li key={t}>• {t}</li>
            ))}
          </ul>
        </div>
      </div>
    </Dialog>
  );
}

function EvidenceTable({ current, next, label }: { current: ScenarioMetrics; next: ScenarioMetrics; label: string }) {
  const rows: [string, number, number, number][] = [
    ['التعارضات', current.conflicts, next.conflicts, 0],
    ['مرات الإغلاق', current.closureEpisodes, next.closureEpisodes, 0],
    ['كم-يوم مغلق', current.closureKmDays, next.closureKmDays, 1],
    ['تأخير المركبات (مُنمذج)', current.vehicleHoursDelay, next.vehicleHoursDelay, 0],
  ];
  return (
    <table className="w-full">
      <thead className="text-slate-500">
        <tr>
          <th className="text-right font-medium">المؤشر</th>
          <th className="text-right font-medium">الحالي</th>
          <th className="text-right font-medium">{label}</th>
        </tr>
      </thead>
      <tbody className="num">
        {rows.map(([k, a, b, d]) => (
          <tr key={k} className="border-t border-white/5">
            <td className="py-1">{k}</td>
            <td>{fmtNum(a, d)}</td>
            <td className={b < a ? 'text-emerald-300' : b > a ? 'text-red-300' : ''}>{fmtNum(b, d)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
