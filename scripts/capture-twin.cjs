/**
 * node scripts/capture-twin.cjs [baseUrl] [out.mp4]
 * Captures the deterministic 30 s scene from /twin-capture frame by frame and encodes H.264.
 */
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const base = process.argv[2] || 'http://localhost:5173';
const out = path.resolve(process.argv[3] || 'output/rasd-twin-30s.mp4');
const dir = path.resolve('output/twin-frames');
(async () => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  p.on('pageerror', (e) => console.error('PAGEERR', e.message));
  await p.goto(`${base}/twin-capture`);
  await p.waitForFunction(() => window.__capture && window.__capture.ready, null, { timeout: 120000 });
  await p.evaluate(() => document.fonts.ready);
  const n = await p.evaluate(() => window.__capture.frames);
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    await p.evaluate((k) => window.__capture.frame(k), i);
    await p.screenshot({ path: path.join(dir, `f${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 90 });
    if (i % 90 === 0) console.log(`[capture] ${i}/${n} frames · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  await b.close();
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', '30', '-i', path.join(dir, 'f%04d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', out]);
  console.log(`[capture] wrote ${out}`);
})();
