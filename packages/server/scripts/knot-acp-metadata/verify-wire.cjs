"use strict";
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { spawn, execFileSync } = require("node:child_process");
const assert = require("node:assert/strict");
const yaml = require("js-yaml");
const { startProxy } = require("./proxy.cjs");
const { DesktopTransport, discoverEndpoint } = require("../with-desktop-acp/transport.cjs");
const { modelsFrom } = require("../with-desktop-acp/bridge.cjs");

const [cli, sourceConfig, root, output] = process.argv.slice(2);
if (!cli || !sourceConfig || !root || !output)
  throw new Error("Expected CLI CONFIG TEST_DIR REPORT");
fs.mkdirSync(root, { recursive: true });
// The CLI does not create the log directory itself; without it, logging fails silently.
fs.mkdirSync(path.join(root, "log"), { recursive: true });
const report = {
  started: new Date().toISOString(),
  promptsSent: 0,
  wireEvidence: [],
  logFindings: {},
};
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));

function latestCliLog() {
  // The CLI resolves its log directory against a workspace root, not the process cwd:
  // observed writing to an ancestor's existing log/ directory. Scan the test root,
  // its ancestors, and the bg-agent home log; pick the newest agent log file.
  const candidates = [];
  let dir = path.resolve(root);
  for (let i = 0; i < 6; i++) {
    candidates.push(path.join(dir, "log"));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  candidates.push(path.join(process.env.USERPROFILE || "", ".bg-agent", "log"));
  const files = [];
  for (const d of candidates) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (!f.endsWith(".log")) continue;
      const p = path.join(d, f);
      try {
        const st = fs.statSync(p);
        if (st.isFile()) files.push({ p, mtime: st.mtimeMs, size: st.size });
      } catch {}
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  return files[0] || null;
}

function extractWireFields(logPath, sessionId) {
  const text = fs.readFileSync(logPath, "utf8");
  const findings = { requestBodies: [], dispatches: [], logPath, servers: [], mcpLines: [] };
  for (const line of text.split("\n")) {
    if (
      sessionId &&
      !line.includes(sessionId) &&
      !line.includes("GetToolsByServer:") &&
      !/mcpServers/i.test(line)
    )
      continue;
    if (line.includes("requestBody:") && line.includes("chat_extra")) {
      const fields = {};
      for (const name of [
        "model",
        "reasoning_effort",
        "max_context_tokens",
        "enable_thinking",
        "enable_web_search",
        "chat_mode",
        "client_version",
      ]) {
        const m = line.match(
          new RegExp('"' + name + '"\\s*:\\s*("[a-zA-Z0-9_.:-]{0,120}"|[0-9]+|true|false)'),
        );
        if (m) fields[name] = JSON.parse(m[1]);
      }
      const ts = line.match(/^(\S+ \S+)/);
      findings.requestBodies.push({ time: ts?.[1], fields });
    } else if (line.includes("[acp] dispatch: method=session/set_config_option")) {
      const m = line.match(/params=(\{.*\})\s*$/);
      let params = null;
      try {
        params = m ? JSON.parse(m[1]) : null;
      } catch {
        params = m ? m[1].slice(0, 200) : null;
      }
      findings.dispatches.push({ time: line.match(/^(\S+ \S+)/)?.[1], params });
    } else if (line.includes("GetToolsByServer:")) {
      const m = line.match(/GetToolsByServer: (\S+)/);
      if (m && !findings.servers.includes(m[1])) findings.servers.push(m[1]);
    } else if (/mcpServers/i.test(line) && !line.includes("dispatch")) {
      if (findings.mcpLines.length < 12) findings.mcpLines.push(line.slice(0, 240));
    }
  }
  return findings;
}

let child, proxy, dir;
const env = { ...process.env };
for (const k of ["BG_AGENT_TOKEN", "BG_USER_TOKEN", "KNOT_JWT_TOKEN", "KNOT_METADATA_CAPTURE_TEST"])
  delete env[k];
let seq = 0;
const pending = new Map();
const updates = [];
function rpc(method, params, timeout = 180000) {
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
(async () => {
  const config = yaml.load(fs.readFileSync(sourceConfig, "utf8"));
  const t = new DesktopTransport(await discoverEndpoint(), { requestTimeout: 15000 });
  let desktopModels;
  try {
    desktopModels = modelsFrom(await t.invoke("get_agent_models"));
  } finally {
    t.close();
  }
  proxy = await startProxy({
    upstream: config.manager.server_url,
    desktopModels,
    allowedModels: ["ext-glm-5.3"],
    onEvent: () => {},
  });
  dir = fs.mkdtempSync(path.join(root, "knot-metadata-"));
  if (process.platform === "win32") {
    const identity = execFileSync("whoami.exe", [], { encoding: "utf8", windowsHide: true }).trim();
    execFileSync("icacls.exe", [dir, "/inheritance:r", "/grant:r", `${identity}:(OI)(CI)F`], {
      stdio: "pipe",
      windowsHide: true,
    });
  } else fs.chmodSync(dir, 0o700);
  config.manager.server_url = proxy.url;
  const tempConfig = path.join(dir, "config.yaml");
  fs.writeFileSync(tempConfig, yaml.dump(config, { noRefs: true }), { mode: 0o600 });
  child = spawn(path.resolve(cli), ["acp", "--no-update", "--config", tempConfig], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();
  const rejectAll = (e) => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(e);
    }
    pending.clear();
  };
  child.once("error", rejectAll);
  child.once("exit", (c) => rejectAll(new Error("CLI exited " + c)));
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      clearTimeout(p.timer);
      m.error
        ? p.reject(Object.assign(new Error(m.error.message), { code: m.error.code }))
        : p.resolve(m.result);
    } else if (m.method && m.id != null)
      child.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: m.id,
          error: { code: -32601, message: "No client tools in wire probe" },
        }) + "\n",
      );
    else if (m.method === "session/update") updates.push(m.params);
  });

  await rpc("initialize", {
    protocolVersion: 1,
    clientCapabilities: {},
    clientInfo: { name: "paseo-wire-evidence", version: "1" },
  });
  const session = await rpc("session/new", {
    cwd: root,
    mcpServers: [
      { type: "http", name: "route-a-wire", url: "http://127.0.0.1:9/mcp", headers: [] },
    ],
  });
  const sessionId = session.sessionId;
  await rpc("session/set_config_option", { sessionId, configId: "model", value: "ext-glm-5.3" });
  for (const [effort, context, marker] of [
    ["high", "200000", "WIRE_HIGH_OK"],
    ["max", "1000000", "WIRE_MAX_OK"],
  ]) {
    let r = await rpc("session/set_config_option", {
      sessionId,
      configId: "reasoning_effort",
      value: effort,
    });
    assert.equal(r.configOptions.find((o) => o.id === "reasoning_effort").currentValue, effort);
    r = await rpc("session/set_config_option", {
      sessionId,
      configId: "max_context_tokens",
      value: context,
    });
    assert.equal(r.configOptions.find((o) => o.id === "max_context_tokens").currentValue, context);
    report.promptsSent++;
    save();
    const start = updates.length;
    const response = await rpc("session/prompt", {
      sessionId,
      prompt: [
        {
          type: "text",
          text:
            "Connectivity test only. Do not call tools, read files, use network or change anything. Reply exactly " +
            marker +
            ".",
        },
      ],
    });
    const text = updates
      .slice(start)
      .filter((u) => u.update?.sessionUpdate === "agent_message_chunk")
      .map((u) => u.update.content?.text || "")
      .join("");
    report.wireEvidence.push({
      effort,
      context,
      stopReason: response.stopReason,
      replied: text.includes(marker),
    });
    save();
    if (response.stopReason !== "end_turn" || !text.includes(marker))
      throw new Error("Prompt failed for " + effort);
  }
  await rpc("session/close", { sessionId });

  const logFile = latestCliLog();
  if (!logFile) throw new Error("No CLI log file found near " + root + " or in ~/.bg-agent/log");
  const findings = extractWireFields(logFile.p, sessionId);
  report.logFindings = {
    logFile: logFile.p,
    logBytes: logFile.size,
    requestBodies: findings.requestBodies,
    dispatches: findings.dispatches,
    mcpServersSeen: findings.servers,
    mcpLines: findings.mcpLines,
  };
  const bodies = findings.requestBodies.filter((b) => Object.keys(b.fields).length);
  const lastBody = bodies[bodies.length - 1];
  report.verdict = {
    requestBodyCount: bodies.length,
    lastBodyFields: lastBody?.fields || null,
    outgoingEffortMatched: lastBody?.fields.reasoning_effort === "max",
    outgoingContextMatched: String(lastBody?.fields.max_context_tokens) === "1000000",
    outgoingModel: lastBody?.fields.model || null,
    injectedServerRegistered: findings.servers.includes("route-a-wire"),
  };
  save();
})()
  .catch((e) => {
    report.error = e.message;
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      if (child && child.exitCode === null) {
        child.stdin.end();
        await new Promise((r) => {
          const t = setTimeout(() => {
            child.kill();
            r();
          }, 8000);
          child.once("close", () => {
            clearTimeout(t);
            r();
          });
        });
      }
    } catch {}
    await proxy?.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    report.finished = new Date().toISOString();
    save();
    console.log(
      JSON.stringify(
        {
          verdict: report.verdict,
          wireEvidence: report.wireEvidence,
          error: report.error,
          mcpServersSeen: report.logFindings?.mcpServersSeen,
          logFile: report.logFindings?.logFile,
        },
        null,
        2,
      ),
    );
  });
