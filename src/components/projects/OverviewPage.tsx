import { useNavigate } from 'react-router';
import { AlertTriangle, CalendarDays, Gauge, Landmark, PlayCircle, Sparkles, Zap } from 'lucide-react';
import { SidePanel } from '@/app/Layout';
import { useStore } from '@/store/store';
import { actionable, getMetrics, useConflicts } from '@/store/derived';
import { Button, Stat } from '@/components/ui/ui';
import { ProjectList } from './ProjectList';
import { fmtNum, fmtSar } from '@/utils/format';
import { useT } from '@/i18n/i18n';
import { useMemo } from 'react';

export function OverviewPage() {
  const t = useT();
  const navigate = useNavigate();
  const projects = useStore((s) => s.projects);
  const economics = useStore((s) => s.economics);
  const setDemo = useStore((s) => s.setDemo);
  const conflicts = actionable(useConflicts(projects));
  const m = useMemo(() => getMetrics(projects, economics), [projects, economics]);
  const resolved = projects.filter((p) => p.status === 'scheduled' || p.status === 'approved').length;
  return (
    <SidePanel testid="overview-panel" tour="overview-panel">
      <div className="border-b border-white/6 p-4">
        <div className="text-[11px] font-medium tracking-wide text-cyan-300/80">مركز عمليات تنسيق الإغلاقات · الرياض</div>
        <h1 className="mt-1 text-lg font-bold leading-snug">ننسق قبل الإغلاق، ونتنبأ قبل التعطيل</h1>
        <p className="mt-1 text-[12px] leading-relaxed text-slate-400">تسجيل المشاريع ← تحليل مكاني ← كشف التعارض ← محاكاة الأثر ← تحسين الجدولة ← اعتماد حكومي ← إشعار المواطن.</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="primary" onClick={() => navigate('/conflicts?scenario=1')} data-tour="simulate-conflict" data-testid="simulate-conflict-cta">
            <Zap size={15} /> {t('محاكاة تعارض جديد')}
          </Button>
          <Button variant="outline" onClick={() => setDemo(true)}>
            <Sparkles size={15} /> {t('عرض الحكام')}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 p-4 pb-2">
        <Stat label="المشاريع المسجلة" value={projects.length} icon={<Landmark size={12} />} sub={`${resolved} معتمد/مجدول`} />
        <Stat label="تعارضات مكتشفة" value={conflicts.length} tone={conflicts.length ? 'text-red-300' : 'text-emerald-300'} icon={<AlertTriangle size={12} />} sub={`${conflicts.filter((c) => c.severity === 'high').length} مرتفعة`} />
        <Stat label="تأخير المركبات (الأفق)" value={fmtNum(m.vehicleHoursDelay)} sub="مركبة-ساعة (تقديري)" icon={<Gauge size={12} />} />
        <Stat label="الأثر الاقتصادي" value={fmtSar(m.economicCostSar)} sub="نموذج توضيحي" icon={<CalendarDays size={12} />} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[13px] font-semibold">{t('المشاريع')}</span>
          <button className="flex items-center gap-1 text-[11.5px] text-cyan-300 hover:text-cyan-200" onClick={() => useStore.getState().setPlaying(true)}>
            <PlayCircle size={13} /> تشغيل الخط الزمني
          </button>
        </div>
        <ProjectList />
      </div>
    </SidePanel>
  );
}
