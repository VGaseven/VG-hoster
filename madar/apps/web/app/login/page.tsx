'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Footer, Header } from '../shell';

interface Account { name: string; email: string; role: string }

export default function Login() {
  const [opts, setOpts] = useState<{ devLogin: boolean; oidc: boolean } | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/auth/options').then(setOpts).catch(() => setErr('تعذّر الاتصال بالخادم. تأكد من تشغيل مدار.'));
    api<Account[]>('/auth/demo-accounts').then(setAccounts).catch(() => {});
  }, []);

  const login = async (email: string) => {
    setErr('');
    setBusy(true);
    try {
      await api('/auth/dev-login', { method: 'POST', body: { email } });
      location.href = '/';
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'تعذّر الدخول');
      setBusy(false);
    }
  };

  const employee = accounts.find((a) => a.email.startsWith('sara@')) ?? accounts.find((a) => a.role === 'employee');
  const admin = accounts.find((a) => a.role === 'admin');
  const others = accounts.filter((a) => a !== employee && a !== admin);

  return (
    <>
      <Header me={null} />
      <div className="login-wrap">
        <div className="login-card">
          <div>
            <h1 style={{ margin: 0, fontSize: 24 }}>تسجيل الدخول</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>احجز موعد حضورك المرن، واعرف متى تنطلق من حيّك.</p>
          </div>

          {opts?.oidc ? (
            <a className="btn primary block" href="/api/auth/oidc/start">الدخول بحساب الجهة</a>
          ) : (
            <button className="btn primary block" disabled title="يُفعَّل بعد ربط مدار بنظام الدخول في جهتك">الدخول بحساب الجهة</button>
          )}

          {opts?.devLogin && (
            <>
              <div className="divider">أو جرّب النسخة التجريبية</div>
              {employee && (
                <button className="btn outline block" disabled={busy} onClick={() => login(employee.email)}>
                  الدخول كموظف ({employee.name})
                </button>
              )}
              {admin && (
                <button className="btn block" disabled={busy} onClick={() => login(admin.email)}>
                  الدخول كمسؤول الجهة
                </button>
              )}
              {others.length > 0 && (
                <details>
                  <summary className="muted small" style={{ cursor: 'pointer' }}>موظفون تجريبيون آخرون</summary>
                  <div className="list" style={{ marginTop: 8 }}>
                    {others.map((a) => (
                      <div key={a.email} className="list-item">
                        <span>{a.name}</span>
                        <button className="btn sm" disabled={busy} onClick={() => login(a.email)}>دخول</button>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}

          {err && <div className="alert error">{err}</div>}
        </div>
      </div>
      <Footer />
    </>
  );
}
