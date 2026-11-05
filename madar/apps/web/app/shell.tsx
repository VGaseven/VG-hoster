'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api, Me } from '@/lib/api';

export function Header({ me }: { me: Me | null }) {
  const path = usePathname();
  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    location.href = '/login';
  };
  return (
    <header className="site-header">
      <div className="inner">
        <Link href="/" className="logo">
          <img src="/icon.svg" alt="" />
          <div>
            <b>مدار</b>
            <span>منصة مواعيد الحضور المرن</span>
          </div>
        </Link>
        {me && (
          <nav className="site-nav" aria-label="القائمة الرئيسية">
            <Link href="/" className={path === '/' ? 'active' : ''}>مواعيدي</Link>
            {me.role === 'admin' && <Link href="/admin" className={path === '/admin' ? 'active' : ''}>لوحة الجهة</Link>}
            <div className="user-chip">
              <div className="avatar" aria-hidden>{me.name.trim()[0]}</div>
              <span className="name">{me.name}</span>
              <button className="btn sm" onClick={logout}>خروج</button>
            </div>
          </nav>
        )}
      </div>
    </header>
  );
}

export function PageHead({ title, subtitle, crumb }: { title: string; subtitle?: string; crumb?: string }) {
  return (
    <div className="page-head">
      <div className="inner">
        {crumb && <div className="crumbs">الرئيسية / {crumb}</div>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
    </div>
  );
}

export function Footer({ org }: { org?: string }) {
  return (
    <footer className="site-footer">
      <div className="inner">
        <span>مدار — منصة مواعيد الحضور المرن{org ? ` · ${org}` : ''}</span>
        <span>نسخة تجريبية</span>
      </div>
    </footer>
  );
}
