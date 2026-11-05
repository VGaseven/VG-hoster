'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, fmtTime, longDate, Me, shortDate, Slot, dayName } from '@/lib/api';
import { Footer, Header, PageHead } from '../shell';

type Tab = 'today' | 'people' | 'capacity' | 'changes' | 'settings' | 'imports';
const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const MODES: Record<string, string> = { DRIVE: 'سيارة', TRANSIT: 'نقل عام', TWO_WHEELER: 'دراجة نارية', WALK: 'مشيًا' };
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
const pct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)}%`);

const STATUS: Record<string, { label: string; cls: string }> = {
  on_time: { label: 'وصل في موعده', cls: 'green' },
  late: { label: 'متأخر', cls: 'red' },
  booked: { label: 'محجوز', cls: '' },
  no_booking: { label: 'لم يحجز', cls: 'amber' },
  leave: { label: 'إجازة', cls: '' },
  not_eligible: { label: 'غير مشمول', cls: '' },
};

export default function Admin() {
  const [me, setMe] = useState<Me | null>(null);
  const [siteId, setSiteId] = useState('');
  const [sites, setSites] = useState<any[]>([]);
  const [tab, setTab] = useState<Tab>('today');
  const [pending, setPending] = useState(0);
  const [err, setErr] = useState('');

  useEffect(() => {
    api<Me>('/auth/me').then((m) => {
      setMe(m);
      if (m.role !== 'admin') location.href = '/';
    });
    api('/admin/sites').then((s) => {
      setSites(s);
      setSiteId(s[0]?.id ?? '');
    }).catch((e) => setErr(e.message));
    api('/admin/changes').then((c) => setPending(c.length)).catch(() => {});
  }, []);

  const TABS: Array<[Tab, string]> = [
    ['today', 'حضور اليوم'],
    ['people', 'الموظفون'],
    ['capacity', 'الأوقات والسعة'],
    ['changes', pending ? `طلبات التغيير (${pending})` : 'طلبات التغيير'],
    ['settings', 'الإعدادات'],
    ['imports', 'استيراد البيانات'],
  ];
  const site = sites.find((s) => s.id === siteId);

  return (
    <>
      <Header me={me} />
      <PageHead crumb="لوحة الجهة" title="لوحة الجهة" subtitle={site ? `${site.name} · ${site.eligibleEmployees} موظفًا مشمولًا بالمرونة` : undefined} />
      <main className="container">
        {sites.length > 1 && (
          <label className="field" style={{ maxWidth: 360 }}>
            المقر
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}
        <div className="tabs" role="tablist">
          {TABS.map(([t, label]) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{label}</button>
          ))}
        </div>
        {err && <div className="alert error">{err}</div>}
        {siteId && tab === 'today' && <Today siteId={siteId} />}
        {siteId && tab === 'people' && <People siteId={siteId} />}
        {siteId && tab === 'capacity' && <Capacity siteId={siteId} />}
        {tab === 'changes' && <Changes onCount={setPending} />}
        {siteId && tab === 'settings' && <Settings siteId={siteId} />}
        {tab === 'imports' && <Imports />}
      </main>
      <Footer org={me?.orgName} />
    </>
  );
}

/* ---------------- حضور اليوم ---------------- */
function Today({ siteId }: { siteId: string }) {
  const [date, setDate] = useState(todayLocal());
  const [rows, setRows] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    setRows(null);
    api(`/admin/sites/${siteId}/roster?date=${date}`).then(setRows);
  }, [siteId, date]);

  const count = (s: string) => rows?.filter((r) => r.status === s).length ?? 0;
  const byTime = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) if (r.start) m.set(r.start, (m.get(r.start) ?? 0) + 1);
    return [...m.entries()].sort();
  }, [rows]);
  const maxT = Math.max(1, ...byTime.map(([, n]) => n));
  const visible = (rows ?? []).filter((r) => (filter === 'all' || r.status === filter) && (!q || r.name.includes(q) || (r.district ?? '').includes(q)));

  const exportCsv = () => {
    const head = 'الاسم,الرقم الوظيفي,الحي,وقت الوصول,الانطلاق المخطط,الحضور الفعلي,الحالة';
    const lines = (rows ?? []).map((r) => [r.name, r.externalId, r.district ?? '', r.start ? `${r.start}-${r.end}` : '', r.plannedDeparture ?? '', r.checkIn ?? '', STATUS[r.status].label].join(','));
    const blob = new Blob(['﻿' + [head, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `madar-${date}.csv`;
    a.click();
  };

  return (
    <>
      <section className="panel">
        <div className="spread">
          <div>
            <h2>{longDate(date)}</h2>
            <p className="sub" style={{ margin: 0 }}>من سيصل ومتى، ومن حضر فعلًا.</p>
          </div>
          <div className="row">
            <button className="btn sm" onClick={() => setDate(addDays(date, -1))}>→ اليوم السابق</button>
            <button className="btn sm" onClick={() => setDate(todayLocal())}>اليوم</button>
            <button className="btn sm" onClick={() => setDate(addDays(date, 1))}>اليوم التالي ←</button>
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </div>
        </div>
        <div className="stats" style={{ marginTop: 20 }}>
          <div className="stat"><div className="label">لديهم موعد</div><div className="value">{(rows?.length ?? 0) - count('no_booking') - count('leave') - count('not_eligible')}</div></div>
          <div className="stat"><div className="label">وصلوا في موعدهم</div><div className="value">{count('on_time')}</div></div>
          <div className="stat"><div className="label">متأخرون</div><div className="value" style={{ color: 'var(--red-600)' }}>{count('late')}</div></div>
          <div className="stat"><div className="label">لم يحجزوا</div><div className="value" style={{ color: 'var(--amber-600)' }}>{count('no_booking')}</div></div>
          <div className="stat"><div className="label">في إجازة</div><div className="value" style={{ color: 'var(--gray-500)' }}>{count('leave')}</div></div>
        </div>
      </section>

      {byTime.length > 0 && (
        <section className="panel">
          <h2>توزيع الوصول</h2>
          <p className="sub">عدد الموظفين في كل وقت وصول.</p>
          <div className="bars">
            {byTime.map(([t, n]) => (
              <div key={t} className="bar">
                <span>{fmtTime(t)}</span>
                <div className="track"><div className="fill" style={{ width: `${(n / maxT) * 100}%` }} /></div>
                <span className="muted">{n} {n === 1 ? 'موظف' : 'موظفين'}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="spread" style={{ marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>مواعيد الموظفين</h2>
          <div className="row">
            <input type="text" placeholder="ابحث بالاسم أو الحي" value={q} onChange={(e) => setQ(e.target.value)} />
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">الكل</option>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <button className="btn sm" onClick={exportCsv} disabled={!rows?.length}>تصدير Excel</button>
          </div>
        </div>
        {!rows ? <div className="muted">جارٍ التحميل…</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>الموظف</th><th>الحي</th><th>وقت الوصول</th><th>ينطلق الساعة</th><th>الحضور الفعلي</th><th>الحالة</th></tr></thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id}>
                    <td><b>{r.name}</b><div className="muted small">{r.externalId}</div></td>
                    <td>{r.district ?? '—'}</td>
                    <td>{r.start ? `${fmtTime(r.start)} – ${fmtTime(r.end)}` : '—'}{r.pendingChangeTo && <div><span className="tag amber">يطلب {fmtTime(r.pendingChangeTo)}</span></div>}</td>
                    <td>{r.plannedDeparture ? fmtTime(r.plannedDeparture) : '—'}</td>
                    <td>{r.checkIn ? fmtTime(r.checkIn) : '—'}</td>
                    <td><span className={`tag ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span></td>
                  </tr>
                ))}
                {visible.length === 0 && <tr><td colSpan={6} className="muted">لا يوجد موظفون مطابقون.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/* ---------------- الموظفون ---------------- */
function People({ siteId }: { siteId: string }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => { api(`/admin/sites/${siteId}/employees`).then(setRows); }, [siteId]);
  const visible = (rows ?? []).filter((r) => !q || r.name.includes(q));
  return (
    <section className="panel">
      <div className="spread" style={{ marginBottom: 16 }}>
        <div>
          <h2>الموظفون</h2>
          <p className="sub" style={{ margin: 0 }}>الموعد المعتاد لكل موظف والتزامه خلال آخر ٣٠ يومًا.</p>
        </div>
        <input type="text" placeholder="ابحث بالاسم" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!rows ? <div className="muted">جارٍ التحميل…</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>الموظف</th><th>الحي</th><th>التنقل</th><th>الموعد المعتاد</th><th className="num">مواعيد قادمة</th><th>الالتزام</th></tr></thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.name}</b><div className="muted small">{r.externalId}</div></td>
                  <td>{r.district ?? '—'}</td>
                  <td>{MODES[r.travelMode] ?? r.travelMode}</td>
                  <td>{r.usualStart ? fmtTime(r.usualStart) : '—'}</td>
                  <td className="num">{r.upcoming}</td>
                  <td>
                    {r.onTimeRate == null ? <span className="muted">لا توجد بيانات</span> : (
                      <span className={`tag ${r.onTimeRate >= 0.85 ? 'green' : r.onTimeRate >= 0.6 ? 'amber' : 'red'}`}>
                        {pct(r.onTimeRate)} في الموعد{r.late ? ` · ${r.late} تأخر` : ''}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ---------------- الأوقات والسعة ---------------- */
function Capacity({ siteId }: { siteId: string }) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [date, setDate] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(() => api<Slot[]>(`/admin/sites/${siteId}/slots`).then((s) => {
    setSlots(s);
    setDate((d) => d ?? s.find((x) => x.date > todayLocal())?.date ?? s[0]?.date ?? null);
  }), [siteId]);
  useEffect(() => { load(); }, [load]);
  const dates = [...new Set(slots.map((s) => s.date))];
  const list = slots.filter((s) => s.date === date);
  const patch = async (s: Slot, body: any) => {
    setMsg('');
    try {
      const n = await api<Slot>(`/admin/sites/${siteId}/slots/${s.id}`, { method: 'PATCH', body });
      setSlots((xs) => xs.map((x) => (x.id === n.id ? n : x)));
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'تعذّر الحفظ');
      load();
    }
  };
  return (
    <section className="panel">
      <h2>الأوقات والسعة</h2>
      <p className="sub">الحد الأقصى لعدد الموظفين في كل وقت وصول، لتوزيع الحضور وتخفيف الزحام. عدّل الرقم أو أغلق الوقت عند الحاجة.</p>
      <div className="chips" style={{ marginBottom: 16 }}>
        {dates.map((d) => (
          <button key={d} aria-pressed={d === date} onClick={() => setDate(d)}>{dayName(d)} {shortDate(d)}</button>
        ))}
      </div>
      {msg && <div className="alert error" style={{ marginBottom: 12 }}>{msg}</div>}
      <div className="list">
        {list.map((s) => (
          <div key={s.id} className="list-item">
            <div style={{ minWidth: 160 }}>
              <b>{fmtTime(s.start)} – {fmtTime(s.end)}</b>
              <div className="muted small">{s.booked} من {s.quota} محجوز{s.closed ? ' · مغلق' : ''}</div>
            </div>
            <div className="track" style={{ flex: 1, minWidth: 120, height: 10, background: 'var(--gray-100)', borderRadius: 4, position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', insetBlock: 0, insetInlineStart: 0, width: `${Math.min(100, (s.booked / Math.max(1, s.quota)) * 100)}%`, background: s.booked >= s.quota ? 'var(--amber-600)' : 'var(--green-600)' }} />
            </div>
            <div className="row">
              <label className="row small">
                الحد الأقصى
                <input type="number" min={s.booked} defaultValue={s.quota} key={`${s.id}-${s.quota}`} onBlur={(e) => +e.target.value !== s.quota && patch(s, { quota: +e.target.value })} />
              </label>
              <button className="btn sm" onClick={() => patch(s, { closed: !s.closed })}>{s.closed ? 'فتح الوقت' : 'إغلاق الوقت'}</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------- طلبات التغيير ---------------- */
function Changes({ onCount }: { onCount: (n: number) => void }) {
  const [list, setList] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const load = () => api('/admin/changes').then((l) => { setList(l); onCount(l.length); });
  useEffect(() => { load(); }, []);
  const decide = async (id: string, approve: boolean) => {
    setMsg('');
    try {
      await api(`/admin/changes/${id}/decision`, { method: 'POST', body: { approve } });
    } catch (e: any) {
      setMsg(e.message);
    }
    load();
  };
  return (
    <section className="panel">
      <h2>طلبات التغيير</h2>
      <p className="sub">تظهر هنا فقط إذا فعّلت «مراجعة التغييرات يدويًا» في الإعدادات. يبقى موعد الموظف السابق ساريًا حتى تقرر.</p>
      {msg && <div className="alert error" style={{ marginBottom: 12 }}>{msg}</div>}
      {list.length === 0 ? <div className="alert success">لا توجد طلبات بانتظارك.</div> : (
        <div className="list">
          {list.map((c) => (
            <div key={c.id} className="list-item">
              <div>
                <b>{c.employee}</b> — {longDate(c.date)}
                <div className="muted small">من {fmtTime(c.from_start)} إلى {fmtTime(c.to_start)}{c.reason ? ` · ${c.reason}` : ''} · {c.to_remaining > 0 ? `${c.to_remaining} أماكن متاحة` : 'الوقت المطلوب مكتمل'}</div>
              </div>
              <div className="row">
                <button className="btn sm primary" onClick={() => decide(c.id, true)} disabled={c.to_remaining <= 0}>موافقة</button>
                <button className="btn sm danger" onClick={() => decide(c.id, false)}>رفض</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------------- الإعدادات ---------------- */
function Settings({ siteId }: { siteId: string }) {
  const [p, setP] = useState<any>(null);
  const [msg, setMsg] = useState<{ kind: string; text: string } | null>(null);
  useEffect(() => { api(`/admin/sites/${siteId}/policy`).then(setP).catch((e) => setMsg({ kind: 'error', text: e.message })); }, [siteId]);
  if (!p) return msg ? <div className="alert error">{msg.text}</div> : <div className="muted">جارٍ التحميل…</div>;
  const set = (k: string, v: any) => setP({ ...p, [k]: v });
  const save = async () => {
    setMsg(null);
    try {
      await api(`/admin/sites/${siteId}/policy`, { method: 'PUT', body: p });
      setMsg({ kind: 'success', text: 'تم حفظ الإعدادات، وطُبّقت على الأيام القادمة غير المحجوزة.' });
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof ApiError ? e.message : 'تعذّر الحفظ' });
    }
  };
  return (
    <section className="panel">
      <h2>الإعدادات</h2>
      <p className="sub">حدد نافذة الحضور المرن، وسيقسّمها مدار إلى أوقات وصول يختار منها الموظفون.</p>
      <div className="form-grid">
        <label className="field">أبكر وقت وصول<input type="time" value={p.earliestArrival} onChange={(e) => set('earliestArrival', e.target.value)} /></label>
        <label className="field">آخر وقت وصول<input type="time" value={p.latestArrival} onChange={(e) => set('latestArrival', e.target.value)} /></label>
        <label className="field">مدة كل وقت وصول
          <select value={p.slotMinutes} onChange={(e) => set('slotMinutes', +e.target.value)}>
            {[15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} دقيقة</option>)}
          </select>
        </label>
        <label className="field">الحد الأقصى في كل وقت<input type="number" min={0} value={p.defaultQuota} onChange={(e) => set('defaultQuota', +e.target.value)} /><span className="hint">عدد الموظفين المسموح لهم بالوصول في الوقت نفسه</span></label>
        <label className="field">الحد الأدنى في كل وقت<input type="number" min={0} value={p.defaultMinStaff} onChange={(e) => set('defaultMinStaff', +e.target.value)} /><span className="hint">لضمان وجود من يغطي العمل</span></label>
        <label className="field">الحجز مسبقًا حتى<select value={p.bookingHorizonDays} onChange={(e) => set('bookingHorizonDays', +e.target.value)}>{[7, 14, 21, 30].map((d) => <option key={d} value={d}>{d} يومًا</option>)}</select></label>
        <label className="field">آخر مهلة للتغيير<select value={p.changeCutoffHours} onChange={(e) => set('changeCutoffHours', +e.target.value)}>{[0, 1, 2, 6, 12, 24].map((h) => <option key={h} value={h}>{h === 0 ? 'حتى بداية الموعد' : `قبل الموعد بـ ${h} ساعة`}</option>)}</select></label>
        <label className="field">مهلة السماح بعد نهاية الوقت<select value={p.lateGraceMin} onChange={(e) => set('lateGraceMin', +e.target.value)}>{[0, 5, 10, 15, 30].map((m) => <option key={m} value={m}>{m} دقائق</option>)}</select></label>
      </div>
      <div style={{ marginTop: 20 }}>
        <div style={{ fontWeight: 500, marginBottom: 8 }}>أيام العمل</div>
        <div className="row">
          {WEEKDAYS.map((n, i) => (
            <label key={i} className="row small" style={{ gap: 6 }}>
              <input type="checkbox" checked={p.workdays.includes(i)} onChange={(e) => set('workdays', e.target.checked ? [...p.workdays, i].sort() : p.workdays.filter((x: number) => x !== i))} />
              {n}
            </label>
          ))}
        </div>
      </div>
      <label className="row" style={{ marginTop: 20, cursor: 'pointer' }}>
        <input type="checkbox" checked={p.requireChangeApproval} onChange={(e) => set('requireChangeApproval', e.target.checked)} />
        <span>مراجعة التغييرات يدويًا <span className="muted small">(إن لم تفعّلها، يُعتمد التغيير تلقائيًا متى توفر مكان. موصى به)</span></span>
      </label>
      {msg && <div className={`alert ${msg.kind}`} style={{ marginTop: 16 }}>{msg.text}</div>}
      <div style={{ marginTop: 20 }}><button className="btn primary" onClick={save}>حفظ الإعدادات</button></div>
    </section>
  );
}

/* ---------------- الاستيراد ---------------- */
const TEMPLATES = {
  hr: 'external_id,name,email,site_code,district,eligible,work_hours,travel_mode\nE100,اسم الموظف,employee@org.sa,HQ,الرياض/الملقا,true,8,DRIVE',
  leaves: 'external_id,start_date,end_date\nE100,2026-11-10,2026-11-12',
  attendance: 'external_id,date,check_in\nE100,2026-11-04,07:18',
};
const KIND_LABEL = { hr: 'قائمة الموظفين', leaves: 'الإجازات', attendance: 'سجل الحضور (البصمة)' };

function Imports() {
  const [kind, setKind] = useState<keyof typeof TEMPLATES>('hr');
  const [csv, setCsv] = useState(TEMPLATES.hr);
  const [result, setResult] = useState<any>(null);
  const [batches, setBatches] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const load = () => api('/admin/imports').then(setBatches);
  useEffect(() => { load(); }, []);
  const run = async () => {
    setErr('');
    setResult(null);
    try {
      setResult(await api(`/admin/imports/${kind}`, { method: 'POST', body: { csv } }));
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  return (
    <section className="panel">
      <h2>استيراد البيانات</h2>
      <p className="sub">ارفع ملف Excel محفوظًا بصيغة CSV من نظام الموارد البشرية أو البصمة. لا نطلب عناوين المنازل، الحي فقط.</p>
      <div className="form-grid">
        <label className="field">نوع الملف
          <select value={kind} onChange={(e) => { const k = e.target.value as keyof typeof TEMPLATES; setKind(k); setCsv(TEMPLATES[k]); setResult(null); }}>
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="field">الملف
          <input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
        </label>
      </div>
      <details style={{ marginTop: 16 }}>
        <summary className="muted small" style={{ cursor: 'pointer' }}>عرض محتوى الملف أو تعديله</summary>
        <textarea value={csv} onChange={(e) => setCsv(e.target.value)} spellCheck={false} style={{ marginTop: 8 }} />
      </details>
      <div style={{ marginTop: 16 }}><button className="btn primary" onClick={run}>استيراد</button></div>
      {err && <div className="alert error" style={{ marginTop: 12 }}>{err}</div>}
      {result && (
        <div className={`alert ${result.failed ? 'warn' : 'success'}`} style={{ marginTop: 12 }}>
          <div>
            تم استيراد {result.ok} من {result.total} سطر{result.failed ? `، وتعذّر ${result.failed}` : ''}.
            {result.errors?.length > 0 && (
              <ul className="small" style={{ margin: '6px 0 0' }}>
                {result.errors.slice(0, 10).map((e: any) => <li key={e.row}>سطر {e.row}: {e.error}</li>)}
              </ul>
            )}
          </div>
        </div>
      )}
      {batches.length > 0 && (
        <>
          <h3 style={{ marginTop: 28 }}>آخر عمليات الاستيراد</h3>
          <div className="list">
            {batches.slice(0, 8).map((b) => (
              <div key={b.id} className="list-item small">
                <span>{KIND_LABEL[b.kind as keyof typeof KIND_LABEL] ?? b.kind}</span>
                <span>{b.ok_count} من {b.row_count}{b.error_count ? ` · ${b.error_count} أخطاء` : ''}</span>
                <span className="muted">{new Date(b.created_at).toLocaleString('ar-SA-u-nu-latn')}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
