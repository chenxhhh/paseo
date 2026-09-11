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
- Temporary directory restricts Windows ACL to current user before writing config (POSIX 0700/0600). Temporary files and listeners are removed on normal shutdown; force-kill/power loss can leave a private temp directory. Never publish temporary config or CLI raw logs.
- Retains official ACP input methods, client requests, streaming, extensions and capability declarations, with only an existing compatibility normalization of missing select option arrays.
- No automatic chat retry added, no permission auto-approval. Existing CLI behavior remains authoritative. Paseo has its own existing restore compatibility policies; this adapter does not override them.

## Tests and results (2026-09-11)

| Check                                                | Result                                                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Proxy/metadata automated unit tests                  | 9/9 passed                                                                                                                           |
| Provider factory tests (existing desktop + metadata) | 2/2 passed                                                                                                                           |
| Official model list retained                         | 42 models                                                                                                                            |
| GLM high + 200000, max + 1000000                     | Settings accepted and short real replies completed in multiple runs                                                                  |
| GPT 1000000 / 200000                                 | Accepted / correctly rejected                                                                                                        |
| Actual Paseo WithACPAgentClient                      | Reasoning/context catalog, session selections and real streamed `PASEO_ROUTE_A_OK` passed                                            |
| Process restart + load                               | Selected max + 1M restored; load emitted NO history replay in this test                                                              |
| Closed session reuse                                 | Official CLI requires `session/resume` after `load`; load alone rejected prompt                                                      |
| Session list                                         | Own test session found                                                                                                               |
| Cancel after text/thought stream starts              | Returned `stopReason=cancelled`                                                                                                      |
| Cancel during request startup                        | Official CLI returned -32603 `context canceled`; not normalized by adapter                                                           |
| Manager HTTP report                                  | Real upstream HTTP 200 after forwarding                                                                                              |
| MCP stdio                                            | Metadata version accepted session config but test executable was not observed running                                                |
| MCP HTTP comparison                                  | BOTH unmodified official CLI and adapter accepted config, but test HTTP server got zero requests; actual custom MCP use NOT verified |
| Permission confirmation                              | No callback occurred; NOT verified                                                                                                   |
| Images / SSE MCP / additional dirs / history content | NOT tested                                                                                                                           |
| Actual outgoing reasoning/context fields             | NOT captured; accepting options + completing chat is NOT proof of downstream use                                                     |

`capture-test.cjs` is a disabled diagnostic experiment. Set `KNOT_METADATA_CAPTURE_TEST=1` only with explicit `--audit` and `--runtime-root` to reproduce it. It changes only a temporary Knot URL to a loopback observer and forwards to the original HTTPS origin, extracting only model option fields. v0.29.0 REJECTS this route because chat requires an HTTPS URL. We did not disable TLS validation, install certificates, intercept a user's browser, or claim successful wire verification. Never use this flag in a provider.

## Reproduce

```powershell
node --test D:/UGit/Paseo/paseo/packages/server/scripts/knot-acp-metadata/proxy.test.cjs
node D:/UGit/Paseo/paseo/packages/server/scripts/knot-acp-metadata/verify-live.cjs --cli D:/UGit/Paseo/.with-connect/v029-isolated/knot-cli.exe --config C:/Users/xinghanchen/AppData/Local/Programs/with/resources/with-app-cli/etc/bg-agent-client.yaml --runtime-root D:/UGit/Paseo/.with-connect/route-a-new-tests --audit D:/UGit/Paseo/.with-connect/route-a-new-result.json
node D:/UGit/Paseo/paseo/node_modules/tsx/dist/cli.mjs D:/UGit/Paseo/paseo/packages/server/scripts/knot-acp-metadata/verify-paseo.mts D:/UGit/Paseo/.with-connect/v029-isolated/knot-cli.exe C:/Users/xinghanchen/AppData/Local/Programs/with/resources/with-app-cli/etc/bg-agent-client.yaml D:/UGit/Paseo/.with-connect/route-a-new-paseo D:/UGit/Paseo/.with-connect/route-a-new-paseo.json
node D:/UGit/Paseo/paseo/packages/server/scripts/knot-acp-metadata/verify-mcp.mjs D:/UGit/Paseo/.with-connect/v029-isolated/knot-cli.exe C:/Users/xinghanchen/AppData/Local/Programs/with/resources/with-app-cli/etc/bg-agent-client.yaml D:/UGit/Paseo/.with-connect/route-a-new-mcp D:/UGit/Paseo/.with-connect/route-a-new-mcp.json
```

Live tests create their own sessions, consume quota and may leave their own restorable CLI session records. They never edit/delete unrelated sessions. MCP test returns only a random marker. All requested permission callbacks are rejected. Test reports must be read per-check: command completion does not imply every capability passed.

## Acceptance gate

Suitable for isolated experimental use, not a drop-in replacement yet. Before normal activation: prove final chat parameter transmission without weakening TLS; establish how to enable custom MCP for this CLI/backend; verify real permission callbacks and Paseo closed-session restoration semantics. Keep original providers available.
