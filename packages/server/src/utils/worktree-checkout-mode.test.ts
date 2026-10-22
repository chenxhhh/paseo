import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getWorktreeCheckoutMode,
  resolveWorktreeGitTimeoutMs,
} from "./worktree.js";

function writePaseoJson(dir: string, config: unknown): void {
  writeFileSync(join(dir, "paseo.json"), JSON.stringify(config), "utf8");
}

describe("worktree checkout mode", () => {
  let repoDir: string;
  const originalTimeoutEnv = process.env.PASEO_WORKTREE_GIT_TIMEOUT_MS;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "worktree-checkout-mode-"));
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
    if (originalTimeoutEnv === undefined) {
      delete process.env.PASEO_WORKTREE_GIT_TIMEOUT_MS;
    } else {
      process.env.PASEO_WORKTREE_GIT_TIMEOUT_MS = originalTimeoutEnv;
    }
  });

  it("defaults to eager when paseo.json is absent", () => {
    expect(getWorktreeCheckoutMode(repoDir)).toBe("eager");
  });

  it("defaults to eager when worktree.checkout is not configured", () => {
    writePaseoJson(repoDir, { worktree: { setup: ["npm ci"] } });
    expect(getWorktreeCheckoutMode(repoDir)).toBe("eager");
  });

  it("reads worktree.checkout: deferred", () => {
    writePaseoJson(repoDir, { worktree: { checkout: "deferred" } });
    expect(getWorktreeCheckoutMode(repoDir)).toBe("deferred");
  });

  it("falls back to eager instead of throwing on a malformed paseo.json", () => {
    // A broken project config must not be able to block worktree creation; setup reports it
    // separately as a workspace-level error.
    writeFileSync(join(repoDir, "paseo.json"), "{ not json", "utf8");
    expect(getWorktreeCheckoutMode(repoDir)).toBe("eager");
  });

  it("falls back to eager on an unsupported checkout value", () => {
    writePaseoJson(repoDir, { worktree: { checkout: "lazy" } });
    expect(getWorktreeCheckoutMode(repoDir)).toBe("eager");
  });
});

describe("resolveWorktreeGitTimeoutMs", () => {
  const original = process.env.PASEO_WORKTREE_GIT_TIMEOUT_MS;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.PASEO_WORKTREE_GIT_TIMEOUT_MS;
    } else {
      process.env.PASEO_WORKTREE_GIT_TIMEOUT_MS = original;
    }
  });

  it("defaults to two minutes", () => {
    delete process.env.PASEO_WORKTREE_GIT_TIMEOUT_MS;
    expect(resolveWorktreeGitTimeoutMs()).toBe(120_000);
  });

  it("honours a positive override for large repositories", () => {
    process.env.PASEO_WORKTREE_GIT_TIMEOUT_MS = "600000";
    expect(resolveWorktreeGitTimeoutMs()).toBe(600_000);
  });

  it("ignores non-numeric or non-positive overrides", () => {
    process.env.PASEO_WORKTREE_GIT_TIMEOUT_MS = "not-a-number";
    expect(resolveWorktreeGitTimeoutMs()).toBe(120_000);
    process.env.PASEO_WORKTREE_GIT_TIMEOUT_MS = "0";
    expect(resolveWorktreeGitTimeoutMs()).toBe(120_000);
  });
});
