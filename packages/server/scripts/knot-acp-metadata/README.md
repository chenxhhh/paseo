# Knot ACP metadata adapter (Route A, experimental)

Runs the unmodified official Knot CLI ACP implementation. Only the manager model catalog response is supplemented from the signed-in With desktop catalog. Normal chat traffic is not proxied. This is not the desktop chat bridge, and not an official product feature.

## Requirements

- Node >=22; the existing Paseo checkout with `js-yaml` ^4.1.1 installed (root devDependency).
- Official Knot CLI v0.29.0 and its existing source YAML configuration.
- Additional capabilities are loaded from a persistent local snapshot first; a valid snapshot means startup does not contact With desktop. On first use (or invalid/missing snapshot), desktop discovery is attempted and successful metadata is saved. Without either source, official metadata is retained with a warning that saved context choices may not restore.
- Snapshots live under `~/.paseo/with-metadata/`, keyed by the absolute source YAML path. Version, source path and update time are stored alongside whitelisted model capability fields only. Credentials and full desktop settings are not stored. Account changes using the same YAML path require an explicit refresh; official model availability and authorization remain authoritative.
- Snapshots older than seven days remain usable with a warning. Failed/empty/invalid refreshes never replace a successful snapshot. Updates use a temporary file plus atomic rename. Existing ACP processes keep their startup catalog; refreshed metadata applies to newly launched processes.
- Explicit refresh (desktop must be running): `node D:/UGit/Paseo/paseo/packages/server/scripts/knot-acp-metadata/refresh-catalog.cjs --config C:/Users/xinghanchen/AppData/Local/Programs/with/resources/with-app-cli/etc/bg-agent-client.yaml`. Exit status is nonzero if refresh/persistence fails; the previous file remains intact. This command does not start a chat. No scheduled task is installed automatically.
- Reuses sibling `with-desktop-acp/transport.cjs` and `bridge.cjs` only to discover the local endpoint and extract models. Does NOT call desktop chat, session, permission or WebSocket APIs.

## Run

```powershell
node D:/UGit/Paseo/paseo/packages/server/scripts/knot-acp-metadata/index.cjs --cli D:/UGit/Paseo/.with-connect/v029-isolated/knot-cli.exe --config C:/Users/xinghanchen/AppData/Local/Programs/with/resources/with-app-cli/etc/bg-agent-client.yaml
```

Replace machine-specific paths on another computer. Do not pass desktop flags to ACP. The source YAML is read but never edited. Authentication remains the CLI's existing authentication. The adapter does not log credentials.

Options: `--runtime-root DIR` places temporary configuration under an explicit directory; `--audit PATH` writes bounded route/status/model-name audit records, not headers or bodies. Normal ACP messages use stdin/stdout; CLI diagnostics go to stderr.

## Paseo configuration (ACTIVATED 2026-09-11)

The `with-metadata` provider ID is recognized by `provider-registry.ts` and uses `WithACPAgentClient` (per-model reasoning/context choices plus `resumeAfterLoad`). It was merged into the user's `agents.providers` on 2026-09-11; the server was rebuilt and the daemon restarted on 2026-09-12, so live sessions already run through this adapter. The earlier experimental providers `with` (acp-compat layer) and `with-desktop` (desktop bridge) were removed from the user configuration; backup: `C:/Users/xinghanchen/.paseo/config.json.bak.20260911-with-metadata-swap`.

On another machine, merge ONLY this entry into `agents.providers` using Node JSON.parse/JSON.stringify after rebuilding the changed server code:

```json
{
  "with-metadata": {
    "extends": "acp",
    "label": "Knot ACP + Desktop Metadata (Experimental)",
    "command": [
      "C:/Users/xinghanchen/.workbuddy/binaries/node/versions/22.22.2/node.exe",
      "D:/UGit/Paseo/paseo/packages/server/scripts/knot-acp-metadata/index.cjs",
      "--cli",
      "D:/UGit/Paseo/.with-connect/v029-isolated/knot-cli.exe",
      "--config",
      "C:/Users/xinghanchen/AppData/Local/Programs/with/resources/with-app-cli/etc/bg-agent-client.yaml"
    ]
  }
}
```

