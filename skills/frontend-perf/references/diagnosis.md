# Diagnosis: from a late mark to its cause

Start from the **slowest mark on the slowest profile** and work backwards. For each symptom: what you see, how to
confirm it, the usual cause, and the usual fix.

## Read the filmstrip first

| What the tiles show | Usually means | Confirm with |
| --- | --- | --- |
| White for a long time, then everything at once | Render-blocking JS/CSS in `<head>`, or a client-rendered app with an empty HTML shell | `waterfall --to <first paint>`: a script or stylesheet ending just before FCP. Check whether `final.png`'s text exists in the server HTML (`curl`). |
| A spinner or skeleton, then content | Data fetched after JS runs: a request waterfall | `waterfall`: the API call starts only after the bundle finishes |
| The layout appears, values arrive one by one | One request per row or widget | `requests --match /api/`: dozens of the same path |
| Content is there in the DOM, but the tile is blank | Entrance animation or `opacity: 0` until hydration | A mark with `"visible": false` fires much earlier than the visible one |
| Content appears, then jumps | Late fonts, images without size, injected banners | `cls` in `summary.json`. Watch `video.webm`. |
| Fine on desktop, slow only on mobile | CPU-bound: big bundles, long tasks, hydration | `tbt`/`longTasks` in `summary.json`. Look at the trace's main thread. |
| Cold slow, warm fast | Bundle weight or uncached data | `jsKb`, `byType.script`. Check whether data is persisted between visits. |
| Warm as slow as cold | Nothing is reused: no-store headers, cache-busting URLs, app caches not persisted | `byType` transfer sizes on warm. Check response `cache-control`. |
| One mark late, others fine | That piece waits on something specific: its chunk, its data, its third-party script | `waterfall` around the mark, then `initiators` on its request |
| Mark never fires | Broken definition, error, or an auth redirect | `probe`; `final.png`; `finalUrl`, `pageErrors` and `failedRequests` in `summary.json` |

## Tools

- **`waterfall <route> --to <ms>`** lists every request that finished in a window, with the marks drawn in between.
  The requests ending just before a mark are its candidates. The "wait" column (time to first byte) separates slow
  servers from big downloads.
- **`requests <route> --match <regex>`** counts by path and status over 15 s. It finds per-row fetching, polling
  that never stops, duplicates and 4xx/5xx storms.
- **`initiators <route> --match <regex> --base <dev server>`** shows the JS stack that issued each request. Run it
  against the **dev** server so file and function names are readable. Its timings don't matter here.
- **Trace** (`npx playwright show-trace trace.zip`): the main-thread long tasks, network timing and screenshots
  side by side.
- **`summary.json`**: `longTasks` (when and how long), `byType` (what the bytes are), `jsKb` (critical JS),
  `apiUrls` (what the page asked for, in order).

## Causes and fixes

| Cause | Fix |
| --- | --- |
| Empty HTML shell, content rendered on the client | Server-render (or prerender) the first view. Send static parts as HTML. Stream data parts with a fallback that has the same layout. |
| Data awaited before HTML is sent | Send the HTML first and stream the data, or start the fetch on the server and hand the promise to the client. |
| Request waterfall (JS → data → more JS → data) | Start data fetches in parallel with code: preload, server fetch, or route loaders. Preload the next chunk that a choice will need. |
| One request per row | A batch endpoint, one request per screen |
| Big entry bundle | Code-split what isn't on the first screen (dialogs, editors, below-the-fold panels, desktop-only and phone-only pieces). Check that barrels (`export *`) don't pull heavy modules into the entry. |
| Heavy third-party SDK on the critical path (auth, wallet, analytics, chat widgets) | Load it after hydration or on intent, behind a thin facade. Import only types elsewhere. |
| Long tasks during load | Split work (yield to the main thread), defer non-critical init until idle, move parsing to a worker, and avoid synchronous JSON or data transforms of big payloads at startup. |
| Fade-ins and skeletons hiding ready content | Render real layout with last-known or placeholder values, and no entrance animation on first paint |
| Late images or LCP | Size images to their box, use modern formats (WebP/AVIF), and set `fetchpriority="high"` on the hero only. Lazy-load everything below the fold. |
| Fonts blocking text | `font-display: swap`/`optional`. Preload only the fonts every route uses. |
| Click-to-open panels that fetch on open | Prefetch on idle or hover, under the same cache key the panel reads |
| Slow backend (high "wait" in the waterfall) | Not a frontend fix. Report it with the numbers: endpoint, TTFB and region. Persist the last value on the client so warm visits paint instantly. |
| Cross-origin API: an `OPTIONS` preflight before every new URL | Ask the backend for `Access-Control-Max-Age`, or proxy through the same origin |
| Service worker in front of every request | Measure with and without it. A fetch handler that adds no caching is pure latency. |

After each fix: rebuild and run an interleaved `ab` against the previous build. Report the verdict, not the hope.
