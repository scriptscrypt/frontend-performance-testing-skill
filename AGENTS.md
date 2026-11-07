# Agent instructions

This repo is a frontend performance-testing skill. To measure a web app's page load, follow
[`skills/frontend-perf/SKILL.md`](skills/frontend-perf/SKILL.md). Its `references/` folder and `harness/` sit next to it.

To try it here, the demo shop in `examples/demo-shop/` serves a slow and a fast build of the same page
(`node examples/demo-shop/server.mjs --variant slow --port 4100`, and `--variant fast --port 4200`) with a ready
config in `examples/demo-shop/perf.config.json`.