Rolling back means removing only `agents.providers["with-metadata"]` and restarting the daemon.

## Home isolation (2026-09-14)

The CLI stores its ACP session registry at `<HOME>/.bg-agent/.knot_acp_sessions.json` with a read-all/modify/write-all strategy and no cross-process locking beyond tmp+rename. Concurrent CLI processes (Paseo agent sessions, catalog probes, the With desktop) overwrite each other's entries — the 2026-09-14 incident (`session not found: acp-sess-f716a0ee...` after a daemon restart) was exactly this lost-update race: a session written at 10:22 was silently dropped from the registry by a competing process holding an older snapshot.

Each adapter launch now redirects the CLI's `HOME` to a private fake user directory inside the session's runtime dir (`<runtime dir>/home`). Verified against CLI v0.29 with live probes: the CLI bootstraps its own `node/`, `browser/`, `log/`, `.bg-client/` and `.gitconfig` there (the global `git config --global` the CLI runs no longer touches the real user config), keeps working with only `auth.json` + `hooks.json` copied in, and never reads or writes the real `~/.bg-agent` registry. `commands: []` and the empty initial model choices are native Knot ACP behavior (confirmed by a control probe against the real home), not a fake-home regression.

Daemon-restart resume keeps working through a three-part mirror protocol:

1. Paseo marks resume spawns with `PASEO_RESUME_SESSION_ID` (`buildResumeSessionEnv` in `acp-agent.ts`); the adapter pre-seeds that entry (read-only from the real registry) into the fake home registry so the fresh CLI can `session/load` it. Live-probe verified: a second fake home seeded with the entry restores via `session/load` + `session/resume` without touching the real registry.
2. Right after `session/new`, the adapter upserts the CLI-written entry into the real registry (narrow retry window), so the session survives force-kill/power loss, which never reach the exit hooks.
3. On orderly shutdown it merges the entry's final state once more. The mirror never replaces the real registry wholesale: an unreadable/corrupt real registry aborts the mirror, and entries owned by other sessions are preserved.

Rollback: set `KNOT_METADATA_HOME_ISOLATION=0` in the daemon environment to restore the legacy shared-home behavior (no fake home, no registry mirroring). `KNOT_METADATA_REAL_HOME` is a test-only override for the real home location.

## Scope and safety

- Supplements only same-name, official-catalog `ext-glm-5.3` and `gpt-6-astra`, with desktop `is_support_thinking=false`.
- Retains official model names, aliases, routing flags, unknown fields, defaults, existing options, all other models and original catalog errors. Does not insert desktop-only models or bypass authorization.
- Only modifies `GetAvailableModels`. Other observed manager RPC methods and the HTTP `api/report` route are forwarded, preserving method/body/end-to-end headers/status and streaming. Unknown namespaces are rejected and audited, not silently guessed. This is NOT a guarantee for every future manager route.
- Fixed original upstream; no arbitrary proxy destinations. Listener binds 127.0.0.1, uses a random secret path and exact Host check, rejects browser-origin requests, and has timeouts/size limits. These controls do not protect against a malicious process running as the same local user.
- Temporary directory restricts Windows ACL to current user before writing config (POSIX 0700/0600). Temporary files and listeners are removed on normal shutdown; force-kill/power loss can leave a private temp directory, which the next launch sweeps automatically (each directory records its owner pid in `owner.pid`; dead-owner or missing-owner directories older than 10 minutes are removed, while live-owner directories are always retained regardless of age). There is no 7-day forced deletion: PID reuse may conservatively delay cleanup until that process exits, rather than risk deleting an active session's configuration. Never publish temporary config or CLI raw logs.
- Retains official ACP input methods, client requests, streaming, extensions and capability declarations, with only an existing compatibility normalization of missing select option arrays.
- No automatic chat retry added, no permission auto-approval. Existing CLI behavior remains authoritative.

## Tests and results (2026-09-11)

