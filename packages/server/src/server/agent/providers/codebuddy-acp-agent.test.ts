import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import { CodeBuddyACPAgentClient } from "./codebuddy-acp-agent.js";

function commandNames(commands: { name: string }[]): string[] {
  return commands.map((command) => command.name);
}

describe("CodeBuddyACPAgentClient", () => {
  test("listCommands waits for the async available_commands_update batch", async () => {
    await withFakeCodeBuddyACPAgent(
      fakeCodeBuddyLateCommandsScript,
      async (scriptPath, testDir) => {
        const updateTracePath = path.join(testDir, "commands-update.trace");
        const client = new CodeBuddyACPAgentClient({
          logger: createTestLogger(),
          command: [process.execPath, scriptPath, updateTracePath],
          providerId: "codebuddy-code",
          label: "CodeBuddy",
        });

        const session = await client.createSession({ provider: "acp", cwd: testDir });
        try {
          const commands = await session.listCommands!();

          expect(commands).toEqual([
            {
              name: "paseo",
              description: "Paseo orchestration",
              argumentHint: "",
              kind: "command",
            },
          ]);
          // The batch must have been delivered asynchronously after session/new resolved,
          // proving listCommands() waited instead of returning the initial empty cache.
          await expect(readFile(updateTracePath, "utf8")).resolves.toBe("after-session-new");
        } finally {
          await session.close();
        }
      },
    );
  }, 30_000);

  // Regression: CodeBuddy Code pushes available_commands_update BEFORE session/new
  // resolves, so the notification lands while ACPAgentSession still has a null
  // sessionId. The sessionId guard used to drop it outright and CodeBuddy never
  // re-sends the batch, leaving the composer stuck on "no commands found".
  test("keeps the available_commands_update pushed before session/new resolves", async () => {
    await withFakeCodeBuddyACPAgent(
      fakeCodeBuddyEarlyCommandsScript,
      async (scriptPath, testDir) => {
        const client = new CodeBuddyACPAgentClient({
          logger: createTestLogger(),
          command: [process.execPath, scriptPath],
          providerId: "codebuddy-code",
          label: "CodeBuddy",
        });

        const session = await client.createSession({ provider: "acp", cwd: testDir });
        const commands = await session.listCommands!();
        try {
          expect(commandNames(commands)).toEqual(["paseo", "paseo-committee", "paseo-handoff"]);
        } finally {
          await session.close();
        }
      },
    );
  }, 30_000);

  // A pre-session notification addressed to a different session must still be
  // discarded once the real session id is known.
  test("discards pre-session updates addressed to another session", async () => {
    await withFakeCodeBuddyACPAgent(
      fakeCodeBuddyForeignSessionScript,
      async (scriptPath, testDir) => {
        const client = new CodeBuddyACPAgentClient({
          logger: createTestLogger(),
          command: [process.execPath, scriptPath],
          providerId: "codebuddy-code",
          label: "CodeBuddy",
        });

        const session = await client.createSession({ provider: "acp", cwd: testDir });
        const commands = await session.listCommands!();
        try {
          expect(commandNames(commands)).toEqual(["paseo"]);
        } finally {
          await session.close();
        }
      },
    );
  }, 30_000);
});

async function withFakeCodeBuddyACPAgent(
  script: string,
  run: (scriptPath: string, testDir: string) => Promise<void>,
): Promise<void> {
  const testDir = await mkdtemp(path.join(tmpdir(), "paseo-codebuddy-acp-"));
  try {
    const scriptPath = path.join(testDir, "fake-codebuddy-acp.cjs");
    await writeFile(scriptPath, script, "utf8");
    await run(scriptPath, testDir);
  } finally {
    await rm(testDir, { recursive: true, force: true });
  }
}

// session/new resolves first, then the available_commands_update session update
// is pushed asynchronously (its sendAvailableCommandsUpdate awaits the product
// configuration carrying the skills).
const fakeCodeBuddyLateCommandsScript = `
const fs = require("node:fs");
const readline = require("node:readline");

const updateTracePath = process.argv[2];
const rl = readline.createInterface({ input: process.stdin });

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? 1,
        agentCapabilities: {},
      },
    });
    return;
  }

  if (message.method === "session/new") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { sessionId: "session-1" },
    });
    setTimeout(() => {
      if (updateTracePath) {
        fs.writeFileSync(updateTracePath, "after-session-new");
      }
      send({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "session-1",
          update: {
            sessionUpdate: "available_commands_update",
            availableCommands: [{ name: "paseo", description: "Paseo orchestration" }],
          },
        },
      });
    }, 100);
  }
});
`;

// Mirrors CodeBuddy Code's observed wire behavior: config_option_update and two
// available_commands_update batches are emitted BEFORE the session/new response,
// all carrying the same session id that session/new is about to return.
const fakeCodeBuddyEarlyCommandsScript = `
const readline = require("node:readline");

const rl = readline.createInterface({ input: process.stdin });

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

function commandsUpdate(names) {
  return {
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "session-1",
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: names.map((name) => ({ name, description: name + " skill" })),
      },
    },
  };
}

rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? 1,
        agentCapabilities: {},
      },
    });
    return;
  }

  if (message.method === "session/new") {
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-1",
        update: { sessionUpdate: "config_option_update", configOptions: [] },
      },
    });
    send(commandsUpdate(["paseo"]));
    send(commandsUpdate(["paseo", "paseo-committee", "paseo-handoff"]));
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { sessionId: "session-1" },
    });
  }
});
`;

// Emits a pre-session batch for an unrelated session id, then the real one.
const fakeCodeBuddyForeignSessionScript = `
const readline = require("node:readline");

const rl = readline.createInterface({ input: process.stdin });

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? 1,
        agentCapabilities: {},
      },
    });
    return;
  }

  if (message.method === "session/new") {
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "some-other-session",
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands: [
            { name: "leaked-from-other-session", description: "must not leak" },
          ],
        },
      },
    });
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-1",
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands: [{ name: "paseo", description: "Paseo orchestration" }],
        },
      },
    });
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { sessionId: "session-1" },
    });
  }
});
`;
