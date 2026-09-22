// Headless runner for the dev/*.html gates.
//
//   node dev/run-checks.mjs [fft|fields|slab|energybar] [port]
//
// CRITICAL: headless Chrome silently falls back to SwiftShader, whose sin/cos are
// low precision. That does not just make things slow - it makes the FFT accuracy
// test report ~5e-5 instead of ~3e-7, which reads exactly like an algorithm bug.
// So: force the real GPU, retry (init is flaky), and refuse to report numbers
// from a software renderer.

import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
// playwright-core: a normal install if there is one (npm i playwright-core),
// otherwise the copy in the author's sibling promo_hollved project.
const loadPW = () => { try { return require('playwright-core'); } catch { return require(join(homedir(), 'Documents/workspace/playground/promo_hollved/scripts/node_modules/playwright-core')); } };
const { chromium } = loadPW();

const page_ = process.argv[2] || 'fields';
const port = process.argv[3] || '8777';
const url = `http://127.0.0.1:${port}/dev/${page_}.html`;

const GPU = ['--no-sandbox', '--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'];
const SW = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

async function attempt(args, requireGpu) {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    page.setDefaultTimeout(600000);
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const caps = await page.evaluate(() => document.getElementById('caps')?.innerText || '');
    if (requireGpu && /SwiftShader|software/i.test(caps)) return null;
    await page.waitForFunction('window.__done===true');
    const text = await page.evaluate(() => document.getElementById('out')?.innerText || document.body.innerText);
    return { caps, text, errs };
  } finally {
    await browser.close();
  }
}

let r = null;
for (let i = 0; i < 4 && !r; i++) { try { r = await attempt(GPU, true); } catch (e) { if (i === 3) console.error(e.message); } }
if (!r) {
  console.log('!! real GPU unavailable - falling back to SwiftShader.');
  console.log('!! TIMINGS AND PRECISION FROM THIS RUN ARE NOT TRUSTWORTHY.');
  r = await attempt(SW, false);
}
console.log(r.caps);
console.log(r.text);
console.log('errors:', r.errs.length ? r.errs : 'none');
