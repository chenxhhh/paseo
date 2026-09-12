"use strict";
// Dedicated automated regression for the MCP injection + session-isolation
// path of the knot-acp-metadata adapter (index.cjs):
//   PASEO_MCP_SERVERS_JSON -> converted per-session mcp-config.json written
//   into a private knot-metadata-* runtime dir -> mcp_config_path set in the
//   temporary config handed to the CLI, with the source config untouched and
//   the global ~/.bg-agent/mcp_config.json never involved.
//
// The integration cases drive the real launch() with a stub CLI: the adapter
// spawns `--cli acp --no-update --config <path>` with fixed argv, so the stub
// is process.execPath plus an entry file literally named "acp" in the child's
// cwd. No real CLI, no chat, no quota and no desktop state changes are
// involved; the stub only snapshots the files the adapter handed it.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const yaml = require("js-yaml");
const { launch } = require("./index.cjs");

const STUB_CLI = [
  "try {",
  "  const fs = require('node:fs');",
  "  const path = require('node:path');",
  "  const argv = process.argv.slice(2);",
  "  const script = process.argv[1];",
  "  const files = {};",
  "  const i = argv.indexOf('--config');",
  "  if (i >= 0) {",
  "    const dir = path.dirname(path.resolve(argv[i + 1]));",
  "    for (const name of fs.readdirSync(dir)) {",
  "      const p = path.join(dir, name);",
  "      files[name] = fs.statSync(p).isFile() ? fs.readFileSync(p, 'utf8') : '<dir>';",
  "    }",
  "  }",
  "  fs.writeFileSync(process.env.STUB_SNAPSHOT_OUT, JSON.stringify({ script, argv, files }));",
  "} catch (error) {",
  "  process.stderr.write(String((error && error.stack) || error));",
  "}",
  "process.exit(0);",
].join("\n");

function makeDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function runLaunch(servers) {
  const root = makeDir("mcp-inj-root-");
  const stubDir = makeDir("mcp-inj-stub-");
  const outDir = makeDir("mcp-inj-out-");
  const prevEnv = { ...process.env };
  const prevCwd = process.cwd();
  try {
    fs.writeFileSync(path.join(stubDir, "acp"), STUB_CLI);
    const fixture = path.join(outDir, "source-config.yaml");
    const sourceBody = yaml.dump({
      manager: { server_url: "http://127.0.0.1:9/upstream" },
      knot: { url: "https://knot.invalid/knot" },
    });
    fs.writeFileSync(fixture, sourceBody);
    const snapshotPath = path.join(outDir, "snapshot.json");
    const auditPath = path.join(outDir, "audit.json");
    process.env.STUB_SNAPSHOT_OUT = snapshotPath;
    if (servers === undefined) delete process.env.PASEO_MCP_SERVERS_JSON;
    else process.env.PASEO_MCP_SERVERS_JSON = JSON.stringify(servers);
    process.chdir(stubDir);
    const code = await launch({
      "--cli": process.execPath,
      "--config": fixture,
      "--runtime-root": root,
      "--audit": auditPath,
    });
    process.chdir(prevCwd);
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
    const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));
    const config = yaml.load(snapshot.files["config.yaml"]);
    return {
      code,
      snapshot,
      audit,
      config,
      root,
      sourceUnchanged: fs.readFileSync(fixture, "utf8") === sourceBody,
      runtimeSwept: !fs.readdirSync(root).some((name) => name.startsWith("knot-metadata-")),
    };
  } finally {
    process.chdir(prevCwd);
    const keys = new Set(Object.keys(prevEnv));
    for (const key of Object.keys(process.env)) if (!keys.has(key)) delete process.env[key];
    for (const [key, value] of Object.entries(prevEnv)) process.env[key] = value;
    for (const dir of [root, stubDir, outDir]) fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("launch converts and isolates injected MCP servers into the private runtime config", async () => {
  const r = await runLaunch({
    paseo: { type: "stdio", command: "node", args: ["server.js"], env: { TOKEN: "t" } },
    remote: { type: "http", url: "http://127.0.0.1:1/mcp", headers: { Authorization: "Bearer x" } },
    events: { type: "sse", url: "http://127.0.0.1:2/sse" },
    unsupported: { type: "websocket", url: "wss://127.0.0.1:3" },
    incomplete: { type: "stdio" },
  });
  assert.equal(r.code, 0);
  assert.equal(path.basename(r.snapshot.script), "acp");
  assert.deepEqual(r.snapshot.argv.slice(0, 2), ["--no-update", "--config"]);
  assert.ok(path.isAbsolute(r.snapshot.argv[2]));
  // Manager traffic is rerouted through the loopback proxy, never the source URL.
  assert.match(r.config.manager.server_url, /^http:\/\/127\.0\.0\.1:\d+\/local-[0-9a-f]{64}$/);
  // MCP config is per-session: inside this launch's private runtime dir.
  assert.ok(typeof r.config.mcp_config_path === "string");
  assert.ok(r.config.mcp_config_path.startsWith(r.root));
  assert.ok(path.basename(path.dirname(r.config.mcp_config_path)).startsWith("knot-metadata-"));
  assert.deepEqual(JSON.parse(r.snapshot.files["mcp-config.json"]), {
    mcpServers: {
      paseo: { type: "stdio", command: "node", args: ["server.js"], env: { TOKEN: "t" } },
      remote: {
        type: "http",
        transportType: "http",
        url: "http://127.0.0.1:1/mcp",
        headers: { Authorization: "Bearer x" },
      },
      events: { type: "sse", transportType: "sse", url: "http://127.0.0.1:2/sse" },
    },
  });
  assert.deepEqual(
    Object.keys(r.snapshot.files).sort(),
    ["config.yaml", "mcp-config.json", "owner.pid"],
  );
  assert.match(r.snapshot.files["owner.pid"], /^\d+\s*$/);
  const injection = r.audit.events.find((e) => e.type === "mcp-injection");
  assert.deepEqual(injection, {
    type: "mcp-injection",
    servers: ["paseo", "remote", "events"],
    dropped: 2,
  });
  assert.equal(r.runtimeSwept, true, "private runtime dir must be removed on clean exit");
  assert.equal(r.sourceUnchanged, true, "source config must never be modified");
});

test("launch without PASEO_MCP_SERVERS_JSON keeps the config free of MCP keys", async () => {
  const r = await runLaunch(undefined);
  assert.equal(r.code, 0);
  assert.equal("mcp_config_path" in r.config, false);
  assert.deepEqual(Object.keys(r.snapshot.files).sort(), ["config.yaml", "owner.pid"]);
  assert.equal(r.audit.events.some((e) => e.type === "mcp-injection"), false);
  assert.equal(r.runtimeSwept, true);
  assert.equal(r.sourceUnchanged, true);
});

test("launch with an empty, unconvertible or non-object server map skips injection", async () => {
  for (const servers of [{}, { bad: { type: "nope" } }, [1, 2]]) {
    const r = await runLaunch(servers);
    assert.equal(r.code, 0);
    assert.equal("mcp_config_path" in r.config, false);
    assert.deepEqual(Object.keys(r.snapshot.files).sort(), ["config.yaml", "owner.pid"]);
    assert.equal(r.audit.events.some((e) => e.type === "mcp-injection"), false);
    assert.equal(r.sourceUnchanged, true);
  }
});

test("sequential launches never share an MCP config path", async () => {
  const first = await runLaunch({ solo: { type: "stdio", command: "node" } });
  const second = await runLaunch({ other: { type: "sse", url: "http://127.0.0.1:4/sse" } });
  assert.notEqual(first.config.mcp_config_path, second.config.mcp_config_path);
  assert.deepEqual(JSON.parse(first.snapshot.files["mcp-config.json"]).mcpServers, {
    solo: { type: "stdio", command: "node" },
  });
  assert.deepEqual(JSON.parse(second.snapshot.files["mcp-config.json"]).mcpServers, {
    other: { type: "sse", transportType: "sse", url: "http://127.0.0.1:4/sse" },
  });
});

test("release the stdin reference launch() leaves paused", () => {
  // launch() pipes process.stdin into the spawned CLI and only pauses it when
  // it returns; destroy it so an open parent pipe cannot keep the test
  // process alive after the suite finishes.
  process.stdin.destroy();
});
