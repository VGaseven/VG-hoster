import { AnimatePresence, motion } from 'motion/react';
import { Bell, CalendarClock, Languages, MapPin, Activity, Layers3, AlertOctagon, PauseCircle, PlayCircle } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useStore, simDayOf, simHourOf } from '@/store/store';
import { actionable, activeAt, beforeProjects, useConflicts } from '@/store/derived';
import { fmtDate, fmtHour, isoFromDay } from '@/utils/date';
import { useT } from '@/i18n/i18n';
import { SimBadge } from '@/components/ui/ui';
import { SEVERITY_LABELS } from '@/engine/conflicts/detect';
import { cn } from '@/utils/format';

export function TopBar() {
  const t = useT();
  const navigate = useNavigate();
  const lang = useStore((s) => s.lang);
  const setLang = useStore((s) => s.setLang);
  const all = useStore((s) => s.projects);
  const viewMode = useStore((s) => s.viewMode);
  const simTime = useStore((s) => s.simTime);
  const playing = useStore((s) => s.playing);
  const scenarioName = useStore((s) => s.scenarioName);
  const district = useStore((s) => s.district);
  const open = useStore((s) => s.notificationsOpen);
  const setOpen = useStore((s) => s.setNotificationsOpen);
  const audit = useStore((s) => s.audit);
  const selectConflict = useStore((s) => s.selectConflict);
  const fallback = useStore((s) => s.mapFallback);
  const projects = viewMode === 'before' ? beforeProjects(all) : all;
  const conflicts = actionable(useConflicts(projects));
  const day = simDayOf(simTime);
  const active = activeAt(projects, day, Math.floor(simHourOf(simTime)));

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start gap-2 p-3">
      <div className="glass pointer-events-auto flex h-11 min-w-0 flex-1 items-center gap-4 overflow-hidden whitespace-nowrap rounded-xl px-3.5 text-[12.5px]" data-tour="topbar">
        <span className="flex items-center gap-1.5 text-slate-300" title={t('المنطقة')}>
          <MapPin size={14} className="text-cyan-300" />
          <span className="font-medium">{district}</span>
          <span className="text-slate-500">· الرياض</span>
        </span>
        <span className="h-4 w-px bg-white/10" />
        <span className="flex items-center gap-1.5 text-slate-300" data-testid="sim-datetime">
          <CalendarClock size={14} className="text-cyan-300" />
          <span>{fmtDate(isoFromDay(day), lang)}</span>
          <span className="num text-slate-400">{fmtHour(simHourOf(simTime))}</span>
        </span>
        <span className="hidden h-4 w-px bg-white/10 xl:block" />
        <span className="hidden min-w-0 items-center gap-1.5 truncate text-slate-400 xl:flex">
          <Layers3 size={14} />
          {t('السيناريو')}: <span className="truncate text-slate-200">{scenarioName}</span>
          <span className={cn('rounded px-1.5 py-0.5 text-[10.5px] font-semibold', viewMode === 'after' ? 'bg-emerald-400/15 text-emerald-300' : 'bg-amber-400/15 text-amber-300')}>{viewMode === 'after' ? t('بعد التنسيق') : t('قبل التنسيق')}</span>
        </span>
        <span className="mr-auto flex items-center gap-3">
          <span className="flex items-center gap-1.5" title={t('المشاريع النشطة')}>
            <Activity size={14} className="text-emerald-300" />
            <span className="num font-semibold" data-testid="active-count">{active.size}</span>
            <span className="hidden text-slate-500 2xl:inline">{t('المشاريع النشطة')}</span>
          </span>
          <span className="flex items-center gap-1.5" title={t('التعارضات')}>
            <AlertOctagon size={14} className={conflicts.length ? 'text-red-400' : 'text-slate-500'} />
            <span className="num font-semibold" data-testid="conflict-count">{conflicts.length}</span>
            <span className="hidden text-slate-500 2xl:inline">{t('التعارضات')}</span>
          </span>
          <span className="flex items-center gap-1 text-slate-400" data-testid="sim-status">
            {playing ? <PlayCircle size={14} className="text-emerald-400" /> : <PauseCircle size={14} />}
            <span className="hidden 2xl:inline">{playing ? t('المحاكاة تعمل') : t('المحاكاة متوقفة')}</span>
          </span>
          <SimBadge />
          {fallback && (
            <span className="hidden rounded border border-sky-400/30 bg-sky-400/10 px-1.5 py-0.5 text-[10.5px] text-sky-300 2xl:inline" title="تعذّر تحميل الخريطة الأساسية من الإنترنت؛ يتم استخدام التوأم الرقمي المحلي">
              خريطة محلية
            </span>
          )}
        </span>
      </div>
      <div className="relative pointer-events-auto">
        <button
          onClick={() => setOpen(!open)}
          className="glass relative grid h-11 w-11 place-items-center rounded-xl text-slate-300 hover:text-white"
          aria-label={t('الإشعارات')}
          data-tour="notifications"
        >
          <Bell size={17} />
          {conflicts.length > 0 && <span className="num absolute -top-1 -left-1 grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{conflicts.length}</span>}
        </button>
        <AnimatePresence>
          {open && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="glass-strong absolute left-0 top-13 w-96 rounded-xl p-3">
              <div className="mb-2 text-xs font-semibold text-slate-400">{t('الإشعارات')}</div>
              <div className="scroll-thin max-h-96 space-y-1.5 overflow-y-auto">
                {conflicts.slice(0, 8).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      selectConflict(c.id);
                      setOpen(false);
                      navigate('/conflicts');
                    }}
                    className="block w-full rounded-lg border border-white/6 bg-white/[0.02] p-2 text-right hover:border-red-400/30"
                  >
                    <div className="flex items-center gap-2 text-[12px] font-medium">
                      <span className={cn('h-2 w-2 rounded-full', c.severity === 'high' ? 'bg-red-500' : c.severity === 'medium' ? 'bg-amber-400' : 'bg-yellow-400')} />
                      {SEVERITY_LABELS[c.severity].ar} · <span className="num text-slate-400">{c.projectIds.join(' ↔ ')}</span>
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[11px] text-slate-400">{c.explanationAr}</div>
                  </button>
                ))}
                {audit.slice(0, 4).map((a) => (
                  <div key={a.id} className="rounded-lg bg-emerald-400/5 p-2 text-[11px] text-emerald-200/80">
                    ✓ {a.rationale || a.action}
                  </div>
                ))}
                {!conflicts.length && !audit.length && <div className="py-6 text-center text-xs text-slate-500">لا توجد إشعارات</div>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <button
        onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
        className="glass pointer-events-auto flex h-11 items-center gap-1.5 rounded-xl px-3 text-[12px] font-semibold text-slate-300 hover:text-white"
        aria-label="Language"
        data-testid="lang-toggle"
      >
        <Languages size={16} />
        {lang === 'ar' ? 'EN' : 'ع'}
      </button>
    </header>
  );
}
