# With Desktop ACP Bridge

Local experimental ACP v1 adapter for Paseo. Requires Node >=22 and a running, signed-in With desktop app. No additional runtime npm packages are required. Development/live checks use the repository's installed ACP SDK and tsx.

The bridge calls With's local `/invoke` and `/ws` interfaces. It does not patch With, extract credentials, or route through Knot CLI. These desktop interfaces are internal and may change between With releases.

## Run

```powershell
node D:/UGit/Paseo/paseo/packages/server/scripts/with-desktop-acp/index.cjs
```

Standard input/output are newline-delimited JSON-RPC. Diagnostics go to stderr. The Windows launcher discovers the loopback TCP port owned by `with_daemon`; it does not hard-code a stale port or expose a network listener. Optional `WITH_DESKTOP_PORT` supplies a numeric loopback port. Other OSes require this variable.

`WITH_DESKTOP_STATE_DIR` optionally overrides the bridge-owned state directory (default `~/.paseo/with-desktop-acp`). State contains session identifiers, workspace and model settings, not tokens or transcript copies. Keep it to restore sessions. Catalog probes create local lightweight records but do not create desktop conversations until their first prompt.

## Paseo provider

Keep the existing `with` CLI provider unchanged. Add a separate `agents.providers` entry using Node `JSON.parse` / `JSON.stringify`:

```json
{
  "with-desktop": {
    "extends": "acp",
    "label": "With Desktop (ACP Bridge)",
    "command": [
      "C:/Users/xinghanchen/.workbuddy/binaries/node/versions/22.22.2/node.exe",
      "D:/UGit/Paseo/paseo/packages/server/scripts/with-desktop-acp/index.cjs"
    ],
    "params": { "supportsMcpServers": false }
  }
}
```

Use the actual absolute Node and repository paths on other machines. The provider registry routes both `with` and `with-desktop` through the existing With-specific capability resolver. `with-desktop` additionally exposes web-search and thinking toggles. Source changes require a rebuilt/restarted Paseo daemon; config reload alone cannot load a new provider factory into an already running daemon. Do not restart while user tasks are running. No With restart is necessary.

Rollback: disable/remove ONLY `agents.providers["with-desktop"]` and reload config. Do not restore a whole old config if other settings have changed. The original CLI provider and old sessions are never migrated or overwritten.

## Feature comparison with Knot CLI v0.29.0

The CLI baseline was measured from the isolated executable used by Paseo, not the stale v0.28.1 alias.

