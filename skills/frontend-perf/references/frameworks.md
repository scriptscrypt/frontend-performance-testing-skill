# Production build and serve, per framework

Serve on a port the user isn't using (3100 for the build under test, 3200 for a baseline). Start servers in the
background and stop only the ones you started. Check the project's `package.json` scripts first. They often wrap
these commands with the right env and filters.

| Framework | Build | Serve production on 3100 |
| --- | --- | --- |
| Next.js | `next build` | `next start -p 3100` |
| Vite (React, Vue, Svelte, Solid) | `vite build` | `vite preview --port 3100 --strictPort` |
| Create React App | `react-scripts build` | `npx serve -s build -l 3100` |
| Remix / React Router 7 | `react-router build` (or `remix build`) | `PORT=3100 react-router-serve ./build/server/index.js` (or `remix-serve`) |
| SvelteKit (adapter-node) | `vite build` | `PORT=3100 node build` |
| Nuxt | `nuxi build` | `PORT=3100 node .output/server/index.mjs` |
| Astro (static) | `astro build` | `astro preview --port 3100` |
| Angular | `ng build` | `npx serve -s dist/<app>/browser -l 3100` |
| Any static output | your build | `npx serve -s <dir> -l 3100` |

In a monorepo, build only the app (`pnpm --filter <app> build`, `turbo run build --filter <app>`).

Environment: production builds read production env files (`.env.production`). If the app talks to a backend, use
the same backend for both sides of an A/B.

Auth on another port: providers that allow-list origins (OAuth, embedded wallets, some auth SaaS) may reject
`localhost:3100`. If they do, sign in on the dev port (cookies are shared across ports on the same host), use a port
the provider already allows, or ask the user to add the origin.

## Bundle weight

`jsKb` in every run is framework-agnostic: compressed bytes of scripts that finished before `load`. For "what is
in it":

| Framework | Inspect |
| --- | --- |
| Next.js | `next build` prints First Load JS per route. Use `@next/bundle-analyzer`, or read `.next/server/app/<route>_client-reference-manifest.js` for the entry chunks. |
| Vite / Rollup | `rollup-plugin-visualizer` (`npx vite-bundle-visualizer`) |
| webpack | `webpack-bundle-analyzer`, `source-map-explorer` |
| Any | `npx source-map-explorer 'dist/**/*.js'` when source maps are emitted |

## Baseline in a worktree

```bash
git worktree add ../<app>-base <base-ref>
cd ../<app>-base && <install> && <build> && <serve on 3200> &
# … run ab.mjs …
git worktree remove ../<app>-base        # when done, and only the worktree you created
```
