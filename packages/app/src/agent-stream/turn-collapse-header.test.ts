import { describe, expect, it } from "vitest";
import type { TurnCollapseSummary } from "./turn-collapse";
import {
  formatAggregatedDiffStat,
  formatTurnCollapseHeaderLabel,
} from "./turn-collapse-header-label";

function t(key: string, options?: { count?: number; duration?: string }): string {
  if (key === "message.turnResult.workedFor") {
    return `Worked for ${options?.duration}`;
  }
  if (key === "toolCallGroup.editedFiles.one") {
    return `edited ${options?.count} file`;
  }
  if (key === "toolCallGroup.editedFiles.other") {
    return `edited ${options?.count} files`;
  }
  if (key === "toolCallGroup.commands.one") {
    return `ran ${options?.count} command`;
  }
  if (key === "toolCallGroup.commands.other") {
    return `ran ${options?.count} commands`;
  }
  return key;
}

function summary(overrides: Partial<TurnCollapseSummary>): TurnCollapseSummary {
  return {
    anchorItemId: "a1",
    headerItemId: "u1",
    hiddenItemCount: 2,
    editedFileCount: 0,
    commandCount: 0,
    files: [],
    webPages: [],
    ...overrides,
  };
}

describe("formatAggregatedDiffStat", () => {
  it("joins +N and -M with a space when both are positive", () => {
    expect(
      formatAggregatedDiffStat([
        { path: "/repo/a.ts", additions: 734, deletions: 2 },
        { path: "/repo/b.ts", additions: 0, deletions: 5 },
      ]),
    ).toBe("+734 -7");
  });

  it("omits +0 and -0", () => {
    expect(formatAggregatedDiffStat([{ path: "/repo/a.ts", additions: 12, deletions: 0 }])).toBe(
      "+12",
    );
    expect(formatAggregatedDiffStat([{ path: "/repo/a.ts", additions: 0, deletions: 4 }])).toBe(
      "-4",
    );
    expect(formatAggregatedDiffStat([{ path: "/repo/a.ts", additions: 0, deletions: 0 }])).toBe("");
    expect(formatAggregatedDiffStat([])).toBe("");
  });

  it("uses compact notation matching DiffStat", () => {
    expect(formatAggregatedDiffStat([{ path: "/repo/a.ts", additions: 1500, deletions: 0 }])).toBe(
      "+1.5k",
    );
  });
});

describe("formatTurnCollapseHeaderLabel", () => {
  it("prepends the worked-for duration when durationMs is provided", () => {
    expect(
      formatTurnCollapseHeaderLabel(
        summary({
          editedFileCount: 3,
          commandCount: 2,
          files: [
            { path: "/repo/a.ts", additions: 734, deletions: 2 },
            { path: "/repo/b.ts", additions: 0, deletions: 5 },
            { path: "/repo/c.ts", additions: 0, deletions: 0 },
          ],
        }),
        t,
        8_000,
      ),
    ).toBe("Worked for 8s · edited 3 files +734 -7 · ran 2 commands");
  });

  it("appends aggregated +N -M after the edited-files phrase", () => {
    expect(
      formatTurnCollapseHeaderLabel(
        summary({
          editedFileCount: 3,
          commandCount: 2,
          files: [
            { path: "/repo/a.ts", additions: 734, deletions: 2 },
            { path: "/repo/b.ts", additions: 0, deletions: 5 },
            { path: "/repo/c.ts", additions: 0, deletions: 0 },
          ],
        }),
        t,
      ),
    ).toBe("edited 3 files +734 -7 · ran 2 commands");
  });

  it("does not append a diff stat when files are missing or all zero", () => {
    expect(
      formatTurnCollapseHeaderLabel(
        summary({
          editedFileCount: 1,
          commandCount: 1,
          files: [{ path: "/repo/a.ts", additions: 0, deletions: 0 }],
        }),
        t,
      ),
    ).toBe("edited 1 file · ran 1 command");
    expect(formatTurnCollapseHeaderLabel(summary({ editedFileCount: 0, commandCount: 2 }), t)).toBe(
      "ran 2 commands",
    );
  });
});
