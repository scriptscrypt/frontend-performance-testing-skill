// Interleaved A/B: cold loads of one route on two servers, alternating A,B then B,A, so drift in the backend,
// the network or the machine lands on both sides equally. The only fair way to compare two builds.
//
//   node ab.mjs --a http://localhost:3200 --b http://localhost:3100 [--route /] [--runs 5] [--profile mobile]
//               [--labels base,head] [--headed]
import fs from 'node:fs';
import path from 'node:path';

import { launch, loadConfig, measureOnce, median, parseArgs, stamp } from './lib.mjs';

const args = parseArgs();
const cfg = loadConfig(args);
if (!args.a || !args.b) throw new Error('Pass --a <url> and --b <url> (two production builds on two ports).');
const route = args.route ?? cfg.routes[0];
const runs = Number(args.runs ?? 5);
const profileName = args.profile ?? 'mobile';
const [la, lb] = (args.labels ?? 'A,B').split(',');
const sides = [
  { label: la, url: args.a },
  { label: lb, url: args.b },
];

const dir = path.join(cfg.out, `ab-${stamp()}`);
const browser = await launch(cfg);
const res = { [la]: [], [lb]: [] };
for (let i = 0; i < runs; i++) {
  for (const s of i % 2 ? [...sides].reverse() : sides) {
    const r = await measureOnce(browser, cfg, {
      baseUrl: s.url,
      dir: path.join(dir, `${s.label}__${i}`),
      mode: 'cold',
      profileName,
      record: { filmstrip: true, trace: false, video: args.video === true },
      route,
      run: i,
    });
    res[s.label].push(r);
    console.log(`${s.label.padEnd(6)} run ${i + 1}: fcp=${r.fcp} ${Object.entries(r.marks).map(([k, t]) => `${k}=${t}`).join(' ')} js=${r.jsKb}KB`);
  }
}
await browser.close();
fs.writeFileSync(path.join(dir, 'ab.json'), JSON.stringify(res, null, 2));

const marks = [...new Set([...res[la], ...res[lb]].flatMap((r) => r.applicable))];
const metrics = ['fcp', 'lcp', ...marks, 'tbt', 'jsKb', 'kb', 'requests'];
const get = (r, m) => (marks.includes(m) ? r.marks[m] ?? null : r[m]);
const lines = [
  `## A/B ${route} · ${profileName} · cold · ${runs} interleaved runs each`,
  '',
  `${la} = ${args.a}, ${lb} = ${args.b}. "clear" means every ${lb} run beat every ${la} run (or the reverse); anything else is within noise.`,
  '',
  `| metric | ${la} | ${lb} | Δ | Δ% | verdict | ${la} runs | ${lb} runs |`,
  '| --- | ---: | ---: | ---: | ---: | --- | --- | --- |',
];
for (const m of metrics) {
  const A = res[la].map((r) => get(r, m));
  const B = res[lb].map((r) => get(r, m));
  const ma = median(A);
  const mb = median(B);
  const nums = (xs) => xs.filter((x) => typeof x === 'number');
  let verdict = 'within noise';
  if (nums(A).length === A.length && nums(B).length === B.length) {
    if (Math.max(...B) < Math.min(...A)) verdict = `clear: ${lb} better`;
    else if (Math.max(...A) < Math.min(...B)) verdict = `clear: ${lb} worse`;
  } else verdict = 'missed in some runs';
  const d = ma != null && mb != null ? mb - ma : null;
  const pct = d != null && ma ? `${Math.round((d / ma) * 100)}%` : '—';
  lines.push(`| ${m} | ${ma ?? '—'} | ${mb ?? '—'} | ${d ?? '—'} | ${pct} | ${verdict} | ${A.map((x) => x ?? '×').join(', ')} | ${B.map((x) => x ?? '×').join(', ')} |`);
}
const md = lines.join('\n');
fs.writeFileSync(path.join(dir, 'ab.md'), `${md}\n`);
console.log(`\n${md}\n\nFilmstrips: ${dir}`);
