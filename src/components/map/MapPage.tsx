import { SidePanel } from '@/app/Layout';
import { useStore, simDayOf, simHourOf } from '@/store/store';
import { useSnapshot, beforeProjects } from '@/store/derived';
import { accessibilityScore, BANDS, hourlyDelay, PEAK_TRIPS } from '@/engine/traffic/assignment';
import { SEGMENT_BY_ID, GEOMETRY_NOTE_AR } from '@/data/network';
import { fmtNum } from '@/utils/format';
import { Stat, SimBadge } from '@/components/ui/ui';
import { Car, Clapperboard, Coins, FilePlus2, Gauge, Pause, Play, Radar, RotateCcw, Route, ShieldCheck, Sparkles, UserRound, Wand2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { actionable, getConflicts } from '@/store/derived';
import { generateOptions } from '@/engine/optimization/optimize';

export function MapPage() {
  const all = useStore((s) => s.projects);
  const viewMode = useStore((s) => s.viewMode);
  const simTime = useStore((s) => s.simTime);
  const projects = viewMode === 'before' ? beforeProjects(all) : all;
  const snap = useSnapshot(projects, simDayOf(simTime), simHourOf(simTime));
  const r = snap.result;
  const navigate = useNavigate();
  const applyBest = () => {
    const st = useStore.getState();
    const c = actionable(getConflicts(st.projects)).find((x) => x.id === st.selectedConflictId) ?? actionable(getConflicts(st.projects))[0];
    if (!c) return st.toast({ tone: 'info', title: 'لا توجد تعارضات تحتاج قراراً' });
    const best = generateOptions(c, st.projects, st.weights, st.economics).options.find((o) => o.recommended);
    if (!best) return st.toast({ tone: 'warning', title: 'لا يوجد بديل ممكن', body: 'راجع مركز تحسين الجدولة للتفاصيل.' });
    st.approveOption(c.id, best, `اعتماد سريع من مركز التحكم: ${best.titleAr}`);
    st.toast({ tone: 'success', title: 'تم تطبيق الحل', body: `${best.titleAr} · ${c.projectIds.join(' ↔ ')}` });
  };
  const controls: [string, React.ReactNode, () => void, string][] = [
    ['بدء المحاكاة', <Play size={14} />, () => useStore.getState().setPlaying(true), 'ctl-play'],
    ['إيقاف مؤقت', <Pause size={14} />, () => useStore.getState().setPlaying(false), 'ctl-pause'],
    ['إعادة التشغيل', <RotateCcw size={14} />, () => useStore.getState().restartSim(), 'ctl-restart'],
    ['إضافة مشروع', <FilePlus2 size={14} />, () => navigate('/register'), 'ctl-add'],
    ['كشف التعارض', <Radar size={14} />, () => navigate('/conflicts'), 'ctl-detect'],
    ['مقارنة الحلول', <Wand2 size={14} />, () => navigate('/optimize'), 'ctl-compare'],
    ['تطبيق الحل', <Sparkles size={14} />, applyBest, 'ctl-apply'],
    ['عرض تجربة المواطن', <UserRound size={14} />, () => navigate('/citizen'), 'ctl-citizen'],
    ['عرض الأثر الاقتصادي', <Coins size={14} />, () => navigate('/analytics'), 'ctl-economics'],
    ['تصدير الفيديو', <Clapperboard size={14} />, () => navigate('/studio'), 'ctl-video'],
  ];
  const busiest = [...r.vcBySeg.entries()].filter(([k, v]) => Number.isFinite(v) && SEGMENT_BY_ID.get(k)?.closable).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return (
    <SidePanel width={330} testid="map-panel">
      <div className="space-y-4 overflow-y-auto p-4 scroll-thin">
        <div>
          <h2 className="text-[15px] font-semibold">التوأم الرقمي — ممر العليا</h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-slate-400">حالة الشبكة في اللحظة المحاكاة الحالية. حرّك الخط الزمني لرؤية تغيّر الإغلاقات والحركة.</p>
          <div className="mt-2">
            <SimBadge />
          </div>
        </div>
        <div data-tour="control-center">
          <div className="mb-2 text-xs font-semibold text-slate-400">مركز التحكم بالمحاكاة</div>
          <div className="grid grid-cols-2 gap-1.5">
            {controls.map(([label, icon, fn, id]) => (
              <button key={id} onClick={fn} data-testid={id} className="flex h-8 items-center gap-1.5 rounded-lg border border-white/8 bg-white/[0.03] px-2 text-[11.5px] text-slate-200 transition hover:border-cyan-400/40 hover:bg-cyan-400/5 active:scale-[0.97]">
                <span className="text-cyan-300">{icon}</span>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="رحلات هذه الساعة (نموذج)" value={fmtNum(PEAK_TRIPS * BANDS[r.band])} sub="مركبة/ساعة" icon={<Car size={12} />} />
          <Stat label="أعلى V/C" value={fmtNum(r.maxVc, 2)} tone={r.maxVc > 1 ? 'text-red-300' : r.maxVc > 0.85 ? 'text-amber-300' : 'text-emerald-300'} icon={<Gauge size={12} />} />
          <Stat label="تأخير هذه الساعة" value={fmtNum(hourlyDelay(r))} sub="مركبة-ساعة" icon={<Route size={12} />} />
          <Stat label="مؤشر الوصول" value={fmtNum(accessibilityScore(r), 1)} sub="/100" icon={<ShieldCheck size={12} />} />
        </div>
        <div>
          <div className="mb-2 text-xs font-semibold text-slate-400">أكثر المقاطع ازدحاماً</div>
          {busiest.map(([id, vc]) => (
            <div key={id} className="mb-1.5">
              <div className="flex justify-between text-[11.5px]">
                <span className="truncate text-slate-300">{SEGMENT_BY_ID.get(id)?.name}</span>
                <span className="num text-slate-400">{fmtNum(vc, 2)}</span>
              </div>
              <div className="mt-0.5 h-1 rounded-full bg-white/8">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, vc * 70)}%`, background: vc > 1 ? '#ef4444' : vc > 0.85 ? '#f59e0b' : '#10b981' }} />
              </div>
            </div>
          ))}
        </div>
        <div>
          <div className="mb-2 text-xs font-semibold text-slate-400">دليل الألوان</div>
          <div className="space-y-1.5 text-[11.5px] text-slate-300">
            <div className="flex items-center gap-2"><span className="h-1 w-6 rounded bg-gradient-to-l from-red-600 via-amber-400 to-emerald-500" /> نسبة الحجم إلى السعة (V/C)</div>
            <div className="flex items-center gap-2"><span className="h-1 w-6 rounded bg-red-500" /> إغلاق في تعارض</div>
            <div className="flex items-center gap-2"><span className="h-1 w-6 rounded bg-amber-400" /> إغلاق مقترح / قيد الاعتماد</div>
            <div className="flex items-center gap-2"><span className="h-1 w-6 rounded bg-emerald-500" /> إغلاق معتمد / مجدول</div>
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-slate-200" /> مركبة محاكاة (أحمر = بطيئة)</div>
          </div>
        </div>
        <p className="rounded-lg bg-white/[0.03] p-2.5 text-[10.5px] leading-relaxed text-slate-500">{GEOMETRY_NOTE_AR} الحركة المرورية ناتجة عن نموذج توزيع مروري محلي (BPR + MSA) بطلب تركيبي، وليست بيانات حية.</p>
      </div>
    </SidePanel>
  );
}
