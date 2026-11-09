import { NavLink } from 'react-router';
import { motion } from 'motion/react';
import { Bus, BarChart3, Clapperboard, Compass, FilePlus2, GitCompareArrows, GraduationCap, LayoutDashboard, Map as MapIcon, PanelRightClose, PanelRightOpen, Settings, ShieldAlert, Sparkles, UserRound, Wand2 } from 'lucide-react';
import { useStore } from '@/store/store';
import { useT } from '@/i18n/i18n';
import { cn } from '@/utils/format';
import { actionable, useConflicts } from '@/store/derived';
import { startShow } from '@/components/tutorial/RasdShow';

export const NAV = [
  { to: '/', label: 'نظرة عامة', icon: LayoutDashboard, tour: 'nav-overview' },
  { to: '/map', label: 'خريطة المدينة ثلاثية الأبعاد', icon: MapIcon, tour: 'nav-map' },
  { to: '/register', label: 'إدخال المشاريع', icon: FilePlus2, tour: 'nav-register' },
  { to: '/conflicts', label: 'تحليل التعارض', icon: ShieldAlert, tour: 'nav-conflicts', badge: true },
  { to: '/optimize', label: 'مقارنة البدائل', icon: Wand2, tour: 'nav-optimize' },
  { to: '/compare', label: 'مراجعة القرار والخطتان', icon: GitCompareArrows, tour: 'nav-compare' },
  { to: '/citizen', label: 'تجربة المواطن', icon: UserRound, tour: 'nav-citizen' },
  { to: '/operators', label: 'مشغّلو النقل', icon: Bus, tour: 'nav-operators' },
  { to: '/analytics', label: 'لوحة مؤشرات الأثر', icon: BarChart3, tour: 'nav-analytics' },
  { to: '/studio', label: 'استوديو المحاكاة', icon: Clapperboard, tour: 'nav-studio' },
];

export function Sidebar() {
  const t = useT();
  const open = useStore((s) => s.panels.left);
  const toggle = useStore((s) => s.togglePanel);
  const setTutorial = useStore((s) => s.setTutorial);
  const projects = useStore((s) => s.projects);
  const conflicts = actionable(useConflicts(projects));
  return (
    <motion.aside
      animate={{ width: open ? 236 : 64 }}
      transition={{ type: 'spring', stiffness: 260, damping: 30 }}
      className="rasd-bg-soft relative z-30 flex h-full shrink-0 flex-col border-l border-white/8"
      data-tour="sidebar"
    >
      <div className="flex h-14 items-center gap-2.5 border-b border-white/6 px-3.5">
        <img src="/assets/rasd-logo.svg" alt="" className="h-8 w-8 shrink-0" />
        {open && (
          <div className="min-w-0 leading-tight">
            <div className="text-[15px] font-bold tracking-tight">
              رصد <span className="font-medium text-slate-400">| RASD</span>
            </div>
            <div className="truncate text-[10.5px] text-slate-500">التنقل الذكي المدعوم بالبيانات · نقل ثون ٥</div>
          </div>
        )}
      </div>
      <nav className="scroll-thin flex-1 space-y-0.5 overflow-y-auto p-2" aria-label="التنقل الرئيسي">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            data-tour={n.tour}
            title={t(n.label)}
            className={({ isActive }) =>
              cn(
                'group relative flex h-10 items-center gap-3 rounded-lg px-3 text-[13px] transition-colors',
                isActive ? 'bg-violet-500/15 text-violet-100' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <motion.span layoutId="nav-ind" className="absolute inset-y-2 right-0 w-[3px] rounded-full bg-violet-400" />}
                <n.icon size={18} className="shrink-0" />
                {open && <span className="truncate">{t(n.label)}</span>}
                {n.badge && conflicts.length > 0 && (
                  <span className={cn('num rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white', open ? 'mr-auto' : 'absolute left-1.5 top-1.5')}>{conflicts.length}</span>
                )}
              </>
            )}
          </NavLink>
        ))}
        <div className="my-2 border-t border-white/6" />
        <button data-tour="nav-tutorial" onClick={() => setTutorial({ active: true, step: 0 })} className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-[13px] text-slate-400 hover:bg-white/5 hover:text-slate-100" title={t('الدليل التفاعلي')}>
          <GraduationCap size={18} className="shrink-0" />
          {open && <span>{t('الدليل التفاعلي')}</span>}
        </button>
        <NavLink to="/settings" className={({ isActive }) => cn('flex h-10 items-center gap-3 rounded-lg px-3 text-[13px]', isActive ? 'bg-violet-500/15 text-violet-100' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100')} title={t('الإعدادات')}>
          <Settings size={18} className="shrink-0" />
          {open && <span>{t('الإعدادات')}</span>}
        </NavLink>
      </nav>
      <div className="space-y-2 border-t border-white/6 p-2">
        <button
          data-tour="judge-demo"
          onClick={() => startShow(0)}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-l from-violet-600/40 to-indigo-600/30 text-[13px] font-semibold text-violet-50 ring-1 ring-violet-400/40 transition hover:from-violet-600/55 hover:to-indigo-600/45"
          title="عرض سيناريو رصد"
        >
          <Sparkles size={16} />
          {open && 'عرض سيناريو رصد'}
        </button>
        <button onClick={() => toggle('left')} className="flex h-8 w-full items-center justify-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-slate-200" aria-label="طي القائمة">
          {open ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
      </div>
      <Compass className="hidden" />
    </motion.aside>
  );
}
