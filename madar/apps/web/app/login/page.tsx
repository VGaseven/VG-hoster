'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';

export default function Login() {
  const [opts, setOpts] = useState<{ devLogin: boolean; oidc: boolean } | null>(null);
  const [accounts, setAccounts] = useState<Array<{ name: string; email: string; role: string }>>([]);
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    api('/auth/options').then(setOpts).catch(() => setErr('تعذّر الاتصال بالخادم'));
    api('/auth/demo-accounts').then(setAccounts).catch(() => {});
  }, []);

  const devLogin = async (e: string) => {
    setErr('');
    try {
      await api('/auth/dev-login', { method: 'POST', body: { email: e } });
      location.href = '/';
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'تعذّر الدخول');
    }
  };

  return (
    <main className="shell">
      <div className="login stack">
        <div className="row">
          <img src="/icon.svg" alt="" width={44} height={44} />
          <div>
            <h1>مدار</h1>
            <div className="muted">اختر موعد حضورك المرن، واعرف متى تنطلق.</div>
          </div>
        </div>
        <div className="card stack">
          {opts?.oidc && (
            <a className="btn primary" href="/api/auth/oidc/start">تسجيل الدخول بحساب الجهة</a>
          )}
          {opts && !opts.oidc && !opts.devLogin && <div className="notice">لم يُضبط تسجيل الدخول بعد. تواصل مع مسؤول النظام.</div>}
          {opts?.devLogin && (
            <>
              <div className="notice small">وضع تجريبي: الدخول بالبريد دون كلمة مرور. يُعطَّل في الإنتاج.</div>
              <form className="row" onSubmit={(e) => { e.preventDefault(); devLogin(email); }}>
                <input type="email" required placeholder="البريد الوظيفي" value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: 1 }} dir="ltr" />
                <button className="btn primary">دخول</button>
              </form>
              {accounts.length > 0 && (
                <div className="stack" style={{ gap: 6 }}>
                  <span className="muted small">حسابات تجريبية</span>
                  {accounts.map((a) => (
                    <button key={a.email} className="btn" onClick={() => devLogin(a.email)} style={{ justifyContent: 'space-between' }}>
                      <span>{a.name}</span>
                      <span className={`badge ${a.role === 'admin' ? 'warn' : ''}`}>{a.role === 'admin' ? 'مسؤول' : 'موظف'}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {err && <div className="notice error">{err}</div>}
        </div>
      </div>
    </main>
  );
}
