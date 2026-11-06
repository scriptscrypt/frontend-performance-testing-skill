---
name: frontend-perf
description: End-to-end frontend load performance testing with filmstrips. Use when the user wants to measure, test, benchmark, audit, profile or speed up a web app's page load, check performance budgets or a time-to-first-view ceiling, compare two builds (before/after, A/B, regression check), find out why a page or a part of it shows up late, or set up a performance harness or CI gate. Drives Chromium with Playwright against a production build, in desktop and throttled-mobile profiles, cold and warm. Records when each part of the first view becomes visible ("marks"), web vitals, network weight, a filmstrip, video and trace per run. Checks budgets and a hard 6-second ceiling, and compares builds with interleaved runs.
---

# Frontend performance, end to end

You run the whole performance test: set up the harness, build and serve the app, define what "loaded" means,
measure, read the filmstrips, find the cause, fix it if asked, prove the fix with an interleaved A/B, and report.
The user does one thing by hand: signing in, if the app needs it.

The harness lives in `harness/` next to this file (this skill's base directory). It is plain Node + Playwright
and works with any framework that serves HTML to Chromium.

## What success looks like

- Every number comes from a **production build**, **headless**, **median of ≥ 3 runs**.
- Every **mark** (a piece of the first view the user waits for) fires on every route and profile, and lands within
  the **ceiling: 6000 ms by default, mobile cold (4x CPU, Fast 4G) included**. A mark that never appears is a failure.
- Before/after claims come from **interleaved A/B** runs, and you only call a difference real when the verdict
  says `clear`.
- The user gets a table, filmstrips and what changed, with the caveats stated.

## Non-negotiables

1. **Never measure a dev server.** Dev compiles on demand, ships unminified code and runs extra checks. Its
   timings mean nothing. `doctor` fails when it sees dev-server markers. Dev is fine for `initiators` (readable stacks).
2. **Never stop, restart or replace a server the user is running.** Serve your production build on a separate
   free port (default 3100, and 3200 for a baseline). Their open tabs depend on theirs.
3. **Never handle credentials.** Sign-in goes through `login.mjs` in a visible browser, done by the user. The saved
   session file (`.auth/state.json`) is a live credential: don't read it, print it, commit it or upload it.
4. **Headless for numbers.** `--headed` is for watching (and demos). The report flags headed runs as not quotable.
5. **Interleave comparisons.** Backend latency and machine load drift by hundreds of ms over minutes. Two
   sequential batches can show a "regression" that interleaved runs put at zero. Use `ab.mjs`, never two
   separate `measure` runs, to compare builds.
6. **One change per A/B.** Several fixes at once can't be attributed.
7. **Report what happened.** Misses, noisy runs, budgets you couldn't meet, steps you skipped. Don't round a
   "within noise" up to a win.
8. **Don't hide slowness.** Skeletons, spinners and fade-ins don't make a page faster. A mark only counts when the
   real content is visible, and that's deliberate. See `references/rules.md`.

## Workflow

Run commands from the project root with `npm --prefix tools/perf run <script> -- <flags>`. The scripts run
inside `tools/perf`, so config and output paths are relative to it.

### 1. Scope (ask once, before building anything)

Find out, from the repo first and the user second:

- **Routes** to test, and **which build** (current branch, a PR, two commits to compare).
- **What the first view is** on each route: the 2–5 things a user waits for (headline, price, main CTA, chart,
  list rows, the signed-in balance). These become marks.
- **Sign-in**: are any routes behind it? Which login URL? Which cookie proves a session?
- **Build and start commands**, and a free port (see `references/frameworks.md`).
- **Budgets**: keep the 6 s ceiling unless told otherwise. Per-mark budgets are optional. Start from
  `perf.config.example.json` and tighten later.
- **Scope of action**: measure only, or also fix? Don't edit app code unless asked.

Ask in one go, with concrete options. Then proceed without further check-ins until you have numbers.

### 2. Install the harness

```bash
cp -R <skill-base>/harness tools/perf          # skip if tools/perf already has this harness
cp tools/perf/perf.config.example.json tools/perf/perf.config.json
npm --prefix tools/perf run setup              # playwright + sharp + Chromium (~150 MB, once per machine)
```

It is standalone. If the repo's workspace globs (`pnpm-workspace.yaml`, `workspaces` in package.json) would pick
up `tools/*`, exclude `tools/perf` so it doesn't join the app's install. Its `.gitignore` already covers
`node_modules/`, `runs/` and `.auth/`. Commit the harness and config so the team can rerun them.

### 3. Build and serve production

Build, then start the server **in the background** on the chosen port (`references/frameworks.md` has the
commands per framework). Then:

```bash
npm --prefix tools/perf run doctor
```

Fix everything it marks ✗ before you measure.

### 4. Sign in (only if routes need it), done by the user

Set `auth` in the config (`storageState`, `loginUrl`, `cookie`), then ask the user to run it themselves. In Claude
Code they can type it with the `!` prefix so it runs in the session:

```
! npm --prefix tools/perf run login
```

A browser opens and they sign in. The session is saved when the cookie appears, or when they press Enter. Cookies are shared
across ports on localhost, but localStorage is per origin. If the app keeps its session in localStorage, sign in on
the same origin you measure. `doctor` warns about the mismatch. Rerun `doctor` to confirm the session.

### 5. Define and verify the marks

Write marks in `perf.config.json` (schema: `references/config.md`). Then check each route on both profiles:

```bash
npm --prefix tools/perf run probe -- /pricing
npm --prefix tools/perf run probe -- /pricing --profile mobile
```

Every applicable mark must show ✓. For each ✗, `probe` says why: no match (selector), hidden or off screen
(visibility), or text mismatch. Fix the **definition**, not the app. Prefer stable hooks (`data-testid`, roles,
landmarks) over styling classes. Use `onRoutes` for marks that only exist on some routes. Use `"visible": false`
only for "all N loaded" marks whose items are below the fold.

### 6. Baseline

```bash
npm --prefix tools/perf run measure                  # all routes × desktop, mobile × cold, warm × 3 runs
npm --prefix tools/perf run measure -- --routes /pricing --profiles mobile --modes cold --runs 5
```

It prints one line per run, then the report table, and writes `tools/perf/runs/<timestamp>/` with
`report.md`, `report.html` and, per run, `summary.json`, `filmstrip.png`, `video.webm`, `trace.zip` and `final.png`.
The exit code is 1 when a budget or the ceiling fails.

**Look at the filmstrips.** Open `filmstrip.png` of the median run (linked from `report.html`) with your file
reading tool. You can see images. Every tile shows the time and the marks that fired since the previous tile. Red
tiles are past the ceiling. Describe what the user sees: how long the screen stays blank, when a spinner shows,
what appears in what order, what jumps.

### 7. Diagnose

Go from the slowest mark backwards. `references/diagnosis.md` maps symptoms to tools and causes. The usual moves:

```bash
npm --prefix tools/perf run waterfall -- /pricing --profile mobile --to 6000   # what finished just before each mark
npm --prefix tools/perf run requests -- /pricing --match /api/                 # request storms, duplicate fetches
npm --prefix tools/perf run initiators -- /pricing --match /api/price --base http://localhost:3000  # who fired them (dev server)
npx playwright show-trace tools/perf/runs/<ts>/<run>/trace.zip                 # main thread, network, screenshots
```

Also read `summary.json`: `longTasks`, `tbt`, `byType`, `jsKb`, `apiUrls`, `failedRequests` and `pageErrors`.
Name the cause with evidence (a request, a long task, a chunk, a selector), not a guess.

### 8. Fix (only if asked)

Apply one change, guided by `references/rules.md`. Rebuild. Then go to step 9.

### 9. Prove it: interleaved A/B

Serve the **baseline** build on another port: build it in a git worktree (`git worktree add ../app-base <base-ref>`),
then install, build and start it on 3200. Then run:

```bash
npm --prefix tools/perf run ab -- --a http://localhost:3200 --b http://localhost:3100 --labels base,head --route /pricing --profile mobile --runs 5
```

Read the verdict column. `clear` means every B run beat every A run (or the reverse). `within noise` means you
can't claim it. Use 5+ runs for real decisions, and go up to 9 when runs vary a lot. Check the B filmstrips: a faster mark
with a worse-looking page (blank areas, jumps) is not a win.

### 10. Report

Give the user, or put in the PR:

- The command lines, build refs, machine and profile, and the date.
- The median table (from `report.md`, or `ab.md` for comparisons), with failures and ceiling misses called out.
- One or two filmstrips: the representative slow one and, after a fix, the new one.
- The cause and the fix in a sentence each, with the evidence.
- Caveats: localhost has no network distance to the server, live data varies, and lab numbers are not field data.

If the project keeps a performance doc (for example `docs/performance.md`), add the new numbers there with the date
and commit. If it doesn't, offer to start one from `references/rules.md` plus the budgets.

### Clean up

Stop only the servers and worktrees **you** started. Leave `runs/`; it is gitignored and useful for later comparisons.

## CI (optional)

`measure` exits 1 on failure, so a job can build, start, then run
`npm --prefix tools/perf run measure -- --modes cold --runs 3 --no-video --no-trace`. CI machines are noisy:
gate on the ceiling and generous budgets, and use interleaved A/B on a quiet machine for fine comparisons.

## Reference files

- `references/config.md`: `perf.config.json`, the mark definition, budgets, profiles and every CLI flag.
- `references/methodology.md`: cold vs warm, profiles, headless vs headed, noise, the ceiling, and what each output means.
- `references/diagnosis.md`: symptom → tool → likely cause → fix.
- `references/rules.md`: rules that keep a first view fast, framework-agnostic, with measured examples.
- `references/frameworks.md`: production build and serve commands, and bundle inspection per framework.
- `references/access.md`: what access the agent needs at each level, and a permissions template.
