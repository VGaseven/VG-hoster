/**
 * Programmatic Remotion render (used by the CLI script and the local render worker).
 */
import path from 'node:path';
import fs from 'node:fs';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { findBrowserExecutable } from './browser';
import type { VideoProps } from '../video/compositions/RasdVideo';

const ROOT = process.cwd();
export const OUTPUT_DIR = path.join(ROOT, 'output');

let bundlePromise: Promise<string> | null = null;
export function getBundle() {
  bundlePromise ??= bundle({
    entryPoint: path.join(ROOT, 'video/index.ts'),
    webpackOverride: (c) => ({
      ...c,
      resolve: { ...c.resolve, alias: { ...(c.resolve?.alias ?? {}), '@': path.join(ROOT, 'src') } },
    }),
  });
  return bundlePromise;
}

export interface RenderOptions {
  props: VideoProps;
  outFile: string;
  concurrency?: number;
  onProgress?: (p: { progress: number; renderedFrames: number; encodedFrames: number; stage: string }) => void;
}

export async function renderVideo({ props, outFile, concurrency, onProgress }: RenderOptions) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  onProgress?.({ progress: 0, renderedFrames: 0, encodedFrames: 0, stage: 'bundling' });
  const serveUrl = await getBundle();
  const browserExecutable = findBrowserExecutable();
  const chromiumOptions = { gl: 'swangle' as const };
  const composition = await selectComposition({ serveUrl, id: 'RasdSimulation', inputProps: props, browserExecutable, chromiumOptions });
  const started = Date.now();
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: outFile,
    inputProps: props,
    browserExecutable,
    chromiumOptions,
    imageFormat: 'jpeg',
    jpegQuality: 88,
    crf: 20,
    pixelFormat: 'yuv420p',
    concurrency: concurrency ?? Math.max(1, Math.min(4, (await import('node:os')).cpus().length - 1)),
    timeoutInMilliseconds: 120000,
    onProgress: ({ progress, renderedFrames, encodedFrames, stitchStage }) => onProgress?.({ progress, renderedFrames, encodedFrames, stage: stitchStage ?? 'rendering' }),
  });
  return { outFile, frames: composition.durationInFrames, width: composition.width, height: composition.height, seconds: (Date.now() - started) / 1000 };
}
