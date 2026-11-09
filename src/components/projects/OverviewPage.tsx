import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Building2, Bus, HardHat, Landmark, PlayCircle, Sparkles, Users } from 'lucide-react';
import { SidePanel } from '@/app/Layout';
import { useStore } from '@/store/store';
import { actionable, beforeProjects, getMetrics, useConflicts } from '@/store/derived';
import { Button } from '@/components/ui/ui';
import { ProjectList } from './ProjectList';
import { WorkflowStepper } from '@/components/layout/WorkflowStepper';
import { startShow } from '@/components/tutorial/RasdShow';
import { fmtNum, cn } from '@/utils/format';

export const STAKEHOLDERS = [
  { id: 'citizens', title: 'المواطنون والمقيمون', body: 'معرفة الإغلاقات المخطط لها مبكراً، والاستعداد للرحلة واختيار البدائل.', to: '/citizen', icon: Users },
  { id: 'authorities', title: 'الجهات المختصة', body: 'تنسيق المشاريع ومراجعة بدائل الجداول قبل اعتماد الإغلاق.', to: '/conflicts', icon: Landmark },
  { id: 'executors', title: 'الجهات المنفّذة', body: 'شركات المقاولات والمرافق: خطط أوضح وتقليل تعارض الأعمال.', to: '/register', icon: HardHat },
  { id: 'operators', title: 'مشغّلو النقل', body: 'الاستعداد للإغلاقات وتخطيط رحلات الركاب والخدمات مسبقاً.', to: '/operators', icon: Bus },
];

export function OverviewPage() {
  const navigate = useNavigate();
  const projects = useStore((s) => s.projects);
  const economics = useStore((s) => s.economics);
  const conflicts = actionable(useConflicts(projects));
  const before = beforeProjects(projects);
  const mA = useMemo(() => getMetrics(projects, economics), [projects, economics]);
  const mB = useMemo(() => getMetrics(before, economics), [before, economics]);
  const decisions = useStore((s) => s.audit.filter((a) => a.action === 'approve_option' || a.action === 'modify_option').length);
  return (
    <SidePanel width={400} testid="overview-panel" tour="overview-panel">
      <div className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="border-b border-white/6 p-4">
          <div className="text-[11px] font-medium tracking-wide text-violet-300">نقل ثون ٥ · التنقل الذكي المدعوم بالبيانات</div>
          <h1 className="mt-1 text-lg font-bold leading-snug">تنسيقٌ مبكر يحمي حركة المدينة</h1>
          <p className="mt-1 text-[12px] leading-relaxed text-slate-400">خدمة تجمع خطط الإغلاقات، تكشف تعارضها وتقارن بدائلها، وتُظهر الإغلاقات مسبقاً لمستخدمي الطريق.</p>
          <div className="mt-3 overflow-x-auto">
            <WorkflowStepper compact />
          </div>
          <Button variant="primary" className="mt-3 w-full" onClick={() => startShow(0)} data-tour="simulate-conflict" data-testid="show-cta">
            <Sparkles size={15} /> عرض سيناريو رصد
          </Button>
        </div>
        <div className="p-4 pb-2">
          <div className="mb-2 flex items-center justify-between text-[12px]">
            <span className="font-semibold text-slate-200">ما الذي نريد تحسينه؟</span>
            <span className="text-[10.5px] text-slate-500">الخطة الأصلية ← الحالية ({decisions} قرار)</span>
          </div>
          <div className="space-y-2" data-testid="primary-outcomes">
            <OutcomeRow title="إغلاقات أقل تكراراً" hint="مرات إغلاق المقاطع" b={mB.closureEpisodes} a={mA.closureEpisodes} />
            <OutcomeRow title="أثر أخف على الحركة" hint="كم-يوم مغلق · التعارضات" b={mB.closureKmDays} a={mA.closureKmDays} digits={1} extra={`${mB.conflicts} ← ${mA.conflicts} تعارض`} />
            <OutcomeRow title="استعداد أفضل لمستخدم الطريق" hint="% من الإغلاقات معلنة مسبقاً" b={mB.visibleClosureShare} a={mA.visibleClosureShare} lowerIsBetter={false} />
          </div>
          <div className="mt-2 text-[10.5px] text-slate-500">
            مؤشر مُنمذج مساند: تأخير المركبات <span className="num">{fmtNum(mA.vehicleHoursDelay)}</span> مركبة-ساعة · التعارضات الحالية <span className="num">{conflicts.length}</span>
          </div>
        </div>
        <div className="px-4 pb-3">
          <div className="mb-2 text-[12px] font-semibold text-slate-200">المستفيدون</div>
          <div className="grid grid-cols-2 gap-2" data-testid="stakeholders">
            {STAKEHOLDERS.map((s) => (
              <button key={s.id} onClick={() => navigate(s.to)} className="rounded-xl border border-white/8 bg-white/[0.03] p-2.5 text-right transition hover:border-violet-400/40 hover:bg-violet-500/[0.06]" data-testid={`stakeholder-${s.id}`}>
                <div className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                  <s.icon size={14} className="text-violet-300" /> {s.title}
                </div>
                <div className="mt-1 text-[10.5px] leading-relaxed text-slate-400">{s.body}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="flex min-h-[260px] flex-1 flex-col px-4 pb-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[13px] font-semibold">
              <Building2 size={14} className="text-violet-300" /> مشاريع الحي (افتراضية)
            </span>
            <button className="flex items-center gap-1 text-[11.5px] text-cyan-300 hover:text-cyan-200" onClick={() => useStore.getState().setPlaying(true)}>
              <PlayCircle size={13} /> تشغيل الخط الزمني
            </button>
          </div>
          <ProjectList />
        </div>
      </div>
    </SidePanel>
  );
}

function OutcomeRow({ title, hint, b, a, digits = 0, lowerIsBetter = true, extra }: { title: string; hint: string; b: number; a: number; digits?: number; lowerIsBetter?: boolean; extra?: string }) {
  const better = lowerIsBetter ? a < b - 1e-9 : a > b + 1e-9;
  const worse = lowerIsBetter ? a > b + 1e-9 : a < b - 1e-9;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-semibold">{title}</div>
        <div className="text-[10.5px] text-slate-500">
          {hint}
          {extra && <span className="num"> · {extra}</span>}
        </div>
      </div>
      <div className="num text-left text-[13px]">
        <span className="text-slate-500">{fmtNum(b, digits)}</span>
        <span className="mx-1 text-slate-600">→</span>
        <b className={cn(better ? 'text-emerald-300' : worse ? 'text-red-300' : 'text-slate-200')}>{fmtNum(a, digits)}</b>
      </div>
    </div>
  );
}
