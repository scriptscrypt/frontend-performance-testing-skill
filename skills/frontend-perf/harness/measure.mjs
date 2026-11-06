// Measures every route × profile × mode × run from perf.config.json and writes, per run, summary.json,
// filmstrip.png, video.webm, trace.zip and final.png into runs/<timestamp>/, then the report (report.md/.html).
//
//   node measure.mjs [--config perf.config.json] [--base URL] [--routes /,/pricing] [--profiles desktop,mobile]
//                    [--modes cold,warm] [--runs 3] [--settle 10000] [--ceiling 6000] [--headed]
//                    [--no-video] [--no-trace] [--no-auth]
//
// Exits 1 when a budget or the ceiling fails (so it can gate CI), 0 otherwise.
import fs from 'node:fs';
import path from 'node:path';

import { launch, loadConfig, measureOnce, parseArgs, slug, stamp } from './lib.mjs';
import { buildReport } from './report.mjs';

const args = parseArgs();
const cfg = loadConfig(args);
if (!Object.keys(cfg.marks).length) console.warn('! No marks in the config: only web vitals will be measured. See references/config.md.');
if (cfg.headed) console.warn('! Headed: good for watching, not for numbers. Re-run headless before you quote anything.');

const dir = path.join(cfg.out, stamp());
fs.mkdirSync(dir, { recursive: true });
const browser = await launch(cfg);
const results = [];
for (const profileName of cfg.profiles) {
  for (const route of cfg.routes) {
    for (const mode of cfg.modes) {
      for (let run = 0; run < cfg.runs; run++) {
        const r = await measureOnce(browser, cfg, {
          dir: path.join(dir, `${slug(route)}__${profileName}__${mode}__${run}`),
          mode,
          profileName,
          record: { trace: args.trace !== false, video: args.video !== false },
          route,
          run,
        });
        results.push(r);
        const marks = Object.entries(r.marks).map(([k, t]) => `${k}=${t}`).join(' ');
        const verdict = r.ceiling.pass ? 'ok' : `OVER ${[...r.ceiling.late.map((x) => `${x.mark}@${x.t}`), ...r.ceiling.missed.map((m) => `${m}:missed`)].join(',')}`;
        console.log(`${profileName.padEnd(7)} ${mode.padEnd(4)} ${route.padEnd(32)} fcp=${r.fcp} lcp=${r.lcp} ${marks} js=${r.jsKb}KB req=${r.requests} [${verdict}]`);
      }
    }
  }
}
await browser.close();
fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));
fs.writeFileSync(path.join(cfg.out, 'LATEST'), dir);

const { failed, md } = buildReport(dir, cfg);
console.log(`\n${md}`);
console.log(`Report: ${path.join(dir, 'report.html')}`);
process.exit(failed ? 1 : 0);
