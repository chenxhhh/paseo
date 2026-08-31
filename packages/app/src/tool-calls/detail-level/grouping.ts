import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import type { StreamItem, ThoughtItem, ToolCallItem } from "@/types/stream";

export interface ToolCallDescriptor {
  detail: ToolCallDetail;
  name: string;
  status: "executing" | "running" | "completed" | "failed" | "canceled";
  error: unknown;
  metadata?: Record<string, unknown>;
}

/** Timeline items a detail level may fold into a single summary run. */
export type GroupableStreamItem = ToolCallItem | ThoughtItem;

export interface ToolCallRun {
  id: string;
  calls: readonly GroupableStreamItem[];
  latest: GroupableStreamItem;
  isSealed: boolean;
}

export interface GroupedHistory<TGroup> {
  tail: StreamItem[];
  groupsByHostId: Map<string, TGroup>;
  pendingCalls: readonly GroupableStreamItem[];
}

export interface GroupedToolCalls<TGroup> {
  tail: StreamItem[];
  head: StreamItem[];
  groupsByHostId: ToolCallGroupLookup<TGroup>;
  historyGroupUpdatesByHostId: ToolCallGroupLookup<TGroup>;
}

export interface ToolCallGroupLookup<TGroup> {
  readonly size: number;
  get(id: string): TGroup | undefined;
  has(id: string): boolean;
}

export type IsGroupableStreamItem = (item: StreamItem) => item is GroupableStreamItem;

const EMPTY_GROUPS = new Map<string, never>();

export function describeToolCall(item: ToolCallItem): ToolCallDescriptor {
  if (item.payload.source === "agent") {
    const { data } = item.payload;
    return {
      detail: data.detail,
      name: data.name,
      status: data.status,
      error: data.error,
      metadata: data.metadata,
    };
  }

  const { data } = item.payload;
  return {
    detail: {
      type: "unknown",
      input: data.arguments ?? null,
      output: data.result ?? null,
    },
    name: data.toolName,
    status: data.status,
    error: data.error,
  };
}

export function isGroupableToolCall(item: StreamItem): item is ToolCallItem {
  if (item.kind !== "tool_call") {
    return false;
  }
  const descriptor = describeToolCall(item);
  return descriptor.detail.type !== "plan" && descriptor.name.trim().toLowerCase() !== "speak";
}

/**
 * Drawer-level membership: tool calls group as in overview, and thinking items
 * join the same run so a whole stretch of adjacent reasoning and tool activity
 * collapses into one summary line.
 */
export function isDrawerGroupableItem(item: StreamItem): item is GroupableStreamItem {
  return item.kind === "thought" || isGroupableToolCall(item);
}

/**
 * Todo rows annotate the task tool calls a run already counts, so they never seal
 * one: a run accumulates across them and one stretch of work between assistant
 * messages keeps folding into a single summary line instead of one digest per
 * task status change.
 */
export function isRunTransparentItem(item: StreamItem): boolean {
  return item.kind === "todo_list";
}

function createRun(calls: readonly GroupableStreamItem[], isSealed: boolean): ToolCallRun {
  const first = calls[0];
  const latest = calls.at(-1);
  if (!first || !latest) {
    throw new Error("Cannot group an empty tool call run");
  }
  return { id: first.id, calls, latest, isSealed };
}

/**
 * Groups always render through the tool-call path, so a run whose anchor item is
 * a thought needs a tool-call-shaped host carrying the "thinking" name.
 */
function createThoughtHost(item: ThoughtItem): ToolCallItem {
  return {
    kind: "tool_call",
    id: item.id,
    timelineCursor: item.timelineCursor,
    turnId: item.turnId,
    timestamp: item.timestamp,
    payload: {
      source: "orchestrator",
      data: {
        toolCallId: item.id,
        toolName: "thinking",
        arguments: item.text,
        status: item.status === "ready" ? "completed" : "executing",
      },
    },
  };
}

function createHost(run: ToolCallRun): ToolCallItem {
  if (run.calls.length === 1) {
    const only = run.calls[0];
    return only.kind === "thought" ? createThoughtHost(only) : only;
  }
  if (run.latest.kind === "thought") {
    return { ...createThoughtHost(run.latest), id: run.id };
  }
  return { ...run.latest, id: run.id };
}

function isRunning(item: GroupableStreamItem): boolean {
  if (item.kind === "thought") {
    return item.status !== "ready";
  }
  const status = describeToolCall(item).status;
  return status === "running" || status === "executing";
}

