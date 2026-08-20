import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import { buildLineDiff, parseUnifiedDiff } from "@/utils/tool-call-parsers";

export interface ToolCallDiffStat {
  additions: number;
  deletions?: number;
}

/** LCS cells above which the edit fallback gives up and the chip is hidden. */
const MAX_DIFF_CELL_PRODUCT = 250_000;

function countDiffLines(lines: readonly { type: string }[]): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.type === "add") {
      additions += 1;
    } else if (line.type === "remove") {
      deletions += 1;
    }
  }
  return { additions, deletions };
}

export function computeToolCallDiffStat(
  detail: ToolCallDetail | undefined,
): ToolCallDiffStat | null {
  if (!detail) {
    return null;
  }

  if (detail.type === "edit") {
    if (detail.unifiedDiff) {
      const diff = parseUnifiedDiff(detail.unifiedDiff);
      return normalizeDiffStat(countDiffLines(diff));
    }
    if (detail.oldString !== undefined || detail.newString !== undefined) {
      const oldLines = detail.oldString ?? "";
      const newLines = detail.newString ?? "";
      if (oldLines.length * newLines.length > MAX_DIFF_CELL_PRODUCT) {
        return null;
      }
      const diff = buildLineDiff(oldLines, newLines);
      return normalizeDiffStat(countDiffLines(diff));
    }
    return null;
  }

  if (detail.type === "write") {
    if (!detail.content) {
      return null;
    }
    return normalizeDiffStat({ additions: detail.content.split("\n").length, deletions: 0 });
  }

  return null;
}

function normalizeDiffStat(stat: ToolCallDiffStat): ToolCallDiffStat | null {
  if (stat.additions === 0 && (stat.deletions ?? 0) === 0) {
    return null;
  }
  return {
    additions: stat.additions,
    ...(stat.deletions !== undefined && stat.deletions > 0 ? { deletions: stat.deletions } : {}),
  };
}
