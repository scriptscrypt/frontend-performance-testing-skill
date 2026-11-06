# Rules for a first view that appears as the URL is entered

These rules are distilled from a production trading app (see `CASE-STUDY.md` in the skill's repository). Every rule cost
real seconds before it was written down. They are framework-agnostic. Where an example names Next.js or React,
the same idea applies elsewhere.

1. **No skeletons, spinners or fades on first paint.** Render the real layout with the last-known value (a
   persisted cache, the URL) or a neutral `—`, and fill in place. Entrance animations must not hide server HTML.
   *Measured: a login page had 41 elements at `opacity: 0` and painted at 2.1 s on a phone. Without them, 0.63 s.*

2. **Keep the shell static.** Anything that reads the clock, the URL, cookies or uncached I/O while rendering goes
   inside a streaming boundary whose fallback has the same layout. The rest is served from the edge as plain HTML.

3. **Never await data before the HTML.** Send the HTML, stream the data. Share one server fetch between the
   layout and the page instead of fetching twice.

4. **Keep heavy SDKs off the critical path.** Auth, wallet, chat and analytics SDKs load after hydration, behind a
   thin facade. Elsewhere, import only their types.
   *Measured: one value import of a wallet SDK put ~650 KB gzip back on the first load.*

5. **Code for what isn't on screen loads on intent.** Dialogs, editors, sheets and per-feature panels are split and
   preloaded on idle. Phone-only pieces are split too, or every desktop load downloads them. Barrels carry their
   heaviest member, so import heavy pieces from their own file. **Measure what the page waits on, not only bytes.**
   *Measured: a panel loaded on demand drew at 17–25 s on a cold phone load, queued behind a chart library. Shipped
   with the page (+35 KB), it drew at ~7.6 s. The right call was to raise the JS budget.*

6. **Anything a click opens is fetched before the click.** Prefetch on idle, under the exact cache key the panel
   reads. Persist small "opening" results. *Measured: search went from 1.0–2.5 s to rows ~70 ms after the click.*

7. **One request per screen of data, not one per row.** Batch by id or venue. A hook that fetches per row in a list
   is a bug. *Measured: 75 requests in 15 s became 9.*

8. **Name critical downloads in the HTML.** `preload` what the first screen draws (a chart library, the hero
   font). Don't preload what only some routes use.

9. **Don't rebuild what can switch. Start it before its data.** Mount a heavy widget once and switch its input
   rather than remounting it. Boot it hidden while data is still being chosen.
   *Measured: chart candles landed ~0.4 s after load instead of ~2.2 s.*
   An `<img>` without `loading="lazy"` in server HTML is preloaded. Keep eager only for the first view's hero.

10. **A service worker without caching is pure latency.** A fetch handler that only passes requests through
    cost ~250 ms of first paint on every warm load. Don't add one without measuring.

11. **Pages you leave may stay alive.** With route caching and back/forward restore, effects tear down and
    re-run. Anything holding an external object (a chart widget, a socket) must tolerate it being destroyed and
    recreated.

12. **Images ship as WebP or AVIF, sized for their box.** Remote images go through an optimizer at ~2× drawn size.
    *Measured: one 36 px header avatar was a 1.6 MB PNG. Optimizing the images took cold page weight from 13.8 MB
    to 9.5 MB.*

13. **Measure production, compare interleaved.** Dev-server timings mean nothing. Two sequential batches of the
    same code showed a 300–500 ms "regression" that interleaved A/B put at zero.

## Turning rules into budgets

Write the project's own contract (for example `docs/performance.md`): the budgets table per profile and mode, the
6 s ceiling, these rules, how to measure, and a dated "last measured" table. Every PR that touches a layout,
provider, shared data hook or the main screen reruns the harness and updates the table.
