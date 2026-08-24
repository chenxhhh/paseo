---
name: run
description: Launch the Paseo web app against this worktree's dev daemon on Windows and verify a change live. Use when asked to run or start the app, spin up a web service to test, or see a change working in the real app.
user-invocable: true
---

# Run the app (Windows worktree web test)

Verified end-to-end on 2026-08-24. Run everything from the worktree root in Git Bash.

## Hard facts

- An agent session inherits the production env (`PASEO_HOME=~/.paseo`, `PASEO_LISTEN=127.0.0.1:6767`). Every dev command must override both explicitly, or the dev daemon hits the production home's single-instance lock with an error that never mentions env.
- Port 6767 is the live daemon managing running agents. Never touch it.
- On this machine Paseo's service terminals land in cmd.exe, so the POSIX service commands in `paseo.json` (`VAR=1` prefixes, `$VAR`, `./scripts/*.sh`) all fail with "'VAR' is not recognized". Do not start the daemon/app via `start_workspace_script`; run the scripts manually in Bash.
- Check ports with `netstat -ano | grep LISTENING | grep ":<port> "` before starting. 6768 has been taken by the user's browser (Orca). When the occupant is a user application, pick another port — never kill it.

## Start the daemon

```bash
env PASEO_HOME="$PWD/.dev/paseo-home" PASEO_LISTEN="127.0.0.1:6790" \
  PASEO_DEV_SEED_HOME="$HOME/.paseo" \
  npm run dev:server:raw
```

- Use `dev:server:raw`, not `dev:server:watch`: under a background shell with no TTY, `watch:protocol` (tsc --watch) exits with no error message and `--kill-others` kills the whole tree — the daemon vanishes minutes later, health stops responding.
- `PASEO_DEV_SEED_HOME` seeds the worktree home with real project/agent JSON metadata from `~/.paseo`, so the sidebar renders the real project hierarchy with no fixture setup. A few seeded files copy as NUL bytes; the daemon skips them — harmless.
- A cold worktree needs `npm run build:server` first or the daemon dies on missing workspace `dist`.
- Wait for readiness: `curl http://localhost:6790/api/health`.

## Start Metro

```bash
env PASEO_HOME="$PWD/.dev/paseo-home" PASEO_LISTEN="127.0.0.1:6790" \
  PASEO_DEV_DAEMON_ENDPOINT="localhost:6790" EXPO_PORT=19010 \
  bash scripts/dev-app.sh
```

- 8081 is usually taken; pick a free port (19010 worked).
- If the daemon port ever changes, `PASEO_DEV_DAEMON_ENDPOINT` must change with it and Metro must restart: `EXPO_PUBLIC_LOCAL_DAEMON` is inlined into the JS bundle at build time, so a running Metro keeps pointing the app at the old daemon.
- Wait for `curl -o /dev/null -w "%{http_code}" http://localhost:19010` to return 200.

## Drive and measure

Use the Paseo browser MCP: `browser_new_tab` → `browser_wait` for a stable text ("Workspaces") → `browser_snapshot` / `browser_evaluate` / `browser_screenshot`.

- React Native Web renders `testID` as `[data-testid=...]` — e.g. `sidebar-project-row-*`, `sidebar-workspace-row-*`.
- When measuring indentation or alignment, measure content origins (text range or leading slot), not the row box's left edge: indents are padding, and the row box deliberately stays full-width so hover/selected backgrounds keep spanning the group.

## Teardown (always)

TaskStop leaves orphans (supervisor-entrypoint, cross-env, jest workers). After stopping:

```bash
powershell -NoProfile -Command 'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "<worktree-path-fragment>" -and $_.Name -match "node" } | ForEach-Object { taskkill /PID $_.ProcessId /T /F }'
```

- Wrap the whole PowerShell command in single quotes: Git Bash expands `$_` inside double quotes.
- In Git Bash, taskkill needs doubled slashes: `taskkill //PID <n> //T //F`.
- Confirm the ports are free and the worktree's node process count is zero. A daemon that died mid-run may also leave a stale pid lock in `.dev/paseo-home`; the next start clears it by itself.
