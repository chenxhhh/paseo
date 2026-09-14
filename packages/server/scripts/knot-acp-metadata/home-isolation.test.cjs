"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  REGISTRY_NAME,
  isEnabled,
  realBgAgentDir,
  readRegistry,
  createFakeUserDir,
  seedResumeRegistry,
  mirrorSessionEntry,
} = require("./home-isolation.cjs");

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "home-isolation-test-"));
  const realHome = path.join(root, "real-user");
  const realBg = path.join(realHome, ".bg-agent");
  fs.mkdirSync(realBg, { recursive: true });
  const previous = process.env.KNOT_METADATA_REAL_HOME;
  process.env.KNOT_METADATA_REAL_HOME = realHome;
  const restore = () => {
    if (previous === undefined) delete process.env.KNOT_METADATA_REAL_HOME;
    else process.env.KNOT_METADATA_REAL_HOME = previous;
    fs.rmSync(root, { recursive: true, force: true });
  };
  return { root, realHome, realBg, restore };
}

const noLog = () => {};

test("isEnabled defaults to true and honors the opt-out switch", () => {
  const previous = process.env.KNOT_METADATA_HOME_ISOLATION;
  try {
    delete process.env.KNOT_METADATA_HOME_ISOLATION;
    assert.equal(isEnabled(), true);
    process.env.KNOT_METADATA_HOME_ISOLATION = "0";
    assert.equal(isEnabled(), false);
    process.env.KNOT_METADATA_HOME_ISOLATION = "1";
    assert.equal(isEnabled(), true);
  } finally {
    if (previous === undefined) delete process.env.KNOT_METADATA_HOME_ISOLATION;
    else process.env.KNOT_METADATA_HOME_ISOLATION = previous;
  }
});

test("realBgAgentDir honors KNOT_METADATA_REAL_HOME for tests", () => {
  const fixture = makeFixture();
  try {
    assert.equal(realBgAgentDir(), fixture.realBg);
  } finally {
    fixture.restore();
  }
});

test("createFakeUserDir copies the minimal file set and tolerates missing files", () => {
  const fixture = makeFixture();
  try {
    fs.writeFileSync(path.join(fixture.realBg, "auth.json"), '{"token":"t"}');
    // hooks.json intentionally absent.
    const sessionDir = path.join(fixture.root, "session");
    fs.mkdirSync(sessionDir);
    const home = createFakeUserDir(sessionDir, { log: noLog });
    assert.equal(fs.readFileSync(path.join(home.bgDir, "auth.json"), "utf8"), '{"token":"t"}');
    assert.equal(fs.existsSync(path.join(home.bgDir, "hooks.json")), false);
    assert.deepEqual(home.copied, ["auth.json"]);
    assert.equal(fs.existsSync(path.join(home.userDir, ".bg-agent")), true);
  } finally {
    fixture.restore();
  }
});

test("readRegistry parses, returns [] for missing files and null for corrupt ones", () => {
  const fixture = makeFixture();
  try {
    const file = path.join(fixture.root, "registry.json");
    assert.deepEqual(readRegistry(file), []);
    fs.writeFileSync(file, JSON.stringify([{ session_id: "a" }]));
    assert.deepEqual(readRegistry(file), [{ session_id: "a" }]);
    fs.writeFileSync(file, "{not json");
    assert.equal(readRegistry(file), null);
    fs.writeFileSync(file, JSON.stringify({ not: "an array" }));
    assert.equal(readRegistry(file), null);
  } finally {
    fixture.restore();
  }
});

test("seedResumeRegistry copies the matching entry into the fake home registry", () => {
  const fixture = makeFixture();
  try {
    const entry = { session_id: "acp-sess-1", cwd: "C:/w", session_config: { model: "m" } };
    fs.writeFileSync(
      path.join(fixture.realBg, REGISTRY_NAME),
      JSON.stringify([{ session_id: "other" }, entry]),
    );
    const bgDir = path.join(fixture.root, "fake-user", ".bg-agent");
    fs.mkdirSync(bgDir, { recursive: true });
    const result = seedResumeRegistry(bgDir, "acp-sess-1", { log: noLog });
    assert.equal(result.seeded, true);
    assert.deepEqual(readRegistry(path.join(bgDir, REGISTRY_NAME)), [entry]);
  } finally {
    fixture.restore();
  }
});

