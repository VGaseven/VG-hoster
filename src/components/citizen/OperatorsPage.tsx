import { useMemo, useState } from 'react';
import { Bus, CalendarClock, Download, Route } from 'lucide-react';
import { useStore } from '@/store/store';
import { SEGMENT_BY_ID } from '@/data/network';
import { ORGANIZATIONS } from '@/data/organizations';
import { assign, BASELINE } from '@/engine/traffic/assignment';
import { combineEffects } from '@/engine/traffic/effects';
import { dijkstra, nodeIdx, tracePath } from '@/engine/routing/router';
import { citizenVisible } from '@/engine/routing/journey';
import { Badge, Button, Panel, SimBadge, Toggle } from '@/components/ui/ui';
import { dayIndex, fmtDate, fmtWorkHours, TODAY_SIM } from '@/utils/date';
import { fmtNum } from '@/utils/format';
import type { Project } from '@/types';

/** Detour around a closed block for through movements (peak hour, local model). */
function blockDetour(p: Project) {
  const c = p.closures[0];
  const seg = SEGMENT_BY_ID.get(c.segmentId)!;
  const r = assign(combineEffects([{ ...p, coordinationGroup: undefined }]), 3);
  const base = BASELINE(3);
  const route = (res: typeof r) => {
    const tree = dijkstra(res.graph, nodeIdx(seg.from), res.times);
    const path = tracePath(tree, res.graph, nodeIdx(seg.to));
    if (!path) return null;
    return { min: path.reduce((s, li) => s + res.times[li], 0) * 60, roads: [...new Set(path.map((li) => SEGMENT_BY_ID.get(res.graph.links[li].segId)!.name))] };
  };
  return { normal: route(base), now: route(r) };
}

/** Transport operators: prepare passenger trips and services before published closures. */
export function OperatorsPage() {
  const projects = useStore((s) => s.projects);
  const [pending, setPending] = useState(false);
  const today = dayIndex(TODAY_SIM);
  const list = useMemo(
    () =>
      projects
        .filter((p) => citizenVisible(p, pending))
        .sort((a, b) => dayIndex(a.schedule.start) - dayIndex(b.schedule.start))
        .map((p) => ({ p, d: blockDetour(p), lead: dayIndex(p.schedule.start) - today })),
    [projects, pending, today],
  );
  const csv = () => {
    const rows = [['project_id', 'title', 'road', 'start', 'end', 'hours', 'closure', 'status', 'lead_days', 'detour_extra_min'].join(',')];
    for (const { p, d, lead } of list)
      rows.push([p.id, `"${p.title}"`, `"${SEGMENT_BY_ID.get(p.closures[0].segmentId)?.nameEn}"`, p.schedule.start, p.schedule.end, `${p.workHours.start}-${p.workHours.end}`, p.closureType, p.status, lead, d.now && d.normal ? (d.now.min - d.normal.min).toFixed(1) : ''].join(','));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + rows.join('\n')], { type: 'text/csv' }));
    a.download = 'rasd-operator-closures.csv';
    a.click();
  };
  return (
    <div className="scroll-thin h-full overflow-y-auto p-6" data-testid="operators-page">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Bus className="text-violet-300" /> مشغّلو النقل
        </h1>
        <SimBadge />
        <div className="mr-auto flex items-center gap-3">
          <div className="w-64">
            <Toggle label="تضمين الإغلاقات قيد الاعتماد" checked={pending} onChange={setPending} />
          </div>
          <Button variant="outline" onClick={csv}>
            <Download size={15} /> تصدير للتخطيط (CSV)
          </Button>
        </div>
      </div>
      <p className="mb-4 max-w-3xl text-[13px] text-slate-400">الاستعداد للإغلاقات وتخطيط رحلات الركاب والخدمات مسبقاً: الإغلاقات المعتمدة، مدة الإشعار المسبق، والالتفاف المقترح حول المقطع المغلق (تقديرات نموذج محلي، دون تكامل مع أنظمة تشغيل فعلية).</p>
      <div className="grid gap-3 lg:grid-cols-2">
        {list.map(({ p, d, lead }) => (
          <Panel key={p.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[14px] font-semibold">{p.title}</div>
                <div className="mt-0.5 text-[11.5px] text-slate-400">
                  {ORGANIZATIONS[p.orgId].ar} · {SEGMENT_BY_ID.get(p.closures[0].segmentId)?.name}
                </div>
              </div>
              {p.status === 'approved' || p.status === 'scheduled' ? <Badge tone="emerald">معتمد ومعلن</Badge> : <Badge tone="amber">قيد الاعتماد</Badge>}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-[11.5px]">
              <div className="rounded-lg bg-black/20 p-2">
                <div className="flex items-center gap-1 text-slate-500">
                  <CalendarClock size={12} /> الفترة
                </div>
                <div className="num mt-0.5">{fmtDate(p.schedule.start)} – {fmtDate(p.schedule.end)}</div>
                <div className="text-slate-500">{fmtWorkHours(p.workHours)}</div>
              </div>
              <div className="rounded-lg bg-black/20 p-2">
                <div className="text-slate-500">إشعار مسبق</div>
                <div className="num mt-0.5 text-lg font-semibold text-cyan-200">{lead}</div>
                <div className="text-slate-500">يوماً قبل البدء</div>
              </div>
              <div className="rounded-lg bg-black/20 p-2">
                <div className="flex items-center gap-1 text-slate-500">
                  <Route size={12} /> زمن العبور الإضافي
                </div>
                <div className="num mt-0.5 text-lg font-semibold">{d.now && d.normal ? `+${fmtNum(Math.max(0, d.now.min - d.normal.min), 1)}` : 'مغلق'}</div>
                <div className="text-slate-500">دقيقة (ذروة، تقدير)</div>
              </div>
            </div>
            {d.now && <div className="mt-2 text-[11.5px] text-slate-400">الالتفاف المقترح عبر: {d.now.roads.join(' ← ')}</div>}
          </Panel>
        ))}
        {!list.length && <div className="text-sm text-slate-500">لا توجد إغلاقات معتمدة بعد — تظهر هنا بعد اعتماد الجهة المختصة.</div>}
      </div>
    </div>
  );
}
