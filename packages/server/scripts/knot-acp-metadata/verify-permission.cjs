"use strict";
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { spawn, execFileSync } = require("node:child_process");
const yaml = require("js-yaml");
const { startProxy } = require("./proxy.cjs");
const { DesktopTransport, discoverEndpoint } = require("../with-desktop-acp/transport.cjs");
const { modelsFrom } = require("../with-desktop-acp/bridge.cjs");

const [cli, sourceConfig, root, output] = process.argv.slice(2);
if (!cli || !sourceConfig || !root || !output)
  throw new Error("Expected CLI CONFIG TEST_DIR REPORT");
fs.mkdirSync(root, { recursive: true });
const disposable = path.join(root, "disposable.txt");
fs.writeFileSync(disposable, "created only to be deleted by the permission test\n");
const report = {
  started: new Date().toISOString(),
  permissions: [],
  clientCalls: [],
  promptsSent: 0,
};
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));

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
    } else if (m.method && m.id != null) {
      report.clientCalls.push(m.method);
      if (m.method === "session/request_permission") {
        report.permissions.push({
          sessionId: m.params?.sessionId,
          options: m.params?.options?.map((o) => ({
            optionId: o.optionId,
            kind: o.kind,
            title: o.call?.title,
          })),
          response: "cancelled",
        });
        save();
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
            error: { code: -32601, message: "Test client permits no client-side tools" },
          }) + "\n",
        );
    } else if (m.method === "session/update") updates.push(m.params);
  });

  await rpc("initialize", {
    protocolVersion: 1,
    clientCapabilities: {},
    clientInfo: { name: "paseo-permission-test", version: "1" },
  });
  const session = await rpc("session/new", { cwd: root, mcpServers: [] });
  const sessionId = session.sessionId;
  report.mode = session.modes?.currentModeId;
  await rpc("session/set_config_option", { sessionId, configId: "model", value: "ext-glm-5.3" });
  report.promptsSent++;
  save();
  const start = updates.length;
  const response = await rpc("session/prompt", {
    sessionId,
    prompt: [
      {
        type: "text",
        text:
          "Permission behavior test. Use the terminal tool to run exactly this PowerShell command and nothing else: Remove-Item -Path '" +
          disposable.replace(/'/g, "''") +
          "' -ErrorAction SilentlyContinue. Then reply exactly PERM_DONE.",
      },
    ],
  });
  report.stopReason = response.stopReason;
  report.text = updates
    .slice(start)
    .filter((u) => u.update?.sessionUpdate === "agent_message_chunk")
    .map((u) => u.update.content?.text || "")
    .join("");
  report.toolCalls = updates
    .slice(start)
    .filter((u) => u.update?.sessionUpdate === "tool_call")
    .map((u) => ({ kind: u.update.toolCallInfo?.kind, title: u.update.toolCallInfo?.title }));
  report.fileDeletedAfterRun = !fs.existsSync(disposable);
  report.permissionRequestCount = report.permissions.length;
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
          const t2 = setTimeout(() => {
            child.kill();
            r();
          }, 8000);
          child.once("close", () => {
            clearTimeout(t2);
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
          stopReason: report.stopReason,
          permissionRequestCount: report.permissionRequestCount,
          permissions: report.permissions,
          toolCalls: report.toolCalls,
          fileDeletedAfterRun: report.fileDeletedAfterRun,
          text: (report.text || "").slice(0, 300),
          error: report.error,
        },
        null,
        2,
      ),
    );
  });
