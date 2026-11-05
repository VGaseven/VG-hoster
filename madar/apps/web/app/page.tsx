'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, clock12, dayName, fmtTime, longDate, Me, shortDate, Slot } from '@/lib/api';
import { Footer, Header, PageHead } from './shell';

interface Booking {
  id: string; date: string; slot: Slot; startsAt: string; navigationUrl: string; district: string | null;
  pendingChange: { id: string; start: string; end: string } | null;
}
interface PlanOption { label: 'recommended' | 'safer' | 'latest'; departAt: string; arriveAt: string; durationS: number; onTime: boolean }
interface PlanResp { plan: { options: PlanOption[]; approximate: boolean; entryBufferMin: number } | null; navigationUrl: string; message?: string; district?: string }

const MODES: Record<string, string> = { DRIVE: 'سيارة', TRANSIT: 'نقل عام', TWO_WHEELER: 'دراجة نارية', WALK: 'مشيًا' };
const weekStart = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
};
const opt = (p: PlanResp | null, l: PlanOption['label']) => p?.plan?.options.find((o) => o.label === l);

export default function Home() {
  const [me, setMe] = useState<Me | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [policy, setPolicy] = useState<any>(null);
  const [leaves, setLeaves] = useState<Array<{ from: string; to: string }>>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [districts, setDistricts] = useState<Array<{ id: string; city: string; name: string }>>([]);
  const [day, setDay] = useState<string | null>(null);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanResp | null>(null);
  const [nextPlan, setNextPlan] = useState<PlanResp | null>(null);
  const [wholeWeek, setWholeWeek] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string; alts?: Slot[]; suggestPreferred?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const bookRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const [m, s, b] = await Promise.all([api<Me>('/auth/me'), api('/me/slots'), api<Booking[]>('/me/bookings')]);
    setMe(m);
    setSlots(s.slots);
    setPolicy(s.policy);
    setLeaves(s.leaves);
    setBookings(b);
  }, []);

  useEffect(() => {
    load().catch((e) => setMsg({ kind: 'error', text: e.message }));
    api('/me/districts').then(setDistricts).catch(() => {});
  }, [load]);

  const onLeave = (d: string) => leaves.some((l) => d >= l.from && d <= l.to);
  const bookingByDate = useMemo(() => Object.fromEntries(bookings.map((b) => [b.date, b])), [bookings]);
  // المواعيد التي لم تبدأ بعد (نُخفي ما مضى من اليوم)
  const upcoming = useMemo(() => bookings.filter((b) => new Date(b.startsAt).getTime() > Date.now()), [bookings]);
  const days = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of slots) map.set(s.date, [...(map.get(s.date) ?? []), s]);
    return [...map.entries()].filter(([, l]) => l.some((s) => !s.past)).map(([date, list]) => ({ date, list }));
  }, [slots]);
  const daySlots = days.find((d) => d.date === day)?.list ?? [];
  const current = day ? bookingByDate[day] : undefined;
  const next = upcoming[0];
  const chosen = slots.find((s) => s.id === slotId);

  // خطة الانطلاق للموعد القادم
  useEffect(() => {
    if (!next) return setNextPlan(null);
    api<PlanResp>(`/me/slots/${next.slot.id}/plan`).then(setNextPlan).catch(() => setNextPlan(null));
  }, [next?.slot.id]);

  // خطة الانطلاق للفترة المختارة
  useEffect(() => {
    setPlan(null);
    if (!slotId) return;
    api<PlanResp>(`/me/slots/${slotId}/plan`).then(setPlan).catch((e) => setPlan({ plan: null, navigationUrl: '', message: e.message }));
  }, [slotId]);

  const chooseDay = (d: string) => {
    setDay(d);
    setSlotId(null);
    setWholeWeek(false);
    setMsg(null);
  };

  const weekItems = (date: string, start: string) =>
    days
      .filter((d) => d.date !== date && weekStart(d.date) === weekStart(date) && !bookingByDate[d.date] && !onLeave(d.date))
      .map((d) => ({ date: d.date, slot: d.list.find((s) => s.start === start && !s.full) }))
      .filter((x): x is { date: string; slot: Slot } => !!x.slot)
      .map((x) => ({ date: x.date, slotId: x.slot.id }));

  // «موعدي المعتاد»: نحجز الأيام القادمة غير المحجوزة بضغطة، وإن اكتمل الوقت نختار أقرب وقت متاح
  const preferred = me?.preferredStart ?? null;
  const quickPlan = useMemo(() => {
    if (!preferred) return [];
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    return days
      .filter((d) => !bookingByDate[d.date] && !onLeave(d.date))
      .slice(0, 5)
      .map((d) => {
        const open = d.list.filter((s) => !s.full && !s.past);
        const exact = open.find((s) => s.start === preferred);
        const nearest = [...open].sort((a, b) => Math.abs(toMin(a.start) - toMin(preferred)) - Math.abs(toMin(b.start) - toMin(preferred)))[0];
        const slot = exact ?? nearest;
        return slot ? { date: d.date, slot, moved: !exact } : null;
      })
      .filter((x): x is { date: string; slot: Slot; moved: boolean } => !!x);
  }, [preferred, days, bookingByDate, leaves]);

  const quickBook = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api('/me/bookings', { method: 'POST', body: { items: quickPlan.map((x) => ({ date: x.date, slotId: x.slot.id })) } });
      const moved = quickPlan.filter((x) => x.moved);
      setMsg({
        kind: 'success',
        text: `تم حجز ${quickPlan.length} ${quickPlan.length === 1 ? 'يوم' : 'أيام'} على موعدك المعتاد.` +
          (moved.length ? ` (${moved.map((x) => `${dayName(x.date)} ${fmtTime(x.slot.start)}`).join('، ')} لأن موعدك المعتاد مكتمل)` : ''),
      });
      await load();
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof ApiError ? e.message : 'تعذّر الحجز', alts: e instanceof ApiError ? e.details?.alternatives : undefined });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const savePreferred = async (start: string | null) => {
    await api('/me/preferred-time', { method: 'PUT', body: { start } });
    setMsg((m) => (m?.suggestPreferred ? { kind: 'success', text: `تم. ${start ? fmtTime(start) : ''} هو موعدك المعتاد الآن.` } : m));
    await load();
  };
  const startTimes = useMemo(() => [...new Set(slots.map((s) => s.start))].sort(), [slots]);

  const confirm = async () => {
    if (!day || !chosen) return;
    setBusy(true);
    setMsg(null);
    try {
      if (current) {
        const r = await api(`/me/bookings/${current.id}/change`, { method: 'POST', body: { newSlotId: chosen.id } });
        setMsg({
          kind: 'success',
          text: r.status === 'pending'
            ? `أُرسل طلب تغيير موعد ${longDate(day)} إلى ${fmtTime(chosen.start)}. موعدك الحالي يبقى ساريًا حتى تتم الموافقة.`
            : `تم تغيير موعد ${longDate(day)} إلى ${fmtTime(chosen.start)}.`,
        });
      } else {
        const extra = wholeWeek ? weekItems(day, chosen.start) : [];
        const departure = opt(plan, 'recommended')?.departAt;
        await api('/me/bookings', {
          method: 'POST',
          body: { items: [{ date: day, slotId: chosen.id, ...(departure ? { plannedDeparture: departure } : {}) }, ...extra] },
        });
        const n = 1 + extra.length;
        setMsg({
          kind: 'success',
          text: n === 1 ? `تم حجز موعدك يوم ${longDate(day)}، الوصول بين ${fmtTime(chosen.start)} و${fmtTime(chosen.end)}.` : `تم حجز ${n} أيام على وقت الوصول ${fmtTime(chosen.start)}.`,
          suggestPreferred: me?.preferredStart ? undefined : chosen.start,
        });
      }
      setDay(null);
      setSlotId(null);
      await load();
    } catch (e) {
      if (e instanceof ApiError) setMsg({ kind: 'error', text: e.message, alts: e.details?.alternatives });
      else setMsg({ kind: 'error', text: 'تعذّر إتمام الحجز، حاول مرة أخرى.' });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (b: Booking) => {
    if (!confirmDialog(`هل تريد إلغاء موعد ${longDate(b.date)}؟`)) return;
    try {
      await api(`/me/bookings/${b.id}`, { method: 'DELETE' });
      setMsg({ kind: 'success', text: `تم إلغاء موعد ${longDate(b.date)}.` });
      await load();
    } catch (e: any) {
      setMsg({ kind: 'error', text: e.message });
    }
  };
  const withdraw = async (id: string) => {
    await api(`/me/changes/${id}`, { method: 'DELETE' }).catch((e) => setMsg({ kind: 'error', text: e.message }));
    await load();
  };
  const startChange = (b: Booking) => {
    chooseDay(b.date);
    bookRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  const saveDistrict = async (id: string) => {
    await api('/me/district', { method: 'PUT', body: { districtId: id || null } });
    await load();
    setSlotId((s) => s);
  };
  const saveMode = async (m: string) => {
    await api('/me/travel-mode', { method: 'PUT', body: { travelMode: m } });
    await load();
  };

  if (me && !me.eligible) {
    return (
      <>
        <Header me={me} />
        <PageHead title={`مرحبًا، ${me.name}`} />
        <main className="container">
          <div className="alert warn">وظيفتك غير مشمولة بالحضور المرن حسب بيانات جهتك. للاستفسار تواصل مع الموارد البشرية.</div>
        </main>
        <Footer org={me.orgName} />
      </>
    );
  }

  const step = !day ? 1 : !slotId ? 2 : 3;
  const rec = opt(plan, 'recommended');
  const safer = opt(plan, 'safer');
  const nextRec = opt(nextPlan, 'recommended');

  return (
    <>
      <Header me={me} />
      <PageHead
        crumb="مواعيدي"
        title={me ? `مرحبًا، ${me.name.split(' ')[0]}` : 'مواعيدي'}
        subtitle={me ? `${me.siteName ?? ''}${me.district ? ` · تنطلق من حي ${me.district}` : ''}` : undefined}
      />
      <main className="container">
        {me && !me.districtId && (
          <div className="alert warn">
            <div style={{ flex: 1 }}>
              <b>اختر حي الانطلاق أولًا</b>
              <div className="small">نحتاجه لحساب وقت انطلاقك. نستخدم الحي فقط، ولا نطلب عنوان منزلك.</div>
            </div>
            <select onChange={(e) => saveDistrict(e.target.value)} defaultValue="">
              <option value="" disabled>اختر الحي</option>
              {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        )}

        {msg && (
          <div className={`alert ${msg.kind}`} role="status">
            <div>
              {msg.text}
              {msg.suggestPreferred && (
                <div className="row" style={{ marginTop: 10 }}>
                  <span className="small">هل تصل عادةً في هذا الوقت؟ اجعله موعدك المعتاد لتحجز أسبوعك بضغطة واحدة لاحقًا.</span>
                  <button className="btn sm outline" onClick={() => savePreferred(msg.suggestPreferred!)}>اجعل {fmtTime(msg.suggestPreferred)} موعدي المعتاد</button>
                </div>
              )}
              {msg.alts && msg.alts.length > 0 && (
                <div className="row" style={{ marginTop: 10 }}>
                  <span className="small">أوقات متاحة قريبة:</span>
                  {msg.alts.map((a) => (
                    <button key={a.id} className="btn sm outline" onClick={() => { setDay(a.date); setSlotId(a.id); setMsg(null); }}>
                      {fmtTime(a.start)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* الحجز السريع */}
        {preferred && quickPlan.length > 0 && (
          <section className="panel next-trip" style={{ borderInlineStartColor: '#f5b400' }}>
            <div>
              <div className="muted small">حجز سريع</div>
              <div className="when" style={{ fontSize: 19 }}>
                لديك {quickPlan.length} {quickPlan.length === 1 ? 'يوم' : 'أيام'} بلا موعد: {quickPlan.map((x) => longDate(x.date)).join('، ')}
              </div>
              <div className="muted small">
                سنحجزها على موعدك المعتاد {fmtTime(preferred)}{quickPlan.some((x) => x.moved) ? '، وأقرب وقت متاح إذا اكتمل' : ''}.
              </div>
            </div>
            <button className="btn primary" onClick={quickBook} disabled={busy}>احجزها كلها بضغطة</button>
          </section>
        )}

        {/* الموعد القادم */}
        {next && (
          <section className="panel next-trip" aria-label="موعدك القادم">
            <div>
              <div className="muted small">موعدك القادم</div>
              <div className="when">{longDate(next.date)} — الوصول بين {fmtTime(next.slot.start)} و{fmtTime(next.slot.end)}</div>
              {nextRec && (
                <div className="leave">
                  انطلق{next.district ? ` من حي ${next.district}` : ''} الساعة <b>{clock12(nextRec.departAt)}</b>
                </div>
              )}
              {next.pendingChange && <div style={{ marginTop: 6 }}><span className="tag amber">طلب تغيير إلى {fmtTime(next.pendingChange.start)} بانتظار الموافقة</span></div>}
            </div>
            <div className="row">
              <a className="btn primary" href={next.navigationUrl} target="_blank" rel="noopener">ابدأ الملاحة في خرائط Google</a>
              <button className="btn" onClick={() => startChange(next)}>تغيير الموعد</button>
            </div>
          </section>
        )}

        {/* الحجز */}
        <section className="panel" ref={bookRef}>
          <h2>{current ? 'تغيير موعد' : 'احجز موعد حضور'}</h2>
          <p className="sub">اختر اليوم، ثم وقت وصولك، وسنخبرك متى تنطلق.</p>

          <div className="steps" aria-hidden>
            {['اختر اليوم', 'اختر وقت الوصول', 'تأكيد'].map((t, i) => (
              <div key={t} className={`step ${step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''}`}>
                <span className="n">{step > i + 1 ? '✓' : i + 1}</span>
                {t}
              </div>
            ))}
          </div>

          <h3>١. اختر اليوم</h3>
          <div className="days">
            {days.map(({ date }) => {
              const b = bookingByDate[date];
              const leave = onLeave(date);
              return (
                <button key={date} className={`day-btn ${day === date ? 'sel' : ''}`} disabled={leave} onClick={() => chooseDay(date)} aria-pressed={day === date}>
                  <span className="d">{dayName(date)}</span>
                  <span className="m">{shortDate(date)}</span>
                  {leave ? <span className="tag">إجازة</span> : b ? <span className="tag green">{fmtTime(b.slot.start)}</span> : <span className="tag" style={{ visibility: 'hidden' }}>-</span>}
                </button>
              );
            })}
          </div>

          {day && (
            <div style={{ marginTop: 28 }}>
              <h3>٢. متى تريد الوصول يوم {longDate(day)}؟</h3>
              {current && (
                <p className="muted small" style={{ marginTop: -6 }}>
                  موعدك الحالي: الوصول بين {fmtTime(current.slot.start)} و{fmtTime(current.slot.end)}. اختر وقتًا آخر لطلب التغيير، أو{' '}
                  <button className="btn link" onClick={() => cancel(current)}>ألغِ هذا الموعد</button>.
                </p>
              )}
              <div className="times" role="radiogroup">
                {daySlots.map((s) => {
                  const mine = current?.slot.id === s.id;
                  const disabled = mine || s.full || !!s.past;
                  return (
                    <button
                      key={s.id}
                      role="radio"
                      aria-checked={slotId === s.id}
                      className={`time-btn ${slotId === s.id ? 'sel' : ''}`}
                      disabled={disabled}
                      onClick={() => setSlotId(s.id)}
                    >
                      <span className="row" style={{ gap: 10 }}>
                        <span className="radio" />
                        <span>
                          <span className="t">{fmtTime(s.start)}</span>
                          <span className="muted small"> – {fmtTime(s.end)}</span>
                        </span>
                      </span>
                      {mine ? <span className="tag green">موعدك</span>
                        : s.past ? <span className="tag">انتهى</span>
                        : s.full ? <span className="tag red">مكتمل</span>
                        : <span className="tag green">متاح</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {day && chosen && (
            <div style={{ marginTop: 28 }}>
              <h3>٣. راجع وأكّد</h3>
              <div className="summary">
                {!plan && <span className="muted">جارٍ حساب وقت الانطلاق…</span>}
                {plan?.message && <span>{plan.message}</span>}
                {rec && (
                  <>
                    <div className="big">انطلق{plan?.district ? ` من حي ${plan.district}` : ''} الساعة <b>{clock12(rec.departAt)}</b></div>
                    <div>لتصل قرابة {clock12(rec.arriveAt)} · مدة الرحلة نحو {Math.round(rec.durationS / 60)} دقيقة</div>
                    {safer && <div className="muted small">للاحتياط من الزحام: انطلق الساعة {clock12(safer.departAt)}</div>}
                    <div className="muted small">
                      {plan?.plan?.approximate ? 'هذا تقدير تقريبي، ' : 'تقدير من خرائط Google لهذا الوقت، '}
                      ويشمل {plan?.plan?.entryBufferMin} دقائق للمشي والدخول.
                    </div>
                  </>
                )}
              </div>
              {!current && weekItems(day, chosen.start).length > 0 && (
                <label className="row" style={{ marginTop: 16, cursor: 'pointer' }}>
                  <input type="checkbox" checked={wholeWeek} onChange={(e) => setWholeWeek(e.target.checked)} />
                  احجز الوقت نفسه ({fmtTime(chosen.start)}) لباقي أيام هذا الأسبوع ({weekItems(day, chosen.start).length} أيام)
                </label>
              )}
              <div className="sticky-actions row">
                <button className="btn primary" onClick={confirm} disabled={busy}>
                  {busy ? 'جارٍ الحفظ…' : current ? (policy?.requireChangeApproval ? 'إرسال طلب التغيير' : 'تغيير الموعد') : 'تأكيد الحجز'}
                </button>
                <button className="btn" onClick={() => { setDay(null); setSlotId(null); }} disabled={busy}>إلغاء</button>
              </div>
            </div>
          )}
        </section>

        {/* كل المواعيد */}
        <section className="panel">
          <h2>مواعيدي القادمة</h2>
          <p className="sub">{upcoming.length ? `لديك ${upcoming.length} ${upcoming.length === 1 ? 'موعد' : 'مواعيد'}.` : 'لا توجد مواعيد محجوزة بعد.'}</p>
          <div className="list">
            {upcoming.map((b) => (
              <div key={b.id} className="list-item">
                <div>
                  <b>{longDate(b.date)}</b>
                  <div className="muted small">الوصول بين {fmtTime(b.slot.start)} و{fmtTime(b.slot.end)}</div>
                </div>
                <div className="row">
                  {b.pendingChange ? (
                    <>
                      <span className="tag amber">طلب تغيير إلى {fmtTime(b.pendingChange.start)} قيد المراجعة</span>
                      <button className="btn sm" onClick={() => withdraw(b.pendingChange!.id)}>سحب الطلب</button>
                    </>
                  ) : (
                    <span className="tag green">مؤكد</span>
                  )}
                  <a className="btn sm" href={b.navigationUrl} target="_blank" rel="noopener">الملاحة</a>
                  <button className="btn sm" onClick={() => startChange(b)}>تغيير</button>
                  <button className="btn sm danger" onClick={() => cancel(b)}>إلغاء</button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* البيانات */}
        <section className="panel">
          <h2>بياناتي</h2>
          <p className="sub">تُستخدم لحساب وقت الانطلاق فقط.</p>
          <div className="form-grid">
            <label className="field">
              حي الانطلاق
              <select value={me?.districtId ?? ''} onChange={(e) => saveDistrict(e.target.value)}>
                <option value="">— اختر —</option>
                {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <span className="hint">الملاحة تبدأ من وسط الحي، ولا نطلب عنوان منزلك.</span>
            </label>
            <label className="field">
              موعدي المعتاد
              <select value={preferred ?? ''} onChange={(e) => savePreferred(e.target.value || null)}>
                <option value="">— بدون —</option>
                {startTimes.map((t) => <option key={t} value={t}>{fmtTime(t)}</option>)}
              </select>
              <span className="hint">نقترحه عليك ونحجز به أيامك بضغطة واحدة.</span>
            </label>
            <label className="field">
              وسيلة التنقل
              <select value={me?.travelMode ?? 'DRIVE'} onChange={(e) => saveMode(e.target.value)}>
                {Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <div className="field">
              <span>مقر العمل</span>
              <span style={{ fontWeight: 400 }}>{me?.siteName ?? '—'}</span>
              {policy && <span className="hint">يمكنك الحجز حتى {policy.horizonDays} يومًا مقدمًا، والتغيير قبل الموعد بـ {policy.changeCutoffHours} ساعة.</span>}
            </div>
          </div>
        </section>
      </main>
      <Footer org={me?.orgName} />
    </>
  );
}

const confirmDialog = (text: string) => (typeof window === 'undefined' ? false : window.confirm(text));
