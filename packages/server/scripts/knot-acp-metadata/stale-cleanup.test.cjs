"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  DEFAULT_PREFIX,
  cleanupStaleRuntimeDirs,
  readOwnerPid,
  writeOwnerPid,
} = require("./stale-cleanup.cjs");

function deadPid() {
  const child = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
  return child.pid;
}


const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "stale-cleanup-test-"));
}

function makeDir(root, name, ageMs, now, ownerPid) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  if (ownerPid !== undefined) fs.writeFileSync(path.join(dir, "owner.pid"), `${ownerPid}\n`);
  // Set the timestamp last: writing owner.pid refreshes the directory mtime.
  const stamp = new Date(now() - ageMs);
  fs.utimesSync(dir, stamp, stamp);
  return dir;
}

test("dead owner past grace is removed; live owner and fresh dirs survive", () => {
  const root = makeRoot();
  try {
    const now = Date.now();
    const fixedNow = () => now;
    const stale = makeDir(root, `${DEFAULT_PREFIX}dead`, 2 * HOUR, fixedNow, deadPid());
    const alive = makeDir(root, `${DEFAULT_PREFIX}alive`, 2 * HOUR, fixedNow, process.pid);
    const fresh = makeDir(root, `${DEFAULT_PREFIX}fresh`, 30 * 1000, fixedNow);

    const result = cleanupStaleRuntimeDirs({
      root,
      now: fixedNow,
      isAlive: (pid) => pid === process.pid,
    });
    assert.equal(result.scanned, 3);
    assert.equal(result.removed, 1);
    assert.equal(fs.existsSync(stale), false);
    assert.equal(fs.existsSync(alive), true);
    assert.equal(fs.existsSync(fresh), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("no owner file: grace window protects concurrency, grace expiry removes", () => {
  const root = makeRoot();
  try {
    const now = Date.now();
    const fixedNow = () => now;
    const initializing = makeDir(root, `${DEFAULT_PREFIX}new`, 5 * 1000, fixedNow);
    const legacy = makeDir(root, `${DEFAULT_PREFIX}legacy`, 2 * HOUR, fixedNow);

    const result = cleanupStaleRuntimeDirs({ root, now: fixedNow });
    assert.equal(result.removed, 1);
    assert.equal(fs.existsSync(initializing), true);
    assert.equal(fs.existsSync(legacy), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("live owners and their MCP configs survive at seven days and beyond", () => {
  const root = makeRoot();
  try {
    const fixedNow = () => 1800000000000;
    const dirs = [7, 8, 30].map((days) => {
      const dir = makeDir(root, `${DEFAULT_PREFIX}alive-${days}`, days * DAY, fixedNow, process.pid);
      fs.writeFileSync(path.join(dir, "mcp-config.json"), '{"mcpServers":{}}');
      const stamp = new Date(fixedNow() - days * DAY);
      fs.utimesSync(dir, stamp, stamp);
      return dir;
    });

    assert.deepEqual(cleanupStaleRuntimeDirs({ root, now: fixedNow }), {
      scanned: 3,
      removed: 0,
    });
    for (const dir of dirs) {
      assert.equal(fs.readFileSync(path.join(dir, "mcp-config.json"), "utf8"), '{"mcpServers":{}}');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("old directory is retained while its PID is alive and removed after exit", () => {
  const root = makeRoot();
  try {
    const fixedNow = () => 1800000000000;
    const ownerPid = 12345;
    const dir = makeDir(root, `${DEFAULT_PREFIX}long-running`, 30 * DAY, fixedNow, ownerPid);
    let alive = true;
    const options = {
      root,
      now: fixedNow,
      isAlive: (pid) => {
        assert.equal(pid, ownerPid);
        return alive;
      },
    };

    assert.deepEqual(cleanupStaleRuntimeDirs(options), { scanned: 1, removed: 0 });
    assert.equal(fs.existsSync(dir), true);
    alive = false;
    assert.deepEqual(cleanupStaleRuntimeDirs(options), { scanned: 1, removed: 1 });
    assert.equal(fs.existsSync(dir), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("dead and missing owners beyond seven days are still cleaned after grace", () => {
  const root = makeRoot();
  try {
    const fixedNow = () => 1800000000000;
    const dead = makeDir(root, `${DEFAULT_PREFIX}dead-old`, 8 * DAY, fixedNow, 12345);
    const legacy = makeDir(root, `${DEFAULT_PREFIX}legacy-old`, 30 * DAY, fixedNow);

    assert.deepEqual(cleanupStaleRuntimeDirs({ root, now: fixedNow, isAlive: () => false }), {
      scanned: 2,
      removed: 2,
    });
    assert.equal(fs.existsSync(dead), false);
    assert.equal(fs.existsSync(legacy), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("foreign directories and missing root are ignored without errors", () => {
  const root = makeRoot();
  try {
    const now = Date.now();
    const fixedNow = () => now;
    const foreign = makeDir(root, "other-tool", 30 * DAY, fixedNow);
    makeDir(root, `${DEFAULT_PREFIX}gone`, 2 * HOUR, fixedNow);

    assert.deepEqual(cleanupStaleRuntimeDirs({ root, now: fixedNow }), {
      scanned: 1,
      removed: 1,
    });
    assert.equal(fs.existsSync(foreign), true);

    const missing = cleanupStaleRuntimeDirs({
      root: path.join(root, "does-not-exist"),
      now: fixedNow,
    });
    assert.deepEqual(missing, { scanned: 0, removed: 0 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("owner pid round trip and garbage rejection", () => {
  const root = makeRoot();
  try {
    const dir = path.join(root, `${DEFAULT_PREFIX}rw`);
    fs.mkdirSync(dir);
    writeOwnerPid(dir);
    assert.equal(readOwnerPid(dir), process.pid);
    fs.writeFileSync(path.join(dir, "owner.pid"), "not-a-pid\n");
    assert.equal(readOwnerPid(dir), null);
    assert.equal(readOwnerPid(path.join(root, "missing")), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
