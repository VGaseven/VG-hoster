import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useStore, type Speed } from '@/store/store';
import { startShow } from '@/components/tutorial/RasdShow';

const SPEEDS: Speed[] = [0.5, 1, 2, 4];

export const SHORTCUTS: [string, string][] = [
  ['Space', 'تشغيل / إيقاف المحاكاة'],
  ['R', 'إعادة ضبط الكاميرا'],
  ['2 / 3', 'عرض ثنائي / ثلاثي الأبعاد'],
  ['[ / ]', 'إبطاء / تسريع المحاكاة'],
  ['B', 'تبديل قبل / بعد التنسيق'],
  ['T', 'جولة سينمائية'],
  ['N', 'عرض سيناريو رصد (من مشهد التعارض)'],
  ['G', 'فتح الدليل التفاعلي'],
  ['?', 'عرض الاختصارات'],
  ['Esc', 'إلغاء التحديد / إيقاف الكاميرا'],
];

export function useKeyboard(onHelp: () => void) {
  const navigate = useNavigate();
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const s = useStore.getState();
      switch (e.key) {
        case ' ':
          e.preventDefault();
          s.togglePlay();
          break;
        case 'r':
        case 'R':
          s.cameraCmd({ type: 'reset' });
          break;
        case '2':
          s.set3D(false);
          break;
        case '3':
          s.set3D(true);
          break;
        case '[':
          s.setSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(s.speed) - 1)]);
          break;
        case ']':
          s.setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(s.speed) + 1)]);
          break;
        case 'b':
        case 'B':
          s.setViewMode(s.viewMode === 'after' ? 'before' : 'after');
          break;
        case 't':
        case 'T':
          s.cameraCmd({ type: 'tour' });
          break;
        case 'n':
        case 'N':
          startShow(2);
          break;
        case 'g':
        case 'G':
          s.setTutorial({ active: true, step: 0 });
          break;
        case '?':
          onHelp();
          break;
        case 'Escape':
          s.selectProject(null);
          s.selectConflict(null);
          s.cameraCmd({ type: 'stop' });
          break;
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [navigate, onHelp]);
}
