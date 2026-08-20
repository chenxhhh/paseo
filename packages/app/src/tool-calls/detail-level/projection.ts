import type { StreamItem } from "@/types/stream";
import type { ToolCallDetailLevel } from "@/hooks/use-settings/storage";
import {
  groupLiveToolCalls,
  prepareGroupedHistory,
  createRunHosts,
  type BuildToolCallHosts,
  type GroupedHistory,
  type GroupedToolCalls,
} from "./grouping";
import { buildOverviewGroup, type OverviewToolCallGroup } from "./overview/model";
import { buildBalancedHosts, type BalancedToolCallGroup } from "./balanced/model";

export type { ToolCallDetailLevel } from "@/hooks/use-settings/storage";
export type ToolCallDetailGroup = OverviewToolCallGroup | BalancedToolCallGroup;

export interface PreparedToolCallHistory {
  mode: "overview" | "balanced";
  grouped: GroupedHistory<ToolCallDetailGroup>;
}

export interface ToolCallDetailProjection extends GroupedToolCalls<ToolCallDetailGroup> {}

const EMPTY_TOOL_CALL_GROUPS = new Map<string, ToolCallDetailGroup>();

function getBuildHostsForLevel(
  level: "overview" | "balanced",
): BuildToolCallHosts<ToolCallDetailGroup> {
  if (level === "overview") {
    return createRunHosts(buildOverviewGroup);
  }
  return buildBalancedHosts;
}

export function prepareToolCallHistory(
  level: ToolCallDetailLevel,
  tail: StreamItem[],
): PreparedToolCallHistory | null {
  if (level === "detailed") {
    return null;
  }
  return {
    mode: level,
    grouped: prepareGroupedHistory({ tail, buildHosts: getBuildHostsForLevel(level) }),
  };
}

export function projectToolCallDetailLevel(input: {
  level: ToolCallDetailLevel;
  tail: StreamItem[];
  head: StreamItem[];
  preparedHistory: PreparedToolCallHistory | null;
  isTurnActive: boolean;
}): ToolCallDetailProjection {
  if (input.level === "detailed") {
    return {
      tail: input.tail,
      head: input.head,
      groupsByHostId: EMPTY_TOOL_CALL_GROUPS,
      historyGroupUpdatesByHostId: EMPTY_TOOL_CALL_GROUPS,
    };
  }
  if (!input.preparedHistory || input.preparedHistory.mode !== input.level) {
    throw new Error(`Missing prepared ${input.level} tool call history`);
  }
  return groupLiveToolCalls({
    history: input.preparedHistory.grouped,
    head: input.head,
    isTurnActive: input.isTurnActive,
    buildHosts: getBuildHostsForLevel(input.level),
  });
}