| Check                                     | Result                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proxy/metadata automated unit tests       | 14/14 passed (9 proxy + 5 stale-cleanup)                                                                                                                                                                                                                                                                              |
| Provider + ACP session unit tests         | acp-agent.test.ts 106/106 passed incl. new `resumeAfterLoad` cases (vitest 4.1.6)                                                                                                                                                                                                                                     |
| Force-kill leftover sweep                 | End-to-end via real `launch()`: dead-owner dir removed, live-owner dir and concurrent-instance grace window preserved, own temp dir cleaned on exit                                                                                                                                                                   |
| Official model list retained              | 42 models                                                                                                                                                                                                                                                                                                             |
| GLM high + 200000, max + 1000000          | Settings accepted and short real replies completed in multiple runs                                                                                                                                                                                                                                                   |
| GPT 1000000 / 200000                      | Accepted / correctly rejected                                                                                                                                                                                                                                                                                         |
| Actual Paseo WithACPAgentClient           | Reasoning/context catalog, session selections and real streamed `PASEO_ROUTE_A_OK` passed                                                                                                                                                                                                                             |
| Outgoing request fields (VERIFIED)        | CLI DEBUG log `cli/ask_agent.go:1080 requestBody` shows `"model":"ext-glm-5.3"`, `"reasoning_effort":"high"/"max"`, `"max_context_tokens":200000/1000000`, `"enable_thinking":false` on every tested turn (4 manual + 2 scripted runs, 23:00-23:11). No TLS interception, no certificates, chat traffic never proxied |
| Process restart + load                    | Selected max + 1M restored; load emitted NO history replay in this test                                                                                                                                                                                                                                               |
| Closed session reuse                      | Official CLI requires `session/resume` after `session/load`; Paseo `resumeAfterLoad` fix now issues it automatically for With providers                                                                                                                                                                               |
| Session list                              | Own test session found                                                                                                                                                                                                                                                                                                |
| Cancel after stream starts                | Returned `stopReason=cancelled`                                                                                                                                                                                                                                                                                       |
| Cancel during request startup             | Official CLI returned -32603 `context canceled`; not normalized by adapter                                                                                                                                                                                                                                            |
| Manager HTTP report                       | Real upstream HTTP 200 after forwarding                                                                                                                                                                                                                                                                               |
| MCP injection (stdio and HTTP)            | SUPERSEDED 2026-09-12: the ACP-level `mcpServers` param is indeed ignored by CLI v0.29, but injection now flows through the session-private `mcp_config_path` config; stdio/SSE/HTTP transports all verified live — see "Tests and results (2026-09-12)"                                                              |
| Permission confirmation                   | VERIFIED NOT SENT: agent-mode `Remove-Item` deleted the file with zero `session/request_permission` callbacks. Permission policy is internal to the CLI; client-side approval UI cannot gate this provider                                                                                                            |
| Images / SSE MCP / history replay content | Covered with passing live probes on 2026-09-12 — see "Tests and results (2026-09-12)" (additional dirs remain untested)                                                                                                                                                                                               |

`capture-test.cjs` is superseded: wire evidence now comes from the CLI's own DEBUG logging. Keep it disabled; `KNOT_METADATA_CAPTURE_TEST=1` only reproduces the earlier HTTPS-requirement finding.

## Tests and results (2026-09-12)

| Check                                                   | Result                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP conversion + session isolation automated regression | `mcp-injection.test.cjs` 5/5 passed (node --test): stdio/http/sse conversion shapes, dropped-entry counting, private `knot-metadata-*` dir with `mcp_config_path`, audit `mcp-injection` event, proxy URL substitution, no-injection paths, per-launch isolation, temp-dir cleanup, source config untouched. The suite takes 1-2 minutes because every launch performs a real catalog lookup |
| Local suite total                                       | proxy 9 + stale-cleanup 7 + mcp-injection 5 = 21/21 passed                                                                                                                                                                                                                                                                                                                                   |
| Remote MCP transports (live)                            | `verify-sse-mcp.cjs` PASSED: injected `paseo-sse` (legacy SSE), `paseo-http` (streamable HTTP) and a `route-a-stdio` control via `PASEO_MCP_SERVERS_JSON`; each server observed `initialize` -> `tools/list` -> `tools/call`, and one real turn returned all three markers in order. Report: `D:/UGit/Paseo/.with-connect/route-a-sse-result.json`                                           |
| History replay (live)                                   | `verify-history-replay.cjs` PASSED: after `session/close`, a fresh adapter+CLI process saw `session/load` emit 0 replay updates (no duplicate timeline items for Paseo) while settings persisted; `session/resume` plus one prompt returned the exact token pinned in the first turn, proving context is preserved. Report: `D:/UGit/Paseo/.with-connect/route-a-history-result.json`        |
| Images (live)                                           | `verify-image.cjs` PASSED: an ACP `image` content block (generated 1x1 solid red PNG, base64) was accepted at the protocol level by both models; `ext-glm-5.3` answered "Red"; `gpt-6-astra` accepted the block but answered "White" (per-model image perception varies on a 1x1 image). Report: `D:/UGit/Paseo/.with-connect/route-a-image-result.json`                                     |

