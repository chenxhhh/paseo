import { describe, expect, it } from "vitest";
import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import { computeToolCallDiffStat } from "./diff-stat";

describe("computeToolCallDiffStat", () => {
  it("counts additions and removals from a unified diff", () => {
    const detail: ToolCallDetail = {
      type: "edit",
      filePath: "/repo/a.ts",
      unifiedDiff: `@@ -1,3 +1,3 @@
 context
-old line
+new line
`,
    };

    expect(computeToolCallDiffStat(detail)).toEqual({ additions: 1, deletions: 1 });
  });

  it("counts edits from old/new strings via LCS", () => {
    const detail: ToolCallDetail = {
      type: "edit",
      filePath: "/repo/a.ts",
      oldString: "line one\nline two\nline three",
      newString: "line one\nline changed\nline three",
    };

    expect(computeToolCallDiffStat(detail)).toEqual({ additions: 1, deletions: 1 });
  });

  it("returns null for oversized old/new strings", () => {
    const detail: ToolCallDetail = {
      type: "edit",
      filePath: "/repo/a.ts",
      oldString: "a".repeat(600),
      newString: "b".repeat(600),
    };

    expect(computeToolCallDiffStat(detail)).toBeNull();
  });

  it("returns null when an edit has no old or new string", () => {
    const detail: ToolCallDetail = {
      type: "edit",
      filePath: "/repo/a.ts",
    };

    expect(computeToolCallDiffStat(detail)).toBeNull();
  });

  it("returns null for a zero-change edit", () => {
    const detail: ToolCallDetail = {
      type: "edit",
      filePath: "/repo/a.ts",
      oldString: "same",
      newString: "same",
    };

    expect(computeToolCallDiffStat(detail)).toBeNull();
  });

  it("counts write content lines without deletions", () => {
    const detail: ToolCallDetail = {
      type: "write",
      filePath: "/repo/README.md",
      content: "# heading\n\nbody line",
    };

    expect(computeToolCallDiffStat(detail)).toEqual({ additions: 3 });
  });

  it("returns null for empty write content", () => {
    const detail: ToolCallDetail = {
      type: "write",
      filePath: "/repo/README.md",
      content: "",
    };

    expect(computeToolCallDiffStat(detail)).toBeNull();
  });

  it("returns null for non-edit/write details", () => {
    const read: ToolCallDetail = { type: "read", filePath: "/repo/a.ts" };
    const shell: ToolCallDetail = { type: "shell", command: "npm test" };
    const unknown: ToolCallDetail = { type: "unknown", input: null, output: null };

    expect(computeToolCallDiffStat(read)).toBeNull();
    expect(computeToolCallDiffStat(shell)).toBeNull();
    expect(computeToolCallDiffStat(unknown)).toBeNull();
  });

  it("returns null for undefined detail", () => {
    expect(computeToolCallDiffStat(undefined)).toBeNull();
  });
});
