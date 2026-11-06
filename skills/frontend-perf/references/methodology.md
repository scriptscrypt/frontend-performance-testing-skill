# Methodology: what is measured, and how to trust it

## One measured load

```
 new browser context (cold) ─┐
   or prime visit + settle ──┤ (warm)
                             ▼
 new page → CPU/network throttle → screencast on → goto(route) ───────────────► load ── settle ──► collect
                                     │                                                      │
                                     └─ every animation frame: check each mark ─────────────┘
```

1. **Context.** A fresh Playwright browser context: empty HTTP cache, no service worker, no storage except the
   saved session (if any).
2. **Warm only:** a prime visit in that context loads the route fully, waits for the marks, and closes. This fills
   the HTTP cache, the service worker and any persisted app cache (React Query persist, IndexedDB…). Then a new
   page in the same context is measured.
3. **Throttle** through Chrome DevTools Protocol: `Emulation.setCPUThrottlingRate` and
   `Network.emulateNetworkConditions`.
4. **Record**: a CDP screencast (every changed frame, timestamped), a Playwright trace with screenshots, and a video.
5. **Navigate**, wait for `load`, then **settle**: wait until every applicable mark has fired plus 1.5 s, or until
   `settleMs` has passed since `load`, whichever comes first.
6. **Collect**: marks, Navigation Timing, paint/LCP/CLS/long-task observers, every finished request with its
   transfer size, then build the filmstrip.

## Cold vs warm

| | Cold | Warm |
| --- | --- | --- |
| Models | A first visit, or a visit after a deploy (new hashed assets) | A returning visitor on the same build |
| Cache | Empty | HTTP cache, service worker and app persistence all primed |
| Judge it by | JS weight, critical requests, server-rendered HTML | Whether the app paints from cache before the network answers |
| Typical trap | A big entry bundle, request waterfalls | Ignoring persisted data and showing a spinner anyway |

## Profiles

`desktop` is the machine as it is. Use it for warm loads and for spotting regressions. `mobile` is 4× slower CPU
plus Fast 4G (9 Mbps, 60 ms RTT), close to Lighthouse's mobile preset and a typical mid-range phone. JavaScript
cost shows up here: a 300 ms task on desktop is 1.2 s on this profile. **The 6 s ceiling is usually decided by
mobile cold.**

Throttling applies to the page's own target. Out-of-process iframes (cross-origin frames) are not throttled.

## The 6 s ceiling

A single, blunt promise: on the slowest profile we test, a first-time visitor sees every part of the first view
within 6 seconds. It complements per-mark budgets:

- **Budgets** are aspirations, checked against medians, and different per profile.
- **The ceiling** is a floor under the worst case, checked against **every run**. One run that misses it fails.
- A mark that **never appears** within `settleMs` is a miss and fails the ceiling. Broken loading is the worst
  kind of slow.

Change it with `budgets.ceilingMs` or `--ceiling`. Don't raise it to make a failure pass. Report the failure.

## Headless vs headed

Headless Chromium (`chromium-headless-shell`) is the measuring instrument: no window focus, OS compositor or
user-installed extensions to add noise. Run `--headed` to **watch** a load: to debug a mark, or to record a demo.
Headed timings run slightly differently (a real compositor, GPU, a window you might be covering), so the report
marks them as not for quoting.

## Noise, and why A/B is interleaved

Sources of noise: backend latency (the biggest by far on signed-in apps), live data changing what renders, other
processes on the machine, thermal throttling, and the cache state of the server itself.

- Take **medians** of 3+ runs. Look at the spread as well. If runs differ by more than the effect you care about,
  add runs.
- **Interleave** comparisons: `ab.mjs` alternates A,B,B,A,A,B… so drift hits both sides equally. Two sequential
  `measure` batches 20 minutes apart can show a 300–500 ms "regression" that disappears when interleaved.
- `ab` calls a difference **clear** only when the two sides' runs don't overlap at all. That's strict on purpose,
  and with 5 runs a side it's a strong signal. When it says `within noise`, the honest statement is "no measurable
  difference".
- Localhost has ~0 ms to the server. Real users pay network round trips to it, so cold numbers in production are
  worse. Lab numbers rank changes; field data (RUM) tells you what users get.

## Outputs

Per run (`runs/<timestamp>/<route>__<profile>__<mode>__<n>/`):

| File | What it is | Use it to |
| --- | --- | --- |
| `summary.json` | Every number for the run (below) | Diagnose and compare |
| `filmstrip.png` | One tile per 250 ms (500 ms on long loads), each with its time and the marks fired since the previous tile. Tiles past the ceiling are red. | See what the user saw |
| `video.webm` | The measured page load | Show people, spot flicker and jumps |
| `trace.zip` | Playwright trace: network, console, screenshots | `npx playwright show-trace trace.zip` |
| `final.png` | Screenshot at the end | Check that the page actually loaded (not an error or login wall) |

Per run directory: `results.json` (all summaries), `report.md`, `report.html`. `runs/LATEST` points to the newest.

`summary.json` fields:

| Field | Meaning |
| --- | --- |
| `ttfb` | Navigation response start, ms |
| `fcp`, `lcp` | First / Largest Contentful Paint, ms. LCP can be `null`. Chromium doesn't report it in some cases, such as content that fades in. |
| `cls` | Cumulative Layout Shift (unitless) |
| `tbt` | Total Blocking Time: the sum of each long task's time over 50 ms |
| `longTasks` | `[start, duration]` of every task ≥ 50 ms |
| `marks` | `{ name: ms }` for marks that fired |
| `applicable` | Marks that apply to this route (after `onRoutes`) |
| `ceiling` | `{ limitMs, pass, late: [{mark, t}], missed: [...], worst }` |
| `speedIndex`, `visuallyComplete` | From the filmstrip: how fast the page converged to its final look, and when it got within 2% of it. Pages that never stop changing (live prices, carousels) overstate both. Prefer marks. |
| `jsKb` | Compressed bytes of scripts that finished before `load`: what the first view had to download |
| `kb`, `requests`, `byType` | All transfers, total and by resource type |
| `apiCalls`, `apiUrls` | Requests matching `apiPattern` |
| `failedRequests`, `pageErrors` | Requests that failed, and uncaught errors |
| `finalUrl`, `status` | Where the page ended up. Check this: a redirect to `/login` means the session is missing. |
