import type { StreamItem } from "@/types/stream";
import { classifyToolCallCategory } from "@/tool-calls/detail-level/classify";
import { describeToolCall } from "@/tool-calls/detail-level/grouping";

export interface ProcessRunToolCounts {
  read: number;
  search: number;
  edit: number;
  shell: number;
  fetch: number;
  other: number;
}

export interface ProcessRunDigest {
  firstItemId: string;
  thoughtCount: number;
  toolCountsByCategory: ProcessRunToolCounts;
  todoCount: number;
}

export interface ProcessRunCollapseProjection {
  tail: StreamItem[];
  runsByFirstItemId: Map<string, ProcessRunDigest>;
}

const EMPTY_RUNS = new Map<string, ProcessRunDigest>();

function isProcessItem(item: StreamItem): boolean {
  return item.kind === "tool_call" || item.kind === "thought" || item.kind === "todo_list";
}

function isTerminalProcessItem(item: StreamItem): boolean {
  if (item.kind === "thought") {
    return item.status !== "loading";
  }
  if (item.kind !== "tool_call") {
    return true;
  }
  const status = describeToolCall(item).status;
  return status === "completed" || status === "failed" || status === "canceled";
}

function emptyToolCounts(): ProcessRunToolCounts {
  return {
    read: 0,
    search: 0,
    edit: 0,
    shell: 0,
    fetch: 0,
    other: 0,
  };
}

function accumulateProcessItem(digest: ProcessRunDigest, item: StreamItem): void {
  if (item.kind === "thought") {
    digest.thoughtCount += 1;
    return;
  }
  if (item.kind === "todo_list") {
    digest.todoCount += 1;
    return;
  }
  if (item.kind !== "tool_call") {
    return;
  }
  const category = classifyToolCallCategory(describeToolCall(item));
  if (
    category === "read" ||
    category === "search" ||
    category === "edit" ||
    category === "shell" ||
    category === "fetch"
  ) {
    digest.toolCountsByCategory[category] += 1;
    return;
  }
  digest.toolCountsByCategory.other += 1;
}

function buildDigest(run: StreamItem[]): ProcessRunDigest | null {
  const first = run[0];
  if (!first) {
    return null;
  }
  const digest: ProcessRunDigest = {
    firstItemId: first.id,
    thoughtCount: 0,
    toolCountsByCategory: emptyToolCounts(),
    todoCount: 0,
  };
  for (const item of run) {
    accumulateProcessItem(digest, item);
  }
  return digest;
}

export function collapseProcessRuns(input: {
  tail: StreamItem[];
  enabled: boolean;
  expandedRunIds: ReadonlySet<string>;
}): ProcessRunCollapseProjection {
  if (!input.enabled || input.tail.length === 0) {
    return {
      tail: input.tail,
      runsByFirstItemId: EMPTY_RUNS,
    };
  }

  const runsByFirstItemId = new Map<string, ProcessRunDigest>();
  const nextTail: StreamItem[] = [];
  let collapsedAny = false;
  let index = 0;

  while (index < input.tail.length) {
    const item = input.tail[index];
    if (!item) {
      break;
    }
    if (!isProcessItem(item)) {
      nextTail.push(item);
      index += 1;
      continue;
    }

    const start = index;
    index += 1;
    while (index < input.tail.length) {
      const next = input.tail[index];
      if (!next || !isProcessItem(next)) {
        break;
      }
      index += 1;
    }
    const run = input.tail.slice(start, index);
    const first = run[0];
    const digest = buildDigest(run);
    const isLive = run.some((runItem) => !isTerminalProcessItem(runItem));
    if (!first || !digest || run.length < 2 || isLive) {
      nextTail.push(...run);
      continue;
    }

    runsByFirstItemId.set(first.id, digest);
    if (input.expandedRunIds.has(first.id)) {
      nextTail.push(...run);
      continue;
    }

    collapsedAny = true;
    nextTail.push(first);
  }

  if (!collapsedAny) {
    return {
      tail: input.tail,
      runsByFirstItemId: runsByFirstItemId.size === 0 ? EMPTY_RUNS : runsByFirstItemId,
    };
  }

  return {
    tail: nextTail,
    runsByFirstItemId,
  };
}
