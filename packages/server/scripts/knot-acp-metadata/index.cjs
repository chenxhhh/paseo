"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn, execFileSync } = require("node:child_process");
const { Transform } = require("node:stream");
const { StringDecoder } = require("node:string_decoder");
const yaml = require("js-yaml");
const { startProxy } = require("./proxy.cjs");
const { cleanupStaleRuntimeDirs, writeOwnerPid } = require("./stale-cleanup.cjs");
const { loadCatalog } = require("./catalog-cache.cjs");
const {
  isEnabled: homeIsolationEnabled,
  createFakeUserDir,
  seedResumeRegistry,
  mirrorSessionEntry,
} = require("./home-isolation.cjs");

// The Knot CLI ignores ACP session/new mcpServers; it loads MCP servers from
// the file named by the `mcp_config_path` key of its server config (verified
// against CLI v0.29: initial load AND the hot-reload watcher both follow it).
// acp-agent.ts exports Paseo's authoritative server map (daemon tool endpoint
// with its capability token plus user-configured servers) through the
// PASEO_MCP_SERVERS_JSON env var; we mirror it into this session's private
// directory so concurrent sessions never fight over the global
// ~/.bg-agent/mcp_config.json.
function convertMcpServer(config) {
  if (!config || typeof config !== "object" || typeof config.type !== "string") return null;
  if (config.type === "stdio") {
    if (typeof config.command !== "string" || !config.command) return null;
    return {
      type: "stdio",
      command: config.command,
      ...(Array.isArray(config.args) ? { args: config.args } : {}),
      ...(config.env && typeof config.env === "object" ? { env: config.env } : {}),
    };
  }
  if (config.type === "http" || config.type === "sse") {
    if (typeof config.url !== "string" || !config.url) return null;
    return {
      type: config.type,
      transportType: config.type,
      url: config.url,
      ...(config.headers && typeof config.headers === "object" ? { headers: config.headers } : {}),
    };
  }
  return null;
}

