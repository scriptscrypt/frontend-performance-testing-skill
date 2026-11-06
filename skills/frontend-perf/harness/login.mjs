// The one step a human does: opens a visible browser on the app's login page; you sign in by hand and the
// session (cookies + localStorage) is saved to auth.storageState from the config. The agent never sees your
// password. The file is a live credential — it is gitignored; never commit, paste or upload it.
//
//   node login.mjs [--url http://localhost:3000/login]
//
// Done when the configured cookie exists (auth.cookie) and the page has left the login URL, or when you press
// Enter in this terminal.
import fs from 'node:fs';
import path from 'node:path';

import { chromium } from 'playwright';

import { loadConfig, parseArgs } from './lib.mjs';

const args = parseArgs();
const cfg = loadConfig(args);
if (!cfg.storageState) throw new Error('Set auth.storageState in perf.config.json (e.g. ".auth/state.json").');
const url = args.url ?? cfg.auth.loginUrl ?? `${cfg.baseUrl}/login`;
const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({ viewport: { height: 900, width: 1440 } });
const page = await ctx.newPage();
await page.goto(url);
console.log(`Log in in the browser window (${url}). Press Enter here when you're done.`);

let entered = false;
process.stdin.once('data', () => (entered = true));
const loginPath = new URL(url).pathname;
while (!entered) {
  if (cfg.auth.cookie) {
    const cookies = await ctx.cookies();
    if (cookies.some((c) => c.name === cfg.auth.cookie && c.value) && new URL(page.url()).pathname !== loginPath) break;
  }
  await page.waitForTimeout(1000);
}
await page.waitForTimeout(3000); // let the app write its own storage after the redirect
fs.mkdirSync(path.dirname(cfg.storageState), { recursive: true });
await ctx.storageState({ path: cfg.storageState });
console.log(`Saved session to ${cfg.storageState} (from ${page.url()}).`);
await browser.close();
process.exit(0);
