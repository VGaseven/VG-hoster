/**
 * Local render worker for the Video Studio. The browser never spawns processes: it POSTs
 * a job here; this Node process runs Remotion and streams progress.
 *   POST /api/render            { preset, durationSec, cameraStyle, captions, metrics } → { id }
 *   GET  /api/render/:id        → job status
 *   GET  /api/files/:name       → rendered MP4
 *   GET  /api/health
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { renderVideo, OUTPUT_DIR } from './render';
import { videoSchema } from '../video/compositions/RasdVideo';

interface Job {
  id: string;
  status: 'queued' | 'rendering' | 'done' | 'error';
  progress: number;
  stage: string;
  file?: string;
  error?: string;
  createdAt: number;
  props: unknown;
  seconds?: number;
}
const jobs = new Map<string, Job>();
let running: Promise<void> = Promise.resolve();
const PORT = Number(process.env.RASD_RENDER_PORT ?? 3210);

function json(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, jobs: jobs.size });
  if (req.method === 'POST' && url.pathname === '/api/render') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const parsed = videoSchema.safeParse(JSON.parse(raw || '{}'));
    if (!parsed.success) return json(res, 400, { error: parsed.error.message });
    const id = `r${Date.now().toString(36)}`;
    const job: Job = { id, status: 'queued', progress: 0, stage: 'queued', createdAt: Date.now(), props: parsed.data };
    jobs.set(id, job);
    running = running.then(async () => {
      job.status = 'rendering';
      const name = `rasd-${parsed.data.preset}-${parsed.data.durationSec}s-${id}.mp4`;
      try {
        const r = await renderVideo({
          props: parsed.data,
          outFile: path.join(OUTPUT_DIR, name),
          onProgress: (p) => {
            job.progress = p.progress;
            job.stage = p.stage;
          },
        });
        fs.copyFileSync(path.join(OUTPUT_DIR, name), path.join(OUTPUT_DIR, 'rasd-simulation.mp4'));
        job.file = name;
        job.status = 'done';
        job.progress = 1;
        job.seconds = r.seconds;
      } catch (e) {
        job.status = 'error';
        job.error = e instanceof Error ? e.message : String(e);
      }
    });
    return json(res, 202, { id });
  }
  const m = url.pathname.match(/^\/api\/render\/([\w-]+)$/);
  if (req.method === 'GET' && m) {
    const job = jobs.get(m[1]);
    return job ? json(res, 200, job) : json(res, 404, { error: 'not found' });
  }
  const f = url.pathname.match(/^\/api\/files\/([\w.-]+\.mp4)$/);
  if (req.method === 'GET' && f) {
    const file = path.join(OUTPUT_DIR, path.basename(f[1]));
    if (!fs.existsSync(file)) return json(res, 404, { error: 'not found' });
    const stat = fs.statSync(file);
    const range = req.headers.range;
    if (range) {
      const [s, e] = range.replace('bytes=', '').split('-');
      const start = Number(s);
      const end = e ? Number(e) : stat.size - 1;
      res.writeHead(206, { 'content-type': 'video/mp4', 'content-range': `bytes ${start}-${end}/${stat.size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': stat.size, 'accept-ranges': 'bytes' });
      fs.createReadStream(file).pipe(res);
    }
    return;
  }
  json(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => console.log(`[RASD] render worker on http://127.0.0.1:${PORT}`));