| Capability                            | Desktop bridge                                | Verification / limits                                                                                                                                                              |
| ------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ACP initialize / new                  | Implemented                                   | Formal ACP SDK and Paseo tested                                                                                                                                                    |
| Dynamic models                        | Desktop `get_agent_models`                    | 22 models discovered on 2026-09-11                                                                                                                                                 |
| Per-model reasoning/context           | Implemented                                   | ext-glm-5.3 Low/High/Max and Default/200K/1M shown in Paseo client                                                                                                                 |
| Set model / config / mode             | Implemented                                   | Both legacy model/mode methods and config options                                                                                                                                  |
| Agent / Manual mode                   | Workspace tools / pure chat                   | Never escalates permission mode; all messages use manual_review                                                                                                                    |
| Web search / thinking toggle          | Implemented                                   | Values validated against desktop metadata; thinking hidden only by downstream client rules                                                                                         |
| Text / reasoning stream               | Implemented                                   | Real high+200K and max+1M replies via formal ACP SDK                                                                                                                               |
| Tool calls, args, results             | Implemented                                   | Real harmless PowerShell output command and its result reached ACP                                                                                                                 |
| Tool argument JSON patches            | Implemented                                   | Unit tested, rejects prototype-pollution keys                                                                                                                                      |
| Token usage                           | Implemented where emitted                     | Uses reported prompt tokens; context size is configured/advertised, not independent proof of effective limit                                                                       |
| Session load                          | Implemented                                   | Paginated history replay and settings after process restart tested                                                                                                                 |
| Session resume                        | Implemented without history replay            | Restores bridge state; does not automatically reattach an in-flight stream                                                                                                         |
| Session list                          | Implemented, bridge-owned only                | Formal ACP SDK tested; excludes unrelated desktop conversations and catalog-only records                                                                                           |
| Session close                         | Implemented, nondestructive                   | Stops active turn, releases channel; preserves restorable session                                                                                                                  |
| Session delete                        | Extension implemented                         | Calls desktop delete only for bridge-owned IDs; mock tested, not advertised as standard SDK capability                                                                             |
| Cancel                                | Implemented                                   | Real request returned cancelled; startup race protected; calls chat_cancel, not merely channel_close                                                                               |
| Permission request                    | Implemented                                   | One-time allow/reject mapping, default cancel, 5-minute timeout; mock tested. Real harmless command did NOT trigger a confirmation, so live approval/rejection is not yet verified |
| Images                                | Implemented via desktop upload                | Accepts ACP inline base64 image; 20 MiB encoded limit; live model image interpretation not yet tested                                                                              |
| Embedded context                      | Text resources and resource links implemented | Unsupported binary/audio blocks fail explicitly before chat_send                                                                                                                   |
| Additional directories                | `_with/set_additional_directories` extension  | Absolute paths only; forwarded as workspaces; not claimed as CLI's undocumented additionalDirectories method                                                                       |
| Custom stdio/HTTP/SSE MCP injection   | NOT supported                                 | Explicit error; use Knot CLI for injected MCP. Desktop-configured MCP remains available under desktop policy                                                                       |
| Client filesystem/terminal delegation | NOT provided by bridge                        | Actual tools execute in With's local runtime; ACP reports their activity                                                                                                           |
| Automatic active-stream recovery      | NOT supported                                 | No silent retry; load history and cancel/wait for active run before sending again                                                                                                  |
| Fork / slash commands / compression   | Not exposed                                   | Not advertised; unsupported methods fail explicitly                                                                                                                                |
| Authentication                        | Inherits running desktop login                | No token extraction, no separate login flow                                                                                                                                        |

Requests carrying high+200K and max+1M reached the desktop service and completed. The final model gateway does not echo the applied settings; this is NOT proof of a one-million-token payload test or that downstream never overrides a parameter.

## Safety and concurrency

- Defaults to desktop `manual_review`; does not offer full-access/auto-review escalation.
- In With, manual_review can automatically run ordinary workspace operations. It is NOT an approval prompt for every tool call.
- Offers only exact yes/no actions provided by a desktop confirmation; never invents an allow-always option. Unknown confirmation forms cancel the turn.
- Only bridge-owned persisted IDs may be loaded/deleted. The general desktop session list is never queried.
- One active prompt per session within a bridge process. Do not open the same persisted session in multiple bridge processes concurrently; there is no cross-process lease yet.
- A disconnected/ambiguous request is not automatically resent. Reload the session to inspect history.
- Closing the client requests cancellation of owned active runs. Sudden process termination cannot guarantee cancellation; desktop remains the execution owner.
- No raw event/auth logging by the production adapter. Test reports may contain the test prompt/replies.

## Validation commands

Run commands from the repository with explicit executable paths as needed:

```powershell
node --test packages/server/scripts/with-desktop-acp/bridge.test.cjs
node packages/server/scripts/with-desktop-acp/verify-live.mjs
node packages/server/scripts/with-desktop-acp/verify-tools.mjs
node node_modules/tsx/dist/cli.mjs packages/server/scripts/with-desktop-acp/verify-paseo.mts --prompt
```

Live tests create new conversations and consume model quota. `verify-tools.mjs` requests only a harmless `Write-Output` command and rejects any actual confirmation. Do not infer permission success from the model's self-report; inspect `confirmations` in the report. Set `WITH_BRIDGE_TEST_OUTPUT` / `WITH_BRIDGE_TOOL_OUTPUT` to place reports outside the source tree. `verify-live.mjs --resume-only` continues the saved test's load/list/cancel checks without repeating successful settings prompts.

Observed validations on 2026-09-11: both parameter pairs completed, history replay after restart succeeded, session listing succeeded, real cancel succeeded, and Paseo's actual provider client returned `PASEO_WITH_DESKTOP_OK` with streaming timeline. This is not a browser click-through test and does not imply the existing desktop-managed daemon has already loaded the new factory.
