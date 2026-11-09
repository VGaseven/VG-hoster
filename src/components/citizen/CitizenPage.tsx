import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, ArrowLeftRight, BellRing, Clock, Construction, MapPin, Navigation, Route, Timer } from 'lucide-react';
import { useStore } from '@/store/store';
import { CITIZEN_JOURNEYS, PLACES } from '@/data/projects';
import { NODE_BY_ID, STUDY_AREA_VIEW, SEGMENT_BY_ID } from '@/data/network';
import { ORGANIZATIONS } from '@/data/organizations';
import { bestDeparture, citizenVisible, planJourney } from '@/engine/routing/journey';
import { SimMap } from '@/components/map/SimMap';
import { Badge, Toggle, inputCls } from '@/components/ui/ui';
import { dayIndex, fmtDate, fmtHour, HORIZON_START, isoFromDay, HORIZON_DAYS } from '@/utils/date';
import { fmtNum, cn } from '@/utils/format';
import { closureLine } from '@/engine/spatial/geometry';

export function CitizenPage() {
  const projects = useStore((s) => s.projects);
  const [origin, setOrigin] = useState(CITIZEN_JOURNEYS[0].originPlaceId);
  const [dest, setDest] = useState(CITIZEN_JOURNEYS[0].destinationPlaceId);
  const [date, setDate] = useState(CITIZEN_JOURNEYS[0].date);
  const [hour, setHour] = useState(CITIZEN_JOURNEYS[0].hour);
  const [pending, setPending] = useState(true);
  const o = PLACES.find((p) => p.id === origin)!;
  const d = PLACES.find((p) => p.id === dest)!;
  const plan = useMemo(() => planJourney(projects, o.nodeId, d.nodeId, date, hour, pending), [projects, o, d, date, hour, pending]);
  const deps = useMemo(() => bestDeparture(projects, o.nodeId, d.nodeId, date, hour, pending), [projects, o, d, date, hour, pending]);
  const best = deps.reduce((a, b) => (b.timeMin < a.timeMin ? b : a), deps[0] ?? { hour, timeMin: 0 });
  const visibleProjects = useMemo(() => projects.filter((p) => citizenVisible(p, pending)), [projects, pending]);
  const day = dayIndex(date);
  const notices = visibleProjects
    .filter((p) => dayIndex(p.schedule.end) >= day && dayIndex(p.schedule.start) <= day + 30)
    .sort((a, b) => dayIndex(a.schedule.start) - dayIndex(b.schedule.start));
  const sameRoute = plan.normal && plan.now && plan.normal.segIds.join() === plan.now.segIds.join();
  const extra = plan.now && plan.normal ? plan.now.timeMin - plan.normal.timeMin : 0;

  const routes = useMemo<GeoJSON.FeatureCollection>(() => {
    const f: GeoJSON.Feature[] = [];
    if (plan.normal && !sameRoute) f.push({ type: 'Feature', properties: { kind: 'original' }, geometry: { type: 'LineString', coordinates: plan.normal.coords } });
    if (plan.now) f.push({ type: 'Feature', properties: { kind: 'recommended' }, geometry: { type: 'LineString', coordinates: plan.now.coords } });
    for (const p of plan.affecting) for (const c of p.closures) f.push({ ...closureLine(c), properties: { kind: 'blocked' } });
    return { type: 'FeatureCollection', features: f };
  }, [plan, sameRoute]);

  const roadNames = (segs: string[]) => [...new Set(segs.map((s) => SEGMENT_BY_ID.get(s)!).filter((s) => s.closable).map((s) => s.name))];

  return (
    <div className="flex h-full" data-testid="citizen-page">
      <aside className="scroll-thin w-[420px] shrink-0 overflow-y-auto border-l border-white/6 bg-gradient-to-b from-ink-900 to-ink-950 p-5">
        <div className="text-[11px] font-semibold tracking-wide text-violet-300">تجربة المواطن: معرفة الإغلاق قبل الوصول</div>
        <h1 className="mt-1 text-2xl font-bold leading-snug">خطّط لرحلة الغد قبل مفاجأة الإغلاق</h1>
        <p className="mt-1 text-[12.5px] text-slate-400">تظهر الإغلاقات المخطط لها مسبقاً، ليختار الشخص طريقه قبل يوم الرحلة.</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11.5px]" data-testid="citizen-before-after">
          <div className="rounded-xl border border-red-400/20 bg-red-500/[0.06] p-2.5">
            <div className="font-semibold text-red-200">قبل</div>
            <div className="mt-0.5 text-slate-400">الوصول صباحاً إلى طريق مغلق.</div>
          </div>
          <div className="rounded-xl border border-emerald-400/25 bg-emerald-500/[0.06] p-2.5">
            <div className="font-semibold text-emerald-200">بعد</div>
            <div className="mt-0.5 text-slate-400">معرفة الإغلاق وبدائله من اليوم السابق.</div>
          </div>
        </div>
        <div className="mt-4 flex gap-1.5">
          {CITIZEN_JOURNEYS.map((j) => (
            <button
              key={j.id}
              onClick={() => {
                setOrigin(j.originPlaceId);
                setDest(j.destinationPlaceId);
                setDate(j.date);
                setHour(j.hour);
              }}
              className="flex-1 rounded-xl border border-white/8 bg-white/[0.03] p-2 text-right text-[11.5px] text-slate-300 hover:border-cyan-400/40"
              data-testid={`journey-${j.id}`}
            >
              <div className="font-semibold text-slate-100">رحلة {j.id === 'J1' ? '١' : '٢'}</div>
              {j.titleAr}
            </button>
          ))}
        </div>
        <div className="mt-4 space-y-2 rounded-2xl border border-white/8 bg-white/[0.03] p-3">
          <label className="flex items-center gap-2">
            <MapPin size={15} className="text-emerald-300" />
            <select className={inputCls} value={origin} onChange={(e) => setOrigin(e.target.value)} aria-label="من" data-testid="origin">
              {PLACES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nameAr}
                </option>
              ))}
            </select>
          </label>
          <div className="flex justify-center">
            <button className="rounded-full p-1 text-slate-400 hover:bg-white/5 hover:text-white" onClick={() => (setOrigin(dest), setDest(origin))} aria-label="تبديل">
              <ArrowLeftRight size={14} className="rotate-90" />
            </button>
          </div>
          <label className="flex items-center gap-2">
            <Navigation size={15} className="text-red-300" />
            <select className={inputCls} value={dest} onChange={(e) => setDest(e.target.value)} aria-label="إلى" data-testid="destination">
              {PLACES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nameAr}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <input type="date" className={cn(inputCls, 'num')} min={HORIZON_START} max={isoFromDay(HORIZON_DAYS - 1)} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="تاريخ الرحلة" data-testid="trip-date" />
            <select className={cn(inputCls, 'num')} value={hour} onChange={(e) => setHour(Number(e.target.value))} aria-label="وقت الانطلاق" data-testid="trip-hour">
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {fmtHour(h)}
                </option>
              ))}
            </select>
          </div>
          <Toggle label="إظهار الإغلاقات قيد الاعتماد (غير نهائية)" checked={pending} onChange={setPending} />
        </div>

        {plan.now && plan.normal && (
          <motion.div key={`${origin}${dest}${date}${hour}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4 space-y-3">
            {plan.affecting.length > 0 ? (
              <div className="rounded-2xl border border-amber-400/40 bg-amber-400/[0.08] p-3.5" data-testid="citizen-advisory">
                <div className="flex items-center gap-2 text-[14px] font-semibold text-amber-100">
                  <AlertTriangle size={17} /> اعرف الإغلاق قبل موعدك: إغلاق على مسارك المعتاد
                </div>
                <div className="num mt-1 text-[11px] text-amber-200/70">تنبيه مسبق مساء {fmtDate(isoFromDay(day - 1))} — قبل يوم الرحلة</div>
                {plan.affecting.map((p) => (
                  <div key={p.id} className="mt-2 rounded-lg bg-black/25 p-2.5 text-[12px]">
                    <div className="font-medium text-slate-100">{p.title}</div>
                    <div className="mt-1 text-slate-400">
                      {fmtDate(p.schedule.start)} – {fmtDate(p.schedule.end)} · {ORGANIZATIONS[p.orgId].ar}
                    </div>
                    <div className="mt-1">
                      {p.status === 'approved' || p.status === 'scheduled' ? <Badge tone="emerald">إغلاق معتمد</Badge> : <Badge tone="amber">قيد الاعتماد — قد يتغير</Badge>}
                    </div>
                  </div>
                ))}
                <div className="mt-2 text-[12px] leading-relaxed text-amber-50/90">
                  {sameRoute ? 'المسار المعتاد ما زال الأسرع لكنه أبطأ بسبب الأعمال.' : `ننصح بالمسار البديل عبر ${roadNames(plan.now.segIds).slice(0, 3).join(' ثم ')}.`}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.06] p-3.5 text-[13px] text-emerald-100" data-testid="citizen-clear">
                لا توجد إغلاقات على مسارك في هذا الموعد ✓
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <RouteCard title="المسار المعتاد (دون أعمال)" tone="slate" km={plan.normal.km} min={plan.normal.timeMin} roads={roadNames(plan.normal.segIds)} />
              <RouteCard title="المسار الموصى به" tone="cyan" km={plan.now.km} min={plan.now.timeMin} roads={roadNames(plan.now.segIds)} extra={extra} />
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
              <div className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold">
                <Clock size={14} className="text-cyan-300" /> غيّر وقت الانطلاق
              </div>
              <div className="flex items-end gap-1" dir="ltr">
                {deps.map((x) => {
                  const max = Math.max(...deps.map((y) => y.timeMin));
                  return (
                    <button key={x.hour} onClick={() => setHour(x.hour)} className="group flex flex-1 flex-col items-center gap-1" aria-label={`الانطلاق ${fmtHour(x.hour)}`}>
                      <span className="num text-[10px] text-slate-400">{fmtNum(x.timeMin)}د</span>
                      <span className={cn('w-full rounded-t', x.hour === hour ? 'bg-cyan-400' : x.hour === best.hour ? 'bg-emerald-400/70' : 'bg-white/15 group-hover:bg-white/25')} style={{ height: `${10 + (x.timeMin / max) * 50}px` }} />
                      <span className="num text-[10px] text-slate-500">{fmtHour(x.hour)}</span>
                    </button>
                  );
                })}
              </div>
              {best.hour !== hour && (
                <div className="mt-2 text-[11.5px] text-emerald-300">
                  الانطلاق الساعة <span className="num">{fmtHour(best.hour)}</span> يوفر نحو <span className="num">{fmtNum(Math.max(0, plan.now.timeMin - best.timeMin))}</span> دقيقة.
                </div>
              )}
            </div>
            <p className="text-[10.5px] leading-relaxed text-slate-500">الأوقات تقديرات من نموذج محاكاة محلي (طلب مروري تركيبي) وليست بيانات مرور حية. الإغلاق والالتفاف افتراضيان؛ تصور توضيحي لا يفترض تكاملاً مع أي تطبيق خرائط أو منصة حكومية.</p>
          </motion.div>
        )}

        <div className="mt-5">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
            <BellRing size={15} className="text-cyan-300" /> إشعارات الإغلاق القادمة (٣٠ يوماً)
          </div>
          <div className="space-y-1.5">
            {notices.map((p) => (
              <div key={p.id} className="flex items-start gap-2 rounded-xl border border-white/6 bg-white/[0.02] p-2.5 text-[12px]">
                <Construction size={14} className="mt-0.5 shrink-0 text-amber-300" />
                <div className="min-w-0">
                  <div className="truncate text-slate-200">{p.title}</div>
                  <div className="text-[11px] text-slate-500">
                    {fmtDate(p.schedule.start)} – {fmtDate(p.schedule.end)} · {ORGANIZATIONS[p.orgId].short}
                    {!(p.status === 'approved' || p.status === 'scheduled') && ' · قيد الاعتماد'}
                  </div>
                </div>
              </div>
            ))}
            {!notices.length && <div className="text-[12px] text-slate-500">لا إشعارات في هذه الفترة.</div>}
          </div>
        </div>
      </aside>
      <div className="relative min-w-0 flex-1">
        <SimMap projects={visibleProjects} day={day} hour={hour} routes={routes} initialView={{ ...STUDY_AREA_VIEW, zoom: 13.4, pitch: 45 }} showConflicts={false} vehicles={160} testid="citizen-map" />
        <div className="glass pointer-events-none absolute bottom-4 right-4 rounded-xl p-3 text-[11.5px]">
          <div className="flex items-center gap-2"><span className="h-1 w-6 rounded bg-cyan-400" /> المسار الموصى به</div>
          <div className="mt-1 flex items-center gap-2"><span className="h-1 w-6 rounded border-t-2 border-dashed border-slate-400" /> المسار المعتاد</div>
          <div className="mt-1 flex items-center gap-2"><span className="h-1 w-6 rounded bg-red-500" /> طريق مغلق/متأثر</div>
          <div className="mt-1 text-slate-500">
            {NODE_BY_ID.get(o.nodeId)?.name} ← {NODE_BY_ID.get(d.nodeId)?.name}
          </div>
        </div>
      </div>
    </div>
  );
}

function RouteCard({ title, tone, km, min, roads, extra }: { title: string; tone: 'slate' | 'cyan'; km: number; min: number; roads: string[]; extra?: number }) {
  return (
    <div className={cn('rounded-2xl border p-3', tone === 'cyan' ? 'border-cyan-400/40 bg-cyan-400/[0.06]' : 'border-white/8 bg-white/[0.02]')}>
      <div className="flex items-center gap-1.5 text-[11.5px] text-slate-400">
        <Route size={13} /> {title}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <Timer size={14} className="text-slate-400" />
        <span className="num text-xl font-bold">{fmtNum(min)}</span>
        <span className="text-[11px] text-slate-400">دقيقة</span>
      </div>
      <div className="num text-[11.5px] text-slate-400">{fmtNum(km, 1)} كم</div>
      {extra !== undefined && Math.abs(extra) >= 0.5 && <div className={cn('num mt-1 text-[11px]', extra > 0 ? 'text-amber-300' : 'text-emerald-300')}>{extra > 0 ? '+' : ''}{fmtNum(extra)} دقيقة مقارنة بالمعتاد</div>}
      <div className="mt-1.5 line-clamp-2 text-[10.5px] text-slate-500">{roads.join(' ← ')}</div>
    </div>
  );
}
