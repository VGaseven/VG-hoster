import React from 'react';
import { AbsoluteFill, Easing, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { z } from 'zod';
import type { LngLat } from '@/types';
import { CityScene, type Camera, type SceneClosure } from '../components/CityScene';
import { camAt, kmCam } from '../camera/camera';
import { getVideoData } from '../data';
import { vehiclePositions } from '@/engine/traffic/vehicles';
import { DISTRICT_CENTER, ZONES } from '@/data/network';
import { ORGANIZATIONS } from '@/data/organizations';
import { CATEGORY_LABELS, KIND_LABELS, SEVERITY_LABELS } from '@/engine/conflicts/detect';
import { fmtShort } from '@/utils/date';
import { fmtNum, fmtSar } from '@/utils/format';

export const PRESETS = {
  '1080p': { w: 1920, h: 1080, label: '1920×1080' },
  '4k': { w: 3840, h: 2160, label: '3840×2160' },
  vertical: { w: 1080, h: 1920, label: '1080×1920' },
  square: { w: 1080, h: 1080, label: '1080×1080' },
} as const;

export const videoSchema = z.object({
  preset: z.enum(['1080p', '4k', 'vertical', 'square']),
  durationSec: z.number().min(45).max(60),
  cameraStyle: z.enum(['cinematic', 'orbit', 'topdown']),
  captions: z.boolean(),
  metrics: z.boolean(),
});
export type VideoProps = z.infer<typeof videoSchema>;
export const DEFAULT_VIDEO_PROPS: VideoProps = { preset: '1080p', durationSec: 54, cameraStyle: 'cinematic', captions: true, metrics: true };
export const FPS = 30;

/** Scene base durations (seconds) — scaled to the requested total. */
/** PDF story: idea · project data · conflict · 3 alternatives · authority review · two plans · citizen · close */
const BASE = [5, 7, 7, 9, 6, 9, 7, 4];
export function sceneFrames(durationSec: number) {
  const total = BASE.reduce((a, b) => a + b, 0);
  const frames = BASE.map((s) => Math.round((s / total) * durationSec * FPS));
  const diff = Math.round(durationSec * FPS) - frames.reduce((a, b) => a + b, 0);
  frames[frames.length - 1] += diff;
  return frames;
}

const FONT = '"IBM Plex Sans Arabic", system-ui, sans-serif';
/** single-district scope: حي العليا */
const RIYADH: LngLat = DISTRICT_CENTER;

function useScale() {
  const { width, height } = useVideoConfig();
  return Math.min(width, height) / 1080;
}

function zoomFor(h: number, kmVisible: number) {
  return h / kmVisible;
}

const Caption: React.FC<{ text: string; show: boolean }> = ({ text, show }) => {
  const f = useCurrentFrame();
  const s = useScale();
  if (!show) return null;
  const o = interpolate(f, [0, 12], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', bottom: 60 * s, left: 0, right: 0, display: 'flex', justifyContent: 'center', opacity: o }}>
      <div dir="rtl" style={{ fontFamily: FONT, fontSize: 34 * s, fontWeight: 500, color: '#f1f5f9', background: 'rgba(6,14,40,0.78)', border: '1px solid rgba(139,123,255,0.3)', borderRadius: 16 * s, padding: `${12 * s}px ${28 * s}px`, maxWidth: '82%', textAlign: 'center', lineHeight: 1.5 }}>
        {text}
      </div>
    </div>
  );
};

const SimTag: React.FC = () => {
  const s = useScale();
  return (
    <div style={{ position: 'absolute', top: 28 * s, left: 28 * s, fontFamily: FONT, fontSize: 17 * s, fontWeight: 600, color: '#fcd34d', border: '1px solid rgba(251,191,36,0.35)', background: 'rgba(251,191,36,0.1)', borderRadius: 8 * s, padding: `${4 * s}px ${12 * s}px` }}>
      SIMULATION DATA · بيانات محاكاة
    </div>
  );
};

const Brand: React.FC = () => {
  const s = useScale();
  return (
    <div dir="rtl" style={{ position: 'absolute', top: 24 * s, right: 32 * s, fontFamily: FONT, color: '#e2e8f0', fontSize: 26 * s, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 * s }}>
      <span style={{ width: 14 * s, height: 14 * s, borderRadius: 99, background: 'linear-gradient(135deg,#22d3ee,#8b7bff)', boxShadow: '0 0 18px #8b7bff' }} />
      رصد <span style={{ color: '#64748b', fontWeight: 500 }}>| RASD</span>
    </div>
  );
};

const Panel: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; enterAt?: number }> = ({ children, style, enterAt = 0 }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = useScale();
  const p = spring({ frame: f - enterAt, fps, config: { damping: 18 } });
  return (
    <div dir="rtl" style={{ position: 'absolute', fontFamily: FONT, color: '#e2e8f0', background: 'rgba(8,17,46,0.88)', border: '1px solid rgba(139,123,255,0.28)', borderRadius: 20 * s, padding: 22 * s, boxShadow: '0 20px 60px rgba(0,0,0,0.5)', opacity: p, transform: `translateY(${(1 - p) * 30 * s}px)`, ...style }}>
      {children}
    </div>
  );
};

