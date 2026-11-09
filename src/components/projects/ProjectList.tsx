import { useMemo, useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import type { OrgId, ProjectStatus } from '@/types';
import { useStore, simDayOf } from '@/store/store';
import { actionable, useConflicts } from '@/store/derived';
import { ORGANIZATIONS, STATUSES } from '@/data/organizations';
import { Badge, inputCls } from '@/components/ui/ui';
import { dayIndex, fmtShort } from '@/utils/date';
import { cn } from '@/utils/format';
import { useT } from '@/i18n/i18n';

export function ProjectList({ compact }: { compact?: boolean }) {
  const t = useT();
  const projects = useStore((s) => s.projects);
  const selected = useStore((s) => s.selectedProjectId);
  const select = useStore((s) => s.selectProject);
  const simTime = useStore((s) => s.simTime);
  const conflicts = actionable(useConflicts(projects));
  const [q, setQ] = useState('');
  const [org, setOrg] = useState<OrgId | 'all'>('all');
  const [status, setStatus] = useState<ProjectStatus | 'all'>('all');
  const [hood, setHood] = useState('all');
  const [when, setWhen] = useState<'all' | 'active' | 'upcoming'>('all');
  const [showFilters, setShowFilters] = useState(false);
  const hoods = useMemo(() => [...new Set(projects.map((p) => p.neighborhood))], [projects]);
  const cset = new Set(conflicts.flatMap((c) => c.projectIds));
  const day = simDayOf(simTime);
  const list = projects.filter((p) => {
    if (q && !`${p.title} ${p.id} ${ORGANIZATIONS[p.orgId].ar} ${p.neighborhood}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (org !== 'all' && p.orgId !== org) return false;
    if (status !== 'all' && p.status !== status) return false;
    if (hood !== 'all' && p.neighborhood !== hood) return false;
    if (when === 'active' && !(day >= dayIndex(p.schedule.start) && day <= dayIndex(p.schedule.end))) return false;
    if (when === 'upcoming' && !(dayIndex(p.schedule.start) > day)) return false;
    return true;
  });
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="project-list">
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <Search size={14} className="absolute right-2.5 top-2.5 text-slate-500" />
          <input className={cn(inputCls, 'py-1.5 pr-8 text-[13px]')} placeholder={t('بحث في المشاريع…')} value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث" data-testid="project-search" />
        </div>
        <button onClick={() => setShowFilters(!showFilters)} className={cn('grid w-9 place-items-center rounded-lg border border-white/10', showFilters ? 'bg-cyan-400/10 text-cyan-200' : 'text-slate-400')} aria-label="الفلاتر">
          <SlidersHorizontal size={15} />
        </button>
      </div>
      {showFilters && (
        <div className="mt-2 grid grid-cols-2 gap-1.5 text-[12px]">
          <select className={cn(inputCls, 'py-1 text-[12px]')} value={org} onChange={(e) => setOrg(e.target.value as OrgId | 'all')} aria-label="الجهة">
            <option value="all">كل الجهات</option>
            {Object.entries(ORGANIZATIONS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.ar}
              </option>
            ))}
          </select>
          <select className={cn(inputCls, 'py-1 text-[12px]')} value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus | 'all')} aria-label="الحالة">
            <option value="all">كل الحالات</option>
            {Object.entries(STATUSES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.ar}
              </option>
            ))}
          </select>
          <select className={cn(inputCls, 'py-1 text-[12px]')} value={hood} onChange={(e) => setHood(e.target.value)} aria-label="الحي">
            <option value="all">كل الأحياء</option>
            {hoods.map((h) => (
              <option key={h}>{h}</option>
            ))}
          </select>
          <select className={cn(inputCls, 'py-1 text-[12px]')} value={when} onChange={(e) => setWhen(e.target.value as typeof when)} aria-label="التاريخ">
            <option value="all">كل التواريخ</option>
            <option value="active">نشطة في التاريخ المحاكى</option>
            <option value="upcoming">قادمة</option>
          </select>
        </div>
      )}
      <div className="scroll-thin -mx-1 mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto px-1">
        {list.map((p) => {
          const org = ORGANIZATIONS[p.orgId];
          const st = STATUSES[p.status];
          return (
            <button
              key={p.id}
              onClick={() => select(p.id)}
              data-testid={`project-row-${p.id}`}
              className={cn(
                'group w-full rounded-xl border p-2.5 text-right transition',
                selected === p.id ? 'border-cyan-400/50 bg-cyan-400/[0.07]' : 'border-white/6 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]',
              )}
            >
              <div className="flex items-start gap-2">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: org.color, boxShadow: `0 0 8px ${org.color}` }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-medium text-slate-100">{p.title}</div>
                  {!compact && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                      <span>{org.short}</span>·<span className="num">{fmtShort(p.schedule.start)} – {fmtShort(p.schedule.end)}</span>
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge tone={st.tone}>{st.ar}</Badge>
                  {cset.has(p.id) && <span className="text-[10px] font-semibold text-red-400">⚠ تعارض</span>}
                </div>
              </div>
            </button>
          );
        })}
        {!list.length && <div className="py-8 text-center text-xs text-slate-500">لا توجد مشاريع مطابقة</div>}
      </div>
    </div>
  );
}
