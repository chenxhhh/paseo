import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import assert from "node:assert/strict";
import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
const dir = path.dirname(fileURLToPath(import.meta.url));
const out = process.env.WITH_BRIDGE_TEST_OUTPUT || path.join(dir, "live-result.json");
const resumeOnly = process.argv.includes("--resume-only");
const report = resumeOnly
  ? JSON.parse(fs.readFileSync(out, "utf8"))
  : { started: new Date().toISOString(), tests: [] };
delete report.error;
const save = () => fs.writeFileSync(out, JSON.stringify(report, null, 2));
function connect() {
  const env = { ...process.env };
  for (const key of ["BG_AGENT_TOKEN", "BG_USER_TOKEN", "KNOT_JWT_TOKEN"]) delete env[key];
  const child = spawn(process.execPath, [path.join(dir, "index.cjs")], {
    env,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.on("data", (b) => process.stderr.write(b));
  const updates = [];
  let onUpdate;
  const connection = new ClientSideConnection(
    () => ({
      sessionUpdate: async (p) => {
        updates.push(p);
        onUpdate?.(p);
      },
      requestPermission: async (p) => {
        report.tests.push({
          kind: "permission-observed",
          options: p.options.map((o) => ({ id: o.optionId, kind: o.kind })),
        });
        save();
        return { outcome: { outcome: "cancelled" } };
      },
    }),
    ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
  );
  return {
    child,
    connection,
    updates,
    setOnUpdate: (fn) => {
      onUpdate = fn;
    },
    close: () => {
      child.stdin.end();
    },
  };
}
async function initialize(c) {
  return c.connection.initialize({
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    clientInfo: { name: "paseo-desktop-validation", version: "1" },
  });
}
let c;
try {
  c = connect();
  report.capabilities = await initialize(c);
  save();
  const s = resumeOnly
    ? { sessionId: report.sessionId }
    : await c.connection.newSession({ cwd: dir, mcpServers: [] });
  report.sessionId = s.sessionId;
  save();
  if (!resumeOnly) {
    await c.connection.setSessionConfigOption({
      sessionId: s.sessionId,
      configId: "model",
      value: "ext-glm-5.3",
    });
    await c.connection.setSessionMode({ sessionId: s.sessionId, modeId: "manual" });
    for (const [effort, context] of [
      ["high", "200000"],
      ["max", "1000000"],
    ]) {
      await c.connection.setSessionConfigOption({
        sessionId: s.sessionId,
        configId: "reasoning_effort",
        value: effort,
      });
      const opts = await c.connection.setSessionConfigOption({
        sessionId: s.sessionId,
        configId: "max_context_tokens",
        value: context,
      });
      assert.equal(
        opts.configOptions.find((o) => o.id === "max_context_tokens").currentValue,
        context,
      );
      c.updates.length = 0;
      const marker = effort === "high" ? "PASEO_DESKTOP_HIGH_OK" : "PASEO_DESKTOP_MAX_OK";
      const result = await c.connection.prompt({
        sessionId: s.sessionId,
        prompt: [
          {
            type: "text",
            text: `Connectivity test. Do not use tools, read or modify files. Reply exactly ${marker}.`,
          },
        ],
      });
      const text = c.updates
        .filter((p) => p.update.sessionUpdate === "agent_message_chunk")
        .map((p) => p.update.content.text || "")
        .join("");
      assert.equal(result.stopReason, "end_turn");
      assert(text.includes(marker));
      report.tests.push({
        kind: "prompt",
        effort,
        context,
        stopReason: result.stopReason,
        text,
        updateTypes: [...new Set(c.updates.map((p) => p.update.sessionUpdate))],
      });
      save();
      console.log("PROMPT_OK", effort, context, text);
    }
    await c.connection.unstable_closeSession({ sessionId: s.sessionId });
    c.close();
    c = connect();
    await initialize(c);
  }
  const loaded = await c.connection.loadSession({
    sessionId: s.sessionId,
    cwd: dir,
    mcpServers: [],
  });
  assert.equal(
    loaded.configOptions.find((o) => o.id === "max_context_tokens").currentValue,
    "1000000",
  );
  assert(c.updates.some((p) => p.update.content?.text?.includes("PASEO_DESKTOP_MAX_OK")));
  report.tests.push({ kind: "restart-load", replayUpdates: c.updates.length, context: "1000000" });
  save();
  console.log("RESTART_LOAD_OK");
  const listed = await c.connection.listSessions({ cwd: dir });
  assert(listed.sessions.some((x) => x.sessionId === s.sessionId));
  report.tests.push({ kind: "list", found: true });
  save();
  c.updates.length = 0;
  let sent = false,
    cancelPromise;
  c.setOnUpdate(() => {
    if (!sent) {
      sent = true;
      cancelPromise = c.connection.cancel({ sessionId: s.sessionId });
    }
  });
  const result = await c.connection.prompt({
    sessionId: s.sessionId,
    prompt: [
      {
        type: "text",
        text: "Cancellation test. Do not use tools or read files. Write a very long explanation of prime numbers, at least 3000 words.",
      },
    ],
  });
  await cancelPromise;
  assert(sent);
  assert.equal(result.stopReason, "cancelled");
  report.tests.push({ kind: "cancel", stopReason: result.stopReason });
  save();
  console.log("CANCEL_OK");
  await c.connection.unstable_closeSession({ sessionId: s.sessionId });
} catch (e) {
  report.error = e.message;
  console.error(e);
  process.exitCode = 1;
} finally {
  save();
  c?.close();
}