test("seedResumeRegistry skips when the entry is missing or the real registry is unreadable", () => {
  const fixture = makeFixture();
  try {
    const bgDir = path.join(fixture.root, "fake-user", ".bg-agent");
    fs.mkdirSync(bgDir, { recursive: true });
    fs.writeFileSync(path.join(fixture.realBg, REGISTRY_NAME), JSON.stringify([]));
    assert.equal(seedResumeRegistry(bgDir, "acp-sess-1", { log: noLog }).seeded, false);
    assert.equal(fs.existsSync(path.join(bgDir, REGISTRY_NAME)), false);
    fs.writeFileSync(path.join(fixture.realBg, REGISTRY_NAME), "{corrupt");
    assert.equal(seedResumeRegistry(bgDir, "acp-sess-1", { log: noLog }).seeded, false);
    assert.equal(fs.existsSync(path.join(bgDir, REGISTRY_NAME)), false);
  } finally {
    fixture.restore();
  }
});

test("mirrorSessionEntry upserts into the real registry while preserving other entries", async () => {
  const fixture = makeFixture();
  try {
    const realPath = path.join(fixture.realBg, REGISTRY_NAME);
    fs.writeFileSync(realPath, JSON.stringify([{ session_id: "other", cwd: "C:/keep" }]));
    const bgDir = path.join(fixture.root, "fake-user", ".bg-agent");
    fs.mkdirSync(bgDir, { recursive: true });
    fs.writeFileSync(
      path.join(bgDir, REGISTRY_NAME),
      JSON.stringify([{ session_id: "acp-sess-1", cwd: "C:/w", updated_at: "2" }]),
    );
    const result = await mirrorSessionEntry(bgDir, "acp-sess-1", {
      log: noLog,
      waitForEntryMs: 0,
    });
    assert.equal(result.ok, true);
    const real = readRegistry(realPath);
    assert.equal(real.length, 2);
    assert.deepEqual(
      real.find((entry) => entry.session_id === "acp-sess-1"),
      { session_id: "acp-sess-1", cwd: "C:/w", updated_at: "2" },
    );
    assert.deepEqual(
      real.find((entry) => entry.session_id === "other"),
      {
        session_id: "other",
        cwd: "C:/keep",
      },
    );
  } finally {
    fixture.restore();
  }
});

test("mirrorSessionEntry replaces an existing entry with the same session id", async () => {
  const fixture = makeFixture();
  try {
    const realPath = path.join(fixture.realBg, REGISTRY_NAME);
    fs.writeFileSync(
      realPath,
      JSON.stringify([{ session_id: "acp-sess-1", cwd: "C:/old", closed: false }]),
    );
    const bgDir = path.join(fixture.root, "fake-user", ".bg-agent");
    fs.mkdirSync(bgDir, { recursive: true });
    fs.writeFileSync(
      path.join(bgDir, REGISTRY_NAME),
      JSON.stringify([{ session_id: "acp-sess-1", cwd: "C:/old", closed: true }]),
    );
    const result = await mirrorSessionEntry(bgDir, "acp-sess-1", {
      log: noLog,
      waitForEntryMs: 0,
    });
    assert.equal(result.ok, true);
    const real = readRegistry(realPath);
    assert.equal(real.length, 1);
    assert.equal(real[0].closed, true);
  } finally {
    fixture.restore();
  }
});

