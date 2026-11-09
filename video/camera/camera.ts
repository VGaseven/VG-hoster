import { Easing, interpolate } from 'remotion';
import type { Camera } from '../components/CityScene';
import type { LngLat } from '@/types';
import { lngLatToKm } from '@/data/network';

export type CameraStyle = 'cinematic' | 'orbit' | 'topdown';

export interface Key {
  at: number; // 0..1 of scene
  cam: Partial<Camera> & { target?: LngLat };
}

export function kmCam(target: LngLat, zoom: number, pitch: number, bearing: number): Camera {
  const k = lngLatToKm(target);
  return { cx: k.x, cy: k.y, zoom, pitch, bearing };
}

/** Deterministic keyframe interpolation (eased) — a pure function of progress. */
export function camAt(keys: { at: number; cam: Camera }[], progress: number, style: CameraStyle): Camera {
  let a = keys[0];
  let b = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++)
    if (progress >= keys[i].at && progress <= keys[i + 1].at) {
      a = keys[i];
      b = keys[i + 1];
      break;
    }
  const span = b.at - a.at || 1;
  const t = interpolate((progress - a.at) / span, [0, 1], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
  const lerp = (x: number, y: number) => x + (y - x) * t;
  // zoom interpolated in log space for natural fly-throughs
  const zoom = Math.exp(lerp(Math.log(a.cam.zoom), Math.log(b.cam.zoom)));
  const cam: Camera = { cx: lerp(a.cam.cx, b.cam.cx), cy: lerp(a.cam.cy, b.cam.cy), zoom, pitch: lerp(a.cam.pitch, b.cam.pitch), bearing: lerp(a.cam.bearing, b.cam.bearing) };
  if (style === 'topdown') return { ...cam, pitch: Math.min(cam.pitch, 8), bearing: cam.bearing * 0.3 };
  if (style === 'orbit') return { ...cam, bearing: cam.bearing + progress * 40 - 20 };
  return cam;
}
