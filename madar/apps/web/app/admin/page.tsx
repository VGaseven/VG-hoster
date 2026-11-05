'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, dayName, Me, shortDate, Slot } from '@/lib/api';
import { TopBar } from '../topbar';

type Tab = 'dashboard' | 'slots' | 'policy' | 'changes' | 'imports';
const TABS: Record<Tab, string> = { dashboard: 'توزيع الحضور', slots: 'الفترات والحصص', policy: 'سياسة المرونة', changes: 'طلبات التغيير', imports: 'ربط البيانات' };
const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const pct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)}%`);

export default function Admin() {
  const [me, setMe] = useState<Me | null>(null);
  const [sites, setSites] = useState<any[]>([]);
  const [siteId, setSiteId] = useState('');
  const [tab, setTab] = useState<Tab>('dashboard');
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
  }, []);

  return (
    <main className="shell">
      <TopBar me={me} />
      <div className="stack">
        <div className="spread">
          <div>
            <h1>لوحة الجهة</h1>
            <div className="muted small">اضبط المرونة وتابع توزيع الحضور على الفترات</div>
          </div>
          {sites.length > 1 && (
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </div>
        <div className="tabs" role="tablist">
          {(Object.keys(TABS) as Tab[]).map((t) => (
            <button key={t} role="tab" aria-pressed={tab === t} onClick={() => setTab(t)}>{TABS[t]}</button>
          ))}
        </div>
        {err && <div className="notice error">{err}</div>}
        {siteId && tab === 'dashboard' && <Dashboard siteId={siteId} />}
        {siteId && tab === 'slots' && <Slots siteId={siteId} />}
        {siteId && tab === 'policy' && <Policy siteId={siteId} />}
        {tab === 'changes' && <Changes />}
        {tab === 'imports' && <Imports />}
      </div>
    </main>
  );
}

function Dashboard({ siteId }: { siteId: string }) {
  const [d, setD] = useState<any>(null);
  const [day, setDay] = useState<string | null>(null);
  useEffect(() => {
    api(`/admin/sites/${siteId}/dashboard`).then((r) => {
      setD(r);
      const withBookings = r.distribution.find((x: any) => x.totalBooked > 0);
      setDay((withBookings ?? r.distribution[0])?.date ?? null);
    });
  }, [siteId]);
  if (!d) return <div className="muted">جارٍ التحميل…</div>;
  const c = d.compliance;
  const sel = d.distribution.find((x: any) => x.date === day);
  const maxQ = Math.max(1, ...(sel?.slots ?? []).map((s: any) => Math.max(s.quota, s.booked)));
  return (
    <div className="stack">
      <section className="card">
        <h2>الالتزام الفعلي ({shortDate(c.period.from)} – {shortDate(c.period.to)})</h2>
        <div className="stats">
          <div className="stat"><span className="small muted">حجوزات منتهية</span><b>{c.total}</b></div>
          <div className="stat"><span className="small muted">وصول في الفترة</span><b>{c.onTime}</b></div>
          <div className="stat"><span className="small muted">متأخر</span><b>{c.late}</b></div>
          <div className="stat"><span className="small muted">بلا سجل حضور</span><b>{c.noRecord}</b></div>
          <div className="stat"><span className="small muted">نسبة الالتزام</span><b>{pct(c.onTimeRate)}</b></div>
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>{c.note}. «بلا سجل» قد يعني غيابًا أو تأخر استيراد الحضور.</p>
      </section>

      <section className="card stack">
        <div className="spread">
          <h2 style={{ margin: 0 }}>توزيع الحجوزات على الفترات</h2>
          <div className="tabs">
            {d.distribution.map((x: any) => (
              <button key={x.date} aria-pressed={x.date === day} onClick={() => setDay(x.date)}>
                {dayName(x.date)} {shortDate(x.date)} · {x.totalBooked}
              </button>
            ))}
          </div>
        </div>
        {sel ? (
          <div className="bars">
            {sel.slots.map((s: any) => (
              <div key={s.slotId} className="bar">
                <span>{s.start}</span>
                <div className="track" title={`محجوز ${s.booked} من ${s.quota} · حضر ${s.attended} · الحد الأدنى ${s.minStaff}`}>
                  <div className="fill" style={{ width: `${(s.booked / maxQ) * 100}%`, opacity: s.closed ? 0.3 : 1 }} />
                  {s.attended > 0 && <div className="fill att" style={{ width: `${(s.attended / maxQ) * 100}%` }} />}
                  {s.minStaff > 0 && <div className="min" style={{ insetInlineStart: `${(s.minStaff / maxQ) * 100}%` }} />}
                </div>
                <span className="muted">{s.booked}/{s.quota}{s.underCovered ? ' ⚠' : ''}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted">لا توجد فترات في هذا النطاق.</div>
        )}
        <div className="row small muted">
          <span><span className="badge ok">■</span> محجوز</span>
          <span><span className="badge warn">■</span> حضر فعليًا</span>
          <span><span className="badge bad">|</span> الحد الأدنى للتغطية</span>
        </div>
      </section>

      {d.alerts.length > 0 && (
        <section className="card">
          <h2>فترات دون الحد الأدنى للتغطية</h2>
          <table>
            <thead><tr><th>اليوم</th><th>الفترة</th><th className="num">محجوز</th><th className="num">الحد الأدنى</th></tr></thead>
            <tbody>
              {d.alerts.slice(0, 15).map((a: any, i: number) => (
                <tr key={i}><td>{dayName(a.date)} {shortDate(a.date)}</td><td className="num">{a.start}</td><td className="num">{a.booked}</td><td className="num">{a.minStaff}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function Slots({ siteId }: { siteId: string }) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [msg, setMsg] = useState('');
  const load = useCallback(() => api<Slot[]>(`/admin/sites/${siteId}/slots`).then(setSlots), [siteId]);
  useEffect(() => { load(); }, [load]);
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
  const byDate = slots.reduce<Record<string, Slot[]>>((a, s) => ((a[s.date] ??= []).push(s), a), {});
  return (
    <section className="card stack">
      <div>
        <h2 style={{ marginBottom: 2 }}>الفترات والحصص</h2>
        <div className="muted small">الحصة تنظّم عدد المشاركين في كل فترة، وليست سعة الطريق. لا يمكن خفضها دون عدد الحجوزات القائمة.</div>
      </div>
      {msg && <div className="notice error">{msg}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>اليوم</th><th>الفترة</th><th className="num">محجوز</th><th>الحصة</th><th>الحد الأدنى</th><th>مغلقة</th></tr></thead>
          <tbody>
            {Object.entries(byDate).flatMap(([date, list]) =>
              list.map((s, i) => (
                <tr key={s.id}>
                  <td>{i === 0 ? `${dayName(date)} ${shortDate(date)}` : ''}</td>
                  <td className="num"><span className="ltr">{s.start}–{s.end}</span></td>
                  <td className="num">{s.booked}</td>
                  <td><input type="number" min={s.booked} defaultValue={s.quota} onBlur={(e) => +e.target.value !== s.quota && patch(s, { quota: +e.target.value })} /></td>
                  <td><input type="number" min={0} defaultValue={s.minStaff} onBlur={(e) => +e.target.value !== s.minStaff && patch(s, { minStaff: +e.target.value })} /></td>
                  <td><input type="checkbox" checked={s.closed} onChange={(e) => patch(s, { closed: e.target.checked })} /></td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Policy({ siteId }: { siteId: string }) {
  const [p, setP] = useState<any>(null);
  const [msg, setMsg] = useState<{ kind: string; text: string } | null>(null);
  useEffect(() => { api(`/admin/sites/${siteId}/policy`).then(setP).catch((e) => setMsg({ kind: 'error', text: e.message })); }, [siteId]);
  if (!p) return msg ? <div className="notice error">{msg.text}</div> : <div className="muted">جارٍ التحميل…</div>;
  const set = (k: string, v: any) => setP({ ...p, [k]: v });
  const save = async () => {
    setMsg(null);
    try {
      const r = await api(`/admin/sites/${siteId}/policy`, { method: 'PUT', body: p });
      setMsg({ kind: 'info', text: `حُفظت السياسة وأعيد توليد الفترات المستقبلية غير المحجوزة (${r.removed} فترة).` });
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof ApiError ? e.message : 'تعذّر الحفظ' });
    }
  };
  return (
    <section className="card stack">
      <h2 style={{ margin: 0 }}>سياسة المرونة</h2>
      <div className="form-grid">
        <label className="field">أول وقت وصول<input type="time" value={p.earliestArrival} onChange={(e) => set('earliestArrival', e.target.value)} /></label>
        <label className="field">آخر وقت وصول<input type="time" value={p.latestArrival} onChange={(e) => set('latestArrival', e.target.value)} /></label>
        <label className="field">طول الفترة (دقيقة)
          <select value={p.slotMinutes} onChange={(e) => set('slotMinutes', +e.target.value)}>
            {[10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="field">الحصة الافتراضية لكل فترة<input type="number" min={0} value={p.defaultQuota} onChange={(e) => set('defaultQuota', +e.target.value)} /></label>
        <label className="field">الحد الأدنى للتغطية<input type="number" min={0} value={p.defaultMinStaff} onChange={(e) => set('defaultMinStaff', +e.target.value)} /></label>
        <label className="field">الحجز مقدمًا (يوم)<input type="number" min={1} max={90} value={p.bookingHorizonDays} onChange={(e) => set('bookingHorizonDays', +e.target.value)} /></label>
        <label className="field">مهلة طلب التغيير (ساعة)<input type="number" min={0} value={p.changeCutoffHours} onChange={(e) => set('changeCutoffHours', +e.target.value)} /></label>
        <label className="field">مهلة السماح للتأخر (دقيقة)<input type="number" min={0} value={p.lateGraceMin} onChange={(e) => set('lateGraceMin', +e.target.value)} /></label>
      </div>
      <div className="row">
        <span className="small muted">أيام العمل:</span>
        {WEEKDAYS.map((n, i) => (
          <label key={i} className="row small" style={{ gap: 4 }}>
            <input type="checkbox" checked={p.workdays.includes(i)} onChange={(e) => set('workdays', e.target.checked ? [...p.workdays, i].sort() : p.workdays.filter((x: number) => x !== i))} />
            {n}
          </label>
        ))}
      </div>
      <label className="row small">
        <input type="checkbox" checked={p.requireChangeApproval} onChange={(e) => set('requireChangeApproval', e.target.checked)} />
        طلبات التغيير تحتاج اعتماد المسؤول
      </label>
      {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}
      <div><button className="btn primary" onClick={save}>حفظ السياسة</button></div>
    </section>
  );
}

function Changes() {
  const [list, setList] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const load = () => api('/admin/changes').then(setList);
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
    <section className="card">
      <h2>طلبات التغيير المعلّقة</h2>
      <p className="muted small">يبقى موعد الموظف السابق ساريًا حتى الاعتماد. عند الاعتماد تُفحص حصة الفترة الجديدة من جديد.</p>
      {msg && <div className="notice error">{msg}</div>}
      {list.length === 0 ? <div className="muted">لا توجد طلبات معلّقة.</div> : (
        <table>
          <thead><tr><th>الموظف</th><th>اليوم</th><th>من</th><th>إلى</th><th className="num">المتبقي</th><th>السبب</th><th></th></tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id}>
                <td>{c.employee}</td>
                <td>{dayName(c.date)} {shortDate(c.date)}</td>
                <td className="num">{c.from_start}</td>
                <td className="num">{c.to_start}</td>
                <td className="num">{c.to_remaining}</td>
                <td className="small">{c.reason ?? '—'}</td>
                <td>
                  <div className="row">
                    <button className="btn sm primary" onClick={() => decide(c.id, true)} disabled={c.to_remaining <= 0}>اعتماد</button>
                    <button className="btn sm danger" onClick={() => decide(c.id, false)}>رفض</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const TEMPLATES = {
  hr: 'external_id,name,email,site_code,district,eligible,work_hours,travel_mode\nE100,اسم الموظف,employee@org.sa,HQ,الرياض/الملقا,true,8,DRIVE',
  leaves: 'external_id,start_date,end_date\nE100,2026-11-10,2026-11-12',
  attendance: 'external_id,date,check_in\nE100,2026-11-04,07:18',
};
const KIND_LABEL = { hr: 'الموارد البشرية (الموظفون والأهلية)', leaves: 'الإجازات', attendance: 'الحضور الفعلي المعتمد' };

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
  const sync = async () => {
    setErr('');
    try {
      setResult(await api('/admin/integrations/hr/sync', { method: 'POST' }));
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  return (
    <div className="grid2">
      <section className="card stack">
        <h2 style={{ margin: 0 }}>استيراد ملف بيانات معتمد</h2>
        <div className="muted small">البداية بملف CSV معتمد من الجهة، ثم ربط API رسمي عند إتاحته. لا نطلب عنوان المنزل — الحي فقط.</div>
        <label className="field">نوع البيانات
          <select value={kind} onChange={(e) => { const k = e.target.value as keyof typeof TEMPLATES; setKind(k); setCsv(TEMPLATES[k]); }}>
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="field">ملف CSV
          <input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
        </label>
        <textarea value={csv} onChange={(e) => setCsv(e.target.value)} spellCheck={false} />
        <div className="row">
          <button className="btn primary" onClick={run}>استيراد</button>
          {kind === 'hr' && <button className="btn" onClick={sync}>مزامنة من API الموارد البشرية</button>}
        </div>
        {err && <div className="notice error">{err}</div>}
        {result && (
          <div className={`notice ${result.failed ? '' : 'info'}`}>
            نجح {result.ok} من {result.total}{result.failed ? `، وفشل ${result.failed}` : ''}.
            {result.errors?.length > 0 && (
              <ul className="small" style={{ margin: '6px 0 0' }}>
                {result.errors.slice(0, 10).map((e: any) => <li key={e.row}>سطر {e.row}: {e.error}</li>)}
              </ul>
            )}
          </div>
        )}
      </section>
      <section className="card">
        <h2>سجل الاستيراد</h2>
        {batches.length === 0 ? <div className="muted">لا يوجد.</div> : (
          <table>
            <thead><tr><th>النوع</th><th>المصدر</th><th className="num">ناجح</th><th className="num">أخطاء</th><th>الوقت</th></tr></thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td>{KIND_LABEL[b.kind as keyof typeof KIND_LABEL] ?? b.kind}</td>
                  <td>{b.source === 'api' ? 'API' : 'ملف'}</td>
                  <td className="num">{b.ok_count}/{b.row_count}</td>
                  <td className="num">{b.error_count}</td>
                  <td className="small">{new Date(b.created_at).toLocaleString('ar-SA-u-nu-latn')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
