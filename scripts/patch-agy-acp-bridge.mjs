#!/usr/bin/env node
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function findBridgeDirs() {
  const dirs = new Set();

  try {
    const globalRoot = execSync("npm root -g", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (globalRoot) {
      dirs.add(path.join(globalRoot, "agy-acp-bridge"));
    }
  } catch {}

  const home = process.env.USERPROFILE || process.env.HOME;
  if (home) {
    // Windows WorkBuddy path
    const wb = path.join(home, ".workbuddy", "binaries", "node", "versions");
    if (fs.existsSync(wb)) {
      try {
        for (const ver of fs.readdirSync(wb)) {
          dirs.add(path.join(wb, ver, "node_modules", "agy-acp-bridge"));
        }
      } catch {}
    }
    // Linux NVM path
    const nvm = path.join(home, ".nvm", "versions", "node");
    if (fs.existsSync(nvm)) {
      try {
        for (const ver of fs.readdirSync(nvm)) {
          dirs.add(path.join(nvm, ver, "lib", "node_modules", "agy-acp-bridge"));
        }
      } catch {}
    }
    // npx cache path (Linux/macOS)
    const npxCache = path.join(home, ".npm", "_npx");
    if (fs.existsSync(npxCache)) {
      try {
        for (const hash of fs.readdirSync(npxCache)) {
          dirs.add(path.join(npxCache, hash, "node_modules", "agy-acp-bridge"));
        }
      } catch {}
    }
  }

  return Array.from(dirs).filter((dir) => fs.existsSync(path.join(dir, "dist", "agyArgs.js")));
}

function patchBridge(bridgeDir) {
  const agyArgsPath = path.join(bridgeDir, "dist", "agyArgs.js");
  const indexPath = path.join(bridgeDir, "dist", "index.js");

  let modified = false;

  // 1. Patch agyArgs.js
  let agyArgs = fs.readFileSync(agyArgsPath, "utf8");
  const oldArgs = 'const args = ["--print", userPrompt, "--output-format", "stream-json"];';
  const newArgs =
    'const args = ["--input-format", "stream-json", "--output-format", "stream-json"];';

  if (agyArgs.includes(oldArgs)) {
    if (!fs.existsSync(`${agyArgsPath}.bak`)) {
      fs.copyFileSync(agyArgsPath, `${agyArgsPath}.bak`);
    }
    agyArgs = agyArgs.replace(oldArgs, newArgs);
    fs.writeFileSync(agyArgsPath, agyArgs, "utf8");
    modified = true;
  }

  // 2. Patch index.js
  let indexJs = fs.readFileSync(indexPath, "utf8");
  const oldSpawnPattern = `        const child = spawnAgy(agyArgs, {
            cwd: session.cwd,
            env: { ...process.env },
        });
        activeProcesses[sessionId] = child;`;

  const newSpawnPattern = `        const child = spawnAgy(agyArgs, {
            cwd: session.cwd,
            env: { ...process.env },
            stdio: ["pipe", "pipe", "pipe"],
        });
        activeProcesses[sessionId] = child;
        child.stdin.on("error", (err) => {
            logDebug("child.stdin error:", err);
        });
        const streamPayload = JSON.stringify({
            event: "user",
            message: { content: userPrompt },
        }) + "\\n";
        child.stdin.write(streamPayload, "utf-8", (err) => {
            if (err) {
                logError("Failed to write prompt to agy stdin:", err);
            }
            child.stdin.end();
        });`;

  if (indexJs.includes(oldSpawnPattern)) {
    if (!fs.existsSync(`${indexPath}.bak`)) {
      fs.copyFileSync(indexPath, `${indexPath}.bak`);
    }
    indexJs = indexJs.replace(oldSpawnPattern, newSpawnPattern);
    fs.writeFileSync(indexPath, indexJs, "utf8");
    modified = true;
  }

  if (modified) {
    console.log(`[Paseo] Auto-patched agy-acp-bridge at ${bridgeDir} (stdin streaming enabled)`);
  }
}

function main() {
  const bridgeDirs = findBridgeDirs();
  for (const bridgeDir of bridgeDirs) {
    try {
      patchBridge(bridgeDir);
    } catch (err) {
      console.warn(`[Paseo] Failed to auto-patch agy-acp-bridge at ${bridgeDir}:`, err.message);
    }
  }
}

main();
