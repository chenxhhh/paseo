"use strict";
// Live acceptance probe for remote MCP transports through the production
// injection path (PASEO_MCP_SERVERS_JSON -> session-private mcp_config_path):
//   paseo-sse    : legacy SSE transport (GET /sse stream + POST /messages)
//   paseo-http   : streamable HTTP (POST /mcp, JSON responses)
//   route-a-stdio: control server (existing test-mcp.cjs) proving that this
//                  run's injection itself works if the remote transports do
//                  not register.
// One real chat turn asks the agent to call each probe tool once. All servers
// are loopback-only, read-only and marker-returning; no filesystem, shell or
// network side effects beyond loopback connections.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { randomBytes } = require("node:crypto");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { parseArgs } = require("./index.cjs");

const opts = parseArgs(process.argv.slice(2));
const root = opts["--runtime-root"];
const reportPath = opts["--audit"];
if (!root || !reportPath) throw new Error("Live probe requires --runtime-root and --audit");
fs.mkdirSync(root, { recursive: true });

const SSE_MARKER = "SSE_MCP_" + randomBytes(6).toString("hex");
const HTTP_MARKER = "HTTP_MCP_" + randomBytes(6).toString("hex");
const report = {
  started: new Date().toISOString(),
  markers: { sse: SSE_MARKER, http: HTTP_MARKER },
  sseEvents: [],
  httpMethods: [],
  cliMcpLogLines: [],
  tests: [],
  promptsSent: 0,
};
const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
const push = (list, item) => {
  list.push(item);
  save();
};

function mcpResult(method, params, toolName, marker) {
  if (method === "initialize")
    return {
      protocolVersion: params?.protocolVersion ?? "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "route-a-transport-probe", version: "1" },
    };
  if (method === "ping") return {};
  if (method === "tools/list")
    return {
      tools: [
        {
          name: toolName,
          description:
            "Read-only connectivity probe. Returns a fixed marker. No filesystem, shell or network side effects.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
        },
      ],
    };
  if (method === "tools/call" && params?.name === toolName)
    return { content: [{ type: "text", text: marker }] };
  return null;
}

const sseStreams = new Map();
const sseServer = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/sse") {
    const sid = randomBytes(8).toString("hex");
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(`event: endpoint\ndata: http://127.0.0.1:${sseServer.address().port}/messages?sid=${sid}\n\n`);
    sseStreams.set(sid, res);
    push(report.sseEvents, { event: "open", sid });
    req.on("close", () => {
      sseStreams.delete(sid);
      push(report.sseEvents, { event: "close", sid });
    });
    return;
  }
  if (req.method === "POST" && req.url.startsWith("/messages")) {
    const sid = new URL(req.url, "http://127.0.0.1").searchParams.get("sid");
    let body = "";
    req.on("data", (b) => {
      if (body.length < 200000) body += b;
    });
    req.on("end", () => {
      res.writeHead(202);
      res.end();
      let m;
      try {
        m = JSON.parse(body);
      } catch {
        return;
      }
      push(report.sseEvents, { event: "post", method: m.method, hasId: m.id != null });
      const stream = sseStreams.get(sid);
      if (m.id == null || !stream) return;
      const result = mcpResult(m.method, m.params, "route_a_sse_probe", SSE_MARKER);
      stream.write(
        `data: ${JSON.stringify(
          result === null
            ? { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "unsupported" } }
            : { jsonrpc: "2.0", id: m.id, result },
        )}\n\n`,
      );
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

const httpServer = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/mcp") {
    res.writeHead(404);
    res.end();
    return;
  }
  let body = "";
  req.on("data", (b) => {
    if (body.length < 200000) body += b;
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
    push(report.httpMethods, m.method);
    if (m.id == null) {
      res.writeHead(202);
      res.end();
      return;
    }
    const result = mcpResult(m.method, m.params, "route_a_http_probe", HTTP_MARKER);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify(
        result === null
          ? { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "unsupported" } }
          : { jsonrpc: "2.0", id: m.id, result },
      ),
    );
  });
});

