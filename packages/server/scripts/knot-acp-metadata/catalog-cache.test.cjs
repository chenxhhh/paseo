"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  loadCatalog,
  readSnapshot,
  sanitizeModels,
} = require("./catalog-cache.cjs");
const { mergeCatalog } = require("./proxy.cjs");
const models = [
  {
    model_name: "ext-glm-5.3",
    is_support_thinking: false,
    max_context_token_list: [200000, 1000000],
    reasoning_effort: [{ name: "max", default_option: true }],
    apiKey: "must-not-persist",
  },
];
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cache-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return {
    source: path.join(dir, "config.yaml"),
    cachePath: path.join(dir, "cache.json"),
    fetchModels: async () => models,
  };
}
test("first load persists whitelisted capabilities; next load never calls desktop", async (t) => {
  const opts = setup(t);
  assert.equal((await loadCatalog(opts)).persisted, true);
  assert.equal(
    fs.readFileSync(opts.cachePath, "utf8").includes("must-not-persist"),
    false,
  );
  const result = await loadCatalog({
    ...opts,
    fetchModels: () => {
      throw new Error("Desktop must not be called");
    },
  });
  assert.equal(result.source, "cache");
  assert.deepEqual(result.models[0].max_context_token_list, [200000, 1000000]);
  const merged = mergeCatalog(
    { code: 0, data: { models: [{ name: "ext-glm-5.3" }] } },
    result.models,
    ["ext-glm-5.3"],
  );
  assert.deepEqual(
    merged.catalog.data.models[0].infos.context,
    [200000, 1000000],
  );
});
test("failed and empty refresh leave snapshot byte-for-byte unchanged", async (t) => {
  const opts = setup(t);
  await loadCatalog(opts);
  const before = fs.readFileSync(opts.cachePath, "utf8");
  for (const fetchModels of [
    async () => {
      throw new Error("offline");
    },
    async () => [],
  ]) {
    const result = await loadCatalog({ ...opts, refresh: true, fetchModels });
    assert.equal(result.refreshFailed, true);
    assert.equal(result.source, "cache");
    assert.equal(fs.readFileSync(opts.cachePath, "utf8"), before);
  }
});
test("old snapshot is retained without contacting desktop", async (t) => {
  const opts = setup(t);
  await loadCatalog({ ...opts, now: 0 });
  const logs = [];
  const result = await loadCatalog({
    ...opts,
    now: 8 * 86400000,
    log: (m) => logs.push(m),
    fetchModels: async () => [],
  });
  assert.equal(result.source, "cache");
  assert.equal(logs.length, 1);
});
test("explicit refresh replaces a valid snapshot", async (t) => {
  const opts = setup(t);
  await loadCatalog({ ...opts, now: 0 });
  assert.equal(
    (await loadCatalog({ ...opts, refresh: true, now: 1000 })).persisted,
    true,
  );
  assert.equal(
    readSnapshot(opts.cachePath, opts.source).updatedAt,
    new Date(1000).toISOString(),
  );
});
test("corrupt or foreign snapshot does not supply capabilities", async (t) => {
  const opts = setup(t);
  fs.writeFileSync(opts.cachePath, "broken");
  assert.equal(
    (await loadCatalog({ ...opts, fetchModels: async () => [] })).source,
    "official",
  );
  await loadCatalog(opts);
  assert.equal(
    (
      await loadCatalog({
        ...opts,
        source: opts.source + "-other",
        fetchModels: async () => [],
      })
    ).source,
    "official",
  );
});
test("invalid capability data is rejected", () => {
  assert.throws(() =>
    sanitizeModels([{ ...models[0], max_context_token_list: [-1] }]),
  );
  assert.throws(() => sanitizeModels([models[0], models[0]]));
  assert.throws(() =>
    sanitizeModels([
      { ...models[0], reasoning_effort: [{ name: "bad option" }] },
    ]),
  );
});
test("persistence failure keeps fetched capabilities usable", async (t) => {
  const opts = setup(t);
  fs.mkdirSync(opts.cachePath);
  const result = await loadCatalog(opts);
  assert.equal(result.source, "desktop");
  assert.equal(result.persisted, false);
  assert.equal(result.models.length, 1);
});
