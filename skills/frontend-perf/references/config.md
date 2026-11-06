# `perf.config.json`

All scripts read `perf.config.json` from their working directory (`tools/perf`), or the file given by `--config`.
Relative paths inside it (`out`, `auth.storageState`) resolve against the config file's folder.

```jsonc
{
  "baseUrl": "http://localhost:3100",   // the production server you measure
  "routes": ["/", "/pricing"],          // path + query, appended to baseUrl
  "profiles": ["desktop", "mobile"],    // see "Profiles"
  "modes": ["cold", "warm"],            // see methodology.md
  "runs": 3,                            // per route × profile × mode; the report shows medians
  "settleMs": 10000,                    // max wait after `load` for marks; a mark later than this is "missed"
  "apiPattern": "/api/",                // regex: which requests count as API calls in the summary
  "out": "runs",                        // output folder

  "auth": {                             // omit for public routes
    "storageState": ".auth/state.json", // where login.mjs saves the session (gitignored)
    "loginUrl": "http://localhost:3000/login",
    "cookie": "session"                 // a cookie that exists only when signed in; login.mjs waits for it
  },

  "marks": { /* see "Marks" */ },
  "budgets": { /* see "Budgets" */ },
  "profileDefs": { /* optional: override or add profiles */ }
}
```

## Marks

A mark is one piece of the first view that the user waits for. The harness checks every mark on every animation
frame from navigation start and records the first frame where it holds, in ms since navigation start.

```jsonc
"marks": {
  "headline": "h1",                                                   // shorthand: a selector
  "price":    { "selector": "[data-testid=price]", "text": "\\$\\s?[0-9]" },
  "cta":      { "selector": "button", "text": "^(buy|start)\\b" },
  "rows":     { "selector": "[data-testid=row]", "minCount": 10 },
  "allRows":  { "selector": "[data-testid=row-price]", "text": "\\$", "minCount": 50, "visible": false },
  "chart":    { "frame": "iframe#chart", "selector": "canvas", "minCount": 2, "onRoutes": ["^/trade"] },
  "custom":   { "js": "window.__appReady === true" }
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `selector` | — | CSS selector, matched with `querySelectorAll`. |
| `text` | — | Regex (case-insensitive unless `flags` is given) that the element's visible text must match. Use it to wait for real data (a `$` figure) rather than a placeholder (`—`, `…`). |
| `flags` | `"i"` | Regex flags for `text`. |
| `minCount` | `1` | How many matching elements must hold at once. |
| `visible` | `true` | Only elements a user could see: rendered, not `opacity: 0` or `visibility: hidden` on them or any ancestor, with a non-empty box that intersects the viewport. Set `false` for "N items are in the DOM" marks whose items are below the fold. |
| `frame` | — | Selector of a **same-origin** iframe to look inside. Cross-origin frames can't be read. Use a mark on the iframe element itself instead. |
| `onRoutes` | all | Regexes tested against `pathname + search`. The mark only applies (and only counts for the ceiling) on matching routes. |
| `js` | — | An expression evaluated in the page each frame. Use it as a last resort, and prefer a selector. Turns on `bypassCSP` for the context. |

Guidelines:

- 2–5 marks per route. Name them by what the user sees (`price`, not `div3`).
- A mark should wait for **content**, not containers: a header that shows `$—` while loading isn't "loaded". Add
  `text` that only real data matches.
- Marks are stamped in the frame where the DOM condition first holds, just before that frame paints. So a mark can
  read a few ms earlier than the FCP the browser reports for the same paint.
- Check marks with `probe` on every route and profile before trusting a run.

## Budgets

```jsonc
"budgets": {
  "ceilingMs": 6000,
  "metrics": {
    "fcp":   { "desktop.warm": 150, "desktop.cold": 300, "mobile.cold": 1000 },
    "price": { "desktop.*": 1000, "mobile.cold": 2500 },
    "jsKb":  { "*.cold": 630 },
    "cls":   { "*": 0.1 },
    "ttfb":  200
  }
}
```

- **`ceilingMs`** is the hard ceiling. In **every run** (not only the median), every applicable mark must have fired
  and must have fired by this time. FCP and LCP must too, when the browser reports them. A run that misses fails.
  `--ceiling <ms>` overrides it for one invocation.
- **`metrics`** are per-metric budgets checked against the **median** of a route × profile × mode group. The key is
  `<profile>.<mode>` with `*` wildcards; the most specific wins: `mobile.cold` → `mobile.*` → `*.cold` → `*`. A
  plain number applies everywhere.
- A metric is any mark name or any of: `ttfb`, `fcp`, `lcp`, `cls`, `tbt`, `jsKb`, `kb`, `requests`, `apiCalls`.

Failures make `measure` (and `report`) exit with code 1.

## Profiles

Built in:

| Profile | CPU | Network | Viewport |
| --- | --- | --- | --- |
| `desktop` | as is | as is | 1440 × 900 |
| `mobile` | 4× slower | Fast 4G: 9 Mbps down, 1.5 Mbps up, 60 ms RTT | 390 × 844, DPR 3, touch, `isMobile` |

Add or override profiles in `profileDefs`. `context` is passed to Playwright's `browser.newContext`, so you can
set `userAgent`, `locale` or `colorScheme` there:

```jsonc
"profileDefs": {
  "slow-mobile": {
    "cpu": 6,
    "net": { "downloadThroughput": 200000, "uploadThroughput": 50000, "latency": 150, "offline": false },
    "viewport": { "width": 360, "height": 800 },
    "context": { "isMobile": true, "hasTouch": true, "deviceScaleFactor": 2 }
  }
}
```

`downloadThroughput`/`uploadThroughput` are bytes per second, and `latency` is in ms.

## Command-line flags

Shared by every script: `--config <file>`, `--base <url>`, `--settle <ms>`, `--headed`, `--no-auth`.

| Script | Usage |
| --- | --- |
| `doctor` | `doctor` checks Node, Playwright, Chromium, the config, the server (and dev-server markers) and the session. |
| `login` | `login [--url <login url>]` |
| `probe` | `probe <route> [--profile desktop]` |
| `measure` | `measure [--routes a,b] [--profiles desktop,mobile] [--modes cold,warm] [--runs 3] [--ceiling 6000] [--no-video] [--no-trace] [--out dir]` |
| `report` | `report [runs/<timestamp>]` rebuilds `report.md`/`report.html`, with the latest run by default. |
| `ab` | `ab --a <url> --b <url> [--route /] [--runs 5] [--profile mobile] [--labels base,head] [--video]` |
| `waterfall` | `waterfall <route> [--from 0] [--to 6000] [--profile mobile] [--match regex]` |
| `requests` | `requests <route> [--match regex] [--for 15000] [--profile desktop]` |
| `initiators` | `initiators <route> --match <regex> [--for 15000]`. Point `--base` at the dev server for readable stacks. |

Via npm, put flags after `--`: `npm --prefix tools/perf run measure -- --runs 5`.
