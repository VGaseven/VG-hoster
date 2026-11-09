import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { CheckCircle2, FilePlus2, MousePointerClick, ShieldAlert } from 'lucide-react';
import type { Category, ClosureType, OrgId, Priority, Project } from '@/types';
import { SidePanel } from '@/app/Layout';
import { useStore } from '@/store/store';
import { actionable, getConflicts } from '@/store/derived';
import { CATEGORIES, ORGANIZATIONS, PRIORITIES } from '@/data/organizations';
import { CLOSABLE_SEGMENTS, SEGMENT_BY_ID, ZONES } from '@/data/network';
import { closureLengthKm, projectMidpoint } from '@/engine/spatial/geometry';
import { haversineKm } from '@/data/network';
import { Button, Field, inputCls } from '@/components/ui/ui';
import { HORIZON_START, isoFromDay, HORIZON_DAYS, durationDays, dayIndex } from '@/utils/date';
import { fmtNum } from '@/utils/format';
import { CATEGORY_LABELS, SEVERITY_LABELS } from '@/engine/conflicts/detect';
import { cn } from '@/utils/format';

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'صيغة التاريخ غير صحيحة');
const FormSchema = z
  .object({
    title: z.string().trim().min(6, 'العنوان قصير جداً (٦ أحرف على الأقل)').max(120),
    orgId: z.enum(['municipality', 'water', 'electricity', 'telecom', 'roads']),
    category: z.enum(['water', 'electricity', 'telecom', 'road_maintenance', 'municipal', 'drainage']),
    segmentId: z.string({ message: 'اختر مقطع الطريق من الخريطة أو القائمة' }).min(1, 'اختر مقطع الطريق من الخريطة أو القائمة'),
    from: z.number().min(0).max(1),
    to: z.number().min(0).max(1),
    start: iso,
    end: iso,
    workStart: z.number().int().min(0).max(23),
    workEnd: z.number().int().min(1).max(24),
    priority: z.enum(['critical', 'high', 'medium', 'low']),
    earliestStart: iso,
    latestEnd: iso,
    closureType: z.enum(['full', 'partial']),
    affectedLanes: z.number().int().min(1, 'مسار واحد على الأقل'),
    estimatedCostSar: z.number().min(0, 'التكلفة لا يمكن أن تكون سالبة'),
    notes: z.string().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.to - v.from < 0.05) ctx.addIssue({ code: 'custom', path: ['to'], message: 'امتداد الإغلاق قصير جداً — حدد نقطتي بداية ونهاية مختلفتين' });
    if (dayIndex(v.end) < dayIndex(v.start)) ctx.addIssue({ code: 'custom', path: ['end'], message: 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية' });
    if (dayIndex(v.start) < 0 || dayIndex(v.end) >= HORIZON_DAYS) ctx.addIssue({ code: 'custom', path: ['start'], message: `التواريخ يجب أن تقع ضمن أفق المحاكاة (${HORIZON_START} – ${isoFromDay(HORIZON_DAYS - 1)})` });
    if (dayIndex(v.earliestStart) > dayIndex(v.start)) ctx.addIssue({ code: 'custom', path: ['earliestStart'], message: 'أبكر موعد مسموح يجب أن يكون قبل أو يساوي تاريخ البداية' });
    if (dayIndex(v.latestEnd) < dayIndex(v.end)) ctx.addIssue({ code: 'custom', path: ['latestEnd'], message: 'آخر موعد إنجاز يجب أن يكون بعد أو يساوي تاريخ النهاية' });
    if (v.workEnd <= v.workStart) ctx.addIssue({ code: 'custom', path: ['workEnd'], message: 'نهاية ساعات العمل يجب أن تكون بعد بدايتها (استخدم 0–24 للإغلاق المستمر)' });
    const seg = SEGMENT_BY_ID.get(v.segmentId);
    if (seg && v.closureType === 'partial' && v.affectedLanes >= seg.lanesPerDirection)
      ctx.addIssue({ code: 'custom', path: ['affectedLanes'], message: `المقطع به ${seg.lanesPerDirection} مسارات لكل اتجاه؛ إغلاق ${v.affectedLanes} يعني إغلاقاً كلياً — اختر "كلي" أو قلل المسارات` });
  });

type Form = z.infer<typeof FormSchema>;

function nearestHood(p: [number, number]) {
  let best = ZONES[0];
  for (const z of ZONES) if (haversineKm(z.coord, p) < haversineKm(best.coord, p)) best = z;
  return best.name;
}

export function RegisterPage() {
  const navigate = useNavigate();
  const draft = useStore((s) => s.draft);
  const setDraft = useStore((s) => s.setDraft);
  const addProject = useStore((s) => s.addProject);
  const projects = useStore((s) => s.projects);
  const toast = useStore((s) => s.toast);
  const cameraCmd = useStore((s) => s.cameraCmd);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Project | null>(null);
  const [f, setF] = useState({
    title: '',
    orgId: 'water' as OrgId,
    category: 'water' as Category,
    start: '2026-12-14',
    end: '2026-12-27',
    workStart: 0,
    workEnd: 24,
    priority: 'medium' as Priority,
    earliestStart: '2026-12-07',
    latestEnd: '2027-02-15',
    closureType: 'partial' as ClosureType,
    affectedLanes: 1,
    estimatedCostSar: 2500000,
    notes: '',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!draft.segmentId) setDraft({ pickStage: 'segment' });
    return () => setDraft({ pickStage: 'idle' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const seg = draft.segmentId ? SEGMENT_BY_ID.get(draft.segmentId) : undefined;
  const lenM = seg ? closureLengthKm({ closures: [{ segmentId: seg.id, from: draft.from, to: draft.to }] }) * 1000 : 0;
  const duration = dayIndex(f.end) - dayIndex(f.start) + 1;
  const flex = dayIndex(f.latestEnd) - dayIndex(f.earliestStart) + 1 - duration;

  const submit = () => {
    const candidate = { ...f, segmentId: draft.segmentId ?? '', from: draft.from, to: draft.to, notes: f.notes || undefined };
    const parsed = FormSchema.safeParse(candidate);
    if (!parsed.success) {
      const e: Record<string, string> = {};
      for (const i of parsed.error.issues) e[String(i.path[0])] ??= i.message;
      setErrors(e);
      toast({ tone: 'error', title: 'تعذّر التسجيل', body: 'يرجى تصحيح الحقول المظللة.' });
      return;
    }
    setErrors({});
    const v: Form = parsed.data;
    const n = projects.filter((p) => p.id.startsWith('RASD-U')).length + 1;
    const p: Project = {
      id: `RASD-U${String(n).padStart(2, '0')}`,
      title: v.title,
      orgId: v.orgId,
      category: v.category,
      closures: [{ segmentId: v.segmentId, from: v.from, to: v.to }],
      proposed: { start: v.start, end: v.end },
      schedule: { start: v.start, end: v.end },
      workHours: { start: v.workStart, end: v.workEnd },
      priority: v.priority,
      earliestStart: v.earliestStart,
      latestEnd: v.latestEnd,
      closureType: v.closureType,
      affectedLanes: v.closureType === 'full' ? SEGMENT_BY_ID.get(v.segmentId)!.lanesPerDirection : v.affectedLanes,
      estimatedCostSar: v.estimatedCostSar,
      status: 'submitted',
      neighborhood: '',
      createdAt: new Date().toISOString(),
      synthetic: true,
      notes: v.notes,
    };
    p.neighborhood = nearestHood(projectMidpoint(p));
    addProject(p);
    const after = useStore.getState().projects;
    const cs = actionable(getConflicts(after)).filter((c) => c.projectIds.includes(p.id));
    toast({ tone: cs.length ? 'warning' : 'success', title: 'تم تسجيل المشروع', body: cs.length ? `رصد ${cs.length} تعارض(ات) مع مشاريع أخرى` : 'لم يُرصد أي تعارض — جاهز للاعتماد' });
    setResult(p);
    cameraCmd({ type: 'fly', center: projectMidpoint(p), zoom: 15.6, pitch: 60 });
    setDraft({ segmentId: null, pickStage: 'idle' });
  };

  const resultConflicts = useMemo(() => (result ? actionable(getConflicts(projects)).filter((c) => c.projectIds.includes(result.id)) : []), [result, projects]);

  if (result)
    return (
      <SidePanel testid="register-result">
        <div className="space-y-4 overflow-y-auto p-5 scroll-thin">
          <div className="flex items-center gap-2 text-emerald-300">
            <CheckCircle2 size={20} />
            <span className="font-semibold">تم تسجيل المشروع وتحليله</span>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3 text-sm">
            <div className="num text-xs text-slate-400">{result.id}</div>
            <div className="mt-1 font-medium">{result.title}</div>
          </div>
          {resultConflicts.length ? (
            <div className="space-y-2" data-testid="register-conflicts">
              <div className="flex items-center gap-2 text-sm font-semibold text-red-300">
                <ShieldAlert size={16} /> رُصد {resultConflicts.length} تعارض
              </div>
              {resultConflicts.map((c) => (
                <div key={c.id} className="rounded-lg border border-red-400/20 bg-red-500/5 p-2.5 text-[12px]">
                  <div className="font-medium">
                    {SEVERITY_LABELS[c.severity].ar} · {CATEGORY_LABELS[c.category]}
                  </div>
                  <div className="mt-1 text-slate-400">{c.evidence[0]?.textAr}</div>
                </div>
              ))}
              <Button
                variant="primary"
                className="w-full"
                onClick={() => {
                  useStore.getState().selectConflict(resultConflicts[0].id);
                  navigate('/conflicts');
                }}
              >
                عرض تفاصيل التعارض
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border border-emerald-400/20 bg-emerald-500/5 p-3 text-[12.5px] text-emerald-200">لا توجد تعارضات مع المشاريع الحالية — يمكن اعتماده من لوحة التفاصيل.</div>
          )}
          <Button variant="outline" className="w-full" onClick={() => setResult(null)}>
            <FilePlus2 size={15} /> تسجيل مشروع آخر
          </Button>
        </div>
      </SidePanel>
    );

  return (
    <SidePanel width={400} testid="register-panel" tour="register-panel">
      <div className="border-b border-white/6 p-4">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          <FilePlus2 size={17} className="text-cyan-300" /> تسجيل مشروع جديد
        </h2>
        <p className="mt-1 text-[11.5px] text-slate-400">سيتم تحليل المشروع مكانياً وزمنياً وكشف التعارضات فور الإرسال.</p>
      </div>
      <div className="scroll-thin flex-1 space-y-3 overflow-y-auto p-4">
        <div className={cn('rounded-xl border p-3', errors.segmentId ? 'border-red-400/40 bg-red-500/5' : 'border-cyan-400/25 bg-cyan-400/[0.04]')} data-tour="pick-segment">
          <div className="flex items-center gap-2 text-[12.5px] font-medium text-cyan-100">
            <MousePointerClick size={15} />
            {draft.pickStage === 'segment' ? '١) انقر على مقطع طريق في الخريطة' : draft.pickStage === 'end' ? '٢) انقر مرة أخرى على نفس المقطع لتحديد نهاية الإغلاق' : 'حدود الإغلاق محددة'}
          </div>
          <select
            className={cn(inputCls, 'mt-2 py-1.5 text-[12.5px]')}
            value={draft.segmentId ?? ''}
            onChange={(e) => setDraft({ segmentId: e.target.value || null, from: 0.2, to: 0.8, pickStage: e.target.value ? 'idle' : 'segment' })}
            aria-label="مقطع الطريق"
            data-testid="segment-select"
          >
            <option value="">— أو اختر المقطع من القائمة —</option>
            {CLOSABLE_SEGMENTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.id}
              </option>
            ))}
          </select>
          {seg && (
            <div className="mt-2 space-y-1.5">
              <div className="text-[12px] text-slate-300">
                {seg.name} — <span className="num">{seg.lanesPerDirection}</span> مسارات/اتجاه · طول الإغلاق <span className="num">{fmtNum(lenM)}</span> م
              </div>
              <label className="flex items-center gap-2 text-[11px] text-slate-400">
                البداية
                <input type="range" min={0} max={1} step={0.01} value={draft.from} onChange={(e) => setDraft({ from: Math.min(Number(e.target.value), draft.to - 0.05) })} className="flex-1" aria-label="بداية الإغلاق" />
                <span className="num w-9">{Math.round(draft.from * 100)}%</span>
              </label>
              <label className="flex items-center gap-2 text-[11px] text-slate-400">
                النهاية
                <input type="range" min={0} max={1} step={0.01} value={draft.to} onChange={(e) => setDraft({ to: Math.max(Number(e.target.value), draft.from + 0.05) })} className="flex-1" aria-label="نهاية الإغلاق" />
                <span className="num w-9">{Math.round(draft.to * 100)}%</span>
              </label>
              <button className="text-[11px] text-cyan-300 hover:underline" onClick={() => setDraft({ pickStage: 'segment' })}>
                إعادة التحديد من الخريطة
              </button>
            </div>
          )}
          {errors.segmentId && <div className="mt-1 text-[11px] text-red-400">{errors.segmentId}</div>}
          {errors.to && <div className="mt-1 text-[11px] text-red-400">{errors.to}</div>}
        </div>

        <Field label="عنوان المشروع" error={errors.title}>
          <input className={inputCls} value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="مثال: تمديد خط مياه فرعي" data-testid="f-title" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="الجهة المنفذة">
            <select className={inputCls} value={f.orgId} onChange={(e) => set('orgId', e.target.value as OrgId)} data-testid="f-org">
              {Object.entries(ORGANIZATIONS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.ar}
                </option>
              ))}
            </select>
          </Field>
          <Field label="نوع البنية التحتية">
            <select className={inputCls} value={f.category} onChange={(e) => set('category', e.target.value as Category)} data-testid="f-category">
              {Object.entries(CATEGORIES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.ar}
                </option>
              ))}
            </select>
          </Field>
          <Field label="تاريخ البداية" error={errors.start}>
            <input type="date" className={cn(inputCls, 'num')} value={f.start} onChange={(e) => set('start', e.target.value)} data-testid="f-start" />
          </Field>
          <Field label="تاريخ النهاية" error={errors.end}>
            <input type="date" className={cn(inputCls, 'num')} value={f.end} onChange={(e) => set('end', e.target.value)} data-testid="f-end" />
          </Field>
          <Field label="أبكر موعد مسموح" error={errors.earliestStart}>
            <input type="date" className={cn(inputCls, 'num')} value={f.earliestStart} onChange={(e) => set('earliestStart', e.target.value)} />
          </Field>
          <Field label="آخر موعد إنجاز" error={errors.latestEnd}>
            <input type="date" className={cn(inputCls, 'num')} value={f.latestEnd} onChange={(e) => set('latestEnd', e.target.value)} />
          </Field>
          <Field label="بداية ساعات العمل">
            <input type="number" min={0} max={23} className={cn(inputCls, 'num')} value={f.workStart} onChange={(e) => set('workStart', Number(e.target.value))} />
          </Field>
          <Field label="نهاية ساعات العمل" error={errors.workEnd}>
            <input type="number" min={1} max={24} className={cn(inputCls, 'num')} value={f.workEnd} onChange={(e) => set('workEnd', Number(e.target.value))} />
          </Field>
          <Field label="الأولوية">
            <select className={inputCls} value={f.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
              {Object.entries(PRIORITIES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.ar}
                </option>
              ))}
            </select>
          </Field>
          <Field label="نوع الإغلاق">
            <select className={inputCls} value={f.closureType} onChange={(e) => set('closureType', e.target.value as ClosureType)} data-testid="f-closure-type">
              <option value="partial">جزئي (مسارات محددة)</option>
              <option value="full">كلي</option>
            </select>
          </Field>
          <Field label="المسارات المتأثرة/اتجاه" error={errors.affectedLanes}>
            <input type="number" min={1} max={6} disabled={f.closureType === 'full'} className={cn(inputCls, 'num')} value={f.affectedLanes} onChange={(e) => set('affectedLanes', Number(e.target.value))} data-testid="f-lanes" />
          </Field>
          <Field label="التكلفة التقديرية (ر.س)" error={errors.estimatedCostSar}>
            <input type="number" min={0} step={100000} className={cn(inputCls, 'num')} value={f.estimatedCostSar} onChange={(e) => set('estimatedCostSar', Number(e.target.value))} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-white/[0.03] p-2.5 text-[11.5px] text-slate-400">
          <div>
            المدة: <span className="num text-slate-200">{Number.isFinite(duration) ? duration : '—'}</span> يوم
          </div>
          <div>
            نافذة المرونة: <span className={cn('num', flex < 0 ? 'text-red-300' : 'text-slate-200')}>{Number.isFinite(flex) ? flex : '—'}</span> يوم
          </div>
          <div className="col-span-2">حالة المشروع عند الإرسال: مُقدَّم ← تحليل تلقائي للتعارضات</div>
        </div>
        <Field label="ملاحظات (اختياري)">
          <textarea className={inputCls} rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
      <div className="border-t border-white/6 p-3">
        <Button variant="primary" className="w-full" onClick={submit} data-testid="submit-project">
          إرسال المشروع وتحليل التعارضات
        </Button>
        <div className="mt-1.5 text-center text-[10.5px] text-slate-500">
          المدة الحالية: <span className="num">{durationDays({ start: f.start, end: f.end }) || '—'}</span> يوم · سجل محفوظ محلياً في المتصفح
        </div>
      </div>
    </SidePanel>
  );
}
