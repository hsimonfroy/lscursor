// End-to-end frame timings for the app (index.html) on the real GPU.
//   node dev/bench.mjs
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
// playwright-core: a normal install if there is one (npm i playwright-core),
// otherwise the copy in the author's sibling promo_hollved project.
const loadPW = () => { try { return require('playwright-core'); } catch { return require(join(homedir(), 'Documents/workspace/playground/promo_hollved/scripts/node_modules/playwright-core')); } };
const { chromium } = loadPW();

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.setDefaultTimeout(180000);
await page.goto('http://127.0.0.1:8777/index.html', { waitUntil: 'networkidle' });
await page.waitForFunction('window.__done===true');
// Separate loops: interleaving the two makes the paint timing absorb the GPU
// tail of the preceding cosmology frame, which is how an earlier version of
// this script reported a 5 -> 38 ms "regression" that was not there.
const t = await page.evaluate(() => {
  const cos = [], paint = [];
  for (let i = 0; i < 9; i++) {
    window.__setParams({ Omega_b: 0.049, Omega_c: 0.20 + i * 0.02, Omega_L: 0.751 - i * 0.02 });
    cos.push(window.__stats().lastMs);
  }
  for (let i = 0; i < 9; i++) {
    window.__setParams({ b1: 1.5 + i * 0.05 });
    paint.push(window.__stats().lastMs);
  }
  const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
  return { cos: med(cos), paint: med(paint) };
});
console.log(`cosmology change (synthesis + FFT + paint): ${t.cos.toFixed(0)} ms  (~${(1000 / t.cos).toFixed(0)} fps while dragging)`);
console.log(`b1 / f change   (paint only):               ${t.paint.toFixed(0)} ms`);
await browser.close();