function vehiclesAt(set: ReturnType<typeof getVideoData>['vehA'], frame: number, fps: number) {
  return vehiclePositions(set, frame / fps + 30, 0.006);
}

const zoneLabels = ZONES.map((z) => ({ at: z.coord, text: z.name, tone: z.id === 'Z-KINGDOM' || z.id === 'Z-FAISALIAH' ? ('landmark' as const) : ('zone' as const) }));

// ───────────────────────────── Scenes ─────────────────────────────
const SceneIntro: React.FC<{ p: VideoProps; dur: number }> = ({ p, dur }) => {
  const f = useCurrentFrame();
  const { width: W, height: H, fps } = useVideoConfig();
  const s = useScale();
  const d = getVideoData();
  const cam = camAt([{ at: 0, cam: kmCam(RIYADH, zoomFor(H, 7), 30, -10) }, { at: 1, cam: kmCam(RIYADH, zoomFor(H, 5.5), 42, -25) }], f / dur, p.cameraStyle);
  const t = spring({ frame: f - 8, fps, config: { damping: 20 } });
  return (
    <AbsoluteFill>
      <CityScene width={W} height={H} camera={cam} vcBySeg={d.snapAfter.result.vcBySeg} vehicles={vehiclesAt(d.vehAfter, f, fps)} labels={zoneLabels} />
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse 40% 9% at 28% 22%, rgba(124,77,255,0.35), transparent 70%), radial-gradient(ellipse 30% 7% at 76% 78%, rgba(124,77,255,0.3), transparent 70%), radial-gradient(circle at 50% 45%, rgba(4,10,29,0.25), rgba(4,10,29,0.9))' }} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontFamily: FONT, textAlign: 'center', opacity: t, transform: `scale(${0.94 + 0.06 * t})` }}>
        <div dir="rtl" style={{ fontSize: 150 * s, fontWeight: 700, color: '#f8fafc', letterSpacing: -2, textShadow: '0 0 70px rgba(124,93,255,0.6)' }}>
          رَصد
        </div>
        <div dir="rtl" style={{ fontSize: 34 * s, fontWeight: 500, color: '#c4b5fd', marginTop: 8 * s }}>
          المسار: التنقل الذكي المدعوم بالبيانات
        </div>
        <div dir="rtl" style={{ fontSize: 26 * s, color: '#cbd5e1', marginTop: 22 * s, maxWidth: '80%', lineHeight: 1.6 }}>
          خدمة تجمع خطط الإغلاقات، تكشف تعارضها وتقارن بدائلها، وتُظهر الإغلاقات مسبقاً لمستخدمي الطريق.
        </div>
        <div dir="rtl" style={{ fontSize: 22 * s, color: '#94a3b8', marginTop: 14 * s }}>نطاق تجريبي: حي واحد — حي العليا، الرياض</div>
      </AbsoluteFill>
      <SimTag />
    </AbsoluteFill>
  );
};

