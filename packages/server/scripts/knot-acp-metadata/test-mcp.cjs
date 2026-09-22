"use strict";
const fs = require("node:fs");
const readline = require("node:readline");
const { randomBytes } = require("node:crypto");
const auditPath = process.argv[2];
if (!auditPath) throw new Error("Test audit path required");
const report = { marker: "MCP_A_" + randomBytes(8).toString("hex"), methods: [] };
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  if (req.id == null) return;
  report.methods.push(req.method);
  fs.writeFileSync(auditPath, JSON.stringify(report, null, 2));
  let result;
  switch (req.method) {
    case "initialize":
      result = {
        protocolVersion: req.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "route-a-test", version: "1" },
      };
      break;
    case "ping":
      result = {};
      break;
    case "tools/list":
      result = {
        tools: [
          {
            name: "route_a_probe",
            description:
              "Harmless local connectivity test. Returns a random marker. Does not access files, shell or network.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
          },
        ],
      };
      break;
    case "tools/call":
      if (req.params.name === "route_a_probe")
        result = { content: [{ type: "text", text: report.marker }], isError: false };
      break;
    case "resources/list":
      result = { resources: [] };
      break;
    case "prompts/list":
      result = { prompts: [] };
      break;
  }
  process.stdout.write(
    JSON.stringify(
      result
        ? { jsonrpc: "2.0", id: req.id, result }
        : {
            jsonrpc: "2.0",
            id: req.id,
            error: { code: -32601, message: "Unsupported test method" },
          },
    ) + "\n",
  );
});
