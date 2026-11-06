// Which code issued requests matching a pattern, grouped by the JS call stack that started them. Run it against
// the DEV server (readable file and function names); its timings mean nothing, only the stacks do.
//
//   node initiators.mjs <route> --match <regex> [--base http://localhost:3000] [--for 15000]
import { launch, loadConfig, openPage, parseArgs } from './lib.mjs';

const args = parseArgs();
const cfg = loadConfig(args);
const route = args._[0] ?? cfg.routes[0];
const pattern = new RegExp(args.match ?? cfg.apiPattern);
const LIBS = /node_modules|react-dom|react-query|query-core|scheduler|webpack|turbopack|next\/dist|vite\/|@vite|chunk-/;
const browser = await launch(cfg);
const { cdp, page } = await openPage(browser, cfg, args.profile ?? 'desktop');
await cdp.send('Network.enable');
const counts = new Map();
cdp.on('Network.requestWillBeSent', (e) => {
  if (!pattern.test(e.request.url)) return;
  const frames = [];
  for (let st = e.initiator.stack; st; st = st.parent) frames.push(...st.callFrames);
  const own = frames.filter((f) => f.url && !LIBS.test(f.url)).slice(0, 3);
  const pick = own.length ? own : frames.slice(0, 3);
  const key = pick.map((f) => `${f.functionName || '(anonymous)'}@${f.url.split('/').pop().split('?')[0].slice(0, 60)}:${f.lineNumber + 1}`).join(' ← ') || `(${e.initiator.type})`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
});
await page.goto(cfg.baseUrl + route, { timeout: 120000, waitUntil: 'load' });
await page.waitForTimeout(Number(args.for ?? 15000));
for (const [k, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(5), k);
if (!counts.size) console.log(`No requests matched ${pattern}.`);
await browser.close();
