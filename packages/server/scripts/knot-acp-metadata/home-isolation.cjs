"use strict";
// Per-session HOME redirection for the Knot CLI (plan 1: registry isolation).
//
// The CLI keeps a global ACP session registry at <HOME>/.bg-agent/.knot_acp_sessions.json
// using a read-all/modify/write-all strategy with no cross-process locking beyond
// tmp+rename. Concurrent CLI processes (Paseo agent sessions, catalog probes, the
// With desktop) overwrite each other's entries — a lost-update race that
// permanently drops sessions (see the 2026-09-14 "session not found" incident).
//
// This module points each adapter-run CLI at a private fake user directory
// (HOME=<session dir>/home), so its registry, browser profile, cron tasks and
// plugin state never touch the real ~/.bg-agent. To keep daemon-restart resume
// working, the adapter:
//   1. seeds the resume target's registry entry (read-only from the real
//      registry) into the fake home before spawning the CLI, and
//   2. mirrors the session's own registry entry back into the real registry
//      right after session/new (survives force-kill/power loss) and once more
//      on normal shutdown (final closed/mode_state).
//
// The mirror is a narrow upsert-by-session_id with retries; it never replaces
// the real registry wholesale and never writes when the real registry cannot
// be read intact (corruption is left to the CLI's own recovery).
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const REGISTRY_NAME = ".knot_acp_sessions.json";
const COPY_FILES = ["auth.json", "hooks.json"];

// Home isolation is on by default; KNOT_METADATA_HOME_ISOLATION=0 disables it
// (rollback switch documented in README.md).
function isEnabled() {
  return process.env.KNOT_METADATA_HOME_ISOLATION !== "0";
}

// Real data root. KNOT_METADATA_REAL_HOME lets tests point this at a fixture
// directory; production resolves to <real user home>/.bg-agent.
function realBgAgentDir() {
  const root = process.env.KNOT_METADATA_REAL_HOME || os.homedir();
  return path.join(root, ".bg-agent");
}

// Returns a parsed registry array, [] when the file does not exist yet, or
// null when it exists but cannot be read/parsed intact (locked mid-write or
// corrupted). Callers must NOT overwrite a registry they could not read.
function readRegistry(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeRegistryAtomic(file, entries) {
  const tmp = `${file}.mirror-${process.pid}-${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2));
  fs.renameSync(tmp, file);
}

function upsertEntry(entries, entry) {
  const index = entries.findIndex((candidate) => candidate?.session_id === entry.session_id);
  if (index >= 0) entries[index] = entry;
  else entries.push(entry);
  return entries;
}

// Create the fake user directory inside this session's private dir and copy
// the minimal file set (verified against CLI v0.29: auth.json for the token,
// hooks.json for hook registration; the CLI bootstraps node/, browser/, log/,
// .bg-client/ and .gitconfig on its own).
function createFakeUserDir(sessionDir, { log }) {
  const userDir = path.join(sessionDir, "home");
  const bgDir = path.join(userDir, ".bg-agent");
  fs.mkdirSync(bgDir, { recursive: true });
  const source = realBgAgentDir();
  const copied = [];
  for (const name of COPY_FILES) {
    const from = path.join(source, name);
    if (fs.existsSync(from)) {
      fs.copyFileSync(from, path.join(bgDir, name));
      copied.push(name);
    } else {
      log(`[knot-metadata] home isolation: ${name} missing in ${source}; continuing without it`);
    }
  }
  return { userDir, bgDir, copied };
}

// Copy the resume target's entry from the real registry (read-only) into the
// fake home registry so the fresh CLI process can session/load it. When the
// entry is missing from the real registry (the lost-update incident class),
// seeding is skipped and load will fail — recovery then belongs to Paseo's
// transcript fallback, not to this adapter.
function seedResumeRegistry(bgDir, sessionId, { log }) {
  const realPath = path.join(realBgAgentDir(), REGISTRY_NAME);
  const entries = readRegistry(realPath);
  if (!entries) {
    log(
      `[knot-metadata] home isolation: cannot read real registry at ${realPath}; resume seed skipped`,
    );
    return { seeded: false };
  }
  const entry = entries.find((candidate) => candidate?.session_id === sessionId);
  if (!entry) {
    log(
      `[knot-metadata] home isolation: session ${sessionId} not found in real registry; session/load will fail`,
    );
    return { seeded: false };
  }
  writeRegistryAtomic(path.join(bgDir, REGISTRY_NAME), [entry]);
  return { seeded: true };
}

// Mirror one session's entry from the fake registry into the real registry.
// waitForEntryMs > 0 polls briefly for the CLI to first persist the entry
// (used right after session/new); 0 expects it to already exist (shutdown).
// Read/parse/write failures are retried; an unreadable real registry aborts
// the mirror instead of risking a wholesale overwrite.
async function mirrorSessionEntry(bgDir, sessionId, { log, waitForEntryMs = 4000, attempts = 5 }) {
  const fakePath = path.join(bgDir, REGISTRY_NAME);
  const realPath = path.join(realBgAgentDir(), REGISTRY_NAME);
  const deadline = Date.now() + waitForEntryMs;
  let entry = null;
  for (;;) {
    const entries = readRegistry(fakePath);
    entry = entries?.find((candidate) => candidate?.session_id === sessionId) ?? null;
    if (entry || Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!entry) {
    log(
      `[knot-metadata] home isolation: entry for ${sessionId} missing in fake registry; mirror skipped`,
    );
    return { ok: false, error: "entry-missing" };
  }
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const realEntries = readRegistry(realPath);
    if (realEntries === null) {
      lastError = new Error("real registry unreadable");
    } else {
      try {
        writeRegistryAtomic(realPath, upsertEntry(realEntries, entry));
        return { ok: true };
      } catch (error) {
        lastError = error;
      }
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 150));
  }
  log(
    `[knot-metadata] home isolation: mirror of ${sessionId} failed after ${attempts} attempts: ${lastError?.message}`,
  );
  return { ok: false, error: lastError?.message ?? "unknown" };
}

module.exports = {
  REGISTRY_NAME,
  COPY_FILES,
  isEnabled,
  realBgAgentDir,
  readRegistry,
  writeRegistryAtomic,
  createFakeUserDir,
  seedResumeRegistry,
  mirrorSessionEntry,
};
