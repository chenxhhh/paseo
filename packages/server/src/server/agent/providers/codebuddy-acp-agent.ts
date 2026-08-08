import type { Logger } from "pino";

import { GenericACPAgentClient } from "./generic-acp-agent.js";

interface CodeBuddyACPAgentClientOptions {
  logger: Logger;
  command: [string, ...string[]];
  env?: Record<string, string>;
  providerId?: string;
  label?: string;
  providerParams?: unknown;
}

// CodeBuddy Code (`codebuddy --acp`) pushes its `available_commands_update`
// session update *before* `session/new` resolves — its
// sendAvailableCommandsUpdate() fires as soon as the product configuration
// (which carries the skills list) is ready, which can beat the session/new
// response. ACPAgentSession buffers pre-session updates and replays them once
// the session id is known, so the batch is no longer lost.
//
// The wait below is a second line of defense for the slower path, where the
// configuration resolves after session/new returns. Without it a listCommands()
// issued right after session creation resolves to an empty list and the
// composer reports "no commands found". 10s matches the Cursor/Kiro wrappers
// for the same pattern.
const CODEBUDDY_INITIAL_COMMANDS_WAIT_TIMEOUT_MS = 10_000;

export class CodeBuddyACPAgentClient extends GenericACPAgentClient {
  constructor(options: CodeBuddyACPAgentClientOptions) {
    super({
      logger: options.logger,
      command: options.command,
      env: options.env,
      providerId: options.providerId,
      label: options.label,
      providerParams: options.providerParams,
      waitForInitialCommands: true,
      initialCommandsWaitTimeoutMs: CODEBUDDY_INITIAL_COMMANDS_WAIT_TIMEOUT_MS,
    });
  }
}