const SceneProblem: React.FC<{ p: VideoProps; dur: number }> = ({ p, dur }) => {
  const f = useCurrentFrame();
  const { width: W, height: H, fps } = useVideoConfig();
  const s = useScale();
  const d = getVideoData();
  const A = d.before.find((x) => x.id === 'RASD-P01')!;
  const B = d.before.find((x) => x.id === 'RASD-D01')!;
  const target = d.conflict.location;
  const cam = camAt(
    [
      { at: 0, cam: kmCam(RIYADH, zoomFor(H, 5.5), 42, -25) },
      { at: 0.55, cam: kmCam(target, zoomFor(H, 2.6), 58, -30) },
      { at: 1, cam: kmCam(target, zoomFor(H, 2.1), 62, -42) },
    ],
    f / dur,
    p.cameraStyle,
  );
  const showA = f > dur * 0.3;
  const showB = f > dur * 0.55;
  const closures: SceneClosure[] = [];
  if (showA) closures.push(...A.closures.map((c) => ({ extent: c, color: '#f59e0b' })));
  if (showB) closures.push(...B.closures.map((c) => ({ extent: c, color: f > dur * 0.8 ? '#ef4444' : '#f59e0b' })));
  const snap = showB ? d.snapBefore : d.snapA;
  const veh = showB ? d.vehBefore : d.vehA;
  return (
    <AbsoluteFill>
      <CityScene width={W} height={H} camera={cam} vcBySeg={snap.result.vcBySeg} closures={closures} vehicles={vehiclesAt(veh, f, fps)} labels={zoneLabels} highlight={f > dur * 0.8 ? d.conflict.segmentIds : []} />
      {p.metrics && showA && (
        <Panel enterAt={Math.round(dur * 0.3)} style={{ top: 100 * s, right: 40 * s, width: 520 * s }}>
          <ProjectCard id="أ" title={A.title} org={ORGANIZATIONS[A.orgId].ar} color={ORGANIZATIONS[A.orgId].color} dates={`${fmtShort(A.schedule.start)} – ${fmtShort(A.schedule.end)}`} detail={`إغلاق جزئي: ${A.affectedLanes} مسار لكل اتجاه`} />
          {showB && (
            <div style={{ marginTop: 16 * s }}>
              <ProjectCard id="ب" title={B.title} org={ORGANIZATIONS[B.orgId].ar} color={ORGANIZATIONS[B.orgId].color} dates={`${fmtShort(B.schedule.start)} – ${fmtShort(B.schedule.end)}`} detail="إغلاق كلي للمسار البديل الموازي" />
            </div>
          )}
        </Panel>
      )}
      <Brand />
      <SimTag />
      <Caption show={p.captions} text={showB ? 'إدخال المشاريع: جهة ثانية تسجّل — بشكل مستقل — إغلاقاً كلياً لشارع العليا، وهو المسار البديل نفسه.' : 'إدخال المشاريع: مرفق المياه يسجّل الموقع والمدة ونطاق الإغلاق على طريق الملك فهد (مشروع افتراضي).'} />
    </AbsoluteFill>
  );
};

const ProjectCard: React.FC<{ id: string; title: string; org: string; color: string; dates: string; detail: string }> = ({ id, title, org, color, dates, detail }) => {
  const s = useScale();
  return (
    <div style={{ display: 'flex', gap: 14 * s }}>
      <div style={{ width: 40 * s, height: 40 * s, borderRadius: 12 * s, background: color + '33', border: `2px solid ${color}`, display: 'grid', placeItems: 'center', fontSize: 22 * s, fontWeight: 700 }}>{id}</div>
      <div>
        <div style={{ fontSize: 24 * s, fontWeight: 600, lineHeight: 1.35 }}>{title}</div>
        <div style={{ fontSize: 18 * s, color: '#94a3b8', marginTop: 4 * s }}>
          {org} · {dates}
        </div>
        <div style={{ fontSize: 18 * s, color: '#fcd34d', marginTop: 2 * s }}>{detail}</div>
      </div>
    </div>
  );
};

const SceneConflict: React.FC<{ p: VideoProps; dur: number }> = ({ p, dur }) => {
  const f = useCurrentFrame();
  const { width: W, height: H, fps } = useVideoConfig();
  const s = useScale();
  const d = getVideoData();
  const c = d.conflict;
  const cam = camAt([{ at: 0, cam: kmCam(c.location, zoomFor(H, 2.1), 62, -42) }, { at: 1, cam: kmCam(c.location, zoomFor(H, 1.7), 66, -75) }], f / dur, p.cameraStyle);
  const closures = d.before.filter((x) => c.projectIds.includes(x.id)).flatMap((x) => x.closures.map((e) => ({ extent: e, color: '#ef4444' })));
  const interaction = c.evidence.find((e) => e.unit === 'مركبة-ساعة');
  const detour = c.evidence.find((e) => e.rule === 'detour');
  const vertical = H > W;
  return (
    <AbsoluteFill>
      <CityScene width={W} height={H} camera={cam} vcBySeg={d.snapBefore.result.vcBySeg} closures={closures} highlight={c.segmentIds} vehicles={vehiclesAt(d.vehBefore, f, fps)} labels={zoneLabels} pulse={[{ at: c.location, t: f / fps / 1.4, color: '#ef4444' }]} />
      {p.metrics && (
        <Panel enterAt={6} style={vertical ? { left: 40 * s, right: 40 * s, top: 110 * s } : { top: 100 * s, right: 40 * s, width: 600 * s }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 * s }}>
            <span style={{ fontSize: 34 * s, fontWeight: 700, color: c.severity === 'high' ? '#f87171' : '#fbbf24' }}>⚠ {SEVERITY_LABELS[c.severity].ar}</span>
            <span style={{ marginRight: 'auto', fontSize: 24 * s, fontWeight: 700, background: 'rgba(0,0,0,0.35)', padding: `${2 * s}px ${12 * s}px`, borderRadius: 8 * s }}>{c.score}/100</span>
          </div>
          <div style={{ marginTop: 10 * s, fontSize: 20 * s, color: '#fca5a5' }}>
            {CATEGORY_LABELS[c.category]} · {KIND_LABELS[c.kind].ar}
          </div>
          <div style={{ marginTop: 12 * s, fontSize: 21 * s, lineHeight: 1.6, color: '#e2e8f0' }}>{c.explanationAr}</div>
          {c.overlap && (
            <div style={{ marginTop: 10 * s, fontSize: 19 * s, color: '#94a3b8' }}>
              الفترة المتداخلة: {fmtShort(c.overlap.start)} – {fmtShort(c.overlap.end)} ({c.overlap.days} يوم)
            </div>
          )}
          {detour && <div style={{ marginTop: 12 * s, fontSize: 18 * s, lineHeight: 1.6, color: '#cbd5e1', background: 'rgba(56,189,248,0.08)', borderRadius: 10 * s, padding: 10 * s }}>{detour.textAr}</div>}
          {interaction && <div style={{ marginTop: 10 * s, fontSize: 18 * s, lineHeight: 1.6, color: '#fecaca', background: 'rgba(239,68,68,0.1)', borderRadius: 10 * s, padding: 10 * s }}>{interaction.textAr}</div>}
        </Panel>
      )}
      <Brand />
      <SimTag />
      <Caption show={p.captions} text="تحليل التعارض: قراءة المشاريع معاً بدل التعامل مع كل إغلاق منفرداً — بالأدلة." />
    </AbsoluteFill>
  );
};

