import { useEffect, useState } from 'react';
import { Database, Keyboard, Map as MapIcon, RotateCcw, Server, Settings } from 'lucide-react';
import { useStore } from '@/store/store';
import { Button, Dialog, Panel, SectionTitle, Toggle } from '@/components/ui/ui';
import { SHORTCUTS } from '@/hooks/useKeyboard';
import { BASEMAP_DARK, BASEMAP_LIGHT, satelliteAvailable, terrainAvailable } from '@/components/map/styles';
import { GEOMETRY_NOTE_AR, SEGMENTS, NODES } from '@/data/network';
import { DATA_SEED } from '@/utils/random';
import { HORIZON_START, HORIZON_DAYS } from '@/utils/date';
import { OD_PAIRS, PEAK_TRIPS } from '@/engine/traffic/assignment';
import { fmtNum } from '@/utils/format';

export function SettingsPage() {
  const s = useStore();
  const [confirm, setConfirm] = useState(false);
  const [render, setRender] = useState<'checking' | 'online' | 'offline'>('checking');
  useEffect(() => {
    fetch('/api/health')
      .then((r) => setRender(r.ok ? 'online' : 'offline'))
      .catch(() => setRender('offline'));
  }, []);
  return (
    <div className="scroll-thin h-full overflow-y-auto p-6" data-testid="settings-page">
      <h1 className="mb-5 flex items-center gap-2 text-xl font-bold">
        <Settings className="text-cyan-300" /> الإعدادات
      </h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="p-4">
          <SectionTitle icon={<MapIcon size={16} />}>العرض والخريطة</SectionTitle>
          <Toggle label="اللغة الإنجليزية لعناصر الواجهة (English UI chrome)" checked={s.lang === 'en'} onChange={(v) => s.setLang(v ? 'en' : 'ar')} />
          <Toggle label="تقليل الحركة (Reduced motion)" checked={s.reducedMotion} onChange={s.setReducedMotion} />
          <Toggle label="عرض ثلاثي الأبعاد" checked={s.is3D} onChange={s.set3D} />
          <div className="mt-2 grid grid-cols-2 gap-1.5 text-[12px]">
            {(['dark', 'light', 'satellite', 'offline'] as const).map((b) => (
              <button key={b} disabled={b === 'satellite' && !satelliteAvailable()} onClick={() => s.setBaseStyle(b)} className={`rounded-lg border px-2 py-2 disabled:opacity-35 ${s.baseStyle === b ? 'border-cyan-400/50 bg-cyan-400/10' : 'border-white/10'}`}>
                {{ dark: 'خريطة داكنة', light: 'خريطة فاتحة', satellite: 'صور فضائية', offline: 'توأم رقمي محلي' }[b]}
              </button>
            ))}
          </div>
        </Panel>
        <Panel className="p-4">
          <SectionTitle icon={<Server size={16} />}>مزودو البيانات والخدمات</SectionTitle>
          <ul className="space-y-1.5 text-[12px] text-slate-300">
            <li>الخريطة الداكنة: <span className="num text-slate-400">{BASEMAP_DARK}</span></li>
            <li>الخريطة الفاتحة: <span className="num text-slate-400">{BASEMAP_LIGHT}</span></li>
            <li>الصور الفضائية: {satelliteAvailable() ? 'مُعدّة' : 'غير مُعدّة (VITE_SATELLITE_TILES)'}</li>
            <li>التضاريس: {terrainAvailable() ? 'مُعدّة' : 'غير مُعدّة (VITE_TERRAIN_TILES)'}</li>
            <li data-testid="kit-status">
              نماذج المباني المرخّصة (اختياري):{' '}
              {s.kitStatus.state === 'ready'
                ? `مفعّلة — ${s.kitStatus.name} (${s.kitStatus.models} نماذج، ${s.kitStatus.instances} موضعاً داخل حي العليا)`
                : s.kitStatus.state === 'loading'
                  ? 'جارٍ التحميل…'
                  : s.kitStatus.state === 'error'
                    ? `خطأ: ${s.kitStatus.message}`
                    : 'غير موجودة — ضع ملفات GLB في public/models/kitbash ثم شغّل npm run models:index'}
            </li>
            <li>محرك التوجيه: موجّه محلي على شبكة الدراسة (محاكاة) — OSRM اختياري</li>
            <li>
              خادم تصدير الفيديو المحلي:{' '}
              <span className={render === 'online' ? 'text-emerald-300' : render === 'offline' ? 'text-amber-300' : 'text-slate-400'} data-testid="render-status">
                {render === 'online' ? 'متصل' : render === 'offline' ? 'غير متصل — شغّل npm run render-server' : 'جارٍ الفحص…'}
              </span>
            </li>
          </ul>
          <p className="mt-3 text-[11px] text-slate-500">عند تعذر الوصول لخرائط الإنترنت تتحول المنصة تلقائياً إلى التوأم الرقمي المحلي (مبانٍ تقريبية مولّدة بالبذرة {DATA_SEED}).</p>
        </Panel>
        <Panel className="p-4">
          <SectionTitle icon={<Database size={16} />}>بيانات السيناريو</SectionTitle>
          <ul className="space-y-1.5 text-[12px] text-slate-300">
            <li>المشاريع: <span className="num">{s.projects.length}</span> (تركيبية — ليست أعمالاً حكومية حقيقية)</li>
            <li>شبكة الدراسة: <span className="num">{SEGMENTS.filter((x) => x.closable).length}</span> مقطعاً، <span className="num">{NODES.length}</span> عقدة</li>
            <li>أزواج المنشأ–الوجهة: <span className="num">{OD_PAIRS.length}</span> · رحلات ساعة الذروة: <span className="num">{fmtNum(PEAK_TRIPS)}</span> مركبة/ساعة (تركيبي)</li>
            <li>أفق المحاكاة: <span className="num">{HORIZON_START}</span> لمدة <span className="num">{HORIZON_DAYS}</span> يوماً · البذرة <span className="num">{DATA_SEED}</span></li>
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{GEOMETRY_NOTE_AR}</p>
          <Button variant="danger" className="mt-3" onClick={() => setConfirm(true)} data-testid="reset-scenario">
            <RotateCcw size={15} /> إعادة ضبط السيناريو
          </Button>
        </Panel>
        <Panel className="p-4">
          <SectionTitle icon={<Keyboard size={16} />}>اختصارات لوحة المفاتيح</SectionTitle>
          <div className="grid grid-cols-1 gap-1">
            {SHORTCUTS.map(([k, v]) => (
              <div key={k} className="flex justify-between text-[12px]">
                <span className="text-slate-400">{v}</span>
                <kbd className="num rounded border border-white/15 px-1.5 text-[11px]">{k}</kbd>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="إعادة ضبط السيناريو؟"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              إلغاء
            </Button>
            <Button
              variant="danger"
              data-testid="confirm-reset"
              onClick={() => {
                s.resetScenario();
                s.toast({ tone: 'info', title: 'أُعيد ضبط السيناريو', body: 'تم التراجع عن جميع القرارات التجريبية.' });
                setConfirm(false);
              }}
            >
              إعادة الضبط
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">سيتم حذف المشاريع المسجلة وإلغاء جميع قرارات الاعتماد التجريبية واستعادة البيانات الأصلية.</p>
      </Dialog>
    </div>
  );
}
