import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import type { StreamItem, ToolCallItem } from "@/types/stream";

export interface ToolCallDescriptor {
  detail: ToolCallDetail;
  name: string;
  status: "executing" | "running" | "completed" | "failed" | "canceled";
  error: unknown;
  metadata?: Record<string, unknown>;
}

export interface ToolCallRun {
  id: string;
  calls: readonly ToolCallItem[];
  latest: ToolCallItem;
  isSealed: boolean;
}

export interface ToolCallHostPlacement<TGroup> {
  host: ToolCallItem;
  /** Index of this placement's last call within run.calls. */
  lastIndex: number;
  group?: TGroup; // absent for balanced signal pass-throughs
}

export type BuildToolCallHosts<TGroup> = (
  run: ToolCallRun,
) => readonly ToolCallHostPlacement<TGroup>[];

export interface GroupedHistory<TGroup> {
  tail: StreamItem[];
  groupsByHostId: Map<string, TGroup>;
  pendingCalls: readonly ToolCallItem[];
  /** Host ids the trailing pending run already emitted into `tail`, in order. */
  pendingHostIds: readonly string[];
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

export function createRun(calls: readonly ToolCallItem[], isSealed: boolean): ToolCallRun {
  const first = calls[0];
  const latest = calls.at(-1);
  if (!first || !latest) {
    throw new Error("Cannot group an empty tool call run");
  }
  return { id: first.id, calls, latest, isSealed };
}

function createHost(run: ToolCallRun): ToolCallItem {
  if (run.calls.length === 1) {
    return run.latest;
  }
  return { ...run.latest, id: run.id };
}

function isRunning(call: ToolCallItem): boolean {
  const status = describeToolCall(call).status;
  return status === "running" || status === "executing";
}

/** Single host per run — byte-identical to the pre-refactor overview behavior. */
export function createRunHosts<TGroup>(
  buildGroup: (run: ToolCallRun) => TGroup,
): BuildToolCallHosts<TGroup> {
  return (run) => {
    const host = createHost(run);
    return [{ host, lastIndex: run.calls.length - 1, group: buildGroup(run) }];
  };
}

function appendRun<TGroup>(input: {
  calls: readonly ToolCallItem[];
  isSealed: boolean;
  output: StreamItem[];
  groups: Map<string, TGroup>;
  buildHosts: BuildToolCallHosts<TGroup>;
}): readonly ToolCallHostPlacement<TGroup>[] {
  if (input.calls.length === 0) {
    return [];
  }
  const run = createRun(input.calls, input.isSealed);
  const placements = input.buildHosts(run);
  for (const placement of placements) {
    input.output.push(placement.host);
    if (placement.group !== undefined) {
      input.groups.set(placement.host.id, placement.group);
    }
  }
  return placements;
}

export function prepareGroupedHistory<TGroup>(input: {
  tail: StreamItem[];
  buildHosts: BuildToolCallHosts<TGroup>;
}): GroupedHistory<TGroup> {
  const output: StreamItem[] = [];
  const groups = new Map<string, TGroup>();
  let pending: ToolCallItem[] = [];
  let finalPlacements: readonly ToolCallHostPlacement<TGroup>[] = [];

  for (const item of input.tail) {
    if (isGroupableToolCall(item)) {
      pending.push(item);
      continue;
    }
    finalPlacements = appendRun({
      calls: pending,
      isSealed: true,
      output,
      groups,
      buildHosts: input.buildHosts,
    });
    pending = [];
    output.push(item);
  }

  finalPlacements = appendRun({
    calls: pending,
    isSealed: true,
    output,
    groups,
    buildHosts: input.buildHosts,
  });

  return {
    tail: groups.size > 0 ? output : input.tail,
    groupsByHostId: groups,
    pendingCalls: pending,
    pendingHostIds: pending.length > 0 ? finalPlacements.map((placement) => placement.host.id) : [],
  };
}

export function groupLiveToolCalls<TGroup>(input: {
  history: GroupedHistory<TGroup>;
  head: StreamItem[];
  isTurnActive: boolean;
  buildHosts: BuildToolCallHosts<TGroup>;
}): GroupedToolCalls<TGroup> {
  const head: StreamItem[] = [];
  const liveGroups = new Map<string, TGroup>();
  let pending = [...input.history.pendingCalls];
  let hostPlacement: "history" | "head" | null = pending.length > 0 ? "history" : null;

  const flush = (isSealed: boolean) => {
    if (pending.length === 0) {
      return;
    }
    const run = createRun(pending, isSealed);
    const historyPendingCount = input.history.pendingCalls.length;
    const retainedHostIds = hostPlacement === "history" ? input.history.pendingHostIds : [];
    const placements = input.buildHosts(run);
    for (let i = 0; i < placements.length; i += 1) {
      const placement = placements[i];
      const isRetained = i < retainedHostIds.length; // host already sits in the history tail
      if (!isRetained) {
        head.push(placement.host); // new hosts (incl. signal pass-throughs) join the head
      }
      if (placement.group === undefined) {
        continue;
      }
      const includesHeadCall = placement.lastIndex >= historyPendingCount;
      const isTrailing = i === placements.length - 1;
      if (!isRetained || includesHeadCall || (!isSealed && isTrailing)) {
        liveGroups.set(placement.host.id, placement.group);
      }
    }
    pending = [];
    hostPlacement = null;
  };

  for (const item of input.head) {
    if (isGroupableToolCall(item)) {
      if (pending.length === 0) {
        hostPlacement = "head";
      }
      pending.push(item);
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
