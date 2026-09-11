"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn, execFileSync } = require("node:child_process");
const { Transform } = require("node:stream");
const { StringDecoder } = require("node:string_decoder");
const yaml = require("js-yaml");
const { startProxy } = require("./proxy.cjs");
const { DesktopTransport, discoverEndpoint } = require("../with-desktop-acp/transport.cjs");
const { modelsFrom } = require("../with-desktop-acp/bridge.cjs");
class ProtocolOutput extends Transform {
  constructor() {
    super();
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
  let desktopModels = [];
  try {
    const t = new DesktopTransport(await discoverEndpoint(), { requestTimeout: 15000 });
    try {
      desktopModels = modelsFrom(await t.invoke("get_agent_models"));
    } finally {
      t.close();
    }
  } catch {
    process.stderr.write(
      "[knot-metadata] Desktop catalog unavailable; retaining official capabilities. No selected option will be silently downgraded.\n",
    );
    onEvent({ type: "desktop-unavailable" });
  }
  let proxy;
  let capture;
  let child;
  let dir;
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
    config.manager.server_url = proxy.url;
    const temporary = path.join(dir, "config.yaml");
    fs.writeFileSync(temporary, yaml.dump(config, { noRefs: true }), { mode: 0o600 });
    child = spawn(opts["--cli"], ["acp", "--no-update", "--config", temporary], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const output = new ProtocolOutput();
    output.on("error", () => child.kill());
    child.stdin.on("error", () => {});
    process.stdin.pipe(child.stdin);
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
