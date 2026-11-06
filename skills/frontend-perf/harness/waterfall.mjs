// What a late mark waited on: every request in a time window after navigation start, sorted by when it finished,
// with the marks drawn in between. The requests that end just before a mark are usually what it was waiting for.
//
//   node waterfall.mjs <route> [--from 0] [--to 6000] [--profile mobile] [--match regex]
import { launch, loadConfig, openPage, parseArgs, settle } from './lib.mjs';

const args = parseArgs();
const cfg = loadConfig(args);
const route = args._[0] ?? cfg.routes[0];
const from = Number(args.from ?? 0);
const to = Number(args.to ?? cfg.budgets.ceilingMs);
const match = args.match ? new RegExp(args.match) : null;
const browser = await launch(cfg);
const { page } = await openPage(browser, cfg, args.profile ?? 'mobile');
await page.goto(cfg.baseUrl + route, { timeout: 120000, waitUntil: 'load' });
await settle(page, cfg.settleMs);
const { marks, rows } = await page.evaluate(() => ({
  marks: { fcp: window.__perfVitals.fcp, ...window.__perfMarks },
  rows: performance.getEntriesByType('resource').map((r) => ({
    end: Math.round(r.responseEnd),
    kb: Math.round(r.encodedBodySize / 1024),
    name: r.name.replace(location.origin, ''),
    start: Math.round(r.startTime),
    ttfb: Math.round(r.responseStart - r.startTime),
    type: r.initiatorType,
  })),
}));
const events = [
  ...rows.filter((r) => r.end >= from && r.end <= to && (!match || match.test(r.name))).map((r) => ({ at: r.end, r })),
  ...Object.entries(marks).filter(([, t]) => t != null && t >= from && t <= to).map(([k, t]) => ({ at: t, mark: k })),
].sort((a, b) => a.at - b.at);
console.log(`${route}  ${from}–${to} ms   start → end  (wait)  type  KB  url`);
for (const e of events) {
  if (e.mark) console.log(`${String(e.at).padStart(6)}  ◆ ${e.mark}`);
  else console.log(`${String(e.r.start).padStart(6)} → ${String(e.r.end).padStart(5)}  (${String(e.r.ttfb).padStart(4)})  ${e.r.type.padEnd(14)} ${String(e.r.kb).padStart(5)}  ${e.r.name.slice(0, 110)}`);
}
console.log('\nKB rounds down, and is 0 for cross-origin responses without Timing-Allow-Origin. "wait" is start to first byte, including time queued for a connection.');
await browser.close();
