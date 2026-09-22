// Screenshot a dev page on the REAL GPU, optionally after running some JS.
//
//   node dev/shoot.mjs <page> <out.png> [css-selector] [js-function-source]
//   node dev/shoot.mjs index /tmp/a.png '#stage' '()=>window.__setParams({wipe:0.5})'
// `index` is the app at the repository root; anything else is dev/<page>.html.
//
// Lives in the repo rather than /tmp because /tmp is wiped between sessions.
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
// playwright-core: a normal install if there is one (npm i playwright-core),
// otherwise the copy in the author's sibling promo_hollved project.
const loadPW = () => { try { return require('playwright-core'); } catch { return require(join(homedir(), 'Documents/workspace/playground/promo_hollved/scripts/node_modules/playwright-core')); } };
const { chromium } = loadPW();

const [page_, out, sel = 'body', js] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.setDefaultTimeout(180000);
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const path = page_ === 'index' ? 'index.html' : `dev/${page_}.html`;
await page.goto(`http://127.0.0.1:8777/${path}`, { waitUntil: 'networkidle' });
await page.waitForFunction('window.__done===true');
// page.evaluate(string) returns a function WITHOUT calling it; wrap in an IIFE
if (js) await page.evaluate(`(${js})()`);
await page.waitForTimeout(400);
await (await page.$(sel)).screenshot({ path: out });
const stats = await page.evaluate(() => (window.__stats ? window.__stats() : null));
if (stats) console.log('stats:', JSON.stringify(stats));
console.log('errors:', errs.length ? errs : 'none');
await browser.close();
