import { Dialog } from '@/components/ui/ui';
import { SHORTCUTS } from '@/hooks/useKeyboard';

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="اختصارات لوحة المفاتيح">
      <div className="grid grid-cols-1 gap-1.5">
        {SHORTCUTS.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-sm">
            <span className="text-slate-300">{v}</span>
            <kbd className="num rounded-md border border-white/15 bg-black/30 px-2 py-0.5 text-xs">{k}</kbd>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
