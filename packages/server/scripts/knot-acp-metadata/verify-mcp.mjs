import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
const dir = path.dirname(fileURLToPath(import.meta.url));
const [cli, config, root, output] = process.argv.slice(2);
if (!cli || !config || !root || !output) throw new Error("Expected CLI CONFIG TEST_DIR REPORT");
fs.mkdirSync(root, { recursive: true });
const report = { started: new Date().toISOString(), tests: [] };
for (const variant of ["official", "metadata"]) {
  const r = { variant, httpMethods: [], permissionRequests: 0 };
  report.tests.push(r);
  const marker = "HTTP_MCP_A_" + randomBytes(8).toString("hex");
  const server = http.createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }
    let body = "";
    req.on("data", (b) => {
      if (body.length < 100000) body += b;
    });
    req.on("end", () => {
      let m;
      try {
        m = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }
      r.httpMethods.push(m.method);
      if (m.id == null) {
        res.writeHead(202);
        res.end();
        return;
      }
      let result;
      if (m.method === "initialize")
        result = {
          protocolVersion: m.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "route-a-http", version: "1" },
        };
      else if (m.method === "tools/list")
        result = {
          tools: [
            {
              name: "route_a_http_probe",
              description:
                "Read-only connectivity test returning a marker. No filesystem, shell, network or side effects.",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        };
      else if (m.method === "tools/call" && m.params.name === "route_a_http_probe")
        result = { content: [{ type: "text", text: marker }] };
      else if (m.method === "ping") result = {};
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          result
            ? { jsonrpc: "2.0", id: m.id, result }
            : {
                jsonrpc: "2.0",
                id: m.id,
                error: { code: -32601, message: "Test method unsupported" },
              },
        ),
      );
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const env = { ...process.env };
  for (const k of [
    "BG_AGENT_TOKEN",
    "BG_USER_TOKEN",
    "KNOT_JWT_TOKEN",
    "KNOT_METADATA_CAPTURE_TEST",
  ])
    delete env[k];
  const command = variant === "official" ? cli : process.execPath;
  const args =
    variant === "official"
      ? ["acp", "--no-update", "--config", config]
      : [path.join(dir, "index.cjs"), "--cli", cli, "--config", config, "--runtime-root", root];
  const child = spawn(command, args, {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();
  const updates = [];
  const conn = new ClientSideConnection(
    () => ({
      sessionUpdate: async (p) => {
        updates.push(p);
      },
      requestPermission: async () => {
        r.permissionRequests++;
        return { outcome: { outcome: "cancelled" } };
      },
    }),
    ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
  );
  const timer = setTimeout(() => child.kill(), 180000);
  try {
    const init = await conn.initialize({
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "paseo-route-a-http-test", version: "1" },
    });
    r.capabilities = init.agentCapabilities;
    const s = await conn.newSession({
      cwd: root,
      mcpServers: [
        {
          type: "http",
          name: "route-a-http",
          url: `http://127.0.0.1:${server.address().port}/mcp`,
          headers: [],
        },
      ],
    });
    r.sessionId = s.sessionId;
    await conn.setSessionConfigOption({
      sessionId: s.sessionId,
      configId: "model",
      value: "ext-glm-5.3",
    });
    r.response = await conn.prompt({
      sessionId: s.sessionId,
      prompt: [
        {
          type: "text",
          text: "Connectivity test: call ONLY the injected route_a_http_probe tool from route-a-http once and return its exact marker. If unavailable stop immediately. Do not search for tools, call other tools, read files or run commands.",
        },
      ],
    });
    r.text = updates
      .filter((p) => p.update.sessionUpdate === "agent_message_chunk")
      .map((p) => p.update.content.text || "")
      .join("");
    r.passed = r.httpMethods.includes("tools/call") && r.text.includes(marker);
    await conn.unstable_closeSession({ sessionId: s.sessionId });
  } catch (e) {
    r.error = e.message;
  } finally {
    clearTimeout(timer);
    child.stdin.end();
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      const t = setTimeout(() => {
        child.kill();
        resolve();
      }, 10000);
      child.once("close", () => {
        clearTimeout(t);
        resolve();
      });
    });
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
  }
}
report.finished = new Date().toISOString();
fs.writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
