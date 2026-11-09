import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { useStore } from '@/store/store';

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  const icon = { success: <CheckCircle2 className="text-emerald-400" size={18} />, error: <XCircle className="text-red-400" size={18} />, info: <Info className="text-cyan-300" size={18} />, warning: <AlertTriangle className="text-amber-400" size={18} /> };
  return (
    <div className="pointer-events-none fixed bottom-28 left-4 z-[95] flex w-80 flex-col gap-2" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            className="glass-strong pointer-events-auto flex gap-3 rounded-xl p-3"
            role="status"
            onClick={() => dismiss(t.id)}
          >
            {icon[t.tone]}
            <div className="min-w-0">
              <div className="text-sm font-medium">{t.title}</div>
              {t.body && <div className="mt-0.5 text-xs text-slate-400">{t.body}</div>}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
