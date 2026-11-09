import { useCallback, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { Timeline } from '@/components/layout/Timeline';
import { ContextPanel } from '@/components/layout/ContextPanel';
import { MapToolbar } from '@/components/layout/MapToolbar';
import { MainMap } from '@/components/map/MainMap';
import { Toasts } from '@/components/ui/Toasts';
import { Tutorial } from '@/components/tutorial/Tutorial';
import { JudgeDemo } from '@/components/tutorial/JudgeDemo';
import { ShortcutsDialog } from '@/components/tutorial/ShortcutsDialog';
import { useSimClock } from '@/hooks/useSimClock';
import { useKeyboard } from '@/hooks/useKeyboard';
import { useStore } from '@/store/store';
import { useEffect } from 'react';

const FULL_PAGES = ['/compare', '/citizen', '/analytics', '/studio', '/settings'];

export function Layout() {
  const { pathname } = useLocation();
  const full = FULL_PAGES.some((p) => pathname.startsWith(p));
  const wide = pathname.startsWith('/optimize');
  const [help, setHelp] = useState(false);
  const openHelp = useCallback(() => setHelp(true), []);
  const lang = useStore((s) => s.lang);
  const reducedMotion = useStore((s) => s.reducedMotion);
  useSimClock();
  useKeyboard(openHelp);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = 'rtl';
    document.documentElement.classList.toggle('reduce-motion', reducedMotion);
  }, [lang, reducedMotion]);

  return (
    <div className="flex h-full w-full overflow-hidden" dir="rtl">
      <Sidebar />
      <main className="relative min-w-0 flex-1 overflow-hidden">
        <MainMap />
        {!full && (
          <>
            <TopBar />
            {!wide && <ContextPanel />}
            {!wide && <MapToolbar />}
            <Timeline />
          </>
        )}
        <div className={full ? 'absolute inset-0 z-30 overflow-hidden bg-ink-950' : 'pointer-events-none absolute inset-0 z-10'}>
          <Outlet />
        </div>
      </main>
      <Toasts />
      <Tutorial />
      <JudgeDemo />
      <ShortcutsDialog open={help} onClose={() => setHelp(false)} />
    </div>
  );
}

/** Floating start-side panel used by map-centric pages. */
export function SidePanel({ children, width = 384, testid, tour }: { children: React.ReactNode; width?: number; testid?: string; tour?: string }) {
  return (
    <section className="glass pointer-events-auto absolute bottom-[150px] right-3 top-[68px] z-20 flex flex-col overflow-hidden rounded-2xl" style={{ width }} data-testid={testid} data-tour={tour}>
      {children}
    </section>
  );
}
