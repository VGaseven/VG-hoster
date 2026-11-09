/**
 * Deterministic 30-second video capture of the 5-block 3D prototype.
 * Frames are driven explicitly (window.__capture.frame(i)) by scripts/capture-twin.cjs.
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { TwinScene } from './TwinScene';
import { DEMO_EXCAVATIONS, type Excavation } from './adapter';
import { assignTwin, closuresOf, detectTwinConflicts, metricsFor, recommend, roadVc } from './model';
import { PROTOTYPE_LABEL_AR } from './layout';
import { fmtNum } from '@/utils/format';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';

export const FPS = 30;
export const SECONDS = 30;
const [A, B] = DEMO_EXCAVATIONS;
const conflictAB = detectTwinConflicts([A, B])[0];
const REC = recommend([A, B], conflictAB);
const M = {
  normal: metricsFor([], []),
  a: metricsFor([A], []),
  ab: metricsFor([A, B], [conflictAB]),
  after: metricsFor([A], []),
};

type Phase = 'normal' | 'a' | 'ab' | 'conflict' | 'after' | 'compare';
const phaseAt = (t: number): Phase => (t < 5 ? 'normal' : t < 11 ? 'a' : t < 13.5 ? 'ab' : t < 17.5 ? 'conflict' : t < 23 ? 'after' : 'compare');

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** camera keyframes [t, position, target] */
const KEYS: [number, THREE.Vector3, THREE.Vector3][] = [
  [0, V(700, 560, 720), V(40, 0, 80)],
  [4.5, V(520, 380, 520), V(30, 0, 100)],
  [7.5, V(70, 48, 250), V(0, 0, 170)],
  [10.5, V(-28, 9, 300), V(0, 2, 150)],
  [13, V(420, 300, 330), V(110, 0, 150)],
  [17, V(380, 240, 260), V(110, 0, 160)],
  [20, V(232, 26, 360), V(212, 2, 120)],
  [23, V(-280, 30, 490), V(60, 8, 430)],
  [26.5, V(520, 420, 600), V(60, 0, 140)],
  [30, V(760, 620, 780), V(40, 0, 80)],
];
function camAt(t: number) {
  let i = 0;
  while (i < KEYS.length - 2 && t > KEYS[i + 1][0]) i++;
  const [t0, p0, q0] = KEYS[i];
  const [t1, p1, q1] = KEYS[i + 1];
  const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  const k = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  return { pos: p0.clone().lerp(p1, k), target: q0.clone().lerp(q1, k) };
}

const CAPTIONS: Record<Phase, { title: string; body: string }> = {
  normal: { title: 'رصد — حي النخيل، الرياض', body: 'حركة طبيعية على طريق الأمير تركي الأول وشارع النخيل' },
  a: { title: 'الحفرية أ — الطريق الرئيسي', body: 'مرفق المياه يغلق مسارين: الحركة تتباطأ وتتحول إلى شارع النخيل' },
  ab: { title: 'الحفرية ب — مسار التحويل نفسه', body: 'جهة أخرى تخطط — بشكل مستقل — لإغلاق شارع النخيل في نفس الأسبوع' },
  conflict: { title: '⚠ رصد يكشف التعارض', body: 'الطريق الرئيسي وبديله مغلقان معاً في فترة متداخلة' },
  after: { title: 'توصية رصد: تأخير الموعد حسب الأولوية', body: `تأجيل الحفرية ب إلى ${REC.to.start} — يبقى شارع النخيل مفتوحاً` },
  compare: { title: 'قبل / بعد التنسيق', body: 'نفس الطلب المروري — أرقام تقديرية من نموذج محاكاة' },
};

