// Preflight: is everything in place for numbers you can trust? Node, Playwright, Chromium, the config, the server
// (and whether it looks like a dev server), the saved session. Exits 1 if anything blocks a run.
//
//   node doctor.mjs [--config perf.config.json] [--base URL]
import fs from 'node:fs';

import { loadConfig, parseArgs } from './lib.mjs';

const args = parseArgs();
let bad = 0;
const ok = (m) => console.log(`  ✓  ${m}`);
const warn = (m) => console.log(`  !  ${m}`);
const fail = (m) => {
  bad++;
  console.log(`  ✗  ${m}`);
};

const major = Number(process.versions.node.split('.')[0]);
major >= 18 ? ok(`Node ${process.versions.node}`) : fail(`Node ${process.versions.node}: need 18+`);

try {
  const { chromium } = await import('playwright');
  const exe = chromium.executablePath();
  fs.existsSync(exe) ? ok('Playwright + Chromium installed') : fail('Chromium missing: run `npx playwright install chromium`');
} catch {
  fail('Playwright not installed: run `npm install` in this folder');
}
try {
  await import('sharp');
  ok('sharp installed (filmstrips)');
} catch {
  fail('sharp not installed: run `npm install` in this folder');
}

let cfg;
try {
  cfg = loadConfig(args);
  cfg.configFile ? ok(`Config ${cfg.configFile}`) : warn('No perf.config.json here: using defaults (copy perf.config.example.json)');
  const n = Object.keys(cfg.marks).length;
  n ? ok(`${n} mark(s): ${Object.keys(cfg.marks).join(', ')}`) : warn('No marks: only web vitals will be measured');
  ok(`Routes ${cfg.routes.join(', ')} · profiles ${cfg.profiles.join(', ')} · ceiling ${cfg.budgets.ceilingMs} ms`);
} catch (e) {
  fail(`Config: ${e.message}`);
}

if (cfg) {
  try {
    const res = await fetch(cfg.baseUrl + cfg.routes[0], { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const html = await res.text();
    ok(`${cfg.baseUrl}${cfg.routes[0]} answered HTTP ${res.status}`);
    const devSigns = [
      [/@vite\/client|\/@react-refresh/, 'Vite dev server'],
      [/webpack-hmr|turbopack.*hmr|hmr-client|__nextDevClientId|react-refresh/i, 'Next.js / webpack dev server'],
      [/ng-cli-ws|\/webpack-dev-server/, 'webpack-dev-server'],
    ].filter(([re]) => re.test(html));
    if (devSigns.length) fail(`${cfg.baseUrl} looks like a ${devSigns[0][1]}. Dev timings mean nothing: measure a production build.`);
    else ok('No dev-server markers in the HTML');
  } catch (e) {
    fail(`${cfg.baseUrl} not reachable (${e.cause?.code ?? e.name}). Start the production server first.`);
  }

  if (cfg.storageState) {
    if (!fs.existsSync(cfg.storageState)) warn(`No session at ${cfg.storageState}: run \`node login.mjs\` if the routes need sign-in`);
    else {
      const st = JSON.parse(fs.readFileSync(cfg.storageState, 'utf8'));
      const now = Date.now() / 1000;
      const expired = st.cookies.filter((c) => c.expires > 0 && c.expires < now).map((c) => c.name);
      const want = cfg.auth.cookie && st.cookies.find((c) => c.name === cfg.auth.cookie);
      if (cfg.auth.cookie && !want) fail(`Session has no "${cfg.auth.cookie}" cookie: log in again`);
      else if (want && want.expires > 0 && want.expires < now) fail(`"${cfg.auth.cookie}" expired: log in again`);
      else ok(`Session ${cfg.storageState} (${st.cookies.length} cookies, ${st.origins.length} origin(s) of storage)`);
      if (expired.length) warn(`Expired cookies: ${expired.join(', ')}`);
      const host = new URL(cfg.baseUrl).origin;
      if (st.origins.length && !st.origins.some((o) => o.origin === host))
        warn(`localStorage was saved for ${st.origins.map((o) => o.origin).join(', ')}, not ${host}. Cookies cross ports; localStorage doesn't.`);
    }
  } else ok('No auth configured (public routes)');
}

console.log(bad ? `\n${bad} blocking problem(s).` : '\nReady.');
process.exit(bad ? 1 : 0);
