import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Building2, CalendarRange, CheckCircle2, Clock, Crosshair, Gauge, Layers, MapPinned, ShieldAlert, Trash2, Wand2, XCircle } from 'lucide-react';
import type { Project } from '@/types';
import { useStore } from '@/store/store';
import { actionable, getConflicts, getMetrics } from '@/store/derived';
import { CATEGORIES, ORGANIZATIONS, PRIORITIES, STATUSES } from '@/data/organizations';
import { SEGMENT_BY_ID } from '@/data/network';
import { closureLengthKm, projectMidpoint } from '@/engine/spatial/geometry';
import { durationDays, fmtDate, fmtWorkHours } from '@/utils/date';
import { flexDays } from '@/engine/optimization/optimize';
import { Badge, Button, Dialog, inputCls } from '@/components/ui/ui';
import { fmtNum, fmtSar } from '@/utils/format';
import { CATEGORY_LABELS, SEVERITY_LABELS } from '@/engine/conflicts/detect';
import { evaluateSchedule } from '@/engine/optimization/optimize';

function impactOf(p: Project, all: Project[], economics: ReturnType<typeof useStore.getState>['economics']) {
  const without = all.filter((x) => x.id !== p.id);
  const a = getMetrics(all, economics);
  const b = evaluateSchedule(without, economics);
  return { delay: a.vehicleHoursDelay - b.vehicleHoursDelay, cost: a.economicCostSar - b.economicCostSar };
}

const impactCache = new WeakMap<Project[], Map<string, { delay: number; cost: number }>>();