export default function TwinCapture() {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<TwinScene | null>(null);
  const [t, setT] = useState(0);
  const lastPhase = useRef<Phase | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const s = new TwinScene(host.current);
    s.stopLoop();
    sceneRef.current = s;
    const apply = (ph: Phase) => {
      const active: Excavation[] = ph === 'normal' ? [] : ph === 'a' || ph === 'after' || ph === 'compare' ? [A] : [A, B];
      const conflicts = ph === 'conflict' ? [conflictAB] : [];
      const asg = assignTwin(closuresOf(active));
      s.setState({
        active,
        assignment: asg,
        vcByRoad: roadVc(asg),
        affected: [],
        conflictRoads: conflicts.length ? [A.roadId, B.roadId] : [],
        recommendedRoads: ph === 'after' || ph === 'compare' ? ['B-0', 'B-1', 'B-2', 'B-3'] : [],
      });
    };
    apply('normal');
    // warm up traffic so the first frame is already busy
    for (let k = 0; k < 240; k++) s.renderFrame(1 / FPS);
    Object.assign(window as object, {
      __capture: {
        frames: FPS * SECONDS,
        ready: true,
        frame(i: number) {
          const tt = i / FPS;
          const ph = phaseAt(tt);
          if (ph !== lastPhase.current) {
            apply(ph);
            lastPhase.current = ph;
          }
          s.renderFrame(1 / FPS, camAt(tt));
          setT(tt);
        },
      },
    });
    return () => s.dispose();
  }, []);

  const ph = phaseAt(t);
  const cap = CAPTIONS[ph];
  const m = ph === 'normal' ? M.normal : ph === 'a' ? M.a : ph === 'ab' || ph === 'conflict' ? M.ab : M.after;
  const fade = Math.min(1, ((t % 100) - [0, 5, 11, 13.5, 17.5, 23][['normal', 'a', 'ab', 'conflict', 'after', 'compare'].indexOf(ph)]) / 0.6);
  return (
    <div className="fixed inset-0 overflow-hidden bg-black" dir="rtl" style={{ fontFamily: '"IBM Plex Sans Arabic", sans-serif' }}>
      <div ref={host} className="absolute inset-0" />
      <div className="absolute right-10 top-8 flex items-center gap-3 text-white">
        <span className="h-4 w-4 rounded-full bg-gradient-to-br from-cyan-300 to-violet-500 shadow-[0_0_18px_#8b7bff]" />
        <span className="text-[34px] font-bold">رصد</span>
        <span className="text-[22px] text-slate-300">| RASED</span>
      </div>
      <div className="absolute left-8 top-8 rounded-lg border border-amber-400/40 bg-black/50 px-3 py-1.5 text-[17px] font-semibold text-amber-300">DEMO DATA / SIMULATED</div>
      <div className="absolute left-8 top-[70px] max-w-[560px] rounded-lg bg-black/45 px-3 py-1.5 text-[15px] text-slate-200">{PROTOTYPE_LABEL_AR} · مبانٍ مؤقتة (بانتظار KitBash3D)</div>
      <div className="absolute bottom-14 left-1/2 w-[1100px] -translate-x-1/2 text-center" style={{ opacity: fade }}>
        <div className="inline-block rounded-2xl border border-violet-400/40 bg-[#07122ee6] px-10 py-5 shadow-2xl">
          <div className={`text-[44px] font-bold ${ph === 'conflict' ? 'text-red-300' : ph === 'after' ? 'text-emerald-300' : 'text-white'}`}>{cap.title}</div>
          <div className="mt-2 text-[27px] text-slate-200">{cap.body}</div>
        </div>
      </div>
      {ph !== 'compare' ? (
        <div className="absolute right-10 top-28 w-[360px] space-y-2 rounded-2xl border border-white/15 bg-[#07122ecc] p-5 text-white">
          <Row k="حفريات نشطة" v={`${m.activeExcavations}`} />
          <Row k="تعارضات" v={`${ph === 'conflict' ? 1 : 0}`} tone={ph === 'conflict' ? 'text-red-300' : undefined} />
          <Row k="مؤشر الازدحام" v={`${m.congestionIndex}%`} tone={m.maxVc > 1.3 ? 'text-red-300' : 'text-amber-200'} />
          <Row k="زمن رحلة المحور" v={`${fmtNum(m.corridorTripMin, 2)} د`} />
          <div className="pt-1 text-[13px] text-slate-400">تقديرات نموذجية — ليست قياسات حقيقية</div>
        </div>
      ) : (
        <div className="absolute right-10 top-28 w-[520px] rounded-2xl border border-violet-400/40 bg-[#07122ee6] p-6 text-white">
          <div className="mb-3 text-[26px] font-bold">قبل ← بعد توصية رصد</div>
          {(
            [
              ['التعارضات', 1, 0, 0],
              ['إغلاقات متزامنة', M.ab.activeClosures, M.after.activeClosures, 0],
              ['مؤشر الازدحام %', M.ab.congestionIndex, M.after.congestionIndex, 0],
              ['زمن رحلة المحور (د)', M.ab.corridorTripMin, M.after.corridorTripMin, 2],
            ] as const
          ).map(([k, b, a, d]) => (
            <div key={k} className="flex justify-between border-t border-white/10 py-2 text-[21px]">
              <span className="text-slate-300">{k}</span>
              <span dir="ltr">
                <span className="text-slate-400">{fmtNum(b, d)}</span> → <b className="text-emerald-300">{fmtNum(a, d)}</b>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex justify-between text-[21px]">
      <span className="text-slate-300">{k}</span>
      <b className={tone} dir="ltr">
        {v}
      </b>
    </div>
  );
}