let seq = 0;
let processNumber = 0;
let child;
const pending = new Map();
const updates = [];
function rpc(method, params, timeout = 30000) {
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

async function connect() {
  const env = { ...process.env };
  for (const key of [
    "BG_AGENT_TOKEN",
    "BG_USER_TOKEN",
    "KNOT_JWT_TOKEN",
    "KNOT_METADATA_CAPTURE_TEST",
    "STUB_SNAPSHOT_OUT",
  ])
    delete env[key];
  env.PASEO_MCP_SERVERS_JSON = JSON.stringify({
    "paseo-sse": { type: "sse", url: report.servers["paseo-sse"] },
    "paseo-http": { type: "http", url: report.servers["paseo-http"] },
    "route-a-stdio": {
      type: "stdio",
      command: process.execPath,
      args: [path.join(__dirname, "test-mcp.cjs"), path.join(root, "stdio-audit.json")],
    },
  });
  const audit = path.join(root, `adapter-audit-${++processNumber}.json`);
  child = spawn(
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
  readline.createInterface({ input: child.stderr }).on("line", (line) => {
    if (/mcp/i.test(line) && report.cliMcpLogLines.length < 50)
      push(report.cliMcpLogLines, line.slice(0, 400));
  });
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (m.method && m.id != null) {
      // This probe never grants filesystem/terminal permission requests.
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
}

(async () => {
  await new Promise((resolve) => sseServer.listen(0, "127.0.0.1", resolve));
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  report.servers = {
    "paseo-sse": `http://127.0.0.1:${sseServer.address().port}/sse`,
    "paseo-http": `http://127.0.0.1:${httpServer.address().port}/mcp`,
  };
  save();
  await connect();
  await rpc("initialize", {
    protocolVersion: 1,
    clientCapabilities: {},
    clientInfo: { name: "paseo-route-a-transport-test", version: "1" },
  });
  const session = await rpc("session/new", { cwd: root, mcpServers: [] });
  const sessionId = session.sessionId;
  report.sessionId = sessionId;
  save();
  await rpc("session/set_config_option", { sessionId, configId: "model", value: "ext-glm-5.3" });
  // Give the CLI time to finish (re)connecting MCP servers from its config.
  await new Promise((resolve) => setTimeout(resolve, 5000));
  report.afterSessionNew = { sse: [...report.sseEvents], http: [...report.httpMethods] };
  save();
  const start = updates.length;
  report.promptsSent++;
  save();
  const response = await rpc(
    "session/prompt",
    {
      sessionId,
      prompt: [
        {
          type: "text",
          text: "Connectivity test. Call the tool route_a_sse_probe from server paseo-sse once, then route_a_http_probe from paseo-http once, then route_a_probe from route-a-stdio once. Reply with only the three returned markers in order, separated by single spaces. Do not call other tools, read files or use the network.",
        },
      ],
    },
    240000,
  );
  const text = updates
    .slice(start)
    .filter((u) => u.update?.sessionUpdate === "agent_message_chunk")
    .map((u) => u.update.content?.text || "")
    .join("");
  const stdioAudit = fs.existsSync(path.join(root, "stdio-audit.json"))
    ? JSON.parse(fs.readFileSync(path.join(root, "stdio-audit.json"), "utf8"))
    : null;
  const t = {
    kind: "mcp-transports",
    stopReason: response?.stopReason,
    text,
    sseConnected: report.sseEvents.some((e) => e.event === "post" && e.method === "initialize"),
    sseToolCall: report.sseEvents.some((e) => e.event === "post" && e.method === "tools/call"),
    httpConnected: report.httpMethods.includes("initialize"),
    httpToolCall: report.httpMethods.includes("tools/call"),
    stdioMethods: stdioAudit?.methods ?? [],
  };
  t.sseMarkerReturned = text.includes(SSE_MARKER);
  t.httpMarkerReturned = text.includes(HTTP_MARKER);
  t.stdioMarkerReturned = Boolean(stdioAudit && text.includes(stdioAudit.marker));
  t.passed = t.sseToolCall && t.httpToolCall && t.sseMarkerReturned && t.httpMarkerReturned;
  report.tests.push(t);
  save();
  try {
    await rpc("session/close", { sessionId });
  } catch {}
})()
  .catch((e) => {
    report.error = e.message;
    report.errorCode = e.code;
    process.exitCode = 1;
  })
  .finally(async () => {
    if (child && child.exitCode === null) {
      child.stdin.end();
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill();
          resolve();
        }, 10000);
        child.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    for (const server of [sseServer, httpServer]) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    report.finished = new Date().toISOString();
    save();
    console.log(JSON.stringify(report, null, 2));
  });
