# Knot ACP metadata adapter (Route A, experimental)

Runs the unmodified official Knot CLI ACP implementation. Only the manager model catalog response is supplemented from the signed-in With desktop catalog. Normal chat traffic is not proxied. This is not the desktop chat bridge, and not an official product feature.

## Requirements

- Node >=22; the existing Paseo checkout with `js-yaml` ^4.1.1 installed (root devDependency).
- Official Knot CLI v0.29.0 and its existing source YAML configuration.
- Running With desktop for additional model capabilities. If unavailable at startup, official metadata is retained and a warning is emitted. Metadata is a process-start snapshot, refreshed by launching a new process.
- Reuses sibling `with-desktop-acp/transport.cjs` and `bridge.cjs` only to discover the local endpoint and extract models. Does NOT call desktop chat, session, permission or WebSocket APIs.

## Run

```powershell
node D:/UGit/Paseo/paseo/packages/server/scripts/knot-acp-metadata/index.cjs --cli D:/UGit/Paseo/.with-connect/v029-isolated/knot-cli.exe --config C:/Users/xinghanchen/AppData/Local/Programs/with/resources/with-app-cli/etc/bg-agent-client.yaml
```

Replace machine-specific paths on another computer. Do not pass desktop flags to ACP. The source YAML is read but never edited. Authentication remains the CLI's existing authentication. The adapter does not log credentials.

Options: `--runtime-root DIR` places temporary configuration under an explicit directory; `--audit PATH` writes bounded route/status/model-name audit records, not headers or bodies. Normal ACP messages use stdin/stdout; CLI diagnostics go to stderr.

## Optional Paseo configuration (NOT activated by this implementation)

A new `with-metadata` provider ID is recognized by source `provider-registry.ts` and uses `WithACPAgentClient` so reasoning/context choices appear. No installed provider configuration was changed and no daemon was rebuilt/restarted.

Merge ONLY this entry into `agents.providers` using Node JSON.parse/JSON.stringify, after choosing to activate and rebuilding the changed server code:

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

Do not replace `with` or `with-desktop` or migrate existing sessions yet. Rolling back an activation means removing only `agents.providers["with-metadata"]`.

## Scope and safety

- Supplements only same-name, official-catalog `ext-glm-5.3` and `gpt-6-astra`, with desktop `is_support_thinking=false`.
- Retains official model names, aliases, routing flags, unknown fields, defaults, existing options, all other models and original catalog errors. Does not insert desktop-only models or bypass authorization.
- Only modifies `GetAvailableModels`. Other observed manager RPC methods and the HTTP `api/report` route are forwarded, preserving method/body/end-to-end headers/status and streaming. Unknown namespaces are rejected and audited, not silently guessed. This is NOT a guarantee for every future manager route.
- Fixed original upstream; no arbitrary proxy destinations. Listener binds 127.0.0.1, uses a random secret path and exact Host check, rejects browser-origin requests, and has timeouts/size limits. These controls do not protect against a malicious process running as the same local user.
- Temporary directory restricts Windows ACL to current user before writing config (POSIX 0700/0600). Temporary files and listeners are removed on normal shutdown; force-kill/power loss can leave a private temp directory, which the next launch sweeps automatically (each directory records its owner pid in `owner.pid`; dead-owner directories older than 10 minutes are removed, with a 7-day hard age bound against PID reuse). Never publish temporary config or CLI raw logs.
- Retains official ACP input methods, client requests, streaming, extensions and capability declarations, with only an existing compatibility normalization of missing select option arrays.
- No automatic chat retry added, no permission auto-approval. Existing CLI behavior remains authoritative.

## Tests and results (2026-09-11)

| Check                                                       | Result                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proxy/metadata automated unit tests                         | 14/14 passed (9 proxy + 5 stale-cleanup)                                                                                                                                                                                                                                                                              |
| Provider + ACP session unit tests                           | acp-agent.test.ts 106/106 passed incl. new `resumeAfterLoad` cases (vitest 4.1.6)                                                                                                                                                                                                                                     |
| Force-kill leftover sweep                                   | End-to-end via real `launch()`: dead-owner dir removed, live-owner dir and concurrent-instance grace window preserved, own temp dir cleaned on exit                                                                                                                                                                   |
| Official model list retained                                | 42 models                                                                                                                                                                                                                                                                                                             |
| GLM high + 200000, max + 1000000                            | Settings accepted and short real replies completed in multiple runs                                                                                                                                                                                                                                                   |
| GPT 1000000 / 200000                                        | Accepted / correctly rejected                                                                                                                                                                                                                                                                                         |
| Actual Paseo WithACPAgentClient                             | Reasoning/context catalog, session selections and real streamed `PASEO_ROUTE_A_OK` passed                                                                                                                                                                                                                             |
| Outgoing request fields (VERIFIED)                          | CLI DEBUG log `cli/ask_agent.go:1080 requestBody` shows `"model":"ext-glm-5.3"`, `"reasoning_effort":"high"/"max"`, `"max_context_tokens":200000/1000000`, `"enable_thinking":false` on every tested turn (4 manual + 2 scripted runs, 23:00-23:11). No TLS interception, no certificates, chat traffic never proxied |
| Process restart + load                                      | Selected max + 1M restored; load emitted NO history replay in this test                                                                                                                                                                                                                                               |
| Closed session reuse                                        | Official CLI requires `session/resume` after `session/load`; Paseo `resumeAfterLoad` fix now issues it automatically for With providers                                                                                                                                                                               |
| Session list                                                | Own test session found                                                                                                                                                                                                                                                                                                |
| Cancel after stream starts                                  | Returned `stopReason=cancelled`                                                                                                                                                                                                                                                                                       |
| Cancel during request startup                               | Official CLI returned -32603 `context canceled`; not normalized by adapter                                                                                                                                                                                                                                            |
| Manager HTTP report                                         | Real upstream HTTP 200 after forwarding                                                                                                                                                                                                                                                                               |
| MCP injection (stdio and HTTP)                              | NOT registered by the CLI: injected servers never appear in `GetToolsByServer`; identical for the user's real Paseo session injecting `paseo` (16:29). Official CLI v0.29 does not consume ACP `mcpServers`; configure servers via its own `~/.bg-agent/mcp_config.json` instead                                      |
| Permission confirmation                                     | VERIFIED NOT SENT: agent-mode `Remove-Item` deleted the file with zero `session/request_permission` callbacks. Permission policy is internal to the CLI; client-side approval UI cannot gate this provider                                                                                                            |
| Images / SSE MCP / additional dirs / history replay content | NOT tested                                                                                                                                                                                                                                                                                                            |

