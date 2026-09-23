// Screenshot the app at several window sizes and report what fits on screen.
//
//   node dev/viewports.mjs [outdir] [port]
//
// The layout sizes the map from the viewport height, so "does the footer show
// without scrolling" has to be checked at real window sizes, not one.
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
// playwright-core: a normal install if there is one (npm i playwright-core),
// otherwise the copy in the author's sibling promo_hollved project.
const loadPW = () => { try { return require('playwright-core'); } catch { return require(join(homedir(), 'Documents/workspace/playground/promo_hollved/scripts/node_modules/playwright-core')); } };
const { chromium } = loadPW();

const out = process.argv[2] || '/tmp';
const port = process.argv[3] || '8777';
// width, height, name, mobile — browser viewports, i.e. screen minus browser chrome
const SIZES = [[1920, 950, 'fhd'], [1440, 790, 'mbp'], [1366, 657, 'hd'], [390, 844, 'phone', true]];

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const [w, h, name, mobile] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h },
    deviceScaleFactor: mobile ? 3 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  const page = await ctx.newPage();
  page.setDefaultTimeout(180000);
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction('window.__done===true');
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    return { footerBottom: Math.round(r('.app-footer').bottom), docH: document.documentElement.scrollHeight,
             stage: Math.round(r('#stage').width) };
  });
  await page.screenshot({ path: `${out}/vp-${name}.png`, fullPage: !!mobile });
  console.log(`${name} ${w}x${h}: map ${m.stage}px, page ${m.docH}px,`,
    `footer ${m.footerBottom <= h ? 'on screen' : 'below the fold'}, errors: ${errs.length ? errs : 'none'}`);
  await ctx.close();
}
await browser.close();
