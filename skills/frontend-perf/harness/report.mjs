// Turns a run's results.json into report.md and report.html: medians per route × profile × mode, budget checks,
// the 6 s ceiling, and the filmstrip of the median run of each group.
//
//   node report.mjs [runs/<timestamp>]   (default: the latest run)   [--config perf.config.json]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadConfig, median, parseArgs } from './lib.mjs';

const VITALS = ['ttfb', 'fcp', 'lcp'];
const TAIL = ['tbt', 'cls', 'jsKb', 'kb', 'requests', 'apiCalls'];

// Budget keys are "<profile>.<mode>" with "*" wildcards; the most specific match wins.
export function budgetFor(metricBudgets, profile, mode) {
  if (metricBudgets == null) return null;
  if (typeof metricBudgets === 'number') return metricBudgets;
  for (const k of [`${profile}.${mode}`, `${profile}.*`, `*.${mode}`, '*']) if (metricBudgets[k] != null) return metricBudgets[k];
  return null;
}

export function buildReport(dir, cfg) {
  const rows = JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8'));
  const markNames = [...new Set(rows.flatMap((r) => r.applicable ?? Object.keys(r.marks ?? {})))];
  const value = (r, m) => (m in (r.marks ?? {}) || markNames.includes(m) ? r.marks?.[m] ?? null : r[m]);
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.route}|${r.profile}|${r.mode}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  const cols = [...VITALS, ...markNames, ...TAIL];
  const ceilingMs = cfg.budgets.ceilingMs;
  const failures = [];
  const table = [];
  for (const [k, rs] of groups) {
    const [route, profile, mode] = k.split('|');
    const cells = {};
    for (const m of cols) {
      const med = median(rs.map((r) => value(r, m)));
      const budget = budgetFor(cfg.budgets.metrics?.[m], profile, mode);
      const over = budget != null && med != null && med > budget;
      if (over) failures.push(`${route} ${profile} ${mode}: ${m} median ${med} > budget ${budget}`);
      cells[m] = { budget, med, over };
    }
    const ceilingFails = rs.filter((r) => !r.ceiling.pass);
    for (const r of ceilingFails) {
      const why = [...r.ceiling.late.map((x) => `${x.mark} at ${x.t} ms`), ...r.ceiling.missed.map((m) => `${m} never appeared`)].join(', ');
      failures.push(`${route} ${profile} ${mode} run ${r.run + 1}: over the ${ceilingMs} ms ceiling (${why})`);
    }
    // The run whose slowest mark is the median one: its filmstrip is the honest picture of the group.
    const byWorst = [...rs].sort((a, b) => (a.ceiling.worst?.t ?? Infinity) - (b.ceiling.worst?.t ?? Infinity));
    const rep = byWorst[Math.floor((byWorst.length - 1) / 2)];
    const worstMax = Math.max(...rs.map((r) => (r.ceiling.missed.length ? Infinity : r.ceiling.worst?.t ?? 0)));
    table.push({ ceilingOk: !ceilingFails.length, cells, mode, profile, rep, route, runs: rs.length, worstMax });
  }

  const fmt = (c) => (c.med == null ? '—' : `${c.med}${c.over ? ' ❌' : ''}`);
  const head = ['route', 'profile', 'mode', 'runs', ...cols, `slowest (≤ ${ceilingMs})`];
  const mdRows = table.map((t) => [
    `\`${t.route}\``,
    t.profile,
    t.mode,
    t.runs,
    ...cols.map((m) => fmt(t.cells[m])),
    `${t.worstMax === Infinity ? 'missed' : t.worstMax} ${t.ceilingOk ? '✅' : '❌'}`,
  ]);
  const headed = rows.some((r) => r.headed);
  const md = [
    `## Performance run ${path.basename(dir)}`,
    '',
    `Base: ${rows[0]?.baseUrl}. Medians in ms (jsKb/kb in KB). "slowest" is the worst mark of any run; every mark, FCP and LCP must land within ${ceilingMs} ms.${headed ? ' **Headed run — not for quoting.**' : ''}`,
    '',
    `| ${head.join(' | ')} |`,
    `| ${head.map((_, i) => (i < 3 ? '---' : '---:')).join(' | ')} |`,
    ...mdRows.map((r) => `| ${r.join(' | ')} |`),
    '',
    failures.length ? `### ❌ ${failures.length} failure(s)\n\n${failures.map((f) => `- ${f}`).join('\n')}` : '### ✅ All budgets and the ceiling pass',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'report.md'), md);

  const rel = (p) => path.relative(dir, p).split(path.sep).join('/');
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Perf report ${esc(path.basename(dir))}</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#111;--mut:#666;--line:#ddd;--bad:#b91c1c;--ok:#15803d}
@media (prefers-color-scheme:dark){:root{--bg:#0b0f17;--fg:#e5e7eb;--mut:#9ca3af;--line:#1f2937;--bad:#f87171;--ok:#4ade80}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:14px/1.5 ui-sans-serif,system-ui,sans-serif}
main{max-width:1400px;margin:0 auto}h1{font-size:20px}h2{font-size:16px;margin-top:32px}
.wrap{overflow-x:auto}table{border-collapse:collapse;font:12px ui-monospace,monospace}
th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:right;white-space:nowrap}th:nth-child(-n+3),td:nth-child(-n+3){text-align:left}
.bad{color:var(--bad);font-weight:600}.ok{color:var(--ok)}.mut{color:var(--mut)}img{max-width:100%;border-radius:6px;display:block}
ul{padding-left:20px}
</style><main>
<h1>Performance run ${esc(path.basename(dir))}</h1>
<p class="mut">Base ${esc(rows[0]?.baseUrl)} · medians in ms · ceiling ${ceilingMs} ms for every mark, FCP and LCP${headed ? ' · <b class="bad">headed run, not for quoting</b>' : ''}</p>
<div class="wrap"><table><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>
${table
  .map(
    (t) =>
      `<tr><td>${esc(t.route)}</td><td>${t.profile}</td><td>${t.mode}</td><td>${t.runs}</td>${cols
        .map((m) => {
          const c = t.cells[m];
          return `<td class="${c.over ? 'bad' : ''}" title="${c.budget != null ? `budget ${c.budget}` : ''}">${c.med ?? '—'}</td>`;
        })
        .join('')}<td class="${t.ceilingOk ? 'ok' : 'bad'}">${t.worstMax === Infinity ? 'missed' : t.worstMax}</td></tr>`,
  )
  .join('\n')}
</table></div>
${failures.length ? `<h2 class="bad">${failures.length} failure(s)</h2><ul>${failures.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '<h2 class="ok">All budgets and the ceiling pass</h2>'}
${table
  .map((t) => {
    const strip = path.join(t.rep.dir, 'filmstrip.png');
    return `<h2>${esc(t.route)} · ${t.profile} · ${t.mode} <span class="mut">(median run ${t.rep.run + 1})</span></h2>${
      fs.existsSync(strip) ? `<img loading="lazy" src="${rel(strip)}" alt="Filmstrip">` : '<p class="mut">No filmstrip.</p>'
    }<p class="mut"><a href="${rel(path.join(t.rep.dir, 'video.webm'))}">video</a> · trace: <code>npx playwright show-trace ${esc(rel(path.join(t.rep.dir, 'trace.zip')))}</code></p>`;
  })
  .join('\n')}
</main>`;
  fs.writeFileSync(path.join(dir, 'report.html'), html);
  return { failed: failures.length > 0, failures, md };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs();
  const cfg = loadConfig(args);
  const latest = path.join(cfg.out, 'LATEST');
  const dir = args._[0] ?? (fs.existsSync(latest) ? fs.readFileSync(latest, 'utf8').trim() : null);
  if (!dir) throw new Error('No run directory given and no runs/LATEST.');
  const { failed, md } = buildReport(path.resolve(dir), cfg);
  console.log(md);
  process.exit(failed ? 1 : 0);
}
