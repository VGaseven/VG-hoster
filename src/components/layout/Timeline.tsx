import { useMemo, useRef } from 'react';
import { ChevronDown, ChevronUp, Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { useStore, simDayOf, simHourOf, type Speed } from '@/store/store';
import { actionable, beforeProjects, useConflicts } from '@/store/derived';
import { HORIZON_DAYS, dayIndex, fmtHour, fmtShort, isoFromDay, HORIZON_START } from '@/utils/date';
import { ORGANIZATIONS } from '@/data/organizations';
import { SCENARIOS } from '@/data/projects';
import { useT } from '@/i18n/i18n';
import { cn } from '@/utils/format';

const SPEEDS: Speed[] = [0.5, 1, 2, 4];

export function Timeline() {
  const t = useT();
  const all = useStore((s) => s.projects);
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  const simTime = useStore((s) => s.simTime);
  const setSimTime = useStore((s) => s.setSimTime);
  const setSimDate = useStore((s) => s.setSimDate);
  const playing = useStore((s) => s.playing);
  const togglePlay = useStore((s) => s.togglePlay);
  const restart = useStore((s) => s.restartSim);
  const speed = useStore((s) => s.speed);
  const setSpeed = useStore((s) => s.setSpeed);
  const open = useStore((s) => s.panels.timeline);
  const togglePanel = useStore((s) => s.togglePanel);
  const selectProject = useStore((s) => s.selectProject);
  const selected = useStore((s) => s.selectedProjectId);
  const projects = viewMode === 'before' ? beforeProjects(all) : all;
  const conflicts = actionable(useConflicts(projects));
  const trackRef = useRef<HTMLDivElement>(null);
  const day = simDayOf(simTime);
  const pct = (d: number) => `${(d / HORIZON_DAYS) * 100}%`;

  const lanes = useMemo(() => projects.filter((p) => p.status !== 'rejected').sort((a, b) => dayIndex(a.schedule.start) - dayIndex(b.schedule.start)), [projects]);
  const months = useMemo(() => {
    const out: { d: number; label: string }[] = [];
    for (let d = 0; d < HORIZON_DAYS; d++) if (isoFromDay(d).endsWith('-01')) out.push({ d, label: fmtShort(isoFromDay(d)) });
    return out;
  }, []);

  const scrubFromEvent = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    // timeline runs left→right (dates are LTR even in RTL UI)
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    setSimTime(f * HORIZON_DAYS);
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-3" data-tour="timeline">
      <div className="glass pointer-events-auto rounded-xl">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <div className="flex items-center gap-1">
            <button className="grid h-9 w-9 place-items-center rounded-lg bg-[#6c5dd3] text-white transition hover:bg-[#7c6ee0] active:scale-95" onClick={togglePlay} aria-label={playing ? t('إيقاف مؤقت') : t('بدء المحاكاة')} data-testid="play-toggle" data-tour="play">
              {playing ? <Pause size={17} /> : <Play size={17} />}
            </button>
            <button className="grid h-9 w-9 place-items-center rounded-lg text-slate-300 hover:bg-white/5" onClick={restart} aria-label={t('إعادة التشغيل')} title={t('إعادة التشغيل')} data-testid="restart">
              <RotateCcw size={16} />
            </button>
            <button className="grid h-9 w-9 place-items-center rounded-lg text-slate-300 hover:bg-white/5" onClick={() => setSimTime(simTime - 1)} aria-label="يوم سابق">
              <SkipBack size={15} />
            </button>
            <button className="grid h-9 w-9 place-items-center rounded-lg text-slate-300 hover:bg-white/5" onClick={() => setSimTime(simTime + 1)} aria-label="يوم تالٍ">
              <SkipForward size={15} />
            </button>
          </div>
          <div className="flex items-center rounded-lg bg-white/5 p-0.5" role="group" aria-label="سرعة المحاكاة">
            {SPEEDS.map((s) => (
              <button key={s} onClick={() => setSpeed(s)} className={cn('num h-7 rounded-md px-2 text-[11.5px] font-semibold', speed === s ? 'bg-cyan-400/20 text-cyan-200' : 'text-slate-400 hover:text-white')} data-testid={`speed-${s}`}>
                {s}×
              </button>
            ))}
          </div>
          <input
            type="date"
            className="num h-8 rounded-lg border border-white/10 bg-ink-900/80 px-2 text-[12px] text-slate-200"
            min={HORIZON_START}
            max={isoFromDay(HORIZON_DAYS - 1)}
            value={isoFromDay(day)}
            onChange={(e) => e.target.value && setSimDate(e.target.value)}
            aria-label="التاريخ المحاكى"
            data-testid="date-input"
          />
          <span className="num rounded-md bg-white/5 px-2 py-1 text-[12px] text-slate-300">{fmtHour(simHourOf(simTime))}</span>
          <div className="flex items-center gap-1 text-[11px]">
            {SCENARIOS.map((s) => (
              <button key={s.id} onClick={() => setSimDate(s.focusDate, 8)} title={s.titleAr} className="rounded-md border border-white/8 px-2 py-1 text-slate-400 hover:border-cyan-400/40 hover:text-cyan-200">
                {s.id}
              </button>
            ))}
          </div>
          <div className="mr-auto flex items-center rounded-lg bg-white/5 p-0.5" role="group" aria-label="قبل / بعد" data-tour="before-after">
            <button onClick={() => setViewMode('before')} className={cn('h-7 rounded-md px-2.5 text-[12px] font-medium', viewMode === 'before' ? 'bg-amber-400/20 text-amber-200' : 'text-slate-400')} data-testid="view-before">
              {t('قبل التنسيق')}
            </button>
            <button onClick={() => setViewMode('after')} className={cn('h-7 rounded-md px-2.5 text-[12px] font-medium', viewMode === 'after' ? 'bg-emerald-400/20 text-emerald-200' : 'text-slate-400')} data-testid="view-after">
              {t('بعد التنسيق')}
            </button>
          </div>
          <button onClick={() => togglePanel('timeline')} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white/5" aria-label="طي الخط الزمني">
            {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>
        {open && (
          <div className="px-3 pb-3" dir="ltr">
            <div
              ref={trackRef}
              className="relative h-[86px] cursor-pointer select-none overflow-hidden rounded-lg border border-white/6 bg-ink-950/60"
              onPointerDown={(e) => {
                (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                scrubFromEvent(e.clientX);
              }}
              onPointerMove={(e) => e.buttons === 1 && scrubFromEvent(e.clientX)}
              data-testid="timeline-track"
            >
              {months.map((m) => (
                <div key={m.d} className="absolute inset-y-0 border-l border-white/6" style={{ left: pct(m.d) }}>
                  <span className="absolute left-1 top-0.5 text-[9.5px] text-slate-500" dir="rtl">
                    {m.label}
                  </span>
                </div>
              ))}
              {conflicts
                .filter((c) => c.overlap)
                .map((c) => (
                  <div key={c.id} className={cn('absolute bottom-0 top-3.5', c.severity === 'high' ? 'bg-red-500/14' : 'bg-amber-400/10')} style={{ left: pct(dayIndex(c.overlap!.start)), width: pct(c.overlap!.days) }} title={`${c.id}`} />
                ))}
              <div className="absolute inset-x-0 bottom-1 top-4 flex flex-col justify-around">
                {lanes.slice(0, 16).map((p) => (
                  <div key={p.id} className="relative h-[3.5px]">
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => selectProject(p.id)}
                      title={`${p.title} (${p.schedule.start} → ${p.schedule.end})`}
                      className={cn('absolute h-full rounded-full transition-all hover:h-[6px]', selected === p.id && 'ring-2 ring-cyan-300')}
                      style={{ left: pct(dayIndex(p.schedule.start)), width: pct(dayIndex(p.schedule.end) - dayIndex(p.schedule.start) + 1), background: ORGANIZATIONS[p.orgId].color }}
                    />
                  </div>
                ))}
              </div>
              <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-cyan-300 shadow-[0_0_12px_#22d3ee]" style={{ left: pct(simTime) }}>
                <span className="absolute -top-0.5 left-1 whitespace-nowrap rounded bg-cyan-400 px-1 text-[9.5px] font-bold text-slate-950">{fmtShort(isoFromDay(day))}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