function appendRun<TGroup>(input: {
  calls: readonly GroupableStreamItem[];
  isSealed: boolean;
  output: StreamItem[];
  groups: Map<string, TGroup>;
  buildGroup: (run: ToolCallRun) => TGroup;
}): void {
  if (input.calls.length === 0) {
    return;
  }
  const run = createRun(input.calls, input.isSealed);
  const host = createHost(run);
  input.output.push(host);
  input.groups.set(host.id, input.buildGroup(run));
}

export function prepareGroupedHistory<TGroup>(input: {
  tail: StreamItem[];
  buildGroup: (run: ToolCallRun) => TGroup;
  isGroupable?: IsGroupableStreamItem;
}): GroupedHistory<TGroup> {
  const isGroupable = input.isGroupable ?? isGroupableToolCall;
  const output: StreamItem[] = [];
  const groups = new Map<string, TGroup>();
  let pending: GroupableStreamItem[] = [];

  for (const item of input.tail) {
    if (isGroupable(item)) {
      pending.push(item);
      continue;
    }
    if (isRunTransparentItem(item)) {
      output.push(item);
      continue;
    }
    appendRun({
      calls: pending,
      isSealed: true,
      output,
      groups,
      buildGroup: input.buildGroup,
    });
    pending = [];
    output.push(item);
  }

  appendRun({
    calls: pending,
    isSealed: true,
    output,
    groups,
    buildGroup: input.buildGroup,
  });

  return {
    tail: groups.size > 0 ? output : input.tail,
    groupsByHostId: groups,
    pendingCalls: pending,
  };
}

export function groupLiveToolCalls<TGroup>(input: {
  history: GroupedHistory<TGroup>;
  head: StreamItem[];
  isTurnActive: boolean;
  buildGroup: (run: ToolCallRun) => TGroup;
  isGroupable?: IsGroupableStreamItem;
}): GroupedToolCalls<TGroup> {
  const isGroupable = input.isGroupable ?? isGroupableToolCall;
  const head: StreamItem[] = [];
  const liveGroups = new Map<string, TGroup>();
  let pending = [...input.history.pendingCalls];
  let hostPlacement: "history" | "head" | null = pending.length > 0 ? "history" : null;
  let pendingIncludesHead = false;

  const flush = (isSealed: boolean) => {
    if (pending.length === 0) {
      return;
    }
    const run = createRun(pending, isSealed);
    if (hostPlacement === "head") {
      head.push(createHost(run));
    }
    if (hostPlacement === "head" || pendingIncludesHead || !isSealed) {
      liveGroups.set(run.id, input.buildGroup(run));
    }
    pending = [];
    hostPlacement = null;
    pendingIncludesHead = false;
  };

  for (const item of input.head) {
    if (isGroupable(item)) {
      if (pending.length === 0) {
        hostPlacement = "head";
      }
      pending.push(item);
      pendingIncludesHead = true;
      continue;
    }
    if (isRunTransparentItem(item)) {
      head.push(item);
      continue;
    }
    flush(true);
    head.push(item);
  }
  // Tool calls live in retained tail rather than the streaming head. The agent
  // lifecycle snapshot can still be idle while a newly received tool call is
  // already running, so its direct timeline status is the authoritative start
  // signal. The lifecycle state continues to keep completed calls live between
  // sequential tool updates.
  const trailingRunIsActive = input.isTurnActive || pending.some(isRunning);
  flush(!trailingRunIsActive);

  if (liveGroups.size === 0) {
    return {
      tail: input.history.tail,
      head: input.head,
      groupsByHostId: input.history.groupsByHostId,
      historyGroupUpdatesByHostId: EMPTY_GROUPS,
    };
  }
  if (input.history.groupsByHostId.size === 0) {
    return {
      tail: input.history.tail,
      head,
      groupsByHostId: liveGroups,
      historyGroupUpdatesByHostId: EMPTY_GROUPS,
    };
  }
  const groupsByHostId = new Map(input.history.groupsByHostId);
  let historyGroupUpdatesByHostId: Map<string, TGroup> | null = null;
  for (const [id, group] of liveGroups) {
    groupsByHostId.set(id, group);
    if (input.history.groupsByHostId.has(id)) {
      historyGroupUpdatesByHostId ??= new Map();
      historyGroupUpdatesByHostId.set(id, group);
    }
  }
  return {
    tail: input.history.tail,
    head,
    groupsByHostId,
    historyGroupUpdatesByHostId: historyGroupUpdatesByHostId ?? EMPTY_GROUPS,
  };
}
