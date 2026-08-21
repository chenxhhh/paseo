import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import type { StreamItem } from "@/types/stream";
import { classifyToolCallCategory } from "@/tool-calls/detail-level/classify";
import { describeToolCall } from "@/tool-calls/detail-level/grouping";
import { computeToolCallDiffStat } from "@/tool-calls/diff-stat";
import { isResponseBoundary } from "./turn-membership";

export interface TurnResultFileCard {
  path: string;
  additions: number;
  deletions: number;
}

export interface TurnResultWebCard {
  url: string;
  title: string;
  hostname: string;
}

export interface TurnCollapseSummary {
  anchorItemId: string;
  headerItemId: string;
  hiddenItemCount: number;
  editedFileCount: number;
  commandCount: number;
  files: TurnResultFileCard[];
  webPages: TurnResultWebCard[];
}

export interface TurnCollapseProjection {
  tail: StreamItem[];
  summariesByAnchorItemId: Map<string, TurnCollapseSummary>;
  summariesByHeaderItemId: Map<string, TurnCollapseSummary>;
}

const EMPTY_SUMMARIES = new Map<string, TurnCollapseSummary>();

function parseHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function splitIntoResponses(tail: StreamItem[]): StreamItem[][] {
  const responses: StreamItem[][] = [];
  let current: StreamItem[] = [];
  for (const item of tail) {
    const previous = current.at(-1);
    if (previous && isResponseBoundary(previous, item)) {
      responses.push(current);
      current = [];
    }
    current.push(item);
  }
  if (current.length > 0) {
    responses.push(current);
  }
  return responses;
}

function isMechanicalNoise(item: StreamItem): boolean {
  return item.kind === "tool_call" || item.kind === "todo_list";
}

function trailingAssistantSegment(response: StreamItem[]): StreamItem[] {
  let start = response.length;
  for (let index = response.length - 1; index >= 0; index -= 1) {
    if (response[index]?.kind !== "assistant_message") {
      break;
    }
    start = index;
  }
  return response.slice(start);
}

function isKeptWhenCollapsed(item: StreamItem, trailingAssistantIds: ReadonlySet<string>): boolean {
  return item.kind === "user_message" || trailingAssistantIds.has(item.id);
}

function responseHasMechanicalNoise(response: StreamItem[]): boolean {
  return response.some((item) => isMechanicalNoise(item));
}

function buildSummary(
  response: StreamItem[],
  anchorItemId: string,
  headerItemId: string,
  trailingAssistantIds: ReadonlySet<string>,
): TurnCollapseSummary | null {
  if (!responseHasMechanicalNoise(response)) {
    return null;
  }
  let hiddenItemCount = 0;
  for (const item of response) {
    if (!isKeptWhenCollapsed(item, trailingAssistantIds)) {
      hiddenItemCount += 1;
    }
  }
  if (hiddenItemCount <= 0) {
    return null;
  }

  const filesByPath = new Map<string, TurnResultFileCard>();
  const webPagesByUrl = new Map<string, TurnResultWebCard>();
  let commandCount = 0;

  for (const item of response) {
    if (item.kind !== "tool_call") {
      continue;
    }
    commandCount += accumulateToolCall(item, filesByPath, webPagesByUrl);
  }

  const files = [...filesByPath.values()];
  return {
    anchorItemId,
    headerItemId,
    hiddenItemCount,
    editedFileCount: files.length,
    commandCount,
    files,
    webPages: [...webPagesByUrl.values()],
  };
}

function getEditedFilePath(detail: ToolCallDetail): string | null {
  if (detail.type === "edit" || detail.type === "write") {
    return detail.filePath;
  }
  return null;
}

function addWebPage(pages: Map<string, TurnResultWebCard>, url: string, title: string): void {
  if (pages.has(url) || url.length === 0) {
    return;
  }
  pages.set(url, { url, title, hostname: parseHostname(url) });
}

