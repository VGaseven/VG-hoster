// Give each Hub release distinct asset URLs, including through browser/CDN caches.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..', 'public');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const file of ['hub.css', 'hub.js']) {
  const version = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex').slice(0, 16);
  html = html.replace(new RegExp(`/${file.replace('.', '\\.')}(?:\\?v=[a-f0-9]+)?(?=")`, 'g'), `/${file}?v=${version}`);
}
fs.writeFileSync(path.join(root, 'index.html'), html);
