// Shared pieces of the harness: config, CLI flags, device profiles, the in-page milestone watcher, one measured
// page load, and the filmstrip. Every other script imports from here.
import fs from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

// ---------------------------------------------------------------------------------------------------------------
// Config and flags

export const DEFAULT_PROFILES = {
  // The machine as it is: no throttling. Judge warm loads and regressions here.
  desktop: { cpu: 1, net: null, viewport: { height: 900, width: 1440 } },
  // A mid-range phone on good 4G (Lighthouse's "Fast 4G": 9 Mbps down, 1.5 up, 60 ms RTT) with a 4x slower CPU.
  // This is where the 6 s ceiling bites first.
  mobile: {
    context: { deviceScaleFactor: 3, hasTouch: true, isMobile: true },
    cpu: 4,
    net: { downloadThroughput: (9 * 1024 * 1024) / 8, latency: 60, offline: false, uploadThroughput: (1.5 * 1024 * 1024) / 8 },
    viewport: { height: 844, width: 390 },
  },
};

const DEFAULTS = {
  apiPattern: '/api/',
  auth: null,
  baseUrl: 'http://localhost:3100',
  budgets: { ceilingMs: 6000, metrics: {} },
  marks: {},
  modes: ['cold', 'warm'],
  out: 'runs',
  profiles: ['desktop', 'mobile'],
  routes: ['/'],
  runs: 3,
  settleMs: 10000,
};

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (key.startsWith('no-')) out[key.slice(3)] = false;
    else if (next == null || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const list = (v) => (Array.isArray(v) ? v : String(v).split(',').map((s) => s.trim()).filter(Boolean));

// A mark may be written as a bare selector string; normalize to the object form.
function normalizeMarks(marks) {
  return Object.fromEntries(Object.entries(marks ?? {}).map(([k, v]) => [k, typeof v === 'string' ? { selector: v } : v]));
}

export function loadConfig(args = {}) {
  const file = path.resolve(args.config ?? 'perf.config.json');
  if (args.config && !fs.existsSync(file)) throw new Error(`No config at ${file}`);
  const user = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const dir = path.dirname(file);
  const cfg = {
    ...DEFAULTS,
    ...user,
    budgets: { ...DEFAULTS.budgets, ...user.budgets },
    configFile: fs.existsSync(file) ? file : null,
    marks: normalizeMarks(user.marks),
    profileDefs: { ...DEFAULT_PROFILES, ...user.profileDefs },
  };
  if (args.base) cfg.baseUrl = args.base;
  if (args.routes) cfg.routes = list(args.routes);
  if (args.profiles) cfg.profiles = list(args.profiles);
  if (args.modes) cfg.modes = list(args.modes);
  if (args.runs) cfg.runs = Number(args.runs);
  if (args.settle) cfg.settleMs = Number(args.settle);
  if (args.ceiling) cfg.budgets.ceilingMs = Number(args.ceiling);
  if (args.out) cfg.out = args.out;
  cfg.routes = list(cfg.routes);
  cfg.profiles = list(cfg.profiles);
  cfg.modes = list(cfg.modes);
  cfg.out = path.resolve(dir, cfg.out);
  cfg.storageState = cfg.auth?.storageState ? path.resolve(dir, cfg.auth.storageState) : null;
  if (args.auth === false) cfg.storageState = null;
  cfg.headed = args.headed === true;
  return cfg;
}

export function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

export function slug(route) {
  return route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home';
}

export const median = (xs) => {
  const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
};

// ---------------------------------------------------------------------------------------------------------------
// The in-page watcher. Runs before any page script. Every animation frame it checks each mark that has not fired
// yet and stamps the first frame where it holds, in ms since navigation start. A mark counts only when a user
// could see it: rendered, not opacity 0 or visibility hidden (on itself or an ancestor), and inside the viewport.

export function watcherScript(marks) {
  return `(() => {
  if (window.top !== window) return;
  const SPECS = ${JSON.stringify(marks)};
  const marks = {};
  window.__perfMarks = marks;
  const here = () => location.pathname + location.search;
  const applies = (s) => !s.onRoutes || s.onRoutes.some((r) => new RegExp(r).test(here()));
  const shown = (el) => {
    if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    const v = el.ownerDocument.defaultView;
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < v.innerHeight && r.left < v.innerWidth;
  };
  const docFor = (s) => {
    if (!s.frame) return document;
    const f = document.querySelector(s.frame);
    try { return (f && f.contentDocument) || null; } catch { return null; }
  };
  const matches = (s) => {
    const doc = docFor(s);
    if (!doc) return { all: 0, shown: 0, text: 0, samples: [], frameMissing: true };
    let els = s.selector ? [...doc.querySelectorAll(s.selector)] : [];
    const all = els.length;
    if (s.visible !== false) els = els.filter(shown);
    const vis = els.length;
    const samples = els.slice(0, 3).map((e) => (e.innerText ?? e.textContent ?? '').trim().slice(0, 80));
    if (s.text) { const re = new RegExp(s.text, s.flags ?? 'i'); els = els.filter((e) => re.test((e.innerText ?? e.textContent ?? '').trim())); }
    return { all, shown: vis, text: els.length, samples };
  };
  const holds = (s) => {
    if (s.js) return !!(0, eval)(s.js);
    return matches(s).text >= (s.minCount ?? 1);
  };
  window.__perfApplicable = () => Object.keys(SPECS).filter((k) => applies(SPECS[k]));
  window.__perfPending = () => window.__perfApplicable().filter((k) => marks[k] == null);
  window.__perfExplain = (k) => (SPECS[k].js ? { js: true } : matches(SPECS[k]));
  const tick = () => {
    const now = performance.now();
    for (const [k, s] of Object.entries(SPECS)) {
      if (marks[k] != null || !applies(s)) continue;
      try { if (holds(s)) marks[k] = Math.round(now); } catch {}
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const vitals = (window.__perfVitals = { cls: 0, fcp: null, lcp: null, longTasks: [], errors: 0 });
  const observe = (type, fn) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true }); } catch {} };
  observe('largest-contentful-paint', (e) => { vitals.lcp = Math.round(e.startTime); });
  observe('paint', (e) => { if (e.name === 'first-contentful-paint') vitals.fcp = Math.round(e.startTime); });
  observe('layout-shift', (e) => { if (!e.hadRecentInput) vitals.cls += e.value; });
  observe('longtask', (e) => { vitals.longTasks.push([Math.round(e.startTime), Math.round(e.duration)]); });
  addEventListener('error', () => { vitals.errors++; });
})();`;
}

const usesJs = (marks) => Object.values(marks).some((m) => m.js);

// ---------------------------------------------------------------------------------------------------------------
// Pages

export async function launch(cfg) {
  const { chromium } = await import('playwright');
  return chromium.launch({ headless: !cfg.headed });
}

export async function throttle(cdp, profile) {
  if (profile.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
  if (profile.net) {
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', profile.net);
  }
}

export async function newContext(browser, cfg, profileName, extra = {}) {
  const profile = cfg.profileDefs[profileName];
  if (!profile) throw new Error(`Unknown profile "${profileName}". Known: ${Object.keys(cfg.profileDefs).join(', ')}`);
  const context = await browser.newContext({
    ...profile.context,
    bypassCSP: usesJs(cfg.marks),
    storageState: cfg.storageState && fs.existsSync(cfg.storageState) ? cfg.storageState : undefined,
    viewport: profile.viewport,
    ...extra,
  });
  await context.addInitScript(watcherScript(cfg.marks));
  return { context, profile };
}

// A throttled page for the single-purpose tools (probe, waterfall, requests, initiators).
export async function openPage(browser, cfg, profileName = 'desktop') {
  const { context, profile } = await newContext(browser, cfg, profileName);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await throttle(cdp, profile);
  return { cdp, context, page, profile };
}

// Wait until every applicable mark has fired (plus a short tail), or settleMs after load, whichever comes first.
export async function settle(page, settleMs, tailMs = 1500) {
  const until = Date.now() + settleMs;
  let doneAt = null;
  while (Date.now() < until) {
    const pending = await page.evaluate(() => window.__perfPending?.() ?? []).catch(() => []);
    if (!pending.length) {
      doneAt ??= Date.now();
      if (Date.now() - doneAt >= tailMs) return;
    } else doneAt = null;
    await page.waitForTimeout(100);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// One measured load

export async function measureOnce(browser, cfg, o) {
  const { baseUrl = cfg.baseUrl, dir, mode, profileName, route, run } = o;
  const record = { filmstrip: true, trace: true, video: true, ...o.record };
  fs.mkdirSync(dir, { recursive: true });
  const viewport = cfg.profileDefs[profileName]?.viewport;
  const { context, profile } = await newContext(browser, cfg, profileName, record.video ? { recordVideo: { dir, size: viewport } } : {});
  const url = baseUrl + route;

  if (mode === 'warm') {
    // Prime: one full visit in the same context fills the HTTP cache, service worker and any persisted app cache.
    const prime = await context.newPage();
    await prime.goto(url, { timeout: 120000, waitUntil: 'load' });
    await settle(prime, cfg.settleMs);
    const primeVideo = prime.video();
    await prime.close();
    await primeVideo?.delete().catch(() => {});
  }

  if (record.trace) await context.tracing.start({ screenshots: true, snapshots: false });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await throttle(cdp, profile);

  const requests = [];
  let failed = 0;
  page.on('requestfinished', async (req) => {
    const wall = Date.now();
    try {
      const sizes = await req.sizes();
      const res = await req.response();
      requests.push({ bytes: sizes.responseBodySize + sizes.responseHeadersSize, status: res?.status(), type: req.resourceType(), url: req.url(), wall });
    } catch {}
  });
  page.on('requestfailed', () => failed++);

  const frames = [];
  if (record.filmstrip) {
    cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
      frames.push({ data: Buffer.from(data, 'base64'), wall: metadata.timestamp * 1000 });
      try { await cdp.send('Page.screencastFrameAck', { sessionId }); } catch {}
    });
    await cdp.send('Page.startScreencast', { everyNthFrame: 1, format: 'jpeg', maxHeight: 900, maxWidth: 900, quality: 70 });
  }

  const response = await page.goto(url, { timeout: 120000, waitUntil: 'commit' });
  await page.waitForLoadState('load', { timeout: 120000 }).catch(() => {});
  await settle(page, cfg.settleMs);
  if (record.filmstrip) await cdp.send('Page.stopScreencast').catch(() => {});

  const r = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const v = window.__perfVitals;
    return {
      applicable: window.__perfApplicable(),
      cls: Number(v.cls.toFixed(3)),
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
      errors: v.errors,
      fcp: v.fcp,
      lcp: v.lcp,
      load: Math.round(nav.loadEventEnd),
      longTasks: v.longTasks,
      marks: { ...window.__perfMarks },
      tbt: v.longTasks.reduce((s, [, d]) => s + Math.max(0, d - 50), 0),
      timeOrigin: performance.timeOrigin,
      ttfb: Math.round(nav.responseStart),
    };
  });

  // Network totals. JS is what arrived before the load event, compressed, as sent over the wire.
  const loadWall = r.timeOrigin + r.load;
  const byType = {};
  for (const q of requests) {
    byType[q.type] ??= { bytes: 0, count: 0 };
    byType[q.type].bytes += q.bytes;
    byType[q.type].count += 1;
  }
  const jsBytes = requests.filter((q) => q.type === 'script' && q.wall <= loadWall + 50).reduce((s, q) => s + q.bytes, 0);
  const api = new RegExp(cfg.apiPattern);
  const apiUrls = requests.filter((q) => api.test(q.url)).map((q) => q.url.replace(baseUrl, '').slice(0, 140));

  // Ceiling: every applicable mark must land within ceilingMs, and a mark that never fired is a miss. FCP and LCP
  // count when the browser reported them (Chromium skips LCP in some cases, e.g. content that fades in).
  const ceilingMs = cfg.budgets.ceilingMs;
  const vitals = Object.entries({ fcp: r.fcp, lcp: r.lcp }).filter(([, t]) => t != null);
  const timed = { ...Object.fromEntries(vitals), ...Object.fromEntries(r.applicable.map((k) => [k, r.marks[k] ?? null])) };
  const missed = Object.entries(timed).filter(([, t]) => t == null).map(([k]) => k);
  const late = Object.entries(timed).filter(([, t]) => t != null && t > ceilingMs).map(([k, t]) => ({ mark: k, t }));
  const worst = Object.entries(timed).filter(([, t]) => t != null).sort((a, b) => b[1] - a[1])[0];

  let visual = { speedIndex: null, visuallyComplete: null };
  if (record.filmstrip && frames.length) {
    const aligned = frames.map((f) => ({ data: f.data, t: Math.max(0, Math.round(f.wall - r.timeOrigin)) })).sort((a, b) => a.t - b.t);
    visual = await filmstrip(aligned, {
      ceilingMs,
      dir,
      marks: { fcp: r.fcp, ...r.marks },
      title: `${route}  ·  ${profileName}  ·  ${mode}  ·  run ${run + 1}`,
      viewport: profile.viewport,
    });
  }

  if (record.trace) await context.tracing.stop({ path: path.join(dir, 'trace.zip') });
  await page.screenshot({ path: path.join(dir, 'final.png') }).catch(() => {});
  const video = page.video();
  await context.close();
  if (video) await video.saveAs(path.join(dir, 'video.webm')).then(() => video.delete()).catch(() => {});

  const summary = {
    route,
    profile: profileName,
    mode,
    run,
    baseUrl,
    finalUrl: page.url().replace(baseUrl, ''),
    status: response?.status() ?? null,
    headed: cfg.headed,
    ttfb: r.ttfb,
    fcp: r.fcp,
    lcp: r.lcp,
    cls: r.cls,
    tbt: r.tbt,
    domContentLoaded: r.domContentLoaded,
    load: r.load,
    marks: r.marks,
    applicable: r.applicable,
    ceiling: { limitMs: ceilingMs, late, missed, pass: !late.length && !missed.length, worst: worst ? { mark: worst[0], t: worst[1] } : null },
    speedIndex: visual.speedIndex,
    visuallyComplete: visual.visuallyComplete,
    jsKb: Math.round(jsBytes / 1024),
    kb: Math.round(requests.reduce((s, q) => s + q.bytes, 0) / 1024),
    requests: requests.length,
    failedRequests: failed,
    pageErrors: r.errors,
    longTasks: r.longTasks,
    byType,
    apiCalls: apiUrls.length,
    apiUrls,
    dir,
  };
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
  return summary;
}

