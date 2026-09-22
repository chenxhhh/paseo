"use strict";
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { spawn, execFileSync } = require("node:child_process");
const yaml = require("js-yaml");

const cli = "D:/UGit/Paseo/.with-connect/v029-isolated/knot-cli.exe";
const sourceConfig =
  "C:/Users/xinghanchen/AppData/Local/Programs/with/resources/with-app-cli/etc/bg-agent-client.yaml";
const root = "D:/UGit/Paseo/.with-connect/route-a-log-locate";
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(path.join(root, "log"), { recursive: true });

const watchDirs = [
  root,
  path.join(process.env.USERPROFILE || "", ".bg-agent"),
  path.dirname(cli),
  process.cwd(),
  process.env.TEMP || "",
];
function snapshot() {
  const map = new Map();
  for (const d of watchDirs) {
    if (!d || !fs.existsSync(d)) continue;
    const walk = (dir, depth) => {
      if (depth > 3) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, depth + 1);
        else {
          try {
            map.set(p, fs.statSync(p).size);
          } catch {}
        }
      }
    };
    walk(d, 0);
  }
  return map;
}

(async () => {
  const before = snapshot();
  const config = yaml.load(fs.readFileSync(sourceConfig, "utf8"));
  const dir = fs.mkdtempSync(path.join(root, "knot-metadata-"));
  const tempConfig = path.join(dir, "config.yaml");
  fs.writeFileSync(tempConfig, yaml.dump(config, { noRefs: true }), { mode: 0o600 });
  const child = spawn(cli, ["acp", "--no-update", "--config", tempConfig], {
    cwd: root,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();
  let initialized = false;
  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (m.id === 1 && m.result) initialized = true;
  });
  child.stdin.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: "log-locate", version: "1" },
      },
    }) + "\n",
  );
  const deadline = Date.now() + 20000;
  while (!initialized && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
  if (!initialized) throw new Error("initialize failed");
  await new Promise((r) => setTimeout(r, 1500));
  const after = snapshot();
  const created = [];
  for (const [p, size] of after) if (!before.has(p)) created.push({ p, size });
  const grown = [];
  for (const [p, size] of after)
    if (before.has(p) && before.get(p) !== size)
      grown.push({ p, before: before.get(p), after: size });
  console.log(JSON.stringify({ created, grown, stillRunning: child.exitCode === null }, null, 2));
  child.kill();
  fs.rmSync(root, { recursive: true, force: true });
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
