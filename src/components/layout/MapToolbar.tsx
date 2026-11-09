import { Box, Compass, Crosshair, Eye, Film, Layers, Minus, Move3d, Orbit, Plus, RotateCcw, RotateCw, Square, ChevronsUp, ChevronsDown } from 'lucide-react';
import { useState } from 'react';
import { useStore } from '@/store/store';
import { Toggle } from '@/components/ui/ui';
import { satelliteAvailable, terrainAvailable } from '@/components/map/styles';
import { cn } from '@/utils/format';
import type { BaseStyle } from '@/components/map/styles';
import { projectMidpoint } from '@/engine/spatial/geometry';

export function MapToolbar() {
  const is3D = useStore((s) => s.is3D);
  const set3D = useStore((s) => s.set3D);
  const cam = useStore((s) => s.cameraCmd);
  const overlays = useStore((s) => s.overlays);
  const setOverlay = useStore((s) => s.setOverlay);
  const baseStyle = useStore((s) => s.baseStyle);
  const setBaseStyle = useStore((s) => s.setBaseStyle);
  const selected = useStore((s) => s.projects.find((p) => p.id === s.selectedProjectId));
  const [layersOpen, setLayersOpen] = useState(false);
  const rightOpen = useStore((s) => s.panels.right);
  const kit = useStore((s) => s.kitStatus);
  const Btn = ({ onClick, label, children, active, testid }: { onClick: () => void; label: string; children: React.ReactNode; active?: boolean; testid?: string }) => (
    <button onClick={onClick} title={label} aria-label={label} data-testid={testid} className={cn('grid h-9 w-9 place-items-center rounded-lg transition hover:bg-white/8 active:scale-95', active ? 'bg-cyan-400/15 text-cyan-200' : 'text-slate-300')}>
      {children}
    </button>
  );
  const styles: { id: BaseStyle; label: string; disabled?: boolean; hint?: string }[] = [
    { id: 'dark', label: 'داكن (متجهي)' },
    { id: 'light', label: 'فاتح' },
    { id: 'satellite', label: 'فضائي', disabled: !satelliteAvailable(), hint: 'يتطلب ضبط VITE_SATELLITE_TILES لمزوّد مرخّص' },
    { id: 'offline', label: 'توأم رقمي محلي' },
  ];
  return (
    <div className="pointer-events-none absolute top-[68px] z-20 flex flex-col gap-2" style={{ left: rightOpen ? 360 : 60 }} data-tour="map-controls">
      <div className="glass pointer-events-auto flex flex-col rounded-xl p-1">
        <Btn onClick={() => set3D(!is3D)} label={is3D ? 'التبديل إلى 2D' : 'التبديل إلى 3D'} active={is3D} testid="toggle-3d">
          {is3D ? <Box size={17} /> : <Square size={17} />}
        </Btn>
        <Btn onClick={() => cam({ type: 'zoom', delta: 1 })} label="تكبير">
          <Plus size={17} />
        </Btn>
        <Btn onClick={() => cam({ type: 'zoom', delta: -1 })} label="تصغير">
          <Minus size={17} />
        </Btn>
        <Btn onClick={() => cam({ type: 'rotate', delta: -30 })} label="تدوير">
          <RotateCw size={16} />
        </Btn>
        <Btn onClick={() => cam({ type: 'rotate', delta: 30 })} label="تدوير عكسي">
          <RotateCcw size={16} />
        </Btn>
        <Btn onClick={() => cam({ type: 'pitch', delta: 12 })} label="إمالة لأعلى">
          <ChevronsUp size={16} />
        </Btn>
        <Btn onClick={() => cam({ type: 'pitch', delta: -12 })} label="إمالة لأسفل">
          <ChevronsDown size={16} />
        </Btn>
        <Btn onClick={() => cam({ type: 'reset' })} label="إعادة ضبط الكاميرا" testid="reset-camera">
          <Compass size={17} />
        </Btn>
      </div>
      <div className="glass pointer-events-auto flex flex-col rounded-xl p-1">
        <Btn onClick={() => selected && cam({ type: 'fly', center: projectMidpoint(selected), zoom: 16.2, pitch: 62 })} label="التركيز على المشروع المحدد">
          <Crosshair size={16} />
        </Btn>
        <Btn onClick={() => cam({ type: 'orbit', center: selected ? projectMidpoint(selected) : undefined })} label="الدوران حول التقاطع">
          <Orbit size={16} />
        </Btn>
        <Btn onClick={() => cam({ type: 'follow' })} label="تتبّع مركبة محاكاة">
          <Move3d size={16} />
        </Btn>
        <Btn onClick={() => cam({ type: 'tour' })} label="جولة سينمائية" testid="tour">
          <Film size={16} />
        </Btn>
        <Btn onClick={() => setLayersOpen(!layersOpen)} label="الطبقات" active={layersOpen} testid="layers">
          <Layers size={16} />
        </Btn>
      </div>
      {layersOpen && (
        <div className="glass-strong pointer-events-auto absolute right-12 top-0 w-60 rounded-xl p-3" style={{ left: 48, right: 'auto' }}>
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-400">
            <Eye size={13} /> الخريطة الأساسية
          </div>
          <div className="mb-3 grid grid-cols-2 gap-1">
            {styles.map((s) => (
              <button key={s.id} disabled={s.disabled} title={s.hint} onClick={() => setBaseStyle(s.id)} className={cn('rounded-md border px-2 py-1.5 text-[11.5px] disabled:opacity-35', baseStyle === s.id ? 'border-cyan-400/50 bg-cyan-400/10 text-cyan-100' : 'border-white/8 text-slate-300 hover:border-white/20')} data-testid={`style-${s.id}`}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="mb-1 text-xs font-semibold text-slate-400">الطبقات</div>
          <Toggle label="كثافة الحركة المرورية" checked={overlays.traffic} onChange={(v) => setOverlay('traffic', v)} />
          <Toggle label="إغلاقات الطرق" checked={overlays.closures} onChange={(v) => setOverlay('closures', v)} />
          <Toggle label="مشاريع البنية التحتية" checked={overlays.projects} onChange={(v) => setOverlay('projects', v)} />
          <Toggle label="التعارضات" checked={overlays.conflicts} onChange={(v) => setOverlay('conflicts', v)} />
          <Toggle label="المركبات المحاكاة" checked={overlays.vehicles} onChange={(v) => setOverlay('vehicles', v)} />
          <Toggle label="المباني ثلاثية الأبعاد" checked={overlays.buildings} onChange={(v) => setOverlay('buildings', v)} />
          <Toggle label="نماذج المباني المرخّصة (اختياري)" checked={overlays.kitbash} disabled={kit.state !== 'ready'} hint="ضع ملفات GLB في public/models/kitbash ثم npm run models:index" onChange={(v) => setOverlay('kitbash', v)} />
          <Toggle label="أسماء الأحياء" checked={overlays.neighborhoods} onChange={(v) => setOverlay('neighborhoods', v)} />
          <Toggle label="التضاريس" checked={overlays.terrain} disabled={!terrainAvailable()} hint="يتطلب VITE_TERRAIN_TILES" onChange={(v) => setOverlay('terrain', v)} />
        </div>
      )}
    </div>
  );
}