// ---------------------------------------------------------------------------------------------------------------
// Filmstrip: one tile every 250 ms (500 ms on long loads), each labelled with its time and the marks that fired
// since the previous tile. Tiles past the ceiling get a red label. Also returns a Speed-Index-style score: how far
// each frame is from the final one, on a small greyscale thumbnail.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '"': '&quot;', '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

export async function filmstrip(frames, { ceilingMs, dir, marks, title, viewport }) {
  const thumb = async (buf) => sharp(buf).resize(64, 40, { fit: 'fill' }).greyscale().raw().toBuffer();
  const last = await thumb(frames.at(-1).data);
  const first = await thumb(frames[0].data);
  const diff = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0);
  const total = diff(first, last) || 1;
  let si = 0;
  let prevT = 0;
  let prevP = 0;
  let complete = null;
  for (const f of frames) {
    const p = 1 - diff(await thumb(f.data), last) / total;
    si += (f.t - prevT) * (1 - prevP);
    prevT = f.t;
    prevP = Math.max(0, Math.min(1, p));
    if (complete == null && prevP >= 0.98) complete = f.t;
  }

  const fired = Object.entries(marks).filter(([, t]) => typeof t === 'number');
  const lastMark = Math.max(1000, ...fired.map(([, t]) => t));
  const end = Math.min(Math.max(lastMark + 500, fired.length < Object.keys(marks).length ? ceilingMs + 500 : 0), 20000);
  let step = end <= 6500 ? 250 : 500;
  while (end / step > 36) step += 250;

  const portrait = viewport.height > viewport.width;
  const w = portrait ? 150 : 240;
  const h = Math.round((w * viewport.height) / viewport.width);
  const cols = portrait ? 10 : 6;
  const labelH = 34;
  const tiles = [];
  for (let t = 0, prev = -1; t <= end; prev = t, t += step) {
    const f = [...frames].reverse().find((x) => x.t <= t) ?? null;
    const now = fired.filter(([, mt]) => mt > prev && mt <= t).map(([k]) => k);
    const over = t > ceilingMs;
    const img = f
      ? await sharp(f.data).resize(w, h, { background: '#000', fit: 'contain' }).png().toBuffer()
      : await sharp({ create: { background: '#fff', channels: 3, height: h, width: w } }).png().toBuffer();
    const label = Buffer.from(
      `<svg width="${w}" height="${labelH}" xmlns="http://www.w3.org/2000/svg">` +
        `<rect width="${w}" height="${labelH}" fill="${over ? '#7f1d1d' : '#111827'}"/>` +
        `<text x="6" y="14" font-size="12" fill="#fff" font-family="monospace">${t} ms${over ? '  over' : ''}</text>` +
        `<text x="6" y="28" font-size="11" fill="#4ade80" font-family="monospace">${esc(now.join(' · ').slice(0, Math.floor(w / 6.6)))}</text>` +
        `</svg>`,
    );
    tiles.push({ img, label });
  }
  const gap = 4;
  const headH = 30;
  const rows = Math.ceil(tiles.length / cols);
  const W = cols * (w + gap) + gap;
  const H = headH + rows * (h + labelH + gap) + gap;
  const head = Buffer.from(
    `<svg width="${W}" height="${headH}" xmlns="http://www.w3.org/2000/svg"><text x="${gap + 2}" y="20" font-size="15" fill="#e5e7eb" font-family="monospace">${esc(title)}   ·   ceiling ${ceilingMs} ms</text></svg>`,
  );
  const layers = [{ input: head, left: 0, top: 0 }];
  tiles.forEach((tile, i) => {
    const left = gap + (i % cols) * (w + gap);
    const top = headH + Math.floor(i / cols) * (h + labelH + gap);
    layers.push({ input: tile.label, left, top }, { input: tile.img, left, top: top + labelH });
  });
  await sharp({ create: { background: '#0b0f17', channels: 3, height: H, width: W } }).composite(layers).png().toFile(path.join(dir, 'filmstrip.png'));
  return { speedIndex: Math.round(si), visuallyComplete: complete };
}
