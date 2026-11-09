import { useStore } from '@/store/store';

const EN: Record<string, string> = {
  'رصد': 'RASD',
  'نظرة عامة': 'Overview',
  'خريطة المدينة ثلاثية الأبعاد': '3D City Map',
  'تسجيل مشروع': 'Project Registration',
  'كشف التعارضات': 'Conflict Detection',
  'مركز تحسين الجدولة': 'Optimization Center',
  'مقارنة السيناريوهات': 'Scenario Comparison',
  'تجربة المواطن': 'Citizen Experience',
  'لوحة مؤشرات الأثر': 'Analytics',
  'استوديو المحاكاة': 'Video Studio',
  'الدليل التفاعلي': 'Interactive Tutorial',
  'الإعدادات': 'Settings',
  'عرض الحكام': 'Judge Demo',
  'بيانات محاكاة': 'SIMULATION DATA',
  'المشاريع النشطة': 'Active projects',
  'التعارضات': 'Conflicts',
  'السيناريو': 'Scenario',
  'المحاكاة تعمل': 'Simulation running',
  'المحاكاة متوقفة': 'Simulation paused',
  'بدء المحاكاة': 'Start simulation',
  'إيقاف مؤقت': 'Pause',
  'إعادة التشغيل': 'Restart',
  'قبل التنسيق': 'Before coordination',
  'بعد التنسيق': 'After coordination',
  'محاكاة تعارض جديد': 'Simulate a new conflict',
  'المشاريع': 'Projects',
  'بحث في المشاريع…': 'Search projects…',
  'تفاصيل المشروع': 'Project details',
  'الإشعارات': 'Notifications',
  'المنطقة': 'District',
};

export function useT() {
  const lang = useStore((s) => s.lang);
  return (ar: string) => (lang === 'en' ? (EN[ar] ?? ar) : ar);
}

export function useLang() {
  return useStore((s) => s.lang);
}
