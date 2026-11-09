import { Config } from '@remotion/cli/config';
import { findBrowserExecutable } from './server/browser';

Config.setVideoImageFormat('jpeg');
Config.setConcurrency(2);
Config.setChromiumOpenGlRenderer('swangle');
const exe = findBrowserExecutable();
if (exe) Config.setBrowserExecutable(exe);
Config.overrideWebpackConfig((c) => ({
  ...c,
  resolve: { ...c.resolve, alias: { ...(c.resolve?.alias ?? {}), '@': require('node:path').resolve(process.cwd(), 'src') } },
}));
