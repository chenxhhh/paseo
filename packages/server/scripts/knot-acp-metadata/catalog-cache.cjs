"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createHash, randomUUID } = require("node:crypto");
const {
  DesktopTransport,
  discoverEndpoint,
} = require("../with-desktop-acp/transport.cjs");
const { modelsFrom } = require("../with-desktop-acp/bridge.cjs");

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
function defaultCachePath(source) {
  const key = createHash("sha256")
    .update(path.resolve(source))
    .digest("hex")
    .slice(0, 16);
  return path.join(os.homedir(), ".paseo", "with-metadata", `${key}.json`);
}
function sanitizeModels(models) {
  if (!Array.isArray(models) || !models.length)
    throw new Error("Empty model catalog");
  const seen = new Set();
  return models.map((m) => {
    if (
      !m ||
      typeof m.model_name !== "string" ||
      !m.model_name ||
      seen.has(m.model_name)
    )
      throw new Error("Invalid or duplicate model ID");
    seen.add(m.model_name);
    if (
      m.is_support_thinking !== undefined &&
      typeof m.is_support_thinking !== "boolean"
    )
      throw new Error("Invalid thinking capability");
    const contexts = m.max_context_token_list ?? [];
    const efforts = m.reasoning_effort ?? [];
    if (
      !Array.isArray(contexts) ||
      contexts.some((n) => !Number.isSafeInteger(n) || n <= 0)
    )
      throw new Error("Invalid context options");
    if (
      !Array.isArray(efforts) ||
      efforts.some(
        (e) =>
          !e ||
          typeof e.name !== "string" ||
          !/^[a-z0-9_-]{1,64}$/i.test(e.name),
      )
    )
      throw new Error("Invalid reasoning options");
    return {
      model_name: m.model_name,
      ...(m.is_support_thinking === undefined
        ? {}
        : { is_support_thinking: m.is_support_thinking }),
      max_context_token_list: [...new Set(contexts)],
      reasoning_effort: efforts.map((e) => ({
        name: e.name,
        ...(typeof e.display_name === "string"
          ? { display_name: e.display_name }
          : {}),
        ...(typeof e.tip === "string" ? { tip: e.tip } : {}),
        ...(typeof e.default_option === "boolean"
          ? { default_option: e.default_option }
          : {}),
      })),
    };
  });
}
async function fetchDesktopModels() {
  const transport = new DesktopTransport(await discoverEndpoint(), {
    requestTimeout: 15000,
  });
  try {
    return modelsFrom(await transport.invoke("get_agent_models"));
  } finally {
    transport.close();
  }
}
function readSnapshot(cachePath, source) {
  if (fs.statSync(cachePath).size > 4 * 1024 * 1024)
    throw new Error("Snapshot too large");
  const data = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  if (
    data.version !== 1 ||
    data.source !== path.resolve(source) ||
    !Number.isFinite(Date.parse(data.updatedAt))
  )
    throw new Error("Invalid snapshot identity or version");
  return { ...data, models: sanitizeModels(data.models) };
}
function writeSnapshot(cachePath, snapshot) {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const temp = `${cachePath}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(snapshot, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    fs.renameSync(temp, cachePath);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
async function loadCatalog({
  source,
  cachePath = defaultCachePath(source),
  refresh = false,
  fetchModels = fetchDesktopModels,
  log = () => {},
  now = Date.now(),
}) {
  let cached;
  try {
    cached = readSnapshot(cachePath, source);
  } catch (error) {
    if (error.code !== "ENOENT")
      log("Model snapshot invalid or unreadable; trying desktop catalog.");
  }
  if (cached && !refresh) {
    if (now - Date.parse(cached.updatedAt) > MAX_AGE_MS)
      log(
        "Model snapshot is over 7 days old; retaining capabilities. Refresh when desktop is available.",
      );
    return {
      models: cached.models,
      source: "cache",
      updatedAt: cached.updatedAt,
      cachePath,
    };
  }
  try {
    const models = sanitizeModels(await fetchModels());
    const snapshot = {
      version: 1,
      source: path.resolve(source),
      updatedAt: new Date(now).toISOString(),
      models,
    };
    try {
      writeSnapshot(cachePath, snapshot);
    } catch {
      log("Could not persist model snapshot; previous snapshot retained.");
      return { models, source: "desktop", persisted: false, cachePath };
    }
    return {
      models,
      source: "desktop",
      persisted: true,
      updatedAt: snapshot.updatedAt,
      cachePath,
    };
  } catch {
    log(
      cached
        ? "Desktop refresh failed; retaining last successful model snapshot."
        : "Desktop catalog unavailable and no valid snapshot; official capabilities only. Saved context options may not be restored.",
    );
    return {
      models: cached?.models || [],
      source: cached ? "cache" : "official",
      refreshFailed: true,
      cachePath,
    };
  }
}
module.exports = {
  defaultCachePath,
  sanitizeModels,
  readSnapshot,
  writeSnapshot,
  loadCatalog,
};
