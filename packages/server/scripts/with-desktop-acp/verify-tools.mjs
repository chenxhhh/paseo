import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
const dir = path.dirname(fileURLToPath(import.meta.url));
const report = {
  started: new Date().toISOString(),
  confirmations: [],
  tools: [],
  types: [],
  text: "",
};
const child = spawn(process.execPath, [path.join(dir, "index.cjs")], {
  windowsHide: true,
  stdio: ["pipe", "pipe", "pipe"],
});
child.stderr.on("data", (b) => process.stderr.write(b));
const conn = new ClientSideConnection(
  () => ({
    sessionUpdate: async (p) => {
      const u = p.update;
      if (!report.types.includes(u.sessionUpdate)) report.types.push(u.sessionUpdate);
      if (u.sessionUpdate === "agent_message_chunk") report.text += u.content.text || "";
      if (u.sessionUpdate === "tool_call" || u.sessionUpdate === "tool_call_update")
        report.tools.push(u);
    },
    requestPermission: async (p) => {
      report.confirmations.push(p);
      const reject = p.options.find((o) => o.kind === "reject_once");
      return {
        outcome: reject
          ? { outcome: "selected", optionId: reject.optionId }
          : { outcome: "cancelled" },
      };
    },
  }),
  ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
);
try {
  await conn.initialize({ protocolVersion: 1, clientCapabilities: {} });
  const s = await conn.newSession({ cwd: dir, mcpServers: [] });
  report.sessionId = s.sessionId;
  await conn.setSessionConfigOption({
    sessionId: s.sessionId,
    configId: "model",
    value: "ext-glm-5.3",
  });
  await conn.setSessionConfigOption({
    sessionId: s.sessionId,
    configId: "reasoning_effort",
    value: "high",
  });
  const timer = setTimeout(() => conn.cancel({ sessionId: s.sessionId }), 120000);
  try {
    report.result = await conn.prompt({
      sessionId: s.sessionId,
      prompt: [
        {
          type: "text",
          text: "This is a tool permission bridge test. Invoke terminal exactly once with the harmless PowerShell command Write-Output PASEO_PERMISSION_TEST and risk_level high, to exercise user confirmation (not because the command itself is dangerous). If rejected, do not retry or use another tool. Do not read, write or delete files. Do not install anything or access the network. If tools cannot be used, say so. Then summarize the observed outcome briefly.",
        },
      ],
    });
  } finally {
    clearTimeout(timer);
  }
  await conn.unstable_closeSession({ sessionId: s.sessionId });
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  report.error = e.message;
  console.error(e);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(
    process.env.WITH_BRIDGE_TOOL_OUTPUT || path.join(dir, "tool-result.json"),
    JSON.stringify(report, null, 2),
  );
  child.stdin.end();
}
