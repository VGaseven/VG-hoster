import { useEffect, useRef, useState } from 'react';
import { Player } from '@remotion/player';
import { Clapperboard, Download, Film, Loader2, Terminal, TriangleAlert } from 'lucide-react';
import { RasdVideo, DEFAULT_VIDEO_PROPS, FPS, PRESETS, sceneFrames, type VideoProps } from '../../../video/compositions/RasdVideo';
import { Button, Panel, SectionTitle, Toggle } from '@/components/ui/ui';
import { cn } from '@/utils/format';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import { loadVideoKit, videoKit } from '../../../video/kit';

interface Job {
  id: string;
  status: 'queued' | 'rendering' | 'done' | 'error';
  progress: number;
  stage: string;
  file?: string;
  error?: string;
  seconds?: number;
}

const SCENES = ['الفكرة', 'إدخال المشاريع', 'تحليل التعارض', 'البدائل', 'مراجعة الجهة', 'الخطتان', 'المواطن', 'الختام'];

export default function StudioPage() {
  const [props, setProps] = useState<VideoProps>(DEFAULT_VIDEO_PROPS);
  const [job, setJob] = useState<Job | null>(null);
  const [server, setServer] = useState<'checking' | 'online' | 'offline'>('checking');
  const [err, setErr] = useState<string | null>(null);
  const [kitReady, setKitReady] = useState(false);
  useEffect(() => {
    void loadVideoKit().then(() => setKitReady(!!videoKit()));
  }, []);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const preset = PRESETS[props.preset];
  const frames = sceneFrames(props.durationSec);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => setServer(r.ok ? 'online' : 'offline'))
      .catch(() => setServer('offline'));
    return () => {
      if (poll.current) clearInterval(poll.current);
    };
  }, []);

  const startRender = async () => {
    setErr(null);
    try {
      const r = await fetch('/api/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(props) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { id } = (await r.json()) as { id: string };
      setJob({ id, status: 'queued', progress: 0, stage: 'queued' });
      setServer('online');
      poll.current = setInterval(async () => {
        const s = (await (await fetch(`/api/render/${id}`)).json()) as Job;
        setJob(s);
        if (s.status === 'done' || s.status === 'error') clearInterval(poll.current!);
      }, 1000);
    } catch (e) {
      setServer('offline');
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const cmd = `npm run export-sim -- --preset ${props.preset} --duration ${props.durationSec} --camera ${props.cameraStyle}${props.captions ? '' : ' --no-captions'}${props.metrics ? '' : ' --no-metrics'}`;

  return (
    <div className="flex h-full" data-testid="studio-page">
      <div className="flex min-w-0 flex-1 flex-col p-6">
        <h1 className="mb-4 flex items-center gap-2 text-xl font-bold">
          <Clapperboard className="text-cyan-300" /> استوديو المحاكاة
        </h1>
        <div className="grid min-h-0 flex-1 place-items-center rounded-2xl border border-white/8 bg-black/40 p-4">
          <div dir="ltr" style={{ aspectRatio: `${preset.w}/${preset.h}`, maxHeight: '100%', maxWidth: '100%', height: preset.h >= preset.w ? '100%' : undefined, width: preset.h < preset.w ? '100%' : undefined }}>
            <Player
              key={kitReady ? 'kit' : 'base'}
              component={RasdVideo}
              inputProps={props}
              durationInFrames={props.durationSec * FPS}
              fps={FPS}
              compositionWidth={preset.w}
              compositionHeight={preset.h}
              style={{ width: '100%', height: '100%' }}
              controls
              loop
              initialFrame={75}
              acknowledgeRemotionLicense
              data-testid="video-player"
            />
          </div>
        </div>
        <div className="mt-3 flex gap-1" dir="ltr">
          {frames.map((f, i) => (
            <div key={i} className="rounded-md bg-white/5 px-2 py-1 text-center text-[10.5px] text-slate-400" style={{ flex: f }} dir="rtl">
              {SCENES[i]} <span className="num text-slate-600">{(f / FPS).toFixed(1)}ث</span>
            </div>
          ))}
        </div>
      </div>
      <aside className="scroll-thin w-[360px] shrink-0 space-y-4 overflow-y-auto border-r border-white/6 p-5">
        <Panel className="p-4">
          <SectionTitle icon={<Film size={16} />}>إعدادات الفيديو</SectionTitle>
          {kitReady && <div className="mb-1 text-[11.5px] text-violet-300">نماذج المباني المرخّصة مفعّلة ({videoKit()?.models} نماذج)</div>}
          <div className="text-[12px] text-slate-400">السيناريو: حي العليا — مشروعان افتراضيان متقاربان (نفس بيانات التطبيق)</div>
          <div className="mt-3 text-xs font-semibold text-slate-400">الدقة</div>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((k) => (
              <button key={k} onClick={() => setProps({ ...props, preset: k })} className={cn('rounded-lg border px-2 py-1.5 text-[12px]', props.preset === k ? 'border-cyan-400/50 bg-cyan-400/10 text-cyan-100' : 'border-white/10 text-slate-300')} data-testid={`preset-${k}`}>
                <span className="num">{PRESETS[k].label}</span>
                {k === '4k' && <span className="block text-[10px] text-slate-500">أبطأ في التصيير</span>}
              </button>
            ))}
          </div>
          <div className="mt-3 text-xs font-semibold text-slate-400">المدة</div>
          <div className="mt-1.5 flex gap-1.5">
            {[45, 54, 60].map((d) => (
              <button key={d} onClick={() => setProps({ ...props, durationSec: d })} className={cn('num flex-1 rounded-lg border py-1.5 text-[12px]', props.durationSec === d ? 'border-cyan-400/50 bg-cyan-400/10' : 'border-white/10 text-slate-300')}>
                {d}s
              </button>
            ))}
          </div>
          <div className="mt-3 text-xs font-semibold text-slate-400">نمط الكاميرا</div>
          <div className="mt-1.5 flex gap-1.5">
            {(
              [
                ['cinematic', 'سينمائي'],
                ['orbit', 'مداري'],
                ['topdown', 'علوي'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} onClick={() => setProps({ ...props, cameraStyle: k })} className={cn('flex-1 rounded-lg border py-1.5 text-[12px]', props.cameraStyle === k ? 'border-cyan-400/50 bg-cyan-400/10' : 'border-white/10 text-slate-300')}>
                {l}
              </button>
            ))}
          </div>
          <div className="mt-2">
            <Toggle label="ترجمة عربية على الشاشة" checked={props.captions} onChange={(v) => setProps({ ...props, captions: v })} />
            <Toggle label="لوحات المؤشرات" checked={props.metrics} onChange={(v) => setProps({ ...props, metrics: v })} />
          </div>
        </Panel>
        <Panel className="p-4" data-tour="render">
          <SectionTitle icon={<Download size={16} />}>تصدير MP4</SectionTitle>
          <Button variant="primary" className="w-full" onClick={startRender} disabled={job?.status === 'rendering' || job?.status === 'queued'} data-testid="render-button">
            {job?.status === 'rendering' || job?.status === 'queued' ? <Loader2 className="animate-spin" size={15} /> : <Film size={15} />} تصدير الفيديو
          </Button>
          {job && (
            <div className="mt-3 text-[12px]" data-testid="render-progress">
              <div className="flex justify-between text-slate-400">
                <span>{job.status === 'done' ? 'اكتمل' : job.status === 'error' ? 'فشل' : `جارٍ التصيير (${job.stage})`}</span>
                <span className="num">{Math.round(job.progress * 100)}%</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-white/10">
                <div className="h-full rounded-full bg-cyan-400 transition-all" style={{ width: `${job.progress * 100}%` }} />
              </div>
              {job.status === 'done' && job.file && (
                <div className="mt-3 space-y-2">
                  <video src={`/api/files/${job.file}`} controls className="w-full rounded-lg" />
                  <a href={`/api/files/${job.file}`} download className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-400 py-2 text-[13px] font-semibold text-slate-950" data-testid="download-video">
                    <Download size={14} /> تحميل {job.file}
                  </a>
                  <div className="text-[11px] text-slate-500">حُفظ أيضاً في output/rasd-simulation.mp4 · زمن التصيير {job.seconds?.toFixed(0)} ث</div>
                </div>
              )}
              {job.status === 'error' && <div className="mt-2 text-red-300">{job.error}</div>}
            </div>
          )}
          {(server === 'offline' || err) && (
            <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/5 p-2.5 text-[11.5px] leading-relaxed text-amber-100">
              <div className="flex items-center gap-1.5 font-semibold">
                <TriangleAlert size={13} /> عامل التصيير المحلي غير متصل
              </div>
              شغّل <code className="num rounded bg-black/30 px-1">npm run dev</code> (يشغّل الواجهة والعامل معاً) أو <code className="num rounded bg-black/30 px-1">npm run render-server</code>.
            </div>
          )}
          <div className="mt-3 rounded-lg bg-black/30 p-2.5">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] text-slate-400">
              <Terminal size={12} /> أو من الطرفية:
            </div>
            <code className="num block break-all text-[11px] text-cyan-200" dir="ltr">
              {cmd}
            </code>
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-slate-500">التصيير حتمي إطاراً بإطار: المشهد يُرسم بمحرك SVG ثنائي ونصف الأبعاد من نفس بيانات المحاكاة ومحرك التعارض، ولا يعتمد على خريطة WebGL حية.</p>
        </Panel>
      </aside>
    </div>
  );
}