function mcpServersFromEnv() {
  const raw = process.env.PASEO_MCP_SERVERS_JSON;
  if (!raw) return null;
  let servers;
  try {
    servers = JSON.parse(raw);
  } catch (error) {
    process.stderr.write(`[knot-metadata] PASEO_MCP_SERVERS_JSON parse failed: ${error.message}\n`);
    return null;
  }
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) return null;
  const names = Object.keys(servers);
  if (names.length === 0) return null;
  const converted = {};
  let dropped = 0;
  for (const [name, config] of Object.entries(servers)) {
    const entry = convertMcpServer(config);
    if (entry) converted[name] = entry;
    else dropped += 1;
  }
  if (Object.keys(converted).length === 0) return null;
  return { mcpServers: converted, dropped };
}
class ProtocolOutput extends Transform {
  constructor(onResult) {
    super();
    this.onResult = typeof onResult === "function" ? onResult : null;
    this.text = "";
    this.decoder = new StringDecoder("utf8");
  }
  line(line) {
    if (!line.trim()) return;
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      process.stderr.write("[knot-metadata] ignored non-JSON stdout\n");
      return;
    }
    for (const loc of [m.result, m.params?.update]) {
      for (const option of loc?.configOptions || [])
        if (option.type === "select" && option.options == null) option.options = [];
    }
    if (this.onResult && m.id != null && m.result && typeof m.result === "object") {
      try {
        this.onResult(m);
      } catch (error) {
        process.stderr.write(`[knot-metadata] result hook failed: ${error.message}\n`);
      }
    }
    this.push(JSON.stringify(m) + "\n");
  }
  _transform(chunk, _, done) {
    this.text += this.decoder.write(chunk);
    let i;
    while ((i = this.text.indexOf("\n")) >= 0) {
      this.line(this.text.slice(0, i));
      this.text = this.text.slice(i + 1);
    }
    if (this.text.length > 32 * 1024 * 1024) return done(new Error("ACP line too large"));
    done();
  }
  _flush(done) {
    this.text += this.decoder.end();
    this.line(this.text);
    done();
  }
}
function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (
      !["--cli", "--config", "--runtime-root", "--audit"].includes(argv[i]) ||
      !argv[i + 1] ||
      opts[argv[i]]
    )
      throw new Error("Expected --cli PATH --config PATH [--runtime-root DIR] [--audit PATH]");
    opts[argv[i]] = path.resolve(argv[i + 1]);
  }
  if (!opts["--cli"] || !opts["--config"])
    throw new Error("--cli and --config are required; source config is never modified");
  return opts;
}
async function launch(opts) {
  const audit = { started: new Date().toISOString(), events: [] };
  const onEvent = (e) => {
    if (audit.events.length < 1000) audit.events.push(e);
  };
  const config = yaml.load(fs.readFileSync(opts["--config"], "utf8"));
  if (!config?.manager?.server_url) throw new Error("Source config has no manager.server_url");
  if (!fs.existsSync(opts["--cli"])) throw new Error("CLI executable not found");
  const catalog = await loadCatalog({
    source: opts["--config"],
    log: (message) => process.stderr.write(`[knot-metadata] ${message}\n`),
  });
  const desktopModels = catalog.models;
  onEvent({ type: "model-catalog", source: catalog.source, updatedAt: catalog.updatedAt });
  let proxy;
  let capture;
  let child;
  let dir;
  let fakeHome = null;
  let trackedSessionId = null;
  let stopping = false;
  const cleanup = async () => {
    if (stopping) return;
    stopping = true;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill();
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 5000);
        child.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    await proxy?.close();
    await capture?.close();
    if (fakeHome && trackedSessionId) {
      // Final merge once the CLI has exited: persist the entry's last state
      // (closed flag, mode_state) into the real registry before the private
      // dir is deleted, so daemon-restart resume keeps working.
      const mirror = await mirrorSessionEntry(fakeHome.bgDir, trackedSessionId, {
        log: (message) => process.stderr.write(`${message}\n`),
        waitForEntryMs: 0,
      });
      onEvent({
        type: "registry-mirror",
        stage: "exit",
        sessionId: trackedSessionId,
        ok: mirror.ok,
        error: mirror.error ?? null,
      });
    }
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    audit.finished = new Date().toISOString();
    if (opts["--audit"]) fs.writeFileSync(opts["--audit"], JSON.stringify(audit, null, 2));
  };
  const signal = () => {
    child?.stdin.end();
    setTimeout(() => child?.kill(), 3000).unref();
  };
  process.once("SIGINT", signal);
  process.once("SIGTERM", signal);
  const exit = () => {
    if (child?.exitCode === null) child.kill();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  };
  process.once("exit", exit);
  try {
    proxy = await startProxy({
      upstream: config.manager.server_url,
      desktopModels,
      allowedModels: ["ext-glm-5.3", "gpt-6-astra"],
      onEvent,
    });
    if (process.env.KNOT_METADATA_CAPTURE_TEST === "1") {
      if (!opts["--audit"] || !opts["--runtime-root"])
        throw new Error("Capture requires explicit audit and test workspace");
      capture = await require("./capture-test.cjs").startCapture(config.knot.url, onEvent);
      config.knot.url = capture.url;
    }
    const root = opts["--runtime-root"] || os.tmpdir();
    fs.mkdirSync(root, { recursive: true });
    // Force-killed runs (SIGKILL, task manager, power loss) never reach their
    // exit hooks; sweep their leftover directories before creating a new one.
    cleanupStaleRuntimeDirs({
      root,
      log: (message) => process.stderr.write(`${message}\n`),
    });
    dir = fs.mkdtempSync(path.join(root, "knot-metadata-"));
    if (process.platform === "win32") {
      const identity = execFileSync("whoami.exe", [], {
        encoding: "utf8",
        windowsHide: true,
      }).trim();
      execFileSync("icacls.exe", [dir, "/inheritance:r", "/grant:r", `${identity}:(OI)(CI)F`], {
        stdio: "pipe",
        windowsHide: true,
      });
    } else fs.chmodSync(dir, 0o700);
    writeOwnerPid(dir);
    // Per-session HOME redirection (plan 1): the Knot CLI resolves all of its
    // mutable state (<HOME>/.bg-agent: ACP session registry, browser profile,
    // cron tasks, plugin registry) from HOME. Pointing HOME at a private fake
    // user dir keeps concurrent CLI processes from overwriting each other's
    // registry entries (the 2026-09-14 lost-update incident class).
    if (homeIsolationEnabled()) {
      fakeHome = createFakeUserDir(dir, {
        log: (message) => process.stderr.write(`${message}\n`),
      });
      const resumeSessionId = process.env.PASEO_RESUME_SESSION_ID;
      let seeded = false;
      if (resumeSessionId) {
        // Resume path: pre-seed the target's registry entry (read from the
        // real registry) so this fresh CLI can session/load it.
        const result = seedResumeRegistry(fakeHome.bgDir, resumeSessionId, {
          log: (message) => process.stderr.write(`${message}\n`),
        });
        seeded = result.seeded;
        trackedSessionId = resumeSessionId;
      }
      onEvent({
        type: "home-isolation",
        userDir: fakeHome.userDir,
        copied: fakeHome.copied,
        seededSessionId: seeded ? resumeSessionId : null,
      });
    }
    config.manager.server_url = proxy.url;
    const injected = mcpServersFromEnv();
    if (injected) {
      const mcpPath = path.join(dir, "mcp-config.json");
      fs.writeFileSync(mcpPath, JSON.stringify({ mcpServers: injected.mcpServers }, null, 2), {
        mode: 0o600,
      });
      config.mcp_config_path = mcpPath;
      process.stderr.write(
        `[knot-metadata] MCP injection: ${Object.keys(injected.mcpServers).length} server(s) isolated to ${mcpPath}` +
          (injected.dropped ? `, ${injected.dropped} dropped` : "") +
          "\n",
      );
      onEvent({
        type: "mcp-injection",
        servers: Object.keys(injected.mcpServers),
        dropped: injected.dropped,
      });
    }
    const temporary = path.join(dir, "config.yaml");
    fs.writeFileSync(temporary, yaml.dump(config, { noRefs: true }), { mode: 0o600 });
    // Tap the client->CLI stream (pure passthrough) to learn which JSON-RPC
    // ids belong to session/new requests; the matching response then reveals
    // this session's registry id for the post-create mirror.
    const newRequestIds = new Set();
    const inputTap = new Transform({
      construct(done) {
        this.decoder = new StringDecoder("utf8");
        this.buffer = "";
        done();
      },
      transform(chunk, _, done) {
        this.buffer += this.decoder.write(chunk);
        let index;
        while ((index = this.buffer.indexOf("\n")) >= 0) {
          const line = this.buffer.slice(0, index);
          this.buffer = this.buffer.slice(index + 1);
          try {
            const request = JSON.parse(line);
            if (request?.method === "session/new" && request.id != null)
              newRequestIds.add(request.id);
          } catch {
            // Non-JSON noise is still forwarded untouched below.
          }
        }
        done(null, chunk);
      },
    });
    child = spawn(opts["--cli"], ["acp", "--no-update", "--config", temporary], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: fakeHome ? { ...process.env, HOME: fakeHome.userDir } : process.env,
    });
    const output = new ProtocolOutput((message) => {
      if (!fakeHome || !newRequestIds.has(message.id)) return;
      newRequestIds.delete(message.id);
      const sessionId = message.result?.sessionId;
      if (typeof sessionId !== "string" || !sessionId) return;
      trackedSessionId = sessionId;
      // Fire-and-forget: never block the stdout stream on registry IO. This
      // early mirror makes the entry survive force-kill/power loss (the exit
      // merge below only runs on orderly shutdown).
      mirrorSessionEntry(fakeHome.bgDir, sessionId, {
        log: (msg) => process.stderr.write(`${msg}\n`),
      }).then((mirror) => {
        onEvent({
          type: "registry-mirror",
          stage: "created",
          sessionId,
          ok: mirror.ok,
          error: mirror.error ?? null,
        });
      });
    });
    output.on("error", () => child.kill());
    child.stdin.on("error", () => {});
    process.stdin.pipe(inputTap).pipe(child.stdin);
    child.stdout.pipe(output).pipe(process.stdout, { end: false });
    child.stderr.pipe(process.stderr, { end: false });
    const inputEnded = () => {
      setTimeout(() => child.kill(), 5000).unref();
    };
    process.stdin.once("end", inputEnded);
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    process.stdin.removeListener("end", inputEnded);
    process.stdin.unpipe(child.stdin);
    process.stdin.pause();
    audit.cliExitCode = code;
    return code ?? 1;
  } finally {
    await cleanup();
    process.removeListener("exit", exit);
    process.removeListener("SIGINT", signal);
    process.removeListener("SIGTERM", signal);
  }
}
module.exports = { ProtocolOutput, parseArgs, launch };
if (require.main === module)
  launch(parseArgs(process.argv.slice(2)))
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.stderr.write(
        "[knot-metadata] Startup or cleanup failed; inspect paths, desktop availability and local permissions.\n",
      );
      process.exitCode = 1;
    });
