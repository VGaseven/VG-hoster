/**
 * npm run export-sim [-- --preset 1080p|4k|vertical|square --duration 54 --camera cinematic|orbit|topdown --no-captions --no-metrics --out output/rasd-simulation.mp4]
 */
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { renderVideo, OUTPUT_DIR } from '../server/render';
import { DEFAULT_VIDEO_PROPS, videoSchema } from '../video/compositions/RasdVideo';

const args = process.argv.slice(2);
const get = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const props = videoSchema.parse({
  ...DEFAULT_VIDEO_PROPS,
  preset: get('preset') ?? DEFAULT_VIDEO_PROPS.preset,
  durationSec: Number(get('duration') ?? DEFAULT_VIDEO_PROPS.durationSec),
  cameraStyle: get('camera') ?? DEFAULT_VIDEO_PROPS.cameraStyle,
  captions: !args.includes('--no-captions'),
  metrics: !args.includes('--no-metrics'),
});
const out = path.resolve(get('out') ?? path.join(OUTPUT_DIR, 'rasd-simulation.mp4'));
let last = -1;
console.log(`[RASD] rendering ${props.preset} · ${props.durationSec}s · ${props.cameraStyle} → ${out}`);
const res = await renderVideo({
  props,
  outFile: out,
  concurrency: get('concurrency') ? Number(get('concurrency')) : undefined,
  onProgress: ({ progress, renderedFrames, stage }) => {
    const pct = Math.floor(progress * 100);
    if (pct !== last && pct % 5 === 0) {
      last = pct;
      console.log(`[RASD] ${pct}% · frames ${renderedFrames} · ${stage}`);
    }
  },
});
const size = fs.statSync(out).size;
console.log(`[RASD] done: ${res.frames} frames ${res.width}x${res.height} in ${res.seconds.toFixed(1)}s · ${(size / 1e6).toFixed(1)} MB`);
try {
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,nb_frames:format=duration', '-of', 'compact', out]).toString();
  console.log(`[RASD] ffprobe: ${probe.trim().replace(/\n/g, ' | ')}`);
} catch {
  console.log('[RASD] ffprobe not available — skipped verification');
}
