import { useLocation, useNavigate } from 'react-router';
import { cn } from '@/utils/format';

/** Official RASD mechanism: بيانات ← تحليل ← بدائل ← مراجعة */
export const WORKFLOW = [
  { n: '١', label: 'إدخال المشاريع', to: '/register', match: ['/register', '/'] },
  { n: '٢', label: 'تحليل التعارض', to: '/conflicts', match: ['/conflicts'] },
  { n: '٣', label: 'مقارنة البدائل', to: '/optimize', match: ['/optimize'] },
  { n: '٤', label: 'مراجعة القرار', to: '/compare', match: ['/compare'] },
];

export function WorkflowStepper({ compact }: { compact?: boolean }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const active = WORKFLOW.findIndex((s) => s.match.some((m) => (m === '/' ? pathname === '/' : pathname.startsWith(m))));
  return (
    <nav className="flex items-center" aria-label="مراحل رصد" data-tour="workflow" data-testid="workflow-stepper">
      {WORKFLOW.map((s, i) => (
        <button
          key={s.to}
          onClick={() => navigate(s.to)}
          className={cn(
            'relative flex items-center gap-1.5 border border-white/10 px-3 text-[11.5px] transition',
            compact ? 'h-7' : 'h-8',
            i === 0 ? 'rounded-r-lg' : '-mr-px',
            i === WORKFLOW.length - 1 && 'rounded-l-lg',
            i === active ? 'z-10 border-violet-400/60 bg-violet-500/20 text-white' : i < active ? 'bg-white/[0.04] text-slate-300' : 'bg-transparent text-slate-500 hover:text-slate-200',
          )}
        >
          <span className={cn('num grid h-4 w-4 place-items-center rounded-full text-[10px]', i === active ? 'bg-violet-400 text-white' : 'bg-white/10')}>{s.n}</span>
          {s.label}
        </button>
      ))}
    </nav>
  );
}
