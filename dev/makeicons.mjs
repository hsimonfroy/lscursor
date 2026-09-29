// Render the app's icon artwork and write the PNGs into assets/.
//
//   node dev/makeicons.mjs [port]
//
// The picture is composed in dev/logo.html by the app itself - same field, same
// tone curve - so the tab icon, the link preview and the map always agree.
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
// playwright-core: a normal install if there is one (npm i playwright-core),
// otherwise the copy in the author's sibling promo_hollved project.
const loadPW = () => { try { return require('playwright-core'); } catch { return require(join(homedir(), 'Documents/workspace/playground/promo_hollved/scripts/node_modules/playwright-core')); } };
const { chromium } = loadPW();

const port = process.argv[2] || '8777';
const assets = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.setDefaultTimeout(180000);
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:${port}/dev/logo.html`, { waitUntil: 'networkidle' });
await page.waitForFunction('window.__done===true');
const write = (name, url) => {
  const png = Buffer.from(url.split(',')[1], 'base64');
  writeFileSync(join(assets, name), png);
  console.log(`assets/${name}  ${(png.length / 1024).toFixed(0)} kB`);
};
// icons are transparent outside the disk; the link preview is opaque black,
// since a social card composites transparency on whatever background it likes
for (const size of await page.evaluate(() => window.__sizes)) {
  write(`icon-${size}.png`, await page.evaluate((s) => window.__icon(s), size));
}
write('preview.png', await page.evaluate(() => window.__preview()));
console.log('errors:', errs.length ? errs : 'none');
await browser.close();
