"use strict";
// Live acceptance probe for closed-session restoration semantics through the
// knot-acp-metadata adapter:
//   phase 1: one short real turn pinning a unique token, then session/close
//   phase 2 (fresh adapter + CLI process): session/load must NOT replay the
//            prior conversation as session/update events (Paseo keeps its own
//            timeline; replay would duplicate items), then session/resume and
//            one prompt proving the agent still remembers the token.
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { parseArgs } = require("./index.cjs");

const opts = parseArgs(process.argv.slice(2));
const root = opts["--runtime-root"];
const reportPath = opts["--audit"];
if (!root || !reportPath) throw new Error("Live probe requires --runtime-root and --audit");
fs.mkdirSync(root, { recursive: true });

const TOKEN = "HISTORY_ALPHA_" + Math.random().toString(36).slice(2, 8).toUpperCase();
const report = { started: new Date().toISOString(), token: TOKEN, tests: [], promptsSent: 0 };
const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

const brief = (options) =>
  Object.fromEntries(
    (options || [])
      .filter((o) => ["model", "reasoning_effort", "max_context_tokens"].includes(o.id))
      .map((o) => [o.id, o.currentValue ?? null]),
  );
const collect = (c, from) =>
  c.updates
    .slice(from)
    .filter((u) => u.update?.sessionUpdate === "agent_message_chunk")
    .map((u) => u.update.content?.text || "")
    .join("");

let seq = 0;
let processNumber = 0;
async function connect() {
  const env = { ...process.env };
  for (const key of [
    "BG_AGENT_TOKEN",
    "BG_USER_TOKEN",
    "KNOT_JWT_TOKEN",
    "KNOT_METADATA_CAPTURE_TEST",
    "STUB_SNAPSHOT_OUT",
    "PASEO_MCP_SERVERS_JSON",
  ])
    delete env[key];
  const child = spawn(
    process.execPath,
    [
      path.join(__dirname, "index.cjs"),
      "--cli",
      opts["--cli"],
      "--config",
      opts["--config"],
      "--runtime-root",
      root,
      "--audit",
      path.join(root, `adapter-audit-${++processNumber}.json`),
    ],
    { cwd: root, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  const pending = new Map();
  const updates = [];
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (m.method && m.id != null) {
      child.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: m.id,
          error: { code: -32601, message: "Probe client does not permit this request" },
        }) + "\n",
      );
    } else if (pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      clearTimeout(p.timer);
      m.error
        ? p.reject(Object.assign(new Error(m.error.message), { code: m.error.code }))
        : p.resolve(m.result);
    } else if (m.method === "session/update") updates.push(m.params);
  });
  const rpc = (method, params, timeout = 30000) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(method + " timeout"));
      }, timeout);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  return {
    rpc,
    updates,
    async close() {
      child.stdin.end();
      await new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        const timer = setTimeout(() => {
          child.kill();
          resolve();
        }, 12000);
        child.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}

const initialize = (c) =>
  c.rpc("initialize", {
    protocolVersion: 1,
    clientCapabilities: {},
    clientInfo: { name: "paseo-route-a-history-test", version: "1" },
  });

(async () => {
  let c = await connect();
  await initialize(c);
  const session = await c.rpc("session/new", { cwd: root, mcpServers: [] });
  const sessionId = session.sessionId;
  report.sessionId = sessionId;
  save();
  await c.rpc("session/set_config_option", { sessionId, configId: "model", value: "ext-glm-5.3" });
  const start = c.updates.length;
  report.promptsSent++;
  save();
  const first = await c.rpc(
    "session/prompt",
    {
      sessionId,
      prompt: [
        {
          type: "text",
          text: `Connectivity test only. Do not call tools, read files, use network or change anything. Reply exactly ${TOKEN}.`,
        },
      ],
    },
    180000,
  );
  const firstText = collect(c, start);
  report.phase1 = {
    stopReason: first?.stopReason,
    pinned: firstText.includes(TOKEN),
    text: firstText.slice(0, 200),
  };
  save();
  await c.rpc("session/close", { sessionId });
  await c.close();

  c = await connect();
  await initialize(c);
  const loadStart = c.updates.length;
  const loaded = await c.rpc("session/load", { sessionId, cwd: root, mcpServers: [] });
  // Catch replay pushes that arrive asynchronously after the load response.
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const replayUpdates = c.updates.slice(loadStart);
  report.load = {
    settings: brief(loaded.configOptions),
    replayUpdateCount: replayUpdates.length,
    replayKinds: [...new Set(replayUpdates.map((u) => u.update?.sessionUpdate))],
    replayContainsToken: replayUpdates.some((u) => JSON.stringify(u).includes(TOKEN)),
  };
  save();
  const resumed = await c.rpc("session/resume", { sessionId, cwd: root, mcpServers: [] });
  report.resumeSettings = brief(resumed.configOptions);
  const resumeStart = c.updates.length;
  report.promptsSent++;
  save();
  const second = await c.rpc(
    "session/prompt",
    {
      sessionId,
      prompt: [
        {
          type: "text",
          text: "Do not call tools, read files, use network or change anything. In my first message I asked you to reply with one specific token. Reply with only that exact token.",
        },
      ],
    },
    180000,
  );
  const secondText = collect(c, resumeStart);
  report.resume = {
    stopReason: second?.stopReason,
    text: secondText.slice(0, 200),
    remembered: secondText.includes(TOKEN),
  };
  report.noDuplicateReplayOnLoad = report.load.replayUpdateCount === 0;
  report.contextPreserved = report.resume.remembered;
  report.passed = report.noDuplicateReplayOnLoad && report.contextPreserved;
  save();
  await c.rpc("session/close", { sessionId });
  await c.close();
})()
  .catch((e) => {
    report.error = e.message;
    report.errorCode = e.code;
    process.exitCode = 1;
  })
  .finally(() => {
    report.finished = new Date().toISOString();
    save();
    console.log(JSON.stringify(report, null, 2));
  });