function addEditedFile(filesByPath: Map<string, TurnResultFileCard>, detail: ToolCallDetail): void {
  const path = getEditedFilePath(detail);
  if (!path) {
    return;
  }
  const existing = filesByPath.get(path);
  const stat = computeToolCallDiffStat(detail);
  filesByPath.set(path, {
    path,
    additions: (existing?.additions ?? 0) + (stat?.additions ?? 0),
    deletions: (existing?.deletions ?? 0) + (stat?.deletions ?? 0),
  });
}

function addSearchWebPages(pages: Map<string, TurnResultWebCard>, detail: ToolCallDetail): void {
  if (detail.type !== "search") {
    return;
  }
  for (const result of detail.webResults ?? []) {
    addWebPage(pages, result.url, result.title);
  }
}

function accumulateToolCall(
  item: Extract<StreamItem, { kind: "tool_call" }>,
  filesByPath: Map<string, TurnResultFileCard>,
  webPagesByUrl: Map<string, TurnResultWebCard>,
): number {
  const descriptor = describeToolCall(item);
  const category = classifyToolCallCategory(descriptor);
  if (category === "edit") {
    addEditedFile(filesByPath, descriptor.detail);
    return 0;
  }
  if (category === "shell") {
    return 1;
  }
  if (category === "fetch" && descriptor.detail.type === "fetch") {
    addWebPage(webPagesByUrl, descriptor.detail.url, descriptor.detail.url);
    return 0;
  }
  if (category === "search") {
    addSearchWebPages(webPagesByUrl, descriptor.detail);
  }
  return 0;
}

export function collapseCompletedTurns(input: {
  tail: StreamItem[];
  enabled: boolean;
  expandedAnchorItemIds: ReadonlySet<string>;
  isTurnActive: boolean;
}): TurnCollapseProjection {
  if (!input.enabled || input.tail.length === 0) {
    return {
      tail: input.tail,
      summariesByAnchorItemId: EMPTY_SUMMARIES,
      summariesByHeaderItemId: EMPTY_SUMMARIES,
    };
  }

  const responses = splitIntoResponses(input.tail);
  const summariesByAnchorItemId = new Map<string, TurnCollapseSummary>();
  const summariesByHeaderItemId = new Map<string, TurnCollapseSummary>();
  const nextTail: StreamItem[] = [];
  let collapsedAny = false;

  for (let index = 0; index < responses.length; index += 1) {
    const response = responses[index];
    if (!response) {
      continue;
    }
    const isTrailingActive = input.isTurnActive && index === responses.length - 1;
    if (isTrailingActive) {
      nextTail.push(...response);
      continue;
    }

    const trailingAssistants = trailingAssistantSegment(response);
    const anchor = trailingAssistants.at(-1);
    if (!anchor) {
      nextTail.push(...response);
      continue;
    }

    const header = response[0];
    if (!header) {
      nextTail.push(...response);
      continue;
    }

    const trailingAssistantIds = new Set(trailingAssistants.map((item) => item.id));
    const summary = buildSummary(response, anchor.id, header.id, trailingAssistantIds);
    if (summary) {
      summariesByAnchorItemId.set(anchor.id, summary);
      summariesByHeaderItemId.set(header.id, summary);
    }

    if (!summary || input.expandedAnchorItemIds.has(anchor.id)) {
      nextTail.push(...response);
      continue;
    }

    collapsedAny = true;
    let hostedHeaderOnKeptItem = false;
    for (const item of response) {
      if (!isKeptWhenCollapsed(item, trailingAssistantIds)) {
        continue;
      }
      nextTail.push(item);
      if (hostedHeaderOnKeptItem) {
        continue;
      }
      hostedHeaderOnKeptItem = true;
      if (item.id !== header.id) {
        summariesByHeaderItemId.set(item.id, summary);
      }
    }
  }

  if (!collapsedAny) {
    return {
      tail: input.tail,
      summariesByAnchorItemId:
        summariesByAnchorItemId.size === 0 ? EMPTY_SUMMARIES : summariesByAnchorItemId,
      summariesByHeaderItemId:
        summariesByHeaderItemId.size === 0 ? EMPTY_SUMMARIES : summariesByHeaderItemId,
    };
  }

  return {
    tail: nextTail,
    summariesByAnchorItemId,
    summariesByHeaderItemId,
  };
}