test("mirrorSessionEntry waits for a late fake-registry write when waitForEntryMs > 0", async () => {
  const fixture = makeFixture();
  try {
    const realPath = path.join(fixture.realBg, REGISTRY_NAME);
    fs.writeFileSync(realPath, JSON.stringify([]));
    const bgDir = path.join(fixture.root, "fake-user", ".bg-agent");
    fs.mkdirSync(bgDir, { recursive: true });
    // Simulate the CLI persisting the entry shortly after session/new.
    setTimeout(() => {
      fs.writeFileSync(
        path.join(bgDir, REGISTRY_NAME),
        JSON.stringify([{ session_id: "acp-sess-late" }]),
      );
    }, 300);
    const result = await mirrorSessionEntry(bgDir, "acp-sess-late", {
      log: noLog,
      waitForEntryMs: 4000,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(readRegistry(realPath), [{ session_id: "acp-sess-late" }]);
  } finally {
    fixture.restore();
  }
});

test("mirrorSessionEntry never touches the real registry when the entry is missing", async () => {
  const fixture = makeFixture();
  try {
    const realPath = path.join(fixture.realBg, REGISTRY_NAME);
    const before = JSON.stringify([{ session_id: "other" }]);
    fs.writeFileSync(realPath, before);
    const bgDir = path.join(fixture.root, "fake-user", ".bg-agent");
    fs.mkdirSync(bgDir, { recursive: true });
    fs.writeFileSync(path.join(bgDir, REGISTRY_NAME), JSON.stringify([]));
    const result = await mirrorSessionEntry(bgDir, "acp-sess-1", {
      log: noLog,
      waitForEntryMs: 0,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "entry-missing");
    assert.equal(fs.readFileSync(realPath, "utf8"), before);
  } finally {
    fixture.restore();
  }
});

test("mirrorSessionEntry aborts without overwriting when the real registry is corrupt", async () => {
  const fixture = makeFixture();
  try {
    const realPath = path.join(fixture.realBg, REGISTRY_NAME);
    const before = "{corrupt but preserved";
    fs.writeFileSync(realPath, before);
    const bgDir = path.join(fixture.root, "fake-user", ".bg-agent");
    fs.mkdirSync(bgDir, { recursive: true });
    fs.writeFileSync(
      path.join(bgDir, REGISTRY_NAME),
      JSON.stringify([{ session_id: "acp-sess-1" }]),
    );
    const result = await mirrorSessionEntry(bgDir, "acp-sess-1", {
      log: noLog,
      waitForEntryMs: 0,
      attempts: 2,
    });
    assert.equal(result.ok, false);
    assert.equal(fs.readFileSync(realPath, "utf8"), before);
  } finally {
    fixture.restore();
  }
});

test("mirrorSessionEntry tolerates a locked real registry and succeeds after retry", async () => {
  const fixture = makeFixture();
  try {
    const realPath = path.join(fixture.realBg, REGISTRY_NAME);
    fs.writeFileSync(realPath, JSON.stringify([]));
    const bgDir = path.join(fixture.root, "fake-user", ".bg-agent");
    fs.mkdirSync(bgDir, { recursive: true });
    fs.writeFileSync(
      path.join(bgDir, REGISTRY_NAME),
      JSON.stringify([{ session_id: "acp-sess-1" }]),
    );
    // Fail only the FIRST read of the real registry (simulates a concurrent
    // CLI write holding the file); the retry must then read and upsert.
    // Note: do NOT hold an open handle — on Windows an open handle blocks the
    // atomic rename for the whole retry window, which is a different scenario.
    const originalRead = fs.readFileSync;
    let denied = true;
    fs.readFileSync = (...args) => {
      if (denied && args[0] === realPath) {
        denied = false;
        throw Object.assign(new Error("locked"), { code: "EBUSY" });
      }
      return originalRead(...args);
    };
    try {
      const result = await mirrorSessionEntry(bgDir, "acp-sess-1", {
        log: noLog,
        waitForEntryMs: 0,
        attempts: 3,
      });
      assert.equal(result.ok, true);
    } finally {
      fs.readFileSync = originalRead;
    }
    assert.deepEqual(readRegistry(realPath), [{ session_id: "acp-sess-1" }]);
  } finally {
    fixture.restore();
  }
});