export function ProjectDetails({ project }: { project: Project }) {
  const navigate = useNavigate();
  const all = useStore((s) => s.projects);
  const economics = useStore((s) => s.economics);
  const setStatus = useStore((s) => s.setStatus);
  const removeProject = useStore((s) => s.removeProject);
  const cameraCmd = useStore((s) => s.cameraCmd);
  const selectConflict = useStore((s) => s.selectConflict);
  const [dialog, setDialog] = useState<null | 'approve' | 'reject' | 'delete'>(null);
  const [rationale, setRationale] = useState('');
  const org = ORGANIZATIONS[project.orgId];
  const conflicts = actionable(getConflicts(all)).filter((c) => c.projectIds.includes(project.id));
  let cache = impactCache.get(all);
  if (!cache) impactCache.set(all, (cache = new Map()));
  let impact = cache.get(project.id);
  if (!impact) cache.set(project.id, (impact = impactOf(project, all, economics)));
  const impactScore = Math.min(100, Math.round(Math.sqrt(Math.max(0, impact.delay)) / 2.2));
  const st = STATUSES[project.status];
  const moved = project.schedule.start !== project.proposed.start || project.schedule.end !== project.proposed.end;

  const Row = ({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) => (
    <div className="flex items-start gap-2.5 py-1.5 text-[12.5px]">
      <span className="mt-0.5 text-slate-500">{icon}</span>
      <span className="w-28 shrink-0 text-slate-400">{label}</span>
      <span className="min-w-0 flex-1 text-slate-100">{children}</span>
    </div>
  );

  return (
    <div className="space-y-3" data-testid="project-details">
      <div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={st.tone}>{st.ar}</Badge>
          <Badge tone="slate">
            <span className="num">{project.id}</span>
          </Badge>
          {project.coordinationGroup && <Badge tone="cyan">منطقة عمل مشتركة</Badge>}
        </div>
        <h3 className="mt-2 text-[15px] font-semibold leading-snug">{project.title}</h3>
      </div>
      <div className="rounded-xl border border-white/6 bg-white/[0.02] px-3 py-1">
        <Row icon={<Building2 size={14} />} label="الجهة">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: org.color }} />
            {org.ar}
          </span>
        </Row>
        <Row icon={<Layers size={14} />} label="نوع المشروع">
          {CATEGORIES[project.category].ar}
        </Row>
        <Row icon={<CalendarRange size={14} />} label="التواريخ">
          <span>
            {fmtDate(project.schedule.start)} ← {fmtDate(project.schedule.end)} <span className="text-slate-500">({durationDays(project.schedule)} يوم)</span>
          </span>
          {moved && (
            <span className="mt-0.5 block text-[11px] text-amber-300/90">
              المقترح الأصلي: {fmtDate(project.proposed.start)} ← {fmtDate(project.proposed.end)}
            </span>
          )}
        </Row>
        <Row icon={<Clock size={14} />} label="ساعات العمل">
          {fmtWorkHours(project.workHours)}
        </Row>
        <Row icon={<MapPinned size={14} />} label="حدود الإغلاق">
          {project.closures.map((c) => (
            <span key={c.segmentId} className="block">
              {SEGMENT_BY_ID.get(c.segmentId)?.name} <span className="num text-slate-500">({Math.round(c.from * 100)}%–{Math.round(c.to * 100)}% · {fmtNum(closureLengthKm(project) * 1000)} م)</span>
            </span>
          ))}
          <span className="text-[11px] text-slate-400">
            {project.closureType === 'full' ? 'إغلاق كلي' : `إغلاق جزئي — ${project.affectedLanes} مسار لكل اتجاه`}
          </span>
        </Row>
        <Row icon={<ShieldAlert size={14} />} label="الأولوية">
          {PRIORITIES[project.priority].ar}
        </Row>
        <Row icon={<Gauge size={14} />} label="المرونة">
          <span className="num">{flexDays(project)}</span> يوم ضمن النافذة {fmtDate(project.earliestStart)} – {fmtDate(project.latestEnd)}
        </Row>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-white/6 bg-white/[0.02] p-2.5">
          <div className="text-[11px] text-slate-400">مؤشر الأثر</div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-l from-red-500 via-amber-400 to-emerald-400" style={{ width: `${impactScore}%` }} />
            </div>
            <span className="num text-sm font-semibold">{impactScore}</span>
          </div>
          <div className="mt-1 text-[10.5px] text-slate-500">
            <span className="num">{fmtNum(impact.delay)}</span> مركبة-ساعة تأخير هامشي
          </div>
        </div>
        <div className="rounded-xl border border-white/6 bg-white/[0.02] p-2.5">
          <div className="text-[11px] text-slate-400">التكلفة التقديرية للمشروع</div>
          <div className="num mt-1 text-sm font-semibold">{fmtSar(project.estimatedCostSar)}</div>
          <div className="mt-0.5 text-[10.5px] text-slate-500">أثر مروري تقديري: {fmtSar(impact.cost)}</div>
        </div>
      </div>
      {conflicts.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-red-300">تعارضات مرتبطة ({conflicts.length})</div>
          {conflicts.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                selectConflict(c.id);
                navigate('/conflicts');
              }}
              className="flex w-full items-center justify-between rounded-lg border border-red-400/15 bg-red-500/5 px-2.5 py-1.5 text-right text-[12px] hover:border-red-400/40"
            >
              <span>
                {CATEGORY_LABELS[c.category]} · {SEVERITY_LABELS[c.severity].ar}
              </span>
              <span className="num text-slate-400">{c.projectIds.find((x) => x !== project.id)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2" data-tour="decisions">
        <Button size="sm" variant="outline" onClick={() => cameraCmd({ type: 'fly', center: projectMidpoint(project), zoom: 16, pitch: 62 })}>
          <Crosshair size={14} /> تركيز الكاميرا
        </Button>
        {conflicts.length > 0 ? (
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              selectConflict(conflicts[0].id);
              navigate('/optimize');
            }}
          >
            <Wand2 size={14} /> اقتراح بدائل
          </Button>
        ) : (
          <Button size="sm" variant="success" disabled={project.status === 'approved' || project.status === 'scheduled'} onClick={() => setDialog('approve')} data-testid="approve-project">
            <CheckCircle2 size={14} /> اعتماد
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setStatus(project.id, 'under_review', 'إحالة للمراجعة الفنية')} disabled={project.status === 'under_review'}>
          إحالة للمراجعة
        </Button>
        <Button size="sm" variant="ghost" className="text-rose-300" onClick={() => setDialog('reject')} disabled={project.status === 'rejected'}>
          <XCircle size={14} /> رفض
        </Button>
        {project.id.startsWith('RASD-U') && (
          <Button size="sm" variant="ghost" className="col-span-2 text-slate-400" onClick={() => setDialog('delete')}>
            <Trash2 size={14} /> حذف المشروع المسجّل
          </Button>
        )}
      </div>
      <Dialog
        open={!!dialog}
        onClose={() => setDialog(null)}
        title={dialog === 'approve' ? 'تأكيد اعتماد المشروع' : dialog === 'reject' ? 'تأكيد رفض المشروع' : 'حذف المشروع'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              إلغاء
            </Button>
            <Button
              variant={dialog === 'approve' ? 'success' : 'danger'}
              data-testid="confirm-dialog"
              onClick={() => {
                if (dialog === 'delete') removeProject(project.id);
                else setStatus(project.id, dialog === 'approve' ? 'approved' : 'rejected', rationale || (dialog === 'approve' ? 'اعتماد دون تعارض' : 'رفض'));
                useStore.getState().toast({ tone: dialog === 'approve' ? 'success' : 'warning', title: dialog === 'approve' ? 'تم اعتماد المشروع' : dialog === 'reject' ? 'تم رفض المشروع' : 'تم حذف المشروع' });
                setDialog(null);
                setRationale('');
              }}
            >
              تأكيد
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-slate-300">{project.title}</p>
        {dialog !== 'delete' && <textarea className={inputCls} rows={3} placeholder="مبررات القرار (تُسجَّل في سجل التدقيق)" value={rationale} onChange={(e) => setRationale(e.target.value)} />}
      </Dialog>
    </div>
  );
}
