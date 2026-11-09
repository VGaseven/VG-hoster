import { AnimatePresence, motion } from 'motion/react';
import { PanelLeftClose, PanelLeftOpen, X, MousePointerClick } from 'lucide-react';
import { useStore } from '@/store/store';
import { ProjectDetails } from '@/components/projects/ProjectDetails';
import { Empty } from '@/components/ui/ui';
import { useT } from '@/i18n/i18n';

export function ContextPanel() {
  const t = useT();
  const open = useStore((s) => s.panels.right);
  const toggle = useStore((s) => s.togglePanel);
  const selectedId = useStore((s) => s.selectedProjectId);
  const select = useStore((s) => s.selectProject);
  const project = useStore((s) => s.projects.find((p) => p.id === selectedId));
  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.aside
            initial={{ x: -24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -24, opacity: 0 }}
            className="glass pointer-events-auto absolute bottom-[150px] left-3 top-[68px] z-20 flex w-[340px] flex-col rounded-2xl"
            data-tour="context-panel"
            aria-label={t('تفاصيل المشروع')}
          >
            <div className="flex items-center justify-between border-b border-white/6 px-4 py-3">
              <span className="text-[13px] font-semibold">{t('تفاصيل المشروع')}</span>
              <div className="flex items-center gap-1">
                {project && (
                  <button className="rounded p-1 text-slate-400 hover:bg-white/5 hover:text-white" onClick={() => select(null)} aria-label="إلغاء التحديد">
                    <X size={15} />
                  </button>
                )}
                <button className="rounded p-1 text-slate-400 hover:bg-white/5 hover:text-white" onClick={() => toggle('right', false)} aria-label="طي اللوحة">
                  <PanelLeftClose size={15} />
                </button>
              </div>
            </div>
            <div className="scroll-thin flex-1 overflow-y-auto p-4">
              {project ? <ProjectDetails key={project.id} project={project} /> : <Empty icon={<MousePointerClick size={22} />} title="لم يتم اختيار مشروع" body="اختر مشروعاً من الخريطة أو القائمة أو الخط الزمني لعرض تفاصيله والقرارات المتاحة." />}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
      {!open && (
        <button className="glass pointer-events-auto absolute left-3 top-[68px] z-20 grid h-10 w-10 place-items-center rounded-xl text-slate-300 hover:text-white" onClick={() => toggle('right', true)} aria-label="فتح لوحة التفاصيل">
          <PanelLeftOpen size={16} />
        </button>
      )}
    </>
  );
}
