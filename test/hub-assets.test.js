import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..', 'public');
test('Hub HTML references the current content version of every application asset', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const file of ['hub.js', 'hub.css']) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex').slice(0, 16);
    assert.ok(html.includes(`/${file}?v=${hash}"`), `Run node scripts/version-hub-assets.mjs after changing ${file}`);
    assert.ok(!html.includes(`/${file}"`), 'Unversioned assets can mix cached releases');
  }
});
