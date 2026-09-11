"use strict";
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");
const assert = require("node:assert/strict");
const { parseArgs } = require("./index.cjs");
const opts = parseArgs(process.argv.slice(2));
const root = opts["--runtime-root"];
if (!root || !opts["--audit"])
  throw new Error("Live test requires --runtime-root and --audit report path");
fs.mkdirSync(root, { recursive: true });
const report = { started: new Date().toISOString(), tests: [], promptsSent: 0, permissions: [] };
const save = () => fs.writeFileSync(opts["--audit"], JSON.stringify(report, null, 2));
const brief = (options) =>
  (options || []).filter((o) =>
    ["reasoning_effort", "max_context_tokens", "enable_thinking"].includes(o.id),
  );
let processNumber = 0;
function connect() {
  const env = { ...process.env };
  for (const key of ["BG_AGENT_TOKEN", "BG_USER_TOKEN", "KNOT_JWT_TOKEN"]) delete env[key];
  const audit = path.join(root, `proxy-audit-${++processNumber}.json`);
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
      audit,
    ],
    { cwd: root, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  let seq = 0;
  const pending = new Map();
  const updates = [];
  const clientCalls = [];
  const diagnosticLines = readline.createInterface({ input: child.stderr });
  diagnosticLines.on("line", (line) => {
    const decoded = line.replace(/\\"/g, '"');
    const fields = {};
    for (const name of [
      "model",
      "reasoning_effort",
      "max_context_tokens",
      "enable_thinking",
      "session_id",
    ]) {
      const match = decoded.match(
        new RegExp('"' + name + '"\\s*:\\s*("[a-zA-Z0-9_.:-]{0,120}"|[0-9]+|true|false)'),
      );
      if (match) fields[name] = JSON.parse(match[1]);
    }
    if (Object.keys(fields).length) {
      report.diagnostics ||= [];
      if (report.diagnostics.length < 200)
        report.diagnostics.push({
          source: "cli-stderr",
          requestMarker: /request|chat_extra|AskAgent|completion/i.test(decoded),
          fields,
        });
    }
  });
  const rejectAll = (error) => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    pending.clear();
  };
  child.once("error", rejectAll);
  child.once("exit", (code) => rejectAll(new Error("Wrapper exited " + code)));
  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (m.method && m.id != null) {
      clientCalls.push(m.method);
      if (m.method === "session/request_permission") {
        report.permissions.push({
          options: m.params?.options?.map((o) => ({ kind: o.kind, optionId: o.optionId })),
          response: "cancelled",
        });
        child.stdin.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: m.id,
            result: { outcome: { outcome: "cancelled" } },
          }) + "\n",
        );
      } else
        child.stdin.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: m.id,
            error: {
              code: -32601,
              message: "Test client does not permit filesystem or terminal operations",
            },
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
  function rpc(method, params, timeout = 90000) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(method + " timeout"));
      }, timeout);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  const notify = (method, params) =>
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  return {
    rpc,
    notify,
    updates,
    clientCalls,
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
      rl.close();
      rejectAll(new Error("Closed"));
      if (fs.existsSync(audit))
        report.tests.push({ kind: "proxy-audit", ...JSON.parse(fs.readFileSync(audit, "utf8")) });
    },
  };
}
async function initialize(c) {
  return c.rpc("initialize", {
    protocolVersion: 1,
    clientCapabilities: {},
    clientInfo: { name: "paseo-knot-metadata-test", version: "1" },
  });
}
let c;
let sessionId;
(async () => {
  c = connect();
  report.initialize = await initialize(c);
  save();
  const session = await c.rpc("session/new", { cwd: root, mcpServers: [] });
  sessionId = session.sessionId;
  report.sessionId = sessionId;
  report.modes = session.modes;
  report.modelCount = session.configOptions?.find((o) => o.id === "model")?.options?.length;
  save();
  await c.rpc("session/set_config_option", { sessionId, configId: "model", value: "ext-glm-5.3" });
  if (session.modes?.availableModes?.some((m) => m.id === "manual"))
    await c.rpc("session/set_mode", { sessionId, modeId: "manual" });
  for (const [effort, context] of [
    ["high", "200000"],
    ["max", "1000000"],
  ]) {
    const r = { kind: "real-prompt", effort, context };
    report.tests.push(r);
    let settings = await c.rpc("session/set_config_option", {
      sessionId,
      configId: "reasoning_effort",
      value: effort,
    });
    assert.equal(
      settings.configOptions.find((o) => o.id === "reasoning_effort").currentValue,
      effort,
    );
    settings = await c.rpc("session/set_config_option", {
      sessionId,
      configId: "max_context_tokens",
      value: context,
    });
    assert.equal(
      settings.configOptions.find((o) => o.id === "max_context_tokens").currentValue,
      context,
    );
    r.settings = brief(settings.configOptions);
    save();
    const start = c.updates.length;
    report.promptsSent++;
    save();
    r.response = await c.rpc(
      "session/prompt",
      {
        sessionId,
        prompt: [
          {
            type: "text",
            text: "Connectivity test only. Do not call tools, read files, use network or change anything. Reply exactly ROUTE_A_OK.",
          },
        ],
      },
      180000,
    );
    const updates = c.updates.slice(start);
    r.updateKinds = [...new Set(updates.map((u) => u.update?.sessionUpdate))];
    r.text = updates
      .filter((u) => u.update?.sessionUpdate === "agent_message_chunk")
      .map((u) => u.update.content?.text || "")
      .join("");
    r.passed = r.response?.stopReason === "end_turn" && r.text.includes("ROUTE_A_OK");
    save();
    if (!r.passed) throw new Error("Real prompt did not complete successfully");
  }
  await c.rpc("session/set_config_option", { sessionId, configId: "model", value: "gpt-6-astra" });
  const g = await c.rpc("session/set_config_option", {
    sessionId,
    configId: "max_context_tokens",
    value: "1000000",
  });
  assert.equal(g.configOptions.find((o) => o.id === "max_context_tokens").currentValue, "1000000");
  let rejected = false;
  try {
    await c.rpc("session/set_config_option", {
      sessionId,
      configId: "max_context_tokens",
      value: "200000",
    });
  } catch (e) {
    rejected = e.code === -32602;
  }
  assert(rejected);
  report.tests.push({ kind: "gpt-settings", accepted1M: true, rejected200K: true });
  save();
  await c.rpc("session/set_config_option", { sessionId, configId: "model", value: "ext-glm-5.3" });
  await c.rpc("session/set_config_option", {
    sessionId,
    configId: "reasoning_effort",
    value: "max",
  });
  await c.rpc("session/set_config_option", {
    sessionId,
    configId: "max_context_tokens",
    value: "1000000",
  });
  await c.rpc("session/close", { sessionId });
  await c.close();
  c = connect();
  await initialize(c);
  const loaded = await c.rpc("session/load", { sessionId, cwd: root, mcpServers: [] });
  report.tests.push({
    kind: "load-after-restart",
    settings: brief(loaded.configOptions),
    replayUpdates: c.updates.length,
  });
  save();
  const listing = await c.rpc("session/list", { cwd: root });
  assert(listing.sessions?.some((s) => s.sessionId === sessionId));
  report.tests.push({ kind: "list-own-session", found: true });
  const resumed = await c.rpc("session/resume", { sessionId, cwd: root, mcpServers: [] });
  report.tests.push({ kind: "resume-after-close", settings: brief(resumed.configOptions) });
  report.promptsSent++;
  save();
  const cancelStart = c.updates.length;
  let cancelSent = false;
  const turn = c.rpc(
    "session/prompt",
    {
      sessionId,
      prompt: [
        {
          type: "text",
          text: "Do not call tools or read files. Write a detailed 2000-word explanation of binary search.",
        },
      ],
    },
    90000,
  );
  const timer = setInterval(() => {
    if (
      !cancelSent &&
      c.updates
        .slice(cancelStart)
        .some((u) =>
          ["agent_message_chunk", "agent_thought_chunk"].includes(u.update?.sessionUpdate),
        )
    ) {
      cancelSent = true;
      c.notify("session/cancel", { sessionId });
    }
  }, 100);
  try {
    const response = await turn;
    report.tests.push({
      kind: "cancel",
      cancelSent,
      response,
      passed: cancelSent && response.stopReason === "cancelled",
    });
  } catch (e) {
    report.tests.push({
      kind: "cancel",
      cancelSent,
      error: e.message,
      code: e.code,
      passed: false,
    });
  } finally {
    clearInterval(timer);
  }
  await c.rpc("session/close", { sessionId });
  save();
  const mcpAudit = path.join(root, "mcp-audit.json");
  const mcp = await c.rpc("session/new", {
    cwd: root,
    mcpServers: [
      {
        name: "route-a-test",
        command: process.execPath,
        args: [path.join(__dirname, "test-mcp.cjs"), mcpAudit],
        env: [],
      },
    ],
  });
  const mcpId = mcp.sessionId;
  report.mcpSessionId = mcpId;
  await c.rpc("session/set_config_option", {
    sessionId: mcpId,
    configId: "model",
    value: "ext-glm-5.3",
  });
  await c.rpc("session/set_config_option", {
    sessionId: mcpId,
    configId: "reasoning_effort",
    value: "high",
  });
  const start = c.updates.length;
  report.promptsSent++;
  save();
  const response = await c.rpc(
    "session/prompt",
    {
      sessionId: mcpId,
      prompt: [
        {
          type: "text",
          text: "Connectivity test: call ONLY the injected route_a_probe tool from route-a-test once and reply with its exact returned marker. Do not use other tools, filesystem, terminal, or network.",
        },
      ],
    },
    180000,
  );
  const text = c.updates
    .slice(start)
    .filter((u) => u.update?.sessionUpdate === "agent_message_chunk")
    .map((u) => u.update.content?.text || "")
    .join("");
  const evidence = fs.existsSync(mcpAudit) ? JSON.parse(fs.readFileSync(mcpAudit, "utf8")) : null;
  report.tests.push({
    kind: "mcp-stdio",
    response,
    text,
    evidence,
    passed: evidence?.methods.includes("tools/call") && text.includes(evidence.marker),
  });
  await c.rpc("session/close", { sessionId: mcpId });
  save();
})()
  .catch((e) => {
    report.error = e.message;
    report.errorCode = e.code;
    process.exitCode = 1;
  })
  .finally(async () => {
    if (c) await c.close();
    report.finished = new Date().toISOString();
    save();
    console.log(JSON.stringify(report, null, 2));
  });
