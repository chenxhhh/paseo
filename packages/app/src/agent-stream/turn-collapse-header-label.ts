import type { TurnCollapseSummary, TurnResultFileCard } from "./turn-collapse";
import { formatTurnWorkedForLabel } from "@/utils/time";

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatDiffCount(value: number): string {
  return compactFormatter.format(value).toLowerCase();
}

export function formatAggregatedDiffStat(files: readonly TurnResultFileCard[]): string {
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    additions += file.additions;
    deletions += file.deletions;
  }
  const parts: string[] = [];
  if (additions > 0) {
    parts.push(`+${formatDiffCount(additions)}`);
  }
  if (deletions > 0) {
    parts.push(`-${formatDiffCount(deletions)}`);
  }
  return parts.join(" ");
}

export function formatTurnCollapseHeaderLabel(
  summary: TurnCollapseSummary,
  t: (key: string, options: { count?: number; duration?: string }) => string,
  durationMs?: number,
): string {
  const parts: string[] = [];
  if (durationMs !== undefined) {
    parts.push(formatTurnWorkedForLabel(durationMs, t));
  }
  if (summary.editedFileCount > 0) {
    const filesPhrase = t(
      `toolCallGroup.editedFiles.${summary.editedFileCount === 1 ? "one" : "other"}`,
      { count: summary.editedFileCount },
    );
    const diff = formatAggregatedDiffStat(summary.files);
    parts.push(diff.length > 0 ? `${filesPhrase} ${diff}` : filesPhrase);
  }
  if (summary.commandCount > 0) {
    parts.push(
      t(`toolCallGroup.commands.${summary.commandCount === 1 ? "one" : "other"}`, {
        count: summary.commandCount,
      }),
    );
  }
  return parts.join(" · ");
}