const SceneOptimize: React.FC<{ p: VideoProps; dur: number }> = ({ p, dur }) => {
  const f = useCurrentFrame();
  const { width: W, height: H, fps } = useVideoConfig();
  const s = useScale();
  const d = getVideoData();
  const c = d.conflict;
  const cam = camAt([{ at: 0, cam: kmCam(c.location, zoomFor(H, 1.7), 66, -75) }, { at: 1, cam: kmCam(c.location, zoomFor(H, 3.2), 50, -60) }], f / dur, p.cameraStyle);
  const applied = false;
  const proj = applied ? d.after : d.before;
  const closures = proj
    .filter((x) => c.projectIds.includes(x.id))
    .filter((x) => d.focusDay >= dayOf(x.schedule.start) && d.focusDay <= dayOf(x.schedule.end))
    .flatMap((x) => x.closures.map((e) => ({ extent: e, color: applied ? '#10b981' : '#ef4444' })));
  const vertical = H > W;
  const cardW = vertical ? (W - 120 * s) / 1 : 430 * s;
  const chosen = d.chosen;
  return (
    <AbsoluteFill>
      <CityScene width={W} height={H} camera={cam} vcBySeg={(applied ? d.snapAfter : d.snapBefore).result.vcBySeg} closures={closures} vehicles={vehiclesAt(applied ? d.vehAfter : d.vehBefore, f, fps)} labels={zoneLabels} buildingOpacity={0.75} />
      <AbsoluteFill style={{ background: 'linear-gradient(0deg, rgba(5,10,20,0.85) 0%, rgba(5,10,20,0.2) 55%)' }} />
      <div dir="rtl" style={{ position: 'absolute', top: 90 * s, right: 40 * s, fontFamily: FONT, fontSize: 40 * s, fontWeight: 700, color: '#f8fafc' }}>
        مقارنة البدائل قبل الاعتماد
      </div>
      <div dir="rtl" style={{ position: 'absolute', left: 40 * s, right: 40 * s, bottom: (p.captions ? 150 : 50) * s, display: 'flex', flexDirection: vertical ? 'column' : 'row', gap: 18 * s, justifyContent: 'center' }}>
        {d.options.map((o, i) => {
          const rec = o.recommended && f > dur * 0.45;
          const tech = o.requiresTechnicalConfirmation && o.feasible;
          return (
            <Panel key={o.id} enterAt={8 + i * 8} style={{ position: 'relative', width: cardW, padding: 20 * s, border: rec ? '2px solid #8b7bff' : '1px solid rgba(139,123,255,0.22)', boxShadow: rec ? '0 0 50px rgba(124,93,255,0.45)' : undefined }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 26 * s, fontWeight: 700 }}>{o.titleAr}</span>
                <span style={{ fontSize: 17 * s, padding: `${2 * s}px ${10 * s}px`, borderRadius: 8 * s, background: o.feasible ? 'rgba(52,211,153,0.15)' : 'rgba(244,63,94,0.15)', color: o.feasible ? '#6ee7b7' : '#fda4af' }}>{o.feasible ? 'ممكن' : 'غير ممكن'}</span>
              </div>
              {o.feasible && o.metrics ? (
                <div style={{ marginTop: 12 * s, fontSize: 19 * s, color: '#cbd5e1', lineHeight: 1.7 }}>
                  <div>
                    الدرجة: <b style={{ color: '#fff' }}>{fmtNum(o.score, 1)}</b>
                  </div>
                  <div>التعارضات: {o.metrics.conflicts} · مرات الإغلاق: {o.metrics.closureEpisodes}</div>
                  <div>كم-يوم مغلق: {fmtNum(o.metrics.closureKmDays, 1)}</div>
                  {o.changes[0] && (
                    <div style={{ color: '#a5f3fc' }}>
                      {o.changes[0].projectId}: {fmtShort(o.changes[0].to.start)} – {fmtShort(o.changes[0].to.end)}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ marginTop: 12 * s, fontSize: 17 * s, color: '#94a3b8', lineHeight: 1.6 }}>{(o.infeasibleReasonAr ?? '').slice(0, 120)}…</div>
              )}
              {rec && <div style={{ position: 'absolute', top: -16 * s, right: 20 * s, background: '#6c5dd3', color: '#fff', fontWeight: 700, fontSize: 17 * s, borderRadius: 99, padding: `${3 * s}px ${12 * s}px` }}>الخيار الموصى به</div>}
              {tech && <div style={{ position: 'absolute', top: -16 * s, right: 20 * s, background: '#0b1638', border: '1px solid #fbbf24', color: '#fde68a', fontSize: 15 * s, borderRadius: 99, padding: `${3 * s}px ${12 * s}px` }}>يتطلب تأكيداً فنياً</div>}
            </Panel>
          );
        })}
      </div>
      {applied && chosen && (
        <Panel enterAt={Math.round(dur * 0.62)} style={{ top: 160 * s, right: 40 * s, width: 560 * s, border: '1px solid rgba(52,211,153,0.5)' }}>
          <div style={{ fontSize: 24 * s, fontWeight: 700, color: '#6ee7b7' }}>✓ اعتماد: {chosen.titleAr}</div>
          {chosen.changes.map((ch) => (
            <div key={ch.projectId} style={{ fontSize: 19 * s, marginTop: 8 * s, color: '#cbd5e1' }}>
              {ch.projectId}: <s style={{ color: '#64748b' }}>{fmtShort(ch.from.start)}–{fmtShort(ch.from.end)}</s> ← <b style={{ color: '#a7f3d0' }}>{fmtShort(ch.to.start)}–{fmtShort(ch.to.end)}</b>
            </div>
          ))}
        </Panel>
      )}
      <Brand />
      <SimTag />
      <Caption show={p.captions} text="تقديم الموعد حسب المرونة · تأخير الموعد حسب الأولوية · نافذة مشتركة إذا أمكن فنياً — مرتّبة مع شرح المفاضلة." />
    </AbsoluteFill>
  );
};

