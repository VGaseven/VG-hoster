'use client';
import Link from 'next/link';
import { api, Me } from '@/lib/api';

export function TopBar({ me }: { me: Me | null }) {
  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    location.href = '/login';
  };
  return (
    <header className="topbar">
      <Link href="/" className="brand">
        <img src="/icon.svg" alt="" />
        <span>مدار</span>
      </Link>
      {me && (
        <nav>
          <span className="muted small">{me.name} · {me.orgName}</span>
          <Link className="btn sm" href="/">مواعيدي</Link>
          {me.role === 'admin' && <Link className="btn sm" href="/admin">لوحة الجهة</Link>}
          <button className="btn sm" onClick={logout}>خروج</button>
        </nav>
      )}
    </header>
  );
}
