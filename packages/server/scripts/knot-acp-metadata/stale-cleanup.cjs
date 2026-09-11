"use strict";
// Force-killed adapter processes (SIGKILL, task manager, power loss) cannot run
// their exit hooks, so their private temporary config directories survive.
// Every launch therefore sweeps the runtime root: directories whose owner
// process is dead and whose grace period has elapsed are removed, and a hard
// maximum age bounds the damage from PID reuse keeping dead owners "alive".
const fs = require("node:fs");

const DEFAULT_PREFIX = "knot-metadata-";
const DEFAULT_GRACE_MS = 10 * 60 * 1000;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function isProcessAlive(pid) {
  // Self is trivially alive; short-circuiting also sidesteps transient
  // OpenProcess quirks on Windows when probing our own pid.
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but we lack permission to signal it.
    return error && error.code === "EPERM";
  }
}

function readOwnerPid(dir) {
  try {
    const pid = Number.parseInt(fs.readFileSync(`${dir}/owner.pid`, "utf8"), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function writeOwnerPid(dir) {
  fs.writeFileSync(`${dir}/owner.pid`, `${process.pid}\n`, { mode: 0o600 });
}

function removeDir(dir, log) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    log?.(`[knot-metadata] removed stale runtime directory ${dir}`);
    return true;
  } catch (error) {
    log?.(`[knot-metadata] could not remove stale directory ${dir}: ${error?.message ?? error}`);
    return false;
  }
}

function cleanupStaleRuntimeDirs({
  root,
  prefix = DEFAULT_PREFIX,
  now = Date.now,
  graceMs = DEFAULT_GRACE_MS,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  isAlive = isProcessAlive,
  log,
} = {}) {
  if (!root) return { scanned: 0, removed: 0 };
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return { scanned: 0, removed: 0 };
  }

  let scanned = 0;
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
    scanned += 1;
    const dir = `${root}/${entry.name}`;
    let ageMs;
    try {
      ageMs = Math.max(0, now() - fs.statSync(dir).mtimeMs);
    } catch {
      continue;
    }
    // Hard age bound regardless of owner: PID reuse must never make a dead
    // directory immortal.
    if (ageMs > maxAgeMs) {
      if (removeDir(dir, log)) removed += 1;
      continue;
    }
    const ownerPid = readOwnerPid(dir);
    // No owner file yet plus a fresh directory means a concurrent launch is
    // still initializing; the grace period covers that window.
    if (ownerPid !== null && isAlive(ownerPid)) continue;
    if (ageMs > graceMs && removeDir(dir, log)) removed += 1;
  }
  return { scanned, removed };
}

module.exports = {
  DEFAULT_PREFIX,
  cleanupStaleRuntimeDirs,
  isProcessAlive,
  readOwnerPid,
  writeOwnerPid,
};
