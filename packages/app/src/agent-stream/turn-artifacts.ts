import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import { getFileExtension, getFileTypeLabel } from "@/attachments/file-types";
import type { StreamItem } from "@/types/stream";

/**
 * Written-file extensions surfaced as turn artifacts. Code and config files
 * stay out: file links and the diff pane already serve them, and artifact
 * cards exist for deliverables the agent produced for the human.
 */
const ARTIFACT_FILE_EXTENSIONS = new Set([
  // documents
  "csv",
  "doc",
  "docx",
  "epub",
  "odp",
  "ods",
  "odt",
  "pdf",
  "ppt",
  "pptx",
  "xls",
  "xlsx",
  // images
  "avif",
  "bmp",
  "gif",
  "heic",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "tif",
  "tiff",
  "webp",
  // media
  "avi",
  "flac",
  "m4a",
  "mov",
  "mp3",
  "mp4",
  "ogg",
  "wav",
  "webm",
  // archives
  "7z",
  "bz2",
  "gz",
  "rar",
  "tar",
  "tgz",
  "xz",
  "zip",
]);

export interface TurnArtifact {
  filePath: string;
  fileName: string;
  typeLabel: string;
  timestamp: Date;
}

export interface TurnChangeStats {
  fileCount: number;
  additions: number;
  deletions: number;
}

/**
 * Rewind anchor for a completed turn: the user message that started it.
 * Rewinding there reverts the turn's file changes and restores the prompt
 * into the composer.
 */
export interface TurnRewindTarget {
  messageId: string;
  promptText: string;
}

export interface TurnArtifactsSummary {
  artifacts: TurnArtifact[];
  stats: TurnChangeStats | null;
  rewindTarget: TurnRewindTarget | null;
}

export type TurnNeighborIndex = (index: number, relation: "above" | "below") => number;

export function isTurnArtifactExtension(extension: string): boolean {
  return ARTIFACT_FILE_EXTENSIONS.has(extension);
}

/** Counts newline-terminated lines the way git numstat does. */
function countTextLines(text: string | undefined): number {
  if (!text) {
    return 0;
  }
  const withoutTrailingNewline = text.endsWith("\n") ? text.slice(0, -1) : text;
  return withoutTrailingNewline.length === 0 ? 0 : withoutTrailingNewline.split("\n").length;
}

function countUnifiedDiffLines(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }
    if (line.startsWith("+")) {
      additions += 1;
    } else if (line.startsWith("-")) {
      deletions += 1;
    }
  }
  return { additions, deletions };
}

function getFileName(path: string): string {
  const segments = path.split(/[\\/]/);
  return segments[segments.length - 1] || path;
}

function getArtifactTypeLabel(path: string): string {
  return getFileTypeLabel(path) ?? "FILE";
}

interface TurnStatsState {
  artifactsByPath: Map<string, TurnArtifact>;
  touchedPaths: Set<string>;
  lastLineCountByPath: Map<string, number>;
  additions: number;
  deletions: number;
}

function editDetailLineCounts(detail: Extract<ToolCallDetail, { type: "edit" }>): {
  additions: number;
  deletions: number;
} {
  if (detail.oldString !== undefined || detail.newString !== undefined) {
    return {
      additions: countTextLines(detail.newString),
      deletions: countTextLines(detail.oldString),
    };
  }
  return detail.unifiedDiff
    ? countUnifiedDiffLines(detail.unifiedDiff)
    : { additions: 0, deletions: 0 };
}

function applyWriteDetail(
  detail: Extract<ToolCallDetail, { type: "write" }>,
  timestamp: Date,
  state: TurnStatsState,
): void {
  const written = countTextLines(detail.content);
  const previous = state.lastLineCountByPath.get(detail.filePath) ?? 0;
  state.additions += written;
  state.deletions += previous;
  state.lastLineCountByPath.set(detail.filePath, written);
  state.touchedPaths.add(detail.filePath);
  if (isTurnArtifactExtension(getFileExtension(detail.filePath).slice(1))) {
    state.artifactsByPath.set(detail.filePath, {
      filePath: detail.filePath,
      fileName: getFileName(detail.filePath),
      typeLabel: getArtifactTypeLabel(detail.filePath),
      timestamp,
    });
  }
}

function applyEditDetail(
  detail: Extract<ToolCallDetail, { type: "edit" }>,
  state: TurnStatsState,
): void {
  const counts = editDetailLineCounts(detail);
  state.additions += counts.additions;
  state.deletions += counts.deletions;
  state.lastLineCountByPath.set(
    detail.filePath,
    Math.max(
      0,
      (state.lastLineCountByPath.get(detail.filePath) ?? 0) + counts.additions - counts.deletions,
    ),
  );
  state.touchedPaths.add(detail.filePath);
}

/**
 * Collects the artifacts, change stats, and rewind anchor for the response a
 * completed-turn footer anchors to. `startIndex` is the footer host's
 * assistant message; the response spans from there down to its end and up to
 * the user message that started the turn (system-injected prompts without a
 * timeline user message extend the walk to the array edge).
 *
 * Stats are derived from write/edit tool calls, so files produced by shell
 * commands are not counted — that is the accepted tradeoff of the
 * client-only derivation.
 */
export function deriveTurnArtifactsSummary(input: {
  items: StreamItem[];
  startIndex: number;
  getNeighborIndex: TurnNeighborIndex;
}): TurnArtifactsSummary {
  const below: StreamItem[] = [];
  const above: StreamItem[] = [];
  let rewindTarget: TurnRewindTarget | null = null;

  let index = input.getNeighborIndex(input.startIndex, "below");
  for (
    let steps = 0;
    steps <= input.items.length && index >= 0 && index < input.items.length;
    steps += 1
  ) {
    const item = input.items[index];
    if (!item || item.kind === "user_message") {
      break;
    }
    below.push(item);
    index = input.getNeighborIndex(index, "below");
  }

  index = input.startIndex;
  for (
    let steps = 0;
    steps <= input.items.length && index >= 0 && index < input.items.length;
    steps += 1
  ) {
    const item = input.items[index];
    if (!item) {
      break;
    }
    if (item.kind === "user_message") {
      rewindTarget = item.messageId ? { messageId: item.messageId, promptText: item.text } : null;
      break;
    }
    above.push(item);
    index = input.getNeighborIndex(index, "above");
  }

  const state: TurnStatsState = {
    artifactsByPath: new Map<string, TurnArtifact>(),
    touchedPaths: new Set<string>(),
    lastLineCountByPath: new Map<string, number>(),
    additions: 0,
    deletions: 0,
  };

  // `above` was collected newest-first; reverse it so the whole response is
  // processed chronologically, which keeps rewrite/edit stats ordered.
  const chronological = above.toReversed().concat(below);
  for (const item of chronological) {
    if (item.kind !== "tool_call" || item.payload.source !== "agent") {
      continue;
    }
    if (item.payload.data.status !== "completed") {
      continue;
    }
    const detail = item.payload.data.detail;
    if (detail.type === "write") {
      applyWriteDetail(detail, item.timestamp, state);
    } else if (detail.type === "edit") {
      applyEditDetail(detail, state);
    }
  }

  const stats =
    state.touchedPaths.size > 0
      ? {
          fileCount: state.touchedPaths.size,
          additions: state.additions,
          deletions: state.deletions,
        }
      : null;

  return {
    artifacts: [...state.artifactsByPath.values()].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    ),
    stats,
    rewindTarget,
  };
}