## Tests and results (2026-09-14)

| Check                                                 | Result                                                                                                                                                                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Home isolation unit tests                             | `home-isolation.test.cjs` 12/12 passed (node --test): opt-out switch, minimal file set copy, registry read safety (corrupt → abort, missing entry → untouched, lock retry, other entries preserved), seed and mirror semantics |
| MCP injection regression with home isolation          | `mcp-injection.test.cjs` 8/8 passed (was 5): fake-home dir present, `HOME` redirected into the runtime root, `KNOT_METADATA_HOME_ISOLATION=0` legacy behavior, resume seed success and failure paths                           |
| Provider + ACP session unit tests                     | acp-agent.test.ts 108/108 passed (vitest 4.1.7) incl. new `buildResumeSessionEnv` cases                                                                                                                                        |
| Fake-home live probe (real CLI v0.29, no model quota) | `session/new` under a fake home works with auth.json+hooks.json only; registry written into the fake home; a second fake home pre-seeded with the entry restores via `session/load` + `session/resume`                         |
| Real-home control probe                               | `commands: []`, empty initial model choices and full configOptions identical under the real home — no fake-home regression; probe adds exactly one registry entry                                                              |

Metadata whitelist remains `ext-glm-5.3` + `gpt-6-astra` only. Coverage is deliberately limited to models whose merged reasoning/context options have been verified against real sessions; it is NOT a full-model capability backfill. To extend: add the model to `allowedModels` in `proxy.cjs`, probe its advertised options with `scripts/verify-with-options.mts`, confirm the gateway honors each value in a disposable session, then update this README.

## CLI logging behavior (how wire evidence was obtained)

- ACP processes log at DEBUG to `knot_bg_client_acp*.log` resolved against a workspace root, NOT the process cwd: a CLI spawned with cwd inside `.with-connect/route-a-*` wrote to `.with-connect/log/`. The file is shared and appended by concurrent processes; filter lines by session id.
- The active `tmp-<ts>.<pid>.knot_bg_client_acp.log` is removed on clean exit; read it while the CLI is still running or kill the process to preserve it.
- `requestBody` lines contain the full outgoing chat payload; extract whitelisted fields only and never publish raw logs.
- Normal chat goes over the WebSocket channel (`/api/v2/chat-agent/conversation/start`); the HTTP v1 `/agents/knot-cli/chat` endpoint appeared only for cancellation in tests.

## Reproduce

