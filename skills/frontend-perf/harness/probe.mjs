// Checks the marks before you trust them: loads a route once and prints when each mark fired, and for each that
// never fired, why — no element matched the selector, it matched but was hidden or off screen, or the text
// didn't match. A mark that never fires is a broken definition, not a slow page.
//
//   node probe.mjs <route> [--profile desktop] [--headed] [--settle 10000]
import { launch, loadConfig, openPage, parseArgs, settle } from './lib.mjs';

const args = parseArgs();
const cfg = loadConfig(args);
const route = args._[0] ?? cfg.routes[0];
const browser = await launch(cfg);
const { page } = await openPage(browser, cfg, args.profile ?? 'desktop');
const res = await page.goto(cfg.baseUrl + route, { timeout: 120000, waitUntil: 'load' });
await settle(page, cfg.settleMs);
const out = await page.evaluate(() => {
  const marks = window.__perfMarks;
  return {
    applicable: window.__perfApplicable(),
    explain: Object.fromEntries(window.__perfPending().map((k) => [k, window.__perfExplain(k)])),
    fcp: window.__perfVitals.fcp,
    marks,
    url: location.href,
  };
});
console.log(`${route} → ${out.url} (HTTP ${res?.status()})  fcp=${out.fcp}`);
for (const k of Object.keys(cfg.marks)) {
  if (!out.applicable.includes(k)) {
    console.log(`  ·  ${k.padEnd(16)} not applicable here (onRoutes)`);
    continue;
  }
  const t = out.marks[k];
  if (t != null) {
    console.log(`  ✓  ${k.padEnd(16)} ${t} ms`);
    continue;
  }
  const e = out.explain[k];
  const spec = cfg.marks[k];
  let why;
  if (e.js) why = 'js expression stayed false';
  else if (e.frameMissing) why = `frame ${spec.frame} not found or cross-origin (contentDocument blocked)`;
  else if (!e.all) why = `no element matches selector ${JSON.stringify(spec.selector)}`;
  else if (!e.shown) why = `${e.all} match(es) but none visible in the viewport (hidden, opacity 0 or off screen)`;
  else why = `${e.shown} visible match(es) but text /${spec.text}/ never matched; saw ${JSON.stringify(e.samples)}`;
  console.log(`  ✗  ${k.padEnd(16)} never fired — ${why}`);
}
await browser.close();
