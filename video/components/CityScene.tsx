/**
 * Deterministic 2.5D city renderer (Canvas 2D + SVG labels, no WebGL) — renders identically frame by
 * frame in Remotion. Uses the same network, buildings, engine snapshots and vehicle model
 * as the live application.
 */
import React, { useLayoutEffect, useRef } from 'react';
import type { LngLat } from '@/types';
import { SEGMENTS } from '@/data/network';
import { lngLatToKm } from '@/data/network';
import { generateBuildings } from '@/data/buildings';
import { closureLine } from '@/engine/spatial/geometry';
import type { ClosureExtent } from '@/types';

export interface Camera {
  /** centre in local km (east, north) relative to Kingdom Centre */
  cx: number;
  cy: number;
  /** pixels per km at the focal plane */
  zoom: number;
  bearing: number; // deg
  pitch: number; // deg
}

export interface SceneClosure {
  extent: ClosureExtent;
  color: string;
  width?: number;
  glow?: boolean;
}

export interface SceneLabel {
  at: LngLat;
  text: string;
  tone?: 'zone' | 'landmark' | 'alert';
}

export interface SceneRoute {
  coords: LngLat[];
  color: string;
  width?: number;
  dash?: string;
}

export interface CitySceneProps {
  width: number;
  height: number;
  camera: Camera;
  vcBySeg?: Map<string, number>;
  closures?: SceneClosure[];
  highlight?: string[];
  vehicles?: [number, number, number][];
  routes?: SceneRoute[];
  labels?: SceneLabel[];
  pulse?: { at: LngLat; t: number; color: string }[];
  buildingOpacity?: number;
  trafficColors?: boolean;
}

const BUILDINGS = generateBuildings(0.11, 11).map((b) => ({
  ...b,
  km: b.ring.slice(0, 4).map((p) => lngLatToKm(p)),
}));

const SEG_KM = SEGMENTS.map((s) => ({ s, pts: s.coords.map((c) => lngLatToKm(c)) }));

