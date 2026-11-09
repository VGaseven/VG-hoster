import fs from 'node:fs';
import path from 'node:path';

/** Locate a Chrome Headless Shell / Chromium binary for Remotion (env override first). */
export function findBrowserExecutable(): string | null {
  const env = process.env.REMOTION_BROWSER;
  if (env && fs.existsSync(env)) return env;
  const roots = ['/opt/pw-browsers'];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell')).sort().reverse()) {
      const base = path.join(root, dir);
      for (const sub of fs.readdirSync(base)) {
        const cand = path.join(base, sub, 'chrome-headless-shell');
        if (fs.existsSync(cand)) return cand;
      }
    }
  }
  return null;
}