```powershell
node --test D:/UGit/Paseo/paseo/packages/server/scripts/knot-acp-metadata/proxy.test.cjs D:/UGit/Paseo/paseo/packages/server/scripts/knot-acp-metadata/stale-cleanup.test.cjs D:/UGit/Paseo/paseo/packages/server/scripts/knot-acp-metadata/mcp-injection.test.cjs
npm run test:unit --prefix D:/UGit/Paseo/paseo/packages/server -- src/server/agent/providers/acp-agent.test.ts
node D:/UGit/Paseo/paseo/packages/server/scripts/knot-acp-metadata/verify-wire.cjs D:/UGit/Paseo/.with-connect/v029-isolated/knot-cli.exe C:/Users/xinghanchen/AppData/Local/Programs/with/resources/with-app-cli/etc/bg-agent-client.yaml D:/UGit/Paseo/.with-connect/route-a-wire-new D:/UGit/Paseo/.with-connect/route-a-wire-new.json
node D:/UGit/Paseo/paseo/packages/server/scripts/knot-acp-metadata/verify-permission.cjs D:/UGit/Paseo/.with-connect/v029-isolated/knot-cli.exe C:/Users/xinghanchen/AppData/Local/Programs/with/resources/with-app-cli/etc/bg-agent-client.yaml D:/UGit/Paseo/.with-connect/route-a-perm-new D:/UGit/Paseo/.with-connect/route-a-perm-new.json
node D:/UGit/Paseo/paseo/packages/server/scripts/knot-acp-metadata/verify-live.cjs --cli D:/UGit/Paseo/.with-connect/v029-isolated/knot-cli.exe --config C:/Users/xinghanchen/AppData/Local/Programs/with/resources/with-app-cli/etc/bg-agent-client.yaml --runtime-root D:/UGit/Paseo/.with-connect/route-a-new-tests --audit D:/UGit/Paseo/.with-connect/route-a-new-result.json
node D:/UGit/Paseo/paseo/node_modules/tsx/dist/cli.mjs D:/UGit/Paseo/paseo/packages/server/scripts/knot-acp-metadata/verify-paseo.mts D:/UGit/Paseo/.with-connect/v029-isolated/knot-cli.exe C:/Users/xinghanchen/AppData/Local/Programs/with/resources/with-app-cli/etc/bg-agent-client.yaml D:/UGit/Paseo/.with-connect/route-a-new-paseo D:/UGit/Paseo/.with-connect/route-a-new-paseo.json
node D:/UGit/Paseo/paseo/packages/server/scripts/knot-acp-metadata/verify-sse-mcp.cjs --cli D:/UGit/Paseo/.with-connect/v029-isolated/knot-cli.exe --config C:/Users/xinghanchen/AppData/Local/Programs/with/resources/with-app-cli/etc/bg-agent-client.yaml --runtime-root D:/UGit/Paseo/.with-connect/route-a-sse-run --audit D:/UGit/Paseo/.with-connect/route-a-sse-result.json
node D:/UGit/Paseo/paseo/packages/server/scripts/knot-acp-metadata/verify-history-replay.cjs --cli D:/UGit/Paseo/.with-connect/v029-isolated/knot-cli.exe --config C:/Users/xinghanchen/AppData/Local/Programs/with/resources/with-app-cli/etc/bg-agent-client.yaml --runtime-root D:/UGit/Paseo/.with-connect/route-a-history-run --audit D:/UGit/Paseo/.with-connect/route-a-history-result.json
node D:/UGit/Paseo/paseo/packages/server/scripts/knot-acp-metadata/verify-image.cjs --cli D:/UGit/Paseo/.with-connect/v029-isolated/knot-cli.exe --config C:/Users/xinghanchen/AppData/Local/Programs/with/resources/with-app-cli/etc/bg-agent-client.yaml --runtime-root D:/UGit/Paseo/.with-connect/route-a-image-run --audit D:/UGit/Paseo/.with-connect/route-a-image-result.json
```

Live tests create their own sessions, consume quota and may leave their own restorable CLI session records; the 2026-09-12 probes each consume 1-2 short real turns. They never edit/delete unrelated sessions. `verify-permission` deletes only its own disposable file inside the test directory. Test reports must be read per-check: command completion does not imply every capability passed.

## Acceptance gate

Verified this phase: outgoing parameter transmission (via CLI DEBUG logs, no TLS weakening), closed-session restoration semantics (Paseo `resumeAfterLoad`), permission behavior (confirmed NOT routed through ACP). The `mcpServers` gap is resolved: the adapter consumes `PASEO_MCP_SERVERS_JSON`, mirrors it into the session-private runtime dir, and points the CLI at it via the server-config `mcp_config_path` key (verified against CLI v0.29: initial load and hot-reload watcher both follow it); the global `~/.bg-agent/mcp_config.json` is never touched, so concurrent sessions no longer clobber each other or manual edits. The previously remaining regression items (images, SSE MCP, history replay) are now covered by a dedicated automated regression and passing live probes — see "Tests and results (2026-09-12)". Keep original providers available; the adapter remains experimental.