function dayOf(iso: string) {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse('2026-12-01T00:00:00Z')) / 864e5);
}


const SceneReview: React.FC<{ p: VideoProps; dur: number }> = ({ p, dur }) => {
  const f = useCurrentFrame();
  const { width: W, height: H, fps } = useVideoConfig();
  const s = useScale();
  const d = getVideoData();
  const c = d.conflict;
  const cam = camAt([{ at: 0, cam: kmCam(c.location, zoomFor(H, 3.2), 50, -60) }, { at: 1, cam: kmCam(c.location, zoomFor(H, 2.6), 58, -35) }], f / dur, p.cameraStyle);
  const stamped = f > dur * 0.45;
  const proj = stamped ? d.after : d.before;
  const closures = proj
    .filter((x) => c.projectIds.includes(x.id) && d.focusDay >= dayOf(x.schedule.start) && d.focusDay <= dayOf(x.schedule.end))
    .flatMap((x) => x.closures.map((e) => ({ extent: e, color: stamped ? '#8b7bff' : '#ef4444' })));
  const chosen = d.chosen;
  const st = spring({ frame: f - Math.round(dur * 0.45), fps, config: { damping: 12 } });
  return (
    <AbsoluteFill>
      <CityScene width={W} height={H} camera={cam} vcBySeg={(stamped ? d.snapAfter : d.snapBefore).result.vcBySeg} closures={closures} vehicles={vehiclesAt(stamped ? d.vehAfter : d.vehBefore, f, fps)} labels={zoneLabels} buildingOpacity={0.8} />
      <Panel enterAt={4} style={{ top: 110 * s, right: 40 * s, width: Math.min(W - 80 * s, 640 * s) }}>
        <div style={{ fontSize: 18 * s, color: '#c4b5fd', fontWeight: 600 }}>مراجعة الجهة المختصة</div>
        <div style={{ fontSize: 30 * s, fontWeight: 700, marginTop: 4 * s }}>قبول أو رفض أو تعديل</div>
        {chosen && (
          <>
            <div style={{ fontSize: 21 * s, marginTop: 12 * s, color: '#e2e8f0' }}>البديل المقترح: «{chosen.titleAr}»</div>
            {chosen.changes.map((ch) => (
              <div key={ch.projectId} style={{ fontSize: 19 * s, marginTop: 8 * s, color: '#cbd5e1' }}>
                {ch.projectId}: <s style={{ color: '#64748b' }}>{fmtShort(ch.from.start)}–{fmtShort(ch.from.end)}</s> ← <b style={{ color: '#ddd6fe' }}>{fmtShort(ch.to.start)}–{fmtShort(ch.to.end)}</b>
              </div>
            ))}
            <div style={{ fontSize: 17 * s, marginTop: 10 * s, color: '#94a3b8', lineHeight: 1.6 }}>{chosen.tradeoffsAr[0]}</div>
          </>
        )}
        <div style={{ marginTop: 18 * s, display: 'inline-block', transform: `scale(${0.6 + 0.4 * st}) rotate(-4deg)`, opacity: st, border: '3px solid #a78bfa', color: '#ddd6fe', borderRadius: 12 * s, padding: `${6 * s}px ${18 * s}px`, fontSize: 26 * s, fontWeight: 700 }}>
          ✓ اعتُمد — قرار موثّق بأسبابه
        </div>
      </Panel>
      <Brand />
      <SimTag />
      <Caption show={p.captions} text="لمكاتب التنسيق: بدائل مرتّبة وقرار موثّق بأسبابه — ثم تصبح الإغلاقات المعتمدة معلنة لمستخدمي الطريق." />
    </AbsoluteFill>
  );
};

