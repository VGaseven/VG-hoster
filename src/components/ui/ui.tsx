import { type ButtonHTMLAttributes, type ReactNode, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '@/utils/format';

type Variant = 'primary' | 'ghost' | 'outline' | 'danger' | 'success' | 'subtle';

export function Button({ variant = 'outline', size = 'md', className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  const v: Record<Variant, string> = {
    primary: 'bg-cyan-400 text-slate-950 hover:bg-cyan-300 shadow-[0_0_24px_-6px_rgba(34,211,238,0.7)]',
    success: 'bg-emerald-400 text-slate-950 hover:bg-emerald-300',
    danger: 'bg-red-500/90 text-white hover:bg-red-500',
    ghost: 'text-slate-300 hover:bg-white/5 hover:text-white',
    subtle: 'bg-white/5 text-slate-200 hover:bg-white/10',
    outline: 'border border-white/12 text-slate-200 hover:border-cyan-400/50 hover:bg-cyan-400/5 hover:text-white',
  };
  const s = { sm: 'h-7 px-2.5 text-xs gap-1.5', md: 'h-9 px-3.5 text-sm gap-2', lg: 'h-11 px-5 text-sm gap-2' }[size];
  return (
    <button
      className={cn(
        'inline-flex select-none items-center justify-center rounded-lg font-medium transition-all duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-cyan-400',
        v[variant],
        s,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Panel({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('glass rounded-2xl', className)} {...rest}>
      {children}
    </div>
  );
}

export function SectionTitle({ icon, children, extra }: { icon?: ReactNode; children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
        {icon && <span className="text-cyan-300">{icon}</span>}
        {children}
      </h3>
      {extra}
    </div>
  );
}

const TONES: Record<string, string> = {
  slate: 'bg-slate-500/15 text-slate-300 ring-slate-400/20',
  sky: 'bg-sky-500/15 text-sky-300 ring-sky-400/25',
  red: 'bg-red-500/15 text-red-300 ring-red-400/30',
  amber: 'bg-amber-500/15 text-amber-300 ring-amber-400/30',
  violet: 'bg-violet-500/15 text-violet-300 ring-violet-400/30',
  emerald: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30',
  rose: 'bg-rose-500/15 text-rose-300 ring-rose-400/30',
  teal: 'bg-teal-500/15 text-teal-300 ring-teal-400/30',
  cyan: 'bg-cyan-500/15 text-cyan-300 ring-cyan-400/30',
};

export function Badge({ tone = 'slate', children, className }: { tone?: string; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap', TONES[tone] ?? TONES.slate, className)}>{children}</span>;
}

export function Stat({ label, value, sub, tone = 'text-white', icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
        {icon}
        {label}
      </div>
      <div className={cn('num mt-1 text-right text-xl font-semibold', tone)}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

export function Dialog({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/70 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cn('glass-strong w-full rounded-2xl p-5 shadow-2xl', wide ? 'max-w-3xl' : 'max-w-lg')}
            initial={{ y: 16, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 10, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold">{title}</h2>
              <button aria-label="إغلاق" className="rounded-md p-1 text-slate-400 hover:bg-white/5 hover:text-white" onClick={onClose}>
                <X size={18} />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto scroll-thin">{children}</div>
            {footer && <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Toggle({ checked, onChange, label, disabled, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; hint?: string }) {
  return (
    <label className={cn('flex cursor-pointer items-center justify-between gap-3 py-1.5 text-sm', disabled && 'cursor-not-allowed opacity-40')} title={hint}>
      <span className="text-slate-300">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-cyan-400' : 'bg-slate-600')}
      >
        <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', checked ? 'right-0.5' : 'right-[18px]')} />
      </button>
    </label>
  );
}

export function Field({ label, error, children, hint }: { label: string; error?: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-[11px] text-red-400">{error}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-lg border border-white/10 bg-ink-900/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/15';

export function Empty({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <div className="rounded-2xl bg-white/5 p-3 text-slate-400">{icon}</div>
      <div className="text-sm font-medium text-slate-200">{title}</div>
      {body && <div className="max-w-xs text-xs text-slate-500">{body}</div>}
      {action}
    </div>
  );
}

export function SimBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10.5px] font-semibold tracking-wide text-amber-300" data-testid="sim-badge">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
      SIMULATION DATA · بيانات محاكاة
    </span>
  );
}
