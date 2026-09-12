"use strict";
// Live acceptance probe for image content blocks over the knot-acp-metadata
// adapter: session/prompt with an ACP image block (a generated 1x1 solid red
// PNG, base64) plus a text block asking for the color name. Records whether
// the CLI accepts the block at the protocol level and whether the model
// actually perceives the color. Primary model gpt-6-astra (whitelisted); one
// fallback attempt with ext-glm-5.3 if the primary accepts the block but the
// color is not perceived.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { parseArgs } = require("./index.cjs");

const opts = parseArgs(process.argv.slice(2));
const root = opts["--runtime-root"];
const reportPath = opts["--audit"];
if (!root || !reportPath) throw new Error("Live probe requires --runtime-root and --audit");
fs.mkdirSync(root, { recursive: true });

const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function solidRedPng() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); // width
  ihdr.writeUInt32BE(1, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  const raw = Buffer.from([0, 255, 0, 0]); // filter byte + RGB red
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
const PNG = solidRedPng();
const PNG_BASE64 = PNG.toString("base64");
const report = {
  started: new Date().toISOString(),
  pngBytes: PNG.length,
  pngBase64Length: PNG_BASE64.length,
  tests: [],
  promptsSent: 0,
};
const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

const collect = (c, from) =>
  c.updates
    .slice(from)
    .filter((u) => u.update?.sessionUpdate === "agent_message_chunk")
    .map((u) => u.update.content?.text || "")
    .join("");

let seq = 0;
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
      path.join(root, "adapter-audit.json"),
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

async function attemptModel(c, sessionId, model) {
  await c.rpc("session/set_config_option", { sessionId, configId: "model", value: model });
  const start = c.updates.length;
  report.promptsSent++;
  save();
  const entry = { model, accepted: false };
  try {
    const response = await c.rpc(
      "session/prompt",
      {
        sessionId,
        prompt: [
          { type: "image", data: PNG_BASE64, mimeType: "image/png" },
          {
            type: "text",
            text: "Connectivity test only. Do not call tools, read files, use network or change anything. The attached image is a single solid color. Reply with only the color name in English.",
          },
        ],
      },
      180000,
    );
    entry.accepted = true;
    entry.stopReason = response?.stopReason;
    entry.text = collect(c, start).slice(0, 300);
    entry.sawRed = /\bred\b/i.test(entry.text);
  } catch (e) {
    entry.error = e.message;
    entry.errorCode = e.code;
  }
  report.tests.push(entry);
  save();
  return entry;
}

(async () => {
  const c = await connect();
  try {
    await c.rpc("initialize", {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "paseo-route-a-image-test", version: "1" },
    });
    const session = await c.rpc("session/new", { cwd: root, mcpServers: [] });
    const sessionId = session.sessionId;
    report.sessionId = sessionId;
    save();
    const primary = await attemptModel(c, sessionId, "gpt-6-astra");
    let fallback = null;
    if (primary.accepted && !primary.sawRed) fallback = await attemptModel(c, sessionId, "ext-glm-5.3");
    const attempts = [primary, fallback].filter(Boolean);
    report.protocolAcceptsImageBlocks = attempts.some((a) => a.accepted);
    report.modelPerceivesImage = attempts.some((a) => a.accepted && a.sawRed);
    report.passed = report.protocolAcceptsImageBlocks && report.modelPerceivesImage;
    save();
    await c.rpc("session/close", { sessionId });
  } finally {
    await c.close();
  }
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