const SceneBeforeAfter: React.FC<{ p: VideoProps; dur: number }> = ({ p, dur }) => {
  const f = useCurrentFrame();
  const { width: W, height: H, fps } = useVideoConfig();
  const s = useScale();
  const d = getVideoData();
  const vertical = H > W;
  const half = vertical ? { w: W, h: H / 2 } : { w: W / 2, h: H };
  const c = d.conflict;
  const cam: Camera = camAt([{ at: 0, cam: kmCam(c.location, zoomFor(half.h, 3.0), 55, -40) }, { at: 1, cam: kmCam(c.location, zoomFor(half.h, 2.4), 60, -80) }], f / dur, p.cameraStyle);
  const closuresOf = (ps: typeof d.before, color: (id: string) => string) =>
    ps.filter((x) => x.status !== 'rejected' && d.focusDay >= dayOf(x.schedule.start) && d.focusDay <= dayOf(x.schedule.end)).flatMap((x) => x.closures.map((e) => ({ extent: e, color: color(x.id) })));
  const before = closuresOf(d.before, (id) => (c.projectIds.includes(id) ? '#ef4444' : '#f59e0b'));
  const after = closuresOf(d.after, () => '#10b981');
  const k = interpolate(f, [dur * 0.25, dur * 0.7], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const rows: [string, number, number, (n: number) => string, boolean][] = [
    ['التعارضات', d.mBefore.conflicts, d.mAfter.conflicts, (n) => fmtNum(n), true],
    ['مرات إغلاق المقاطع', d.mBefore.closureEpisodes, d.mAfter.closureEpisodes, (n) => fmtNum(n), true],
    ['كم-يوم مغلق', d.mBefore.closureKmDays, d.mAfter.closureKmDays, (n) => fmtNum(n, 1), true],
    ['إغلاقات معلنة مسبقاً', d.mBefore.visibleClosureShare, d.mAfter.visibleClosureShare, (n) => `${fmtNum(n)}%`, false],
  ];
  const label = (t: string, color: string, style: React.CSSProperties) => (
    <div dir="rtl" style={{ position: 'absolute', fontFamily: FONT, fontSize: 30 * s, fontWeight: 700, color, background: 'rgba(5,10,20,0.75)', borderRadius: 12 * s, padding: `${6 * s}px ${16 * s}px`, ...style }}>
      {t}
    </div>
  );
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 0, top: 0, width: half.w, height: half.h, overflow: 'hidden' }}>
        <CityScene width={half.w} height={half.h} camera={cam} vcBySeg={d.snapBefore.result.vcBySeg} closures={before} vehicles={vehiclesAt(d.vehBefore, f, fps)} labels={[]} />
        {label('الخطة الأصلية', '#fcd34d', { top: 24 * s, right: 24 * s })}
      </div>
      <div style={{ position: 'absolute', left: vertical ? 0 : half.w, top: vertical ? half.h : 0, width: half.w, height: half.h, overflow: 'hidden', borderLeft: vertical ? undefined : '2px solid #22d3ee', borderTop: vertical ? '2px solid #22d3ee' : undefined }}>
        <CityScene width={half.w} height={half.h} camera={cam} vcBySeg={d.snapAfter.result.vcBySeg} closures={after} vehicles={vehiclesAt(d.vehAfter, f, fps)} labels={[]} />
        {label('الخطة المنسقة المعتمدة', '#c4b5fd', { top: 24 * s, right: 24 * s })}
      </div>
      {p.metrics && (
        <Panel enterAt={Math.round(dur * 0.2)} style={{ left: '50%', transform: 'translateX(-50%)', bottom: (p.captions ? 150 : 40) * s, width: vertical ? W - 80 * s : 1100 * s, display: 'grid', gridTemplateColumns: vertical ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 18 * s }}>
          {rows.map(([name, b, a, fmt, lower]) => {
            const cur = b + (a - b) * k;
            const pct = b ? ((a - b) / b) * 100 : 0;
            const good = lower ? a < b : a > b;
            void fmtSar;
            return (
              <div key={name} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 17 * s, color: '#94a3b8' }}>{name}</div>
                <div style={{ fontSize: 34 * s, fontWeight: 700, direction: 'ltr' }}>{fmt(cur)}</div>
                <div style={{ fontSize: 18 * s, color: good ? '#34d399' : a === b ? '#94a3b8' : '#f87171', direction: 'ltr' }}>{b ? `${pct > 0 ? '+' : ''}${fmtNum(pct * k, 1)}%` : '—'}</div>
              </div>
            );
          })}
        </Panel>
      )}
      <SimTag />
      <Caption show={p.captions} text="نقارن خطتين للمشاريع نفسها: تكرار الإغلاق ومدته ونطاقه، والتعارضات، ونسبة الإغلاقات المعلنة — محسوبة لا مفترضة." />
    </AbsoluteFill>
  );
};

