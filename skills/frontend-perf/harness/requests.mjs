// Counts responses whose URL matches a pattern during the first N seconds of a page, by path and status.
// Finds request storms: one call per row, polling that never stops, the same URL fetched five times.
//
//   node requests.mjs <route> [--match /api/] [--for 15000] [--profile desktop]
import { launch, loadConfig, openPage, parseArgs } from './lib.mjs';

const args = parseArgs();
const cfg = loadConfig(args);
const route = args._[0] ?? cfg.routes[0];
const pattern = new RegExp(args.match ?? cfg.apiPattern);
const browser = await launch(cfg);
const { page } = await openPage(browser, cfg, args.profile ?? 'desktop');
const hits = new Map();
page.on('response', (r) => {
  const u = r.url();
  if (!pattern.test(u)) return;
  const k = `${r.request().method()} ${u.split('?')[0].replace(/^https?:\/\/[^/]+/, '')} ${r.status()}`;
  hits.set(k, (hits.get(k) ?? 0) + 1);
});
await page.goto(cfg.baseUrl + route, { timeout: 120000, waitUntil: 'load' });
await page.waitForTimeout(Number(args.for ?? 15000));
const sorted = [...hits].sort((a, b) => b[1] - a[1]);
console.log(`${route}: ${sorted.reduce((s, [, n]) => s + n, 0)} responses matching ${pattern} in ${args.for ?? 15000} ms`);
for (const [k, n] of sorted) console.log(String(n).padStart(5), k);
await browser.close();
