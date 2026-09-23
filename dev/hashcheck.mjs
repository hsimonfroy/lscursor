// Check the stats panel's URL-hash contract, on the real GPU.
//
//   node dev/hashcheck.mjs [url]        default http://127.0.0.1:8777/index.html
//
// The contract: #power / #2pcf open the panel on that statistic, #none closes
// it at any width, no hash leaves the default (open on a wide screen, closed on
// a narrow one), and whatever you do is written back so the link can be shared
// and reloaded. An earlier version wiped the hash while applying it, which made
// a shared link work exactly once.
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
// playwright-core: a normal install if there is one (npm i playwright-core),
// otherwise the copy in the author's sibling promo_hollved project.
const loadPW = () => { try { return require('playwright-core'); } catch { return require(join(homedir(), 'Documents/workspace/playground/promo_hollved/scripts/node_modules/playwright-core')); } };
const { chromium } = loadPW();

const url = process.argv[2] || 'http://127.0.0.1:8777/index.html';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errs = [];
let fails = 0;

const state = (page) => page.evaluate(() => ({
  hash: location.hash,
  stat: window.__pk().stat,
  open: document.getElementById('pk').getBoundingClientRect().height > 0,
}));
const check = (label, got, want) => {
  const ok = got.hash === want.hash && got.stat === want.stat && got.open === want.open;
  if (!ok) fails++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(got)}${ok ? '' : ` want ${JSON.stringify(want)}`}`);
};

for (const [w, h, name, mobile] of [[1440, 790, 'wide', false], [390, 844, 'narrow', true]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: !!mobile, hasTouch: !!mobile });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const load = async (hash) => {
    // cold load every time: navigating between two hashes of the same page is a
    // same-document navigation, which would carry the previous state over
    await page.goto('about:blank');
    await page.goto(url + hash, { waitUntil: 'networkidle' });
    await page.waitForFunction('window.__done===true');
    await page.waitForTimeout(200);
  };
  console.log(`${name} (${w}x${h})`);
  const dflt = !mobile;
  await load('');        check('no hash', await state(page), { hash: '', stat: 'pk', open: dflt });
  await load('#power');  check('#power', await state(page), { hash: '#power', stat: 'pk', open: true });
  await load('#2pcf');   check('#2pcf', await state(page), { hash: '#2pcf', stat: 'xi', open: true });
  await load('#none');   check('#none', await state(page), { hash: '#none', stat: 'pk', open: false });
  // the hash must follow what the user does, and survive a reload
  await load('');
  await page.click('#statsToggle'); await page.waitForTimeout(200);
  check('toggle from default', await state(page), { hash: dflt ? '#none' : '#power', stat: 'pk', open: !dflt });
  if (!dflt) {
    await page.click('.pk-tab:nth-child(2)'); await page.waitForTimeout(150);
    check('then 2PCF', await state(page), { hash: '#2pcf', stat: 'xi', open: true });
  }
  const before = await state(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction('window.__done===true'); await page.waitForTimeout(200);
  check('after reload', await state(page), before);
  await ctx.close();
}
console.log('errors:', errs.length ? errs : 'none');
console.log(fails ? `${fails} FAILED` : 'all checks passed');
await browser.close();
process.exit(fails ? 1 : 0);