const SceneCitizen: React.FC<{ p: VideoProps; dur: number }> = ({ p, dur }) => {
  const f = useCurrentFrame();
  const { width: W, height: H, fps } = useVideoConfig();
  const s = useScale();
  const d = getVideoData();
  const j = d.journey;
  const mid = j.now?.coords[Math.floor((j.now?.coords.length ?? 1) / 2)] ?? d.conflict.location;
  const cam = camAt([{ at: 0, cam: kmCam(mid, zoomFor(H, 5), 35, -25) }, { at: 1, cam: kmCam(mid, zoomFor(H, 4.2), 45, -35) }], f / dur, p.cameraStyle);
  const draw = interpolate(f, [10, dur * 0.6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const partial = (c: LngLat[]) => c.slice(0, Math.max(2, Math.ceil(c.length * draw)));
  const routes = [
    ...(j.normal ? [{ coords: j.normal.coords, color: '#94a3b8', width: 10, dash: '14,10' }] : []),
    ...(j.now ? [{ coords: partial(j.now.coords), color: '#22d3ee', width: 16 }] : []),
  ];
  const closures = j.affecting.flatMap((x) => x.closures.map((e) => ({ extent: e, color: '#ef4444', width: 18 })));
  const vertical = H > W;
  return (
    <AbsoluteFill>
      <CityScene width={W} height={H} camera={cam} vcBySeg={d.snapAfter.result.vcBySeg} closures={closures} routes={routes} vehicles={vehiclesAt(d.vehAfter, f, fps)} labels={zoneLabels} trafficColors={false} buildingOpacity={0.8} />
      <Panel enterAt={6} style={vertical ? { left: 40 * s, right: 40 * s, bottom: 200 * s } : { top: 110 * s, right: 60 * s, width: 520 * s, borderRadius: 36 * s, padding: 28 * s }}>
        <div style={{ fontSize: 18 * s, color: '#67e8f9', fontWeight: 600 }}>تجربة المواطن</div>
        <div style={{ fontSize: 34 * s, fontWeight: 700, marginTop: 6 * s, lineHeight: 1.35 }}>خطّط لرحلة الغد قبل مفاجأة الإغلاق</div>
        <div style={{ fontSize: 20 * s, color: '#94a3b8', marginTop: 8 * s }}>{d.journeyTitle} · 16 ديسمبر 08:00</div>
        {j.affecting[0] && (
          <div style={{ marginTop: 16 * s, padding: 14 * s, borderRadius: 14 * s, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)', fontSize: 19 * s, lineHeight: 1.6 }}>
            ⚠ إغلاق معتمد على مسارك: {j.affecting[0].title}
            <div style={{ color: '#fcd34d' }}>
              {fmtShort(j.affecting[0].schedule.start)} – {fmtShort(j.affecting[0].schedule.end)} · {ORGANIZATIONS[j.affecting[0].orgId].ar}
            </div>
          </div>
        )}
        {j.normal && j.now && (
          <div style={{ display: 'flex', gap: 12 * s, marginTop: 14 * s }}>
            <div style={{ flex: 1, padding: 12 * s, borderRadius: 12 * s, background: 'rgba(148,163,184,0.08)' }}>
              <div style={{ fontSize: 16 * s, color: '#94a3b8' }}>المسار المعتاد</div>
              <div style={{ fontSize: 28 * s, fontWeight: 700 }}>{fmtNum(j.normal.timeMin)} د</div>
              <div style={{ fontSize: 16 * s, color: '#94a3b8' }}>{fmtNum(j.normal.km, 1)} كم</div>
            </div>
            <div style={{ flex: 1, padding: 12 * s, borderRadius: 12 * s, background: 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.4)' }}>
              <div style={{ fontSize: 16 * s, color: '#67e8f9' }}>المسار الموصى به</div>
              <div style={{ fontSize: 28 * s, fontWeight: 700 }}>{fmtNum(j.now.timeMin)} د</div>
              <div style={{ fontSize: 16 * s, color: '#94a3b8' }}>{fmtNum(j.now.km, 1)} كم</div>
            </div>
          </div>
        )}
        <div style={{ fontSize: 14 * s, color: '#64748b', marginTop: 10 * s }}>أوقات تقديرية من نموذج محاكاة — ليست بيانات مرور حية</div>
      </Panel>
      <Brand />
      <SimTag />
      <Caption show={p.captions} text="قبل: الوصول صباحاً إلى طريق مغلق. بعد: معرفة الإغلاق وبدائله من اليوم السابق." />
    </AbsoluteFill>
  );
};

const SceneClosing: React.FC<{ p: VideoProps; dur: number }> = ({ p, dur }) => {
  const f = useCurrentFrame();
  const { width: W, height: H, fps } = useVideoConfig();
  const s = useScale();
  const d = getVideoData();
  const cam = camAt([{ at: 0, cam: kmCam(RIYADH, zoomFor(H, 4.5), 50, -40) }, { at: 1, cam: kmCam(RIYADH, zoomFor(H, 6.5), 38, -15) }], f / dur, p.cameraStyle);
  const t = spring({ frame: f - 5, fps, config: { damping: 20 } });
  return (
    <AbsoluteFill>
      <CityScene width={W} height={H} camera={cam} vcBySeg={d.snapAfter.result.vcBySeg} vehicles={vehiclesAt(d.vehAfter, f, fps)} labels={zoneLabels} />
      <AbsoluteFill style={{ background: 'radial-gradient(circle at 50% 50%, rgba(5,10,20,0.2), rgba(5,10,20,0.9))' }} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontFamily: FONT, opacity: t }}>
        <div dir="rtl" style={{ fontSize: 64 * s, fontWeight: 700, color: '#f8fafc', textAlign: 'center', lineHeight: 1.4, padding: `0 ${60 * s}px` }}>
          رَصد — تنسيقٌ مبكر يحمي حركة المدينة
        </div>
        <div dir="rtl" style={{ fontSize: 30 * s, color: '#c4b5fd', marginTop: 18 * s }}>
          إغلاقات أقل تكراراً · أثر أخف على الحركة · استعداد أفضل لمستخدم الطريق
        </div>
        <div dir="rtl" style={{ fontSize: 22 * s, color: '#94a3b8', marginTop: 18 * s }}>
          نموذج أولي · مشاريع افتراضية وبيانات محاكاة · نقل ثون ٥
        </div>
      </AbsoluteFill>
      <SimTag />
    </AbsoluteFill>
  );
};

export const RasdVideo: React.FC<VideoProps> = (props) => {
  const frames = sceneFrames(props.durationSec);
  const scenes = [SceneIntro, SceneProblem, SceneConflict, SceneOptimize, SceneReview, SceneBeforeAfter, SceneCitizen, SceneClosing];
  let from = 0;
  return (
    <AbsoluteFill style={{ background: '#050a14' }}>
      {scenes.map((S, i) => {
        const el = (
          <Sequence key={i} from={from} durationInFrames={frames[i]} name={`scene-${i + 1}`}>
            <SceneFade dur={frames[i]}>
              <S p={props} dur={frames[i]} />
            </SceneFade>
          </Sequence>
        );
        from += frames[i];
        return el;
      })}
    </AbsoluteFill>
  );
};

const SceneFade: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 8, dur - 8, dur], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
};
