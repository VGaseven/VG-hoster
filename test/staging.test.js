// Staging mode (scripts/staging.sh): loopback only, needs a phrase, and every external action stays off.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const phrase = crypto.randomBytes(12).toString('hex');
const port = 4600 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${port}`;
let tmp, server;
const env = (extra) => ({ PATH: process.env.PATH, HOME: tmp, HUB_STAGING: '1', HOST: '127.0.0.1', PORT: String(port), TRUST_PROXY: '0',
  DB_FILE: path.join(tmp, 'bridge.db'), WORK_DIR: path.join(tmp, 'work'), AI_ENGINE: 'subscription', TRIAL_START: '1', TELEGRAM_POLL: '0', ...extra });
const call = (p, method = 'GET', body, token = phrase) => fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'staging-test-'));
  server = spawn(process.execPath, ['--no-warnings', 'server.js'], { cwd: root, env: env({ BRIDGE_TOKEN: phrase }), stdio: 'ignore' });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/health')).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('staging server did not start');
});
after(() => { server?.kill(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('staging refuses to start without a phrase', () => {
  const r = spawnSync(process.execPath, ['--no-warnings', 'server.js'], { cwd: root, env: env({ PORT: String(port + 1) }), timeout: 10000 });
  assert.notEqual(r.status, 0);
});
test('staging rejects a missing or wrong phrase and accepts the right one', async () => {
  assert.equal((await call('/api/projects', 'GET', undefined, '')).status, 401);
  assert.equal((await call('/api/projects', 'GET', undefined, 'wrong-phrase')).status, 401);
  const projects = await (await call('/api/projects')).json();
  assert.deepEqual(projects.map((p) => p.name), ['default']);
});
test('staging blocks MCP and external actions but stores chat messages', async () => {
  assert.equal((await call('/mcp', 'POST', {})).status, 403);
  assert.equal((await call('/api/tasks', 'POST', { title: 'x' })).status, 403);
  assert.equal((await call('/api/schedules', 'POST', { cron: '* * * * *' })).status, 403);
  assert.equal((await call('/api/direct', 'POST', { project: 'default', agent: 'codex', text: 'hi' })).status, 403);
  const posted = await (await call('/api/chat', 'POST', { project: 'default', text: 'hello @claude' })).json();
  assert.deepEqual(posted.answering, []);
  assert.equal(posted.posted.text, 'hello @claude');
});
