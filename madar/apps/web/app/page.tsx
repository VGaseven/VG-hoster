'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, clock, dayName, Me, mins, shortDate, Slot } from '@/lib/api';
import { TopBar } from './topbar';

interface Booking {
  id: string; date: string; slot: Slot; startsAt: string; navigationUrl: string;
  site: { name: string }; pendingChange: { id: string; start: string; end: string } | null;
}
interface PlanOption { label: 'recommended' | 'safer' | 'latest'; departAt: string; arriveAt: string; durationS: number; source: string; onTime: boolean }
interface PlanResp { plan: { options: PlanOption[]; approximate: boolean; entryBufferMin: number } | null; navigationUrl: string; message?: string; district?: string }

const MODES: Record<string, string> = { DRIVE: 'سيارة', TRANSIT: 'نقل عام', TWO_WHEELER: 'دراجة نارية', WALK: 'مشي' };
const LABELS: Record<PlanOption['label'], string> = { safer: 'بهامش أمان', recommended: 'الانطلاق المقترح', latest: 'آخر وقت ممكن' };

export default function Home() {
  const [me, setMe] = useState<Me | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [policy, setPolicy] = useState<any>(null);
  const [leaves, setLeaves] = useState<Array<{ from: string; to: string }>>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [districts, setDistricts] = useState<Array<{ id: string; city: string; name: string }>>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [focus, setFocus] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanResp | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'error' | 'info'; text: string; alts?: Slot[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [week, setWeek] = useState(0);

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

  const days = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of slots) map.set(s.date, [...(map.get(s.date) ?? []), s]);
    // نخفي الأيام التي انتهت كل فتراتها (مثل اليوم بعد ساعات الحضور)
    return [...map.entries()].filter(([, list]) => list.some((s) => !s.past)).map(([date, list]) => ({ date, list }));
  }, [slots]);
  const weeks = useMemo(() => {
    const out: (typeof days)[] = [];
    let cur: typeof days = [];
    for (const d of days) {
      if (cur.length && new Date(`${d.date}T00:00:00Z`).getUTCDay() < new Date(`${cur[cur.length - 1].date}T00:00:00Z`).getUTCDay()) {
        out.push(cur);
        cur = [];
      }
      cur.push(d);
    }
    if (cur.length) out.push(cur);
    return out;
  }, [days]);
  const bookingByDate = useMemo(() => Object.fromEntries(bookings.map((b) => [b.date, b])), [bookings]);
  const onLeave = (d: string) => leaves.some((l) => d >= l.from && d <= l.to);

  useEffect(() => {
    if (!focus) return setPlan(null);
    setPlanLoading(true);
    api<PlanResp>(`/me/slots/${focus}/plan`)
      .then(setPlan)
      .catch((e) => setPlan({ plan: null, navigationUrl: '', message: e.message }))
      .finally(() => setPlanLoading(false));
  }, [focus]);

  const pick = (date: string, slotId: string) => {
    setMsg(null);
    setSelected((s) => {
      const n = { ...s };
      if (n[date] === slotId || bookingByDate[date]?.slot.id === slotId) delete n[date];
      else n[date] = slotId;
      return n;
    });
    setFocus(slotId);
  };

  const newItems = Object.entries(selected).filter(([d]) => !bookingByDate[d]);
  const changeItems = Object.entries(selected).filter(([d]) => bookingByDate[d]);

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (newItems.length) {
        await api('/me/bookings', { method: 'POST', body: { items: newItems.map(([date, slotId]) => ({ date, slotId })) } });
      }
      const results: string[] = [];
      for (const [date, slotId] of changeItems) {
        const r = await api(`/me/bookings/${bookingByDate[date].id}/change`, { method: 'POST', body: { newSlotId: slotId } });
        results.push(r.status === 'pending' ? `طلب تغيير ${shortDate(date)} بانتظار الاعتماد، وموعدك الحالي ساري حتى ذلك` : `تم تغيير موعد ${shortDate(date)}`);
      }
      setSelected({});
      setMsg({ kind: 'info', text: [newItems.length ? `تم حجز ${newItems.length} ${newItems.length === 1 ? 'يوم' : 'أيام'}` : '', ...results].filter(Boolean).join(' · ') });
      await load();
    } catch (e) {
      if (e instanceof ApiError) setMsg({ kind: 'error', text: e.message, alts: e.details?.alternatives });
      else setMsg({ kind: 'error', text: 'تعذّر الحجز' });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (b: Booking) => {
    if (!confirm(`إلغاء موعد ${dayName(b.date)} ${shortDate(b.date)}؟`)) return;
    try {
      await api(`/me/bookings/${b.id}`, { method: 'DELETE' });
      await load();
    } catch (e: any) {
      setMsg({ kind: 'error', text: e.message });
    }
  };
  const withdraw = async (id: string) => {
    await api(`/me/changes/${id}`, { method: 'DELETE' }).catch((e) => setMsg({ kind: 'error', text: e.message }));
    await load();
  };
  const setDistrict = async (id: string) => {
    await api('/me/district', { method: 'PUT', body: { districtId: id || null } });
    await load();
    if (focus) setFocus(null);
  };
  const setMode = async (m: string) => {
    await api('/me/travel-mode', { method: 'PUT', body: { travelMode: m } });
    await load();
    setFocus(null);
  };

  if (me && !me.eligible) {
    return (
      <main className="shell">
        <TopBar me={me} />
        <div className="notice">وظيفتك غير مشمولة بالحضور المرن حسب بيانات جهتك. للاستفسار تواصل مع الموارد البشرية.</div>
      </main>
    );
  }

  const focusSlot = slots.find((s) => s.id === focus);

  return (
    <main className="shell">
      <TopBar me={me} />
      <div className="stack">
        <div className="spread">
          <div>
            <h1>مواعيد حضوري</h1>
            <div className="muted small">{me?.siteName ?? '—'} · اختر فترة الوصول لكل يوم ثم أكّد الحجز</div>
          </div>
          <div className="row">
            <label className="field">
              حي الانطلاق
              <select value={me?.districtId ?? ''} onChange={(e) => setDistrict(e.target.value)}>
                <option value="">— غير محدد —</option>
                {districts.map((d) => <option key={d.id} value={d.id}>{d.city} / {d.name}</option>)}
              </select>
            </label>
            <label className="field">
              وسيلة التنقل
              <select value={me?.travelMode ?? 'DRIVE'} onChange={(e) => setMode(e.target.value)}>
                {Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>
        </div>

        {msg && (
          <div className={`notice ${msg.kind}`}>
            {msg.text}
            {msg.alts && msg.alts.length > 0 && (
              <div className="row" style={{ marginTop: 8 }}>
                <span className="small">بدائل متاحة:</span>
                {msg.alts.map((a) => (
                  <button key={a.id} className="btn sm" onClick={() => pick(a.date, a.id)}><span className="ltr">{a.start}–{a.end}</span> ({a.remaining} متبقٍ)</button>
                ))}
              </div>
            )}
          </div>
        )}

        {weeks.length > 1 && (
          <div className="tabs" role="group" aria-label="الأسبوع">
            {weeks.map((w, i) => (
              <button key={i} aria-pressed={week === i} onClick={() => setWeek(i)}>
                {i === 0 ? 'هذا الأسبوع' : i === 1 ? 'الأسبوع القادم' : `أسبوع ${shortDate(w[0].date)}`}
              </button>
            ))}
          </div>
        )}

        <div className="week">
          {(weeks[week] ?? []).map(({ date, list }) => {
            const booking = bookingByDate[date];
            const leave = onLeave(date);
            return (
              <section key={date} className={`day ${booking ? 'booked' : ''}`}>
                <header>
                  <b>{dayName(date)}</b>
                  <span className="muted small">{shortDate(date)}</span>
                </header>
                {leave ? (
                  <div className="badge warn">إجازة</div>
                ) : (
                  <div className="slots">
                    {list.map((s) => {
                      const isCurrent = booking?.slot.id === s.id;
                      const isSel = selected[date] === s.id;
                      return (
                        <button
                          key={s.id}
                          className={`slot ${isSel ? 'selected' : ''} ${isCurrent ? 'current' : ''}`}
                          disabled={(s.full && !isCurrent) || s.past}
                          onClick={() => (isCurrent ? setFocus(s.id) : pick(date, s.id))}
                          aria-pressed={isSel}
                          title={s.past ? 'بدأت الفترة' : s.full ? 'بلغت الفترة حصتها' : `${s.remaining} مقعد متبقٍ`}
                        >
                          <span className="ltr">{s.start}–{s.end}</span>
                          <span className="cap">{isCurrent ? 'محجوز' : s.past ? 'انتهى' : s.full ? 'ممتلئ' : `${s.remaining} متبقٍ`}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {booking?.pendingChange && <div className="badge warn" style={{ marginTop: 8 }}>طلب تغيير إلى {booking.pendingChange.start} معلّق</div>}
              </section>
            );
          })}
        </div>

        {focusSlot && (
          <section className="card stack">
            <div className="spread">
              <h2 style={{ margin: 0 }}>متى أنطلق؟ — {dayName(focusSlot.date)} <span className="ltr">{focusSlot.start}–{focusSlot.end}</span></h2>
              {plan?.navigationUrl && <a className="btn" href={plan.navigationUrl} target="_blank" rel="noopener">فتح الملاحة في Google Maps ↗</a>}
            </div>
            {planLoading && <div className="muted">جارٍ حساب التقديرات…</div>}
            {!planLoading && plan?.message && <div className="notice">{plan.message}</div>}
            {!planLoading && plan?.plan && (
              <>
                <div className="options">
                  {plan.plan.options.map((o) => (
                    <div key={o.label} className={`option ${o.label === 'recommended' ? 'rec' : ''}`}>
                      <div className="small muted">{LABELS[o.label]}</div>
                      <div className="t">{clock(o.departAt, me?.timezone)}</div>
                      <div className="small">الوصول ≈ {clock(o.arriveAt, me?.timezone)} · الرحلة {mins(o.durationS)}</div>
                      {!o.onTime && <span className="badge bad">قد تتجاوز الفترة</span>}
                    </div>
                  ))}
                </div>
                <div className="muted small">
                  من حي {plan.district} · يشمل {plan.plan.entryBufferMin} دقائق للمشي والدخول.{' '}
                  {plan.plan.approximate
                    ? 'تقدير تقريبي (خدمة الخرائط غير متاحة الآن) — ليس قياسًا للزحام.'
                    : 'تقدير الزحام من Google Maps لوقت الانطلاق المحدد، وقد يتغير يوم الرحلة.'}
                </div>
              </>
            )}
          </section>
        )}

        <section className="card">
          <h2>حجوزاتي القادمة</h2>
          {bookings.length === 0 ? (
            <div className="muted">لا توجد حجوزات بعد.</div>
          ) : (
            <table>
              <thead>
                <tr><th>اليوم</th><th>الفترة</th><th>الحالة</th><th></th></tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id}>
                    <td>{dayName(b.date)} {shortDate(b.date)}</td>
                    <td className="num"><span className="ltr">{b.slot.start}–{b.slot.end}</span></td>
                    <td>
                      {b.pendingChange ? (
                        <span className="badge warn">تغيير إلى {b.pendingChange.start} بانتظار الاعتماد</span>
                      ) : (
                        <span className="badge ok">مؤكد</span>
                      )}
                    </td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <a className="btn sm" href={b.navigationUrl} target="_blank" rel="noopener">الملاحة ↗</a>
                        {b.pendingChange && <button className="btn sm" onClick={() => withdraw(b.pendingChange!.id)}>سحب الطلب</button>}
                        <button className="btn sm danger" onClick={() => cancel(b)}>إلغاء</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {policy && (
            <p className="muted small" style={{ marginBottom: 0 }}>
              الحجز متاح حتى {policy.horizonDays} يومًا مقدمًا. لتغيير موعد محجوز اختر فترة أخرى في اليوم نفسه
              {policy.requireChangeApproval ? ' ويُرسل الطلب للاعتماد' : ''} قبل {policy.changeCutoffHours} ساعة على الأقل.
            </p>
          )}
        </section>

        {(newItems.length > 0 || changeItems.length > 0) && (
          <div className="sticky-bar spread">
            <span>
              {newItems.length > 0 && `${newItems.length} حجز جديد`}
              {newItems.length > 0 && changeItems.length > 0 && ' · '}
              {changeItems.length > 0 && `${changeItems.length} طلب تغيير`}
            </span>
            <div className="row">
              <button className="btn" onClick={() => setSelected({})} disabled={busy}>تراجع</button>
              <button className="btn primary" onClick={submit} disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'تأكيد'}</button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
