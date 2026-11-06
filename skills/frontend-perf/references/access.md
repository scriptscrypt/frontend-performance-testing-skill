# What access to give the agent

Give the least that does the job. Each level includes the one above it.

| Level | The agent can | Needs | Never needs |
| --- | --- | --- | --- |
| **0 · Read results** | Explain an existing `runs/` folder, filmstrips and reports | Read files | Shell |
| **1 · Measure** | Install the harness, build, serve on a free port, run every harness script, read filmstrips | Shell: `npm`/`pnpm` build and start, `npm --prefix tools/perf run …`. Write to `tools/perf/` | Your passwords, your running dev server, push rights |
| **2 · Fix** | Change app code, rebuild, re-measure | Edit/Write in the app's source | Push rights. Leave commit and push to the user or ask. |
| **3 · Compare builds** | Build a baseline in a git worktree and run interleaved A/B | `git worktree add/remove`, a second port | Anything outside the repo and its sibling worktree |

**The human step:** signing in. The agent asks you to run `login` in a visible browser, and you type your
credentials there. The agent never sees them. The saved session (`tools/perf/.auth/state.json`) is a live
credential. Deny reads of it, keep it gitignored, and use a test account where you can.

**Network:** the harness downloads Chromium once (`npx playwright install chromium`, ~150 MB), then talks only to
the servers in your config. Nothing is uploaded anywhere.

## Permissions template (Claude Code)

Put this in the project's `.claude/settings.json` (shared) or `.claude/settings.local.json` (just you) and adjust
the build commands to your project. Rules are prefix matches. `deny` beats `allow`.

```json
{
  "permissions": {
    "allow": [
      "Bash(npm --prefix tools/perf run:*)",
      "Bash(npm --prefix tools/perf install)",
      "Bash(npx playwright show-trace:*)",
      "Bash(pnpm build:*)",
      "Bash(pnpm --filter:*)",
      "Bash(npx next start:*)",
      "Bash(npx vite preview:*)",
      "Bash(git worktree add:*)",
      "Bash(git worktree remove:*)",
      "Bash(lsof -i:*)",
      "Read(./tools/perf/runs/**)"
    ],
    "deny": [
      "Read(./tools/perf/.auth/**)",
      "Bash(git push:*)",
      "Bash(git commit:*)"
    ]
  }
}
```

Drop the `git commit` deny if you want the agent to commit the harness and its numbers. Leave out the worktree rules
if you don't want level 3.