function vcColor(vc: number) {
  if (!Number.isFinite(vc) || vc > 1.5) return '#7f1d1d';
  const stops: [number, [number, number, number]][] = [
    [0, [16, 185, 129]],
    [0.6, [132, 204, 22]],
    [0.85, [245, 158, 11]],
    [1.05, [239, 68, 68]],
    [1.4, [153, 27, 27]],
  ];
  for (let i = 1; i < stops.length; i++)
    if (vc <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      const f = (vc - a) / (b - a);
      const c = ca.map((x, k) => Math.round(x + (cb[k] - x) * f));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  return '#991b1b';
}

export function makeProjector(cam: Camera, W: number, H: number) {
  const b = (cam.bearing * Math.PI) / 180;
  const p = (Math.max(0, Math.min(80, cam.pitch)) * Math.PI) / 180;
  const cosb = Math.cos(b);
  const sinb = Math.sin(b);
  const sinp = Math.sin(p);
  const cosp = Math.cos(p);
  const D = (H / cam.zoom) * 1.6; // camera distance in km
  const F = cam.zoom * D;
  return (x: number, y: number, z = 0): [number, number, number] | null => {
    const dx = x - cam.cx;
    const dy = y - cam.cy;
    const X = dx * cosb - dy * sinb;
    const Y = dx * sinb + dy * cosb;
    const depth = D + Y * sinp - z * cosp;
    if (depth < D * 0.08) return null;
    const up = Y * cosp + z * sinp;
    return [W / 2 + (F * X) / depth, H / 2 - (F * up) / depth, depth];
  };
}

export const CityScene: React.FC<CitySceneProps> = ({ width: W, height: H, camera, vcBySeg, closures = [], highlight = [], vehicles = [], routes = [], labels = [], pulse = [], buildingOpacity = 1, trafficColors = true }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const proj = makeProjector(camera, W, H);
  const scale = camera.zoom / 400; // stroke widths scale with zoom

  useLayoutEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const sky = ctx.createRadialGradient(W / 2, H * 0.2, 0, W / 2, H * 0.2, Math.max(W, H) * 0.9);
    sky.addColorStop(0, '#0c1f4d');
    sky.addColorStop(0.55, '#061230');
    sky.addColorStop(1, '#040a1d');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const line = (pts: { x: number; y: number }[], z = 0) => {
      ctx.beginPath();
      let pen = false;
      for (const p of pts) {
        const s = proj(p.x, p.y, z);
        if (!s) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(s[0], s[1]);
        else ctx.moveTo(s[0], s[1]);
        pen = true;
      }
    };
    const stroke = (color: string, width: number, alpha = 1, dash: number[] = []) => {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(0.5, width);
      ctx.setLineDash(dash);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
    };
    // ground grid
    ctx.beginPath();
    for (let gx = -5; gx <= 5; gx += 0.5) {
      const a = proj(gx, -6);
      const b = proj(gx, 6);
      if (a && b) (ctx.moveTo(a[0], a[1]), ctx.lineTo(b[0], b[1]));
    }
    for (let gy = -6; gy <= 6; gy += 0.5) {
      const a = proj(-5, gy);
      const b = proj(5, gy);
      if (a && b) (ctx.moveTo(a[0], a[1]), ctx.lineTo(b[0], b[1]));
    }
    stroke('#1b2b5c', 0.6, 0.55);
    for (const { s, pts } of SEG_KM) {
      line(pts);
      stroke('#0b1838', (s.roadClass === 'motorway' ? 34 : s.roadClass === 'connector' ? 4 : 20) * scale);
    }
    for (const { s, pts } of SEG_KM)
      if (highlight.includes(s.id)) {
        line(pts);
        stroke('#ef4444', 60 * scale, 0.35);
      }
    for (const { s, pts } of SEG_KM) {
      const vc = vcBySeg?.get(s.id) ?? 0.3;
      const closed = !Number.isFinite(vc);
      line(pts);
      stroke(trafficColors ? vcColor(vc) : '#22d3ee', (s.roadClass === 'motorway' ? 9 : s.roadClass === 'connector' ? 1.5 : 6) * scale, closed ? 0.25 : s.roadClass === 'connector' ? 0.3 : 0.9);
    }
    for (const r of routes) {
      line(r.coords.map((c) => lngLatToKm(c)));
      stroke(r.color, (r.width ?? 12) * scale, 1, r.dash ? r.dash.split(',').map((x) => Number(x) * scale) : []);
    }
    for (const c of closures) {
      const pts = closureLine(c.extent).geometry.coordinates.map((p) => lngLatToKm(p as LngLat));
      if (c.glow !== false) {
        line(pts);
        stroke(c.color, (c.width ?? 14) * 3 * scale, 0.3);
      }
      line(pts);
      ctx.lineCap = 'butt';
      stroke(c.color, (c.width ?? 14) * scale, 1, [18 * scale, 8 * scale]);
      ctx.lineCap = 'round';
    }
    for (const v of vehicles) {
      const k = lngLatToKm([v[0], v[1]]);
      const s = proj(k.x, k.y, 0.002);
      if (!s || s[0] < -10 || s[0] > W + 10 || s[1] < -10 || s[1] > H + 10) continue;
      const D = (H / camera.zoom) * 1.6;
      const r = Math.min(6, Math.max(1.2, 3.2 * scale * (D / s[2])));
      ctx.fillStyle = v[2] < 0.25 ? '#ef4444' : v[2] < 0.55 ? '#f59e0b' : '#e2e8f0';
      ctx.beginPath();
      ctx.arc(s[0], s[1], r, 0, Math.PI * 2);
      ctx.fill();
    }
    // buildings — painter's algorithm (far → near), walls then roof
    const margin = Math.max(W, H) * 0.25;
    const items: { depth: number; bp: [number, number, number][]; tp: [number, number, number][]; h: number }[] = [];
    for (const bd of BUILDINGS) {
      const c0 = proj(bd.km[0].x, bd.km[0].y, 0);
      if (!c0 || c0[0] < -margin || c0[0] > W + margin || c0[1] < -margin * 2 || c0[1] > H + margin) continue;
      const base = bd.base * 0.001;
      const top = bd.height * 0.001;
      const bp = bd.km.map((k) => proj(k.x, k.y, base));
      const tp = bd.km.map((k) => proj(k.x, k.y, top));
      if (bp.some((x) => !x) || tp.some((x) => !x)) continue;
      const b4 = bp as [number, number, number][];
      // level of detail: skip buildings smaller than ~2 px on screen
      if (Math.abs(b4[0][0] - b4[2][0]) + Math.abs(b4[0][1] - b4[2][1]) < 2.5 && bd.height < 60) continue;
      items.push({ depth: (b4[0][2] + b4[1][2] + b4[2][2] + b4[3][2]) / 4, bp: b4, tp: tp as [number, number, number][], h: bd.height });
    }
    items.sort((a, b) => b.depth - a.depth);
    ctx.globalAlpha = buildingOpacity;
    ctx.lineWidth = 0.5;
    for (const it of items) {
      const tall = it.h > 120;
      const roof = tall ? '#5b5fc7' : it.h > 40 ? '#33478a' : '#22346a';
      const wallA = tall ? '#3a3f8f' : it.h > 40 ? '#22336b' : '#192a58';
      const wallB = tall ? '#2e3378' : it.h > 40 ? '#1b2a5a' : '#13214a';
      const walls = [0, 1, 2, 3].map((i) => ({ i, j: (i + 1) % 4, d: (it.bp[i][2] + it.bp[(i + 1) % 4][2]) / 2 })).sort((a, b) => b.d - a.d);
      ctx.strokeStyle = '#08112b';
      for (const { i, j } of walls) {
        ctx.beginPath();
        ctx.moveTo(it.bp[i][0], it.bp[i][1]);
        ctx.lineTo(it.bp[j][0], it.bp[j][1]);
        ctx.lineTo(it.tp[j][0], it.tp[j][1]);
        ctx.lineTo(it.tp[i][0], it.tp[i][1]);
        ctx.closePath();
        ctx.fillStyle = i % 2 ? wallA : wallB;
        ctx.fill();
        ctx.stroke();
      }
      ctx.beginPath();
      it.tp.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.fillStyle = roof;
      ctx.fill();
      if (tall) {
        ctx.strokeStyle = 'rgba(125,211,252,0.35)';
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  });

  return (
    <>
      <canvas ref={ref} width={W} height={H} style={{ position: 'absolute', inset: 0, width: W, height: H, display: 'block' }} />
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0, display: 'block' }}>
        {pulse.map((p, i) => {
          const k = lngLatToKm(p.at);
          const s = proj(k.x, k.y, 0.03);
          if (!s) return null;
          const ph = ((p.t % 1) + 1) % 1;
          return (
            <g key={`p${i}`}>
              <circle cx={s[0]} cy={s[1]} r={14 + ph * 46} fill="none" stroke={p.color} strokeWidth={3} opacity={1 - ph} />
              <circle cx={s[0]} cy={s[1]} r={13} fill={p.color} />
              <text x={s[0]} y={s[1] + 6} textAnchor="middle" fontSize={17} fontWeight={700} fill="#fff">
                !
              </text>
            </g>
          );
        })}
        {labels.map((l, i) => {
          const k = lngLatToKm(l.at);
          const s = proj(k.x, k.y, l.tone === 'landmark' ? 0.32 : 0.02);
          if (!s || s[0] < 0 || s[0] > W || s[1] < 0 || s[1] > H) return null;
          return (
            <text key={`l${i}`} x={s[0]} y={s[1]} textAnchor="middle" direction="rtl" fontFamily="IBM Plex Sans Arabic" fontSize={(l.tone === 'landmark' ? 22 : 18) * Math.max(0.6, Math.min(W, H) / 1080)} fontWeight={600} fill={l.tone === 'landmark' ? '#a5f3fc' : l.tone === 'alert' ? '#fecaca' : '#cbd5e1'} stroke="#020617" strokeWidth={4} paintOrder="stroke">
              {l.text}
            </text>
          );
        })}
      </svg>
    </>
  );
};