`capture-test.cjs` is superseded: wire evidence now comes from the CLI's own DEBUG logging. Keep it disabled; `KNOT_METADATA_CAPTURE_TEST=1` only reproduces the earlier HTTPS-requirement finding.

## CLI logging behavior (how wire evidence was obtained)

- ACP processes log at DEBUG to `knot_bg_client_acp*.log` resolved against a workspace root, NOT the process cwd: a CLI spawned with cwd inside `.with-connect/route-a-*` wrote to `.with-connect/log/`. The file is shared and appended by concurrent processes; filter lines by session id.
- The active `tmp-<ts>.<pid>.knot_bg_client_acp.log` is removed on clean exit; read it while the CLI is still running or kill the process to preserve it.
- `requestBody` lines contain the full outgoing chat payload; extract whitelisted fields only and never publish raw logs.
- Normal chat goes over the WebSocket channel (`/api/v2/chat-agent/conversation/start`); the HTTP v1 `/agents/knot-cli/chat` endpoint appeared only for cancellation in tests.

## Reproduce

```powershell
node --test D:/UGit/Paseo/paseo/packages/server/scripts/knot-acp-metadata/proxy.test.cjs D:/UGit/Paseo/paseo/packages/server/scripts/knot-acp-metadata/stale-cleanup.test.cjs
npm run test:unit --prefix D:/UGit/Paseo/paseo/packages/server -- src/server/agent/providers/acp-agent.test.ts
node D:/UGit/Paseo/paseo/packages/server/scripts/knot-acp-metadata/verify-wire.cjs D:/UGit/Paseo/.with-connect/v029-isolated/knot-cli.exe C:/Users/xinghanchen/AppData/Local/Programs/with/resources/with-app-cli/etc/bg-agent-client.yaml D:/UGit/Paseo/.with-connect/route-a-wire-new D:/UGit/Paseo/.with-connect/route-a-wire-new.json
node D:/UGit/Paseo/paseo/packages/server/scripts/knot-acp-metadata/verify-permission.cjs D:/UGit/Paseo/.with-connect/v029-isolated/knot-cli.exe C:/Users/xinghanchen/AppData/Local/Programs/with/resources/with-app-cli/etc/bg-agent-client.yaml D:/UGit/Paseo/.with-connect/route-a-perm-new D:/UGit/Paseo/.with-connect/route-a-perm-new.json
node D:/UGit/Paseo/paseo/packages/server/scripts/knot-acp-metadata/verify-live.cjs --cli D:/UGit/Paseo/.with-connect/v029-isolated/knot-cli.exe --config C:/Users/xinghanchen/AppData/Local/Programs/with/resources/with-app-cli/etc/bg-agent-client.yaml --runtime-root D:/UGit/Paseo/.with-connect/route-a-new-tests --audit D:/UGit/Paseo/.with-connect/route-a-new-result.json
node D:/UGit/Paseo/paseo/node_modules/tsx/dist/cli.mjs D:/UGit/Paseo/paseo/packages/server/scripts/knot-acp-metadata/verify-paseo.mts D:/UGit/Paseo/.with-connect/v029-isolated/knot-cli.exe C:/Users/xinghanchen/AppData/Local/Programs/with/resources/with-app-cli/etc/bg-agent-client.yaml D:/UGit/Paseo/.with-connect/route-a-new-paseo D:/UGit/Paseo/.with-connect/route-a-new-paseo.json
```

Live tests create their own sessions, consume quota and may leave their own restorable CLI session records. They never edit/delete unrelated sessions. `verify-permission` deletes only its own disposable file inside the test directory. Test reports must be read per-check: command completion does not imply every capability passed.

## Acceptance gate

Verified this phase: outgoing parameter transmission (via CLI DEBUG logs, no TLS weakening), closed-session restoration semantics (Paseo `resumeAfterLoad`), permission behavior (confirmed NOT routed through ACP). The `mcpServers` gap is resolved: the adapter consumes `PASEO_MCP_SERVERS_JSON`, mirrors it into the session-private runtime dir, and points the CLI at it via the server-config `mcp_config_path` key (verified against CLI v0.29: initial load and hot-reload watcher both follow it); the global `~/.bg-agent/mcp_config.json` is never touched, so concurrent sessions no longer clobber each other or manual edits. Remaining before normal activation: broader regression (images, SSE MCP, history replay). Keep original providers available; the adapter remains experimental.
